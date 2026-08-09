'use client';

import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { Audio, EventBus, Keybinds, Tracks } from '@tspml/api-bridge';
import type { GameAudioManager, GameTrackCodec, GameTrackManager } from '@tspml/api-bridge';
import type { TspmlApi } from '@tspml/api';
import { readEarlyCaptures } from '@tspml/shared';
import { loadMods } from '@/lib/mod-loader';
import type { ModLoadSummary } from '@/lib/mod-loader';
import { parseMixinsJson, readUserMods, saveUserMods, upsertUserMod, userModId } from '@/lib/user-mods';
import type { UserModRecord } from '@/lib/user-mods';
import {
  buildUserPatchPlan,
  PLAN_CACHE,
  planFingerprint,
  REPORT_GLOBAL,
  USER_PATCH_LIMITS,
} from '@/lib/user-patches';
import type { UserMixinReport } from '@/lib/user-patches';
import { teardown } from '@/lib/teardown';

/**
 * Play page (milestone M2 proof of concept).
 *
 * Registers the service worker (scope "/"), then renders the REAL game by
 * iframing the proxied game root `/api/proxy/?version=<v>`. Because the iframe
 * document is same-origin and within the SW scope, the game's own runtime
 * fetches to kodub.com are intercepted by the SW and routed back through the
 * proxy with origin-corrected headers — so the game "thinks" it talks to Kodub
 * while every byte flows through /api/proxy.
 *
 * With TSPML_TRANSFORM=1, the proxy AST-rewrites main.bundle.js — the demo
 * injects a visible "TSPML ✔ LIVE" badge AND emits a `car.control` event each
 * frame (M4-B). This page creates the Tier-1 EventBus (@tspml/api-bridge),
 * exposes it to the iframe as `window.__tspml`, and subscribes — the "bridge"
 * counter in the sidebar ticks up while you race. Real mods bind the same way.
 *
 * It also hosts the custom-track registry (`api.tracks`, #36). That one is not just
 * another api member: it needs two objects out of the running game, handed over by
 * the shared capture patches at two very different moments — see
 * {@link attachTracksIfReady} and @tspml/shared's early-capture.ts.
 *
 * The audio registry (`api.audio`, #11) rides the SAME capture as the track manager
 * — it is constructor param 3 of the track-selection UI where the manager is param 5
 * — so it needs no early-capture slot and attaches from a single object.
 *
 * Layout/styling lives in globals.css. The headless smokes assert on this
 * page's rendered text and structure (aside[aria-label="Mods"], the Add form's
 * <summary> + three textareas, the "Your mixins" heading, the restart banner's
 * "need a restart" / "reload now", the `mods:`/`safety:` status lines, and the
 * empty-list placeholder copy) — keep those stable when reshaping the UI.
 */

type SwState = 'idle' | 'registering' | 'active' | 'error';

const GAME_VERSION = process.env.NEXT_PUBLIC_POLYTRACK_VERSION ?? '0.6.2';
const GAME_FRAME_SRC = `/api/proxy/?version=${GAME_VERSION}`;
/** TSPML loader version exposed on the `api` object. */
const TSPML_VERSION = '0.0.0';

interface LoadedModRow {
  id: string;
  status: 'loaded' | 'failed';
  reason?: string;
}

/**
 * What the portal puts on `window.__tspml`: the full mod-facing {@link TspmlApi}
 * plus the three capture callbacks the shared bridge patches invoke from inside
 * the game.
 *
 * The captures are deliberately NOT part of `TspmlApi` — they are the host's
 * plumbing for reaching bootstrap-scope game objects, not something a mod calls.
 * Extending keeps them typed while `loadMods(api)` still checks the mod contract.
 */
interface PortalApi extends TspmlApi {
  captureTrackManager(m: GameTrackManager): void;
  captureTrackCodec(c: GameTrackCodec): void;
  captureAudioManager(m: GameAudioManager): void;
}

/** Minimal shape check on the bundle-prelude report (#62) — it crossed a frame
 *  boundary, so trust nothing beyond "looks like a v1 report". */
function isMixinReport(v: unknown): v is UserMixinReport {
  return (
    typeof v === 'object' &&
    v !== null &&
    (v as { v?: unknown }).v === 1 &&
    Array.isArray((v as { mods?: unknown }).mods)
  );
}

/**
 * Project `mods` into the request-carried patch plan and park it in the Cache
 * API where the SW's bundle intercept reads it (#62; see lib/user-patches.ts).
 * An empty plan DELETES the entry so the SW issues the plain GET. `cacheOk`
 * false = the Cache API itself failed (insecure context, storage blocked) —
 * mixins degrade to not-applied; the game still loads.
 */
async function parkUserPatchPlan(mods: readonly UserModRecord[]): Promise<{
  fingerprint: string | null;
  sets: number;
  overCap: string[];
  envSkipped: string[];
  cacheOk: boolean;
}> {
  const { plan, overCap, envSkipped } = buildUserPatchPlan(mods);
  const fingerprint = plan.sets.length > 0 ? planFingerprint(plan) : null;
  let cacheOk = true;
  try {
    const cache = await caches.open(PLAN_CACHE.name);
    if (plan.sets.length === 0) {
      await cache.delete(PLAN_CACHE.url);
    } else {
      await cache.put(
        PLAN_CACHE.url,
        new Response(JSON.stringify(plan), { headers: { 'content-type': 'application/json' } }),
      );
    }
  } catch {
    cacheOk = false;
  }
  return { fingerprint, sets: plan.sets.length, overCap, envSkipped, cacheOk };
}

export default function PlayPage(): ReactElement {
  const [swState, setSwState] = useState<SwState>('idle');
  const [swError, setSwError] = useState<string | null>(null);
  const [controlCount, setControlCount] = useState(0);
  const [keybindCount, setKeybindCount] = useState(0);
  const [modsStatus, setModsStatus] = useState('…');
  const [safetyStatus, setSafetyStatus] = useState('');
  const [tracksStatus, setTracksStatus] = useState('waiting for the game…');
  const [audioStatus, setAudioStatus] = useState('waiting for the game…');
  const [loadedMods, setLoadedMods] = useState<LoadedModRow[]>([]);
  // User-added mods (runtime mod loading, the feature that makes the portal
  // usable without forking the repo). State drives the UI; the ref mirrors it so
  // load/reload paths — which run outside React's render cycle — read the latest
  // list. localStorage is best-effort persistence, not the source of truth.
  const [userMods, setUserMods] = useState<UserModRecord[]>([]);
  const userModsRef = useRef<UserModRecord[]>([]);
  const [mixinsSkipped, setMixinsSkipped] = useState<readonly string[]>([]);
  const [persistWarning, setPersistWarning] = useState<string | null>(null);
  const [draftManifest, setDraftManifest] = useState('');
  const [draftCode, setDraftCode] = useState('');
  const [draftMixins, setDraftMixins] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  // #62 user-mixin plumbing. The plan must sit in the Cache API BEFORE the game
  // iframe mounts (the SW reads it while serving the bundle), so the mount
  // gates on `planReady` as well as the SW. `parked` = fingerprint of the plan
  // currently in the cache; `served` = the one the current frame was loaded
  // with. They diverge on any mid-session mod change → restart banner (the
  // bundle is immutable once loaded; only a reload re-runs the transform).
  const [planReady, setPlanReady] = useState(false);
  const [mixinReport, setMixinReport] = useState<UserMixinReport | null>(null);
  const [mixinOverCap, setMixinOverCap] = useState<readonly string[]>([]);
  // #21: enabled mods with pasted mixins whose manifest declares them for a
  // DIFFERENT environment (desktop/worker) — left out of the plan, said out loud.
  const [mixinEnvSkipped, setMixinEnvSkipped] = useState<readonly string[]>([]);
  const [mixinNotice, setMixinNotice] = useState<string | null>(null);
  const [needsRestart, setNeedsRestart] = useState(false);
  // Fullscreen is on the STAGE wrapper, not the iframe: the overlay button must
  // stay visible (and clickable) in fullscreen to offer the way back out.
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Theater ("expand") mode: the stage fills the browser tab — topbar and
  // sidebar collapse via a class on .app — WITHOUT the Fullscreen API, so the
  // browser chrome stays. A separate control from fullscreen on purpose.
  const [isTheater, setIsTheater] = useState(false);
  // Boot progress plumbing: the stage shows a step list until every TSPML boot
  // stage lands (SW controls the page → mixin plan parked → game bundle loaded
  // → mods loaded), then fades. `frameLoaded` flips in handleFrameLoad;
  // `bootHidden` unmounts the overlay shortly after the fade completes.
  const [frameLoaded, setFrameLoaded] = useState(false);
  const [bootHidden, setBootHidden] = useState(false);
  // Which add-a-mod method is selected. Only "paste" works today; "url" is a
  // placeholder for import-by-URL / modpacks (#80) so the dropdown already
  // teaches the model of "several ways to add a mod".
  const [addMethod, setAddMethod] = useState<'paste' | 'url'>('paste');
  const stageRef = useRef<HTMLElement>(null);
  const parkedFingerprintRef = useRef<string | null>(null);
  const servedFingerprintRef = useRef<string | null>(null);
  const planSetsRef = useRef(0);
  // Serializes plan parks the way reloadChainRef serializes mod reloads: two
  // rapid toggles must not land their cache.put calls out of order, or the
  // parked plan and the fingerprint ref would disagree.
  const planChainRef = useRef<Promise<void>>(Promise.resolve());
  // The Tier-1 event bus shared with the game iframe: the transform emits
  // `car.control` (and future events) to `window.__tspml`; mods subscribe here.
  // The handle is always exposed — harmless when the bundle is unmodified (the
  // vanilla game never reads it; only the transformed bundle emits).
  const [bus] = useState<EventBus>(() => new EventBus());
  // The custom-track registry. Constructed unattached: `register` QUEUES until the
  // capture patches hand over the game's objects, so a mod can call it at load time
  // without caring that the game's menu does not exist yet.
  const [tracks] = useState<Tracks>(() => new Tracks());
  // Same deal for audio (#11): unattached at first, `register` queues until the
  // game's audio manager is captured.
  const [audio] = useState<Audio>(() => new Audio());
  const frameRef = useRef<HTMLIFrameElement>(null);
  const keybindsRef = useRef<Keybinds | null>(null);
  const demoKeybindRegistered = useRef(false);
  const modsLoadedRef = useRef(false);
  // The api handed to mods, kept so add/remove/toggle can RELOAD the mod set
  // after the initial frame load. Null until the frame loads.
  const apiRef = useRef<PortalApi | null>(null);
  // Serializes reloads: a toggle spam must not interleave unload/load pairs.
  const reloadChainRef = useRef<Promise<void>>(Promise.resolve());
  // The loaded mods' teardown closure (#17), available only once `loadMods` resolves.
  // A ref rather than state: teardown must read the LATEST value from an effect cleanup
  // that deliberately never re-runs, and state would close over the mount-time value.
  const unloadModsRef = useRef<(() => Promise<void>) | undefined>(undefined);
  // The two captures arrive independently and out of order (see attachTracksIfReady).
  const trackManagerRef = useRef<GameTrackManager | null>(null);
  const trackCodecRef = useRef<GameTrackCodec | null>(null);

  // Surface a throttled count of car.control events. controlCar fires on INPUT
  // CHANGES (keydown/keyup), not every frame — so the count jumps in bursts
  // around keypresses; the 500ms throttle keeps React re-renders bounded.
  useEffect(() => {
    let n = 0;
    let last = 0;
    const off = bus.on('car.control', () => {
      n++;
    });
    const id = window.setInterval(() => {
      if (n !== last) {
        last = n;
        setControlCount(n);
      }
    }, 500);
    return () => {
      off();
      window.clearInterval(id);
    };
  }, [bus]);

  // Track fullscreen so the button can flip label and the way out is always
  // offered in the UI itself (Esc works too, but say so with a visible control).
  useEffect(() => {
    const onChange = (): void => setIsFullscreen(document.fullscreenElement !== null);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = (): void => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void stageRef.current?.requestFullscreen?.();
    }
  };

  // Esc leaves theater mode — but only while the PORTAL window has focus; keys
  // pressed inside the game iframe land in the game (that is what keybinds are
  // for). The on-stage button is therefore the primary way out, Esc a courtesy.
  useEffect(() => {
    if (!isTheater) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setIsTheater(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isTheater]);

  // Hydrate the user-mod list from localStorage once, on the client only —
  // reading in the initial useState would run during SSR/prerender too. Then
  // park the mixin patch plan (#62): the iframe mount gates on `planReady`, so
  // by the time the SW fetches the bundle the plan is already in the cache.
  useEffect(() => {
    const stored = readUserMods();
    userModsRef.current = stored;
    setUserMods(stored);
    let cancelled = false;
    planChainRef.current = planChainRef.current.then(async () => {
      const r = await parkUserPatchPlan(stored);
      if (cancelled) return;
      parkedFingerprintRef.current = r.fingerprint;
      servedFingerprintRef.current = r.fingerprint; // the first frame loads THIS plan
      planSetsRef.current = r.sets;
      setMixinOverCap(r.overCap);
      setMixinEnvSkipped(r.envSkipped);
      if (!r.cacheOk) {
        setMixinNotice('Storage for mixin plans is unavailable — user-mod mixins will not be applied this session.');
      }
      setPlanReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // The four boot stages the progress overlay reports, in the order they
  // complete. "mods" is done once loadMods resolved either way — the overlay
  // tracks boot PROGRESS; per-mod verdicts live in the sidebar.
  const bootSteps = [
    { label: 'Service worker', done: swState === 'active' },
    { label: 'Mixin plan', done: planReady },
    { label: 'Game', done: frameLoaded },
    { label: 'Mods', done: modsStatus !== '…' },
  ];
  const bootDone = bootSteps.every((s) => s.done);

  // Unmount the overlay a beat after the last step lands so the CSS fade can
  // play; until then it sits over the stage with pointer-events:none.
  useEffect(() => {
    if (!bootDone) return;
    const id = window.setTimeout(() => setBootHidden(true), 700);
    return () => window.clearTimeout(id);
  }, [bootDone]);

  /** Push a load's results into the sidebar state. */
  const applyLoadSummary = (s: ModLoadSummary): void => {
    unloadModsRef.current = s.unload;
    const rows: LoadedModRow[] = [
      ...s.loaded.map((id) => ({ id, status: 'loaded' as const })),
      ...s.failed.map((f) => ({ id: f.id, status: 'failed' as const, reason: f.reason })),
    ];
    setLoadedMods(rows);
    setMixinsSkipped(s.mixinsSkipped);
    setModsStatus(
      s.loaded.length > 0
        ? `✓ ${s.loaded.join(', ')}`
        : s.failed.length > 0
          ? `✗ ${s.failed[0]!.reason.slice(0, 48)}`
          : 'none',
    );
    // M6-B: surface the warn-only safety classification.
    const sr = s.safety[0]?.report;
    if (sr) {
      const w = sr.warnings.length;
      setSafetyStatus(
        `${sr.vanillaSafe ? '✓' : '⚠'} vanillaSafe${sr.leaderboardRisk === 'warn' ? ' (lb-risk)' : ''}${w > 0 ? ` · ${w} warn` : ''}`,
      );
    }
  };

  /**
   * Replace the user-mod list: update state, persist, and reload the whole mod
   * set through the loader (there is no incremental add — the loader owns
   * dependency resolution over the FULL set, so the honest operation is
   * unload-everything, load-everything).
   *
   * Reloads are chained on a single promise: React state updates make rapid
   * toggle clicks cheap, but each still queues an unload/load pair, and
   * interleaving two of those would double-load mods.
   */
  const updateUserMods = (next: UserModRecord[]): void => {
    userModsRef.current = next;
    setUserMods(next);
    setPersistWarning(
      saveUserMods(next)
        ? null
        : 'Storage unavailable — mods work this session but will not survive a reload.',
    );
    // Re-park the mixin plan (#62). The RUNNING frame keeps the bundle it was
    // served with — if the effective patch set changed, only a reload applies
    // it, so surface the restart banner instead of pretending.
    planChainRef.current = planChainRef.current.then(async () => {
      const r = await parkUserPatchPlan(next);
      parkedFingerprintRef.current = r.fingerprint;
      planSetsRef.current = r.sets;
      setMixinOverCap(r.overCap);
      setMixinEnvSkipped(r.envSkipped);
      setNeedsRestart(r.fingerprint !== servedFingerprintRef.current);
    });
    const api = apiRef.current;
    if (!api || !modsLoadedRef.current) return; // frame not loaded yet; first load picks the list up
    reloadChainRef.current = reloadChainRef.current.then(async () => {
      try {
        await unloadModsRef.current?.();
        applyLoadSummary(await loadMods(api, { userMods: userModsRef.current }));
      } catch (e) {
        setModsStatus(`✗ ${(e as Error).message.slice(0, 48)}`);
      }
    });
  };

  /**
   * Attach the track registry once BOTH captures have landed (#36).
   *
   * The two arrive at unrelated moments and in either order: the codec's module
   * factory runs during bundle init (before this component's frame-`load` handler,
   * hence the early-capture replay below), while the TrackManager is handed over much
   * later, when the game builds its track-selection menu. So neither capture can
   * attach on its own — whichever is second does it. Idempotent: `tracks.ready`
   * guards a second attach.
   */
  const attachTracksIfReady = (): void => {
    const manager = trackManagerRef.current;
    const codec = trackCodecRef.current;
    if (!manager || !codec || tracks.ready) return;
    tracks.attach({ manager, codec });
    setTracksStatus('✓ attached');
  };

  // Expose the Tier-1 `api` object (events + keybinds + tracks) to the same-origin
  // game iframe as `window.__tspml`: transformed hooks emit to `api.events`, mods
  // call `api.keybinds.register(...)` / `api.tracks.register(...)`, and the capture
  // patches call `captureTrack*`. Built on iframe load (when the game window exists).
  // Also registers a demo keybind (KeyF) for a visible "registry works" signal.
  const handleFrameLoad = (): void => {
    const w = frameRef.current?.contentWindow as
      | (Window & { __tspml?: unknown; [REPORT_GLOBAL]?: unknown })
      | null;
    if (!w) return;
    setFrameLoaded(true);
    // #62: the per-mod mixin report rides INSIDE the served bundle as a
    // `window.__tspmlUserMixins` prelude — same-origin frame, read it directly.
    // Non-null plan but no global: the bundle bypassed the SW POST path
    // (transform off, SW raced, or an extension interfered) — say so honestly
    // rather than showing stale/no rows.
    const rawReport = w[REPORT_GLOBAL];
    if (isMixinReport(rawReport)) {
      setMixinReport(rawReport);
      setMixinNotice(null);
    } else {
      setMixinReport(null);
      if (planSetsRef.current > 0) {
        setMixinNotice(
          'Mixins were not applied to this game load — the bundle was served without the patch plan (transform mode off, or the service worker did not intercept).',
        );
      }
    }
    servedFingerprintRef.current = parkedFingerprintRef.current;
    setNeedsRestart(false);
    // #67: handleFrameLoad runs on EVERY iframe load, and each load can mean a
    // new document + window (in-place game reload, React remount of the
    // <iframe>). Everything else here is rebuilt per-load; keybinds must
    // RETARGET instead — a fresh registry would drop every binding mods
    // registered at mod-load time, while the old one keeps listening to a
    // window that no longer receives key events.
    if (keybindsRef.current) keybindsRef.current.retarget(w);
    else keybindsRef.current = new Keybinds(w);
    if (!demoKeybindRegistered.current) {
      keybindsRef.current.register({
        id: 'tspml.demo',
        key: 'KeyF',
        description: 'TSPML demo keybind',
        onDown: () => setKeybindCount((n) => n + 1),
      });
      demoKeybindRegistered.current = true;
    }
    // The Tier-1 `api` object handed to mods, PLUS the two capture callbacks the
    // shared track-capture patches invoke from inside the game (not part of the mod
    // API — the loader owns them).
    //
    // Annotated rather than inferred: this literal IS the mod-facing contract, and
    // before #18 it reached the loader through `as unknown as ModApi`, which
    // suppressed every check. Dropping a member here used to compile.
    const api: PortalApi = {
      events: bus,
      keybinds: keybindsRef.current,
      tracks,
      audio,
      logger: console,
      version: TSPML_VERSION,
      captureTrackManager: (m: GameTrackManager) => {
        trackManagerRef.current = m;
        attachTracksIfReady();
      },
      captureTrackCodec: (c: GameTrackCodec) => {
        trackCodecRef.current = c;
        attachTracksIfReady();
      },
      // One object is all the audio registry needs, so it attaches right here
      // rather than waiting on a second capture the way tracks must.
      captureAudioManager: (m: GameAudioManager) => {
        if (audio.ready) return;
        audio.attach({ manager: m });
        setAudioStatus('✓ attached');
      },
    };
    w.__tspml = api;
    apiRef.current = api;
    // Replay anything the pre-bridge stub recorded before `api` existed just now. The
    // codec capture fires during bundle init, so without this it is simply lost and
    // the registry never attaches (@tspml/shared's EARLY_CAPTURE_STUB, injected by
    // the proxy route).
    const early = readEarlyCaptures<GameTrackManager, GameTrackCodec>(w);
    if (early.manager) trackManagerRef.current = early.manager;
    if (early.codec) trackCodecRef.current = early.codec;
    attachTracksIfReady();
    // Load the bundled demo mods + any stored user mods via @tspml/loader — a
    // real mod package receives this api and subscribes. Per-mod failure
    // isolation (never boot-aborts). Reads `userModsRef` (not `userMods` state)
    // because this handler runs outside React's render cycle; the ref is
    // populated by the hydration effect, which runs before the SW effect that
    // gates mounting the iframe, so it is always set by the time a frame loads.
    if (!modsLoadedRef.current) {
      modsLoadedRef.current = true;
      // Retaining `s.unload` (via applyLoadSummary) is load-bearing (#17): it is
      // the only handle to the loaded mods' cleanup — dropping it, which is what
      // used to happen, made every `onUnload` unreachable no matter how
      // completely the loader implemented it.
      reloadChainRef.current = reloadChainRef.current.then(async () => {
        try {
          applyLoadSummary(await loadMods(api, { userMods: userModsRef.current }));
        } catch (e) {
          setModsStatus(`✗ ${(e as Error).message.slice(0, 48)}`);
        }
      });
    }
  };

  /** Parse + add the pasted mod, or explain inline why not. */
  const handleAddMod = (): void => {
    // Empty-box checks FIRST: "Unexpected end of JSON input" on a blank
    // manifest told users nothing about what to do (reported confusion).
    if (draftManifest.trim().length === 0) {
      setAddError('box 1 (mod.json) is empty — it is required. Paste the mod’s manifest JSON.');
      return;
    }
    if (draftCode.trim().length === 0) {
      setAddError('box 2 (entrypoint.js) is empty — it is required. Paste the BUILT entrypoint JS (ES module, default export).');
      return;
    }
    let manifest: unknown;
    try {
      manifest = JSON.parse(draftManifest);
    } catch (e) {
      setAddError(`manifest is not valid JSON: ${(e as Error).message.slice(0, 80)}`);
      return;
    }
    if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
      setAddError('manifest must be a JSON object (the contents of mod.json)');
      return;
    }
    // Optional third paste (#62): the mod's mixins.json. Validated shallowly
    // here so the author hears about malformed JSON immediately; caps are
    // checked at add time too (the same limits the server re-enforces).
    let mixins: Record<string, unknown>[] | undefined;
    if (draftMixins.trim().length > 0) {
      const parsed = parseMixinsJson(draftMixins);
      if (!parsed.ok) {
        setAddError(parsed.error);
        return;
      }
      if (parsed.patches.length > USER_PATCH_LIMITS.maxPatchesPerMod) {
        setAddError(`mixins.json has ${parsed.patches.length} patches — the limit is ${USER_PATCH_LIMITS.maxPatchesPerMod}`);
        return;
      }
      const oversized = parsed.patches.find(
        (p) => typeof p.inject === 'string' && p.inject.length > USER_PATCH_LIMITS.maxInjectChars,
      );
      if (oversized) {
        setAddError(`a patch's inject exceeds ${USER_PATCH_LIMITS.maxInjectChars.toLocaleString()} characters`);
        return;
      }
      mixins = parsed.patches;
    }
    const rec: UserModRecord = {
      manifest: manifest as Record<string, unknown>,
      code: draftCode,
      ...(mixins === undefined ? {} : { mixins }),
      enabled: true,
      addedAt: new Date().toISOString(),
    };
    // Same-id adds REPLACE the stored copy (upsertUserMod) — that is how a
    // modder iterates on their mod without a remove/add dance. Deeper
    // validation (required fields, semver, duplicate-vs-bundled) is the
    // loader's job; its verdict lands in the mod list with a reason.
    const next = upsertUserMod(userModsRef.current, rec);
    setAddError(null);
    setDraftManifest('');
    setDraftCode('');
    setDraftMixins('');
    updateUserMods(next);
  };

  // Teardown (#17). The loader has always returned an idempotent `unload()` and every
  // bridge registry has `dispose()`; what was missing was a caller, so mods could never
  // actually clean up — the exact PML failure TSPML claims to fix.
  //
  // Two triggers, because neither covers the other: React unmount (navigation inside the
  // app, dev-mode remount) and `pagehide` (closing the tab, a real navigation away),
  // where no React lifecycle runs at all. `unload()` is idempotent and `teardown` is
  // safe to run twice, so both firing is fine.
  //
  // `pagehide` rather than `unload`: `unload` never fires on mobile Safari and disables
  // the back/forward cache outright. Empty deps — this must bind once and tear down
  // once; it reads live values through refs.
  useEffect(() => {
    const run = (): void => {
      void teardown({
        bus,
        unloadMods: unloadModsRef.current,
        registries: [keybindsRef.current, tracks, audio],
      });
    };
    window.addEventListener('pagehide', run);
    return () => {
      window.removeEventListener('pagehide', run);
      run();
    };
  }, [bus, tracks, audio]);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) {
      setSwState('error');
      setSwError('Service workers are not supported in this browser.');
      return;
    }
    let cancelled = false;
    setSwState('registering');
    // The service worker must be CONTROLLING this page before the game loads:
    // the game's runtime fetches (track data, leaderboard) go to kodub.com and
    // are only rewritten to /api/proxy if the SW intercepts them. On a first
    // visit the SW is registered but not yet the controller, so loading the
    // game immediately lets its track fetch escape the SW → CORS-fail →
    // "Failed to load track" (issue #9). We therefore mount the game iframe
    // only after `controllerchange` (or immediately if already controlled).
    const control = (): void => {
      if (!cancelled) setSwState('active');
    };
    if (navigator.serviceWorker.controller) {
      control();
    } else {
      navigator.serviceWorker.addEventListener('controllerchange', control, {
        once: true,
      });
    }
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .catch((err: unknown) => {
        if (cancelled) return;
        setSwState('error');
        setSwError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const bootDoneCount = bootSteps.filter((s) => s.done).length;

  return (
    <main className={isTheater ? 'app theater' : 'app'}>
      <header className="topbar">
        <div>
          <h1>TSPML — PolyTrack, modded</h1>
          <p className="tagline">
            The real game through a service worker + <code>/api/proxy</code>, mod-transformed on
            the way.
          </p>
        </div>
        <ServiceWorkerBadge state={swState} error={swError} />
      </header>

      <div className="content">
        {/* Mount also gates on planReady (#62): the SW reads the mixin plan
            from the Cache API while serving the bundle, so it must be parked
            before the frame's first fetch. The park is a couple of Cache API
            calls — never a visible delay on top of SW activation. */}
        <section ref={stageRef} className="stage" aria-label="Game">
          {swState === 'active' && planReady ? (
            <>
              <iframe
                ref={frameRef}
                onLoad={handleFrameLoad}
                title="PolyTrack (proxied)"
                src={GAME_FRAME_SRC}
                className="game-frame"
                allow="autoplay; fullscreen; gamepad; pointer-lock"
                allowFullScreen
              />
              <div className="stage-controls">
                <button
                  type="button"
                  className="stage-btn theater-btn"
                  onClick={() => setIsTheater((t) => !t)}
                  title={
                    isTheater
                      ? 'Back to the normal layout (Esc works while the page has focus)'
                      : 'Expand over the whole tab (no fullscreen)'
                  }
                >
                  {isTheater ? '🗗 Shrink' : '⤢ Expand'}
                </button>
                <button
                  type="button"
                  className="stage-btn fs-btn"
                  onClick={toggleFullscreen}
                  title={isFullscreen ? 'Exit fullscreen (Esc works too)' : 'Play fullscreen'}
                >
                  {isFullscreen ? '✕ Exit fullscreen' : '⛶ Fullscreen'}
                </button>
              </div>
            </>
          ) : null}
          {/* Boot progress (over the stage until every step lands, then fades).
              pointer-events:none so it never eats a click meant for the game or
              the stage buttons — it is a status surface, not a modal. */}
          {!bootHidden ? (
            <div className={bootDone ? 'boot-overlay boot-done' : 'boot-overlay'} aria-live="polite">
              {swState === 'error' ? (
                <div className="stage-loading">
                  Service worker unavailable — the game needs it to load.
                  <span className="stage-hint">{swError}</span>
                </div>
              ) : (
                <div className="boot-card">
                  <div className="boot-title">
                    {bootDone ? 'TSPML ready' : 'Loading TSPML…'}
                  </div>
                  <div className="boot-bar" role="progressbar" aria-valuemin={0} aria-valuemax={4} aria-valuenow={bootDoneCount}>
                    <div className="boot-bar-fill" style={{ width: `${(bootDoneCount / bootSteps.length) * 100}%` }} />
                  </div>
                  <ol className="boot-steps">
                    {bootSteps.map((s, i) => {
                      const active = !s.done && bootSteps.slice(0, i).every((p) => p.done);
                      return (
                        <li key={s.label} className={s.done ? 'done' : active ? 'active' : ''}>
                          <span className="boot-mark" aria-hidden="true">
                            {s.done ? '✓' : active ? '◌' : '·'}
                          </span>
                          {s.label}
                        </li>
                      );
                    })}
                  </ol>
                  <span className="stage-hint">
                    The game mounts once the service worker controls this page, so
                    its track/leaderboard requests are proxied (issue #9).
                  </span>
                </div>
              )}
            </div>
          ) : null}
        </section>

        <aside className="sidebar" aria-label="Mods">
          {/* The restart banner leads the sidebar: it is the one thing here that
              asks the user to act, and it must not hide below the fold. */}
          {needsRestart ? (
            <div className="restart-banner">
              ⚠ Mixin changes need a restart —{' '}
              <button type="button" className="btn btn-small" onClick={() => window.location.reload()}>
                reload now
              </button>{' '}
              to apply them to the game. (The running game keeps the bundle it was
              served; entrypoint-only changes apply live.)
            </div>
          ) : null}

          <section className="side-section">
            <h2>Your mods</h2>
            {userMods.length === 0 ? (
              <p className="meta">None yet — add one below.</p>
            ) : (
              <ul className="rows mod-cards">
                {userMods.map((mod, i) => {
                  const id = userModId(mod) ?? `(no id #${i + 1})`;
                  const version = typeof mod.manifest.version === 'string' ? mod.manifest.version : null;
                  return (
                    <li key={id} className={mod.enabled ? 'mod-card' : 'mod-card mod-card-off'}>
                      {/* The tile and body wrapper are <i>/<div> on purpose: the
                          smoke reads each row's FIRST <span> as the status text. */}
                      <i className="mod-tile" aria-hidden="true">
                        {id.replace(/^tspml-/, '').charAt(0).toUpperCase() || 'M'}
                      </i>
                      <div className="mod-card-body">
                        <div className="row-head">
                          <code>{id}</code>
                          <span className="row-buttons">
                            <button
                              type="button"
                              className="btn btn-small"
                              onClick={() =>
                                updateUserMods(
                                  userModsRef.current.map((m) => (m === mod ? { ...m, enabled: !m.enabled } : m)),
                                )
                              }
                            >
                              {mod.enabled ? 'disable' : 'enable'}
                            </button>
                            <button
                              type="button"
                              className="btn btn-small"
                              onClick={() => updateUserMods(userModsRef.current.filter((m) => m !== mod))}
                            >
                              remove
                            </button>
                          </span>
                        </div>
                        <div className="meta">
                          {mod.enabled ? 'enabled' : 'disabled'}
                          {version ? ` · v${version}` : ''}
                          {mod.mixins ? ` · ${mod.mixins.length} mixin${mod.mixins.length === 1 ? '' : 's'}` : ''}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {persistWarning ? <p className="warn">⚠ {persistWarning}</p> : null}
            {mixinsSkipped.length > 0 ? (
              <p className="warn">
                ⚠ <code>{mixinsSkipped.join(', ')}</code>: the manifest declares
                mixins but no <code>mixins.json</code> was pasted — they were{' '}
                <strong>not applied</strong>. Re-add the mod with its{' '}
                <code>mixins.json</code> in the third box. The mod’s entrypoint
                (events, keybinds, tracks, audio) still runs.
              </p>
            ) : null}
            {mixinOverCap.length > 0 ? (
              <p className="warn">
                ⚠ <code>{mixinOverCap.join(', ')}</code>: mixins exceed the
                per-request limits and were left out of the patch plan.
              </p>
            ) : null}
            {mixinEnvSkipped.length > 0 ? (
              <p className="warn">
                ⚠ <code>{mixinEnvSkipped.join(', ')}</code>: the manifest declares
                its mixins for a different environment (this portal is{' '}
                <code>web</code>) — they were <strong>not applied</strong>.
              </p>
            ) : null}

            <details className="add-form">
              <summary>+ Add a mod</summary>
              {/* Smoke contract (smoke-user-mods.mjs): after clicking the summary
                  it fills THREE textareas by index (0=manifest, 1=code, 2=mixins)
                  and clicks the "Add mod" button — the paste method must stay the
                  default so all three exist in the DOM in that order. */}
              <label className="add-label">
                How do you want to add it?
                <select
                  className="add-select"
                  value={addMethod}
                  onChange={(e) => setAddMethod(e.target.value === 'url' ? 'url' : 'paste')}
                >
                  <option value="paste">Paste the mod’s files (works now)</option>
                  <option value="url">Import from a URL / modpack (coming soon)</option>
                </select>
              </label>
              {addMethod === 'url' ? (
                <p className="meta">
                  Not available yet — importing a mod by URL (and modpacks) is
                  planned as issue #80. For now, switch back to{' '}
                  <strong>Paste the mod’s files</strong>: only two boxes are
                  required.
                </p>
              ) : (
                <p className="meta">
                  A mod is two files (plus one optional). Paste each into its box —
                  only <strong>1</strong> and <strong>2</strong> are required. The
                  mod stays in this browser’s storage.
                </p>
              )}
              <div className={addMethod === 'paste' ? undefined : 'add-hidden'}>
                <label className="add-label">
                  <span className="field-tag req">required</span> 1 · mod.json — the mod’s manifest
                  <textarea
                    rows={5}
                    spellCheck={false}
                    placeholder='{"schemaVersion": 1, "id": "my-mod", "version": "1.0.0", "environment": "web", "entrypoint": "index.js"}'
                    value={draftManifest}
                    onChange={(e) => setDraftManifest(e.target.value)}
                  />
                </label>
                <label className="add-label">
                  <span className="field-tag req">required</span> 2 · entrypoint.js — the{' '}
                  <strong>built</strong> code (ES module, default export;{' '}
                  <code>pnpm build</code> output, not TypeScript source)
                  <textarea
                    rows={7}
                    spellCheck={false}
                    placeholder="export default (api) => { /* ... */ };"
                    value={draftCode}
                    onChange={(e) => setDraftCode(e.target.value)}
                  />
                </label>
                <label className="add-label">
                  <span className="field-tag opt">optional</span> 3 · mixins.json — Tier-2 game
                  patches; leave empty unless the mod ships one (applied on the next game load)
                  <textarea
                    rows={5}
                    spellCheck={false}
                    placeholder='{"patches": [{"op": "after", "symbol": "Car", "inject": "..."}]}'
                    value={draftMixins}
                    onChange={(e) => setDraftMixins(e.target.value)}
                  />
                </label>
                <p className="warn">
                  Mod code runs unsandboxed in this page, in your browser — exactly
                  like the bundled mods. Only add code you trust or wrote. The safety
                  classifier labels each mod but never blocks.
                </p>
                {addError ? <p className="warn">✗ {addError}</p> : null}
                <button type="button" className="btn btn-primary" onClick={handleAddMod}>
                  Add mod
                </button>
              </div>
            </details>
          </section>

          {mixinNotice || (mixinReport && mixinReport.mods.length > 0) ? (
            <section className="side-section">
              <h2>Your mixins</h2>
              {mixinNotice ? <p className="warn">⚠ {mixinNotice}</p> : null}
              {mixinReport && mixinReport.mods.length > 0 ? (
                <>
                  {mixinReport.planStatus !== 'applied' ? (
                    <p className="warn">
                      ⚠ plan {mixinReport.planStatus} — no user mixin was applied.
                    </p>
                  ) : null}
                  <ul className="rows">
                    {mixinReport.mods.map((m) => (
                      <li key={m.modId}>
                        <div className="row-head">
                          <code>{m.modId}</code>
                          <span
                            className="status-pill"
                            style={{
                              color:
                                m.applied === m.declared ? 'var(--green)' : m.applied > 0 ? 'var(--amber)' : 'var(--red)',
                            }}
                          >
                            {m.applied}/{m.declared} applied
                          </span>
                        </div>
                        {m.failed.map((f, i) => (
                          <div key={i} className="meta">
                            ✗ {f.reason}: {f.detail.slice(0, 96)}
                          </div>
                        ))}
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </section>
          ) : null}

          <section className="side-section">
            <h2>Loaded mods</h2>
            <ul className="rows mod-cards">
              {loadedMods.length === 0 ? (
                <li>
                  <div className="meta">
                    {swState === 'active' ? 'loading…' : 'waiting for game…'}
                  </div>
                </li>
              ) : (
                loadedMods.map((mod) => (
                  /* Smoke contract (smoke.mjs): per row, <code> is the mod id and
                     the FIRST <span> is the status — the tile is an <i> and the
                     body a <div> so the status-pill keeps that slot. */
                  <li key={mod.id} className={mod.status === 'loaded' ? 'mod-card' : 'mod-card mod-card-failed'}>
                    <i className="mod-tile" aria-hidden="true">
                      {mod.id.replace(/^tspml-/, '').charAt(0).toUpperCase() || 'M'}
                    </i>
                    <div className="mod-card-body">
                      <div className="row-head">
                        <code>{mod.id}</code>
                        <span
                          className="status-pill"
                          style={{ color: mod.status === 'loaded' ? 'var(--green)' : 'var(--red)' }}
                        >
                          {mod.status}
                        </span>
                      </div>
                      {mod.reason ? <div className="meta">{mod.reason.slice(0, 72)}</div> : null}
                    </div>
                  </li>
                ))
              )}
            </ul>
          </section>

          <section className="side-section">
            <h2>Status</h2>
            <div className="status-row">
              <span
                className="dot"
                style={{ background: controlCount > 0 ? 'var(--green)' : 'var(--muted)' }}
                aria-hidden="true"
              />
              bridge:{' '}
              {controlCount > 0
                ? `car.control × ${controlCount.toLocaleString()}`
                : 'idle (start a race)'}
            </div>
            <div className="status-row">
              <span
                className="dot"
                style={{ background: keybindCount > 0 ? 'var(--green)' : 'var(--muted)' }}
                aria-hidden="true"
              />
              registry:{' '}
              {keybindCount > 0
                ? `keybind F × ${keybindCount}`
                : 'press F (TSPML demo keybind)'}
            </div>
            <div className="status-row">
              <span
                className="dot"
                style={{
                  background: modsStatus.startsWith('✓')
                    ? 'var(--green)'
                    : modsStatus.startsWith('✗')
                      ? 'var(--red)'
                      : 'var(--muted)',
                }}
                aria-hidden="true"
              />
              mods: {modsStatus}
            </div>
            {safetyStatus ? (
              <div className="status-row">
                <span
                  className="dot"
                  style={{ background: safetyStatus.startsWith('⚠') ? 'var(--amber)' : 'var(--green)' }}
                  aria-hidden="true"
                />
                safety: {safetyStatus}
              </div>
            ) : null}
            <div className="status-row">
              <span
                className="dot"
                style={{ background: tracksStatus.startsWith('✓') ? 'var(--green)' : 'var(--muted)' }}
                aria-hidden="true"
              />
              tracks: {tracksStatus}
            </div>
            <div className="status-row">
              <span
                className="dot"
                style={{ background: audioStatus.startsWith('✓') ? 'var(--green)' : 'var(--muted)' }}
                aria-hidden="true"
              />
              audio: {audioStatus}
            </div>
            <p className="meta">
              Live signals from the bridge: <code>car.control</code> ticks while you
              race, and once <code>tracks</code>/<code>audio</code> read attached a
              mod can add tracks to the game’s Custom list and override its sounds.
            </p>
          </section>
        </aside>
      </div>
    </main>
  );
}

function ServiceWorkerBadge({
  state,
  error,
}: {
  state: SwState;
  error: string | null;
}): ReactElement {
  const label =
    state === 'active'
      ? 'service worker active'
      : state === 'registering'
        ? 'registering service worker…'
        : state === 'error'
          ? 'service worker unavailable'
          : 'service worker idle';
  const color = state === 'active' ? 'var(--green)' : state === 'error' ? 'var(--red)' : 'var(--amber)';
  return (
    <p className="sw-badge" style={{ color }}>
      <span aria-hidden="true">● </span>
      {label}
      {error ? <span className="sw-error"> — {error}</span> : null}
    </p>
  );
}

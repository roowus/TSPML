'use client';

import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { Audio, Editor, EditorLifecycle, EventBus, Keybinds, Tracks } from '@tspml/api-bridge';
import type {
  EditorAccessor,
  GameAudioManager,
  GameTrackCodec,
  GameTrackManager,
} from '@tspml/api-bridge';
import type { TspmlApi } from '@tspml/api';
import { readEarlyCaptures, TSPML_LOADER_VERSION } from '@tspml/shared';
import { summarizeSafety } from '@tspml/loader';
import { loadMods } from '@/lib/mod-loader';
import type { ModLoadSummary } from '@/lib/mod-loader';
import {
  readUserMods,
  saveUserMods,
  upsertUserMod,
  userModIcon,
  userModId,
} from '@/lib/user-mods';
import type { UserModRecord } from '@/lib/user-mods';
import { importModFromUrl } from '@/lib/mod-import';
import { refreshFromSources } from '@/lib/mod-reload';
import { buildShareUrl, parseShareUrls, SHARE_LIMITS, SHARE_PARAM } from '@/lib/mod-share';
import type { ShareBuildResult, ShareParseResult } from '@/lib/mod-share';
import { classifyModpackInput, fetchModpackList, MODPACK_LIMITS } from '@/lib/modpack';
import type { ModpackParseResult } from '@/lib/modpack';
import { Icon } from '../icons';
import {
  buildUserPatchPlan,
  CHUNK_REPORT_EVENT,
  modAppliedOn,
  PLAN_CACHE,
  planFingerprint,
  REPORT_GLOBAL,
  surfaceReports,
} from '@/lib/user-patches';
import type { UserMixinReport } from '@/lib/user-patches';
import {
  asPhysicsReport,
  buildPhysicsPlan,
  PHYSICS_CACHE,
} from '@/lib/physics-plan';
import type { PhysicsExclusion, PhysicsReport } from '@/lib/physics-plan';
import { teardown } from '@/lib/teardown';
import { trackModAdded, trackModsLoaded } from '@/lib/analytics';
import {
  applyInstanceOverlay,
  findInstance,
  isDisabledInInstance,
  readInstances,
  saveInstances,
  setModDisabledInInstance,
  touchInstance,
  type Instance,
} from '@/lib/instances';
import { AddModForm } from '@/components/play/AddModForm';
import { BrowseDrawer } from '@/components/play/BrowseDrawer';
import { ModShelf } from '@/components/play/ModShelf';
import { ModTile } from '@/components/play/ModTile';
import { ServiceWorkerBadge } from '@/components/play/ServiceWorkerBadge';
import type { LoadedModRow, SwState } from '@/components/play/types';
import { InstanceTile } from '@/components/shell/InstanceTile';
import { useInstall, type InstallTarget } from '@/components/shell/useInstall';

/**
 * The play surface, at `/play`.
 *
 * This is the ONLY route that mounts the game. That is a deliberate property,
 * not an accident of where the file sits: the iframe is gated on
 * `swState === 'active' && planReady` because both the mixin plan and the
 * physics plan must be parked in the Cache API BEFORE the frame's first bundle
 * fetch. A game frame that lived in a layout would boot while the user was
 * still choosing mods elsewhere, and every plan would park too late. So
 * navigating away from this route stops the game, which is also the honest
 * launcher semantic — "close" should actually close.
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
 * page's rendered text and structure (aside[aria-label="Mods"] — now the Mods
 * MENU panel over the stage rather than a split-screen column — the Add form's
 * <summary> + textareas 0-2 in that order — box 4 (physics.json, #43) is
 * APPENDED after them for exactly this reason, the "Your mixins" heading, the restart banner's
 * "need a restart" / "reload now", the `mods:`/`safety:` status lines, and the
 * empty-list placeholder copy) — keep those stable when reshaping the UI.
 */

const GAME_VERSION = process.env.NEXT_PUBLIC_POLYTRACK_VERSION ?? '0.6.2';
const GAME_FRAME_SRC = `/api/proxy/?version=${GAME_VERSION}`;
/**
 * TSPML loader version exposed on the `api` object. Same constant the resolve
 * context states for the `tspml` special dep id (#73), so what a mod reads at
 * runtime and what its `depends` range was checked against cannot disagree.
 */
const TSPML_VERSION = TSPML_LOADER_VERSION;

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
  /** Chunk 112's module-scope accessors, from the factory capture (#87). */
  captureTrackEditor(a: EditorAccessor): void;
  /** The live editor plus its new open state, from `enable()`/`disable()` (#87). */
  captureTrackEditorInstance(instance: unknown, open: boolean): void;
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
 * Snapshot the frame's report for React state (#98).
 *
 * The chunk prelude MUTATES the live object in place (`m.chunks[file] = r`), so the
 * global's identity never changes when a chunk lands. Handing that same reference back
 * to `setMixinReport` would be a no-op re-render and the chunk's rows would never
 * appear. Copying one level down — the object plus its `chunks` map — is exactly enough
 * to make both the report and the map new to React.
 */
function snapshotMixinReport(r: UserMixinReport): UserMixinReport {
  return r.chunks ? { ...r, chunks: { ...r.chunks } } : { ...r };
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

/**
 * The same park, for the PHYSICS plan (#43). Separate cache entry, separate
 * fingerprint, separate everything — see lib/physics-plan.ts for why the two
 * plans do not share a body.
 *
 * The fingerprint is just the serialized plan rather than a hash: it is only
 * ever compared to another one for equality (parked vs served → restart
 * banner), never transmitted, and a physics plan is at most 32 small patches,
 * so hashing it would buy nothing but a dependency.
 */
async function parkPhysicsPlan(mods: readonly UserModRecord[]): Promise<{
  fingerprint: string | null;
  patches: number;
  excluded: PhysicsExclusion[];
  cacheOk: boolean;
}> {
  const { plan, excluded } = buildPhysicsPlan(mods);
  const body = plan === null ? null : JSON.stringify(plan);
  let cacheOk = true;
  try {
    const cache = await caches.open(PHYSICS_CACHE.name);
    if (body === null) {
      // No plan means the SW must issue the plain GET: the vanilla binary is
      // the correct answer here, and a stale entry would patch a session whose
      // mods no longer ask for it.
      await cache.delete(PHYSICS_CACHE.url);
    } else {
      await cache.put(
        PHYSICS_CACHE.url,
        new Response(body, { headers: { 'content-type': 'application/json' } }),
      );
    }
  } catch {
    cacheOk = false;
  }
  return { fingerprint: body, patches: plan?.patches.length ?? 0, excluded, cacheOk };
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
  // The editor chunk loads on demand, so "not captured" is the normal state for a
  // session where the player never opens the editor — say that rather than
  // implying something is pending.
  const [editorStatus, setEditorStatus] = useState('not loaded (open the editor)');
  const [loadedMods, setLoadedMods] = useState<LoadedModRow[]>([]);
  // User-added mods (runtime mod loading, the feature that makes the portal
  // usable without forking the repo). State drives the UI; the ref mirrors it so
  // load/reload paths — which run outside React's render cycle — read the latest
  // list. localStorage is best-effort persistence, not the source of truth.
  const [userMods, setUserMods] = useState<UserModRecord[]>([]);
  const userModsRef = useRef<UserModRecord[]>([]);
  const [mixinsSkipped, setMixinsSkipped] = useState<readonly string[]>([]);
  const [persistWarning, setPersistWarning] = useState<string | null>(null);
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
  // #43 physics plumbing, deliberately parallel to the mixin plumbing above and
  // deliberately not merged into it: a physics patch is a float written into the
  // compiled binary, and the ways it can go wrong (a pin naming another build,
  // two mods over one constant) have nothing in common with a mixin's.
  const [physicsExcluded, setPhysicsExcluded] = useState<readonly PhysicsExclusion[]>([]);
  const [physicsSkipped, setPhysicsSkipped] = useState<readonly string[]>([]);
  const [physicsNotice, setPhysicsNotice] = useState<string | null>(null);
  // The SW's report of what the route actually did to the served binary. Only
  // the SW can see it (a wasm response carries no prelude to report in), so this
  // arrives as a postMessage — until it does, the honest answer is "nothing yet".
  const [physicsReport, setPhysicsReport] = useState<PhysicsReport | null>(null);
  const [needsRestart, setNeedsRestart] = useState(false);
  // Fullscreen is on the STAGE wrapper, not the iframe: the overlay button must
  // stay visible (and clickable) in fullscreen to offer the way back out.
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Theater ("expand") mode: the stage fills the browser tab — topbar and
  // sidebar collapse via a class on .app — WITHOUT the Fullscreen API, so the
  // browser chrome stays. A separate control from fullscreen on purpose.
  const [isTheater, setIsTheater] = useState(false);
  // The in-play catalog, as an overlay over the stage rather than a route: a
  // navigation to /browse would unmount the game iframe and lose the run.
  const [browseOpen, setBrowseOpen] = useState(false);
  // The Mods menu — every mod-management surface that used to be a permanent
  // split-screen sidebar column. Same overlay pattern as the browse drawer:
  // mounted as a sibling of section.stage inside div.content so opening it can
  // never re-parent or unmount the game iframe. `hidden` when closed keeps its
  // DOM (and therefore every smoke selector) present at all times.
  const [menuOpen, setMenuOpen] = useState(false);
  // Boot progress plumbing: the stage shows a step list until every TSPML boot
  // stage lands (SW controls the page → mixin plan parked → game bundle loaded
  // → mods loaded), then fades. `frameLoaded` flips in handleFrameLoad;
  // `bootHidden` unmounts the overlay shortly after the fade completes.
  const [frameLoaded, setFrameLoaded] = useState(false);
  const [bootHidden, setBootHidden] = useState(false);
  // "⟳ reload" (the reload-mods feature): busy while URL re-fetches are in
  // flight; the notice reports per-mod re-fetch failures (stored copy kept).
  const [reloadBusy, setReloadBusy] = useState(false);
  const [reloadNotice, setReloadNotice] = useState<string | null>(null);
  // Share-a-mod-set (links only, never code — see lib/mod-share.ts). `sharePanel`
  // holds the built link so the UI can SHOW it with its own copy button —
  // clipboard writes can fail silently (permissions, non-secure contexts), so
  // the link itself is the ground truth and copying is an explicit action.
  // `shareNotice` covers the link-less cases (nothing shareable, import
  // failures); `sharePrompt` holds the parsed links from an INCOMING share URL
  // until the user confirms or dismisses — nothing is imported without that
  // click (mod code runs unsandboxed; a silent auto-import would be a drive-by).
  const [sharePanel, setSharePanel] = useState<ShareBuildResult | null>(null);
  const [shareCopied, setShareCopied] = useState(false);
  const [shareNotice, setShareNotice] = useState<string | null>(null);
  const [sharePrompt, setSharePrompt] = useState<ShareParseResult | null>(null);
  const [shareImportBusy, setShareImportBusy] = useState(false);
  // The launching instance, for the topbar and the per-instance mod overlay.
  // Null when the page was opened directly rather than from the launcher, or
  // when the id did not resolve — both ordinary, so neither shows an error, and
  // both mean NO overlay (the whole library runs, as it did before instances).
  //
  // Mirrored into a ref for the same reason `userMods` is: the plan-parking and
  // loader paths run outside React's render cycle and would otherwise read a
  // stale instance, which here means running a mod the player switched off.
  const [instance, setInstance] = useState<Instance | null>(null);
  const instanceRef = useRef<Instance | null>(null);
  const instanceName = instance?.name ?? null;
  /**
   * The mod set as it should RUN: the shared library projected through this
   * instance's overlay.
   *
   * Every runtime consumer takes this, and `saveUserMods` never does — see
   * {@link applyInstanceOverlay}. Persisting the projection would turn one
   * instance's per-mod switch into everybody's.
   */
  const runningMods = (): UserModRecord[] =>
    applyInstanceOverlay(userModsRef.current, instanceRef.current);
  // The boot/status log: what happened, when, in order. Shown live on the
  // loading overlay (last lines) and in full in the sidebar's Log section —
  // the honest answer to "what is it doing?" while the overlay progress bar
  // sits on a step. Session-only; never persisted.
  const [bootLog, setBootLog] = useState<readonly { t: string; msg: string }[]>([]);
  // Closes over nothing but the stable setter — safe to call from effects and
  // out-of-render handlers alike. Bounded to the last 200 lines.
  const log = (msg: string): void => {
    const t = new Date().toLocaleTimeString('en-GB', { hour12: false });
    setBootLog((prev) => [...prev.slice(-199), { t, msg }]);
  };
  const stageRef = useRef<HTMLElement>(null);
  const parkedFingerprintRef = useRef<string | null>(null);
  const servedFingerprintRef = useRef<string | null>(null);
  const planSetsRef = useRef(0);
  // Serializes plan parks the way reloadChainRef serializes mod reloads: two
  // rapid toggles must not land their cache.put calls out of order, or the
  // parked plan and the fingerprint ref would disagree.
  const planChainRef = useRef<Promise<void>>(Promise.resolve());
  // #43: the physics plan's counterparts. Rides the SAME chain as the mixin plan
  // (both parks happen in one `.then`), so a single restart comparison sees both
  // halves of a mod change settled.
  const parkedPhysicsRef = useRef<string | null>(null);
  const servedPhysicsRef = useRef<string | null>(null);
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
  // The editor registry (#87). Unlike tracks and audio it does NOT queue: it stays
  // unattached for most sessions (the editor chunk only loads if the player opens
  // the editor) and every call reports `not-available` instead. Queueing "place
  // these parts" would be wrong — by the time a session existed to place them in,
  // the request would refer to nothing.
  const [editor] = useState<Editor>(() => new Editor());
  const frameRef = useRef<HTMLIFrameElement>(null);
  const keybindsRef = useRef<Keybinds | null>(null);
  const demoKeybindRegistered = useRef(false);
  const modsLoadedRef = useRef(false);
  // #98: detaches the previous frame's chunk-report listener. handleFrameLoad runs
  // on EVERY load and each one is a new window, so without this an in-place game
  // reload would leave a listener bound to a dead document (harmless) and, worse,
  // stack a fresh one every reload.
  const chunkReportOffRef = useRef<(() => void) | null>(null);
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
  // The editor's two halves, also out of order (#87): the accessor comes from the
  // chunk's module factory, the instance from the editor's own `enable()`. Both are
  // needed before the registry can attach — see attachEditorIfReady.
  const editorAccessorRef = useRef<EditorAccessor | null>(null);
  const editorInstanceRef = useRef<unknown>(null);
  const [editorLifecycle] = useState<EditorLifecycle>(
    () => new EditorLifecycle(bus, editor),
  );

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

  // Esc leaves theater mode and closes the Mods menu — but only while the
  // PORTAL window has focus; keys pressed inside the game iframe land in the
  // game (that is what keybinds are for). The on-stage buttons are the primary
  // way out of either, Esc a courtesy.
  useEffect(() => {
    if (!isTheater && !menuOpen) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setIsTheater(false);
        setMenuOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isTheater, menuOpen]);

  // The #118 pre-hydration adoption effect lives in AddModForm, not here: it
  // reads the DOM through refs on the Add-form controls, and the fix only holds
  // while it is a []-dep mount effect in the same component that renders them.

  /**
   * `?instance=<id>` — resolve the launching instance, record the launch.
   *
   * Declared BEFORE the hydration effect on purpose. Effects run in declaration
   * order on mount, and the hydration effect parks the mixin and physics plans
   * for the frame that is about to boot; if the instance were not resolved by
   * then, the first plan would be parked without the overlay and the running
   * bundle would carry patches from a mod this instance has switched off. The
   * bundle is immutable once loaded, so that is not a glitch that a re-render
   * fixes — only a reload does.
   *
   * An unknown id (a stale bookmark, a link from another browser) is ignored
   * rather than repaired: `touchInstance` returns its input unchanged for an id
   * it does not hold, and the guard below means nothing is written. That
   * matters more than it looks — writing here would put the synthesized default
   * into a profile that has nothing stored, breaking the lazy-read property for
   * anyone who merely followed a bad link. It also means NO overlay, so the
   * whole library runs, exactly as it did before instances existed.
   */
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('instance');
    if (id === null || id === '') return;
    const store = readInstances();
    const found = findInstance(store, id);
    if (found === null) {
      log(`instance '${id}' is not in this browser — playing with your full mod library`);
      return;
    }
    instanceRef.current = found;
    setInstance(found);
    const next = touchInstance(store, id, new Date().toISOString());
    if (next !== store) saveInstances(next);
    log(
      `launched instance '${found.name}' (${found.gameVersion})${
        found.disabledModIds.length > 0
          ? ` — ${found.disabledModIds.length} mod${found.disabledModIds.length === 1 ? '' : 's'} switched off for this instance`
          : ''
      }`,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot URL read; log only touches its stable setter
  }, []);

  // Hydrate the user-mod list from localStorage once, on the client only —
  // reading in the initial useState would run during SSR/prerender too. Then
  // park the mixin patch plan (#62): the iframe mount gates on `planReady`, so
  // by the time the SW fetches the bundle the plan is already in the cache.
  useEffect(() => {
    const stored = readUserMods();
    userModsRef.current = stored;
    setUserMods(stored);
    log(
      stored.length > 0
        ? `restored ${stored.length} user mod${stored.length === 1 ? '' : 's'} from browser storage`
        : 'no stored user mods',
    );
    // What gets PARKED is the projection, not the pool: a mixin or physics
    // patch from a mod this instance switched off must not reach the bundle.
    // `stored` stays the thing shown and persisted.
    const running = runningMods();
    let cancelled = false;
    planChainRef.current = planChainRef.current.then(async () => {
      const r = await parkUserPatchPlan(running);
      if (cancelled) return;
      parkedFingerprintRef.current = r.fingerprint;
      servedFingerprintRef.current = r.fingerprint; // the first frame loads THIS plan
      planSetsRef.current = r.sets;
      setMixinOverCap(r.overCap);
      setMixinEnvSkipped(r.envSkipped);
      if (!r.cacheOk) {
        setMixinNotice('Storage for mixin plans is unavailable — user-mod mixins will not be applied this session.');
      }
      // #43: the physics plan is parked in the SAME step, before `planReady`
      // releases the iframe. The wasm is fetched well after the bundle, so this
      // has slack the mixin plan does not — but gating both on one flag keeps
      // "the plan is parked" a single fact rather than two racing ones.
      const p = await parkPhysicsPlan(running);
      if (cancelled) return;
      parkedPhysicsRef.current = p.fingerprint;
      servedPhysicsRef.current = p.fingerprint;
      setPhysicsExcluded(p.excluded);
      if (!p.cacheOk) {
        setPhysicsNotice('Storage for physics plans is unavailable — physics patches will not be applied this session.');
      }
      setPlanReady(true);
      log(
        r.sets > 0
          ? `mixin plan parked (${r.sets} mod${r.sets === 1 ? '' : 's'} with patches)`
          : 'mixin plan parked (empty — no user mixins)',
      );
      log(
        p.patches > 0
          ? `physics plan parked (${p.patches} patch${p.patches === 1 ? '' : 'es'})`
          : 'physics plan parked (empty — no physics patches)',
      );
      // Prewarm the transformed bundle: the serverless babel pass costs
      // seconds, and without this it only starts AFTER the SW dance + iframe
      // mount + game HTML parse. Firing the GET now runs it in parallel —
      // the server memoizes the in-flight promise, so the game's real request
      // piggybacks on this one instead of recomputing. Only when no mixin
      // plan is parked: with a plan the SW replays bundle GETs as per-request
      // POST composes (#62), so this would double the server work for an
      // output that gets discarded, while the base memo it warms is not the
      // path the game will take. The body is drained (not cancelled): an
      // aborted body shows up as a failed request in devtools/smokes, and the
      // extra parallel download is trivial next to the transform time saved.
      if (r.sets === 0) {
        log('prewarming the game bundle…');
        void fetch(`/api/proxy/main.bundle.js?version=${GAME_VERSION}`, { credentials: 'omit' })
          .then(async (res) => {
            await res.arrayBuffer();
            log(`game bundle prewarmed (server cache: ${res.headers.get('x-tspml-bundle-cache') ?? 'n/a'})`);
          })
          .catch(() => log('game bundle prewarm failed (non-fatal)'));
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- log only touches its stable setter
  }, []);

  // Incoming share link (?mods=<url>&mods=<url>…): parse it ONCE on mount and
  // immediately strip the params from the address bar — otherwise the restart
  // banner's "reload now" (and any manual reload) would re-prompt for a set
  // that may already be imported. The parsed links sit in `sharePrompt` until
  // the user confirms; nothing is fetched or run before that click.
  useEffect(() => {
    const parsed = parseShareUrls(window.location.search);
    if (parsed.urls.length === 0 && parsed.invalid.length === 0) return;
    const clean = new URL(window.location.href);
    clean.searchParams.delete(SHARE_PARAM);
    window.history.replaceState(null, '', clean.href);
    setSharePrompt(parsed);
    log(
      `share link opened: ${parsed.urls.length} mod link${parsed.urls.length === 1 ? '' : 's'}${
        parsed.invalid.length > 0 ? `, ${parsed.invalid.length} refused` : ''
      }${parsed.dropped > 0 ? `, ${parsed.dropped} over the cap` : ''} — waiting for your confirmation`,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot URL read; log only touches its stable setter
  }, []);

  /**
   * Build the share link for the CURRENT mod set and open the share panel,
   * which shows the link itself next to a copy button. Links only: the URL
   * carries each enabled mod's sourceUrl, never code — pasted mods can't ride
   * (their only copy is this browser's storage) and are named so the sharer
   * knows to send those another way. Copying is a separate, explicit click:
   * clipboard writes can fail silently (permissions, embedding), and a visible
   * link can always be selected by hand.
   */
  const handleShare = (): void => {
    setShareNotice(null);
    setShareCopied(false);
    // The projection, not the pool: a link should carry what the sharer is
    // actually playing. Sharing a mod they had switched off for this instance
    // would hand the recipient a set the sharer never ran.
    const r = buildShareUrl(runningMods(), window.location.href);
    if (r.url === null) {
      setSharePanel(null);
      setShareNotice(
        'Nothing to share yet — only enabled URL-imported mods can ride a link. Pasted mods live only in this browser; host them somewhere and re-import by URL to share them.',
      );
      return;
    }
    log(`share link built (${r.included.length} mod${r.included.length === 1 ? '' : 's'}: ${r.included.join(', ')})`);
    setSharePanel(r);
  };

  /** The share panel's copy button. Failure keeps the panel up — the visible
      link is the fallback, so the user can select it by hand. */
  const handleShareCopy = (): void => {
    const url = sharePanel?.url;
    if (!url) return;
    void navigator.clipboard
      .writeText(url)
      .then(() => setShareCopied(true))
      .catch(() => setShareNotice('Copy failed — select the link above and copy it by hand.'));
  };

  /**
   * Import a list of mod URLs, one after another.
   *
   * Shared by the share-link confirm and the modpack box because they ARE the
   * same operation: a set of links, each imported exactly as a single URL
   * import is, with one failure never stopping the rest (#80: fail per mod,
   * not per pack). Sequential rather than parallel so the log reads in order
   * and a slow host cannot interleave upserts.
   *
   * Returns the new set and the failures; the caller applies it with ONE
   * `updateUserMods`, so a pack of six mods is one unload/reload of the set
   * rather than six.
   */
  const importUrlList = async (
    urls: readonly string[],
    method: 'share' | 'modpack',
    label: string,
  ): Promise<{ next: readonly UserModRecord[]; failed: string[] }> => {
    let next = userModsRef.current;
    const failed: string[] = [];
    for (const url of urls) {
      const result = await importModFromUrl(url);
      if (!result.ok) {
        failed.push(url);
        log(`${label} import failed for ${url.slice(0, 80)}: ${result.error.slice(0, 120)}`);
        continue;
      }
      const rec: UserModRecord = {
        manifest: result.mod.manifest,
        code: result.mod.code,
        ...(result.mod.mixins === undefined ? {} : { mixins: result.mod.mixins }),
        ...(result.mod.physics === undefined ? {} : { physics: result.mod.physics }),
        enabled: true,
        addedAt: new Date().toISOString(),
        sourceUrl: url,
      };
      // upsert, so re-importing a pack the user already has REPLACES by id
      // rather than piling up duplicate rows (#80: a repeat import converges).
      next = upsertUserMod(next, rec);
      log(`added mod '${userModId(rec) ?? '(no id)'}' (${label})`);
      trackModAdded(userModId(rec), method);
    }
    return { next, failed };
  };

  /**
   * The confirm step for an incoming share link. Each link goes through
   * `importModFromUrl` — the browser's own fetch, same host rules and caps as
   * the Add form's URL import. One `updateUserMods` at the end: a single
   * unload/reload of the whole set instead of N.
   */
  const handleShareImport = (): void => {
    const prompt = sharePrompt;
    if (!prompt || shareImportBusy) return;
    setShareImportBusy(true);
    log(`importing ${prompt.urls.length} mod${prompt.urls.length === 1 ? '' : 's'} from the share link…`);
    void (async () => {
      const { next, failed } = await importUrlList(prompt.urls, 'share', 'from the share link');
      setShareImportBusy(false);
      setSharePrompt(null);
      if (failed.length > 0) {
        setShareNotice(
          `${failed.length} of ${prompt.urls.length} share-link mod${prompt.urls.length === 1 ? '' : 's'} failed to import — see the Log section for each error.`,
        );
      }
      // Only reload the set if something actually imported — an all-failed
      // confirm should not bounce the running mods.
      if (next !== userModsRef.current) updateUserMods([...next]);
    })();
  };

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
    log(
      `mods loaded: ${s.loaded.length} ok${s.failed.length > 0 ? `, ${s.failed.length} failed (${s.failed.map((f) => f.id).join(', ')})` : ''}`,
    );
    const rows: LoadedModRow[] = [
      ...s.loaded.map((id) => ({ id, status: 'loaded' as const })),
      ...s.failed.map((f) => ({ id: f.id, status: 'failed' as const, reason: f.reason })),
    ];
    // Usage analytics: ids only — reasons can quote manifest contents.
    trackModsLoaded(s.loaded, s.failed.map((f) => f.id));
    setLoadedMods(rows);
    setMixinsSkipped(s.mixinsSkipped);
    setPhysicsSkipped(s.physicsSkipped);
    setModsStatus(
      s.loaded.length > 0
        ? `✓ ${s.loaded.join(', ')}`
        : s.failed.length > 0
          ? `✗ ${s.failed[0]!.reason.slice(0, 48)}`
          : 'none',
    );
    // M6-B: surface the warn-only safety classification, over the WHOLE set.
    // Reading s.safety[0] alone (as this did before #43) hides a physics mod
    // that happens to be added second, which is the one case the label exists
    // for. summarizeSafety takes the maximum; null means "no mods", which
    // clears the row rather than leaving a stale line after the last removal.
    const sr = summarizeSafety(s.safety.map((e) => e.report));
    if (sr === null) {
      setSafetyStatus('');
    } else {
      const w = sr.warnings.length;
      // The ⚠ prefix drives the row's dot colour, so it tracks leaderboardRisk,
      // not the declaration: a physics mod that declares vanillaSafe=true is
      // still a risk, and a green dot beside it would misreport that.
      //
      // The two risky wordings are kept apart because they are different facts.
      // "not vanilla-safe" is the mod's own admission; "leaderboard risk" is
      // what TSPML concluded about a mod that declared itself safe (a physics
      // patch, or the network capability). Printing "vanilla-safe (lb-risk)"
      // for the second — as the naive join did — reads as a contradiction and
      // tells the player nothing about which of the two they are looking at.
      const label = !sr.vanillaSafe
        ? 'not vanilla-safe'
        : sr.leaderboardRisk === 'warn'
          ? 'leaderboard risk'
          : 'vanilla-safe';
      setSafetyStatus(
        `${sr.leaderboardRisk === 'warn' ? '⚠' : '✓'} ${label}${w > 0 ? ` · ${w} warn` : ''}`,
      );
    }
  };

  /**
   * Re-park the plans and reload every mod, for the CURRENT running set.
   *
   * Called whenever what-should-run changes, which happens two ways that look
   * different and behave identically from here: the pool changed
   * (add/remove/global toggle) or the instance's overlay changed. Both end in
   * the same unload-everything/load-everything, because the loader owns
   * dependency resolution over the full set and there is no honest incremental
   * add.
   *
   * Reloads are chained on a single promise: React state updates make rapid
   * toggle clicks cheap, but each still queues an unload/load pair, and
   * interleaving two of those would double-load mods.
   */
  const refreshRunningSet = (): void => {
    // A built share link reflects the set at build time — close the panel
    // rather than show a link that no longer matches what's running.
    setSharePanel(null);
    const running = runningMods();
    // Re-park the mixin plan (#62). The RUNNING frame keeps the bundle it was
    // served with — if the effective patch set changed, only a reload applies
    // it, so surface the restart banner instead of pretending.
    planChainRef.current = planChainRef.current.then(async () => {
      const r = await parkUserPatchPlan(running);
      parkedFingerprintRef.current = r.fingerprint;
      planSetsRef.current = r.sets;
      setMixinOverCap(r.overCap);
      setMixinEnvSkipped(r.envSkipped);
      // #43: same for the physics plan. A physics change needs a restart for a
      // sharper reason than a mixin one — the binary is instantiated once at
      // boot, so the running sim keeps whatever constants it was built with no
      // matter what the cache now holds.
      const p = await parkPhysicsPlan(running);
      parkedPhysicsRef.current = p.fingerprint;
      setPhysicsExcluded(p.excluded);
      setNeedsRestart(
        r.fingerprint !== servedFingerprintRef.current || p.fingerprint !== servedPhysicsRef.current,
      );
    });
    const api = apiRef.current;
    if (!api || !modsLoadedRef.current) return; // frame not loaded yet; first load picks the list up
    reloadChainRef.current = reloadChainRef.current.then(async () => {
      try {
        await unloadModsRef.current?.();
        applyLoadSummary(await loadMods(api, { userMods: runningMods() }));
      } catch (e) {
        setModsStatus(`✗ ${(e as Error).message.slice(0, 48)}`);
      }
    });
  };

  /**
   * Replace the user-mod list: update state, persist, and reload the set.
   */
  const updateUserMods = (next: UserModRecord[]): void => {
    userModsRef.current = next;
    setUserMods(next);
    // The TRUE pool is what persists. Never the projection: the pool is shared
    // across instances, so writing the overlay into it would make one
    // instance's per-mod switch the global one for every other instance.
    setPersistWarning(
      saveUserMods(next)
        ? null
        : 'Storage unavailable — mods work this session but will not survive a reload.',
    );
    refreshRunningSet();
  };

  /**
   * Flip one mod's switch FOR THIS INSTANCE only.
   *
   * A different operation from the `disable` button next to it, and the copy
   * has to keep them apart: `disable` writes `record.enabled` in the shared
   * pool and turns the mod off everywhere, while this writes one id into this
   * instance's `disabledModIds` and leaves every other instance alone. Both
   * must agree for a mod to run, so this one cannot resurrect a mod the pool
   * switch turned off — the control is only offered on pool-enabled rows.
   *
   * The pool is untouched here, so `saveUserMods` is not called; the instance
   * store is what persists. Only a real change is written — a no-op returns
   * the same store by identity, so a redundant click costs nothing.
   */
  const setInstanceModDisabled = (modId: string, disabled: boolean): void => {
    const current = instanceRef.current;
    if (current === null) return;
    const store = readInstances();
    const next = setModDisabledInInstance(store, current.id, modId, disabled);
    if (next === store) return;
    const updated = findInstance(next, current.id);
    if (updated === null) return; // unreachable; the id came from `next`
    instanceRef.current = updated;
    setInstance(updated);
    if (!saveInstances(next)) {
      setPersistWarning(
        'Storage unavailable — this instance’s mod switches work this session but will not survive a reload.',
      );
    }
    log(`${disabled ? 'switched off' : 'switched on'} '${modId}' for instance '${updated.name}'`);
    refreshRunningSet();
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

  /**
   * Bind the editor registry once both halves have arrived, and report the edge
   * (#87).
   *
   * Re-attaches on every instance, unlike the tracks registry's one-shot guard.
   * The player can close the editor and open it again, and the game constructs a
   * NEW editor each time; keeping the first would leave `api.editor` pointed at a
   * disposed object that still answers calls. `reset()` clears the lifecycle's
   * de-dup memory so the fresh instance's `opened` is not swallowed as "no change".
   */
  const attachEditorIfReady = (instanceIsNew: boolean): void => {
    const accessor = editorAccessorRef.current;
    const instance = editorInstanceRef.current;
    if (!accessor || instance === null) return;
    if (instanceIsNew) {
      editor.attach({ accessor, instance });
      editorLifecycle.reset();
    }
    editorLifecycle.poll();
    setEditorStatus(editor.isOpen() === true ? '✓ open' : '✓ captured (closed)');
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
    log('game frame loaded');
    // #62: the per-mod mixin report rides INSIDE the served bundle as a
    // `window.__tspmlUserMixins` prelude — same-origin frame, read it directly.
    // Non-null plan but no global: the bundle bypassed the SW POST path
    // (transform off, SW raced, or an extension interfered) — say so honestly
    // rather than showing stale/no rows.
    const rawReport = w[REPORT_GLOBAL];
    if (isMixinReport(rawReport)) {
      setMixinReport(snapshotMixinReport(rawReport));
      setMixinNotice(null);
      const applied = rawReport.mods.reduce((n, m) => n + m.applied, 0);
      const declared = rawReport.mods.reduce((n, m) => n + m.declared, 0);
      if (declared > 0) log(`user mixins: ${applied}/${declared} applied`);
    } else {
      setMixinReport(null);
      if (planSetsRef.current > 0) {
        setMixinNotice(
          'Mixins were not applied to this game load — the bundle was served without the patch plan (transform mode off, or the service worker did not intercept).',
        );
        log('user mixins NOT applied — bundle served without the patch plan');
      }
    }
    // #98: a lazily-loaded chunk is transformed too, but it executes whenever the
    // game happens to need it — opening the editor, minutes after this handler ran.
    // Its prelude merges itself into the same global and fires CHUNK_REPORT_EVENT;
    // re-reading the (mutated) global on that signal is what carries the chunk's rows
    // into the UI. Reading the global rather than the event's `detail` keeps ONE
    // source of truth: whatever the frame actually holds, including any chunk that
    // landed between two events.
    chunkReportOffRef.current?.();
    const onChunkReport = (): void => {
      const merged = w[REPORT_GLOBAL];
      if (!isMixinReport(merged)) return;
      setMixinReport(snapshotMixinReport(merged));
      setMixinNotice(null);
    };
    w.addEventListener(CHUNK_REPORT_EVENT, onChunkReport);
    chunkReportOffRef.current = () => w.removeEventListener(CHUNK_REPORT_EVENT, onChunkReport);

    servedFingerprintRef.current = parkedFingerprintRef.current;
    servedPhysicsRef.current = parkedPhysicsRef.current;
    // A fresh frame refetches the wasm, so last frame's verdict is stale the
    // moment this one loads — clear it rather than leave a report describing a
    // binary that is no longer the one running.
    setPhysicsReport(null);
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
      editor,
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
      captureTrackEditor: (a: EditorAccessor) => {
        editorAccessorRef.current = a;
        // The accessor alone is not an editor — no instance means nothing to
        // attach yet, and the next `enable()` is what completes the pair.
        attachEditorIfReady(false);
      },
      captureTrackEditorInstance: (instance: unknown, open: boolean) => {
        const isNew = editorInstanceRef.current !== instance;
        editorInstanceRef.current = instance;
        // `open` is what the game just did, and it is also already reflected in
        // the flag the accessor reads — so the lifecycle re-reads rather than
        // trusting the argument, and the two can never drift apart.
        void open;
        attachEditorIfReady(isNew);
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
    // Load the user's stored mods via @tspml/loader — a real mod package
    // receives this api and subscribes. Per-mod failure isolation (never
    // boot-aborts). Reads the REFS (not `userMods`/`instance` state) because
    // this handler runs outside React's render cycle; both are populated by
    // mount effects that run before the SW effect that gates mounting the
    // iframe, so both are set by the time a frame loads.
    if (!modsLoadedRef.current) {
      modsLoadedRef.current = true;
      // Retaining `s.unload` (via applyLoadSummary) is load-bearing (#17): it is
      // the only handle to the loaded mods' cleanup — dropping it, which is what
      // used to happen, made every `onUnload` unreachable no matter how
      // completely the loader implemented it.
      reloadChainRef.current = reloadChainRef.current.then(async () => {
        try {
          applyLoadSummary(await loadMods(api, { userMods: runningMods() }));
        } catch (e) {
          setModsStatus(`✗ ${(e as Error).message.slice(0, 48)}`);
        }
      });
    }
  };

  /**
   * Take a validated record from the Add form's paste boxes into the pool.
   *
   * The form decided the paste was well-formed (and said so inline if not);
   * everything from here — the pool, the log, the loader — is the session's,
   * which is why the boundary is a built record rather than six draft strings.
   */
  const handleAddPasted = (rec: UserModRecord): void => {
    // Same-id adds REPLACE the stored copy (upsertUserMod) — that is how a
    // modder iterates on their mod without a remove/add dance. Deeper
    // validation (required fields, semver, duplicate ids) is the
    // loader's job; its verdict lands in the mod list with a reason.
    const next = upsertUserMod(userModsRef.current, rec);
    log(`added mod '${userModId(rec) ?? '(no id)'}' (pasted)`);
    trackModAdded(userModId(rec), 'paste');
    updateUserMods(next);
  };

  /**
   * Import a mod from a URL (#80 first slice). The fetch is the BROWSER's —
   * lib/mod-import.ts never touches /api/proxy; see its header for why that
   * boundary is load-bearing. The result is a plain UserModRecord, so from
   * here on the paste path and the import path are the same code.
   *
   * Resolves with the failure reason rather than setting it: the inline error
   * line belongs to the form, the log and the mod pool belong here.
   */
  const handleImportUrl = async (
    url: string,
  ): Promise<{ ok: true } | { ok: false; error: string }> => {
    log(`importing mod from URL…`);
    const result = await importModFromUrl(url);
    if (!result.ok) {
      log(`import failed: ${result.error.slice(0, 120)}`);
      return { ok: false, error: result.error };
    }
    const rec: UserModRecord = {
      manifest: result.mod.manifest,
      code: result.mod.code,
      ...(result.mod.mixins === undefined ? {} : { mixins: result.mod.mixins }),
      ...(result.mod.physics === undefined ? {} : { physics: result.mod.physics }),
      enabled: true,
      addedAt: new Date().toISOString(),
      // Remember where it came from — this is what "⟳ reload" re-fetches.
      sourceUrl: url,
    };
    const next = upsertUserMod(userModsRef.current, rec);
    log(
      `added mod '${userModId(rec) ?? '(no id)'}' (imported from URL${result.mod.note ? `; ${result.mod.note}` : ''})`,
    );
    trackModAdded(userModId(rec), 'url');
    updateUserMods(next);
    return { ok: true };
  };

  /**
   * Import a modpack (#80): a plain-text list of mod URLs, either pasted into
   * the box or linked as a single `.txt` URL. Sugar over the URL import and
   * nothing more — each line is one `importModFromUrl`, so every host rule and
   * cap applies per mod and a 404 on line 2 does not stop lines 1 and 3.
   *
   * No confirm step, unlike an incoming share link: a share link arrives from
   * someone else and can be opened by a click, whereas this list is something
   * the player pasted here and then pressed Import on. The unsandboxed-code
   * warning sits above the button for the same reason it sits above the others.
   */
  const handleImportPack = async (
    text: string,
  ): Promise<{ installedAny: boolean; error: string | null; notice: string | null }> => {
    const input = classifyModpackInput(text);
    let parsed: ModpackParseResult;
    if (input.kind === 'list') {
      log(`fetching modpack list…`);
      const listed = await fetchModpackList(input.url);
      if (!listed.ok) {
        log(`modpack list failed: ${listed.error.slice(0, 120)}`);
        return { installedAny: false, error: listed.error, notice: null };
      }
      parsed = listed.parsed;
    } else {
      parsed = input.parsed;
    }

    // Every refusal is named before anything installs, so the count the user
    // sees at the end has an explanation attached and they are not left
    // diffing their mod list against the file by hand.
    for (const bad of parsed.invalid) {
      log(`modpack line ${bad.line} skipped: ${bad.error.slice(0, 120)}`);
    }
    if (parsed.urls.length === 0) {
      return {
        installedAny: false,
        error:
          parsed.invalid.length > 0
            ? `no usable mod URLs — all ${parsed.invalid.length} line${parsed.invalid.length === 1 ? '' : 's'} were refused (see the Log section)`
            : 'that list has no mod URLs in it',
        notice: null,
      };
    }

    log(`importing ${parsed.urls.length} mod${parsed.urls.length === 1 ? '' : 's'} from the modpack…`);
    const { next, failed } = await importUrlList(parsed.urls, 'modpack', 'from the modpack');

    const notes: string[] = [];
    const installed = parsed.urls.length - failed.length;
    notes.push(`installed ${installed} of ${parsed.urls.length}`);
    if (failed.length > 0) notes.push(`${failed.length} failed to import`);
    if (parsed.invalid.length > 0) {
      notes.push(`${parsed.invalid.length} line${parsed.invalid.length === 1 ? '' : 's'} refused`);
    }
    if (parsed.dropped > 0) {
      notes.push(`${parsed.dropped} past the ${MODPACK_LIMITS.maxMods}-mod limit were dropped`);
    }
    const clean = failed.length === 0 && parsed.invalid.length === 0 && parsed.dropped === 0;
    if (next !== userModsRef.current) updateUserMods([...next]);
    return {
      installedAny: installed > 0,
      error: null,
      notice: clean ? null : `${notes.join(', ')} — see the Log section for each one.`,
    };
  };

  /**
   * Where an install from the in-play drawer LANDS.
   *
   * Same fetch and same pool as the launcher's target, different ending: here
   * there is a running game, so both branches finish through `updateUserMods`,
   * which unloads the current set, re-parks the mixin and physics plans, and
   * reloads. That is why these messages say the mod is running and the
   * launcher's say it loads next time — each is true where it is shown, and
   * neither would be true in the other place.
   *
   * The mod branch is `handleImportUrl` with the registry's format hint and the
   * `registry` analytics method; the pack branch is literally `handleImportPack`,
   * because a `modpack-txt` entry is a single `.txt` URL and that is precisely
   * what `classifyModpackInput` already routes to the list fetch. Reimplementing
   * either would give the drawer its own failure semantics for per-line errors,
   * which is the bug this shares its way out of.
   */
  const drawerInstallTarget: InstallTarget = {
    mod: async (url, entry) => {
      log(`installing '${entry.id}' from the catalog…`);
      const result = await importModFromUrl(url, fetch, { format: entry.format });
      if (!result.ok) {
        log(`install failed: ${result.error.slice(0, 120)}`);
        return { ok: false, error: result.error };
      }
      const rec: UserModRecord = {
        manifest: result.mod.manifest,
        code: result.mod.code,
        ...(result.mod.mixins === undefined ? {} : { mixins: result.mod.mixins }),
        ...(result.mod.physics === undefined ? {} : { physics: result.mod.physics }),
        enabled: true,
        addedAt: new Date().toISOString(),
        sourceUrl: url,
      };
      log(`added mod '${userModId(rec) ?? '(no id)'}' (installed from the catalog)`);
      trackModAdded(userModId(rec), 'registry');
      updateUserMods(upsertUserMod(userModsRef.current, rec));
      return { ok: true, message: 'installed and loaded — the game reloaded its mods' };
    },
    pack: async (url) => {
      const outcome = await handleImportPack(url);
      if (outcome.error !== null) return { ok: false, error: outcome.error };
      if (!outcome.installedAny) {
        return { ok: false, error: outcome.notice ?? 'nothing in that pack installed' };
      }
      const detail = outcome.notice === null ? '' : ` (${outcome.notice})`;
      return { ok: true, message: `installed and loaded${detail}` };
    },
  };

  const drawerInstall = useInstall(drawerInstallTarget);

  /**
   * "⟳ reload" (the reload-mods feature). Two things at once:
   * URL-imported mods are RE-FETCHED from their `sourceUrl` (the
   * modder-iterates-on-a-hosted-mod loop — same import path, same rules),
   * then the WHOLE set — pasted mods included — goes back through
   * `updateUserMods`, which unloads and reloads every mod through the loader.
   * A failed re-fetch keeps that mod's stored copy and says so; it never
   * blocks the rest of the reload.
   */
  const handleReloadMods = (): void => {
    if (reloadBusy) return;
    setReloadBusy(true);
    setReloadNotice(null);
    log('reloading mods…');
    void refreshFromSources(userModsRef.current).then((r) => {
      setReloadBusy(false);
      if (r.refetched.length > 0) {
        // Name the version each re-fetch landed on — the one fact that answers
        // "did reload actually pick up my new build?" at a glance.
        const versions = r.next
          .filter((m) => {
            const id = userModId(m);
            return id !== null && r.refetched.includes(id);
          })
          .map((m) => `${userModId(m)}@${typeof m.manifest.version === 'string' ? m.manifest.version : '?'}`);
        log(`re-fetched from source: ${versions.join(', ')}`);
        for (const id of r.refetched) trackModAdded(id, 'reload');
      }
      if (r.noSource.length > 0) log(`reloaded from the stored copy (no source URL): ${r.noSource.join(', ')}`);
      for (const f of r.failures) log(`re-fetch FAILED for '${f.id}': ${f.error.slice(0, 120)}`);
      if (r.failures.length > 0) {
        setReloadNotice(
          `kept the stored copy of ${r.failures.map((f) => f.id).join(', ')} — the re-fetch failed (${r.failures[0]!.error.slice(0, 96)})`,
        );
      }
      updateUserMods(r.next);
    });
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
        registries: [keybindsRef.current, tracks, audio, editor],
      });
    };
    window.addEventListener('pagehide', run);
    return () => {
      window.removeEventListener('pagehide', run);
      chunkReportOffRef.current?.();
      chunkReportOffRef.current = null;
      run();
    };
  }, [bus, tracks, audio, editor]);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) {
      setSwState('error');
      setSwError('Service workers are not supported in this browser.');
      return;
    }
    let cancelled = false;
    setSwState('registering');
    log('registering service worker…');
    // The service worker must be CONTROLLING this page before the game loads:
    // the game's runtime fetches (track data, leaderboard) go to kodub.com and
    // are only rewritten to /api/proxy if the SW intercepts them. On a first
    // visit the SW is registered but not yet the controller, so loading the
    // game immediately lets its track fetch escape the SW → CORS-fail →
    // "Failed to load track" (issue #9). We therefore mount the game iframe
    // only after `controllerchange` (or immediately if already controlled).
    const control = (): void => {
      if (cancelled) return;
      setSwState('active');
      log('service worker controls the page — mounting the game frame');
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
        const msg = err instanceof Error ? err.message : String(err);
        setSwError(msg);
        log(`service worker registration FAILED: ${msg}`);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // The SW's physics verdict (#43). A wasm response is a binary the game hands
  // straight to `WebAssembly.instantiate` — there is no prelude to carry a report
  // the way the bundle does, so the route states the outcome in `x-tspml-wasm-*`
  // headers, only the SW can read them, and it forwards them here.
  //
  // Bound unconditionally rather than inside the registration effect above: the
  // wasm is fetched ~13s into boot and this page can be controlled by an ALREADY
  // active worker, in which case `controllerchange` never fires.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const onMessage = (e: MessageEvent): void => {
      const report = asPhysicsReport(e.data);
      if (report === null) return;
      setPhysicsReport(report);
      log(
        `physics: ${report.status} for ${report.file}${
          report.applied > 0 ? ` (${report.applied} patch${report.applied === 1 ? '' : 'es'})` : ''
        }${report.detail ? ` — ${report.detail}` : ''}`,
      );
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- log only touches its stable setter
  }, []);

  const bootDoneCount = bootSteps.filter((s) => s.done).length;

  return (
    <main className={isTheater ? 'app theater' : 'app'}>
      <header className="topbar">
        <div className="brand">
          {/* The wordmark is the way home: same plain <a> (not next/link) as
              the Launcher link beside it, for the same reason — leaving the
              game is a real navigation that tears the iframe down honestly. */}
          <a className="brand-home" href="/" title="Back to the launcher">
            {/* eslint-disable-next-line @next/next/no-img-element -- a 22px
                static SVG; next/image adds nothing here. */}
            <img src="/logo.svg" alt="" className="brand-logo" />
            <h1>TSPML</h1>
          </a>
          {/* The instance name replaces the tagline rather than joining it:
              once you have launched something, which thing you launched is the
              more useful label, and the topbar wraps on narrow screens. Its
              picture rides along, so the launcher's identity for this profile
              follows it into the game rather than stopping at the front door. */}
          {instance === null ? null : (
            <InstanceTile name={instance.name} icon={instance.icon ?? null} size={22} />
          )}
          <span className="brand-sub">
            {instanceName ?? 'play PolyTrack with mods'}
          </span>
        </div>
        <div className="topbar-side">
          {/* A plain <a>, not next/link: leaving the game is a real navigation
              and a full document load is exactly right here — it tears the
              iframe down rather than leaving a WebGL context alive behind a
              client-side route change. */}
          <a className="docs-link" href="/">
            Launcher
          </a>
          <a
            className="docs-link"
            href="https://tspml-docs.vercel.app"
            target="_blank"
            rel="noreferrer"
          >
            Docs <Icon name="external" />
          </a>
          <ServiceWorkerBadge state={swState} error={swError} />
        </div>
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
                {/* Opens the Mods menu OVER the stage — every mod surface that
                    used to be the split-screen sidebar. Deliberately not a link:
                    any navigation unmounts this iframe and ends the run. */}
                <button
                  type="button"
                  className="stage-btn mods-btn"
                  onClick={() => setMenuOpen((m) => !m)}
                  aria-expanded={menuOpen}
                  aria-controls="mods-menu"
                  title={menuOpen ? 'Close the mod manager' : 'Manage mods'}
                >
                  <Icon name="pencil" /> Mods
                </button>
                {/* Opens the catalog OVER the stage. Deliberately not a link to
                    /browse: that navigation unmounts this iframe and ends the
                    run. Lives here rather than in the sidebar because the
                    sidebar's DOM order is asserted by five smokes. */}
                <button
                  type="button"
                  className="stage-btn browse-btn"
                  onClick={() => setBrowseOpen((b) => !b)}
                  aria-expanded={browseOpen}
                  title="Browse the catalog without leaving the game"
                >
                  <Icon name="grid" /> Browse
                </button>
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
                  {isTheater ? (
                    <>
                      <Icon name="shrink" /> Shrink
                    </>
                  ) : (
                    <>
                      <Icon name="expand" /> Expand
                    </>
                  )}
                </button>
                <button
                  type="button"
                  className="stage-btn fs-btn"
                  onClick={toggleFullscreen}
                  title={isFullscreen ? 'Exit fullscreen (Esc works too)' : 'Play fullscreen'}
                >
                  {/* smoke-ui asserts /exit/i on this label in fullscreen. */}
                  {isFullscreen ? (
                    <>
                      <Icon name="minimize" /> Exit
                    </>
                  ) : (
                    <>
                      <Icon name="maximize" /> Fullscreen
                    </>
                  )}
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
                            {s.done ? (
                              <Icon name="check" />
                            ) : active ? (
                              <Icon name="spinner" className="icon-spin" />
                            ) : (
                              <Icon name="dot" />
                            )}
                          </span>
                          {s.label}
                        </li>
                      );
                    })}
                  </ol>
                  {/* Latest boot-log line — the answer to "what is it doing?"
                      while the bar sits on a step. Full log lives in the
                      sidebar's Log section. */}
                  {bootLog.length > 0 && !bootDone ? (
                    <div className="boot-log" aria-hidden="true">
                      <div className="boot-log-line">
                        {bootLog[bootLog.length - 1]?.msg}
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          ) : null}
        </section>

        {/* The catalog, over the stage. A SIBLING of section.stage and inside
            div.content on purpose: anywhere else means either a route change or
            a re-parent, and both unmount the iframe and end the run. */}
        <BrowseDrawer
          open={browseOpen}
          onClose={() => setBrowseOpen(false)}
          install={drawerInstall}
        />

        {/* The Mods menu: everything that used to be the permanent sidebar,
            now one overlay panel opened from the stage's Mods button. Same
            sibling-of-stage placement as the browse drawer — opening it can
            never re-parent or unmount the game iframe. `hidden` when closed
            keeps its DOM present for the smokes that read the aside without
            opening it first, and matches the drawer's close/reopen semantics.
            role="dialog" + aria-modal="false" like BrowseDrawer: it is an
            overlay, but the game stays visible and running behind it. */}
        <aside
          id="mods-menu"
          className="mods-menu"
          role="dialog"
          aria-modal="false"
          aria-label="Mods"
          hidden={!menuOpen}
        >
          {/* Smoke contract: several smokes click this aside's FIRST summary
              blind to open the Add form — no other summary may precede it.
              The header's close control is a BUTTON, so it cannot steal that
              slot; a <details> summary up here would break three smokes. */}
          <div className="mods-menu-head">
            <h2>Mods</h2>
            <button
              type="button"
              className="btn btn-small"
              onClick={() => setMenuOpen(false)}
              title="Close the mod manager (Esc works too)"
            >
              <Icon name="close" /> Close
            </button>
          </div>

          {/* Incoming share link: the confirm-first panel. It lists every link
              and does NOTHING until "Import" is clicked — mod code runs
              unsandboxed, so a share URL must never auto-run anything. Links
              the import rules refused are shown too (with the reason), so a
              doctored URL fails loudly instead of silently shrinking. */}
          {sharePrompt ? (
            <div className="share-prompt">
              <div className="share-prompt-title">
                This link shares {sharePrompt.urls.length} mod{sharePrompt.urls.length === 1 ? '' : 's'}
              </div>
              {sharePrompt.urls.length > 0 ? (
                <>
                  <p className="meta">
                    Nothing imports until you confirm. Mod code runs unsandboxed —
                    only import from authors you trust.
                  </p>
                  <ul className="share-url-list">
                    {sharePrompt.urls.map((u) => (
                      <li key={u}>
                        <code>{u}</code>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
              {sharePrompt.invalid.length > 0 ? (
                <p className="warn">
                  <Icon name="warn" /> {sharePrompt.invalid.length} link{sharePrompt.invalid.length === 1 ? ' was' : 's were'} refused
                  by the import rules and will be skipped:{' '}
                  {sharePrompt.invalid.map((x) => `${x.url.slice(0, 64)} (${x.error.slice(0, 64)})`).join('; ')}
                </p>
              ) : null}
              {sharePrompt.dropped > 0 ? (
                <p className="warn">
                  <Icon name="warn" /> {sharePrompt.dropped} link{sharePrompt.dropped === 1 ? '' : 's'} past the {SHARE_LIMITS.maxMods}-mod
                  cap were dropped.
                </p>
              ) : null}
              <div className="share-prompt-actions">
                {sharePrompt.urls.length > 0 ? (
                  <button
                    type="button"
                    className="btn btn-primary share-import-btn"
                    disabled={shareImportBusy}
                    onClick={handleShareImport}
                  >
                    {shareImportBusy
                      ? 'Importing…'
                      : `Import ${sharePrompt.urls.length} mod${sharePrompt.urls.length === 1 ? '' : 's'}`}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn btn-small"
                  disabled={shareImportBusy}
                  onClick={() => {
                    setSharePrompt(null);
                    log('share link dismissed — nothing was imported');
                  }}
                >
                  dismiss
                </button>
              </div>
            </div>
          ) : null}

          {/* The restart banner leads the sidebar: it is the one thing here that
              asks the user to act, and it must not hide below the fold. */}
          {/* Smoke contract: the /need a restart/ text and the "reload now"
              button label are both asserted by smoke-user-mods. */}
          {needsRestart ? (
            <div className="restart-banner">
              <Icon name="warn" /> Mixin changes need a restart —{' '}
              <button type="button" className="btn btn-small" onClick={() => window.location.reload()}>
                reload now
              </button>
            </div>
          ) : null}

          <section className="side-section">
            {/* The shelf owns the library's presentation and nothing else:
                every switch below calls back into the session cluster here,
                which is what keeps the pool the single source of truth. The
                share panel and the reload/share notices ride in as `notices`
                so they stay between the header and the list, where they were.
                See ModShelf's header for the smoke contracts it preserves. */}
            <ModShelf
              mods={userMods}
              instanceName={instanceName}
              isOffHere={(modId) => isDisabledInInstance(instance, modId)}
              reloadBusy={reloadBusy}
              onShare={handleShare}
              onReload={handleReloadMods}
              onSetEnabled={(targets, enabled) =>
                updateUserMods(
                  userModsRef.current.map((m) => (targets.includes(m) ? { ...m, enabled } : m)),
                )
              }
              onSetOffHere={setInstanceModDisabled}
              onRemove={(targets) =>
                updateUserMods(userModsRef.current.filter((m) => !targets.includes(m)))
              }
              // Undo goes back through `upsertUserMod` rather than a plain
              // append: between the remove and the undo the same id could have
              // been re-imported, and two records answering to one id is a
              // state the loader has no way to resolve.
              onRestore={(targets) =>
                updateUserMods(
                  targets.reduce<UserModRecord[]>((acc, r) => upsertUserMod(acc, r), [
                    ...userModsRef.current,
                  ]),
                )
              }
              notices={
                <>
                  {/* The built share link: shown in full with its own copy
                      button — the link is the ground truth, the copy is a
                      convenience. */}
                  {sharePanel?.url ? (
                    <div className="share-panel">
                      <div className="share-panel-row">
                        <code className="share-panel-url">{sharePanel.url}</code>
                        <button
                          type="button"
                          className="btn btn-small share-copy-btn"
                          title="Copy the share link to the clipboard"
                          onClick={handleShareCopy}
                        >
                          {shareCopied ? (
                            <>
                              <Icon name="check" /> copied
                            </>
                          ) : (
                            <>
                              <Icon name="copy" /> copy
                            </>
                          )}
                        </button>
                        <button
                          type="button"
                          className="btn btn-small"
                          title="Close"
                          onClick={() => setSharePanel(null)}
                        >
                          <Icon name="close" />
                        </button>
                      </div>
                      <p className="meta">
                        {sharePanel.included.length} mod{sharePanel.included.length === 1 ? '' : 's'} —
                        links only, never code; the recipient confirms first.
                        {sharePanel.noSource.length > 0
                          ? ` Pasted mods can’t ride a link: ${sharePanel.noSource.join(', ')} left out.`
                          : ''}
                      </p>
                    </div>
                  ) : null}
                  {shareNotice ? <p className="meta share-notice">{shareNotice}</p> : null}
                  {reloadNotice ? (
                    <p className="warn">
                      <Icon name="warn" /> {reloadNotice}
                    </p>
                  ) : null}
                </>
              }
            />
            {persistWarning ? (
              <p className="warn">
                <Icon name="warn" /> {persistWarning}
              </p>
            ) : null}
            {/* Smoke contract: "manifest declares mixins" must appear within
                80 chars of the mod id (smoke-user-mods leg 2). */}
            {mixinsSkipped.length > 0 ? (
              <p className="warn">
                <Icon name="warn" /> <code>{mixinsSkipped.join(', ')}</code>: manifest declares
                mixins but no <code>mixins.json</code> was pasted — not applied.
                Re-add the mod with its <code>mixins.json</code>; the entrypoint still runs.
              </p>
            ) : null}
            {mixinOverCap.length > 0 ? (
              <p className="warn">
                <Icon name="warn" /> <code>{mixinOverCap.join(', ')}</code>: mixins exceed the
                per-request limits and were left out of the patch plan.
              </p>
            ) : null}
            {mixinEnvSkipped.length > 0 ? (
              <p className="warn">
                <Icon name="warn" /> <code>{mixinEnvSkipped.join(', ')}</code>: mixins target a
                different environment (this portal is <code>web</code>) — not applied.
              </p>
            ) : null}
            {/* #43. The same gap as mixinsSkipped, said separately because the
                consequence differs: the mod loads and looks fine while its
                handling changes are simply absent. */}
            {physicsSkipped.length > 0 ? (
              <p className="warn">
                <Icon name="warn" /> <code>{physicsSkipped.join(', ')}</code>: manifest declares
                a <code>physics.json</code> but none was pasted — the physics binary is
                unpatched. The mod still runs; its handling changes do not.
              </p>
            ) : null}
            {physicsExcluded.map((x) => (
              <p className="warn" key={`${x.modId}:${x.reason}`}>
                <Icon name="warn" /> <code>{x.modId}</code>: physics patches left out
                ({x.reason}) — {x.detail}.
              </p>
            ))}

            {/* The Add form owns its drafts and nothing else; see its header for
                the DOM contracts the smokes hold it to. It must stay HERE — the
                aside's first <summary> — and server-rendered, or #118's
                pre-hydration adoption has no markup to adopt from. */}
            <AddModForm
              onAddPasted={handleAddPasted}
              onImportUrl={handleImportUrl}
              onImportPack={handleImportPack}
            />
          </section>

          {mixinNotice || (mixinReport && mixinReport.mods.length > 0) ? (
            <section className="side-section">
              <h2>Your mixins</h2>
              {mixinNotice ? (
                <p className="warn">
                  <Icon name="warn" /> {mixinNotice}
                </p>
              ) : null}
              {mixinReport && mixinReport.mods.length > 0 ? (
                <>
                  {/* #98: one block PER SERVED FILE (main, then each lazily-loaded
                      chunk that has landed so far). Chunk blocks appear mid-session,
                      when the game first loads that chunk. The heading is shown only
                      once a chunk exists — with main alone the layout is the pre-#98
                      one, so nothing new is asked of the common case. */}
                  {surfaceReports(mixinReport).map((s, si, all) => (
                    <div key={s.file}>
                      {all.length > 1 ? (
                        <p className="meta">
                          <code>{s.file}</code>
                          {si === 0 ? ' (main bundle)' : ' (loaded on demand)'}
                        </p>
                      ) : null}
                      {s.report.planStatus !== 'applied' ? (
                        <p className="warn">
                          <Icon name="warn" /> plan {s.report.planStatus} — no user mixin was applied.
                        </p>
                      ) : null}
                      <ul className="rows">
                        {s.report.mods.map((m) => {
                          // A mixin anchored inside a chunk is attempted on EVERY
                          // surface, so 0/1 here while it applied elsewhere is the
                          // expected reading, not a failure. Say where it did land
                          // instead of leaving a red pill to be misread.
                          const elsewhere =
                            m.applied === 0 ? modAppliedOn(all, m.modId, s.file) : [];
                          return (
                            <li key={m.modId}>
                              <div className="row-head">
                                <code>{m.modId}</code>
                                <span
                                  className="status-pill"
                                  style={{
                                    color:
                                      m.applied === m.declared
                                        ? 'var(--green)'
                                        : m.applied > 0
                                          ? 'var(--amber)'
                                          : elsewhere.length > 0
                                            ? 'var(--muted)'
                                            : 'var(--red)',
                                  }}
                                >
                                  {m.applied}/{m.declared} applied
                                </span>
                              </div>
                              {elsewhere.length > 0 ? (
                                <div className="meta">applied on {elsewhere.join(', ')}</div>
                              ) : (
                                m.failed.map((f, i) => (
                                  <div key={i} className="meta">
                                    <Icon name="error" /> {f.reason}: {f.detail.slice(0, 96)}
                                  </div>
                                ))
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                </>
              ) : null}
            </section>
          ) : null}

          {/* #43. Shown only once there is something to say — a session with no
              physics mod should not carry a section explaining a feature it is
              not using. `physicsNotice` covers the cache being unavailable;
              `physicsReport` is the route's verdict, relayed by the SW. */}
          {physicsNotice || physicsReport ? (
            <section className="side-section">
              <h2>Physics</h2>
              {physicsNotice ? (
                <p className="warn">
                  <Icon name="warn" /> {physicsNotice}
                </p>
              ) : null}
              {physicsReport ? (
                <>
                  <div className="row-head">
                    <code>{physicsReport.file}</code>
                    <span
                      className="status-pill"
                      style={{
                        color:
                          physicsReport.status === 'patched'
                            ? 'var(--green)'
                            : physicsReport.status === 'vanilla'
                              ? 'var(--muted)'
                              : 'var(--red)',
                      }}
                    >
                      {physicsReport.status}
                    </span>
                  </div>
                  {physicsReport.status === 'patched' ? (
                    <p className="meta">
                      {physicsReport.applied} constant{physicsReport.applied === 1 ? '' : 's'} rewritten
                      — lap times from this session are not vanilla.
                    </p>
                  ) : null}
                  {/* Every non-patched outcome that is not plain vanilla is a
                      REFUSAL, and each has a fix the author can act on: re-pin
                      against this build, or drop the patch. Say the route's own
                      words rather than a paraphrase. */}
                  {physicsReport.detail && physicsReport.status !== 'patched' ? (
                    <p className="warn">
                      <Icon name="warn" /> {physicsReport.detail}
                    </p>
                  ) : null}
                </>
              ) : null}
            </section>
          ) : null}

          <section className="side-section">
            <h2>Loaded mods</h2>
            <ul className="rows mod-cards">
              {loadedMods.length === 0 ? (
                <li>
                  {/* Smoke contract: 'loading…'/'waiting for game…' are the
                      placeholder strings smoke.mjs greps to prove the list
                      populated. */}
                  <div className="meta">
                    {modsStatus !== '…'
                      ? 'none — add a mod above'
                      : swState === 'active'
                        ? 'loading…'
                        : 'waiting for game…'}
                  </div>
                </li>
              ) : (
                loadedMods.map((mod) => (
                  /* Smoke contract (smoke.mjs): per row, <code> is the mod id and
                     the FIRST <span> is the status — the tile is an <i> and the
                     body a <div> so the status-pill keeps that slot. */
                  <li key={mod.id} className={mod.status === 'loaded' ? 'mod-card' : 'mod-card mod-card-failed'}>
                    {/* Every loaded mod IS a user mod (no bundled demos), so
                        its icon comes from the stored record with the same id. */}
                    <ModTile
                      id={mod.id}
                      icon={(() => {
                        const rec = userMods.find((m) => userModId(m) === mod.id);
                        return rec ? userModIcon(rec) : null;
                      })()}
                    />
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
                : 'idle'}
            </div>
            <div className="status-row">
              <span
                className="dot"
                style={{ background: keybindCount > 0 ? 'var(--green)' : 'var(--muted)' }}
                aria-hidden="true"
              />
              registry:{' '}
              {keybindCount > 0 ? `keybind F × ${keybindCount}` : 'idle'}
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
            <div className="status-row">
              <span
                className="dot"
                style={{ background: editorStatus.startsWith('✓') ? 'var(--green)' : 'var(--muted)' }}
                aria-hidden="true"
              />
              editor: {editorStatus}
            </div>
          </section>

          <section className="side-section">
            <h2>Log</h2>
            {/* Everything TSPML did this session, in order — the full version
                of the tail the boot overlay shows. Session-only, last 200
                lines. Collapsed by default; the smokes never open it, and its
                lines are timestamp-prefixed so they can't collide with the
                `mods:`/`safety:` line-anchored assertions. */}
            <details className="log-details">
              <summary>
                {bootLog.length} event{bootLog.length === 1 ? '' : 's'} this session
              </summary>
              <div className="log-box">
                {bootLog.map((l, i) => (
                  <div key={`${l.t}-${i}`} className="log-line">
                    <span className="log-time">{l.t}</span> {l.msg}
                  </div>
                ))}
              </div>
            </details>
          </section>

          <footer className="side-footer">
            TSPML is a fan-made tool and is not affiliated with Kodub. It never
            redistributes PolyTrack; the portal transforms your own live copy
            of the game.
          </footer>
        </aside>
      </div>
    </main>
  );
}


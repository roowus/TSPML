'use client';

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactElement } from 'react';
import { Audio, EventBus, Keybinds, Tracks } from '@tspml/api-bridge';
import type { GameAudioManager, GameTrackCodec, GameTrackManager } from '@tspml/api-bridge';
import type { TspmlApi } from '@tspml/api';
import { readEarlyCaptures } from '@tspml/shared';
import { loadMods } from '@/lib/mod-loader';
import type { ModLoadSummary } from '@/lib/mod-loader';
import {
  parseMixinsJson,
  readUserMods,
  saveUserMods,
  upsertUserMod,
  userModDocs,
  userModHomepage,
  userModIcon,
  userModId,
} from '@/lib/user-mods';
import type { UserModRecord } from '@/lib/user-mods';
import { importModFromUrl } from '@/lib/mod-import';
import { refreshFromSources } from '@/lib/mod-reload';
import { buildShareUrl, parseShareUrls, SHARE_LIMITS, SHARE_PARAM } from '@/lib/mod-share';
import type { ShareBuildResult, ShareParseResult } from '@/lib/mod-share';
import { Icon } from './icons';
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
 * Play page.
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

// The stage/sidebar split. The width is persisted so a chosen layout survives
// reloads; the clamp keeps both panes usable (the sidebar's content needs
// ~260px before it wraps badly; past 640px the game pane starves on a laptop).
const SIDEBAR_WIDTH_KEY = 'tspml.sidebarWidth.v1';
const SIDEBAR_DEFAULT_WIDTH = 340;
const SIDEBAR_MIN_WIDTH = 260;
const SIDEBAR_MAX_WIDTH = 640;

function clampSidebarWidth(w: number): number {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(w)));
}

interface LoadedModRow {
  id: string;
  status: 'loaded' | 'failed';
  reason?: string;
}

/**
 * The mod card's 30×30 tile: the manifest's icon image when one is set (and
 * loads), the id's first letter otherwise. The element stays an `<i>` — the
 * smoke contract needs each row's FIRST `<span>` to be the status pill, and an
 * `<img>` inside the `<i>` keeps that true.
 *
 * `icon` has already been through {@link userModIcon} (http(s)/data:image
 * only), so this never renders an author-controlled string anywhere scriptable.
 * A broken image (404, wrong type, blocked by the host) swaps back to the
 * letter via onError instead of showing the browser's broken-image glyph;
 * the error state resets when the icon URL changes so a fixed URL retries.
 */
function ModTile({ id, icon }: { id: string; icon: string | null }): ReactElement {
  const [failedIcon, setFailedIcon] = useState<string | null>(null);
  const showImg = icon !== null && icon !== failedIcon;
  return (
    <i className="mod-tile" aria-hidden="true">
      {showImg ? (
        // eslint-disable-next-line @next/next/no-img-element -- arbitrary
        // author-hosted origins; next/image needs a domain allowlist.
        <img src={icon} alt="" onError={() => setFailedIcon(icon)} />
      ) : (
        id.replace(/^tspml-/, '').charAt(0).toUpperCase() || 'M'
      )}
    </i>
  );
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
  // The stage/sidebar split, draggable via the resizer bar between them.
  // Rides a CSS custom property on .content (never an inline width on the
  // aside) so the ≤900px stacked layout's `width: auto` still wins — an inline
  // style would override the media query and wedge the phone layout.
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT_WIDTH);
  const sidebarDragRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);
  // Boot progress plumbing: the stage shows a step list until every TSPML boot
  // stage lands (SW controls the page → mixin plan parked → game bundle loaded
  // → mods loaded), then fades. `frameLoaded` flips in handleFrameLoad;
  // `bootHidden` unmounts the overlay shortly after the fade completes.
  const [frameLoaded, setFrameLoaded] = useState(false);
  const [bootHidden, setBootHidden] = useState(false);
  // Which add-a-mod method is selected. "paste" and "url" work today; "id"
  // (mod/modpack ids from a registry backend) is the announced next slice of
  // #80, so the dropdown already teaches the model of "several ways".
  const [addMethod, setAddMethod] = useState<'paste' | 'url' | 'id'>('paste');
  const [draftUrl, setDraftUrl] = useState('');
  const [importBusy, setImportBusy] = useState(false);
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
  // Which mod row's source viewer is open (by mod id). A button-toggled panel,
  // NOT a <details>: the smokes click the aside's FIRST <summary> expecting the
  // Add form's, and a per-row summary would steal that slot.
  const [sourceOpenId, setSourceOpenId] = useState<string | null>(null);
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

  // Restore the dragged stage/sidebar split — client-only (localStorage does
  // not exist during SSR/prerender, and reading it in useState's initializer
  // would also hydration-mismatch the server-rendered CSS var).
  useEffect(() => {
    try {
      const stored = Number(window.localStorage.getItem(SIDEBAR_WIDTH_KEY));
      if (Number.isFinite(stored) && stored > 0) setSidebarWidth(clampSidebarWidth(stored));
    } catch {
      // Storage blocked — the default width is fine.
    }
  }, []);

  /**
   * Drag-to-resize for the stage/sidebar split. Pointer events + capture on
   * the handle itself: the iframe next door swallows mouse events the moment
   * the pointer crosses into it, so without `setPointerCapture` every drag
   * dies at the frame edge. The bar sits to the sidebar's LEFT, so dragging
   * left (negative dx) grows the sidebar.
   */
  const onResizeStart = (e: ReactPointerEvent<HTMLDivElement>): void => {
    e.preventDefault();
    sidebarDragRef.current = { pointerId: e.pointerId, startX: e.clientX, startWidth: sidebarWidth };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onResizeMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = sidebarDragRef.current;
    if (!drag || e.pointerId !== drag.pointerId) return;
    setSidebarWidth(clampSidebarWidth(drag.startWidth - (e.clientX - drag.startX)));
  };
  const onResizeEnd = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = sidebarDragRef.current;
    if (!drag || e.pointerId !== drag.pointerId) return;
    sidebarDragRef.current = null;
    setSidebarWidth((w) => {
      try {
        window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(w));
      } catch {
        // Best-effort persistence, like the mod list's.
      }
      return w;
    });
  };
  const onResizeKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    // Keyboard operability for the separator (role="separator" contract):
    // arrows nudge the split; Home/End jump to the extremes.
    const step = 24;
    const next =
      e.key === 'ArrowLeft'
        ? sidebarWidth + step
        : e.key === 'ArrowRight'
          ? sidebarWidth - step
          : e.key === 'Home'
            ? SIDEBAR_MAX_WIDTH
            : e.key === 'End'
              ? SIDEBAR_MIN_WIDTH
              : null;
    if (next === null) return;
    e.preventDefault();
    const w = clampSidebarWidth(next);
    setSidebarWidth(w);
    try {
      window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(w));
    } catch {
      // Best-effort.
    }
  };

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
      log(
        r.sets > 0
          ? `mixin plan parked (${r.sets} mod${r.sets === 1 ? '' : 's'} with patches)`
          : 'mixin plan parked (empty — no user mixins)',
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
    const r = buildShareUrl(userModsRef.current, window.location.href);
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
   * The confirm step for an incoming share link. Each link goes through
   * `importModFromUrl` — the browser's own fetch, same host rules and caps as
   * the Add form's URL import — sequentially, so the log reads in order and a
   * slow host can't interleave upserts. One `updateUserMods` at the end: a
   * single unload/reload of the whole set instead of N.
   */
  const handleShareImport = (): void => {
    const prompt = sharePrompt;
    if (!prompt || shareImportBusy) return;
    setShareImportBusy(true);
    log(`importing ${prompt.urls.length} mod${prompt.urls.length === 1 ? '' : 's'} from the share link…`);
    void (async () => {
      let next = userModsRef.current;
      const failed: string[] = [];
      for (const url of prompt.urls) {
        const result = await importModFromUrl(url);
        if (!result.ok) {
          failed.push(url);
          log(`share import failed for ${url.slice(0, 80)}: ${result.error.slice(0, 120)}`);
          continue;
        }
        const rec: UserModRecord = {
          manifest: result.mod.manifest,
          code: result.mod.code,
          ...(result.mod.mixins === undefined ? {} : { mixins: result.mod.mixins }),
          enabled: true,
          addedAt: new Date().toISOString(),
          sourceUrl: url,
        };
        next = upsertUserMod(next, rec);
        log(`added mod '${userModId(rec) ?? '(no id)'}' (from the share link)`);
      }
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
    // A built share link reflects the set at build time — close the panel
    // rather than show a link that no longer matches what's enabled.
    setSharePanel(null);
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
    log('game frame loaded');
    // #62: the per-mod mixin report rides INSIDE the served bundle as a
    // `window.__tspmlUserMixins` prelude — same-origin frame, read it directly.
    // Non-null plan but no global: the bundle bypassed the SW POST path
    // (transform off, SW raced, or an extension interfered) — say so honestly
    // rather than showing stale/no rows.
    const rawReport = w[REPORT_GLOBAL];
    if (isMixinReport(rawReport)) {
      setMixinReport(rawReport);
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
    // Load the user's stored mods via @tspml/loader — a real mod package
    // receives this api and subscribes. Per-mod failure isolation (never
    // boot-aborts). Reads `userModsRef` (not `userMods` state)
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
    // validation (required fields, semver, duplicate ids) is the
    // loader's job; its verdict lands in the mod list with a reason.
    const next = upsertUserMod(userModsRef.current, rec);
    setAddError(null);
    setDraftManifest('');
    setDraftCode('');
    setDraftMixins('');
    log(`added mod '${userModId(rec) ?? '(no id)'}' (pasted)`);
    updateUserMods(next);
  };

  /**
   * Import a mod from a URL (#80 first slice). The fetch is the BROWSER's —
   * lib/mod-import.ts never touches /api/proxy; see its header for why that
   * boundary is load-bearing. The result is a plain UserModRecord, so from
   * here on the paste path and the import path are the same code.
   */
  const handleImportUrl = (): void => {
    const url = draftUrl.trim();
    if (url.length === 0) {
      setAddError('paste a URL first — a mod.json link or a single built .js file');
      return;
    }
    setImportBusy(true);
    setAddError(null);
    log(`importing mod from URL…`);
    void importModFromUrl(url).then((result) => {
      setImportBusy(false);
      if (!result.ok) {
        setAddError(result.error);
        log(`import failed: ${result.error.slice(0, 120)}`);
        return;
      }
      const rec: UserModRecord = {
        manifest: result.mod.manifest,
        code: result.mod.code,
        ...(result.mod.mixins === undefined ? {} : { mixins: result.mod.mixins }),
        enabled: true,
        addedAt: new Date().toISOString(),
        // Remember where it came from — this is what "⟳ reload" re-fetches.
        sourceUrl: url,
      };
      const next = upsertUserMod(userModsRef.current, rec);
      setDraftUrl('');
      log(
        `added mod '${userModId(rec) ?? '(no id)'}' (imported from URL${result.mod.note ? `; ${result.mod.note}` : ''})`,
      );
      updateUserMods(next);
    });
  };

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

  const bootDoneCount = bootSteps.filter((s) => s.done).length;

  return (
    <main className={isTheater ? 'app theater' : 'app'}>
      <header className="topbar">
        <div className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element -- a 22px
              static SVG; next/image adds nothing here. */}
          <img src="/logo.svg" alt="" className="brand-logo" />
          <h1>TSPML</h1>
          <span className="brand-sub">play PolyTrack with mods</span>
        </div>
        <div className="topbar-side">
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

      <div
        className="content"
        style={{ '--sidebar-width': `${sidebarWidth}px` } as CSSProperties}
      >
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

        {/* Drag handle for the stage/sidebar split. A plain div with the
            separator role (not a button — it is not activatable, it is
            draggable). Hidden by CSS in the ≤900px stacked layout, where a
            horizontal split has no meaning, and painted over in theater mode
            like the rest of the chrome. */}
        <div
          className="content-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize the game / mod manager split"
          aria-valuemin={SIDEBAR_MIN_WIDTH}
          aria-valuemax={SIDEBAR_MAX_WIDTH}
          aria-valuenow={sidebarWidth}
          tabIndex={0}
          title="Drag to resize (arrow keys work too); double-click to reset"
          onPointerDown={onResizeStart}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeEnd}
          onPointerCancel={onResizeEnd}
          onKeyDown={onResizeKeyDown}
          onDoubleClick={() => {
            setSidebarWidth(SIDEBAR_DEFAULT_WIDTH);
            try {
              window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(SIDEBAR_DEFAULT_WIDTH));
            } catch {
              // Best-effort.
            }
          }}
        />

        <aside className="sidebar" aria-label="Mods">
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
            <div className="section-head">
              <h2>Your mods</h2>
              {/* Reload = re-fetch URL-imported mods from their source, then
                  re-run the whole set through the loader. Entrypoint changes
                  apply live; mixin changes raise the restart banner as usual.
                  Rendered only with mods present — a reload of nothing is
                  noise, and the smokes' empty-store boot stays button-free. */}
              {userMods.length > 0 ? (
                <span className="row-buttons">
                  <button
                    type="button"
                    className="btn btn-small"
                    title="Build a link that carries your enabled URL-imported mods (links only, never code) — whoever opens it is asked before anything imports"
                    onClick={handleShare}
                  >
                    <Icon name="share" /> share
                  </button>
                  <button
                    type="button"
                    className="btn btn-small"
                    disabled={reloadBusy}
                    title="Re-fetch URL-imported mods from their source and reload every mod"
                    onClick={handleReloadMods}
                  >
                    <Icon name="refresh" className={reloadBusy ? 'icon-spin' : undefined} />{' '}
                    {reloadBusy ? 'reloading…' : 'reload'}
                  </button>
                </span>
              ) : null}
            </div>
            {/* The built share link: shown in full with its own copy button —
                the link is the ground truth, the copy is a convenience. */}
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
            {userMods.length === 0 ? (
              <p className="meta">None yet — add one below.</p>
            ) : (
              <ul className="rows mod-cards">
                {userMods.map((mod, i) => {
                  const id = userModId(mod) ?? `(no id #${i + 1})`;
                  const version = typeof mod.manifest.version === 'string' ? mod.manifest.version : null;
                  const homepage = userModHomepage(mod);
                  const docs = userModDocs(mod);
                  return (
                    <li key={id} className={mod.enabled ? 'mod-card' : 'mod-card mod-card-off'}>
                      {/* The tile and body wrapper are <i>/<div> on purpose so a
                          row's FIRST <span> is the status pill — same shape as
                          the Loaded-mods rows the smoke reads. */}
                      <ModTile id={id} icon={userModIcon(mod)} />
                      {/* Card structure, top to bottom: (1) id + on/off pill,
                          (2) facts line (version · mixins), (3) origin on its
                          own single line (truncated, full URL in the title —
                          a wrapping URL is what made these cards unreadable),
                          (4) the action buttons in a row of their own so they
                          never fight a long id for space. */}
                      <div className="mod-card-body">
                        <div className="row-head">
                          <code title={id}>{id}</code>
                          <span className={mod.enabled ? 'status-pill pill-on' : 'status-pill pill-off'}>
                            {mod.enabled ? 'enabled' : 'disabled'}
                          </span>
                        </div>
                        {version || mod.mixins ? (
                          <div className="meta">
                            {version ? `v${version}` : ''}
                            {version && mod.mixins ? ' · ' : ''}
                            {mod.mixins ? `${mod.mixins.length} mixin${mod.mixins.length === 1 ? '' : 's'}` : ''}
                          </div>
                        ) : null}
                        {/* Where the mod came from — the origin "⟳ reload" re-fetches
                            (URL imports) or the honest "this browser only" for pastes. */}
                        <div className="meta origin" title={mod.sourceUrl ?? 'Added by pasting — the only copy is this browser’s storage'}>
                          <Icon name="link" />
                          {mod.sourceUrl ? (
                            <a href={mod.sourceUrl} target="_blank" rel="noreferrer">
                              {mod.sourceUrl}
                            </a>
                          ) : (
                            <span className="origin-text">pasted (this browser only)</span>
                          )}
                        </div>
                        <div className="row-buttons mod-actions">
                          <button
                            type="button"
                            className="btn btn-small"
                            title="Show this mod's stored manifest, code, and mixins"
                            onClick={() => setSourceOpenId((cur) => (cur === id ? null : id))}
                          >
                            <Icon name="code" /> {sourceOpenId === id ? 'hide source' : 'source'}
                          </button>
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
                            onClick={() => {
                              setSourceOpenId((cur) => (cur === id ? null : cur));
                              updateUserMods(userModsRef.current.filter((m) => m !== mod));
                            }}
                          >
                            remove
                          </button>
                          {/* "docs" opens the manifest's dedicated `docs` URL —
                              usage documentation, NOT the repo. `homepage`
                              (typically the repo) gets its own honestly-named
                              "site" link. Both helpers return http(s) URLs
                              only, so these anchors can't smuggle a
                              javascript: href out of a pasted manifest. */}
                          {docs ? (
                            <a
                              className="btn btn-small"
                              href={docs}
                              target="_blank"
                              rel="noreferrer"
                              title={`Open this mod’s documentation: ${docs}`}
                            >
                              <Icon name="external" /> docs
                            </a>
                          ) : null}
                          {homepage ? (
                            <a
                              className="btn btn-small"
                              href={homepage}
                              target="_blank"
                              rel="noreferrer"
                              title={`Open this mod’s site: ${homepage}`}
                            >
                              <Icon name="external" /> site
                            </a>
                          ) : null}
                        </div>
                        {sourceOpenId === id ? (
                          <div className="source-view">
                            <div className="source-label">mod.json</div>
                            <pre className="source-pre">{JSON.stringify(mod.manifest, null, 2)}</pre>
                            <div className="source-label">entrypoint.js ({mod.code.length.toLocaleString()} chars)</div>
                            <pre className="source-pre">{mod.code}</pre>
                            {mod.mixins ? (
                              <>
                                <div className="source-label">mixins.json</div>
                                <pre className="source-pre">{JSON.stringify(mod.mixins, null, 2)}</pre>
                              </>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
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

            <details className="add-form">
              <summary>
                <Icon name="plus" /> Add a mod
              </summary>
              {/* Smoke contract (smoke-user-mods.mjs): after clicking the summary
                  it fills THREE textareas by index (0=manifest, 1=code, 2=mixins)
                  and clicks the "Add mod" button — the paste method must stay the
                  default so all three exist in the DOM in that order. */}
              <label className="add-label">
                Add from
                <select
                  className="add-select"
                  value={addMethod}
                  onChange={(e) => {
                    const v = e.target.value;
                    setAddMethod(v === 'url' ? 'url' : v === 'id' ? 'id' : 'paste');
                    setAddError(null);
                  }}
                >
                  <option value="paste">Paste the mod’s files</option>
                  <option value="url">Import from a URL</option>
                  <option value="id">Mod / modpack ID (coming soon)</option>
                </select>
              </label>
              {addMethod === 'paste' ? (
                <p className="meta">
                  Paste each file into its box — only 1 and 2 are required.
                </p>
              ) : null}
              {addMethod === 'url' ? (
                <>
                  <p className="meta">
                    A direct link to the mod’s <code>mod.json</code> or to a single
                    built <code>.js</code> file. Raw GitHub/gist links and CDNs work.
                  </p>
                  <label className="add-label">
                    <span className="field-tag req">required</span> mod URL
                    <input
                      type="url"
                      className="add-input"
                      spellCheck={false}
                      placeholder="https://raw.githubusercontent.com/you/your-mod/main/mod.json"
                      value={draftUrl}
                      onChange={(e) => setDraftUrl(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !importBusy) handleImportUrl();
                      }}
                    />
                  </label>
                  <p className="warn">
                    Mod code runs unsandboxed in your browser — only import from
                    authors you trust.
                  </p>
                  {addError ? (
                    <p className="warn">
                      <Icon name="error" /> {addError}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={importBusy}
                    onClick={handleImportUrl}
                  >
                    {importBusy ? 'Importing…' : 'Import mod'}
                  </button>
                </>
              ) : null}
              {addMethod === 'id' ? (
                <p className="meta">
                  Not available yet — use <strong>Import from a URL</strong> or{' '}
                  <strong>Paste the mod’s files</strong> for now.
                </p>
              ) : null}
              <div className={addMethod === 'paste' ? undefined : 'add-hidden'}>
                <label className="add-label">
                  <span className="field-tag req">required</span> 1 · mod.json
                  <textarea
                    rows={5}
                    spellCheck={false}
                    placeholder='{"schemaVersion": 1, "id": "my-mod", "version": "1.0.0", "environment": "web", "entrypoint": "index.js"}'
                    value={draftManifest}
                    onChange={(e) => setDraftManifest(e.target.value)}
                  />
                </label>
                <label className="add-label">
                  <span className="field-tag req">required</span> 2 · entrypoint.js (built
                  ES module, default export)
                  <textarea
                    rows={7}
                    spellCheck={false}
                    placeholder="export default (api) => { /* ... */ };"
                    value={draftCode}
                    onChange={(e) => setDraftCode(e.target.value)}
                  />
                </label>
                <label className="add-label">
                  <span className="field-tag opt">optional</span> 3 · mixins.json
                  <textarea
                    rows={5}
                    spellCheck={false}
                    placeholder='{"patches": [{"op": "after", "symbol": "Car", "inject": "..."}]}'
                    value={draftMixins}
                    onChange={(e) => setDraftMixins(e.target.value)}
                  />
                </label>
                <p className="warn">
                  Mod code runs unsandboxed in your browser — only add code you
                  trust or wrote.
                </p>
                {addError ? (
                    <p className="warn">
                      <Icon name="error" /> {addError}
                    </p>
                  ) : null}
                <button type="button" className="btn btn-primary" onClick={handleAddMod}>
                  Add mod
                </button>
              </div>
            </details>
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
                  {mixinReport.planStatus !== 'applied' ? (
                    <p className="warn">
                      <Icon name="warn" /> plan {mixinReport.planStatus} — no user mixin was applied.
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
                            <Icon name="error" /> {f.reason}: {f.detail.slice(0, 96)}
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

function ServiceWorkerBadge({
  state,
  error,
}: {
  state: SwState;
  error: string | null;
}): ReactElement {
  const label =
    state === 'active'
      ? 'ready'
      : state === 'registering'
        ? 'starting…'
        : state === 'error'
          ? 'service worker unavailable'
          : 'waiting…';
  const color = state === 'active' ? 'var(--green)' : state === 'error' ? 'var(--red)' : 'var(--amber)';
  return (
    <p className="sw-badge" style={{ color }}>
      <Icon name="dot" /> {label}
      {error ? <span className="sw-error"> — {error}</span> : null}
    </p>
  );
}

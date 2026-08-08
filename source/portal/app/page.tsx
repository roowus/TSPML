'use client';

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactElement } from 'react';
import { Audio, EventBus, Keybinds, Tracks } from '@tspml/api-bridge';
import type { GameAudioManager, GameTrackCodec, GameTrackManager } from '@tspml/api-bridge';
import type { TspmlApi } from '@tspml/api';
import { readEarlyCaptures } from '@tspml/shared';
import { loadMods } from '@/lib/mod-loader';
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
    const w = frameRef.current?.contentWindow as (Window & { __tspml?: unknown }) | null;
    if (!w) return;
    if (!keybindsRef.current) keybindsRef.current = new Keybinds(w);
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
    // Replay anything the pre-bridge stub recorded before `api` existed just now. The
    // codec capture fires during bundle init, so without this it is simply lost and
    // the registry never attaches (@tspml/shared's EARLY_CAPTURE_STUB, injected by
    // the proxy route).
    const early = readEarlyCaptures<GameTrackManager, GameTrackCodec>(w);
    if (early.manager) trackManagerRef.current = early.manager;
    if (early.codec) trackCodecRef.current = early.codec;
    attachTracksIfReady();
    // Load the bundled demo mods via @tspml/loader — a real mod package receives
    // this api and subscribes. Per-mod failure isolation (never boot-aborts).
    if (!modsLoadedRef.current) {
      modsLoadedRef.current = true;
      void loadMods(api)
        .then((s) => {
          // Retain the teardown closure (#17). Captured here rather than derived later
          // because it is the only handle to the loaded mods' cleanup — dropping it,
          // which is what used to happen, made every `onUnload` unreachable no matter
          // how completely the loader implemented it.
          unloadModsRef.current = s.unload;
          const rows: LoadedModRow[] = [
            ...s.loaded.map((id) => ({ id, status: 'loaded' as const })),
            ...s.failed.map((f) => ({ id: f.id, status: 'failed' as const, reason: f.reason })),
          ];
          setLoadedMods(rows);
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
        })
        .catch((e) => setModsStatus(`✗ ${(e as Error).message.slice(0, 48)}`));
    }
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

  return (
    <main style={mainStyle}>
      <header style={headerStyle}>
        <h1 style={titleStyle}>TSPML — PolyTrack, modded</h1>
        <p style={subtitleStyle}>
          The real game loaded through a service worker + <code>/api/proxy</code>.
          With <code>TSPML_TRANSFORM=1</code>, <code>main.bundle.js</code> is
          AST-rewritten — the green “TSPML ✔ LIVE” badge proves a transformed
          bundle runs.
        </p>
        <ServiceWorkerBadge state={swState} error={swError} />
      </header>

      <div style={gridStyle}>
        <section style={gameSectionStyle} aria-label="Game">
          {swState === 'active' ? (
            <iframe
              ref={frameRef}
              onLoad={handleFrameLoad}
              title="PolyTrack (proxied)"
              src={GAME_FRAME_SRC}
              style={frameStyle}
              allow="autoplay; fullscreen; gamepad; pointer-lock"
              allowFullScreen
            />
          ) : (
            <div style={startingStyle}>
              {swState === 'error'
                ? 'Service worker unavailable — the game needs it to load.'
                : 'Activating service worker…'}
              <span style={startingHintStyle}>
                The game mounts once the service worker controls this page, so its
                track/leaderboard requests are proxied (issue #9).
              </span>
            </div>
          )}
        </section>

        <aside style={asideStyle} aria-label="Mods">
          <h2 style={asideTitleStyle}>Mods</h2>
          <ul style={listStyle}>
            {loadedMods.length === 0 ? (
              <li style={listItemStyle}>
                <div style={modMetaStyle}>
                  {swState === 'active' ? 'loading…' : 'waiting for game…'}
                </div>
              </li>
            ) : (
              loadedMods.map((mod) => (
                <li key={mod.id} style={listItemStyle}>
                  <div style={modNameStyle}>
                    <code>{mod.id}</code>
                  </div>
                  {mod.reason ? <div style={modMetaStyle}>{mod.reason.slice(0, 72)}</div> : null}
                  <span
                    style={{
                      ...modStatusStyle,
                      color: mod.status === 'loaded' ? '#3fb950' : '#f85149',
                    }}
                  >
                    {mod.status}
                  </span>
                </li>
              ))
            )}
          </ul>
          <div style={bridgeRowStyle}>
            <span
              style={{ ...bridgeDotStyle, background: controlCount > 0 ? '#3fb950' : '#9aa4b2' }}
              aria-hidden="true"
            />
            bridge:{' '}
            {controlCount > 0
              ? `car.control × ${controlCount.toLocaleString()}`
              : 'idle (start a race)'}
          </div>
          <div style={bridgeRowStyle}>
            <span
              style={{ ...bridgeDotStyle, background: keybindCount > 0 ? '#3fb950' : '#9aa4b2' }}
              aria-hidden="true"
            />
            registry:{' '}
            {keybindCount > 0
              ? `keybind F × ${keybindCount}`
              : 'press F (TSPML demo keybind)'}
          </div>
          <div style={bridgeRowStyle}>
            <span
              style={{
                ...bridgeDotStyle,
                background: modsStatus.startsWith('✓') ? '#3fb950' : modsStatus.startsWith('✗') ? '#f85149' : '#9aa4b2',
              }}
              aria-hidden="true"
            />
            mods: {modsStatus}
          </div>
          {safetyStatus ? (
            <div style={bridgeRowStyle}>
              <span
                style={{ ...bridgeDotStyle, background: safetyStatus.startsWith('⚠') ? '#d29922' : '#3fb950' }}
                aria-hidden="true"
              />
              safety: {safetyStatus}
            </div>
          ) : null}
          <div style={bridgeRowStyle}>
            <span
              style={{ ...bridgeDotStyle, background: tracksStatus.startsWith('✓') ? '#3fb950' : '#9aa4b2' }}
              aria-hidden="true"
            />
            tracks: {tracksStatus}
          </div>
          <div style={bridgeRowStyle}>
            <span
              style={{ ...bridgeDotStyle, background: audioStatus.startsWith('✓') ? '#3fb950' : '#9aa4b2' }}
              aria-hidden="true"
            />
            audio: {audioStatus}
          </div>
          <p style={noteStyle}>
            The transform pipeline is built (M3); the <code>car.control</code>{' '}
            event is wired end-to-end (M4-B) — its count ticks up while you race.
            The list above is driven by <code>@tspml/loader</code> results. Once{' '}
            <code>tracks</code> reads attached, a mod can put its own track in the
            game’s Custom tracks list via <code>api.tracks</code>, and{' '}
            <code>api.audio</code> can override any of the game’s sounds by URL.
          </p>
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
  const color = state === 'active' ? '#3fb950' : state === 'error' ? '#f85149' : '#d29922';
  return (
    <p style={{ ...badgeStyle, color }}>
      <span aria-hidden="true">● </span>
      {label}
      {error ? <span style={errorStyle}> — {error}</span> : null}
    </p>
  );
}

/* Inline styles keep the file count down for the scaffold. */

const mainStyle: CSSProperties = {
  fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
  maxWidth: 1100,
  margin: '0 auto',
  padding: 24,
};
const headerStyle: CSSProperties = { marginBottom: 16 };
const titleStyle: CSSProperties = { margin: 0, fontSize: 24 };
const subtitleStyle: CSSProperties = { margin: '8px 0 12px', color: '#9aa4b2', fontSize: 14 };
const badgeStyle: CSSProperties = { fontSize: 13, fontWeight: 600 };
const errorStyle: CSSProperties = { color: '#9aa4b2', fontWeight: 400 };
const gridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 280px',
  gap: 16,
};
const gameSectionStyle: CSSProperties = {
  background: '#000',
  borderRadius: 10,
  overflow: 'hidden',
  aspectRatio: '16 / 9',
};
const frameStyle: CSSProperties = { width: '100%', height: '100%', border: '0' };
const startingStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  height: '100%',
  color: '#9aa4b2',
  fontSize: 14,
};
const startingHintStyle: CSSProperties = {
  fontSize: 12,
  maxWidth: 320,
  textAlign: 'center',
  lineHeight: 1.5,
  opacity: 0.8,
};
const asideStyle: CSSProperties = {
  background: '#14171f',
  border: '1px solid #21262d',
  borderRadius: 10,
  padding: 16,
};
const asideTitleStyle: CSSProperties = { margin: '0 0 12px', fontSize: 16 };
const listStyle: CSSProperties = { listStyle: 'none', padding: 0, margin: 0 };
const listItemStyle: CSSProperties = { padding: '8px 0', borderTop: '1px solid #21262d' };
const modNameStyle: CSSProperties = { fontWeight: 600, fontSize: 14 };
const modMetaStyle: CSSProperties = { color: '#9aa4b2', fontSize: 12, marginTop: 2 };
const modStatusStyle: CSSProperties = {
  display: 'inline-block',
  marginTop: 4,
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  color: '#d29922',
};
const noteStyle: CSSProperties = {
  marginTop: 12,
  fontSize: 12,
  color: '#9aa4b2',
  lineHeight: 1.5,
};
const bridgeRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  marginTop: 12,
  fontSize: 13,
  fontFamily: 'ui-monospace, Menlo, monospace',
  color: '#c9d1d9',
};
const bridgeDotStyle: CSSProperties = {
  display: 'inline-block',
  width: 8,
  height: 8,
  borderRadius: '50%',
  background: '#9aa4b2',
};

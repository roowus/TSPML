'use client';

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactElement } from 'react';
import { EventBus, Keybinds } from '@tspml/api-bridge';

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
 */

type SwState = 'idle' | 'registering' | 'active' | 'error';

const GAME_VERSION = process.env.NEXT_PUBLIC_POLYTRACK_VERSION ?? '0.6.2';
const GAME_FRAME_SRC = `/api/proxy/?version=${GAME_VERSION}`;
/** TSPML loader version exposed on the `api` object. */
const TSPML_VERSION = '0.0.0';

interface ModDescriptor {
  id: string;
  name: string;
  version: string;
  loaded: boolean;
}

// Placeholder mod list — wired to the real registry in a later milestone.
const PLACEHOLDER_MODS: ModDescriptor[] = [
  { id: 'tspml.example-hud', name: 'Example HUD', version: '0.1.0', loaded: false },
  { id: 'tspml.example-track', name: 'Example Track Pack', version: '0.1.0', loaded: false },
];

export default function PlayPage(): ReactElement {
  const [swState, setSwState] = useState<SwState>('idle');
  const [swError, setSwError] = useState<string | null>(null);
  const [controlCount, setControlCount] = useState(0);
  const [keybindCount, setKeybindCount] = useState(0);
  // The Tier-1 event bus shared with the game iframe: the transform emits
  // `car.control` (and future events) to `window.__tspml`; mods subscribe here.
  // The handle is always exposed — harmless when the bundle is unmodified (the
  // vanilla game never reads it; only the transformed bundle emits).
  const [bus] = useState<EventBus>(() => new EventBus());
  const frameRef = useRef<HTMLIFrameElement>(null);
  const keybindsRef = useRef<Keybinds | null>(null);
  const demoKeybindRegistered = useRef(false);

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

  // Expose the Tier-1 `api` object (events + keybinds) to the same-origin game
  // iframe as `window.__tspml`: transformed hooks emit to `api.events`, mods
  // call `api.keybinds.register(...)`. Built on iframe load (when the game
  // window exists). Also registers a demo keybind (KeyF) for a visible
  // "registry works" signal in the sidebar.
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
    w.__tspml = { events: bus, keybinds: keybindsRef.current, version: TSPML_VERSION };
  };

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
            {PLACEHOLDER_MODS.map((mod) => (
              <li key={mod.id} style={listItemStyle}>
                <div style={modNameStyle}>{mod.name}</div>
                <div style={modMetaStyle}>
                  <code>{mod.id}</code> · v{mod.version}
                </div>
                <span style={modStatusStyle}>{mod.loaded ? 'loaded' : 'inactive'}</span>
              </li>
            ))}
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
          <p style={noteStyle}>
            The transform pipeline is built (M3); the <code>car.control</code>{' '}
            event is wired end-to-end (M4-B) — its count ticks up while you race.
            The mod list above is placeholder.
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

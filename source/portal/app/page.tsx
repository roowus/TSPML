'use client';

import { useEffect, useState } from 'react';
import type { CSSProperties, ReactElement } from 'react';

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
 * No game transforms are applied yet (the loader is present but inactive) —
 * this page proves the delivery path loads the real game end-to-end.
 */

type SwState = 'idle' | 'registering' | 'active' | 'error';

const GAME_VERSION = process.env.NEXT_PUBLIC_POLYTRACK_VERSION ?? '0.6.2';
const GAME_FRAME_SRC = `/api/proxy/?version=${GAME_VERSION}`;

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

  useEffect(() => {
    if (!('serviceWorker' in navigator)) {
      setSwState('error');
      setSwError('Service workers are not supported in this browser.');
      return;
    }
    let cancelled = false;
    setSwState('registering');
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((registration) => {
        if (cancelled) return;
        const apply = (): void => {
          if (!cancelled) setSwState('active');
        };
        // sw.js calls skipWaiting() on install + clients.claim() on activate, so
        // the SW controls this page after the first reload.
        if (registration.active) {
          apply();
        } else {
          registration.addEventListener('activate', apply);
        }
      })
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
          M2 proof of concept: the real game loaded through a service worker +{' '}
          <code>/api/proxy</code>. No transforms yet.
        </p>
        <ServiceWorkerBadge state={swState} error={swError} />
      </header>

      <div style={gridStyle}>
        <section style={gameSectionStyle} aria-label="Game">
          <iframe
            title="PolyTrack (proxied)"
            src={GAME_FRAME_SRC}
            style={frameStyle}
            allow="autoplay; fullscreen; gamepad; pointer-lock"
            allowFullScreen
          />
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
          <p style={noteStyle}>
            The loader is present but applies no game transforms in M2. Mods will
            bind through the API bridge once the transform pipeline lands.
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

/*
 * TSPML service worker.
 *
 * Intercepts any fetch whose URL points at a PolyTrack / Kodub host and
 * rewrites it to the portal's `/api/proxy/<path>?version=<v>` route, so the
 * game "thinks" it is talking to Kodub while every byte flows through the
 * origin-correcting proxy. Everything else falls through to the network.
 *
 * The rewrite logic below is an INLINE COPY of the canonical pure function in
 * `lib/rewrite.ts` (unit-tested by tests/rewrite.test.ts). Files under /public
 * are served verbatim and cannot import that module — keep the two in sync.
 */

/* eslint-disable no-restricted-globals */
const SW_VERSION = 'tspml-sw-m2';
const DEFAULT_GAME_HOST = 'app-polytrack.kodub.com';
const GAME_VERSION = '0.6.2';
const VERSION_RE = /^\d+\.\d+\.\d+/;

function isGameHost(hostname) {
  return hostname === 'kodub.com' || hostname.endsWith('.kodub.com');
}

// Mirrors lib/rewrite.ts::rewriteGameUrl({ proxyBase: '', version }).
function rewriteGameUrl(inputUrl) {
  let url;
  try {
    url = new URL(inputUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (!isGameHost(url.hostname)) return null;

  const segments = url.pathname.split('/').filter(Boolean);
  let resolvedVersion = GAME_VERSION;
  let rest = url.pathname;
  const first = segments[0];
  if (first !== undefined && VERSION_RE.test(first)) {
    resolvedVersion = first;
    rest = '/' + segments.slice(1).join('/');
  }
  if (rest.length === 0) rest = '/';

  const proxyPath = '/api/proxy' + rest;
  const params = new URLSearchParams(url.search);
  params.set('version', resolvedVersion);
  if (url.hostname !== DEFAULT_GAME_HOST) {
    params.set('host', url.hostname);
  }
  const query = params.toString();
  return proxyPath + (query ? '?' + query : '');
}

self.addEventListener('install', (event) => {
  // Take over from the previous SW immediately so first-load traffic is proxied
  // after a single reload (no waiting for all tabs to close).
  void self.skipWaiting();
  event.waitUntil(Promise.resolve());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const rewritten = rewriteGameUrl(event.request.url);
  if (rewritten) {
    // The rewritten URL is same-origin (/api/proxy/...), so this fetch re-enters
    // the SW once — but rewriteGameUrl() returns null for it (it is not a kodub
    // URL), so it falls through to the network and there is no loop.
    event.respondWith(fetch(rewritten, { credentials: 'omit' }));
    return;
  }
  // Everything else: default network handling (no event.respondWith).
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') void self.skipWaiting();
});

// Tag the SW so the page can detect version changes later.
self.SW_VERSION = SW_VERSION;

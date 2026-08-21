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
const SW_VERSION = 'tspml-sw-43';
const DEFAULT_GAME_HOST = 'app-polytrack.kodub.com';
const GAME_VERSION = '0.6.2';
const VERSION_RE = /^\d+\.\d+\.\d+/;

// #62: where the page parks the user patch plan (Cache API, same-origin-JS
// writable only) and the proxy paths whose GET the SW replays as a POST
// carrying it. INLINE COPIES of lib/user-patches.ts PLAN_CACHE — same
// keep-in-sync rule as the rewrite logic above.
const PLAN_CACHE_NAME = 'tspml-user-patches-v1';
const PLAN_CACHE_URL = '/__tspml/user-patch-plan';

// #98: the game lazy-loads feature code as `<id>.bundle.js`, so the replay covers
// those too, not just main.
//
// The SW matches the SHAPE; the ROUTE owns the allowlist. That split is deliberate:
// the real allowlist is per-build map data, and a copy of it here would be a second
// source of truth that goes stale silently at exactly the moment a game update makes
// it wrong. A POST for an id the map does not declare is answered 405 by the route,
// and `fetchBundle` falls back to the plain GET — which is the correct behaviour for
// an undeclared chunk anyway (proxy it verbatim). Over-matching costs one extra
// request on a path nobody transforms; under-matching would silently drop user mixins.
//
// INLINE COPY of lib/rewrite.ts::BUNDLE_PATH_RE — tests/sw-sync.test.ts compares the
// two literals character for character, so this one cannot drift unnoticed.
const BUNDLE_PATH_RE = /^\/api\/proxy\/(?:main|\d{1,6})\.bundle\.js$/;

function isBundleProxyPath(pathname) {
  return BUNDLE_PATH_RE.test(pathname);
}

// #43: the physics binary is fetched as its own file and never passes through the
// bundle path, so it needs its own matcher, its own cache entry, and its own replay.
// Same shape-only rule: the route owns which binaries are declared patchable.
//
// INLINE COPIES of lib/rewrite.ts::WASM_PATH_RE and lib/physics-plan.ts::PHYSICS_CACHE
// — tests/sw-sync.test.ts compares the literals, same as the #62 pair above.
const WASM_PATH_RE = /^\/api\/proxy\/[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*\.wasm$/;
const PHYSICS_CACHE_NAME = 'tspml-physics-plan-v1';
const PHYSICS_CACHE_URL = '/__tspml/physics-plan';
const PHYSICS_REPORT_MESSAGE = 'tspml:physics-report';

function isWasmProxyPath(pathname) {
  return WASM_PATH_RE.test(pathname);
}

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

// #62: read the user patch plan the page parked in the Cache API. Returns the
// plan JSON text, or null when there is none (or reading failed). NOTE the
// awaits: `cache.match()` returns a Promise — optional-chaining `.text` on it
// would make the plan silently always-null.
async function readPlanFrom(cacheName, cacheUrl) {
  try {
    const cache = await caches.open(cacheName);
    const hit = await cache.match(cacheUrl);
    if (!hit) return null;
    const text = await hit.text();
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

async function readUserPatchPlan() {
  return readPlanFrom(PLAN_CACHE_NAME, PLAN_CACHE_URL);
}

// #43: the physics plan, parked in its own cache entry by the page.
async function readPhysicsPlan() {
  return readPlanFrom(PHYSICS_CACHE_NAME, PHYSICS_CACHE_URL);
}

// #62: serve a bundle request (main, or a chunk since #98). When a plan exists,
// replay the GET as a POST with the plan as the body (the route composes the user
// patches into the transform and prepends the per-mod report prelude). No plan, a
// failed POST, or a non-OK POST response all fall back to the plain GET — the
// pre-#62 path, so user mixins can only ever degrade to "not applied", never
// break the game load. A 405 for an undeclared chunk lands in that same fallback.
async function fetchBundle(proxyUrl) {
  const plan = await readUserPatchPlan();
  if (plan !== null) {
    try {
      const res = await fetch(proxyUrl, {
        method: 'POST',
        credentials: 'omit',
        headers: { 'content-type': 'application/json' },
        body: plan,
      });
      if (res.ok) return res;
    } catch {
      // fall through to the plain GET
    }
  }
  return fetch(proxyUrl, { credentials: 'omit' });
}

// #43: tell every open page what happened to a physics request. A wasm response is
// bytes the game hands straight to WebAssembly.instantiate, so unlike a bundle there
// is no prelude to ride — the outcome exists only in headers, and only the SW can see
// them. Without this the mixin panel could say nothing at all about physics, which is
// the "my mod did nothing and I cannot tell why" failure this whole path avoids.
async function reportPhysics(res, file) {
  try {
    const status = res.headers.get('x-tspml-wasm-status');
    if (!status) return;
    const message = {
      type: PHYSICS_REPORT_MESSAGE,
      file,
      status,
      detail: res.headers.get('x-tspml-detail') || '',
      applied: Number(res.headers.get('x-tspml-wasm-applied') || '0') || 0,
    };
    const clients = await self.clients.matchAll({ includeUncontrolled: true });
    for (const client of clients) client.postMessage(message);
  } catch {
    // Reporting is best-effort: never let it affect the bytes the game receives.
  }
}

// #43: serve a physics binary request. Same replay shape as fetchBundle and the same
// degradation: no plan, a failed POST, or a non-OK POST response all fall back to the
// plain GET, which is the pre-#43 path byte for byte. A physics mod can only ever
// degrade to "not applied" — never to a binary the game cannot instantiate.
async function fetchWasm(proxyUrl, file) {
  const plan = await readPhysicsPlan();
  if (plan !== null) {
    try {
      const res = await fetch(proxyUrl, {
        method: 'POST',
        credentials: 'omit',
        headers: { 'content-type': 'application/json' },
        body: plan,
      });
      if (res.ok) {
        void reportPhysics(res.clone(), file);
        return res;
      }
    } catch {
      // fall through to the plain GET
    }
  }
  const res = await fetch(proxyUrl, { credentials: 'omit' });
  // Report the plain GET too: 'vanilla' and 'stale-pin' are both outcomes an author
  // needs to see, and a stale pin is exactly the case where no plan was even sent.
  void reportPhysics(res.clone(), file);
  return res;
}

/** Last path segment of a proxy path — the filename the route reports on. */
function wasmFileOf(pathname) {
  const parts = pathname.split('/');
  return parts[parts.length - 1] || pathname;
}

self.addEventListener('fetch', (event) => {
  const rewritten = rewriteGameUrl(event.request.url);
  if (rewritten) {
    // The rewritten URL is same-origin (/api/proxy/...), so this fetch re-enters
    // the SW once — but rewriteGameUrl() returns null for it (it is not a kodub
    // URL), so it falls through to the network and there is no loop.
    const rewrittenPath = rewritten.split('?')[0];
    if (event.request.method === 'GET' && isBundleProxyPath(rewrittenPath)) {
      event.respondWith(fetchBundle(rewritten));
      return;
    }
    if (event.request.method === 'GET' && isWasmProxyPath(rewrittenPath)) {
      event.respondWith(fetchWasm(rewritten, wasmFileOf(rewrittenPath)));
      return;
    }
    event.respondWith(fetch(rewritten, { credentials: 'omit' }));
    return;
  }
  // #62: the bundle request is normally ALREADY same-origin — the game document
  // is served from /api/proxy/ and its injected <base href="/api/proxy/">
  // resolves `<script src="main.bundle.js">` against the portal origin, so the
  // request never has a kodub hostname and never enters the rewrite branch
  // above. (fetchBundle's own fetch() does not re-trigger this handler — a
  // SW's fetches bypass its fetch event — so there is no loop here either.)
  //
  // #98: chunk requests arrive the same way, and for the same reason. Webpack builds
  // them as `i.p + i.u(id)`, and `i.p` is derived from the executing script's own src
  // — which under the injected <base> is already the portal origin. So a chunk GET is
  // same-origin too and lands in exactly this branch.
  if (event.request.method === 'GET') {
    let url;
    try {
      url = new URL(event.request.url);
    } catch {
      return;
    }
    if (url.origin === self.location.origin && isBundleProxyPath(url.pathname)) {
      event.respondWith(fetchBundle(event.request.url));
      return;
    }
    // #43: the physics binary arrives here for the same reason the chunks do — the
    // game requests it relative to the injected <base>, so it is already same-origin.
    if (url.origin === self.location.origin && isWasmProxyPath(url.pathname)) {
      event.respondWith(fetchWasm(event.request.url, wasmFileOf(url.pathname)));
      return;
    }
  }
  // Everything else: default network handling (no event.respondWith).
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') void self.skipWaiting();
});

// Tag the SW so the page can detect version changes later.
self.SW_VERSION = SW_VERSION;

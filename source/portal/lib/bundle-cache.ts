/**
 * In-process memo for the BASE transformed bundle (the plain-GET path: no user
 * patch sets). The babel pass over the ~1.8 MB game bundle costs seconds per
 * request on a serverless function — and for the GET path its output is fully
 * deterministic (same upstream bytes, same loader patches), so recomputing it
 * per request is pure waste. One entry per upstream URL, short TTL, and the
 * PROMISE is memoized so concurrent requests (the page's prewarm racing the
 * SW's real fetch) share a single upstream fetch + transform instead of
 * doubling the work.
 *
 * #98: the key stays the UPSTREAM URL, which now also covers chunk bundles. That
 * works precisely because the surface is a FUNCTION of the path (`112.bundle.js`
 * always means chunk 112's pin and base patches), so two requests sharing an
 * upstream URL always share a surface — no entry can serve bytes transformed
 * against another file's pin.
 *
 * Boundaries this deliberately respects:
 *
 *  - #62 "the server never stores user code": ONLY the base compose is cached.
 *    The POST path (user patch plans) stays per-request in the route — a plan
 *    or its transformed output never enters this map.
 *  - No redistribution: this is ephemeral process memory on the serving
 *    instance — the same place the bundle already lives for the duration of
 *    every request — never storage at rest, never a new distribution surface.
 *    The TTL also bounds staleness after a Kodub release: at most TTL_MS of
 *    serving the previous bundle, then the next request re-fetches (and the
 *    hash gate fails closed to vanilla if the map no longer matches).
 *  - Upstream errors are NOT cached: a 5xx/404 or thrown fetch falls out of
 *    the map immediately so one bad upstream moment doesn't stick for the TTL.
 *
 * Injectable fetch/transform/clock so the unit tests drive it without network
 * or the real babel pass.
 */
import { applyDemoTransform } from './demo-transform';
import type { TransformSurface } from './transform-surface';

export interface CachedBundle {
  /** Upstream HTTP status (200 for the normal case). */
  readonly status: number;
  /** The transformed (or fail-closed vanilla) bundle source. */
  readonly body: string;
  readonly transformed: boolean;
  readonly detail: string;
  readonly vanillaHash: string;
}

/** Failure marker: the upstream fetch failed (network) or returned non-OK. */
export interface BundleFetchFailure {
  readonly status: number | null; // null = fetch threw
}

export type BundleResult =
  | { readonly ok: true; readonly bundle: CachedBundle; readonly cacheHit: boolean }
  | { readonly ok: false; readonly failure: BundleFetchFailure };

export interface BundleCacheDeps {
  readonly fetchImpl?: typeof fetch;
  readonly transformImpl?: (src: string) => Promise<{
    code: string;
    transformed: boolean;
    detail: string;
    vanillaHash: string;
  }>;
  readonly now?: () => number;
}

/** How long a computed bundle is served before the next request re-fetches. */
export const BUNDLE_CACHE_TTL_MS = 300_000;

interface Entry {
  readonly expires: number;
  readonly promise: Promise<BundleResult>;
  /** False until the promise settles — a settled entry reports cacheHit. */
  settled: boolean;
}

const entries = new Map<string, Entry>();

/** Test hook: drop every memoized entry. */
export function clearBundleCache(): void {
  entries.clear();
}

async function compute(
  upstream: string,
  headers: Headers,
  surface: TransformSurface,
  deps: BundleCacheDeps,
): Promise<BundleResult> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const transformImpl =
    deps.transformImpl ?? (async (src: string) => applyDemoTransform(src, [], surface));
  let res: Response;
  try {
    res = await fetchImpl(upstream, { headers, redirect: 'follow' });
  } catch {
    return { ok: false, failure: { status: null } };
  }
  if (!res.ok) {
    return { ok: false, failure: { status: res.status } };
  }
  const src = await res.text();
  const { code, transformed, detail, vanillaHash } = await transformImpl(src);
  return {
    ok: true,
    bundle: { status: res.status, body: code, transformed, detail, vanillaHash },
    cacheHit: false,
  };
}

/**
 * The base transformed bundle for `upstream`, memoized. `headers` are only
 * used when this call actually fills the cache (they are not part of the key —
 * the upstream is a static file; the forwarded UA is politeness, not
 * variance). `surface` likewise: it is derived from the same path the upstream
 * URL is built from, so it cannot vary for a given key. Errors are returned but
 * never cached.
 *
 * `surface` is REQUIRED and sits before `deps` deliberately (#98). Defaulting it to
 * the main surface would let a pre-#98 three-argument call — `(url, headers, deps)` —
 * keep type-checking with `deps` landing in the surface slot: the real network fetch
 * and the real babel pass would run while the caller believed it had injected fakes.
 * A required parameter turns that into a compile error at every call site instead.
 */
export async function getBaseTransformedBundle(
  upstream: string,
  headers: Headers,
  surface: TransformSurface,
  deps: BundleCacheDeps = {},
): Promise<BundleResult> {
  const now = deps.now ?? Date.now;
  const existing = entries.get(upstream);
  if (existing && existing.expires > now()) {
    const r = await existing.promise;
    // A settled successful entry is a hit; an in-flight one means this request
    // piggybacked on another's work — report it as a hit too (no new compute).
    return r.ok ? { ...r, cacheHit: true } : r;
  }

  const entry: Entry = {
    expires: now() + BUNDLE_CACHE_TTL_MS,
    promise: compute(upstream, headers, surface, deps),
    settled: false,
  };
  entries.set(upstream, entry);
  const result = await entry.promise;
  entry.settled = true;
  if (!result.ok) {
    // Never cache failures — the next request retries upstream immediately.
    if (entries.get(upstream) === entry) entries.delete(upstream);
    return result;
  }
  return { ...result, cacheHit: false };
}

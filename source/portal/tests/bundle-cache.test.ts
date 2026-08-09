/**
 * lib/bundle-cache.ts — the base-transform memo behind the proxy's plain-GET
 * bundle path. These tests pin the contract the route (and the page's prewarm)
 * lean on: one fetch+transform per TTL window, in-flight sharing, and errors
 * never sticking. All deps injected — no network, no babel.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  BUNDLE_CACHE_TTL_MS,
  clearBundleCache,
  getBaseTransformedBundle,
} from '@/lib/bundle-cache';
import type { BundleCacheDeps } from '@/lib/bundle-cache';

const URL_A = 'https://app-polytrack.kodub.com/0.6.2/main.bundle.js';

/** Deps with counting fakes; transform tags its output so hits are provable. */
function makeDeps(overrides: Partial<{
  status: number;
  throwFetch: boolean;
  gate: Promise<void>;
}> = {}): { deps: BundleCacheDeps; counts: { fetch: number; transform: number } } {
  const counts = { fetch: 0, transform: 0 };
  const deps: BundleCacheDeps = {
    fetchImpl: (async () => {
      counts.fetch++;
      if (overrides.gate) await overrides.gate;
      if (overrides.throwFetch) throw new Error('network down');
      return new Response('vanilla-src', { status: overrides.status ?? 200 });
    }) as typeof fetch,
    transformImpl: async (src: string) => {
      counts.transform++;
      return {
        code: `transformed(${src})#${counts.transform}`,
        transformed: true,
        detail: 'ok',
        vanillaHash: 'sha256:abc',
      };
    },
    now: () => 1_000_000,
  };
  return { deps, counts };
}

beforeEach(() => {
  clearBundleCache();
});

describe('getBaseTransformedBundle', () => {
  it('computes on miss, serves the memo on the next call', async () => {
    const { deps, counts } = makeDeps();
    const first = await getBaseTransformedBundle(URL_A, new Headers(), deps);
    expect(first).toMatchObject({
      ok: true,
      cacheHit: false,
      bundle: { body: 'transformed(vanilla-src)#1', transformed: true, status: 200 },
    });
    const second = await getBaseTransformedBundle(URL_A, new Headers(), deps);
    expect(second).toMatchObject({
      ok: true,
      cacheHit: true,
      bundle: { body: 'transformed(vanilla-src)#1' },
    });
    expect(counts.fetch).toBe(1);
    expect(counts.transform).toBe(1);
  });

  it('shares ONE in-flight compute across concurrent callers (prewarm race)', async () => {
    let open!: () => void;
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const { deps, counts } = makeDeps({ gate });
    const a = getBaseTransformedBundle(URL_A, new Headers(), deps);
    const b = getBaseTransformedBundle(URL_A, new Headers(), deps);
    open();
    const [ra, rb] = await Promise.all([a, b]);
    expect(counts.fetch).toBe(1);
    expect(counts.transform).toBe(1);
    expect(ra.ok && rb.ok).toBe(true);
    if (ra.ok && rb.ok) {
      expect(rb.bundle.body).toBe(ra.bundle.body);
      // The filler reports a miss; the piggybacker reports a hit.
      expect(ra.cacheHit).toBe(false);
      expect(rb.cacheHit).toBe(true);
    }
  });

  it('recomputes after the TTL expires', async () => {
    const { deps, counts } = makeDeps();
    let t = 1_000_000;
    const timed = { ...deps, now: () => t };
    await getBaseTransformedBundle(URL_A, new Headers(), timed);
    t += BUNDLE_CACHE_TTL_MS + 1;
    const r = await getBaseTransformedBundle(URL_A, new Headers(), timed);
    expect(r).toMatchObject({ ok: true, cacheHit: false });
    expect(counts.transform).toBe(2);
  });

  it('keys by upstream URL — different versions do not collide', async () => {
    const { deps, counts } = makeDeps();
    await getBaseTransformedBundle(URL_A, new Headers(), deps);
    const other = await getBaseTransformedBundle(
      'https://app-polytrack.kodub.com/0.7.0/main.bundle.js',
      new Headers(),
      deps,
    );
    expect(other).toMatchObject({ ok: true, cacheHit: false });
    expect(counts.transform).toBe(2);
  });

  it('does NOT cache a non-OK upstream: the next call retries', async () => {
    const bad = makeDeps({ status: 503 });
    const r1 = await getBaseTransformedBundle(URL_A, new Headers(), bad.deps);
    expect(r1).toMatchObject({ ok: false, failure: { status: 503 } });
    const good = makeDeps();
    const r2 = await getBaseTransformedBundle(URL_A, new Headers(), good.deps);
    expect(r2).toMatchObject({ ok: true, cacheHit: false });
    expect(good.counts.fetch).toBe(1);
  });

  it('does NOT cache a thrown fetch: the next call retries', async () => {
    const bad = makeDeps({ throwFetch: true });
    const r1 = await getBaseTransformedBundle(URL_A, new Headers(), bad.deps);
    expect(r1).toMatchObject({ ok: false, failure: { status: null } });
    const good = makeDeps();
    const r2 = await getBaseTransformedBundle(URL_A, new Headers(), good.deps);
    expect(r2).toMatchObject({ ok: true, cacheHit: false });
  });

  it('clearBundleCache drops the memo', async () => {
    const { deps, counts } = makeDeps();
    await getBaseTransformedBundle(URL_A, new Headers(), deps);
    clearBundleCache();
    const r = await getBaseTransformedBundle(URL_A, new Headers(), deps);
    expect(r).toMatchObject({ ok: true, cacheHit: false });
    expect(counts.transform).toBe(2);
  });
});

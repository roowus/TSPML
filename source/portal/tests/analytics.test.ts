import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * lib/analytics reads NEXT_PUBLIC_GA_ID at module load, so each block imports a
 * FRESH copy after stubbing the env — the shipped default (unset id, every
 * function a no-op) and the configured path are effectively separate modules.
 *
 * The suite runs in the `node` environment (see vitest.config.ts) and stubs a
 * minimal `window` rather than pulling in jsdom: the module only ever touches
 * `window.dataLayer` and `window.gtag`, so a plain object is a faithful double
 * and CI gains no new dependency.
 */

type AnalyticsModule = typeof import('../lib/analytics');

interface FakeWindow {
  dataLayer?: unknown[];
  gtag?: (...args: unknown[]) => void;
}

function fakeWindow(): FakeWindow {
  const w: FakeWindow = {};
  vi.stubGlobal('window', w);
  return w;
}

async function freshAnalytics(gaId: string): Promise<AnalyticsModule> {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_GA_ID', gaId);
  return import('../lib/analytics');
}

let win: FakeWindow;

beforeEach(() => {
  win = fakeWindow();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('trackEvent', () => {
  it('is a no-op without a measurement id — no dataLayer, no gtag, no throw', async () => {
    const a = await freshAnalytics('');
    expect(a.GA_ID).toBe('');
    a.trackEvent('mod_loaded', { mod_id: 'cool-cars' });
    expect(win.dataLayer).toBeUndefined();
    expect(win.gtag).toBeUndefined();
  });

  it('queues events on the dataLayer when configured (gtag.js drains it on load)', async () => {
    const a = await freshAnalytics('G-TEST123');
    a.trackEvent('mod_loaded', { mod_id: 'cool-cars' });
    expect(win.dataLayer).toHaveLength(1);
    // The shim pushes `arguments`, which is array-LIKE, not an array.
    const args = Array.from(win.dataLayer![0] as ArrayLike<unknown>);
    expect(args).toEqual(['event', 'mod_loaded', { mod_id: 'cool-cars' }]);
  });

  it('uses an existing gtag (the one the layout script defines) as-is', async () => {
    const a = await freshAnalytics('G-TEST123');
    const calls: unknown[][] = [];
    win.gtag = (...args: unknown[]) => calls.push(args);
    a.trackEvent('mods_session', { count: 2 });
    expect(calls).toEqual([['event', 'mods_session', { count: 2 }]]);
  });

  it('never throws even if gtag itself throws — analytics cannot break the portal', async () => {
    const a = await freshAnalytics('G-TEST123');
    win.gtag = () => {
      throw new Error('gtag exploded');
    };
    expect(() => a.trackEvent('mod_loaded', { mod_id: 'x' })).not.toThrow();
  });
});

describe('mod-usage helpers', () => {
  it('trackModAdded sends the id and method, mapping a null id to "(no id)"', async () => {
    const a = await freshAnalytics('G-TEST123');
    const calls: unknown[][] = [];
    win.gtag = (...args: unknown[]) => calls.push(args);
    a.trackModAdded('cool-cars', 'url');
    a.trackModAdded(null, 'paste');
    expect(calls).toEqual([
      ['event', 'mod_added', { mod_id: 'cool-cars', method: 'url' }],
      ['event', 'mod_added', { mod_id: '(no id)', method: 'paste' }],
    ]);
  });

  it('trackModsLoaded emits one event per mod plus the session count', async () => {
    const a = await freshAnalytics('G-TEST123');
    const calls: unknown[][] = [];
    win.gtag = (...args: unknown[]) => calls.push(args);
    a.trackModsLoaded(['a', 'b'], ['c']);
    expect(calls).toEqual([
      ['event', 'mod_loaded', { mod_id: 'a' }],
      ['event', 'mod_loaded', { mod_id: 'b' }],
      ['event', 'mod_load_failed', { mod_id: 'c' }],
      ['event', 'mods_session', { count: 2 }],
    ]);
  });

  it('trackModsLoaded stays quiet when unconfigured', async () => {
    const a = await freshAnalytics('');
    a.trackModsLoaded(['a'], []);
    expect(win.dataLayer).toBeUndefined();
  });
});

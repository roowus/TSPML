import { describe, expect, it } from 'vitest';
import type { ModApi, ModDescriptor, VersionManifest } from '../src/index.js';
import { DependencyError, load, stubApi, TspmlMod } from '../src/index.js';

/** A raw mod.json-shaped object with sensible defaults; only `id` is required. */
function manifest(
  id: string,
  extra: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id,
    name: id,
    version: '1.0.0',
    entrypoint: `./${id}.js`,
    targets: [],
    ...extra,
  };
}

/** A descriptor keyed by id; tests inject the entry module via `importEntry`. */
function descriptor(
  id: string,
  extra: Partial<Record<string, unknown>> = {},
): ModDescriptor {
  return { manifest: manifest(id, extra), entry: id };
}

/** Build an importEntry that resolves specifiers (mod ids) to default exports. */
function fakeImportEntry(exports: Record<string, unknown>) {
  return (specifier: string): Promise<unknown> => {
    const def = exports[specifier];
    if (def === undefined) {
      return Promise.reject(new Error(`no fake entry for '${specifier}'`));
    }
    return Promise.resolve({ default: def });
  };
}

const noopApi: ModApi = stubApi;

describe('load — ordering', () => {
  it('loads mods in dependency order via factory entrypoints', async () => {
    const calls: string[] = [];
    const factory = (id: string) => () => {
      calls.push(id);
    };
    const result = await load(
      [
        descriptor('feature', { depends: { core: '*' } }),
        descriptor('core'),
      ],
      {
        importEntry: fakeImportEntry({
          core: factory('core'),
          feature: factory('feature'),
        }),
        api: noopApi,
      },
    );

    expect(result.order.map((m) => m.id)).toEqual(['core', 'feature']);
    expect(calls).toEqual(['core', 'feature']);
    expect(result.status['core']).toEqual({ status: 'loaded' });
    expect(result.status['feature']).toEqual({ status: 'loaded' });
  });
});

describe('load — error isolation', () => {
  it('a throwing entrypoint is isolated; other mods still load', async () => {
    const ok: string[] = [];
    const factory = (id: string) => () => {
      ok.push(id);
    };
    const result = await load(
      [descriptor('good1'), descriptor('good2'), descriptor('boom')],
      {
        importEntry: fakeImportEntry({
          good1: factory('good1'),
          good2: factory('good2'),
          boom: () => {
            throw new Error('kaboom');
          },
        }),
        api: noopApi,
      },
    );

    expect(ok).toEqual(['good1', 'good2']);
    expect(result.status['good1']).toEqual({ status: 'loaded' });
    expect(result.status['good2']).toEqual({ status: 'loaded' });
    expect(result.status['boom']).toEqual({ status: 'failed', reason: 'kaboom' });
  });

  it('an invalid manifest fails just that mod; others still load', async () => {
    const ok: string[] = [];
    const factory = (id: string) => () => {
      ok.push(id);
    };
    const result = await load(
      [descriptor('good'), { manifest: manifest('broken', { version: 'not-semver' }), entry: 'broken' }],
      {
        importEntry: fakeImportEntry({ good: factory('good') }),
        api: noopApi,
      },
    );

    expect(ok).toEqual(['good']);
    expect(result.status['good']).toEqual({ status: 'loaded' });
    expect(result.status['broken']).toMatchObject({ status: 'failed' });
    expect((result.status['broken'] as { reason: string }).reason).toMatch(/semver/);
  });

  it('propagates resolution errors (abortive)', async () => {
    await expect(
      load([descriptor('x', { depends: { missing: '*' } })], {
        importEntry: fakeImportEntry({ x: () => {} }),
        api: noopApi,
      }),
    ).rejects.toBeInstanceOf(DependencyError);
  });
});

describe('load — entrypoint contract', () => {
  it('hands each factory the provided api and game', async () => {
    const customApi: ModApi = {
      events: { on: () => {}, off: () => {} },
      logger: { log: () => {}, error: () => {}, warn: () => {}, info: () => {}, debug: () => {} },
    };
    const customGame = { polytrack: true };
    let receivedApi: unknown = null;
    let receivedGame: unknown = null;

    await load([descriptor('m')], {
      importEntry: fakeImportEntry({
        m: (api: unknown, game: unknown) => {
          receivedApi = api;
          receivedGame = game;
        },
      }),
      api: customApi,
      game: customGame,
    });

    expect(receivedApi).toBe(customApi);
    expect(receivedGame).toBe(customGame);
  });

  it('runs class-form lifecycle hooks in order (preInit → init → ready)', async () => {
    const events: string[] = [];

    class MyMod extends TspmlMod {
      override preInit() {
        events.push('preInit');
      }
      override init() {
        events.push('init');
      }
      override ready() {
        events.push('ready');
      }
    }

    await load([descriptor('m')], {
      importEntry: fakeImportEntry({ m: MyMod }),
      api: noopApi,
    });

    expect(events).toEqual(['preInit', 'init', 'ready']);
  });

  it('awaits async lifecycle hooks', async () => {
    const events: string[] = [];

    class AsyncMod extends TspmlMod {
      override async preInit() {
        await Promise.resolve();
        events.push('preInit');
      }
      override async init() {
        await Promise.resolve();
        events.push('init');
      }
    }

    await load([descriptor('m')], {
      importEntry: fakeImportEntry({ m: AsyncMod }),
      api: noopApi,
    });

    expect(events).toEqual(['preInit', 'init']);
  });

  it('accepts a typed VersionManifest as a descriptor manifest', async () => {
    const m: VersionManifest = {
      schemaVersion: 1,
      id: 'roundtrip',
      name: 'Roundtrip',
      version: '1.0.0',
      entrypoint: 'main.js',
      targets: [],
    };
    const result = await load([{ manifest: m, entry: 'roundtrip' }], {
      importEntry: fakeImportEntry({ roundtrip: () => {} }),
      api: noopApi,
    });
    expect(result.status['roundtrip']).toEqual({ status: 'loaded' });
  });
});

// #17: `onUnload` was declared on TspmlMod and `loader.onUnload` was documented
// as "fixes PML's missing-cleanup bug" — but nothing ever called it. The class
// instance was a local inside invokeMod and was dropped on the floor, so the
// hook was unreachable BY CONSTRUCTION, not merely unwired. Mods could not
// detach listeners, keybinds, or DOM.
describe('load — unload (#17)', () => {
  it('calls onUnload on a class-form mod, with the api', async () => {
    const seen: string[] = [];
    let gotApi: unknown;
    class Mod extends TspmlMod {
      override init(): void {
        seen.push('init');
      }
      override onUnload(api: ModApi): void {
        seen.push('onUnload');
        gotApi = api;
      }
    }
    const result = await load([descriptor('m')], {
      importEntry: fakeImportEntry({ m: Mod }),
      api: noopApi,
    });
    expect(seen).toEqual(['init']); // not yet — unload is explicit

    const un = await result.unload();
    expect(seen).toEqual(['init', 'onUnload']);
    expect(un.status['m']).toEqual({ status: 'unloaded' });
    // Handed the api, so a mod can events.off(...) without stashing it at init.
    expect(gotApi).toBe(noopApi);
  });

  it('calls the disposer a factory-form mod returns', async () => {
    let disposed = 0;
    const result = await load([descriptor('f')], {
      importEntry: fakeImportEntry({ f: () => () => { disposed++; } }),
      api: noopApi,
    });
    expect(disposed).toBe(0);
    const un = await result.unload();
    expect(disposed).toBe(1);
    expect(un.status['f']).toEqual({ status: 'unloaded' });
  });

  it('reports no-op for a mod that exposes no cleanup', async () => {
    const result = await load([descriptor('bare')], {
      importEntry: fakeImportEntry({ bare: () => {} }),
      api: noopApi,
    });
    const un = await result.unload();
    // Distinguishable from 'unloaded': "nothing to clean up" is not the same
    // claim as "cleanup ran", and a host surfacing this should not conflate them.
    expect(un.status['bare']).toEqual({ status: 'no-op' });
  });

  it('unloads in REVERSE load order', async () => {
    const calls: string[] = [];
    const mod = (id: string) => () => () => { calls.push(id); };
    const result = await load(
      [descriptor('feature', { depends: { core: '*' } }), descriptor('core')],
      { importEntry: fakeImportEntry({ core: mod('core'), feature: mod('feature') }), api: noopApi },
    );
    expect(result.order.map((m) => m.id)).toEqual(['core', 'feature']);
    await result.unload();
    // A dependent must tear down before the mod it depends on — otherwise
    // 'feature' cleans up against a 'core' that has already released its state.
    expect(calls).toEqual(['feature', 'core']);
  });

  it('isolates a throwing onUnload — the other mods still tear down', async () => {
    const calls: string[] = [];
    const good = (id: string) => () => () => { calls.push(id); };
    const result = await load(
      [descriptor('a'), descriptor('boom'), descriptor('c')],
      {
        importEntry: fakeImportEntry({
          a: good('a'),
          boom: () => () => { throw new Error('leaky mod'); },
          c: good('c'),
        }),
        api: noopApi,
      },
    );
    const un = await result.unload();
    // Fail small, exactly as loading does: one leaky mod must not strand the
    // cleanup of every mod ordered before it.
    expect(calls).toEqual(['c', 'a']);
    expect(un.status['boom']).toEqual({ status: 'failed', reason: 'leaky mod' });
    expect(un.status['a']).toEqual({ status: 'unloaded' });
    expect(un.status['c']).toEqual({ status: 'unloaded' });
  });

  it('is idempotent — a page teardown racing an explicit disable is safe', async () => {
    let disposed = 0;
    const result = await load([descriptor('once')], {
      importEntry: fakeImportEntry({ once: () => () => { disposed++; } }),
      api: noopApi,
    });
    await Promise.all([result.unload(), result.unload()]);
    await result.unload();
    // Running cleanup twice is the double-free bug cleanup exists to prevent.
    expect(disposed).toBe(1);
  });

  it('does not unload a mod that failed to load', async () => {
    const result = await load([descriptor('ok'), descriptor('bad')], {
      importEntry: fakeImportEntry({ ok: () => () => {} }),
      api: noopApi,
    });
    expect(result.status['bad']?.status).toBe('failed');
    const un = await result.unload();
    expect(un.status['bad']).toBeUndefined();
    expect(un.status['ok']).toEqual({ status: 'unloaded' });
  });

  it('awaits an async onUnload before resolving', async () => {
    let finished = false;
    class Slow extends TspmlMod {
      override async onUnload(): Promise<void> {
        await new Promise((r) => setTimeout(r, 10));
        finished = true;
      }
    }
    const result = await load([descriptor('slow')], {
      importEntry: fakeImportEntry({ slow: Slow }),
      api: noopApi,
    });
    await result.unload();
    // A host emitting loader.onUnload after this must be able to trust that
    // cleanup has actually completed, not merely started.
    expect(finished).toBe(true);
  });
});

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

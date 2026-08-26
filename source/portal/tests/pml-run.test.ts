/**
 * Running one PML mod through the loader (lib/pml/run.ts).
 *
 * This is the join, and the reason the adapter is an adapter rather than a
 * second loader: `importPmlMod` hands `@tspml/loader` an ordinary module with a
 * default export carrying `preInit`/`init`/`ready`/`onUnload`. The loader never
 * learns what PML is, so every guarantee it already makes — per-mod failure
 * isolation, dependency order, safety classification, reverse-order unload —
 * covers a PML mod for free. These tests pin the shape of that synthetic module
 * and the translation happening behind it.
 *
 * Three things here are load-bearing in a way a shape check would miss:
 *
 *  1. **The default export is NOT the mod's own `polyMod`.** Handing that over
 *     directly would let the loader call `polyMod.init(api)` — TSPML's api where
 *     the mod expects `pml` — and the mod would die on its first `pml.` call
 *     with an error naming the wrong thing.
 *  2. **The runtime is on a global**, so every path out of this function has to
 *     take it back off. A leaked key keeps a dead mod's whole closure alive for
 *     the tab's lifetime, and the failure paths are the easy ones to forget.
 *  3. **PML is phase-major and TSPML is mod-major.** That is a real behavioural
 *     difference, not a detail — so it is reported, and only when a session
 *     actually holds enough mods for it to bite.
 *
 * `importFromSource` imports from a `blob:` URL, which does not exist in the
 * node test environment, so it is mocked. What that mock receives — the REWRITTEN
 * source — is itself asserted on, so the wrap step cannot silently stop running.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TspmlApi } from '@tspml/api';
import type { UserModRecord } from '@/lib/user-mods';

const importFromSource = vi.fn<(code: string) => Promise<unknown>>();

vi.mock('@/lib/user-mods', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  importFromSource: (code: string) => importFromSource(code),
}));

const { clearPmlSession, importPmlMod, PML_ORDER_WARNING, pmlReports } = await import('@/lib/pml/run');
const { PML_RUNTIME_GLOBAL } = await import('@/lib/pml/wrap');

/** The runtime store on the global, if any mod has published into it yet. */
function store(): Record<string, unknown> | undefined {
  return (globalThis as unknown as Record<string, Record<string, unknown> | undefined>)[
    PML_RUNTIME_GLOBAL
  ];
}

/** The runtime keys currently published on the global. */
function liveKeys(): string[] {
  const s = store();
  return s === undefined ? [] : Object.keys(s);
}

function fakeApi(): TspmlApi {
  return {
    logger: { log: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
    keybinds: { register: () => () => {}, unregister: () => {} },
    version: '0.0.0-test',
  } as unknown as TspmlApi;
}

/** A record as `translatePmlManifest` + the importer would have produced it. */
function record(over: Record<string, unknown> = {}, custom: Record<string, unknown> = {}): UserModRecord {
  return {
    manifest: {
      schemaVersion: 1,
      id: 'somemod',
      name: 'Some Mod',
      version: '1.2.0',
      environment: 'web',
      entrypoint: 'main.mod.js',
      authors: [{ name: 'someone' }],
      custom: { pml: { id: 'someMod', ...custom } },
      ...over,
    },
    code: 'import { PolyMod } from "./PolyModLoader.js";\nexport let polyMod = {};',
    format: 'pml',
  } as unknown as UserModRecord;
}

/** The loader-facing hooks `importPmlMod` returns. */
interface Hooks {
  preInit(): Promise<void>;
  init(): Promise<void>;
  ready(): Promise<void>;
  onUnload(): void;
}

/** Import `mod` as the module's `polyMod`, returning the synthetic hooks. */
async function load(
  mod: Record<string, unknown>,
  api: TspmlApi,
  rec: UserModRecord = record(),
): Promise<{ hooks: Hooks; source: string }> {
  let source = '';
  importFromSource.mockImplementationOnce((code) => {
    source = code;
    return Promise.resolve({ polyMod: mod });
  });
  const module = (await importPmlMod(rec, api)) as { default: Hooks };
  return { hooks: module.default, source };
}

beforeEach(() => {
  importFromSource.mockReset();
  const s = store();
  if (s !== undefined) for (const key of Object.keys(s)) delete s[key];
});

describe('the synthetic module handed to the loader', () => {
  it('exports the four hooks the loader drives', async () => {
    const { hooks } = await load({}, fakeApi());
    for (const hook of ['preInit', 'init', 'ready', 'onUnload']) {
      expect(typeof (hooks as unknown as Record<string, unknown>)[hook]).toBe('function');
    }
  });

  it('is NOT the mod\'s own polyMod object', async () => {
    // The distinction is the whole point. The loader calls `init(api)`; a PML
    // mod's `init` expects `pml`. Passing the mod through directly would hand
    // it TSPML's api and kill it on its first `pml.` call, with an error that
    // named neither loader.
    const mod = { init: vi.fn() };
    const { hooks } = await load(mod, fakeApi());
    expect(hooks).not.toBe(mod);
  });

  it('passes the PML runtime — not the TSPML api — to the mod\'s hooks', async () => {
    const seen: unknown[] = [];
    const mod = { init: (pml: unknown) => void seen.push(pml) };
    const api = fakeApi();
    const { hooks } = await load(mod, api);
    await hooks.init();
    expect(seen[0]).not.toBe(api);
    // What it DID get is the loader shim, which is what `pml.` resolves against.
    expect(typeof (seen[0] as { registerClassMixin?: unknown }).registerClassMixin).toBe('function');
    // ...with the api still reachable for a mod that wants the native surface.
    expect((seen[0] as { tspml?: unknown }).tspml).toBe(api);
  });

  it('imports the REWRITTEN source, not the mod\'s raw code', async () => {
    // If the wrap step stopped running, the mod's `./PolyModLoader.js` import
    // would reach a blob: URL and fail with a network error naming no cause.
    const { source } = await load({}, fakeApi());
    expect(source).toContain(PML_RUNTIME_GLOBAL);
    expect(source).not.toContain('./PolyModLoader.js');
  });

  it('calls hooks with the mod as `this`, since PML mods use class fields', async () => {
    const calls: unknown[] = [];
    const mod = {
      marker: 'me',
      init(this: { marker: string }) {
        calls.push(this.marker);
      },
    };
    const { hooks } = await load(mod, fakeApi());
    await hooks.init();
    expect(calls).toEqual(['me']);
  });

  it('tolerates a mod that defines no hooks at all', async () => {
    const { hooks } = await load({}, fakeApi());
    await expect(hooks.preInit()).resolves.toBeUndefined();
    await expect(hooks.init()).resolves.toBeUndefined();
    await expect(hooks.ready()).resolves.toBeUndefined();
    expect(() => hooks.onUnload()).not.toThrow();
  });

  it('awaits an async hook rather than racing past it', async () => {
    let finished = false;
    const mod = {
      init: async () => {
        await new Promise((r) => setTimeout(r, 1));
        finished = true;
      },
    };
    const { hooks } = await load(mod, fakeApi());
    await hooks.init();
    expect(finished).toBe(true);
  });
});

describe('PML\'s two post-init hooks share TSPML\'s one', () => {
  it('runs postInit then onGameLoad inside ready, in that order', async () => {
    // Both mean "the game is up" in PML, and PML runs them in this order. A mod
    // that initialises state in postInit and reads it in onGameLoad would break
    // if they swapped.
    const order: string[] = [];
    const mod = {
      preInit: () => void order.push('preInit'),
      init: () => void order.push('init'),
      postInit: () => void order.push('postInit'),
      onGameLoad: () => void order.push('onGameLoad'),
    };
    const { hooks } = await load(mod, fakeApi());
    await hooks.preInit();
    await hooks.init();
    await hooks.ready();
    expect(order).toEqual(['preInit', 'init', 'postInit', 'onGameLoad']);
  });

  it('runs onGameLoad even when the mod has no postInit', async () => {
    const order: string[] = [];
    const { hooks } = await load({ onGameLoad: () => void order.push('onGameLoad') }, fakeApi());
    await hooks.ready();
    expect(order).toEqual(['onGameLoad']);
  });
});

describe('the fields PML\'s own loader writes before any hook runs', () => {
  it('populates the PolyMod fields from the manifest', async () => {
    // A mod reading `this.modName` in `init` must get the manifest's name, not
    // `undefined` — PML's loader assigns these, so the adapter has to as well.
    const mod: Record<string, unknown> = {};
    await load(mod, fakeApi(), record({ icon: 'icon.png' }, { baseUrl: 'https://cdn.example/m/1.0/' }));
    expect(mod.modName).toBe('Some Mod');
    expect(mod.modID).toBe('someMod');
    expect(mod.modAuthor).toBe('someone');
    expect(mod.modVersion).toBe('1.2.0');
    expect(mod.modIconSrc).toBe('icon.png');
    expect(mod.baseUrl).toBe('https://cdn.example/m/1.0/');
    expect(mod.bundleUrl).toBe('https://cdn.example/m/1.0/');
  });

  it('uses the PML id for modID, which is what the mod identifies itself by', async () => {
    // Not the slug. `getMod` lookups and a mod's own logging both use the PML
    // id, and a mod that reported our slug would be unfindable by its peers.
    const mod: Record<string, unknown> = {};
    await load(mod, fakeApi(), record({ id: 'some-mod' }, { id: 'Some.Mod' }));
    expect(mod.modID).toBe('Some.Mod');
  });

  it('carries the physics claim across so isVanillaCompatible answers truthfully', async () => {
    const mod: Record<string, unknown> = {};
    await load(mod, fakeApi(), record({ vanillaSafe: false }));
    expect(mod.touchingPhysics).toBe(true);
  });

  it('leaves touchingPhysics false when the manifest makes no claim', async () => {
    const mod: Record<string, unknown> = {};
    await load(mod, fakeApi());
    expect(mod.touchingPhysics).toBe(false);
  });

  it('assigns the fields BEFORE the first hook is called', async () => {
    // A mod reading `this.modName` from `preInit` is normal PML code.
    let seen: unknown;
    const mod = {
      preInit(this: { modName: string }) {
        seen = this.modName;
      },
    };
    const { hooks } = await load(mod, fakeApi());
    await hooks.preInit();
    expect(seen).toBe('Some Mod');
  });

  it('falls back rather than writing undefined into a field a mod reads', async () => {
    const bare = record();
    delete (bare.manifest as Record<string, unknown>).name;
    delete (bare.manifest as Record<string, unknown>).authors;
    delete (bare.manifest as Record<string, unknown>).version;
    const mod: Record<string, unknown> = {};
    await load(mod, fakeApi(), bare);
    expect(mod.modName).toBe('someMod');
    expect(mod.modAuthor).toBe('unknown');
    expect(mod.modVersion).toBe('0.0.0');
  });
});

describe('getMod registration', () => {
  it('registers the instance under its PML id', async () => {
    const api = fakeApi();
    const seen: unknown[] = [];
    const other = { init: (pml: { getMod(id: string): unknown }) => void seen.push(pml.getMod('someMod')) };
    const mod: Record<string, unknown> = {};
    await load(mod, api);
    const { hooks } = await load(other, api, record({ id: 'two' }, { id: 'two' }));
    await hooks.init();
    expect(seen[0]).toBe(mod);
  });

  it('registers under the SLUG too, when the two differ', async () => {
    // A modpack or a mod written against our id should resolve as well; one
    // extra key costs nothing next to a getMod that silently returns undefined.
    const api = fakeApi();
    const seen: unknown[] = [];
    const mod: Record<string, unknown> = {};
    await load(mod, api, record({ id: 'some-mod' }, { id: 'Some.Mod' }));
    const other = { init: (pml: { getMod(id: string): unknown }) => void seen.push(pml.getMod('some-mod')) };
    const { hooks } = await load(other, api, record({ id: 'two' }, { id: 'two' }));
    await hooks.init();
    expect(seen[0]).toBe(mod);
  });

  it('scopes the registry to ONE api, so another session cannot see it', async () => {
    // A page that tears down and reloads builds a new api; mods from the dead
    // session must not resolve through it.
    const first = fakeApi();
    await load({ marker: 1 }, first);
    const seen: unknown[] = [];
    const other = { init: (pml: { getMod(id: string): unknown }) => void seen.push(pml.getMod('someMod')) };
    const { hooks } = await load(other, fakeApi(), record({ id: 'two' }, { id: 'two' }));
    await hooks.init();
    expect(seen[0]).toBeUndefined();
  });
});

describe('the order warning names a real divergence', () => {
  it('says nothing for a session with ONE PML mod', async () => {
    // With one mod there is no cross-mod order to get wrong, and a warning
    // nobody can act on is noise that teaches players to ignore the box.
    const api = fakeApi();
    await load({}, api);
    expect(pmlReports(api).get('somemod')?.warnings ?? []).not.toContain(PML_ORDER_WARNING);
  });

  it('warns once a SECOND PML mod loads', async () => {
    const api = fakeApi();
    await load({}, api);
    await load({}, api, record({ id: 'two' }, { id: 'two' }));
    expect(pmlReports(api).get('two')?.warnings).toContain(PML_ORDER_WARNING);
  });

  it('explains both orders and what to do about it', async () => {
    // "May behave differently" would leave the author nowhere. The text has to
    // name the two orderings and the two fixes.
    expect(PML_ORDER_WARNING).toMatch(/preInit/);
    expect(PML_ORDER_WARNING).toMatch(/dependency|declare the dependency/);
    expect(PML_ORDER_WARNING).toMatch(/postInit/);
  });
});

describe('reports reach the UI, and do not outlive their session', () => {
  it('records refusals under the TSPML mod id', async () => {
    const api = fakeApi();
    const mod = {
      init: (pml: { registerClassMixin(...a: unknown[]): void }) => pml.registerClassMixin('uf', 'prototype'),
    };
    const { hooks } = await load(mod, api);
    await hooks.init();
    expect(pmlReports(api).get('somemod')?.refusals).toHaveLength(1);
  });

  it('carries the WRAP warnings, not only the runtime\'s', async () => {
    // An unresolvable relative import is discovered during the rewrite, before
    // the runtime exists. Dropping those would lose the most actionable class
    // of warning the adapter produces.
    const api = fakeApi();
    const rec = record();
    (rec as { code: string }).code =
      'import { x } from "./helper.js";\nimport { PolyMod } from "./PolyModLoader.js";';
    await load({}, api, rec);
    expect((pmlReports(api).get('somemod')?.warnings ?? []).join(' ')).toMatch(/\.\/helper\.js/);
  });

  it('is empty for an api that ran no PML mods', () => {
    expect(pmlReports(fakeApi()).size).toBe(0);
  });

  it('clearPmlSession drops the reports the UI would re-read', async () => {
    // A WeakMap collects eventually; "eventually" is not when the page rebuilds
    // its mod list and shows the previous run's refusals as if they were new.
    const api = fakeApi();
    await load({}, api);
    expect(pmlReports(api).size).toBe(1);
    clearPmlSession(api);
    expect(pmlReports(api).size).toBe(0);
  });
});

describe('the runtime global is always cleaned up', () => {
  it('holds exactly one key per live mod', async () => {
    await load({}, fakeApi());
    expect(liveKeys()).toHaveLength(1);
  });

  it('uses a fresh key per import, so a ⟳ reload cannot clobber the old runtime', async () => {
    // The reload imports the same mod again while the previous runtime may
    // still be unregistering; one key per MOD would have the second clobber the
    // first, and the surviving mod would talk to a runtime that was torn down.
    const api = fakeApi();
    await load({}, api);
    await load({}, api);
    expect(new Set(liveKeys()).size).toBe(2);
  });

  it('unregisters when the module import THROWS', async () => {
    // The easy path to forget. A leaked entry pins the mod's whole closure for
    // the tab's lifetime.
    importFromSource.mockImplementationOnce(() => Promise.reject(new Error('boom')));
    await expect(importPmlMod(record(), fakeApi())).rejects.toThrow('boom');
    expect(liveKeys()).toEqual([]);
  });

  it('unregisters when the module exports no polyMod', async () => {
    importFromSource.mockImplementationOnce(() => Promise.resolve({ somethingElse: {} }));
    await expect(importPmlMod(record(), fakeApi())).rejects.toThrow(/polyMod/);
    expect(liveKeys()).toEqual([]);
  });

  it('onUnload takes the key back off the global', async () => {
    const { hooks } = await load({}, fakeApi());
    hooks.onUnload();
    expect(liveKeys()).toEqual([]);
  });
});

describe('a mod with no polyMod export fails with a reason, not a TypeError', () => {
  it('shows the export line the author was supposed to write', async () => {
    importFromSource.mockImplementationOnce(() => Promise.resolve({}));
    await expect(importPmlMod(record(), fakeApi())).rejects.toThrow(/export let polyMod = new SomeMod\(\)/);
  });

  it('points out when the file does not look like a PML mod AT ALL', async () => {
    // A missing export in a file that also imports nothing from PolyModLoader
    // is much more likely a mislabelled TSPML mod than a broken PML one, and
    // saying so saves the author from hunting for a typo that isn't there.
    const rec = record();
    (rec as { code: string }).code = 'export default () => ({});';
    importFromSource.mockImplementationOnce(() => Promise.resolve({}));
    await expect(importPmlMod(rec, fakeApi())).rejects.toThrow(/may not be a PML mod at all/);
  });

  it('stays quiet about that when the mod DID import PolyModLoader', async () => {
    importFromSource.mockImplementationOnce(() => Promise.resolve({}));
    await expect(importPmlMod(record(), fakeApi())).rejects.not.toThrow(/may not be a PML mod at all/);
  });
});

describe('onUnload', () => {
  it('releases keybinds the mod registered', async () => {
    const unregistered: string[] = [];
    const api = fakeApi();
    (api as { keybinds: unknown }).keybinds = {
      register: (b: { id: string }) => () => void unregistered.push(b.id),
      unregister: () => {},
    };
    const mod = {
      init: (pml: { registerKeybind(o: unknown): unknown }) =>
        pml.registerKeybind({ id: 'toggle', key: 'KeyF' }),
    };
    const { hooks } = await load(mod, api);
    await hooks.init();
    hooks.onUnload();
    expect(unregistered).toEqual(['pml.somemod.toggle']);
  });

  it('survives a keybind that throws on unregister, and logs it', async () => {
    // One bad disposer must not strand the rest of the teardown — the registry
    // deletion and the global cleanup come after it.
    const api = fakeApi();
    (api as { keybinds: unknown }).keybinds = {
      register: () => () => {
        throw new Error('nope');
      },
      unregister: () => {},
    };
    const mod = {
      init: (pml: { registerKeybind(o: unknown): unknown }) =>
        pml.registerKeybind({ id: 'toggle', key: 'KeyF' }),
    };
    const { hooks } = await load(mod, api);
    await hooks.init();
    expect(() => hooks.onUnload()).not.toThrow();
    expect(api.logger.warn).toHaveBeenCalled();
    expect(liveKeys()).toEqual([]);
  });

  it('removes the mod from getMod, so a survivor cannot reach a dead instance', async () => {
    const api = fakeApi();
    const seen: unknown[] = [];
    const { hooks } = await load({}, api);
    hooks.onUnload();
    const other = { init: (pml: { getMod(id: string): unknown }) => void seen.push(pml.getMod('someMod')) };
    const second = await load(other, api, record({ id: 'two' }, { id: 'two' }));
    await second.hooks.init();
    expect(seen[0]).toBeUndefined();
  });

  it('is idempotent — the loader may unload a mod that already failed', async () => {
    const { hooks } = await load({}, fakeApi());
    hooks.onUnload();
    expect(() => hooks.onUnload()).not.toThrow();
  });
});

/**
 * The PML runtime a PML mod actually talks to (lib/pml/shim.ts).
 *
 * This is where the adapter's honesty lives. Everything TSPML can serve, it
 * serves for real; everything it cannot, it REFUSES BY NAME rather than
 * accepting and doing nothing. That second half is the part worth testing hard,
 * because the failure mode it prevents is invisible: a mixin call that returned
 * `undefined` quietly would leave the mod loaded, reporting success, and not
 * working — the exact experience this project exists to end.
 *
 * So the assertions below are about three properties, in descending order of
 * how much a regression would cost:
 *
 *  1. **A refusal is never a throw.** PML mods register mixins from `init`, so
 *     throwing would take the whole mod down over one call — and a mod that
 *     mixes a UI patch with a keybind should keep the keybind.
 *  2. **A refusal carries a reason an author can act on.** "Not supported" is
 *     not a reason. The text has to name the mechanism and the port path.
 *  3. **The reproduced warts stay reproduced.** `getSetting` returning a string
 *     for a bool is a PML bug that mods have written around; fixing it here
 *     breaks them.
 */
import { describe, expect, it, vi } from 'vitest';
import type { TspmlApi } from '@tspml/api';
import {
  createPmlRuntime,
  MixinType,
  PolyMod,
  readPolyModExport,
  registerPmlRuntime,
  SettingType,
  unregisterPmlRuntime,
} from '@/lib/pml/shim';
import { PML_RUNTIME_GLOBAL } from '@/lib/pml/wrap';

/** A minimal api. Only `logger` and `keybinds` are reached by this file. */
function fakeApi() {
  const registered: { id: string; key: string; onDown?: (e: KeyboardEvent) => void }[] = [];
  const unregisters: string[] = [];
  const warn = vi.fn();
  const api = {
    logger: { log: vi.fn(), error: vi.fn(), warn, info: vi.fn(), debug: vi.fn() },
    keybinds: {
      register(b: { id: string; key: string; onDown?: (e: KeyboardEvent) => void }) {
        registered.push(b);
        return () => void unregisters.push(b.id);
      },
      unregister(id: string) {
        unregisters.push(id);
      },
    },
    version: '0.0.0-test',
  } as unknown as TspmlApi;
  return { api, registered, unregisters, warn };
}

function runtime(over: Partial<Parameters<typeof createPmlRuntime>[1]> = {}) {
  const f = fakeApi();
  const built = createPmlRuntime(f.api, { id: 'somemod', pmlId: 'someMod', ...over });
  return { ...f, ...built, pml: built.runtime.ActivePolyModLoader };
}

/** Every mixin family PML exposes. `registerClassMixin` is the ONE family
 *  that carries (its token-anchored types are collected — see the shim
 *  header), so it has its own describe below and is excluded from the
 *  family-refusal assertions. */
const MIXIN_METHODS = [
  'registerFuncMixin',
  'registerClassWideMixin',
  'registerGlobalMixin',
  'registerChunkMixin',
  'registerSimWorkerMixin',
  'registerSimWorkerFuncMixin',
  'registerPhysicsLibMixin',
] as const;

/** The one family that carries, in the object-spec form real PML mods ship
 *  (ghosttoggle 1.0.8 on the CDN is the reference). */
const SPEC = {
  type: 'INSERT',
  token: 'e.car.setCarState(t, !1)',
  func: ';e.car.setVisible(!1);',
} as const;

describe('the value exports a mod reads at MODULE scope', () => {
  it('provides every MixinType member PML documents', () => {
    // A mod writes `MixinType.INSERT` at module scope, so a missing member is a
    // TypeError before `init` is ever reached — the mod would not merely lose a
    // patch, it would fail to import.
    for (const k of ['INSERT', 'REPLACE', 'REPLACEBETWEEN', 'REMOVEBETWEEN', 'HEAD', 'TAIL', 'OVERRIDE', 'CONSTRUCTOR', 'PATCH_F32', 'PATCH_I32']) {
      expect(MixinType[k as keyof typeof MixinType]).toBeDefined();
    }
    for (const k of ['BOOL', 'SLIDER', 'CUSTOM', 'SELECT', 'INPUT']) {
      expect(SettingType[k as keyof typeof SettingType]).toBeDefined();
    }
  });

  it('freezes them, so one mod cannot reshape another mod\'s constants', () => {
    expect(Object.isFrozen(MixinType)).toBe(true);
    expect(Object.isFrozen(SettingType)).toBe(true);
  });
});

describe('the PolyMod base class', () => {
  it('reads its accessors off the fields the loader writes', () => {
    const mod = new PolyMod();
    Object.assign(mod, { modName: 'N', modID: 'i', modAuthor: 'a', modVersion: '1.0.0' });
    expect(mod.getName()).toBe('N');
    expect(mod.getID()).toBe('i');
    expect(mod.getAuthor()).toBe('a');
    expect(mod.getVersion()).toBe('1.0.0');
  });

  it("maps isVanillaCompatible onto PML's own touchingPhysics claim", () => {
    const mod = new PolyMod();
    // Unset is a mod making no claim, which PML treats as compatible.
    expect(mod.isVanillaCompatible()).toBe(true);
    Object.assign(mod, { touchingPhysics: true });
    expect(mod.isVanillaCompatible()).toBe(false);
  });

  it('defines NO lifecycle hooks', () => {
    // Mods override hooks as class PROPERTIES (`init = (pml) => …`), which
    // shadow prototype methods. A base-class no-op would be overwritten by
    // every mod that defines one, and `typeof mod.init === 'function'` would
    // stop meaning "the author wrote one".
    const mod = new PolyMod() as unknown as Record<string, unknown>;
    for (const hook of ['preInit', 'init', 'postInit', 'onGameLoad']) {
      expect(mod[hook]).toBeUndefined();
    }
  });
});

describe('mixins are refused per call, never thrown', () => {
  it.each(MIXIN_METHODS)('%s returns undefined instead of throwing', (method) => {
    const { pml } = runtime();
    expect(() => (pml[method] as (...a: unknown[]) => unknown)('uf', 'prototype')).not.toThrow();
    expect((pml[method] as (...a: unknown[]) => unknown)('uf', 'prototype')).toBeUndefined();
  });

  it('keeps the rest of the mod working after a refusal', () => {
    // The whole reason refusals are not throws: a mod that patches the UI via a
    // mixin AND adds a keybind must keep the keybind.
    const { pml, registered } = runtime();
    pml.registerClassMixin('uf', 'prototype');
    pml.registerKeybind({ id: 'toggle', key: 'KeyF', onPress: () => {} });
    expect(registered).toHaveLength(1);
  });

  it.each(MIXIN_METHODS)('%s explains the MECHANISM and the port path', (method) => {
    // "Not supported" would be useless. The author needs to know why the two
    // designs cannot meet, and what to write instead.
    const { pml, report } = runtime();
    (pml[method] as (...a: unknown[]) => unknown)('uf', 'prototype');
    const reason = report.refusals[0]?.reason ?? '';
    expect(reason).toMatch(/eval|string-splice/);
    expect(reason).toMatch(/mixins\.json/);
  });

  it('registerClassMixin refuses an UNSUPPORTED TYPE with the type-gate reason', () => {
    // Method-extent types (OVERRIDE and friends) are the registerClassMixin
    // calls that still refuse: they have no token to verify, so there is no
    // faithful way to apply them. The reason must say THAT, not the generic
    // family text — an author reading "module scope" would look in the wrong
    // place for the fix.
    const { pml, report } = runtime();
    pml.registerClassMixin('uf', 'prototype', { type: 'OVERRIDE', func: 'void 0;' });
    expect(report.mixins).toHaveLength(0);
    const reason = report.refusals[0]?.reason ?? '';
    expect(reason).toMatch(/method-extent/);
    expect(reason).toMatch(/OVERRIDE/);
    expect(reason).not.toMatch(/module scope/);
  });

  it('gives physics mixins their OWN reason, about the wasmHash gate', () => {
    // Not a copy-paste of the mixin reason: TSPML *can* patch physics (#43), but
    // only through a hash-pinned physics.json. A PML PATCH_F32 offset arrives
    // with no hash, and honouring it would mean writing an unverified offset
    // into the simulation that produces leaderboard evidence.
    const { pml, report } = runtime();
    pml.registerPhysicsMixin('somefunc', 0x1234);
    const reason = report.refusals[0]?.reason ?? '';
    expect(reason).toMatch(/wasmHash/);
    expect(reason).toMatch(/physics\.json/);
    expect(reason).not.toMatch(/mixins\.json/);
  });

  it("refuses the eval bridge with a reason naming TSPML's own surfaces", () => {
    const { pml, report } = runtime();
    expect(pml.getFromPolyTrack('some.path')).toBeUndefined();
    expect(pml.getFromPolyTrackGlobal('other.path')).toBeUndefined();
    expect(report.refusals).toHaveLength(2);
    for (const r of report.refusals) {
      expect(r.reason).toMatch(/eval/);
      expect(r.reason).toMatch(/api\.events/);
    }
  });
});

describe('refusals are deduped, and named by target', () => {
  it('records a repeated identical call ONCE', () => {
    // A mod registering mixins in a loop would otherwise produce a thousand
    // identical lines for an author to scroll past — which is the same as
    // producing none.
    const { pml, report, warn } = runtime();
    for (let i = 0; i < 50; i += 1) pml.registerClassMixin('uf', 'prototype');
    expect(report.refusals).toHaveLength(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('keeps refusals for DIFFERENT targets separate', () => {
    // Two distinct patches that both failed are two facts, not one.
    const { pml, report } = runtime();
    pml.registerClassMixin('uf', 'prototype');
    pml.registerClassMixin('vg', 'prototype');
    expect(report.refusals).toHaveLength(2);
    expect(report.refusals.map((r) => r.target)).toEqual(['uf.prototype', 'vg.prototype']);
  });

  it('keeps the same target separate across different METHODS', () => {
    const { pml, report } = runtime();
    pml.registerClassMixin('uf', 'prototype');
    pml.registerFuncMixin('uf', 'prototype');
    expect(report.refusals.map((r) => r.method)).toEqual(['registerClassMixin', 'registerFuncMixin']);
  });

  it('names the target from the first two STRING arguments', () => {
    // PML's mixin signatures put the class and member first and a callback
    // later; reading positionally-but-typed keeps the label meaningful across
    // the signature drift between PML versions.
    const { pml, report } = runtime();
    pml.registerFuncMixin('uf', 'update', MixinType.INSERT, 'token', () => {});
    expect(report.refusals[0]?.target).toBe('uf.update');
  });

  it('omits the target rather than inventing one when no string was passed', () => {
    const { pml, report } = runtime();
    pml.registerClassMixin(() => {});
    expect(report.refusals[0]?.target).toBeUndefined();
  });

  it('logs each refusal through the api logger, not the raw console', () => {
    // Mod diagnostics route through `api.logger` so they carry the mod tag and
    // land in the same place as everything else the loader says.
    const { pml, warn } = runtime();
    pml.registerClassMixin('uf', 'prototype');
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0]?.[0])).toContain('somemod');
  });
});

describe('token-anchored mixins are COLLECTED, not applied', () => {
  it('collects a valid object-spec registerClassMixin into report.mixins', () => {
    // The object-spec form is what real PML mods ship; the spec rides the
    // report out of the runtime so the page can persist it onto the record
    // and the next launch's plan can carry it to the transform seam.
    const { pml, report } = runtime();
    pml.registerClassMixin('ws.prototype', 'update', SPEC);
    expect(report.mixins).toHaveLength(1);
    expect(report.refusals).toHaveLength(0);
    expect(report.mixins[0]).toMatchObject({
      op: 'pml-splice',
      type: 'INSERT',
      classRef: 'ws.prototype',
      method: 'update',
      token: SPEC.token,
      func: SPEC.func,
    });
  });

  it('collects every supported type, and refuses nothing among them', () => {
    const { pml, report } = runtime();
    pml.registerClassMixin('a', 'x', SPEC);
    pml.registerClassMixin('b', 'x', { type: 'REPLACE', token: 'p', func: 'q' });
    pml.registerClassMixin('c', 'x', { type: 'REPLACEBETWEEN', tokenStart: 'p', tokenEnd: 'q', func: 'r' });
    pml.registerClassMixin('d', 'x', { type: 'REMOVEBETWEEN', tokenStart: 'p', tokenEnd: 'q' });
    expect(report.mixins.map((m) => m.type)).toEqual([
      'INSERT',
      'REPLACE',
      'REPLACEBETWEEN',
      'REMOVEBETWEEN',
    ]);
    expect(report.refusals).toHaveLength(0);
  });

  it('refuses a malformed spec (no object) per call, deduped, without throwing', () => {
    // Positional-signature calls (an older PML shape) arrive with no spec
    // object; they are malformed to the collector and must take the same
    // refused-per-call path as everything else.
    const { pml, report, warn } = runtime();
    for (let i = 0; i < 10; i += 1) pml.registerClassMixin('uf', 'prototype');
    expect(() => pml.registerClassMixin('uf', 'prototype')).not.toThrow();
    expect(report.mixins).toHaveLength(0);
    expect(report.refusals).toHaveLength(1);
    expect(report.refusals[0]?.target).toBe('uf.prototype');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('keeps collecting after a refusal in the same mod', () => {
    // The collector is per call, like the refusals: one bad spec must not
    // poison the mod's good ones.
    const { pml, report } = runtime();
    pml.registerClassMixin('uf', 'prototype');
    pml.registerClassMixin('ws.prototype', 'update', SPEC);
    expect(report.mixins).toHaveLength(1);
    expect(report.refusals).toHaveLength(1);
  });

  it('does not log a collection as a warning — collecting is success-shaped', () => {
    // A collected mixin is the half that WORKS; putting it in the warn log
    // would teach the player that every PML mod errors.
    const { pml, warn } = runtime();
    pml.registerClassMixin('ws.prototype', 'update', SPEC);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('keybinds are a REAL registration', () => {
  it('registers through api.keybinds under a namespaced id', () => {
    const { pml, registered } = runtime();
    pml.registerKeybind({ id: 'toggle', key: 'KeyF', onPress: () => {} });
    expect(registered[0]?.id).toBe('pml.somemod.toggle');
    expect(registered[0]?.key).toBe('KeyF');
  });

  it('wires the mod\'s callback to onDown', () => {
    const onPress = vi.fn();
    const { pml, registered } = runtime();
    pml.registerKeybind({ id: 'toggle', key: 'KeyF', onPress });
    registered[0]?.onDown?.({} as KeyboardEvent);
    expect(onPress).toHaveBeenCalledOnce();
  });

  it('reads a POSITIONAL signature too, because PML\'s drifted between versions', () => {
    const onPress = vi.fn();
    const { pml, registered } = runtime();
    pml.registerKeybind('toggle', 'KeyG', onPress);
    expect(registered[0]?.id).toBe('pml.somemod.toggle');
    expect(registered[0]?.key).toBe('KeyG');
  });

  it('returns the unregister function the mod can call itself', () => {
    const { pml, unregisters } = runtime();
    const off = pml.registerKeybind({ id: 'toggle', key: 'KeyF' });
    expect(typeof off).toBe('function');
    (off as () => void)();
    expect(unregisters).toEqual(['pml.somemod.toggle']);
  });

  it('collects a disposer so unloading the mod releases the bind', () => {
    const { pml, disposers, unregisters } = runtime();
    pml.registerKeybind({ id: 'toggle', key: 'KeyF' });
    expect(disposers).toHaveLength(1);
    for (const d of disposers) d();
    expect(unregisters).toEqual(['pml.somemod.toggle']);
  });

  it('skips a bind whose key it cannot read, and says so instead of guessing', () => {
    // Registering under a wrong key would be worse than not registering: the
    // player presses the documented key and nothing happens, with no message.
    const { pml, registered, report } = runtime();
    expect(pml.registerKeybind({ id: 'toggle' })).toBeUndefined();
    expect(registered).toHaveLength(0);
    expect(report.warnings.join(' ')).toMatch(/toggle/);
  });

  it('warns ONCE that binds do not appear in the game\'s Controls UI', () => {
    // True and worth saying — a player hunting for the row would never find it.
    // Worth saying once, not once per bind.
    const { pml, report } = runtime();
    pml.registerKeybind({ id: 'a', key: 'KeyA' });
    pml.registerKeybind({ id: 'b', key: 'KeyB' });
    const hits = report.warnings.filter((w) => w.startsWith('keybinds registered by this mod'));
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatch(/Controls/);
  });
});

describe('settings are stored, headless, and warty on purpose', () => {
  it('round-trips a registered setting', () => {
    const { pml } = runtime();
    pml.registerSetting({ id: 'speed', value: 5 });
    expect(pml.getSetting('speed')).toBe('5');
    pml.setSetting('speed', 9);
    expect(pml.getSetting('speed')).toBe('9');
  });

  it('returns a STRING even for a bool — reproducing PML\'s documented wart', () => {
    // PML's getSetting stringifies regardless of SettingType, and mods have
    // written around it by comparing against "true". Returning a real boolean
    // here would be tidier and would break exactly those mods.
    const { pml } = runtime();
    pml.registerSetting({ id: 'on', value: true });
    expect(pml.getSetting('on')).toBe('true');
    expect(typeof pml.getSetting('on')).toBe('string');
  });

  it('returns an empty string for a setting that was never registered', () => {
    expect(runtime().pml.getSetting('nope')).toBe('');
  });

  it('accepts a set before a register rather than dropping the value', () => {
    const { pml } = runtime();
    pml.setSetting('late', 'x');
    expect(pml.getSetting('late')).toBe('x');
  });

  it('warns ONCE that there is no panel to change them from', () => {
    const { pml, report } = runtime();
    pml.registerSetting({ id: 'a', value: 1 });
    pml.registerSetting({ id: 'b', value: 2 });
    const hits = report.warnings.filter((w) => w.startsWith('this mod registers settings'));
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatch(/defaults/);
  });

  it('ignores an unreadable setting id and names the problem', () => {
    const { pml, report } = runtime();
    pml.registerSetting(42);
    expect(report.warnings.join(' ')).toMatch(/no readable id/);
  });
});

describe('getMod resolves against THIS session', () => {
  it('finds a mod registered under its PML id', () => {
    const registry = new Map<string, unknown>();
    const other = { modID: 'otherMod', hello: 1 };
    registry.set('otherMod', other);
    const { pml } = runtime({ registry });
    expect(pml.getMod('otherMod')).toBe(other);
  });

  it('shares the registry, so registerMod is visible to getMod', () => {
    const registry = new Map<string, unknown>();
    const a = runtime({ registry });
    const b = runtime({ id: 'two', pmlId: 'two', registry });
    a.pml.registerMod({ modID: 'fromA' });
    expect(b.pml.getMod('fromA')).toEqual({ modID: 'fromA' });
  });

  it('returns undefined for a miss AND says which id missed', () => {
    // A silent undefined surfaces as `Cannot read properties of undefined` in
    // the CALLING mod, naming neither the lookup nor the missing mod.
    const { pml, report } = runtime();
    expect(pml.getMod('ghost')).toBeUndefined();
    expect(report.warnings.join(' ')).toMatch(/getMod\('ghost'\)/);
    expect(report.warnings.join(' ')).toMatch(/not loaded here/);
  });

  it('ignores a registerMod call with no usable id', () => {
    const { pml } = runtime();
    expect(() => pml.registerMod(null)).not.toThrow();
    expect(() => pml.registerMod({})).not.toThrow();
  });
});

describe('the runtime is exposed on a global, and taken back off it', () => {
  it('publishes under the key the rewritten source reads', () => {
    const { runtime: rt } = runtime();
    registerPmlRuntime('k1', rt);
    const store = (globalThis as unknown as Record<string, Record<string, unknown>>)[PML_RUNTIME_GLOBAL];
    expect(store?.k1).toBe(rt);
    unregisterPmlRuntime('k1');
    expect(store?.k1).toBeUndefined();
  });

  it('unregisters cleanly for a key that was never there', () => {
    expect(() => unregisterPmlRuntime('never')).not.toThrow();
  });
});

describe('readPolyModExport', () => {
  it('reads `polyMod`, which is what PML mods actually export', () => {
    const mod = { modID: 'x' };
    expect(readPolyModExport({ polyMod: mod })).toBe(mod);
  });

  it('falls back to a default export', () => {
    const mod = { modID: 'x' };
    expect(readPolyModExport({ default: mod })).toBe(mod);
  });

  it('prefers `polyMod` when a module has both', () => {
    const named = { modID: 'named' };
    expect(readPolyModExport({ polyMod: named, default: { modID: 'other' } })).toBe(named);
  });

  it('returns null for a module that exports neither', () => {
    for (const v of [null, undefined, 'a string', {}, { polyMod: null }, { polyMod: 'not an object' }]) {
      expect(readPolyModExport(v)).toBeNull();
    }
  });
});

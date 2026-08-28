/**
 * The PML runtime a PML mod actually talks to, implemented over TSPML's api.
 *
 * TSPML is not becoming PML. This file is an ADAPTER: it gives a PML mod the
 * object it expects to receive (`pml`, and the `PolyMod` base class it extends)
 * and services the calls it makes out of TSPML's own event bus, keybind
 * registry and logger. The native TSPML format is untouched by any of it — a
 * TSPML mod never reaches this code, and nothing here relaxes a rule the native
 * path enforces.
 *
 * ## What carries, and what cannot
 *
 * The line falls exactly where the two loaders' patching models diverge:
 *
 * | PML surface | Here |
 * | --- | --- |
 * | `preInit` / `init` / `postInit` / `onGameLoad` | run, in order |
 * | `registerKeybind` | real keybind, via `api.keybinds` |
 * | `registerSetting` / `getSetting` / `setSetting` | stored, headless |
 * | `getMod(id)` | resolves against the mods loaded THIS session |
 * | `registerClassMixin` (token-anchored types) | **collected, applied at the transform seam on next launch** |
 * | other mixin families (`Func`/`ClassWide`/`Global`/`Chunk`/`SimWorker`) | **refused, per call** |
 * | `registerPhysicsMixin` and `PATCH_F32`/`PATCH_I32` | **refused, per call** |
 * | `getFromPolyTrack` / `getFromPolyTrackGlobal` | **refused, per call** |
 *
 * Mixins USED to be refused outright, and the reason was real: PML patches by
 * token-matching the live minified bundle, and by the time a mod's `init` runs
 * here that bundle has already been transformed and shipped — there is no live
 * function to rewrite and no `eval` sink to rewrite it through. The fix is not
 * to fake a live target but to move the application to where TSPML already
 * patches: `registerClassMixin` calls are COLLECTED here (validated per call —
 * a spec this adapter cannot carry is still refused with a reason), persisted
 * with the mod, and spliced into the served source at the transform seam,
 * BEFORE Babel, because PML's tokens are written in Kodub's own minified
 * formatting and would not survive a regeneration. `./splice.ts` owns the
 * patch language and its exactly-once anchor rule.
 *
 * The consequence worth stating to a player: a PML mod's mixins apply on the
 * NEXT launch, not the one that collected them. The first boot after install
 * registers and reports; the reload applies. That is the same shape as every
 * other plan-carrying feature here (physics included), because the plan must
 * be parked before the frame's first fetch.
 *
 * The families still refused are refused for structure, not effort: they
 * anchor to a scope or file this adapter never holds (module-scoped functions,
 * the worker bundle), and the method-extent types (`HEAD`/`TAIL`/`OVERRIDE`/
 * `CONSTRUCTOR`) need the live class PML resolves them against.
 *
 * `registerPhysicsMixin` is refused for a sharper reason. TSPML *can* patch the
 * physics binary (#43), but only through a `physics.json` pinned to a
 * `wasmHash`: the gate is fail-closed, so a stale offset refuses instead of
 * writing to arbitrary memory in a simulation whose output is leaderboard
 * evidence. A PML mod's raw `PATCH_F32` offset arrives with no hash and no way
 * to verify it against the binary in front of us. Honouring it would mean
 * writing an unverified offset into the physics WASM — trading the one
 * advantage that is actually structural ("the moat is the failure mode, not the
 * frequency") for the appearance of compatibility.
 *
 * ## Refusals are reported, never thrown
 *
 * A refused call returns `undefined` and appends to a report. It does NOT
 * throw, because PML mods register mixins from `init` and a throw there would
 * take down the whole mod over one call — PML's own boot-aborting behaviour,
 * reproduced. A mod that patches the UI through a mixin and also adds a keybind
 * keeps the keybind and is told, by name, that the mixin did not apply.
 */
import type { TspmlApi } from '@tspml/api';
import { PML_RUNTIME_GLOBAL } from './wrap';
import { parsePmlMixinSpec, type PmlSplicePatch } from './splice';

/** One thing the adapter could not do, with the reason the author needs. */
export interface PmlRefusal {
  /** The PML method called (`registerClassMixin`, `getFromPolyTrack`, …). */
  readonly method: string;
  /** What the call was aimed at, when the arguments say (`'uf.prototype'`). */
  readonly target?: string;
  /** Why it could not be honoured, in a sentence the author can act on. */
  readonly reason: string;
}

/** Everything the adapter has to say about one mod's run. */
export interface PmlModReport {
  readonly refusals: readonly PmlRefusal[];
  readonly warnings: readonly string[];
  /**
   * Token-anchored mixins the mod registered, collected for the transform
   * seam. NOT applied yet — see the file header: they ride the plan and apply
   * on the NEXT launch, after the page persists them onto the mod's record.
   */
  readonly mixins: readonly PmlSplicePatch[];
}

/** A setting as PML declares it (values are stored, never rendered). */
interface PmlSetting {
  readonly id: string;
  value: unknown;
}

/**
 * `MixinType`, as a value.
 *
 * The members are the ones PML documents. They are opaque tags here — nothing
 * consumes them, since every call that takes one is refused — but a mod writes
 * `MixinType.INSERT` at module scope, so a missing member is a `TypeError`
 * before `init` ever runs.
 */
export const MixinType = Object.freeze({
  INSERT: 'INSERT',
  REPLACE: 'REPLACE',
  REPLACEBETWEEN: 'REPLACEBETWEEN',
  REMOVEBETWEEN: 'REMOVEBETWEEN',
  HEAD: 'HEAD',
  TAIL: 'TAIL',
  OVERRIDE: 'OVERRIDE',
  CONSTRUCTOR: 'CONSTRUCTOR',
  PATCH_F32: 'PATCH_F32',
  PATCH_I32: 'PATCH_I32',
});

/** `SettingType`, as a value. Same rationale as {@link MixinType}. */
export const SettingType = Object.freeze({
  BOOL: 'bool',
  SLIDER: 'slider',
  CUSTOM: 'custom',
  SELECT: 'select',
  INPUT: 'input',
});

/**
 * The `PolyMod` base class a mod extends.
 *
 * Deliberately close to empty. PML's own `PolyMod` is largely fields the LOADER
 * writes (`modName`, `modID`, `modAuthor`, `bundleUrl`, …) plus the four
 * lifecycle hooks, which mods override as class properties (`init = (pml) => …`).
 * Class properties shadow prototype methods, so anything defined here would be
 * overwritten by every mod that overrides it — which is why the hooks are absent
 * rather than no-ops: `typeof mod.init === 'function'` then means "the author
 * wrote one", not "the base class has one".
 */
export class PolyMod {
  /** Set by the adapter from the translated manifest before any hook runs. */
  declare modName: string;
  declare modID: string;
  declare modAuthor: string;
  declare modVersion: string;
  declare modIconSrc: string | undefined;
  declare baseUrl: string | undefined;
  declare bundleUrl: string | undefined;
  /** PML mods read this to branch on the multiplayer-safety claim. */
  declare touchingPhysics: boolean;

  getName(): string {
    return this.modName;
  }
  getID(): string {
    return this.modID;
  }
  getAuthor(): string {
    return this.modAuthor;
  }
  getVersion(): string {
    return this.modVersion;
  }
  /** PML's own name for "does this mod keep times comparable". */
  isVanillaCompatible(): boolean {
    return this.touchingPhysics !== true;
  }
}

/** A PML mod instance, as far as the adapter reads it. */
export interface PmlModInstance {
  preInit?: (pml: unknown) => unknown;
  init?: (pml: unknown) => unknown;
  postInit?: () => unknown;
  onGameLoad?: () => unknown;
  [key: string]: unknown;
}

export interface PmlRuntimeOptions {
  /** The mod's TSPML id, for log prefixes and `getMod` registration. */
  readonly id: string;
  /** The original PML id — what `getMod("<id>")` is called with. */
  readonly pmlId: string;
  /** Manifest facts the `PolyMod` fields are populated from. */
  readonly meta?: {
    readonly name?: string;
    readonly author?: string;
    readonly version?: string;
    readonly icon?: string;
    readonly baseUrl?: string;
    readonly touchingPhysics?: boolean;
  };
  /** Where mods registered this session are looked up (`getMod`). Shared. */
  readonly registry?: Map<string, unknown>;
}

/** The object the rewritten import binds to, plus the report it fills in. */
export interface PmlRuntime {
  readonly PolyMod: typeof PolyMod;
  readonly MixinType: typeof MixinType;
  readonly SettingType: typeof SettingType;
  readonly ActivePolyModLoader: PmlLoaderShim;
  readonly PolyModLoader: PmlLoaderShim;
}

/**
 * The `pml` object — PML's `ActivePolyModLoader`, as much of it as can be
 * honestly served.
 */
export interface PmlLoaderShim {
  registerMod(mod: unknown): void;
  getMod(id: string): unknown;
  registerKeybind(...args: unknown[]): unknown;
  registerBindCategory(...args: unknown[]): void;
  getKeybind(id: string): unknown;
  registerSetting(...args: unknown[]): unknown;
  registerSettingCategory(...args: unknown[]): void;
  getSetting(id: string): string;
  setSetting(id: string, value: unknown): void;
  registerClassMixin(...args: unknown[]): void;
  registerFuncMixin(...args: unknown[]): void;
  registerClassWideMixin(...args: unknown[]): void;
  registerGlobalMixin(...args: unknown[]): void;
  registerChunkMixin(...args: unknown[]): void;
  registerSimWorkerMixin(...args: unknown[]): void;
  registerSimWorkerFuncMixin(...args: unknown[]): void;
  registerPhysicsLibMixin(...args: unknown[]): void;
  registerPhysicsMixin(...args: unknown[]): void;
  getFromPolyTrack(path: string): unknown;
  getFromPolyTrackGlobal(path: string): unknown;
  /** TSPML addition, not PML: the api the mod could be using directly. */
  readonly tspml: TspmlApi;
  [key: string]: unknown;
}

/** The reason text for every mixin-FAMILY refusal (the token-anchored
 *  `registerClassMixin` types are collected instead — see the file header).
 *  Written once — the whole point is that an author reads the SAME explanation
 *  whichever family they hit. */
const MIXIN_REASON =
  'PML mixins string-splice the live minified bundle at runtime (toString + indexOf + eval). Token-anchored registerClassMixin calls carry across — collected here and applied to the served source at the transform seam; this mixin family anchors to module scope, which no translation of a served bundle can reach. Port this patch to a TSPML mixins.json (anchored to a mapped symbol) to have it apply.';

const PHYSICS_REASON =
  'PML physics mixins write a raw byte offset into polytrack_physics.wasm. TSPML applies physics patches only through a physics.json pinned to a wasmHash, so a stale offset refuses instead of writing into an unverified binary — and this call arrives with no hash to check. Port it to a physics.json to have it apply.';

const EVAL_REASON =
  'this reads game internals through PML\'s eval bridge, which exists only inside PML\'s own patched bundle. TSPML serves an unpatched game with no eval sink, so there is nothing to resolve the path against. Use the api.events / api.keybinds / api.editor surfaces, or a mixins.json anchor, to reach the same state.';

function describeTarget(args: readonly unknown[]): string | undefined {
  const parts = args.filter((a): a is string => typeof a === 'string').slice(0, 2);
  return parts.length > 0 ? parts.join('.') : undefined;
}

/**
 * Build the runtime one PML mod sees.
 *
 * `report` is returned alongside so the caller can surface refusals in the UI
 * rather than only in the console — a refusal nobody reads is the same silence
 * as no refusal at all.
 */
export function createPmlRuntime(
  api: TspmlApi,
  options: PmlRuntimeOptions,
): { readonly runtime: PmlRuntime; readonly report: PmlModReport; readonly disposers: Array<() => void> } {
  const refusals: PmlRefusal[] = [];
  const warnings: string[] = [];
  // Token-anchored mixin specs collected from registerClassMixin — see the
  // file header for why collection (not application) is this runtime's job.
  const mixins: PmlSplicePatch[] = [];
  const disposers: Array<() => void> = [];
  const settings = new Map<string, PmlSetting>();
  const registry = options.registry ?? new Map<string, unknown>();
  const tag = `[tspml:pml:${options.id}]`;

  /** Record a refusal once per (method, target) — a mod in a loop must not
   *  produce a thousand identical lines the author has to scroll past. */
  const refuse = (method: string, reason: string, args: readonly unknown[]): undefined => {
    const target = describeTarget(args);
    const seen = refusals.some((r) => r.method === method && r.target === target);
    if (!seen) {
      refusals.push({ method, ...(target === undefined ? {} : { target }), reason });
      api.logger.warn(`${tag} ${method}${target ? ` (${target})` : ''} was not applied — ${reason}`);
    }
    return undefined;
  };

  const mixinRefusal =
    (method: string, reason = MIXIN_REASON) =>
    (...args: unknown[]): undefined =>
      refuse(method, reason, args);

  const loader: PmlLoaderShim = {
    tspml: api,

    registerMod(mod: unknown): void {
      // PML's loader calls this itself; a mod calling it is registering a
      // SECOND mod object, which the adapter has no manifest for.
      if (mod !== null && typeof mod === 'object') {
        const id = (mod as { modID?: unknown }).modID;
        if (typeof id === 'string' && id.length > 0) registry.set(id, mod);
      }
    },

    getMod(id: string): unknown {
      const found = registry.get(id);
      if (found === undefined) {
        warnings.push(
          `pml.getMod('${id}') found nothing — that mod is not loaded here (PML mods reach each other by PML id, and only mods installed in this instance are visible)`,
        );
      }
      return found;
    },

    // ── keybinds: a real registration ─────────────────────────────────────
    registerKeybind(...args: unknown[]): unknown {
      // PML's signature has drifted across versions; read POSITIONALLY for the
      // two things TSPML needs and accept an options object for either.
      const first = args[0];
      const opts = (typeof first === 'object' && first !== null ? first : {}) as Record<string, unknown>;
      const id = str(opts.id) ?? str(args[0]) ?? `${options.id}.bind${settings.size}`;
      const key = str(opts.key) ?? str(opts.defaultKey) ?? str(args[2]) ?? str(args[1]);
      const onDown = fn(opts.onPress) ?? fn(opts.onDown) ?? args.find((a) => typeof a === 'function');
      if (key === null || key === undefined) {
        warnings.push(
          `a keybind ('${id}') declared no key this adapter could read, so it was not registered — PML's registerKeybind signature varies by version`,
        );
        return undefined;
      }
      const unregister = api.keybinds.register({
        id: `pml.${options.id}.${id}`,
        key,
        ...(typeof onDown === 'function' ? { onDown: onDown as (e: KeyboardEvent) => void } : {}),
        description: `${options.meta?.name ?? options.pmlId}: ${id}`,
      });
      disposers.push(unregister);
      // PML keybinds appear in the game's own Controls UI; TSPML's run as a
      // parallel listener and do not. Say so once rather than let the player
      // hunt for a row that will never be there.
      if (!warnings.some((w) => w.startsWith('keybinds registered by this mod'))) {
        warnings.push(
          'keybinds registered by this mod work, but do not appear in the game\'s Controls settings and are not checked against its conflict rules (TSPML binds run as a parallel listener)',
        );
      }
      return unregister;
    },

    registerBindCategory(): void {
      // Purely a UI grouping in PML, and there is no settings UI here.
    },

    getKeybind(id: string): unknown {
      return `pml.${options.id}.${id}`;
    },

    // ── settings: stored, headless ────────────────────────────────────────
    registerSetting(...args: unknown[]): unknown {
      const first = args[0];
      const opts = (typeof first === 'object' && first !== null ? first : {}) as Record<string, unknown>;
      const id = str(opts.id) ?? str(args[0]);
      if (id === null) {
        warnings.push('a setting was registered with no readable id and was ignored');
        return undefined;
      }
      const initial = 'value' in opts ? opts.value : args.find((a, i) => i > 0 && typeof a !== 'function');
      settings.set(id, { id, value: initial });
      if (!warnings.some((w) => w.startsWith('this mod registers settings'))) {
        warnings.push(
          'this mod registers settings. They are stored and readable by the mod, but TSPML has no PML settings panel, so there is no UI to change them from — they keep their declared defaults.',
        );
      }
      return undefined;
    },

    registerSettingCategory(): void {
      // UI grouping only; see registerSetting.
    },

    /**
     * PML's `getSetting()` returns a STRING regardless of the declared
     * `SettingType` — a documented wart that mods have written around, often by
     * comparing against `"true"`. Returning a boolean here would be tidier and
     * would break exactly those mods, so the wart is reproduced deliberately.
     */
    getSetting(id: string): string {
      const found = settings.get(id);
      if (found === undefined) return '';
      return found.value === undefined || found.value === null ? '' : String(found.value);
    },

    setSetting(id: string, value: unknown): void {
      const found = settings.get(id);
      if (found === undefined) settings.set(id, { id, value });
      else found.value = value;
    },

    // ── mixins: collected here, applied at the transform seam ─────────────
    // The ONE family that carries. The spec is validated per call; anything
    // this adapter cannot faithfully splice is refused below like the other
    // families, so a mod always gets an answer it can read in the report.
    registerClassMixin(classRef: unknown, method: unknown, spec: unknown): void {
      const parsed = parsePmlMixinSpec(classRef, method, spec);
      if (!parsed.ok) {
        // Through the shared `refuse` — a malformed spec deserves the same
        // dedupe and logger treatment as a refused family, and a mod in a loop
        // must not flood its own report.
        refuse('registerClassMixin', parsed.reason, [classRef, method]);
        return;
      }
      mixins.push(parsed.patch);
    },
    registerFuncMixin: mixinRefusal('registerFuncMixin'),
    registerClassWideMixin: mixinRefusal('registerClassWideMixin'),
    registerGlobalMixin: mixinRefusal('registerGlobalMixin'),
    registerChunkMixin: mixinRefusal('registerChunkMixin'),
    registerSimWorkerMixin: mixinRefusal('registerSimWorkerMixin'),
    registerSimWorkerFuncMixin: mixinRefusal('registerSimWorkerFuncMixin'),
    registerPhysicsLibMixin: mixinRefusal('registerPhysicsLibMixin'),
    registerPhysicsMixin: mixinRefusal('registerPhysicsMixin', PHYSICS_REASON),
    getFromPolyTrack: (path: string): unknown => refuse('getFromPolyTrack', EVAL_REASON, [path]),
    getFromPolyTrackGlobal: (path: string): unknown =>
      refuse('getFromPolyTrackGlobal', EVAL_REASON, [path]),
  };

  const runtime: PmlRuntime = {
    PolyMod,
    MixinType,
    SettingType,
    ActivePolyModLoader: loader,
    PolyModLoader: loader,
  };

  return { runtime, report: { refusals, warnings, mixins }, disposers };
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function fn(v: unknown): ((...a: unknown[]) => unknown) | undefined {
  return typeof v === 'function' ? (v as (...a: unknown[]) => unknown) : undefined;
}

/** Where runtimes live while a mod's module is being imported. */
type RuntimeGlobal = Record<string, PmlRuntime>;

function runtimeStore(): RuntimeGlobal {
  const g = globalThis as unknown as Record<string, RuntimeGlobal | undefined>;
  const existing = g[PML_RUNTIME_GLOBAL];
  if (existing !== undefined) return existing;
  const created: RuntimeGlobal = {};
  g[PML_RUNTIME_GLOBAL] = created;
  return created;
}

/** Publish `runtime` under `key` so rewritten source can read it. */
export function registerPmlRuntime(key: string, runtime: PmlRuntime): void {
  runtimeStore()[key] = runtime;
}

/**
 * Drop `key`. The runtime is registered on a global so a Blob-URL module can
 * reach it, and a global that is only ever added to is a leak that keeps every
 * unloaded mod's closure alive for the tab's lifetime.
 */
export function unregisterPmlRuntime(key: string): void {
  delete runtimeStore()[key];
}

/**
 * The `polyMod` export of an imported PML module, or null.
 *
 * Read from the module NAMESPACE rather than a default export, because that is
 * what PML mods actually write (`export let polyMod = new MyMod()`), and because
 * doing it here means `export { thing as polyMod }` works without the source
 * rewrite having to understand export forms.
 */
export function readPolyModExport(module: unknown): PmlModInstance | null {
  if (module === null || typeof module !== 'object') return null;
  const ns = module as Record<string, unknown>;
  const candidate = ns.polyMod ?? ns.default;
  if (candidate === null || typeof candidate !== 'object') return null;
  return candidate as PmlModInstance;
}

/**
 * Running one PML mod: the join between the adapter and `@tspml/loader`.
 *
 * The loader is not taught about PML. It imports an entry specifier and expects
 * a module with a default export carrying `preInit`/`init`/`ready`/`onUnload`.
 * So that is exactly what this file hands it — a SYNTHETIC module wrapping the
 * mod's own `polyMod` instance. Every guarantee the loader provides (per-mod
 * failure isolation, dependency ordering, safety classification, reverse-order
 * unload) therefore applies to a PML mod unchanged, because from the loader's
 * side there is no PML mod, only another module.
 *
 * ## Lifecycle, and where the two loaders genuinely disagree
 *
 * | PML | here |
 * | --- | --- |
 * | `preInit(pml)` | `preInit(api)` |
 * | `init(pml)` | `init(api)` |
 * | `postInit()` | `ready(api)`, first |
 * | `onGameLoad()` | `ready(api)`, second |
 *
 * `postInit` and `onGameLoad` share a slot because TSPML has one hook after
 * `init` and PML has two, and both of PML's mean "the game is up now".
 *
 * The disagreement worth stating plainly is ORDER ACROSS MODS. PML runs
 * `preInit` for every mod, then `init` for every mod, then `postInit` for every
 * mod — phase-major. TSPML's loader runs all three hooks for one mod before
 * moving to the next — mod-major, with dependency order deciding which mod goes
 * first. For a mod that only touches its own state these are identical. For two
 * PML mods where one reads the other's `init` output from its own `preInit`,
 * they are not, and dependency order is what saves it — which is why
 * {@link PML_ORDER_WARNING} is reported rather than left for the author to
 * discover from a `undefined is not an object` in someone else's mod.
 */
import type { TspmlApi } from '@tspml/api';
import type { UserModRecord } from '../user-mods';
import { importFromSource } from '../user-mods';
import {
  createPmlRuntime,
  readPolyModExport,
  registerPmlRuntime,
  unregisterPmlRuntime,
  type PmlModReport,
  type PmlRuntimeOptions,
} from './shim';
import { buildPmlModuleSource } from './wrap';

/** Said once per session, and only when a session holds more than one PML mod:
 *  with one mod there is no cross-mod order to get wrong. */
export const PML_ORDER_WARNING =
  'more than one PML mod is loaded. PML runs every mod\'s preInit, then every mod\'s init; TSPML runs one mod\'s hooks through to completion before starting the next (in dependency order). A PML mod that reads another PML mod\'s init output from its own preInit may see it missing — declare the dependency, or move the read to postInit.';

/**
 * Everything one PML mod had to say, keyed by TSPML mod id.
 *
 * Per-api rather than module-global: a page that tears down and reloads its
 * mods builds a new api, and reports from the previous run must not survive
 * into the new one's UI. A WeakMap also means nothing pins a dead api alive.
 */
const reports = new WeakMap<TspmlApi, Map<string, PmlModReport>>();

/** `getMod` has to see mods from the SAME session and no others — same keying,
 *  same reason. */
const registries = new WeakMap<TspmlApi, Map<string, unknown>>();

function sessionMap<V>(store: WeakMap<TspmlApi, Map<string, V>>, api: TspmlApi): Map<string, V> {
  const existing = store.get(api);
  if (existing !== undefined) return existing;
  const created = new Map<string, V>();
  store.set(api, created);
  return created;
}

/** What the adapter could not do, for every PML mod in this session. */
export function pmlReports(api: TspmlApi): ReadonlyMap<string, PmlModReport> {
  return reports.get(api) ?? new Map();
}

/** Drop this session's reports and registry. Called by the teardown path — a
 *  WeakMap collects eventually, but "eventually" is not when the UI re-reads. */
export function clearPmlSession(api: TspmlApi): void {
  reports.delete(api);
  registries.delete(api);
}

/** Read `custom.pml` off a translated manifest without trusting its shape:
 *  a record can be edited by hand in localStorage and still reach here. */
function pmlCustom(manifest: Record<string, unknown>): Record<string, unknown> {
  const custom = manifest.custom;
  if (typeof custom !== 'object' || custom === null) return {};
  const pml = (custom as Record<string, unknown>).pml;
  return typeof pml === 'object' && pml !== null ? (pml as Record<string, unknown>) : {};
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** The manifest's first author name, which is where `translatePmlManifest` put
 *  PML's single `author` string. */
function firstAuthor(manifest: Record<string, unknown>): string | undefined {
  const authors = manifest.authors;
  if (!Array.isArray(authors) || authors.length === 0) return undefined;
  const first = authors[0] as unknown;
  if (typeof first === 'string') return first;
  if (typeof first === 'object' && first !== null) return str((first as { name?: unknown }).name);
  return undefined;
}

/**
 * Import `record` as a PML mod and return a module the loader can drive.
 *
 * The returned default export is NOT the mod's own `polyMod` object: it is a
 * small adapter instance holding the hooks. Handing the loader `polyMod`
 * directly would let it call `polyMod.init(api)` — passing TSPML's `api` where
 * the mod expects `pml` — and the mod would fail on the first `pml.` call with
 * an error naming the wrong thing entirely.
 */
export async function importPmlMod(record: UserModRecord, api: TspmlApi): Promise<unknown> {
  const manifest = record.manifest;
  const id = typeof manifest.id === 'string' ? manifest.id : 'pml-mod';
  const custom = pmlCustom(manifest);
  const pmlId = str(custom.id) ?? id;

  // Unique per import, not per mod: a ⟳ reload imports the same mod again while
  // the previous runtime may still be unregistering, and two live runtimes under
  // one key would have the second clobber the first.
  const key = `${id}#${Math.random().toString(36).slice(2, 10)}`;

  const options: PmlRuntimeOptions = {
    id,
    pmlId,
    meta: {
      ...(str(manifest.name) === undefined ? {} : { name: str(manifest.name)! }),
      ...(firstAuthor(manifest) === undefined ? {} : { author: firstAuthor(manifest)! }),
      ...(str(manifest.version) === undefined ? {} : { version: str(manifest.version)! }),
      ...(str(manifest.icon) === undefined ? {} : { icon: str(manifest.icon)! }),
      ...(str(custom.baseUrl) === undefined ? {} : { baseUrl: str(custom.baseUrl)! }),
      touchingPhysics: manifest.vanillaSafe === false,
    },
    registry: sessionMap(registries, api),
  };

  const { runtime, report, disposers } = createPmlRuntime(api, options);
  const wrapped = buildPmlModuleSource(record.code, key);
  const warnings = [...report.warnings, ...wrapped.warnings];

  registerPmlRuntime(key, runtime);
  let namespace: unknown;
  try {
    namespace = await importFromSource(wrapped.source);
  } catch (e) {
    // The runtime must not outlive a failed import — it is on a global, and a
    // leaked entry keeps this mod's whole closure alive for the tab's lifetime.
    unregisterPmlRuntime(key);
    throw e;
  }

  const instance = readPolyModExport(namespace);
  if (instance === null) {
    unregisterPmlRuntime(key);
    throw new Error(
      `this PML mod exports no 'polyMod' — a PML entry file is expected to end with something like \`export let polyMod = new ${
        str(manifest.name)?.replace(/\W+/g, '') ?? 'MyMod'
      }()\`. ${
        wrapped.redirected === 0
          ? 'It also imports nothing from PolyModLoader, so it may not be a PML mod at all.'
          : ''
      }`.trim(),
    );
  }

  // Fields PML's own loader writes onto the instance before any hook runs. A
  // mod reading `this.modName` in `init` gets the manifest's name, not
  // `undefined` — and `isVanillaCompatible()` answers from the real claim.
  Object.assign(instance, {
    modName: options.meta?.name ?? pmlId,
    modID: pmlId,
    modAuthor: options.meta?.author ?? 'unknown',
    modVersion: options.meta?.version ?? '0.0.0',
    modIconSrc: options.meta?.icon,
    baseUrl: options.meta?.baseUrl,
    bundleUrl: options.meta?.baseUrl,
    touchingPhysics: options.meta?.touchingPhysics === true,
  });

  const registry = sessionMap(registries, api);
  registry.set(pmlId, instance);
  // Also under the slugified TSPML id, when they differ: a mod written against
  // the slug (or a modpack that only knows our id) should resolve too, and one
  // extra key costs nothing next to a getMod that silently returns undefined.
  if (id !== pmlId) registry.set(id, instance);

  const sessionReports = sessionMap(reports, api);
  if (sessionReports.size > 0 && !warnings.includes(PML_ORDER_WARNING)) {
    warnings.push(PML_ORDER_WARNING);
  }
  sessionReports.set(id, { refusals: report.refusals, warnings });

  const call = async (hook: 'preInit' | 'init' | 'postInit' | 'onGameLoad'): Promise<void> => {
    const fn = instance[hook];
    if (typeof fn !== 'function') return;
    // PML passes `pml` to preInit/init and nothing to postInit/onGameLoad. Pass
    // it to all four: an extra argument is invisible to a zero-arity function,
    // and a mod that DID declare a parameter on postInit gets something useful.
    await (fn as (pml: unknown) => unknown).call(instance, runtime.ActivePolyModLoader);
  };

  return {
    default: {
      preInit: () => call('preInit'),
      init: () => call('init'),
      ready: async () => {
        await call('postInit');
        await call('onGameLoad');
      },
      onUnload: () => {
        // Keybinds first: they are live listeners, and the mod's own cleanup
        // (if it has any) may assume its binds are gone.
        for (const dispose of disposers) {
          try {
            dispose();
          } catch (e) {
            api.logger.warn(`[tspml:pml:${id}] a keybind failed to unregister: ${String(e)}`);
          }
        }
        disposers.length = 0;
        registry.delete(pmlId);
        registry.delete(id);
        unregisterPmlRuntime(key);
        // PML has no unload hook at all — mods never wrote one, so there is
        // nothing of the mod's own to call here. Whatever it did to the page
        // beyond keybinds stays done until reload, and that is PML's model
        // rather than something this adapter dropped.
      },
    },
  };
}

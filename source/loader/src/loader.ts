import type {
  LoadResult,
  Mod,
  ModApi,
  ModLoadStatus,
  ModUnloadStatus,
  ResolveContext,
  UnloadResult,
  VersionManifest,
  Warning,
} from './types.js';
import { stubApi } from './types.js';
import { ManifestError, parseVersionManifest } from './manifest.js';
import { modFromManifest, resolveDependencies } from './dependency.js';

/**
 * A mod awaiting load. `manifest` is the raw `mod.json`-shaped object; the
 * loader parses + validates it (isolating failures per mod). `entry` overrides
 * the entrypoint specifier — handy for tests, which inject a fake
 * {@link LoadOptions.importEntry} and so never touch the filesystem.
 */
export interface ModDescriptor {
  manifest: unknown;
  /** Defaults to `manifest.entrypoint`. */
  entry?: string;
  /** Higher = loads earlier. Tiebreak only. */
  priority?: number;
}

export interface LoadOptions {
  /** Ambient versions for the special dep ids `polytrack` / `tspml` / `tspml-api`. */
  context?: ResolveContext;
  /**
   * Custom entrypoint loader. Defaults to the host dynamic `import()`. Inject a
   * fake in tests to avoid real files (the recommended pattern).
   */
  importEntry?: (specifier: string) => Promise<unknown>;
  /** API handed to every entrypoint. Defaults to the {@link stubApi}. */
  api?: ModApi;
  /** The game object handed to every entrypoint. Defaults to `{}`. */
  game?: unknown;
}

interface PreparedMod {
  mod: Mod;
  entrySpecifier: string;
}

/**
 * What a successfully-invoked mod left behind for cleanup (#17).
 *
 * Two shapes, because the two entrypoint forms cleanly dispose differently:
 * the class form owns an `onUnload` method on its instance, and the factory
 * form has no instance — so it disposes by *returning* a function, the same
 * convention `api.events.on` / `api.keybinds.register` already use.
 */
interface Disposable {
  modId: string;
  /** Class/object form: the instance whose `onUnload` we call. */
  instance?: unknown;
  /** Factory form: the disposer the factory returned, if it returned one. */
  disposer?: () => unknown;
}

const CLASS_PREFIX = /^\s*class\b/;

function isClass(fn: Function): boolean {
  return CLASS_PREFIX.test(Function.prototype.toString.call(fn));
}

/**
 * Load a batch of mods: parse + validate each manifest, resolve + order the
 * valid set, then invoke entrypoints in order.
 *
 * - Manifest failures and entrypoint failures are isolated per mod (fail small,
 *   never boot-abort — a core TSPML principle vs PML).
 * - Resolution failures (missing `depends`, version conflict, cycle) are
 *   abortive and propagate as a `DependencyError`; a partially cyclic/
 *   conflicting set genuinely cannot be ordered.
 * - `breaks` is NOT abortive (#6, Fabric-accurate): the declaring mod (and any
 *   mod depending on it) is soft-disabled — reported with status `'disabled'`,
 *   its entrypoint never invoked — while everything else loads.
 *
 * @returns the ordered mods, per-mod status, and dependency warnings.
 */
export async function load(
  descriptors: ModDescriptor[],
  options: LoadOptions = {},
): Promise<LoadResult> {
  const importEntry = options.importEntry ?? defaultImportEntry;
  const api: ModApi = options.api ?? stubApi;
  const game: unknown = options.game ?? {};
  const status: Record<string, ModLoadStatus> = {};

  // 1. Parse + validate manifests. A bad manifest fails just that mod.
  const prepared: PreparedMod[] = [];
  for (const descriptor of descriptors) {
    const rawId = readIdHint(descriptor.manifest);
    let manifest: VersionManifest;
    try {
      manifest = parseVersionManifest(descriptor.manifest);
    } catch (err) {
      const reason = err instanceof ManifestError ? err.message : describeError(err);
      status[idOrUnknown(rawId)] = { status: 'failed', reason };
      continue;
    }
    prepared.push({
      mod: modFromManifest(manifest, descriptor.priority ?? 0),
      entrySpecifier: descriptor.entry ?? manifest.entrypoint,
    });
  }

  // 2. Resolve + order. Resolution errors abort the whole load (see jsdoc).
  const { order, warnings, disabled } = resolveDependencies(
    prepared.map((p) => p.mod),
    options.context,
  );

  // 2b. Soft-disabled mods (#6): status entry with the resolver's reason, no
  //     invocation. A mod the resolver excluded must still be visible in the
  //     report — an id silently absent from `status` reads as "we forgot it".
  for (const d of disabled) {
    status[d.id] = { status: 'disabled', reason: d.reason };
  }

  // 3. Invoke entrypoints in dependency order, isolated per mod.
  const entryByMod = new Map(prepared.map((p) => [p.mod.id, p.entrySpecifier]));
  const disposables: Disposable[] = [];
  for (const mod of order) {
    const specifier = entryByMod.get(mod.id);
    const result = await invokeMod(mod, specifier, importEntry, api, game, disposables);
    status[mod.id] = result;
  }

  return { order, status, warnings, unload: makeUnload(disposables, api) };
}

/**
 * Build the one-shot {@link LoadResult.unload} closure.
 *
 * Reverse order so a dependent tears down before its dependency — the mirror of
 * load order. Isolated per mod, because a leaky mod throwing on the way out must
 * not strand every mod after it (the same fail-small rule as loading).
 */
function makeUnload(disposables: Disposable[], api: ModApi) {
  let done: Promise<UnloadResult> | undefined;
  return function unload(): Promise<UnloadResult> {
    // Idempotent: a page-teardown and an explicit disable can both fire, and
    // running a mod's cleanup twice is exactly the double-free class of bug
    // cleanup is supposed to prevent.
    done ??= (async () => {
      const status: Record<string, ModUnloadStatus> = {};
      for (const d of [...disposables].reverse()) {
        status[d.modId] = await disposeOne(d, api);
      }
      return { status };
    })();
    return done;
  };
}

async function disposeOne(d: Disposable, api: ModApi): Promise<ModUnloadStatus> {
  try {
    let ran = false;
    if (d.disposer) {
      await d.disposer();
      ran = true;
    }
    if (d.instance !== undefined && (await runHook(d.instance, 'onUnload', api))) {
      ran = true;
    }
    return ran ? { status: 'unloaded' } : { status: 'no-op' };
  } catch (err) {
    const reason = describeError(err);
    api.logger.error({ mod: d.modId, phase: 'unload', reason });
    return { status: 'failed', reason };
  }
}

async function invokeMod(
  mod: Mod,
  specifier: string | undefined,
  importEntry: (specifier: string) => Promise<unknown>,
  api: ModApi,
  game: unknown,
  disposables: Disposable[],
): Promise<ModLoadStatus> {
  try {
    const module = await importEntry(specifier ?? '');
    const defaultExport = readDefaultExport(module, mod.id);

    if (typeof defaultExport === 'function') {
      if (isClass(defaultExport)) {
        // Class form: instantiate, then run whatever lifecycle hooks exist.
        const instance = new (defaultExport as new () => unknown)();
        // Retain it: `onUnload` lives on the instance, and this local used to
        // be dropped on the floor — which is why the hook was unreachable (#17).
        disposables.push({ modId: mod.id, instance });
        await runHook(instance, 'preInit', api);
        await runHook(instance, 'init', api);
        await runHook(instance, 'ready', api);
      } else {
        // Factory form: default(api, game) => {} | (() => void)
        // A factory has no instance, so it opts into cleanup by returning a
        // disposer — the same convention api.events.on/keybinds.register use.
        const returned = await defaultExport(api, game);
        // Recorded even when it returns nothing, so every mod that LOADED shows
        // up in the unload report (as `no-op`). A silently absent entry reads
        // like "we forgot about this mod", which is the wrong signal for a host
        // surfacing cleanup results.
        disposables.push(
          typeof returned === 'function'
            ? { modId: mod.id, disposer: returned as () => unknown }
            : { modId: mod.id },
        );
      }
    } else if (defaultExport !== undefined && defaultExport !== null) {
      // Non-function default: treat as a pre-instantiated instance with hooks.
      disposables.push({ modId: mod.id, instance: defaultExport });
      await runHook(defaultExport, 'preInit', api);
      await runHook(defaultExport, 'init', api);
      await runHook(defaultExport, 'ready', api);
    }
    return { status: 'loaded' };
  } catch (err) {
    const reason = describeError(err);
    api.logger.error({ mod: mod.id, reason });
    return { status: 'failed', reason };
  }
}

function readDefaultExport(module: unknown, modId: string): unknown {
  if (module !== null && typeof module === 'object' && 'default' in module) {
    return (module as { default: unknown }).default;
  }
  // Bare default (e.g. a synthetic test module) — accept the module itself.
  if (module !== null && typeof module !== 'object') {
    return module;
  }
  throw new Error(
    `entrypoint for mod '${modId}' has no default export (expected a class extending TspmlMod or a factory (api, game) => {})`,
  );
}

/** @returns whether the hook existed and ran (lets unload report `no-op`). */
async function runHook(
  instance: unknown,
  hook: 'preInit' | 'init' | 'ready' | 'onUnload',
  api: ModApi,
): Promise<boolean> {
  if (instance !== null && typeof instance === 'object') {
    const fn = (instance as Record<string, unknown>)[hook];
    if (typeof fn === 'function') {
      await (fn as (api: ModApi) => unknown | Promise<unknown>).call(instance, api);
      return true;
    }
  }
  return false;
}

function defaultImportEntry(specifier: string): Promise<unknown> {
  // The host's dynamic import. Kept indirect so tests can inject a fake.
  return import(/* @vite-ignore */ specifier);
}

function readIdHint(manifest: unknown): string | undefined {
  if (
    manifest !== null &&
    typeof manifest === 'object' &&
    'id' in manifest &&
    typeof (manifest as { id?: unknown }).id === 'string'
  ) {
    return (manifest as { id: string }).id;
  }
  return undefined;
}

function idOrUnknown(id: string | undefined): string {
  return id ?? '<unknown>';
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}


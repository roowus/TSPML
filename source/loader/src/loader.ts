import type {
  LoadResult,
  Mod,
  ModApi,
  ModLoadStatus,
  ResolveContext,
  VersionManifest,
  Warning,
} from './types.js';
import { stubApi } from './types.js';
import { ManifestError, parseVersionManifest } from './manifest.js';
import { DependencyError, modFromManifest, resolveDependencies } from './dependency.js';

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
 * - Resolution failures (missing `depends`, version conflict, `breaks`, cycle)
 *   are abortive and propagate as a {@link DependencyError}; a partially
 *   cyclic/ conflicting set genuinely cannot be ordered.
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
  const { order, warnings } = resolveDependencies(
    prepared.map((p) => p.mod),
    options.context,
  );

  // 3. Invoke entrypoints in dependency order, isolated per mod.
  const entryByMod = new Map(prepared.map((p) => [p.mod.id, p.entrySpecifier]));
  for (const mod of order) {
    const specifier = entryByMod.get(mod.id);
    const result = await invokeMod(mod, specifier, importEntry, api, game);
    status[mod.id] = result;
  }

  return { order, status, warnings };
}

async function invokeMod(
  mod: Mod,
  specifier: string | undefined,
  importEntry: (specifier: string) => Promise<unknown>,
  api: ModApi,
  game: unknown,
): Promise<ModLoadStatus> {
  try {
    const module = await importEntry(specifier ?? '');
    const defaultExport = readDefaultExport(module, mod.id);

    if (typeof defaultExport === 'function') {
      if (isClass(defaultExport)) {
        // Class form: instantiate, then run whatever lifecycle hooks exist.
        const instance = new (defaultExport as new () => unknown)();
        await runHook(instance, 'preInit', api);
        await runHook(instance, 'init', api);
        await runHook(instance, 'ready', api);
      } else {
        // Factory form: default(api, game) => {}
        await defaultExport(api, game);
      }
    } else if (defaultExport !== undefined && defaultExport !== null) {
      // Non-function default: treat as a pre-instantiated instance with hooks.
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

async function runHook(
  instance: unknown,
  hook: 'preInit' | 'init' | 'ready',
  api: ModApi,
): Promise<void> {
  if (instance !== null && typeof instance === 'object') {
    const fn = (instance as Record<string, unknown>)[hook];
    if (typeof fn === 'function') {
      await (fn as (api: ModApi) => unknown | Promise<unknown>).call(instance, api);
    }
  }
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


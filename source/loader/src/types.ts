// Manifest / dependency-resolution types. These live HERE on purpose: the
// loader is their only producer and consumer (the portal and dev harness reach
// them through the loader's entrypoint re-exports), so there is nothing to
// share. An old "extract to @tspml/shared" TODO sat here from M1 until #30;
// @tspml/shared exists now but owns injected-payload code (bridge patches /
// early capture), not schema types — moving these there would add a workspace
// edge for zero deduplication.

import type { TspmlApi } from '@tspml/api';

/**
 * A mod id. Globally unique, lowercase, matching `/^[a-z0-9-]+$/`
 * (letters, digits, hyphens — no underscore). Matches `docs/api/mod-json-spec.md`.
 */
export const ID_PATTERN = /^[a-z0-9-]+$/;

/** id -> semver range predicate. */
export type DependencyMap = Record<string, string>;

export type Environment = '*' | 'web' | 'desktop' | 'worker';

export interface Author {
  name: string;
  contact?: string;
}

export type AuthorEntry = string | Author;

/**
 * Root `manifest.json` — the global, version-agnostic handle for a mod package.
 */
export interface GlobalManifest {
  id: string;
  name: string;
  author: string;
  /** gameVersion -> modVersion */
  latest: Record<string, string>;
}

export interface MixinDescriptor {
  config: string;
  environment?: Environment;
}

/**
 * `mod.json` — the per-version manifest. See `docs/api/mod-json-spec.md`.
 */
export interface VersionManifest {
  schemaVersion: number;
  id: string;
  name: string;
  version: string;
  description?: string;
  authors?: AuthorEntry | AuthorEntry[];
  license?: string;
  icon?: string;
  homepage?: string;
  environment?: Environment;
  /** ES module; default export extends TspmlMod or is a factory (api, game) => {}. */
  entrypoint: string;
  /** PolyTrack game-version ranges (semver). */
  targets: string[];
  depends?: DependencyMap;
  recommends?: DependencyMap;
  suggests?: DependencyMap;
  conflicts?: DependencyMap;
  breaks?: DependencyMap;
  includes?: DependencyMap;
  provides?: string[];
  mixins?: MixinDescriptor[];
  capabilities?: string[];
  vanillaSafe?: boolean;
  /** Arbitrary tooling / inter-mod data. */
  custom?: Record<string, unknown>;
}

/**
 * A mod in the form the dependency resolver consumes: the ordering-relevant
 * subset of a VersionManifest plus a declared priority.
 */
export interface Mod {
  id: string;
  version: string;
  /** Higher = loads earlier. Tiebreak only; never overrides topo order. */
  priority: number;
  /** Where the mod runs; `'*'` = anywhere. Checked against
   *  {@link ResolveContext.hostEnvironment} — a mismatch soft-disables (#21). */
  environment: Environment;
  targets: string[];
  depends: DependencyMap;
  recommends: DependencyMap;
  suggests: DependencyMap;
  conflicts: DependencyMap;
  breaks: DependencyMap;
  includes: DependencyMap;
  provides: string[];
}

/**
 * Ambient facts about the host: versions used to resolve the special
 * dependency ids `polytrack`, `tspml`, and `tspml-api`, plus which
 * environment is running (#21). Every field is optional — an omitted fact
 * means the corresponding check simply doesn't run, never that it fails.
 */
export interface ResolveContext {
  polytrackVersion?: string;
  loaderVersion?: string;
  apiVersion?: string;
  /**
   * The environment the host IS ('web' for the portal/dev-harness). When set,
   * a mod declaring a different concrete `environment` is soft-disabled (#21).
   * `'*'` here would be meaningless (a host is always something concrete) and
   * is treated the same as omitting the field: no filtering.
   */
  hostEnvironment?: Environment;
}

export type WarningKind =
  | 'conflict'
  | 'missing-recommendation'
  | 'missing-suggests'
  /** The mod's `targets` ranges don't accept the running PolyTrack version — soft-disabled (#21). */
  | 'incompatible-target'
  /** The mod declares a concrete `environment` that isn't the host's — soft-disabled (#21). */
  | 'environment-mismatch'
  /** `includes` is validated but not implemented — the nested mod won't load (#16). */
  | 'unsupported-includes'
  /** The mod declared `breaks` on something installed — the DECLARING mod is soft-disabled (#6). */
  | 'breaks-disabled'
  /** The mod's `depends` is only satisfiable by a disabled mod — it cascades to disabled (#6). */
  | 'disabled-dependency';

export interface Warning {
  kind: WarningKind;
  /** The mod that originated the warning. */
  mod: string;
  /** The related id, if any. */
  other?: string;
  message: string;
}

/**
 * Per-mod load status, recorded by the loader during orchestration.
 */
export type ModLoadStatus =
  | { status: 'loaded' }
  | { status: 'failed'; reason: string }
  /**
   * Soft-disabled by dependency resolution: the mod declared `breaks` on
   * something installed or depends on a disabled mod (#6), doesn't run in the
   * host's environment, or doesn't target the running game version (#21). Its
   * entrypoint was never invoked — this is a resolution outcome, not an
   * execution failure.
   */
  | { status: 'disabled'; reason: string };

export interface ResolveResult {
  order: Mod[];
  warnings: Warning[];
  /**
   * Mods soft-disabled by resolution — `breaks` declarers and their dependents
   * (#6), environment mismatches, targets mismatches (#21), plus any mod whose
   * `depends` only a disabled mod could satisfy. Excluded from `order`; sorted
   * by id. Each reason also appears as a warning.
   */
  disabled: Array<{ id: string; reason: string }>;
}

/** What happened to one mod's cleanup during {@link LoadResult.unload}. */
export type ModUnloadStatus =
  | { status: 'unloaded' }
  /** The mod exposed no cleanup (no `onUnload`, no returned disposer). */
  | { status: 'no-op' }
  | { status: 'failed'; reason: string };

export interface UnloadResult {
  /** Per-mod cleanup outcome, keyed by id. */
  status: Record<string, ModUnloadStatus>;
}

export interface LoadResult {
  /** Resolved mods in load order (excludes mods that failed before invocation). */
  order: Mod[];
  /** Per-mod status keyed by id. */
  status: Record<string, ModLoadStatus>;
  /** Dependency warnings (conflicts, missing recommendations, ...). */
  warnings: Warning[];
  /**
   * Tear down every mod that loaded, in **reverse** load order — a dependent is
   * disposed before the mod it depends on, mirroring how `init` ran.
   *
   * Cleanup is isolated per mod exactly like loading: one mod throwing in
   * `onUnload` does not prevent the rest from being torn down (#17).
   *
   * Idempotent — calling it twice does not run cleanup twice, because a page
   * teardown and an explicit disable can race.
   *
   * The loader does **not** emit `loader.onUnload`: {@link ModApi}'s `events`
   * is a `TspmlEventSubscriber` (`on`/`once`/`off`), so the loader has no emit
   * capability — enforced by the type since #18, prose before that. The host
   * that owns the concrete bus (portal / dev harness) emits it around this call.
   */
  unload(): Promise<UnloadResult>;
}

/**
 * The API surface handed to each entrypoint — an alias of the published
 * {@link TspmlApi} (#18).
 *
 * This was an M1 stub (`events` + `logger`, nothing else) that outlived the
 * package it was a stand-in for. The gap was invisible because both hosts
 * reached it through `as unknown as ModApi`, and a double cast suppresses every
 * check: mods were typed against a surface missing three of its six real
 * members while the runtime object had all six.
 *
 * Kept as an alias rather than deleted so existing imports keep resolving.
 *
 * @deprecated Prefer `TspmlApi` from `@tspml/api`.
 */
export type ModApi = TspmlApi;

/**
 * Base class for the class-form entrypoint. Mods may `extends TspmlMod` and
 * override any lifecycle hook. The loader duck-types these hooks, so a mod need
 * not extend this class — but doing so keeps the contract obvious.
 *
 * Stays here rather than in `@tspml/api`: that package is types-only (zero
 * runtime, `sideEffects: false`) and this is a class a mod extends at runtime.
 * Its `api` parameters now reference the published {@link TspmlApi} via
 * {@link ModApi}, which is what the old "move to @tspml/api" TODO was after.
 */
export abstract class TspmlMod {
  preInit?(api: ModApi): void | Promise<void>;
  init?(api: ModApi): void | Promise<void>;
  ready?(api: ModApi): void | Promise<void>;
  /**
   * Cleanup. Called by {@link LoadResult.unload} in reverse load order, and
   * handed the same `api` as the other hooks so a mod can `api.events.off(...)`
   * without having stashed a reference at init time (#17).
   */
  onUnload?(api: ModApi): void | Promise<void>;
}

/**
 * Default no-op stub API used when the caller does not provide one.
 *
 * Every registry answers as if the game were not wired yet, because that is
 * exactly the situation: nobody attached a bridge. `register` reports the typed
 * `'not-ready'` failure both result unions already define rather than throwing
 * or silently claiming success — a mod running against the stub gets the same
 * shape of answer it would get calling too early against a real bridge.
 */
export const stubApi: ModApi = {
  events: {
    on: () => () => {},
    once: () => () => {},
    off: () => {},
  },
  keybinds: {
    register: () => () => {},
    unregister: () => {},
  },
  tracks: {
    register: () => Promise.resolve({ ok: false, reason: 'not-ready' }),
    unregister: () => false,
    list: () => [],
  },
  audio: {
    register: () => Promise.resolve({ ok: false, reason: 'not-ready' }),
    unregister: () => false,
    list: () => [],
  },
  logger: console,
  version: '0.0.0-stub',
};

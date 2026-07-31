// TODO: extract to @tspml/shared
//
// For M1 these types live inside the loader so the package stays self-contained
// (no workspace dependency on @tspml/shared yet). They are re-exported from the
// package entrypoint.

/**
 * A mod id. Globally unique, lowercase, matching `/^[a-z0-9-]+$/`.
 *
 * NOTE: `docs/api/mod-json-spec.md` mentions `[a-z0-9-_]` (with underscore) in a
 * prose comment, but the authoritative M1 contract is `/^[a-z0-9-]+$/` (no
 * underscore). This regex is the loader's acceptance criterion.
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
 * Ambient versions used to resolve the special dependency ids
 * `polytrack`, `tspml`, and `tspml-api`.
 */
export interface ResolveContext {
  polytrackVersion?: string;
  loaderVersion?: string;
  apiVersion?: string;
}

export type WarningKind =
  | 'conflict'
  | 'missing-recommendation'
  | 'missing-suggests'
  | 'incompatible-target';

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
  | { status: 'failed'; reason: string };

export interface ResolveResult {
  order: Mod[];
  warnings: Warning[];
}

export interface LoadResult {
  /** Resolved mods in load order (excludes mods that failed before invocation). */
  order: Mod[];
  /** Per-mod status keyed by id. */
  status: Record<string, ModLoadStatus>;
  /** Dependency warnings (conflicts, missing recommendations, ...). */
  warnings: Warning[];
}

/**
 * Minimal capability-scoped API surface handed to each entrypoint. The real
 * bridge (events + registries + mixin ops) lands in M4; for M1 this is a stub.
 */
export interface ModApi {
  events: {
    on(event: string, cb: (...args: unknown[]) => void): unknown;
    off(event: string, cb: (...args: unknown[]) => void): unknown;
  };
  logger: Pick<Console, 'log' | 'error' | 'warn' | 'info' | 'debug'>;
}

/**
 * Base class for the class-form entrypoint. Mods may `extends TspmlMod` and
 * override any lifecycle hook. The loader duck-types these hooks, so a mod need
 * not extend this class — but doing so keeps the contract obvious.
 *
 * TODO: move to @tspml/api once that package exists.
 */
export abstract class TspmlMod {
  preInit?(api: ModApi): void | Promise<void>;
  init?(api: ModApi): void | Promise<void>;
  ready?(api: ModApi): void | Promise<void>;
  onUnload?(): void | Promise<void>;
}

/** Default no-op stub API used when the caller does not provide one. */
export const stubApi: ModApi = {
  events: {
    on: () => {},
    off: () => {},
  },
  logger: console,
};

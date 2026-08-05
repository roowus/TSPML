/**
 * @tspml/mappings — v1 map schema.
 *
 * A `GameMap` is a versioned JSON file (one per PolyTrack build) mapping stable
 * semantic names to concrete locators in that build's minified bundles. Mods
 * target stable names only; the resolver maps stable -> concrete at bind time.
 *
 * v1 is MODULE-LEVEL granularity: each entry binds a stable concept (plus a few
 * representative stable names) to the webcrack module id that contains it. This
 * is because the M1 drift spike matched whole modules, not individual symbols
 * (see docs/research/mappings-drift-spike.md).
 *
 * NOTE — symbol-level locators (`exportRef` / `prototypeFn` / `callExpression`,
 * i.e. an AST anchor + ordinal) are M3 work and are NOT part of this schema. In
 * v1, `resolve(stableName)` returns the MODULE that contains the symbol; a later
 * M3 resolver narrows from the module to the exact export / prototype method /
 * call site. The `Locator` type below is intentionally a single `module` variant
 * so M3 can widen it to a discriminated union without breaking v1 callers.
 */

/** Current map format version. */
export const MAP_FORMAT_VERSION = 1 as const;

/** Bundle integrity pin: `sha256:<64 hex>` of the main bundle. */
export type BundleHash = `sha256:${string}`;

/**
 * v1 module-level locator. Points at a webcrack module inside the matched
 * bundle (e.g. moduleId `"5220"` -> the file `5220.js` in the unpacked bundle).
 *
 * M3 will add finer-grained locator variants (`exportRef`, `prototypeFn`,
 * `callExpression`); until then a resolution returns the containing module.
 */
export interface ModuleLocator {
  readonly type: 'module';
  /** webcrack module id (filename stem) within the matched bundle. */
  readonly moduleId: string;
}

/**
 * A concrete transform target — the SAME shape @tspml/transform's locator
 * consumes (module by anchor literals, within-module by selector). Stored in
 * the map under `targets` so mods can address a STABLE NAME (e.g.
 * `Car.controlCar`) instead of hardcoding minified anchors (M5-C).
 */
export interface ModuleAnchor {
  /** ≥1 distinctive literals (enum members / magic strings / numeric constants). */
  readonly literals: readonly (string | number)[];
  /** Min literal hits required (defaults to literals.length). */
  readonly minHits?: number;
}
export interface TargetSelector {
  readonly kind: 'method' | 'property' | 'factory';
  /** Preserved method name (kind: 'method'). */
  readonly name?: string;
  /** Property key (kind: 'property'). */
  readonly key?: string;
}
export interface TargetSpec {
  readonly anchor: ModuleAnchor;
  readonly selector: TargetSelector;
}

/** A module-level mapping entry: one stable concept -> one 0.6.2 module. */
export interface ModuleEntry {
  /** Human-readable stable concept label. */
  readonly concept: string;
  /** Representative stable names found in the renamed source module. */
  readonly stableNames: readonly string[];
  /** Primary subsystem classification. */
  readonly subsystem: string;
  /** All subsystems the module touches. */
  readonly subsystems: readonly string[];
  /** The matched target webcrack module id (concrete locator target). */
  readonly moduleId: string;
  /** Drift-spike confidence: shared-anchor weight (higher = more confident). */
  readonly matchWeight: number;
  /** Number of shared anchors that produced the match. */
  readonly sharedAnchors: number;
  /** The 0.6.0 source module the concept was bootstrapped from. */
  readonly sourceModuleId: string;
  /**
   * Which kind of evidence chose this module's target (#1).
   *
   * `'lexical'` — the anchor scorer won outright by the margin: direct evidence about
   * this module's own string/number literals.
   * `'structural'` — anchors could not separate the leaders and an AST shape comparison
   * broke the tie. Circumstantial evidence, and the entry to re-verify first after a
   * game update.
   *
   * Optional for backward compatibility: maps generated before #1 was wired into
   * `gen-map.mjs` have no such field, and an absent value means "lexical" (it is the
   * only decision the old generator could make).
   */
  readonly decidedBy?: 'lexical' | 'structural';
  /** Cosine shape similarity that won a `'structural'` decision. Absent otherwise. */
  readonly structuralSimilarity?: number;
}

/** A game-logic module the spike could not confidently relocate this build. */
export interface UnresolvedEntry {
  readonly sourceModuleId: string;
  readonly subsystem: string;
  readonly subsystems: readonly string[];
  readonly reason: string;
}

/** Provenance — how/where the map was generated. */
export interface MapGenerated {
  readonly from: string;
  readonly matcher: string;
  readonly granularity: string;
  readonly note: string;
}

/**
 * A versioned symbol map for a single PolyTrack build.
 *
 * `bundleHash` is the integrity pin: the resolver FAILS CLOSED when the live
 * bundle's hash does not match (see resolver.ts and
 * docs/design/mappings-system.md, "Fail-closed on stale maps"). A stale map must
 * never silently point at the wrong code.
 */
export interface GameMap {
  readonly formatVersion: typeof MAP_FORMAT_VERSION;
  readonly gameVersion: string;
  readonly bundleHash: BundleHash;
  readonly generated: MapGenerated;
  /** Keyed by stable concept slug; each value pins one module. */
  readonly modules: Readonly<Record<string, ModuleEntry>>;
  /** Game-logic modules not confidently relocated this build (graceful). */
  readonly unresolved: readonly UnresolvedEntry[];
  /**
   * Stable name → concrete transform target (M5-C). Lets mods address e.g.
   * `Car.controlCar` instead of an inline minified anchor. Optional + fail-closed
   * (resolved only when the live bundle matches `bundleHash`).
   */
  readonly targets?: Readonly<Record<string, TargetSpec>>;
}

/** The concrete target returned by a successful resolution. */
export type Locator = ModuleLocator;

/** Context handed to the resolver: the hash of the LIVE bundle about to load. */
export interface ResolveContext {
  bundleHash: string;
}

/**
 * A resolution outcome. On `ok: true` the locator is safe to use (the map
 * matches the live bundle). On `ok: false`:
 *  - `'stale-map'`  — the map's bundleHash does not match the live bundle. NO
 *    locator is returned; the caller must fetch an exact-match map before
 *    binding any AST/physics/ranked hook (design doc: fail-closed on stale maps).
 *  - `'not-found'`  — the map matches but the stable name is unknown to it.
 */
export type ResolveResult =
  | { readonly ok: true; readonly locator: Locator }
  | {
      readonly ok: false;
      readonly reason: 'stale-map' | 'not-found';
      readonly message: string;
    };

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
 * A concrete transform target, stored in the map under `targets` so mods can
 * address a STABLE NAME (e.g. `Car.controlCar`) instead of hardcoding minified
 * anchors (M5-C). This is the CANONICAL definition — `@tspml/transform`
 * re-exports these types rather than duplicating them (#30): the map stores a
 * spec, the transform locator consumes it, and one definition means the two
 * packages cannot drift apart.
 *
 * SELECTOR STRATEGY (docs/research/transform-spike.md — the authoritative M3
 * approach): a module is located by an ANCHOR of distinctive literals that
 * survive minification (NOT by webpack id — ids drift, see the M1 drift
 * spike). Within the module a node is located by a stable name (preserved
 * method name or property KEY, never a literal VALUE).
 */
export interface ModuleAnchor {
  /** ≥1 distinctive literals (enum members / magic strings / numeric constants). */
  readonly literals: readonly (string | number)[];
  /**
   * Minimum literal hits required to consider a factory the match. Defaults to
   * `literals.length` (all of them). Lowering it trades precision for
   * resilience when an anchor literal is renamed in a future build.
   */
  readonly minHits?: number;
}

/**
 * Where to narrow WITHIN the found module. Exactly one `kind` is set.
 *
 *   - `method`   — a preserved class/object method name (survives minification;
 *                  terser keeps member names).
 *   - `property` — an `ObjectProperty` selected by KEY, never by value (the
 *                  value changes every release; the property name doesn't).
 *   - `factory`  — the webpack module factory itself (module-load intercept).
 *
 * TODO(M9 / issue #1): add an `invoke` variant — an INVOKE-style call-site
 *   locator analogous to Fabric's `@At("INVOKE", target=...)` — for
 *   `@ModifyArg`/`@Redirect` against a specific call site resolved structurally
 *   (callee name + ordinal). The drift spike flagged ~15% of modules need AST
 *   structural fingerprints; the in-method `modifyArg` op covers the common
 *   case without a cross-module INVOKE locator.
 */
export type TargetSelector =
  | { readonly kind: 'method'; readonly name: string }
  | { readonly kind: 'property'; readonly key: string }
  | { readonly kind: 'factory' };

/** The file a target's anchor lives in: `'main.bundle.js'` or `'<id>.bundle.js'`. */
export type SurfaceFile = string;

/** The surface a target defaults to when it does not name one. */
export const MAIN_SURFACE_FILE = 'main.bundle.js';

/** A stable target: module anchor + within-module selector. */
export interface TargetSpec {
  readonly anchor: ModuleAnchor;
  readonly selector: TargetSelector;
  /**
   * Which served file this target's anchor was verified against (#98).
   * Absent means the main bundle, so every pre-#98 target keeps its meaning.
   *
   * This is not a hint — it is a scope. The same literal can occur in more than one
   * file, and an anchor is only ever verified against ONE unpacked bundle, so a
   * target resolved against a different file than the one it was checked in is a
   * silent mis-target: the locator finds *something*, the patch applies, and the
   * mod edits code nobody looked at. Chunk anchors in particular are only meaningful
   * inside their own chunk. {@link targetSurface} is the one place the default lives.
   */
  readonly surface?: SurfaceFile;
}

/** The surface a target belongs to, applying the main-bundle default (#98). */
export function targetSurface(spec: TargetSpec): SurfaceFile {
  return spec.surface ?? MAIN_SURFACE_FILE;
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
   * `'edge'` — both content signals saturated and the target was chosen by exact,
   * unique agreement of its translated require-graph neighbourhood (forward AND
   * reverse, through the pass-1 matches). Purely relational evidence: it says nothing
   * about the module's own body, so it ranks below both content signals when a stable
   * name collides (see resolver.ts).
   *
   * Optional for backward compatibility: maps generated before #1 was wired into
   * `gen-map.mjs` have no such field, and an absent value means "lexical" (it is the
   * only decision the old generator could make).
   */
  readonly decidedBy?: 'lexical' | 'structural' | 'edge';
  /** Cosine shape similarity that won a `'structural'` decision. Absent otherwise. */
  readonly structuralSimilarity?: number;
  /** Confirmed translated require edges that won an `'edge'` decision. Absent otherwise. */
  readonly edgeConfirmed?: number;
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
 * One lazily-loaded webpack chunk bundle the transform surface covers (#98).
 *
 * The game splits real feature code out of `main.bundle.js` into numbered chunks
 * fetched on demand (`i.e(112)` → `<version>/112.bundle.js`). A host that only
 * transforms the main bundle cannot anchor, inject, or capture anything inside
 * one — which is what gated the editor API (#87).
 *
 * `hash` is a PER-CHUNK pin, and that is the point of this entry existing at all.
 * A chunk re-minifies independently of the main bundle: a shared pin would either
 * trip on every main-bundle change (over-trip) or accept a re-minified chunk the
 * anchors no longer fit (under-protect). Fail-closed is scoped to match — a stale
 * chunk pin serves THAT CHUNK vanilla and leaves the main transform alone.
 *
 * The map is where this lives rather than in host code because the set of chunks
 * and their hashes is per-BUILD data, regenerated with the rest of the map. A host
 * asks "may I transform `<id>.bundle.js`, and against which pin?" and the answer
 * is a lookup, not a code change.
 */
export interface ChunkEntry {
  /** Webpack chunk id — the `<id>` in `<id>.bundle.js`. Digits only. */
  readonly id: string;
  /** sha256 of THIS chunk's bytes. Independent of the main bundle's pin. */
  readonly hash: BundleHash;
  /** Byte length as fetched, for provenance / drift reporting. */
  readonly bytes: number;
  /** What the chunk contains, for humans reading a diff (e.g. "track editor"). */
  readonly role: string;
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
  /**
   * Transformable chunk bundles for this build (#98), keyed by chunk id. Optional:
   * a map without it declares no chunks, and a host then transforms only the main
   * bundle — exactly the pre-#98 behaviour. THIS IS THE ALLOWLIST: a chunk absent
   * here is proxied verbatim, never transformed.
   */
  readonly chunks?: Readonly<Record<string, ChunkEntry>>;
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

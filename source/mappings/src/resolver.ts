/**
 * The fail-closed symbol resolver.
 *
 * `createResolver(map)` returns a `resolve(stableName, ctx)` bound to a loaded
 * map. The critical rule (docs/design/mappings-system.md, "Fail-closed on stale
 * maps"): if `ctx.bundleHash` (the hash of the LIVE bundle about to load) does
 * NOT match `map.bundleHash`, the resolver returns `{ ok: false, reason:
 * 'stale-map' }` and NEVER returns a locator. A stale map would resolve stable
 * names to *wrong* concrete locators — the exact silent mis-target the design
 * accuses PML of — so it must fail closed. The caller must fetch an exact-match
 * map before binding any AST/physics/ranked hook.
 *
 * When the hashes match, the stable name is looked up in the module index.
 * v1 resolves to MODULE granularity (the containing webcrack module); M3 will
 * narrow further to export / prototype / call-site locators.
 */
import type {
  GameMap,
  Locator,
  ResolveContext,
  ResolveResult,
  TargetSpec,
} from './types.js';

/**
 * Normalize a bundle hash for comparison: trim, lowercase, and strip an optional
 * `sha256:` / `sha-256:` prefix. This bridges representation variants of the
 * SAME hash (a caller may pass bare hex while the map stores the prefixed form).
 *
 * It cannot cause a false match: two different bundles differ in at least one
 * hex digit, so their normalized forms still differ.
 */
function normalizeHash(h: string): string {
  return h.trim().toLowerCase().replace(/^sha-?256:/, '');
}

/**
 * Build the case-insensitive stable-name -> locator index for a map. First-wins
 * on collision: the v1 generator prefers module-unique names, so collisions are
 * rare and only occur between sibling modules that genuinely share an enum (e.g.
 * two track-block registries), where either target is a reasonable resolution.
 */
function buildIndex(map: GameMap): Map<string, Locator> {
  const index = new Map<string, Locator>();
  for (const entry of Object.values(map.modules)) {
    for (const name of entry.stableNames) {
      const key = name.toLowerCase();
      if (!index.has(key)) {
        index.set(key, { type: 'module', moduleId: entry.moduleId });
      }
    }
  }
  return index;
}

export interface Resolver {
  /** Resolve a stable name against the bound map, fail-closed on hash mismatch. */
  resolve(stableName: string, ctx: ResolveContext): ResolveResult;
}

/**
 * Create a fail-closed resolver bound to a loaded map. Prefer this over the
 * standalone {@link resolve} when resolving multiple names against one map —
 * the stable-name index is built once.
 */
export function createResolver(map: GameMap): Resolver {
  const index = buildIndex(map);
  const want = normalizeHash(map.bundleHash);
  return {
    resolve(stableName, ctx) {
      if (normalizeHash(ctx.bundleHash) !== want) {
        return {
          ok: false,
          reason: 'stale-map',
          message: `map bundleHash (${map.bundleHash}) does not match live bundle (${ctx.bundleHash}); refusing to return a locator — fetch an exact-match map`,
        };
      }
      const locator = index.get(stableName.toLowerCase());
      if (!locator) {
        return {
          ok: false,
          reason: 'not-found',
          message: `stable name '${stableName}' is not present in the map for PolyTrack ${map.gameVersion}`,
        };
      }
      return { ok: true, locator };
    },
  };
}

/**
 * Stateless one-shot resolution: resolve a single stable name against `map`.
 * Equivalent to `createResolver(map).resolve(stableName, ctx)` but builds the
 * index per call, so prefer the resolver instance for repeated lookups.
 */
export function resolve(map: GameMap, stableName: string, ctx: ResolveContext): ResolveResult {
  return createResolver(map).resolve(stableName, ctx);
}

// ── Target resolution (M5-C) ────────────────────────────────────────────────

export interface TargetResolveSuccess {
  readonly ok: true;
  readonly target: TargetSpec;
}
export type TargetResolveResult =
  | TargetResolveSuccess
  | {
      readonly ok: false;
      readonly reason: 'stale-map' | 'not-found';
      readonly message: string;
    };

/**
 * Resolve a stable TARGET name (from `map.targets`) to a concrete
 * {@link TargetSpec}, **fail-closed** on hash mismatch — same guarantee as the
 * module resolver. Lets mods address e.g. `Car.controlCar` instead of an inline
 * minified anchor.
 */
export function resolveTarget(
  map: GameMap,
  name: string,
  ctx: ResolveContext,
): TargetResolveResult {
  if (normalizeHash(ctx.bundleHash) !== normalizeHash(map.bundleHash)) {
    return {
      ok: false,
      reason: 'stale-map',
      message: `map bundleHash (${map.bundleHash}) does not match live bundle (${ctx.bundleHash}); refusing to resolve target '${name}'`,
    };
  }
  const targets = map.targets;
  if (!targets) {
    return { ok: false, reason: 'not-found', message: `map has no targets section` };
  }
  // Case-insensitive lookup (mirrors the module resolver).
  const key = Object.keys(targets).find((k) => k.toLowerCase() === name.toLowerCase());
  if (key === undefined) {
    return {
      ok: false,
      reason: 'not-found',
      message: `target '${name}' is not in the map for PolyTrack ${map.gameVersion}`,
    };
  }
  return { ok: true, target: targets[key]! };
}

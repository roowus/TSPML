import * as semver from 'semver';

/**
 * Thin wrapper over the npm `semver` package. This is TSPML's dependency-
 * predicate engine: every value in a manifest's `depends`/`recommends`/
 * `suggests`/`conflicts`/`breaks`/`includes` map, and every entry in `targets`,
 * is a `semver` range. Centralising the calls here keeps the rest of the loader
 * agnostic to the underlying range syntax (`^`, `~`, `||`, `*`, ...).
 */

/** True if `version` satisfies `range` (e.g. `1.2.3` satisfies `^1.0.0`). */
export function satisfies(version: string, range: string): boolean {
  return semver.satisfies(version, range);
}

/**
 * The highest version in `versions` that satisfies `range`, or `null` if none.
 */
export function maxSatisfying(versions: string[], range: string): string | null {
  const result = semver.maxSatisfying(versions, range);
  return result ?? null;
}

/**
 * The lowest version that could possibly satisfy `range`, or `null` if the
 * range is invalid. Useful for sanity-checking a predicate has a real floor.
 */
export function minVersion(range: string): string | null {
  const result = semver.minVersion(range);
  return result ? result.toString() : null;
}

/** True if `range` is a syntactically valid semver range (`*`, `^1`, `>=1 <2`...). */
export function isValidRange(range: string): boolean {
  return semver.validRange(range) !== null;
}

/** True if `version` is a syntactically valid exact semver (`1.2.3`, not `^1`). */
export function isValidVersion(version: string): boolean {
  return semver.valid(version) !== null;
}

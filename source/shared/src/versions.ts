/**
 * The versions TSPML reports about ITSELF, stated once (#73).
 *
 * A mod may declare `depends: { "tspml": "^0.5.0" }` or
 * `depends: { "tspml-api": "^0.5.0" }`. The loader resolves those two special
 * ids from {@link ResolveContext.loaderVersion} / `.apiVersion`, so whatever a
 * host passes there IS what mod authors are writing ranges against. That makes
 * these numbers a compatibility contract, not decoration.
 *
 * They live here because every delivery surface needs the same answer: the
 * portal states them in its `ResolveContext` and hands `TSPML_VERSION` to mods
 * on the api object, and the dev harness does the same. Two copies of a number
 * that must agree is exactly the drift #73 was filed about.
 *
 * ## Why 0.5.0 and not 0.0.0
 *
 * `0.0.0` is not a neutral placeholder — it is a version that fails almost
 * every honest range. An author following the spec writes `^0.5.0` or
 * `>=0.5`, and against `0.0.0` semver rejects it. That punishes precisely the
 * authors who declared the dependency the spec recommends, which is worse than
 * the pre-#73 behaviour of reporting the id as absent: "not installed" is at
 * least a true statement about an unwired feature, whereas `0.0.0` claims
 * TSPML is installed and then refuses every reasonable range.
 *
 * So the requirement is a version that is *honest about maturity* while still
 * satisfiable. `0.5.0` is both: pre-1.0 (the API is not frozen and 0.x semver
 * lets a minor bump break) and high enough that ranges anchored to a shipped
 * feature set resolve.
 *
 * ## What bumping these means
 *
 * Bump {@link TSPML_API_VERSION} on any change to the mod-facing surface in
 * `@tspml/api` — a new event, a new registry, a changed signature. Bump
 * {@link TSPML_LOADER_VERSION} on a change to loader behaviour a mod could
 * observe (resolution semantics, lifecycle ordering, manifest handling). While
 * both are 0.x, a *minor* bump is the breaking one and a patch bump is not.
 *
 * Keep them in step with `packages/api/package.json` and
 * `source/loader/package.json`; `versions.test.ts` asserts that.
 */

/** Version reported for the special dependency id `tspml` (the loader). */
export const TSPML_LOADER_VERSION = '0.5.0';

/** Version reported for the special dependency id `tspml-api` (the mod-facing API). */
export const TSPML_API_VERSION = '0.5.0';

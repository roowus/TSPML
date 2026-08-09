/**
 * @tspml/portal — which declared mixins apply to THIS host (#21).
 *
 * `mod.json`'s `mixins` array declares a per-config environment
 * (`{ config, environment? }`). Before #21 the portal applied every declared
 * mixin regardless, making the field a silent lie — the PML failure mode TSPML
 * exists to fix. The portal is a WEB host, so a mod whose declared mixins are
 * all `desktop`/`worker` must not contribute patches here — and a paste backing
 * only such descriptors must be reported as not-applied, never silently
 * dropped (page.tsx surfaces `envSkipped` from the plan builder).
 *
 * Pure and dependency-free so demo-mods, the plan builder, and mod-loader all
 * share the ONE predicate and the one host constant — entrypoint resolution
 * (PORTAL_RESOLVE_CONTEXT) and mixin gating cannot disagree about what the
 * portal is.
 */
import type { Environment } from '@tspml/loader';

/** What the portal is. The single source for both the resolve context
 *  (mod-loader.ts) and the mixin-descriptor gating below. */
export const PORTAL_HOST_ENVIRONMENT: Environment = 'web';

/**
 * True when a mixin descriptor's `environment` value applies to `host`.
 * `undefined` and `'*'` mean anywhere. The input is deliberately `unknown` —
 * user manifests are raw by design (the loader owns validation, and a garbage
 * value fails the whole manifest at load time with the validator's own
 * message), so this predicate only decides whether patches ride meanwhile —
 * matching a garbage value against a concrete host is honestly "no".
 */
export function mixinEnvironmentAppliesToHost(
  environment: unknown,
  host: Environment = PORTAL_HOST_ENVIRONMENT,
): boolean {
  return environment === undefined || environment === '*' || environment === host;
}

/**
 * Should this mod's mixin PATCHES apply on `host`? False only for a
 * well-formed, non-empty `mixins` array whose every descriptor names a
 * different concrete environment. A manifest with no `mixins` field (or a
 * malformed one — the loader rejects those with a real message) gates nothing
 * here: the paste is the author's stated intent and there is no declaration
 * saying otherwise.
 *
 * Granularity note: a mod may declare several configs with different
 * environments, but the portal's paste box carries ONE patches array — it
 * cannot attribute patches to configs. One applicable descriptor therefore
 * admits the whole paste; splitting would require per-config pastes.
 */
export function modMixinsApplyToHost(
  manifest: Record<string, unknown>,
  host: Environment = PORTAL_HOST_ENVIRONMENT,
): boolean {
  const mixins = manifest.mixins;
  if (!Array.isArray(mixins) || mixins.length === 0) return true;
  return mixins.some(
    (d) =>
      typeof d === 'object' &&
      d !== null &&
      mixinEnvironmentAppliesToHost((d as { environment?: unknown }).environment, host),
  );
}

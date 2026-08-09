/**
 * @tspml/portal — mixin patches DECLARED BY MODS (M5-A).
 *
 * Each bundled demo mod authors its Tier-2 surgery in a mixin descriptor
 * (`mixins.json`, referenced from its `mod.json` `mixins` field). The transform
 * applies these ALONGSIDE the loader-owned bridge patches — i.e. a MOD authors
 * game-modifying patches, not just the loader.
 *
 * A declared patch may target an inline anchor OR (M5-C) a STABLE NAME
 * (`{ symbol: "Car.controlCar", op, inject }`) resolved fail-closed via
 * `@tspml/mappings`. Untyped here (JSON); demo-transform resolves/validates.
 *
 * #21: the descriptor's `environment` is honored — the portal is a web host,
 * so a config declared for `desktop`/`worker` contributes nothing here. The
 * demo mod declares `environment: "web"`, so this changes nothing for it; the
 * gate exists so the declared field is TRUE, not decorative.
 */
import demoHudMixins from '@tspml/demo-hud/mixins.json';
import demoHudManifest from '@tspml/demo-hud/mod.json';
import { mixinEnvironmentAppliesToHost } from './mixin-env';

/** The environment declared for a named config in a raw mod.json, if any. */
function declaredEnvironment(manifest: unknown, config: string): unknown {
  const mixins = (manifest as { mixins?: unknown }).mixins;
  if (!Array.isArray(mixins)) return undefined;
  const d = mixins.find(
    (m) => typeof m === 'object' && m !== null && (m as { config?: unknown }).config === config,
  );
  return d === undefined ? undefined : (d as { environment?: unknown }).environment;
}

const raw = mixinEnvironmentAppliesToHost(declaredEnvironment(demoHudManifest, 'mixins.json'))
  ? ((demoHudMixins as { patches?: unknown[] }).patches ?? [])
  : [];

/** All mixin patches declared by the portal's bundled demo mods that apply to
 *  THIS (web) host. */
export const MOD_MIXIN_PATCHES: readonly Record<string, unknown>[] =
  raw as readonly Record<string, unknown>[];

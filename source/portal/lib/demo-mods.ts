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
 */
import demoHudMixins from '@tspml/demo-hud/mixins.json';

const raw = (demoHudMixins as { patches?: unknown[] }).patches ?? [];

/** All mixin patches declared by the portal's bundled demo mods. */
export const MOD_MIXIN_PATCHES: readonly Record<string, unknown>[] =
  raw as readonly Record<string, unknown>[];

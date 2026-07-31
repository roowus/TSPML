/**
 * @tspml/portal — mixin patches DECLARED BY MODS (M5-A).
 *
 * Each bundled demo mod authors its Tier-2 surgery in a mixin descriptor
 * (`mixins.json`, referenced from its `mod.json` `mixins` field). The transform
 * applies these ALONGSIDE the loader-owned bridge patches — i.e. a MOD authors
 * game-modifying patches, not just the loader.
 *
 * Inline anchors for now (mappings-resolved stable-name targeting lands in M5-C).
 */
import type { Patch } from '@tspml/transform';
import demoHudMixins from '@tspml/demo-hud/mixins.json';

const raw = (demoHudMixins as { patches?: unknown[] }).patches ?? [];

/** All mixin patches declared by the portal's bundled demo mods. */
export const MOD_MIXIN_PATCHES: readonly Patch[] = raw as readonly Patch[];

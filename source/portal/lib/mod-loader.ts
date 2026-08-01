/**
 * @tspml/portal — loads the portal's bundled demo mods via @tspml/loader.
 *
 * This is the "real mod loading" proof: a mod PACKAGE (mod.json + entrypoint) is
 * discovered, parsed, resolved/ordered, and invoked by the loader, receiving the
 * bridge `api` (events + keybinds). The mod's entrypoint then subscribes to game
 * events and registers keybinds — i.e. an actual mod uses the Tier-1 surface.
 *
 * The demo mod (@tspml/demo-hud) is statically imported + returned by
 * `importEntry`; a fallback dynamic `import()` covers any future URL/path mods.
 */
import type { ModApi, ModDescriptor } from '@tspml/loader';
import { classifySafety, load, parseVersionManifest } from '@tspml/loader';
import type { SafetyReport } from '@tspml/loader';
// Statically imported so the bundler includes the demo mod; `importEntry` below
// returns it for the demo-hud specifier.
import demoHudFactory from '@tspml/demo-hud';
import demoHudManifest from '@tspml/demo-hud/mod.json';

export interface ModSafetyEntry {
  readonly id: string;
  readonly report: SafetyReport;
}

export interface ModLoadSummary {
  readonly loaded: readonly string[];
  readonly failed: ReadonlyArray<{ id: string; reason: string }>;
  readonly safety: readonly ModSafetyEntry[];
}

/**
 * Load the bundled demo mods against the given (bridge) api. Per-mod failure
 * isolation: a bad mod is reported, never boot-aborts. Also classifies each
 * mod's safety (M6-B, warn-only) for the portal to surface.
 */
export async function loadMods(api: ModApi): Promise<ModLoadSummary> {
  const importEntry = async (specifier: string): Promise<unknown> => {
    if (specifier === 'demo-hud') return { default: demoHudFactory };
    return await import(/* webpackIgnore: true */ /* @vite-ignore */ specifier);
  };
  const descriptors: ModDescriptor[] = [
    { manifest: demoHudManifest as unknown, entry: 'demo-hud' },
  ];
  const result = await load(descriptors, { api, importEntry });

  const loaded: string[] = [];
  const failed: Array<{ id: string; reason: string }> = [];
  for (const [id, s] of Object.entries(result.status)) {
    if (s.status === 'loaded') loaded.push(id);
    else failed.push({ id, reason: s.reason ?? 'unknown' });
  }

  // M6-B: classify each mod's safety (warn-only — never blocks).
  const safety: ModSafetyEntry[] = [];
  for (const desc of descriptors) {
    try {
      const manifest = parseVersionManifest(desc.manifest);
      safety.push({ id: manifest.id, report: classifySafety(manifest) });
    } catch {
      // Bad manifest — already in `failed`; skip classification.
    }
  }

  return { loaded, failed, safety };
}

/**
 * @tspml/portal — loads the portal's mods via @tspml/loader.
 *
 * Two sources, one loader path:
 * - the BUNDLED demo mods (statically imported so the bundler includes them),
 * - the USER mods added at runtime through the portal UI and persisted in
 *   localStorage (see ./user-mods.ts) — the thing that makes the portal usable
 *   to a modder who hasn't forked this repo.
 *
 * Both kinds go through the same `load()` call, so a user mod gets everything a
 * bundled one does: manifest validation, dependency resolution, per-mod failure
 * isolation, safety classification, and unload.
 */
import type { TspmlApi } from '@tspml/api';
import type { Mod, ModDescriptor } from '@tspml/loader';
import { classifySafety, load, modFromManifest, parseVersionManifest, resolveDependencies } from '@tspml/loader';
import type { SafetyReport } from '@tspml/loader';
// Statically imported so the bundler includes the demo mod; `importEntry` below
// returns it for the demo-hud specifier.
import demoHudFactory from '@tspml/demo-hud';
import demoHudManifest from '@tspml/demo-hud/mod.json';
import checkpointCounterFactory from '@tspml/checkpoint-counter';
import checkpointCounterManifest from '@tspml/checkpoint-counter/mod.json';
import type { UserModRecord } from './user-mods';
import { importFromSource, USER_ENTRY_PREFIX, userEntrySpecifier, userModId } from './user-mods';

export interface ModSafetyEntry {
  readonly id: string;
  readonly report: SafetyReport;
}

export interface ModLoadSummary {
  readonly loaded: readonly string[];
  readonly failed: ReadonlyArray<{ id: string; reason: string }>;
  readonly safety: readonly ModSafetyEntry[];
  /**
   * User mods that declared `mixins` — declared honestly UNAPPLIED (#62). The
   * mixin transform runs server-side when the bundle is fetched; the server
   * cannot see this browser's localStorage. Surfaced so the author learns it
   * from the UI, not from silence (the PML failure mode TSPML exists to fix).
   */
  readonly mixinsSkipped: readonly string[];
  /**
   * Tear down every loaded mod, in reverse load order (#17). Idempotent.
   * The caller emits `loader.onUnload` around this — the loader itself has no
   * emit capability (`TspmlApi.events` is a subscribe-only view of the bus).
   */
  readonly unload: () => Promise<void>;
}

export interface LoadModsOptions {
  /** User mods to load alongside the bundled ones (disabled ones are skipped). */
  readonly userMods?: readonly UserModRecord[];
  /**
   * How a user mod's stored source becomes a module. Defaults to the Blob-URL
   * dynamic import; injected in unit tests, which run in node where Blob URLs
   * can't feed `import()`.
   */
  readonly importUserMod?: (record: UserModRecord) => Promise<unknown>;
}

/**
 * Load the bundled demo mods + any user mods against the given (bridge) api.
 * Per-mod failure isolation: a bad mod is reported, never boot-aborts. Also
 * classifies each mod's safety (M6-B, warn-only) for the portal to surface.
 */
export async function loadMods(api: TspmlApi, options: LoadModsOptions = {}): Promise<ModLoadSummary> {
  const userMods = (options.userMods ?? []).filter((m) => m.enabled);
  const importUserMod = options.importUserMod ?? ((record: UserModRecord) => importFromSource(record.code));

  // A user mod is addressed as `user:<id>`; anything else is a bundled specifier.
  const userById = new Map<string, UserModRecord>();
  const preFailed: Array<{ id: string; reason: string }> = [];

  // Ids the bundled mods claim. A user mod colliding with one (or with another
  // user mod) is failed HERE, before load(): the loader treats a duplicate id as
  // abortive for the whole set (rightly — it can't order two mods with one
  // name), but one bad user entry must not take the demo mods down with it.
  const bundledIds = new Set<string>(
    [demoHudManifest, checkpointCounterManifest]
      .map((m) => (m as { id?: unknown }).id)
      .filter((id): id is string => typeof id === 'string'),
  );

  const descriptors: ModDescriptor[] = [
    { manifest: demoHudManifest as unknown, entry: 'demo-hud' },
    { manifest: checkpointCounterManifest as unknown, entry: 'checkpoint-counter' },
  ];

  // User mods that parse cleanly, awaiting the dependency pre-gate below.
  const candidates: Array<{ id: string; record: UserModRecord; mod: Mod }> = [];

  for (const record of userMods) {
    const id = userModId(record);
    if (id === null) {
      // No usable id: hand it to the loader anyway — parseVersionManifest owns
      // the error message, and per-mod isolation reports it as '<unknown>'.
      descriptors.push({ manifest: record.manifest });
      continue;
    }
    if (bundledIds.has(id) || userById.has(id)) {
      preFailed.push({ id, reason: `duplicate mod id '${id}' (already loaded)` });
      continue;
    }
    userById.set(id, record);
    try {
      candidates.push({ id, record, mod: modFromManifest(parseVersionManifest(record.manifest)) });
    } catch {
      // Parse failures are PER-MOD in the loader (never abortive), so this one
      // can go straight through — load() reports it with the parser's message.
      descriptors.push({ manifest: record.manifest, entry: userEntrySpecifier(id) });
    }
  }

  // Dependency pre-gate. Like duplicate ids, RESOLUTION errors (missing
  // `depends`, version conflict, `breaks`, cycle) are abortive in the loader —
  // it cannot order a set it cannot resolve — so a pasted manifest declaring
  // `depends: {"anything": "*"}` would otherwise take the bundled mods down
  // with it. Accept user mods against the resolved set to a fixpoint (so a mod
  // depending on another user mod loads regardless of paste order), and
  // pre-fail whatever never resolves — each with the resolver's own message.
  let accepted: Mod[];
  try {
    accepted = [demoHudManifest, checkpointCounterManifest].map((m) =>
      modFromManifest(parseVersionManifest(m as unknown)),
    );
  } catch {
    // A bundled manifest failing to parse is a repo bug load() will surface;
    // gate the user mods against each other only.
    accepted = [];
  }
  const pending = [...candidates];
  let progress = true;
  while (progress) {
    progress = false;
    for (let i = 0; i < pending.length; ) {
      const c = pending[i]!;
      try {
        resolveDependencies([...accepted, c.mod]);
        accepted.push(c.mod);
        descriptors.push({ manifest: c.record.manifest, entry: userEntrySpecifier(c.id) });
        pending.splice(i, 1);
        progress = true;
      } catch {
        i += 1;
      }
    }
  }
  for (const c of pending) {
    let reason = `mod '${c.id}' has unresolvable dependencies`;
    try {
      resolveDependencies([...accepted, c.mod]);
    } catch (e) {
      reason = e instanceof Error ? e.message : String(e);
    }
    preFailed.push({ id: c.id, reason });
    userById.delete(c.id);
  }

  const importEntry = async (specifier: string): Promise<unknown> => {
    if (specifier === 'demo-hud') return { default: demoHudFactory };
    if (specifier === 'checkpoint-counter') return { default: checkpointCounterFactory };
    if (specifier.startsWith(USER_ENTRY_PREFIX)) {
      const record = userById.get(specifier.slice(USER_ENTRY_PREFIX.length));
      if (!record) throw new Error(`no stored code for '${specifier}'`);
      return await importUserMod(record);
    }
    return await import(/* webpackIgnore: true */ /* @vite-ignore */ specifier);
  };

  const result = await load(descriptors, { api, importEntry });

  const loaded: string[] = [];
  const failed: Array<{ id: string; reason: string }> = [...preFailed];
  for (const [id, s] of Object.entries(result.status)) {
    if (s.status === 'loaded') loaded.push(id);
    else failed.push({ id, reason: s.reason ?? 'unknown' });
  }

  // M6-B: classify each mod's safety (warn-only — never blocks). User mods ride
  // the same classifier as bundled ones.
  const safety: ModSafetyEntry[] = [];
  // User mods whose manifest declares mixins: parse-validated but NOT applied —
  // see ModLoadSummary.mixinsSkipped.
  const mixinsSkipped: string[] = [];
  for (const desc of descriptors) {
    try {
      const manifest = parseVersionManifest(desc.manifest);
      safety.push({ id: manifest.id, report: classifySafety(manifest) });
      if (userById.has(manifest.id) && (manifest.mixins?.length ?? 0) > 0) {
        mixinsSkipped.push(manifest.id);
      }
    } catch {
      // Bad manifest — already in `failed`; skip classification.
    }
  }

  return {
    loaded,
    failed,
    safety,
    mixinsSkipped,
    unload: async () => {
      const un = await result.unload();
      for (const [id, s] of Object.entries(un.status)) {
        // A mod that throws on the way out is isolated by the loader, but it is
        // still a leak the author needs to see — don't swallow it.
        if (s.status === 'failed') api.logger.error(`[tspml] mod '${id}' failed to unload: ${s.reason}`);
      }
    },
  };
}

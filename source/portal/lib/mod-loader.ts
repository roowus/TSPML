/**
 * @tspml/portal — loads the portal's mods via @tspml/loader.
 *
 * All mods are USER mods, added at runtime through the portal UI (pasted,
 * URL-imported, and later registry-imported — #80) and persisted in
 * localStorage (see ./user-mods.ts). There are no bundled mods: the demo mods
 * that once shipped inside the portal now live only in environments/demo-mods
 * for the dev harness, so the mod list is entirely the user's.
 *
 * Every mod goes through the same `load()` call: manifest validation,
 * dependency resolution, per-mod failure isolation, safety classification, and
 * unload.
 */
import type { TspmlApi } from '@tspml/api';
import type { Mod, ModDescriptor, ResolveContext } from '@tspml/loader';
import { classifySafety, load, modFromManifest, parseVersionManifest, resolveDependencies } from '@tspml/loader';
import type { SafetyReport } from '@tspml/loader';
import { TSPML_API_VERSION, TSPML_LOADER_VERSION } from '@tspml/shared';
import type { UserModRecord } from './user-mods';
import { importFromSource, USER_ENTRY_PREFIX, userEntrySpecifier, userModId } from './user-mods';
import { mixinEnvironmentAppliesToHost, PORTAL_HOST_ENVIRONMENT } from './mixin-env';

export interface ModSafetyEntry {
  readonly id: string;
  readonly report: SafetyReport;
}

export interface ModLoadSummary {
  readonly loaded: readonly string[];
  readonly failed: ReadonlyArray<{ id: string; reason: string }>;
  readonly safety: readonly ModSafetyEntry[];
  /**
   * User mods whose manifest DECLARES mixins but whose stored record carries
   * no pasted `mixins.json` (#62). Since #62 pasted mixins DO reach the
   * server-side transform via the request-carried patch plan — this list is
   * only the declared-but-missing-content gap, surfaced so the author learns
   * it from the UI, not from silence (the PML failure mode TSPML exists to
   * fix).
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
  /** The user's mods (disabled ones are skipped). */
  readonly userMods?: readonly UserModRecord[];
  /**
   * How a user mod's stored source becomes a module. Defaults to the Blob-URL
   * dynamic import; injected in unit tests, which run in node where Blob URLs
   * can't feed `import()`.
   */
  readonly importUserMod?: (record: UserModRecord) => Promise<unknown>;
  /**
   * Ambient host facts (#21): the game version (drives `targets` soft-disable)
   * and the environment (drives `environment` soft-disable). Defaults to
   * {@link PORTAL_RESOLVE_CONTEXT} — overridable so tests can pin a version.
   */
  readonly context?: ResolveContext;
}

/**
 * What the portal IS, stated once (#21): a web host running the pinned game
 * version. `NEXT_PUBLIC_POLYTRACK_VERSION` is inlined at build time in the
 * page too — reading it here keeps the two in lockstep.
 *
 * All three special dependency ids now resolve (#73). `tspml` and `tspml-api`
 * come from `@tspml/shared` rather than being written here, because the page
 * also hands `TSPML_VERSION` to mods on the api object — two literals that
 * must agree is the drift #73 was filed about.
 */
export const PORTAL_RESOLVE_CONTEXT: ResolveContext = {
  apiVersion: TSPML_API_VERSION,
  hostEnvironment: PORTAL_HOST_ENVIRONMENT,
  loaderVersion: TSPML_LOADER_VERSION,
  polytrackVersion: process.env.NEXT_PUBLIC_POLYTRACK_VERSION ?? '0.6.2',
};

/**
 * Load the user's mods against the given (bridge) api. Per-mod failure
 * isolation: a bad mod is reported, never boot-aborts. Also classifies each
 * mod's safety (M6-B, warn-only) for the portal to surface.
 */
export async function loadMods(api: TspmlApi, options: LoadModsOptions = {}): Promise<ModLoadSummary> {
  const userMods = (options.userMods ?? []).filter((m) => m.enabled);
  const importUserMod = options.importUserMod ?? ((record: UserModRecord) => importFromSource(record.code));
  const context = options.context ?? PORTAL_RESOLVE_CONTEXT;

  // Every user mod is addressed as `user:<id>`.
  const userById = new Map<string, UserModRecord>();
  const preFailed: Array<{ id: string; reason: string }> = [];

  const descriptors: ModDescriptor[] = [];

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
    // Two records claiming one id must be failed HERE, before load(): the
    // loader treats a duplicate id as abortive for the whole set (rightly — it
    // can't order two mods with one name), but one bad entry must not take the
    // user's other mods down with it.
    if (userById.has(id)) {
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
  // `depends`, version conflict, cycle) are abortive in the loader — it cannot
  // order a set it cannot resolve — so a pasted manifest declaring
  // `depends: {"anything": "*"}` would otherwise take the rest of the user's
  // mods down with it. Accept mods against the resolved set to a fixpoint (so
  // a mod depending on another user mod loads regardless of paste order), and
  // pre-fail whatever never resolves — each with the resolver's own message.
  // (`breaks` (#6), environment and targets mismatches (#21) no longer throw:
  // those mods pass this gate and load() soft-disables them, which the status
  // loop below reports as failed-with-reason. The gate resolves with the SAME
  // context as load() so the two passes cannot disagree about what throws.)
  const accepted: Mod[] = [];
  const pending = [...candidates];
  let progress = true;
  while (progress) {
    progress = false;
    for (let i = 0; i < pending.length; ) {
      const c = pending[i]!;
      try {
        resolveDependencies([...accepted, c.mod], context);
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
      resolveDependencies([...accepted, c.mod], context);
    } catch (e) {
      reason = e instanceof Error ? e.message : String(e);
    }
    preFailed.push({ id: c.id, reason });
    userById.delete(c.id);
  }

  const importEntry = async (specifier: string): Promise<unknown> => {
    if (specifier.startsWith(USER_ENTRY_PREFIX)) {
      const record = userById.get(specifier.slice(USER_ENTRY_PREFIX.length));
      if (!record) throw new Error(`no stored code for '${specifier}'`);
      return await importUserMod(record);
    }
    return await import(/* webpackIgnore: true */ /* @vite-ignore */ specifier);
  };

  const result = await load(descriptors, { api, importEntry, context });

  const loaded: string[] = [];
  const failed: Array<{ id: string; reason: string }> = [...preFailed];
  for (const [id, s] of Object.entries(result.status)) {
    if (s.status === 'loaded') loaded.push(id);
    // 'failed' and 'disabled' (#6 breaks soft-disable) both land here: the
    // summary's contract is "not loaded, and here is the resolver's reason" —
    // the reason text itself says which it was.
    else failed.push({ id, reason: s.reason ?? 'unknown' });
  }

  // M6-B: classify each mod's safety (warn-only — never blocks).
  const safety: ModSafetyEntry[] = [];
  // User mods whose manifest declares mixins with no pasted mixins.json to back
  // them — see ModLoadSummary.mixinsSkipped. Records WITH pasted mixins ride
  // the request-carried plan (#62), so they don't belong here.
  const mixinsSkipped: string[] = [];
  for (const desc of descriptors) {
    try {
      const manifest = parseVersionManifest(desc.manifest);
      safety.push({ id: manifest.id, report: classifySafety(manifest) });
      const record = userById.get(manifest.id);
      // Only descriptors applicable to THIS host count (#21): "paste your
      // mixins.json" is bad advice for a config declared desktop/worker-only —
      // pasting it would change nothing here (the plan builder gates it too).
      const declaresHostMixins = (manifest.mixins ?? []).some((d) =>
        mixinEnvironmentAppliesToHost(d.environment),
      );
      if (record !== undefined && record.mixins === undefined && declaresHostMixins) {
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

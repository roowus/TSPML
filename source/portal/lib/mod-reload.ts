/**
 * Reload user mods from their sources (the "⟳ Reload mods" feature).
 *
 * "Reload" means two different things depending on how a mod got here, and
 * this module only implements the half that needs code:
 *
 * - **Pasted mods** have no source but the stored copy — reloading them is
 *   just re-running the whole set through the loader, which the page already
 *   does on every list change. Nothing to re-fetch.
 * - **URL-imported mods** carry a `sourceUrl` (#80). Reloading re-fetches the
 *   mod from that URL — the modder-iterates-on-a-hosted-mod loop — and
 *   replaces the stored copy, exactly like re-importing by hand.
 *
 * The re-fetch reuses `importModFromUrl` wholesale, so every import rule
 * (browser-direct fetch, host checks, caps, manifest-relative resolution)
 * applies unchanged: reload is a repeat of the import, not a second path.
 *
 * Failures keep the stored copy — a host being down must not eat a working
 * mod — and are reported per mod, never thrown.
 */
import { importModFromUrl } from './mod-import';
import type { ImportResult } from './mod-import';
import { userModId } from './user-mods';
import type { UserModRecord } from './user-mods';

export interface RefreshOutcome {
  /** The full mod list with re-fetched records swapped in, order preserved. */
  readonly next: UserModRecord[];
  /** Ids of mods that were re-fetched from their source. */
  readonly refetched: string[];
  /** Per-mod fetch/parse failures; the stored copy was kept for each. */
  readonly failures: { readonly id: string; readonly error: string }[];
}

/**
 * Re-fetch every mod that has a `sourceUrl` (or just `only`, for a per-row
 * reload) and swap the results into the list. Enabled state, `addedAt`, and
 * the `sourceUrl` itself carry over from the stored record — a reload updates
 * the mod's CONTENT, not the user's choices about it.
 */
export async function refreshFromSources(
  mods: readonly UserModRecord[],
  only?: UserModRecord,
  importImpl: (url: string) => Promise<ImportResult> = importModFromUrl,
): Promise<RefreshOutcome> {
  const refetched: string[] = [];
  const failures: { id: string; error: string }[] = [];
  const next = await Promise.all(
    mods.map(async (mod): Promise<UserModRecord> => {
      if (!mod.sourceUrl || (only !== undefined && mod !== only)) return mod;
      const id = userModId(mod) ?? '(no id)';
      const result = await importImpl(mod.sourceUrl);
      if (!result.ok) {
        failures.push({ id, error: result.error });
        return mod;
      }
      refetched.push(id);
      return {
        manifest: result.mod.manifest,
        code: result.mod.code,
        ...(result.mod.mixins === undefined ? {} : { mixins: result.mod.mixins }),
        enabled: mod.enabled,
        addedAt: mod.addedAt,
        sourceUrl: mod.sourceUrl,
      };
    }),
  );
  return { next, refetched, failures };
}

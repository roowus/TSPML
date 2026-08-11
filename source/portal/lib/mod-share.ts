/**
 * Shareable mod-set links (#80 adjacent).
 *
 * A share link is the portal URL with one `?mods=<url>` query param per
 * URL-imported mod — it carries LINKS ONLY, never mod code. That boundary is
 * the same one the modpack registry (#80) commits to: the portal never becomes
 * a distribution channel for code, only for pointers to code the author hosts
 * themselves. It also keeps links small and keeps a pasted mod (whose only
 * copy is this browser's localStorage) from silently leaking somewhere the
 * author never published it.
 *
 * Opening a share link NEVER auto-runs anything: the page shows the list and
 * asks first (mod code runs unsandboxed — a silent auto-import would be a
 * drive-by). On confirm each link goes through `importModFromUrl`, so every
 * import rule (browser-direct fetch, host checks, caps) applies unchanged.
 *
 * Repeated params (`?mods=a&mods=b`) rather than one comma-joined value:
 * URLSearchParams decodes a joined value ONCE, so an encoded comma inside a
 * mod URL would become indistinguishable from the separator.
 */
import { checkImportUrl } from './mod-import';
import { userModId } from './user-mods';
import type { UserModRecord } from './user-mods';

export const SHARE_PARAM = 'mods';

export const SHARE_LIMITS = {
  /** Max links carried by one share URL — beyond this they are dropped (and
   *  reported), keeping both the URL length and the confirm list sane. */
  maxMods: 16,
} as const;

export interface ShareBuildResult {
  /** The share link, or null when no mod qualifies. */
  readonly url: string | null;
  /** Ids of the mods the link carries (enabled, with a sourceUrl). */
  readonly included: string[];
  /**
   * Enabled mods that CANNOT ride a link because they have no source URL —
   * pasted mods live only in this browser. Named so the sharer can say
   * "you'll have to send these another way" instead of discovering it later.
   */
  readonly noSource: string[];
}

/**
 * Build a share link for the current mod set. Only ENABLED mods are included
 * — the link reproduces what the sharer is actually running, not their
 * archive of toggled-off experiments.
 */
export function buildShareUrl(mods: readonly UserModRecord[], base: string): ShareBuildResult {
  const included: string[] = [];
  const noSource: string[] = [];
  const url = new URL(base);
  url.search = ''; // never carry over unrelated params (or stale mods= ones)
  url.hash = '';
  for (const mod of mods) {
    if (!mod.enabled) continue;
    const id = userModId(mod) ?? '(no id)';
    if (typeof mod.sourceUrl === 'string' && mod.sourceUrl.length > 0) {
      if (included.length < SHARE_LIMITS.maxMods) {
        url.searchParams.append(SHARE_PARAM, mod.sourceUrl);
        included.push(id);
      }
    } else {
      noSource.push(id);
    }
  }
  return { url: included.length > 0 ? url.href : null, included, noSource };
}

export interface ShareParseResult {
  /** Deduped, host-checked mod URLs, in link order. */
  readonly urls: string[];
  /** Links refused by the import URL rules (bad scheme, kodub, /api). */
  readonly invalid: { readonly url: string; readonly error: string }[];
  /** How many links past the cap were dropped. */
  readonly dropped: number;
}

/**
 * Read the mod links out of a page URL's query string. Every link is
 * re-validated with the import rules HERE, before anything is shown to the
 * user — a share link is untrusted input from whoever crafted it, so a
 * kodub/API-pointing entry is refused at the door, not at fetch time.
 */
export function parseShareUrls(search: string): ShareParseResult {
  const params = new URLSearchParams(search);
  const raw = params.getAll(SHARE_PARAM).map((u) => u.trim()).filter((u) => u.length > 0);
  const seen = new Set<string>();
  const urls: string[] = [];
  const invalid: { url: string; error: string }[] = [];
  let dropped = 0;
  for (const candidate of raw) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    const check = checkImportUrl(candidate);
    if (!check.ok) {
      invalid.push({ url: candidate, error: check.error });
      continue;
    }
    if (urls.length >= SHARE_LIMITS.maxMods) {
      dropped++;
      continue;
    }
    urls.push(candidate);
  }
  return { urls, invalid, dropped };
}

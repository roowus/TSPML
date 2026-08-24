/**
 * Import a mod from a URL (#80, first slice: direct-link import).
 *
 * This file is now a thin facade over two halves, and keeps its original
 * exported surface so every existing caller and test is unaffected:
 *  - **transport** — `lib/mod-fetch.ts`: URL policy, capped fetches, cache busting.
 *  - **interpretation** — `lib/mod-formats/`: what the fetched bytes MEAN.
 *
 * The split exists because TSPML is not the only PolyTrack mod format. PML
 * shipped first, and running its mods (natively or via an adapter) is a stated
 * direction. Splitting now costs nothing and means that lands as a new file in
 * `mod-formats/` rather than as surgery here. See `mod-formats/types.ts` for the
 * shape and `mod-formats/pml.ts` for what is and is not promised.
 *
 * The fetch happens in the page, with the browser's own `fetch` — NEVER through
 * `/api/proxy`. That is a #80 invariant; see `lib/mod-fetch.ts` for why.
 *
 * Two accepted shapes, unchanged:
 *  - a `mod.json` URL — entrypoint, host-applicable `mixins` configs (#21), and
 *    `physics.json` (#43) are fetched RELATIVE to it;
 *  - a single built `.js` file URL — a minimal manifest is synthesized.
 *
 * Everything lands in the same {@link UserModRecord} shape as the paste path
 * and rides the identical loader/plan pipeline — import is an input method,
 * not a second trust model. The unsandboxed-code disclosure applies unchanged.
 */
import { checkImportUrl } from './mod-fetch';
import { dispatchImport } from './mod-formats';
import type { ImportResult, ModFormatId } from './mod-formats/types';

// Re-exported so the module's public surface is unchanged by the split.
export { checkImportUrl, IMPORT_LIMITS } from './mod-fetch';
export type { FetchLike } from './mod-fetch';
export type { ImportedMod, ImportResult, ModFormatId } from './mod-formats/types';
export { SUPPORTED_FORMATS, isSupportedFormat } from './mod-formats';

export interface ImportOptions {
  /**
   * Force truly fresh fetches (the ⟳ reload path). Two layers of cache stand
   * between "I pushed a new build" and "the portal sees it": the browser's
   * HTTP cache (a plain fetch is satisfied locally for the host's whole
   * max-age — raw.githubusercontent.com serves 300s) and the host CDN's.
   * `fresh` sets `cache: 'no-cache'`, which reliably defeats the browser
   * layer, and appends a throwaway `tspml_fresh` query param, which defeats
   * CDNs that key their cache on the full URL (jsDelivr, most raw hosts).
   * GitHub's own CDN ignores unknown params in its cache key, so there a
   * just-pushed change can still take up to ~5 minutes to appear — that
   * floor is the host's, not ours. Trade-off of the param: URLs strict
   * about their query string (e.g. presigned S3 links) won't tolerate it —
   * those fail loudly on reload and keep the stored copy, they don't corrupt.
   */
  readonly fresh?: boolean;
  /**
   * Skip format detection and use this one. The registry passes it, because a
   * curated entry already declares its format — re-deriving it from bytes would
   * be strictly worse information. Omitted everywhere else, where sniffing is
   * the only option available.
   */
  readonly format?: ModFormatId;
}

/**
 * Import a mod from `rawUrl`. The URL policy is enforced here, before any
 * format sees it; the format is then chosen by `options.format`, the path
 * extension, or a single content probe (see `lib/mod-formats/index.ts`).
 */
export async function importModFromUrl(
  rawUrl: string,
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response> = fetch,
  options: ImportOptions = {},
): Promise<ImportResult> {
  const checked = checkImportUrl(rawUrl);
  if (!checked.ok) return checked;
  // One bust value per import, so the manifest and the files it points at all
  // come from the same freshness horizon.
  const bust = options.fresh ? Date.now().toString(36) : null;
  return dispatchImport(checked.url, fetchImpl, bust, options.format);
}

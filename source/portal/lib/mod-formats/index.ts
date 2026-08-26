/**
 * Format dispatch for mod import.
 *
 * Three ways a format is chosen, in strict precedence order:
 *
 *  1. **Explicit** — the caller states it. Registry installs do this, because
 *     the curated entry already carries a `format` field; there is no reason to
 *     re-derive from bytes what the catalog told us.
 *  2. **Path extension** — `.js`/`.mjs` is a bare TSPML entrypoint. (`.json` is
 *     NOT decided here: both formats use `.json` manifests, so it falls through
 *     to the sniff, which is the only thing that can tell them apart.)
 *  3. **Content sniff** — fetch once, parse, and look at which keys are present.
 *
 * The sniff order matters and is not arbitrary. `entrypoint` is checked before
 * `polymod` so a manifest carrying both (a mod shipping for both loaders, which
 * is the natural way to ship one) resolves to the format we can actually run
 * rather than to the refusal.
 *
 * The single probe body is threaded into the chosen format via
 * `ImportContext.probed`, so detection costs no extra round-trip.
 */
import { fetchText as rawFetchText, IMPORT_LIMITS, type FetchLike } from '../mod-fetch';
import type { ImportContext, ImportResult, ModFormat, ModFormatId } from './types';
import { tspmlFormat } from './tspml';
import { pmlFormat } from './pml';

export const FORMATS: Readonly<Record<ModFormatId, ModFormat>> = {
  tspml: tspmlFormat,
  pml: pmlFormat,
};

/** Formats this build can install. `pml` installs through the compatibility
 *  adapter in `lib/pml/` — partially, and labelled as such at install time. */
export const SUPPORTED_FORMATS: readonly ModFormatId[] = ['tspml', 'pml'];

export function isSupportedFormat(id: string): id is ModFormatId {
  return (SUPPORTED_FORMATS as readonly string[]).includes(id);
}

/** Build the context a format receives: capped fetches, bound bust token. */
export function makeImportContext(
  fetchImpl: FetchLike,
  bust: string | null,
  probed?: { text: string; contentType: string },
): ImportContext {
  return {
    fetchImpl,
    bust,
    ...(probed === undefined ? {} : { probed }),
    fetchText: (url, cap, what) => rawFetchText(url, cap, what, fetchImpl, bust),
  };
}

/** Which format a parsed manifest object declares itself to be, or null when
 *  neither marker is present (an extension-less code file, typically). */
export function sniffManifestFormat(parsed: unknown): ModFormatId | null {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const m = parsed as Record<string, unknown>;
  // `entrypoint` first, deliberately: a dual-format manifest should resolve to
  // the format we can run natively.
  if (typeof m.entrypoint === 'string' && m.entrypoint.length > 0) return 'tspml';
  if (typeof m.polymod === 'object' && m.polymod !== null) return 'pml';
  // A PML INDEX manifest carries neither — it is a bare `{"latest": {…}}` map
  // whose job is to name the version manifest that does. Without this the walk
  // never starts and a mod root URL is misread as a TSPML manifest.
  if (typeof m.latest === 'object' && m.latest !== null && !Array.isArray(m.latest)) return 'pml';
  return null;
}

/**
 * Choose a format for `url` and run it. Fetches at most one body for detection
 * and hands it to the format, so the common path costs the same as before the
 * seam existed.
 */
export async function dispatchImport(
  url: URL,
  fetchImpl: FetchLike,
  bust: string | null,
  explicit?: ModFormatId,
): Promise<ImportResult> {
  if (explicit !== undefined) {
    return stamp(explicit, await FORMATS[explicit].import(url, makeImportContext(fetchImpl, bust)));
  }

  // A bare code file needs no probe — only TSPML has that shape.
  if (/\.m?js$/i.test(url.pathname)) {
    return stamp('tspml', await tspmlFormat.import(url, makeImportContext(fetchImpl, bust)));
  }

  // Everything else: fetch once, decide, and pass the bytes on. The manifest
  // cap is NOT applied here — a `.json` path that is over it must be reported
  // as an oversized manifest by the format, not as an undetectable one.
  const isJsonPath = /\.json$/i.test(url.pathname);
  const probe = await rawFetchText(
    url.href,
    isJsonPath ? IMPORT_LIMITS.maxManifestChars : IMPORT_LIMITS.maxCodeChars,
    isJsonPath ? 'manifest' : 'mod file',
    fetchImpl,
    bust,
  );
  if (!probe.ok) return probe;

  let sniffed: ModFormatId | null = null;
  try {
    sniffed = sniffManifestFormat(JSON.parse(probe.text));
  } catch {
    // Not JSON: a code body. tspml's own sniff handles it from here.
  }
  const id: ModFormatId = sniffed ?? 'tspml';
  return stamp(
    id,
    await FORMATS[id].import(
      url,
      makeImportContext(fetchImpl, bust, { text: probe.text, contentType: probe.contentType }),
    ),
  );
}

/**
 * Record which format produced a result.
 *
 * Done HERE, once, rather than in each format: `format` is what decides how the
 * stored code is later EXECUTED, and a format that forgot to set it would ship
 * mods that install fine and then run down the wrong path — a failure that
 * surfaces at load time, in someone else's file. The dispatcher already knows
 * the answer, so it is the only place that should be trusted to say it.
 */
function stamp(id: ModFormatId, result: ImportResult): ImportResult {
  return result.ok ? { ok: true, mod: { ...result.mod, format: id } } : result;
}

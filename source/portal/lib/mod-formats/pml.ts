/**
 * The PolyModLoader (PML) format — importable, with honest partial support.
 *
 * PML is PolyTrack's first mod loader and has the ecosystem to show for it.
 * TSPML remains the native format and the better-specified one; this file makes
 * a PML mod INSTALLABLE anyway, by walking PML's own CDN layout, translating its
 * manifest, and running its module against an adapter (`lib/pml/`). Nothing on
 * the TSPML path changes — a TSPML mod never touches any of this.
 *
 * ## The walk
 *
 * PML mods are a CDN directory tree, not one file:
 *
 * ```
 * <mod>/manifest.json          {"latest": {"0.6.2": "1.2.0"}}   ← INDEX
 * <mod>/1.2.0/version.json     {"polymod": {…, "main": "main"}} ← VERSION
 * <mod>/1.2.0/main.mod.js                                       ← the code
 * ```
 *
 * Two files carry metadata and BOTH are conventionally named `manifest.json` or
 * `version.json` depending on where in the tree they sit, so the walk is driven
 * by CONTENT, not by filename: a body with a `latest` object is an index (follow
 * it), a body with a `polymod` object is a version manifest (use it). A URL
 * pointed straight at a version manifest therefore works without a second fetch,
 * which is what a mod page's "raw" link usually gives you.
 *
 * The names differ between PML's own docs and its repo template (`latest.json`
 * vs `manifest.json`, `version.json` vs `manifest.json`), which is exactly why
 * guessing filenames would be the wrong design. When the URL names a DIRECTORY,
 * both spellings are probed in turn and the one that answers wins.
 *
 * ## What "installable" honestly means
 *
 * Lifecycle hooks, keybinds, settings and `getMod` carry. Mixins do not, and
 * they are refused per call with a reason rather than aborting the mod — see
 * `lib/pml/shim.ts` for why they are not translatable and why refusing beats
 * pretending. That report reaches the UI at install time, so a mod that is
 * mostly mixins is visibly a mod that will mostly not work, BEFORE the player
 * wonders why nothing happened.
 */
import { fail, IMPORT_LIMITS, checkImportUrl } from '../mod-fetch';
import {
  isPmlIndexManifest,
  isPmlVersionManifest,
  pickPmlVersion,
  translatePmlManifest,
} from '../pml/manifest';
import type { ImportContext, ImportResult, ModFormat } from './types';

/** The game version this portal serves — the key an index manifest is read at. */
const GAME_VERSION = process.env.NEXT_PUBLIC_POLYTRACK_VERSION ?? '0.6.2';

/** Filenames to try when the URL names a directory. Both spellings are real. */
const INDEX_NAMES = ['manifest.json', 'latest.json'] as const;
const VERSION_NAMES = ['version.json', 'manifest.json'] as const;

type Body = { ok: true; text: string; contentType: string } | { ok: false; error: string };

/** The dispatcher's already-fetched body, or a fresh fetch. Mirrors
 *  `tspml.ts`'s helper of the same name — detection must not cost a round-trip. */
function body(ctx: ImportContext, url: URL, cap: number, what: string): Promise<Body> | Body {
  if (ctx.probed !== undefined) {
    return { ok: true, text: ctx.probed.text, contentType: ctx.probed.contentType };
  }
  return ctx.fetchText(url.href, cap, what);
}

function parseJson(text: string, what: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (e) {
    return { ok: false, error: `${what} is not valid JSON: ${(e as Error).message.slice(0, 80)}` };
  }
}

/** Fetch `url`, checking the host rules first. Every hop re-checks: a manifest
 *  redirecting the walk at kodub hosts must not sneak past the entry check. */
async function fetchChecked(
  ctx: ImportContext,
  url: URL,
  cap: number,
  what: string,
): Promise<Body> {
  const check = checkImportUrl(url.href);
  if (!check.ok) return fail(`${what}: ${check.error}`);
  return await ctx.fetchText(url.href, cap, what);
}

/**
 * The first of `names` that resolves to JSON under `base`, or null.
 *
 * Probing is bounded to two names and only happens when the URL named a
 * directory — a mod page's link is normally a file, and this costs nothing then.
 */
async function probeNames(
  ctx: ImportContext,
  base: URL,
  names: readonly string[],
  what: string,
): Promise<{ url: URL; value: unknown } | null> {
  for (const name of names) {
    let url: URL;
    try {
      url = new URL(name, base);
    } catch {
      continue;
    }
    const res = await fetchChecked(ctx, url, IMPORT_LIMITS.maxManifestChars, `${what} (${name})`);
    if (!res.ok) continue;
    const parsed = parseJson(res.text, name);
    if (parsed.ok) return { url, value: parsed.value };
  }
  return null;
}

/** A URL that names a directory (trailing slash, or no dot in the last path
 *  segment) — the case where the walk has to probe for a filename. */
function isDirectoryUrl(url: URL): boolean {
  const last = url.pathname.split('/').pop() ?? '';
  return last.length === 0 || !last.includes('.');
}

/** Ensure `url` ends in a slash so `new URL(name, base)` descends rather than
 *  replacing the last segment. */
function asDirectory(url: URL): URL {
  if (url.pathname.endsWith('/')) return url;
  const copy = new URL(url.href);
  copy.pathname = `${copy.pathname}/`;
  return copy;
}

/**
 * Resolve an index manifest (`{"latest": {…}}`) to its version manifest.
 *
 * The index lives at the mod ROOT and names a mod version; the version manifest
 * lives in `<root>/<version>/`. Both filename spellings are probed there for the
 * same reason they are at the root.
 */
async function followIndex(
  ctx: ImportContext,
  indexUrl: URL,
  parsed: Record<string, unknown>,
): Promise<{ ok: true; url: URL; value: unknown; note?: string } | { ok: false; error: string }> {
  const latest = parsed.latest as Record<string, unknown>;
  const picked = pickPmlVersion(latest, GAME_VERSION);
  if (picked === null) {
    const offered = Object.keys(latest).join(', ');
    return fail(
      `this mod's index lists no build for PolyTrack ${GAME_VERSION} (it offers: ${offered || 'nothing'}). Point the import at a specific version's manifest to install that build anyway.`,
    );
  }
  const versionDir = new URL(`${picked.version}/`, asDirectory(new URL('./', indexUrl)));
  const found = await probeNames(ctx, versionDir, VERSION_NAMES, `version ${picked.version} manifest`);
  if (found === null) {
    return fail(
      `the mod's index points at version ${picked.version}, but no ${VERSION_NAMES.join(' or ')} could be read from ${versionDir.href}`,
    );
  }
  return {
    ok: true,
    url: found.url,
    value: found.value,
    ...(picked.exact
      ? {}
      : {
          note: `the mod's index lists no build for PolyTrack ${GAME_VERSION}; its only entry (version ${picked.version}) was used`,
        }),
  };
}

export const pmlFormat: ModFormat = {
  id: 'pml',
  async import(url: URL, ctx: ImportContext): Promise<ImportResult> {
    const notes: string[] = [];

    // 1. Get SOMETHING JSON-shaped: the probed body, a named file, or a probe
    //    of the two conventional names when the URL is a directory.
    let manifestUrl = url;
    let parsed: unknown;
    if (isDirectoryUrl(url) && ctx.probed === undefined) {
      const dir = asDirectory(url);
      const found =
        (await probeNames(ctx, dir, INDEX_NAMES, 'index')) ??
        (await probeNames(ctx, dir, VERSION_NAMES, 'manifest'));
      if (found === null) {
        return fail(
          `no PML manifest could be read from ${dir.href} (tried ${[...new Set([...INDEX_NAMES, ...VERSION_NAMES])].join(', ')})`,
        );
      }
      manifestUrl = found.url;
      parsed = found.value;
    } else {
      const res = await body(ctx, url, IMPORT_LIMITS.maxManifestChars, 'PML manifest');
      if (!res.ok) return res;
      const json = parseJson(res.text, 'the PML manifest');
      if (!json.ok) return fail(json.error);
      parsed = json.value;
    }

    // 2. An index manifest is one hop from the real one.
    if (isPmlIndexManifest(parsed)) {
      const followed = await followIndex(ctx, manifestUrl, parsed as Record<string, unknown>);
      if (!followed.ok) return followed;
      manifestUrl = followed.url;
      parsed = followed.value;
      if (followed.note !== undefined) notes.push(followed.note);
    }

    if (!isPmlVersionManifest(parsed)) {
      return fail(
        "this does not look like a PML manifest — it has neither a 'polymod' block (a version manifest) nor a 'latest' map (an index manifest)",
      );
    }

    // 3. Translate. Pure, and the only place that knows the field mapping.
    const translated = translatePmlManifest(parsed);
    if (!translated.ok) return fail(translated.error);
    const { manifest, entryPath, notes: translationNotes } = translated.value;
    notes.push(...translationNotes);

    // 4. The code, relative to the version manifest, re-checked like every hop.
    let entryUrl: URL;
    try {
      entryUrl = new URL(entryPath, manifestUrl);
    } catch {
      return fail(`the mod's entry file '${entryPath}' does not resolve against ${manifestUrl.href}`);
    }
    const code = await fetchChecked(ctx, entryUrl, IMPORT_LIMITS.maxCodeChars, `entry (${entryPath})`);
    if (!code.ok) return code;

    // The base URL a PML mod resolves its own assets against (`icon.png`,
    // `assets/*.glb`). Recorded so the shim can hand it to the mod rather than
    // leaving relative asset paths to resolve against a blob: URL.
    // Read back rather than indexed-assigned: `translatePmlManifest` always
    // writes `custom.pml`, but under `noUncheckedIndexedAccess` a lookup
    // through an index signature is `| undefined`, and asserting it away here
    // would be asserting about a shape this file does not own.
    const custom = manifest.custom as { pml?: Record<string, unknown> } | undefined;
    if (custom?.pml !== undefined) custom.pml.baseUrl = new URL('./', manifestUrl).href;

    return {
      ok: true,
      mod: {
        manifest,
        code: code.text,
        note: [
          'imported as a PML mod through TSPML\'s compatibility adapter: lifecycle hooks, keybinds and settings carry across; mixins do not and are reported per call when the mod runs.',
          ...notes,
        ].join(' '),
      },
    };
  },
};

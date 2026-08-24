/**
 * The TSPML mod format — the native one, and the only installable format today.
 *
 * Two accepted shapes, unchanged from before the format seam existed:
 *  - a `mod.json` URL — the manifest's `entrypoint` (plus any `mixins` config
 *    files applicable to this web host, #21, and its `physics.json`, #43) are
 *    fetched RELATIVE to it, the same layout a mod repo already has;
 *  - a single built `.js` file URL — a minimal manifest is synthesized from
 *    the filename so "the URL is just the file" works too.
 *
 * Everything lands in the same {@link ImportedMod} shape as the paste path and
 * rides the identical loader/plan pipeline — import is an input method, not a
 * second trust model. The unsandboxed-code disclosure applies unchanged.
 */
import { parseMixinsJson } from '../user-mods';
import { USER_PATCH_LIMITS } from '../user-patches';
import { parsePhysicsJson } from '../physics-plan';
import { mixinEnvironmentAppliesToHost } from '../mixin-env';
import { checkImportUrl, fail, IMPORT_LIMITS } from '../mod-fetch';
import type { ImportContext, ImportResult, ModFormat } from './types';

/** Mod-id slug from the file name: `My_Mod.v2.js` → `my-mod-v2`. */
function slugFromUrl(url: URL): string {
  const base = url.pathname.split('/').pop() ?? '';
  const slug = base
    .replace(/\.(m?js|json)$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'imported-mod';
}

/** Enforce the same add-time mixin caps as the paste path. */
function checkMixinCaps(patches: Record<string, unknown>[]): string | null {
  if (patches.length > USER_PATCH_LIMITS.maxPatchesPerMod) {
    return `mixins declare ${patches.length} patches — the limit is ${USER_PATCH_LIMITS.maxPatchesPerMod}`;
  }
  const oversized = patches.find(
    (p) => typeof p.inject === 'string' && p.inject.length > USER_PATCH_LIMITS.maxInjectChars,
  );
  if (oversized) return `a mixin patch's inject exceeds ${USER_PATCH_LIMITS.maxInjectChars.toLocaleString()} characters`;
  return null;
}

/** The `mixins` declarations of a raw manifest that apply to THIS (web) host. */
function hostMixinConfigs(manifest: Record<string, unknown>): string[] {
  const raw = manifest.mixins;
  if (!Array.isArray(raw)) return [];
  const configs: string[] = [];
  for (const d of raw) {
    if (typeof d !== 'object' || d === null) continue;
    const { config, environment } = d as { config?: unknown; environment?: unknown };
    if (typeof config !== 'string' || config.length === 0) continue;
    if (!mixinEnvironmentAppliesToHost(environment)) continue;
    if (!configs.includes(config)) configs.push(config);
  }
  return configs;
}

export async function importFromManifest(
  manifestText: string,
  baseUrl: URL,
  ctx: ImportContext,
): Promise<ImportResult> {
  let manifest: unknown;
  try {
    manifest = JSON.parse(manifestText);
  } catch (e) {
    return fail(`the URL's content is not valid JSON: ${(e as Error).message.slice(0, 80)}`);
  }
  if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
    return fail('the manifest must be a JSON object (the contents of mod.json)');
  }
  const m = manifest as Record<string, unknown>;
  if (typeof m.entrypoint !== 'string' || m.entrypoint.length === 0) {
    return fail("the manifest has no 'entrypoint' — cannot tell which file to fetch next");
  }

  // Entrypoint rides relative to the manifest URL — the layout a mod repo
  // already has. The resolved URL re-passes the host checks (a manifest
  // pointing its entrypoint at kodub/api would otherwise sneak past).
  let entryUrl: URL;
  try {
    entryUrl = new URL(m.entrypoint, baseUrl);
  } catch {
    return fail(`the manifest's entrypoint '${m.entrypoint}' does not resolve against the manifest URL`);
  }
  const entryCheck = checkImportUrl(entryUrl.href);
  if (!entryCheck.ok) return fail(`entrypoint: ${entryCheck.error}`);
  const code = await ctx.fetchText(entryUrl.href, IMPORT_LIMITS.maxCodeChars, `entrypoint (${m.entrypoint})`);
  if (!code.ok) return code;

  // Mixin configs applicable to this web host (#21) ride relative too and
  // concat into the single patches array a UserModRecord carries — the same
  // flattening the paste path's one mixins.json box implies.
  const patches: Record<string, unknown>[] = [];
  for (const config of hostMixinConfigs(m)) {
    let configUrl: URL;
    try {
      configUrl = new URL(config, baseUrl);
    } catch {
      return fail(`mixins config '${config}' does not resolve against the manifest URL`);
    }
    const configCheck = checkImportUrl(configUrl.href);
    if (!configCheck.ok) return fail(`mixins (${config}): ${configCheck.error}`);
    const text = await ctx.fetchText(configUrl.href, IMPORT_LIMITS.maxMixinsChars, `mixins (${config})`);
    if (!text.ok) return text;
    const parsed = parseMixinsJson(text.text);
    if (!parsed.ok) return fail(`mixins (${config}): ${parsed.error}`);
    patches.push(...parsed.patches);
  }
  const capError = checkMixinCaps(patches);
  if (capError) return fail(capError);

  // #43: the mod's physics.json, if it declares one. Rides relative to the
  // manifest like everything else, and is VALIDATED here rather than merely
  // fetched — a physics patch is a write into a binary, so an import must not
  // store a shape the plan builder will later reject with the author long gone.
  let physics: Record<string, unknown> | undefined;
  if (typeof m.physics === 'string' && m.physics.length > 0) {
    let physicsUrl: URL;
    try {
      physicsUrl = new URL(m.physics, baseUrl);
    } catch {
      return fail(`physics '${m.physics}' does not resolve against the manifest URL`);
    }
    const physicsCheck = checkImportUrl(physicsUrl.href);
    if (!physicsCheck.ok) return fail(`physics: ${physicsCheck.error}`);
    const text = await ctx.fetchText(
      physicsUrl.href,
      IMPORT_LIMITS.maxPhysicsChars,
      `physics (${m.physics})`,
    );
    if (!text.ok) return text;
    const parsed = parsePhysicsJson(text.text);
    if (!parsed.ok) return fail(`physics (${m.physics}): ${parsed.error}`);
    // Store the RAW object, not `parsed.plan`: the record's contract is "the
    // file as the author wrote it", re-parsed on every use. Keeping the parsed
    // form would freeze this build's normalisation into storage.
    physics = JSON.parse(text.text) as Record<string, unknown>;
  }

  return {
    ok: true,
    mod: {
      manifest: m,
      code: code.text,
      ...(patches.length > 0 ? { mixins: patches } : {}),
      ...(physics === undefined ? {} : { physics }),
    },
  };
}

export function importFromCode(codeText: string, url: URL): ImportResult {
  const id = slugFromUrl(url);
  const file = url.pathname.split('/').pop() ?? 'index.js';
  return {
    ok: true,
    mod: {
      // Deep validation stays the loader's job, same as the paste path — this
      // literal only needs to be an honest minimal manifest.
      manifest: {
        schemaVersion: 1,
        id,
        name: file,
        version: '0.0.0',
        environment: 'web',
        entrypoint: file,
        // The loader's manifest validator requires `targets` (an array of
        // semver ranges; empty = "runs on any game version") — a synthesized
        // manifest without it fails validation before the mod ever loads.
        targets: [],
      },
      code: codeText,
      note: `single-file import — a minimal manifest was generated (id '${id}', version 0.0.0)`,
    },
  };
}

type Body = { ok: true; text: string; contentType: string } | { ok: false; error: string };

/** The already-probed body, or a fresh fetch. Normalising to one result union
 *  keeps the branches below from re-deriving which shape they are holding. */
function body(ctx: ImportContext, url: URL, cap: number, what: string): Promise<Body> | Body {
  if (ctx.probed !== undefined) {
    return { ok: true, text: ctx.probed.text, contentType: ctx.probed.contentType };
  }
  return ctx.fetchText(url.href, cap, what);
}

/** The manifest cap applies wherever a body is treated AS a manifest, including
 *  the sniffed paths where it was fetched under the (larger) code cap. */
function overManifestCap(text: string): { ok: false; error: string } | null {
  if (text.length <= IMPORT_LIMITS.maxManifestChars) return null;
  return fail(
    `manifest: file is ${text.length.toLocaleString()} characters — the import limit is ${IMPORT_LIMITS.maxManifestChars.toLocaleString()}`,
  );
}

/**
 * Resolve `url` as a TSPML mod. Path shape decides: a `.json` path is a
 * manifest, a `.js`/`.mjs` path is a bare entrypoint; anything else uses the
 * body the dispatcher already probed (or fetches one) and sniffs.
 */
export const tspmlFormat: ModFormat = {
  id: 'tspml',
  async import(url: URL, ctx: ImportContext): Promise<ImportResult> {
    if (/\.json$/i.test(url.pathname)) {
      const manifest = await body(ctx, url, IMPORT_LIMITS.maxManifestChars, 'manifest');
      if (!manifest.ok) return manifest;
      return overManifestCap(manifest.text) ?? (await importFromManifest(manifest.text, url, ctx));
    }
    if (/\.m?js$/i.test(url.pathname)) {
      const code = await body(ctx, url, IMPORT_LIMITS.maxCodeChars, 'mod file');
      if (!code.ok) return code;
      return importFromCode(code.text, url);
    }

    const sniffed = await body(ctx, url, IMPORT_LIMITS.maxCodeChars, 'mod file');
    if (!sniffed.ok) return sniffed;
    const { text, contentType } = sniffed;
    if (contentType.includes('json')) {
      return overManifestCap(text) ?? (await importFromManifest(text, url, ctx));
    }
    // Raw-file hosts often serve JSON as text/plain — sniff before assuming JS.
    try {
      const parsed: unknown = JSON.parse(text);
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        !Array.isArray(parsed) &&
        typeof (parsed as { entrypoint?: unknown }).entrypoint === 'string'
      ) {
        return overManifestCap(text) ?? (await importFromManifest(text, url, ctx));
      }
    } catch {
      // Not JSON — treat as code below.
    }
    return importFromCode(text, url);
  },
};

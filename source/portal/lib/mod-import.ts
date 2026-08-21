/**
 * Import a mod from a URL (#80, first slice: direct-link import).
 *
 * The fetch happens HERE, in the page, with the browser's own `fetch` — NEVER
 * through `/api/proxy`. That is a #80 invariant, not a convenience: the proxy
 * exists to reach the game, and the server must not become a fetcher (or
 * cache) of arbitrary user-pointed URLs. The service worker leaves non-kodub
 * URLs alone, so these requests go straight from the browser to the host.
 * CORS therefore applies: the host must allow cross-origin reads — raw
 * GitHub/gist links and CDNs (jsDelivr, unpkg) do; most web pages don't.
 *
 * Two accepted shapes:
 *  - a `mod.json` URL — the manifest's `entrypoint` (plus any `mixins` config
 *    files applicable to this web host, #21, and its `physics.json`, #43) are
 *    fetched RELATIVE to it, the same layout a mod repo already has;
 *  - a single built `.js` file URL — a minimal manifest is synthesized from
 *    the filename so "the URL is just the file" works too.
 *
 * Everything lands in the same {@link UserModRecord} shape as the paste path
 * and rides the identical loader/plan pipeline — import is an input method,
 * not a second trust model. The unsandboxed-code disclosure applies unchanged.
 */
import { parseMixinsJson } from './user-mods';
import { USER_PATCH_LIMITS } from './user-patches';
import { parsePhysicsJson } from './physics-plan';
import { mixinEnvironmentAppliesToHost } from './mixin-env';

export interface ImportedMod {
  readonly manifest: Record<string, unknown>;
  readonly code: string;
  readonly mixins?: Record<string, unknown>[];
  /** The mod's `physics.json`, fetched relative to the manifest URL when it
   *  declares one (#43). Stored raw and re-validated on every use. */
  readonly physics?: Record<string, unknown>;
  /** Human note about non-obvious handling (e.g. "manifest synthesized"). */
  readonly note?: string;
}

export type ImportResult =
  | { readonly ok: true; readonly mod: ImportedMod }
  | { readonly ok: false; readonly error: string };

/** Add-time caps, sized like the paste path's: generous for real mods, small
 *  enough that a mistyped URL to a huge asset fails fast and clearly. */
export const IMPORT_LIMITS = {
  maxManifestChars: 65_536,
  maxCodeChars: 2_000_000,
  maxMixinsChars: USER_PATCH_LIMITS.maxBodyBytes,
  /** A physics.json is a pin plus at most 16 numeric patches (#43), so this is
   *  roomy by two orders of magnitude — it only exists to fail a mistyped URL
   *  pointing at something large, fast and clearly. */
  maxPhysicsChars: 65_536,
  timeoutMs: 20_000,
} as const;

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

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
}

/** `url` with the cache-busting param applied (when `bust` is non-null). */
function withBust(url: string, bust: string | null): string {
  if (bust === null) return url;
  const u = new URL(url);
  u.searchParams.set('tspml_fresh', bust);
  return u.href;
}

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

/**
 * Validate an import URL. https-only (http allowed for localhost dev), and
 * two hosts are refused outright: kodub URLs are the GAME — the service
 * worker would rewrite them into /api/proxy, which mod code must never
 * transit — and this portal's own /api/ for the same reason.
 */
export function checkImportUrl(raw: string): { ok: true; url: URL } | { ok: false; error: string } {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return fail('that is not an absolute URL — include the https:// prefix');
  }
  const localhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && localhost)) {
    return fail('only https:// URLs can be imported (http:// is allowed for localhost only)');
  }
  if (url.hostname === 'kodub.com' || url.hostname.endsWith('.kodub.com')) {
    return fail('kodub.com hosts the game, not mods — those URLs are routed through the game proxy and cannot carry mod code');
  }
  if (typeof window !== 'undefined' && url.origin === window.location.origin && url.pathname.startsWith('/api/')) {
    return fail('the portal API cannot be an import source');
  }
  return { ok: true, url };
}

async function fetchText(
  url: string,
  cap: number,
  what: string,
  fetchImpl: FetchLike,
  bust: string | null,
): Promise<{ ok: true; text: string; contentType: string } | { ok: false; error: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), IMPORT_LIMITS.timeoutMs);
  let res: Response;
  try {
    // 'no-cache' beats the BROWSER's HTTP cache (a plain re-fetch would be
    // satisfied locally for raw.githubusercontent's max-age=300); the `bust`
    // param beats the host CDN's cache — see ImportOptions.fresh.
    res = await fetchImpl(withBust(url, bust), {
      signal: ctrl.signal,
      credentials: 'omit',
      redirect: 'follow',
      cache: bust === null ? 'default' : 'no-cache',
    });
  } catch (e) {
    const detail = e instanceof Error && e.name === 'AbortError' ? 'timed out' : (e as Error).message;
    return fail(
      `${what}: fetch failed (${detail}). The host must allow cross-origin reads (CORS) — raw-file URLs (raw.githubusercontent.com, gist raw, jsDelivr) work; regular web pages usually don't.`,
    );
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) return fail(`${what}: HTTP ${res.status} from ${new URL(url).hostname}`);
  const text = await res.text();
  if (text.length > cap) {
    return fail(`${what}: file is ${text.length.toLocaleString()} characters — the import limit is ${cap.toLocaleString()}`);
  }
  return { ok: true, text, contentType: res.headers.get('content-type') ?? '' };
}

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

async function importFromManifest(
  manifestText: string,
  baseUrl: URL,
  fetchImpl: FetchLike,
  bust: string | null,
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
  const code = await fetchText(entryUrl.href, IMPORT_LIMITS.maxCodeChars, `entrypoint (${m.entrypoint})`, fetchImpl, bust);
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
    const text = await fetchText(configUrl.href, IMPORT_LIMITS.maxMixinsChars, `mixins (${config})`, fetchImpl, bust);
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
    const text = await fetchText(
      physicsUrl.href,
      IMPORT_LIMITS.maxPhysicsChars,
      `physics (${m.physics})`,
      fetchImpl,
      bust,
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

function importFromCode(codeText: string, url: URL): ImportResult {
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

/**
 * Import a mod from `rawUrl`. Dispatch: a `.json` path is a manifest, a
 * `.js`/`.mjs` path is a bare entrypoint; anything else is fetched and
 * sniffed (JSON object with an `entrypoint` → manifest, otherwise code) so
 * extension-less raw links still work.
 */
export async function importModFromUrl(
  rawUrl: string,
  fetchImpl: FetchLike = fetch,
  options: ImportOptions = {},
): Promise<ImportResult> {
  const checked = checkImportUrl(rawUrl);
  if (!checked.ok) return checked;
  const { url } = checked;
  // One bust value per import, so the manifest and the files it points at all
  // come from the same freshness horizon.
  const bust = options.fresh ? Date.now().toString(36) : null;

  if (/\.json$/i.test(url.pathname)) {
    const manifest = await fetchText(url.href, IMPORT_LIMITS.maxManifestChars, 'manifest', fetchImpl, bust);
    if (!manifest.ok) return manifest;
    return importFromManifest(manifest.text, url, fetchImpl, bust);
  }
  if (/\.m?js$/i.test(url.pathname)) {
    const code = await fetchText(url.href, IMPORT_LIMITS.maxCodeChars, 'mod file', fetchImpl, bust);
    if (!code.ok) return code;
    return importFromCode(code.text, url);
  }

  const body = await fetchText(url.href, IMPORT_LIMITS.maxCodeChars, 'mod file', fetchImpl, bust);
  if (!body.ok) return body;
  if (body.contentType.includes('json')) {
    if (body.text.length > IMPORT_LIMITS.maxManifestChars) {
      return fail(`manifest: file is ${body.text.length.toLocaleString()} characters — the import limit is ${IMPORT_LIMITS.maxManifestChars.toLocaleString()}`);
    }
    return importFromManifest(body.text, url, fetchImpl, bust);
  }
  // Raw-file hosts often serve JSON as text/plain — sniff before assuming JS.
  try {
    const parsed: unknown = JSON.parse(body.text);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      typeof (parsed as { entrypoint?: unknown }).entrypoint === 'string'
    ) {
      if (body.text.length > IMPORT_LIMITS.maxManifestChars) {
        return fail(`manifest: file is ${body.text.length.toLocaleString()} characters — the import limit is ${IMPORT_LIMITS.maxManifestChars.toLocaleString()}`);
      }
      return importFromManifest(body.text, url, fetchImpl, bust);
    }
  } catch {
    // Not JSON — treat as code below.
  }
  return importFromCode(body.text, url);
}

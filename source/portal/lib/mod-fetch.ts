/**
 * The transport half of mod import (#80): URL policy, capped fetches, and the
 * cache-busting rules. Split out of `lib/mod-import.ts` so that file can be a
 * thin format dispatcher and a second format cannot skip these checks by
 * accident — every format receives its fetcher through `ImportContext` rather
 * than reaching for `fetch` itself.
 *
 * The fetch happens HERE, in the page, with the browser's own `fetch` — NEVER
 * through `/api/proxy`. That is a #80 invariant, not a convenience: the proxy
 * exists to reach the game, and the server must not become a fetcher (or
 * cache) of arbitrary user-pointed URLs. The service worker leaves non-kodub
 * URLs alone, so these requests go straight from the browser to the host.
 * CORS therefore applies: the host must allow cross-origin reads — raw
 * GitHub/gist links and CDNs (jsDelivr, unpkg) do; most web pages don't.
 */
import { USER_PATCH_LIMITS } from './user-patches';

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

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** A body the dispatcher already fetched while sniffing the format. */
export interface ProbedBody {
  readonly text: string;
  readonly contentType: string;
}

export function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

/** `url` with the cache-busting param applied (when `bust` is non-null). */
export function withBust(url: string, bust: string | null): string {
  if (bust === null) return url;
  const u = new URL(url);
  u.searchParams.set('tspml_fresh', bust);
  return u.href;
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

export async function fetchText(
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

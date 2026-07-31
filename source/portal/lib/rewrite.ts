/**
 * @tspml/portal — pure URL rewriter for the service-worker + proxy path.
 *
 * Maps a PolyTrack / Kodub game URL to the portal's
 * `/api/proxy/<path>?version=<v>` form (plus an optional `host` param when the
 * URL is not on the default game-asset host), or returns `null` if the input is
 * not a Kodub game URL we should intercept.
 *
 * This is the CANONICAL implementation. The static service worker at
 * `public/sw.js` carries an inline copy of the same logic — files under
 * `/public` are served verbatim and cannot import this module. Keep the two in
 * sync when changing the rewrite rules (the unit tests here cover both).
 *
 * See docs/design/injection-and-delivery.md for the architecture.
 */

export interface RewriteOptions {
  /**
   * Origin to prefix the proxy URL with. Use `""` for a same-origin (relative)
   * URL such as `/api/proxy/...` (what the in-page service worker wants), or an
   * absolute origin like `https://tspml.vercel.app` for a cross-origin call.
   */
  proxyBase: string;
  /** Game version to pin in the proxied URL when the URL itself carries none. */
  version: string;
}

/** The host that serves PolyTrack's versioned game assets. */
export const DEFAULT_GAME_HOST = 'app-polytrack.kodub.com';

/** True for `kodub.com` itself or any `*.kodub.com` subdomain. */
export function isGameHost(hostname: string): boolean {
  return hostname === 'kodub.com' || hostname.endsWith('.kodub.com');
}

/** Matches a leading semver-ish version segment, e.g. `0.6.2`. */
const VERSION_RE = /^\d+\.\d+\.\d+/;

/**
 * Rewrite a Kodub game URL to a `/api/proxy/...` URL, or `null` if `inputUrl`
 * is not an http(s) Kodub URL we should intercept.
 *
 * - If the first path segment is a version (e.g. `/0.6.2/main.bundle.js`), it is
 *   stripped and carried as `?version=`; otherwise the option's `version` is
 *   used.
 * - Any query string already on the URL is preserved and forwarded to upstream.
 * - A `host=` param is added only when the URL is NOT on the default game-asset
 *   host, so the proxy can route kodub.com API traffic correctly.
 */
export function rewriteGameUrl(inputUrl: string, options: RewriteOptions): string | null {
  const { proxyBase, version } = options;

  let url: URL;
  try {
    url = new URL(inputUrl);
  } catch {
    return null;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!isGameHost(url.hostname)) return null;

  // If the first path segment is a version, strip it and use it; else default.
  const segments = url.pathname.split('/').filter(Boolean);
  let resolvedVersion = version;
  let rest = url.pathname;
  const first = segments[0];
  if (first !== undefined && VERSION_RE.test(first)) {
    resolvedVersion = first;
    rest = '/' + segments.slice(1).join('/');
  }
  if (rest.length === 0) rest = '/';

  const proxyPath = '/api/proxy' + rest;

  const params = new URLSearchParams(url.search);
  params.set('version', resolvedVersion);
  if (url.hostname !== DEFAULT_GAME_HOST) {
    params.set('host', url.hostname);
  }
  const query = params.toString();

  const base = proxyBase.replace(/\/+$/, '');
  return base + proxyPath + (query ? '?' + query : '');
}

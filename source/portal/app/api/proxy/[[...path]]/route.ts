import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { DEFAULT_GAME_HOST, isGameHost } from '@/lib/rewrite';

/**
 * /api/proxy/<path> — server-side fetch of the real PolyTrack game.
 *
 * Reconstructs `https://<host>/<version>/<path>` (or `https://<host>/<path>`
 * for non-default hosts), fetches it server-side with `Origin`/`Referer` set to
 * the OFFICIAL DESKTOP origin so leaderboard / multiplayer endpoints trust the
 * request (the same trick PML's Electron build uses, done server-side), and
 * returns the body with permissive CORS for the portal origin.
 *
 * ── ToS gray area (see docs/design/safety-and-fairness.md) ──────────────────
 * Origin-forwarding + running a modified client copy can violate Kodub's
 * "no derivative works / no client modification" terms EVEN WITH ZERO
 * redistribution — the portal fetches the user's LIVE game copy, it never
 * bundles one. This route exists to prove the delivery architecture works; it
 * is not a license to cheat. TSPML is warn-only on fairness and will comply
 * with any takedown request.
 * ───────────────────────────────────────────────────────────────────────────
 *
 * The route is intentionally narrow:
 *   - only `kodub.com` / `*.kodub.com` hosts may be proxied (SSRF guard);
 *   - only a safelist of hop-by-hop-safe request headers is forwarded;
 *   - the upstream `Content-Security-Policy` / `X-Frame-Options` are dropped so
 *     the portal can iframe the proxied document (the game's `frame-ancestors`
 *     CSP otherwise blocks us);
 *   - `Content-Encoding` / `Content-Length` are dropped because `fetch()`
 *     already decompressed the body — forwarding them would corrupt it.
 */

/** The origin PML's desktop app impersonates; we set the same one server-side. */
const DESKTOP_ORIGIN = 'https://app-polytrack-desktop.kodub.com';

/** Fallback game version when neither the query nor the env names one. */
const DEFAULT_VERSION = '0.6.2';

/** Request headers safe to forward to Kodub (no cookies / auth / arbitrary). */
const FORWARD_HEADERS = [
  'user-agent',
  'accept',
  'accept-language',
  'range',
] as const;

/** Portal origins allowed to READ proxied responses (CORS). */
function allowedOrigins(): string[] {
  const raw = process.env.PORTAL_ORIGIN ?? '';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** localhost (any port) in dev, or an explicit PORTAL_ORIGIN entry in prod. */
function isAllowedOrigin(origin: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(origin).hostname;
  } catch {
    return false;
  }
  if (hostname === 'localhost' || hostname === '127.0.0.1') return true;
  return allowedOrigins().includes(origin);
}

/** Best-effort cache policy by content type (immutable assets vs HTML). */
function cacheControlFor(contentType: string | null): string {
  const ct = contentType ?? '';
  if (ct.includes('text/html')) return 'no-cache';
  if (
    /\b(javascript|ecmascript|wasm|font|image|audio|video|model)\b/.test(ct) ||
    ct.includes('octet-stream')
  ) {
    return 'public, max-age=86400, s-maxage=604800';
  }
  return 'public, max-age=3600';
}

function buildUpstream(
  host: string,
  version: string,
  segments: string[],
  search: URLSearchParams,
): string {
  const path =
    host === DEFAULT_GAME_HOST
      ? `/${version}/${segments.join('/')}`
      : `/${segments.join('/')}`;
  // Drop our own control params; forward everything else verbatim.
  const forwarded = new URLSearchParams(search);
  forwarded.delete('version');
  forwarded.delete('host');
  const qs = forwarded.toString();
  return `https://${host}${path}${qs ? `?${qs}` : ''}`;
}

function corsHeaders(request: NextRequest, headers: Headers): void {
  const origin = request.headers.get('origin');
  if (origin && isAllowedOrigin(origin)) {
    headers.set('access-control-allow-origin', origin);
    headers.set('access-control-allow-credentials', 'true');
    headers.append('vary', 'origin');
  }
}

async function proxyGet(
  request: NextRequest,
  segments: string[],
): Promise<NextResponse> {
  const search = request.nextUrl.searchParams;
  const version = search.get('version') ?? process.env.POLYTRACK_VERSION ?? DEFAULT_VERSION;
  const host = search.get('host') ?? DEFAULT_GAME_HOST;

  // SSRF guard: refuse to proxy anything that is not a Kodub host.
  if (!isGameHost(host)) {
    const headers = new Headers();
    corsHeaders(request, headers);
    return NextResponse.json({ error: 'host not allowed' }, { status: 400, headers });
  }

  const upstream = buildUpstream(host, version, segments, search);

  const reqHeaders = new Headers();
  for (const name of FORWARD_HEADERS) {
    const value = request.headers.get(name);
    if (value) reqHeaders.set(name, value);
  }
  // The trust-model piece: impersonate the official desktop client origin.
  reqHeaders.set('origin', DESKTOP_ORIGIN);
  reqHeaders.set('referer', DESKTOP_ORIGIN + '/');

  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(upstream, { headers: reqHeaders, redirect: 'follow' });
  } catch {
    const headers = new Headers();
    corsHeaders(request, headers);
    return NextResponse.json(
      { error: 'upstream fetch failed', upstream },
      { status: 502, headers },
    );
  }

  // Build a clean response header set. Forward content-type only (see file
  // header comment for why encoding/length/csp must be dropped).
  const resHeaders = new Headers();
  const contentType = upstreamRes.headers.get('content-type');
  if (contentType) resHeaders.set('content-type', contentType);
  resHeaders.set('cache-control', cacheControlFor(contentType));
  corsHeaders(request, resHeaders);

  return new NextResponse(upstreamRes.body, {
    status: upstreamRes.status,
    headers: resHeaders,
  });
}

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ path?: string[] }> },
): Promise<Response> {
  const { path } = await ctx.params;
  const segments = (path ?? []).filter(Boolean);
  return proxyGet(request, segments);
}

export async function OPTIONS(request: NextRequest): Promise<Response> {
  const headers = new Headers();
  headers.set('access-control-allow-methods', 'GET, OPTIONS');
  headers.set('access-control-allow-headers', 'content-type');
  headers.set('access-control-max-age', '86400');
  corsHeaders(request, headers);
  return new NextResponse(null, { status: 204, headers });
}

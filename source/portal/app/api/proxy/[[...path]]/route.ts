import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { EARLY_CAPTURE_SCRIPT_TAG } from '@tspml/shared';

import { DEFAULT_GAME_HOST, isGameHost } from '@/lib/rewrite';
import { applyDemoTransform, surfaceForPath } from '@/lib/demo-transform';
import { serveWasm, wasmSurfaceForPath } from '@/lib/wasm-serve';
import type { TransformSurface, WasmSurface } from '@/lib/transform-surface';
import { getBaseTransformedBundle } from '@/lib/bundle-cache';
import { setDetailHeader } from '@/lib/detail-header';
import { parseUserPatchPlan, reportPrelude, USER_PATCH_LIMITS } from '@/lib/user-patches';
import type { UserMixinReport, UserPatchSet } from '@/lib/user-patches';

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

/**
 * The transform surface for this request, or null to proxy verbatim (#98).
 *
 * "Transformable" was one hardcoded filename until #98; it is now main.bundle.js PLUS
 * the chunk ids the map declares, because the game lazy-loads real feature code as
 * `<id>.bundle.js` and nothing inside one could otherwise be patched. The allowlist
 * and the per-chunk pin are map DATA — see lib/transform-surface.ts.
 *
 * Still env-gated: with TSPML_TRANSFORM unset, nothing is a surface and every path
 * takes the verbatim proxy route exactly as before.
 */
function transformSurface(host: string, segments: string[]): TransformSurface | null {
  if (!process.env.TSPML_TRANSFORM) return null;
  return surfaceForPath(host === DEFAULT_GAME_HOST, segments);
}

/**
 * The WASM surface for this request, or null to proxy verbatim (#43).
 *
 * Separate from {@link transformSurface} because the two share no code path: this one
 * ends in raw bytes and a fail-closed structural patch, that one in babel. Same env
 * gate, so with TSPML_TRANSFORM unset the physics binary streams through exactly as
 * before.
 */
function wasmSurface(host: string, segments: string[]): WasmSurface | null {
  if (!process.env.TSPML_TRANSFORM) return null;
  return wasmSurfaceForPath(host === DEFAULT_GAME_HOST, segments);
}

/** The POST path's parsed plan (#62): `sets` to compose into the transform
 *  (empty when the plan was refused up front), plus the refusal status to
 *  report inside the bundle prelude when it was. */
interface UserPlanInput {
  readonly sets: readonly UserPatchSet[];
  readonly degradedStatus: 'plan-invalid' | 'plan-too-large' | null;
  /**
   * The physics patch plan for a wasm request (#43), still UNTRUSTED and unvalidated —
   * `@tspml/wasm`'s `checkPlan` is the one place its shape is decided, so nothing here
   * or in the route inspects its fields. Null on every JS-surface request.
   */
  readonly wasmPlan?: unknown;
  /** Why the wasm body never became a plan (oversized, unparseable), or null. Kept
   *  apart from `degradedStatus`, which reports inside a JS bundle's prelude — a wasm
   *  response has no prelude to carry anything, only headers. */
  readonly wasmPlanError?: string | null;
}

/**
 * Serve one proxied request. The UPSTREAM fetch is always a GET — the portal-
 * side POST (#62) only carries the user patch plan in `user`; nothing from the
 * request body is ever forwarded to Kodub.
 */
async function proxyGet(
  request: NextRequest,
  segments: string[],
  user: UserPlanInput | null = null,
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

  const surface = transformSurface(host, segments);
  const wasmSurf = wasmSurface(host, segments);

  // ── Demo transform mode, plain-GET path: memoized ──────────────────────────
  // The base transform is deterministic per upstream bundle (no user data), so
  // a warm instance serves it from the in-process memo instead of re-fetching
  // 1.8 MB from Kodub and re-running the babel pass (~7s → ~0.1s). The POST
  // path below stays per-request: it embeds this user's report (#62).
  if (surface !== null && user === null) {
    const r = await getBaseTransformedBundle(upstream, reqHeaders, surface);
    const h = new Headers();
    corsHeaders(request, h);
    if (!r.ok) {
      if (r.failure.status === null) {
        return NextResponse.json(
          { error: 'upstream fetch failed', upstream },
          { status: 502, headers: h },
        );
      }
      return NextResponse.json(
        { error: 'upstream error', upstream },
        { status: r.failure.status, headers: h },
      );
    }
    const { bundle } = r;
    h.set('content-type', 'text/javascript; charset=utf-8');
    h.set('cache-control', 'no-cache');
    h.set('x-tspml-transformed', bundle.transformed ? '1' : '0');
    h.set('x-tspml-vanilla-hash', bundle.vanillaHash);
    h.set('x-tspml-bundle-cache', r.cacheHit ? 'hit' : 'miss');
    // Which surface answered (#98). Without it a chunk served vanilla by a stale pin
    // is indistinguishable from one that was never a surface at all — and both look
    // like an ordinary proxied file from outside.
    h.set('x-tspml-surface', surface.kind === 'main' ? 'main' : `chunk:${surface.chunkId}`);
    if (bundle.detail) setDetailHeader(h, bundle.detail);
    return new NextResponse(bundle.body, { status: bundle.status, headers: h });
  }

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

  // ── Demo transform mode, POST path (#62) ───────────────────────────────────
  // `user` carries the parsed patch plan: its sets compose into the same pass
  // as the base patches, and the per-mod report is prepended to the served
  // bundle as the `window.__tspmlUserMixins` prelude. Never memoized — the
  // response is per-request (it embeds this user's report; see lib/bundle-cache
  // for the boundary).
  if (surface !== null && user !== null) {
    const src = await upstreamRes.text();
    const { code, transformed, detail, vanillaHash, userReport } = await applyDemoTransform(
      src,
      user.sets,
      surface,
    );
    // A refused plan (bad shape / oversized body) still gets an honest prelude:
    // plan-level status, no per-mod rows (the mods were never parsed out).
    const base: UserMixinReport | null =
      user.degradedStatus !== null
        ? { v: 1, planStatus: user.degradedStatus, mods: [] }
        : userReport;
    // Which file the rows describe (#98) — this also selects the prelude SHAPE: a
    // chunk merges itself into the main report instead of replacing it.
    const report: UserMixinReport | null =
      base === null ? null : { ...base, surface: surface.file };
    const body = report ? `${reportPrelude(report)}${code}` : code;
    const h = new Headers();
    h.set('content-type', 'text/javascript; charset=utf-8');
    h.set('x-tspml-surface', surface.kind === 'main' ? 'main' : `chunk:${surface.chunkId}`);
    // A POST-carried plan makes the response per-request (it embeds this
    // user's report) — no-store, never shared. (The plain GET is served by the
    // memoized branch above.)
    h.set('cache-control', 'no-store');
    corsHeaders(request, h);
    h.set('x-tspml-transformed', transformed ? '1' : '0');
    h.set('x-tspml-vanilla-hash', vanillaHash);
    if (detail) setDetailHeader(h, detail);
    return new NextResponse(body, { status: upstreamRes.status, headers: h });
  }

  // ── Physics WASM (#43) ─────────────────────────────────────────────────────
  // Buffer the binary, hash-gate it against its OWN pin, and apply the request's
  // physics plan (if any) via @tspml/wasm's structural locator. Deliberately not part
  // of the transform branches above: those read `.text()` and run babel, which would
  // turn a 396 KB binary into a plausible-looking corrupt string.
  //
  // Only 200s take this path. A 206 (range) or 304 carries partial or no bytes, so
  // hashing them would compare a fragment against a whole-file pin and always refuse —
  // passing them through keeps range requests working instead.
  if (wasmSurf !== null && upstreamRes.ok && upstreamRes.status === 200) {
    const upstreamBytes = new Uint8Array(await upstreamRes.arrayBuffer());
    const r = serveWasm(
      upstreamBytes,
      wasmSurf,
      user?.wasmPlan ?? null,
      user?.wasmPlanError ?? null,
    );
    const h = new Headers();
    h.set('content-type', 'application/wasm');
    h.set('x-tspml-surface', `wasm:${wasmSurf.file}`);
    h.set('x-tspml-wasm-status', r.status);
    h.set('x-tspml-vanilla-hash', r.vanillaHash);
    if (r.applied > 0) {
      h.set('x-tspml-wasm-applied', String(r.applied));
      // Warn-only, always: physics tuning is ranked-play-relevant by definition. The
      // player is told; nothing is blocked (docs/design/safety-and-fairness.md).
      if (r.leaderboardRisk) h.set('x-tspml-leaderboard-risk', r.leaderboardRisk);
    }
    // Patched bytes are per-request; vanilla bytes are the same for everyone but must
    // not be cached under a URL a later patched response shares. no-store for both.
    h.set('cache-control', 'no-store');
    setDetailHeader(h, r.detail);
    corsHeaders(request, h);
    return new NextResponse(r.bytes as unknown as BodyInit, { status: 200, headers: h });
  }

  // Rewrite the proxied game's HTML. Every injection runs BEFORE the game's deferred
  // bundles (an inline script in <head> executes during parse, ahead of `defer` scripts
  // like main.bundle.js):
  //   1. <base href="/api/proxy/"> — the document URL /api/proxy (no trailing
  //      slash) makes the browser treat "proxy" as a filename, so the game's
  //      relative <script src="main.bundle.js"> resolves to /api/main.bundle.js
  //      (404). <base> fixes every relative ref at once. (Caught by the smoke.)
  //   2. In TSPML mode: set window.polytrackModConfiguration — PolyTrack's
  //      first-class mod-loader signal (exactly how PML identifies itself).
  //      Supplying {modName, author} makes the game treat the session as a known
  //      mod load, which CLEARS its "unofficial version" gameplay gate via the
  //      game's OWN intended path — no bundle surgery (issue #8). See
  //      docs/research/portal-browser-test-findings.md.
  //   3. In TSPML mode: the pre-bridge early-capture stub (#36). Only meaningful
  //      alongside the transform, since it exists to catch the capture patches — the
  //      track codec's fires during BUNDLE INIT, before page.tsx's frame-`load`
  //      handler installs the real window.__tspml, so without the stub that capture is
  //      silently dropped and api.tracks never attaches.
  {
    const ct = upstreamRes.headers.get('content-type') ?? '';
    if (ct.includes('text/html')) {
      const html = await upstreamRes.text();
      const injections = ['<base href="/api/proxy/">'];
      let unblocked = false;
      if (process.env.TSPML_TRANSFORM) {
        unblocked = true;
        injections.push(
          '<script>window.polytrackModConfiguration = Object.assign(window.polytrackModConfiguration || {}, { modName: "TSPML", author: "roowus" });</script>',
          EARLY_CAPTURE_SCRIPT_TAG,
        );
      }
      const inject = injections.join('\n');
      const patched = /<head[^>]*>/i.test(html)
        ? html.replace(/<head[^>]*>/i, (m) => `${m}\n${inject}`)
        : `${inject}\n${html}`;
      const h = new Headers();
      h.set('content-type', 'text/html; charset=utf-8');
      h.set('cache-control', 'no-cache');
      h.set('x-tspml-unblocked', unblocked ? '1' : '0');
      corsHeaders(request, h);
      return new NextResponse(patched, { status: upstreamRes.status, headers: h });
    }
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

/**
 * POST /api/proxy/main.bundle.js (or an allowlisted `<id>.bundle.js`, #98): the SW
 * replays the game's bundle GET as a POST whose body is the user patch plan (see
 * lib/user-patches.ts). The plan is parsed FAIL-SOFT — this response is the
 * `<script>` the game executes, so a bad plan must degrade to the base transform
 * (with an honest prelude report), never 4xx and break the boot. Only a
 * transform-surface path accepts POST at all; anything else is 405 (the SW never
 * POSTs elsewhere).
 *
 * #43 adds the wasm surface to that set, carried the same way for the same reason: a
 * patch plan must never ride in a query param (`buildUpstream` forwards unknown params
 * to Kodub, and a URL-carried payload is a reflected-XSS vector). A wasm POST is parsed
 * as raw JSON rather than through `parseUserPatchPlan` — the two plan shapes are
 * unrelated, and `@tspml/wasm`'s `checkPlan` is the only validator for the physics one.
 * It degrades the same way: a bad plan serves vanilla physics, never a 4xx.
 */
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ path?: string[] }> },
): Promise<Response> {
  const { path } = await ctx.params;
  const segments = (path ?? []).filter(Boolean);
  const host = request.nextUrl.searchParams.get('host') ?? DEFAULT_GAME_HOST;
  const isWasm = wasmSurface(host, segments) !== null;
  if (transformSurface(host, segments) === null && !isWasm) {
    const headers = new Headers();
    headers.set('allow', 'GET, OPTIONS');
    corsHeaders(request, headers);
    return NextResponse.json({ error: 'method not allowed' }, { status: 405, headers });
  }

  let user: UserPlanInput;
  let bodyText = '';
  try {
    bodyText = await request.text();
  } catch {
    user = { sets: [], degradedStatus: 'plan-invalid' };
    return proxyGet(request, segments, user);
  }

  // The wasm path shares the size limit but not the parser: a physics plan is
  // `{wasmHash, patches:[{signature, oldValue, newValue}]}`, which parseUserPatchPlan
  // would reject outright. Oversized or unparseable serve vanilla bytes like any other
  // refusal, but they travel as an ERROR rather than as a null plan: "we could not read
  // your plan" and "you did not send one" produce the same bytes and must not produce
  // the same report.
  if (isWasm) {
    const base = { sets: [] as const, degradedStatus: null };
    if (new TextEncoder().encode(bodyText).length > USER_PATCH_LIMITS.maxBodyBytes) {
      return proxyGet(request, segments, {
        ...base,
        wasmPlanError: `plan body exceeds ${USER_PATCH_LIMITS.maxBodyBytes} bytes`,
      });
    }
    try {
      return proxyGet(request, segments, { ...base, wasmPlan: JSON.parse(bodyText) });
    } catch {
      return proxyGet(request, segments, { ...base, wasmPlanError: 'plan body is not JSON' });
    }
  }

  if (new TextEncoder().encode(bodyText).length > USER_PATCH_LIMITS.maxBodyBytes) {
    user = { sets: [], degradedStatus: 'plan-too-large' };
  } else {
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(bodyText);
    } catch {
      parsed = null;
    }
    const plan = parseUserPatchPlan(parsed);
    user =
      plan === null
        ? { sets: [], degradedStatus: 'plan-invalid' }
        : { sets: plan.sets, degradedStatus: null };
  }
  return proxyGet(request, segments, user);
}

export async function OPTIONS(request: NextRequest): Promise<Response> {
  const headers = new Headers();
  headers.set('access-control-allow-methods', 'GET, POST, OPTIONS');
  headers.set('access-control-allow-headers', 'content-type');
  headers.set('access-control-max-age', '86400');
  corsHeaders(request, headers);
  return new NextResponse(null, { status: 204, headers });
}

/**
 * @tspml/dev-harness — Vite dev-server middleware that serves the REAL PolyTrack,
 * gate-cleared + transformed, so the harness page can iframe it same-origin.
 *
 * This is the harness equivalent of the portal's /api/proxy route + service worker
 * (see source/portal/app/api/proxy/.../route.ts) — but SIMPLER: Vite intercepts
 * /game/* directly in-process, so no service worker is needed. It:
 *   - proxies /game/<path>?version=<v> -> https://app-polytrack.kodub.com/<v>/<path>,
 *     forwarding Origin/Referer as the official desktop origin (the trust-model piece
 *     the portal uses too);
 *   - rewrites the game HTML: injects <base href="/game/?version=<v>"> (so the game's
 *     relative asset fetches re-enter the proxy) + window.polytrackModConfiguration
 *     (PolyTrack's own mod-loader hook — clears the "unofficial version" gate, ADR-013);
 *   - AST-rewrites main.bundle.js with the bridge patches (badge + Tier-1 events) +
 *     the dev mod's declared mixins, hash-gated to the pinned bundle.
 *
 * Legal posture: fetches the user's LIVE game copy server-side; never bundles it.
 */
import type { Connect, ViteDevServer } from "vite";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { resolveTarget, validateMap } from "@tspml/mappings";
import type { GameMap } from "@tspml/mappings";
import type { Patch } from "@tspml/transform";
import { BRIDGE_PATCHES } from "./bridge-patches";

// require() for JSON (Node's ESM loader wants `with {type:"json"}` for static JSON
// imports, which the Vite config loader doesn't reliably pass through). createRequire
// sidesteps it entirely.
const require = createRequire(import.meta.url);
// The pinned map (not loadDefaultMap — import.meta.url breaks under bundlers).
const mapJson = require("@tspml/mappings/maps/polytrack-0.6.2.json") as Record<string, unknown>;
// The dev mod's declared Tier-2 mixins (default: @tspml/demo-hud). Applied at
// bundle-serve; changing them requires a bundle re-fetch (full reload), NOT HMR.
const devModMixins = require("@tspml/demo-hud/mixins.json") as { patches?: unknown[] };

const MAP: GameMap = validateMap(mapJson);
const DESKTOP_ORIGIN = "https://app-polytrack-desktop.kodub.com";
const GAME_HOST = "app-polytrack.kodub.com";
const DEFAULT_VERSION = "0.6.2";

/** Resolve a declared patch to a concrete Patch (inline-anchor passthrough; `{symbol}`
 *  resolved fail-closed via the map). Mirrors portal/lib/demo-transform.ts. */
function resolveDeclaredPatch(
  p: Record<string, unknown>,
  map: GameMap,
  liveHash: string,
): Patch | null {
  if (typeof p.symbol === "string") {
    const res = resolveTarget(map, p.symbol, { bundleHash: liveHash });
    if (!res.ok) return null; // fail-closed
    const rest = { ...p };
    delete rest.symbol;
    return { ...rest, target: res.target } as unknown as Patch;
  }
  return p as unknown as Patch;
}

const MOD_MIXINS: readonly Record<string, unknown>[] =
  (devModMixins.patches ?? []) as readonly Record<string, unknown>[];

/** All patches: bridge (badge + Tier-1 events) + the dev mod's declared mixins. */
const ALL_PATCHES: readonly Record<string, unknown>[] = [
  ...(BRIDGE_PATCHES as unknown as readonly Record<string, unknown>[]),
  ...MOD_MIXINS,
];

/** Apply the transform. Returns the (possibly transformed) source + a flag. */
async function applyTransform(
  bundleSource: string,
): Promise<{ code: string; transformed: boolean; detail: string }> {
  try {
    const { transform } = await import("@tspml/transform");
    const liveHash = `sha256:${createHash("sha256").update(bundleSource).digest("hex")}`;
    const patches = ALL_PATCHES.map((p) => resolveDeclaredPatch(p, MAP, liveHash)).filter(
      (p): p is Patch => p !== null,
    );
    const r = transform(bundleSource, patches, {
      bundleHash: liveHash,
      expectedBundleHash: MAP.bundleHash,
      compact: true,
      filename: "main.bundle.js",
    });
    if (r.failedReason === "hash-mismatch") {
      return {
        code: bundleSource,
        transformed: false,
        detail: `hash-mismatch: live ${liveHash} ≠ expected ${MAP.bundleHash} — serving vanilla`,
      };
    }
    const detail = r.applied.map((a) => a?.detail).concat(r.failed.map((f) => f.detail)).join(" | ");
    if (r.outputValid && r.applied.length === patches.length) {
      return { code: r.code, transformed: true, detail };
    }
    return {
      code: bundleSource,
      transformed: false,
      detail: `transform did not apply cleanly (${r.applied.length}/${patches.length}): ${detail}`,
    };
  } catch (err) {
    return { code: bundleSource, transformed: false, detail: `transform threw: ${(err as Error).message}` };
  }
}

function buildUpstream(version: string, segments: string[], search: URLSearchParams): string {
  const forwarded = new URLSearchParams(search);
  forwarded.delete("version");
  forwarded.delete("host");
  const qs = forwarded.toString();
  return `https://${GAME_HOST}/${version}/${segments.join("/")}${qs ? `?${qs}` : ""}`;
}

/** Inject the <base> + gate script into the proxied HTML, before the deferred bundles. */
function rewriteHtml(html: string, version: string): string {
  const inject = [
    `<base href="/game/?version=${version}">`,
    '<script>window.polytrackModConfiguration = Object.assign(window.polytrackModConfiguration || {}, { modName: "TSPML-dev", author: "roowus" });</script>',
  ].join("\n");
  return /<head[^>]*>/i.test(html)
    ? html.replace(/<head[^>]*>/i, (m) => `${m}\n${inject}`)
    : `${inject}\n${html}`;
}

/** The Vite dev-server middleware. Returns a Connect handler bound to /game. */
export function gameProxyMiddleware(_server: ViteDevServer): Connect.NextHandleFunction {
  return async (req, res, next) => {
    const url = req.url ?? "";
    if (!url.startsWith("/game")) return next();

    const parsed = new URL(url, "http://localhost");
    const segments = parsed.pathname.replace(/^\/game\/?/, "").split("/").filter(Boolean);
    const version = parsed.searchParams.get("version") ?? DEFAULT_VERSION;

    const upstream = buildUpstream(version, segments, parsed.searchParams);
    let upstreamRes: Response;
    try {
      upstreamRes = await fetch(upstream, {
        headers: {
          origin: DESKTOP_ORIGIN,
          referer: `${DESKTOP_ORIGIN}/`,
          // a browser-ish UA avoids generic bot filters on the asset CDN.
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        },
        redirect: "follow",
      });
    } catch {
      res.statusCode = 502;
      res.end(`upstream fetch failed: ${upstream}`);
      return;
    }

    // Transform the main bundle (hash-gated).
    if (segments.join("/") === "main.bundle.js") {
      const src = await upstreamRes.text();
      const { code, transformed, detail } = await applyTransform(src);
      res.setHeader("content-type", "text/javascript; charset=utf-8");
      res.setHeader("cache-control", "no-cache");
      res.setHeader("x-tspml-transformed", transformed ? "1" : "0");
      if (detail) res.setHeader("x-tspml-detail", detail.slice(0, 200));
      res.end(code);
      return;
    }

    // Rewrite the game HTML (gate + <base>) so relative asset fetches re-enter /game.
    const ct = upstreamRes.headers.get("content-type") ?? "";
    if (ct.includes("text/html")) {
      const html = await upstreamRes.text();
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.setHeader("cache-control", "no-cache");
      res.setHeader("x-tspml-unblocked", "1");
      res.end(rewriteHtml(html, version));
      return;
    }

    // Passthrough (JS chunks, wasm, fonts, images) — forward content-type only.
    if (ct) res.setHeader("content-type", ct);
    res.setHeader("cache-control", "no-cache");
    const buf = Buffer.from(await upstreamRes.arrayBuffer());
    res.end(buf);
  };
}

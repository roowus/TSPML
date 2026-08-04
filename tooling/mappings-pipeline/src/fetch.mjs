// fetch.mjs — download a PolyTrack build's bundles into the pipeline cache.
//
// The first step of the regen pipeline: on a new PolyTrack release, fetch the live
// `main.bundle.js` (+ the physics `simulation_worker.bundle.js`) so unpack/gen-map
// can regenerate a candidate map against it.
//
// Origin: the static-asset CDN `app-polytrack.kodub.com/<version>/` — the SAME origin
// the portal's `/api/proxy` reaches (verified byte-exact against the cached 0.6.2
// bundle: 1,782,239 B, `text/javascript`, 200 with a bare GET, no special headers).
// NOTE: the M8 bot-protection is on `vps.kodub.com` (the multiplayer/leaderboard
// backend), NOT this CDN — static game assets fetch cleanly.
//
// Legal posture: this tool DOWNLOADS the user's own live game copy to a gitignored
// local cache for offline analysis — it never commits the bundle. Same posture as
// the M1 spike (the cache is .gitignored).
//
// Usage: node src/fetch.mjs <version> [--out dir] [--only main|simworker] [--expect-hash sha256:...]
//          (default --out is the package .cache dir)

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_DIR = fileURLToPath(new URL(".", import.meta.url));
const CACHE = join(PKG_DIR, "../.cache");
export const GAME_ORIGIN = "https://app-polytrack.kodub.com";

/** The bundles a regen needs. `file` is the CDN path; `cacheName(version)` the local name. */
export const BUNDLES = [
  { kind: "main", file: "main.bundle.js", cacheName: (v) => `pt-${v}-raw-main.js` },
  { kind: "simworker", file: "simulation_worker.bundle.js", cacheName: (v) => `pt-${v}-raw-simworker.js` },
];

// Strict x.y.z — the version is embedded verbatim into a cache filename, so anything
// looser (e.g. "0.6.2/../../evil") would escape the gitignored .cache/ dir and could
// write the proprietary bundle into a committed path. Fail closed on anything else.
const VERSION_RE = /^\d+\.\d+\.\d+$/;
export function assertVersion(version) {
  if (!VERSION_RE.test(version)) {
    throw new Error(`invalid version ${JSON.stringify(version)} (expected x.y.z); refusing to build a cache path from it`);
  }
  return version;
}

/**
 * Split-out chunks: `i.e(<id>)` call sites in the webpack runtime (#3).
 *
 * Webpack's chunk loader builds each URL as `i.u = e => e + ".bundle.js"` against the
 * document base, so every dynamically-imported chunk is `<version>/<id>.bundle.js` on
 * the same CDN. Reading the ids out of the runtime is exact: it is the same list the
 * game itself will request.
 *
 * DELIBERATELY NOT a probe loop. Guessing ids and keeping the 200s is wrong twice
 * over: the CDN 404s with a 355-byte HTML page (so a naive "did it download" check
 * banks an error page as a chunk), and stale chunks from earlier builds are still
 * served — `0.6.2/57.bundle.js` returns 200 with real code that 0.6.2 never loads.
 * Anything the runtime does not reference is not part of this build, whatever the CDN
 * says.
 *
 * @param {string} mainBundleSource contents of the build's `main.bundle.js`
 * @returns {string[]} chunk ids, ascending, deduped
 */
export function parseChunkIds(mainBundleSource) {
  const ids = new Set();
  for (const m of mainBundleSource.matchAll(/\.e\(\s*(\d{1,6})\s*\)/g)) ids.add(m[1]);
  return [...ids].sort((a, b) => Number(a) - Number(b));
}

/** A fetchable descriptor for one chunk id. Same shape as a BUNDLES entry. */
export function chunkBundle(id) {
  if (!/^\d{1,6}$/.test(String(id))) {
    throw new Error(`invalid chunk id ${JSON.stringify(id)} (expected digits); refusing to build a URL from it`);
  }
  return {
    kind: `chunk-${id}`,
    file: `${id}.bundle.js`,
    cacheName: (v) => `pt-${v}-raw-chunk-${id}.js`,
  };
}

/**
 * Download one bundle for a version. Verifies a 200 + non-empty body; optionally
 * checks the sha256 against an expected hash (detects a silent version swap).
 * @param {string} version   e.g. "0.6.2"
 * @param {{kind:string,file:string,cacheName:(v:string)=>string}} bundle
 * @param {string} outDir
 * @param {string} [expectHash]  optional `sha256:<hex>`; mismatches throw
 * @returns {Promise<{kind:string,url:string,outFile:string,bytes:number,sha256:string}>}
 */
export async function fetchBundle(version, bundle, outDir, expectHash) {
  const url = `${GAME_ORIGIN}/${version}/${bundle.file}`;
  const outFile = join(outDir, bundle.cacheName(version));
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} -> HTTP ${res.status}`);
  // Reject an HTML interstitial / error page served with a 200 (anti-bot wall, captive
  // portal, maintenance page) — without this it would be saved + hashed as "the bundle".
  const ct = res.headers.get("content-type") ?? "";
  if (/html/i.test(ct)) throw new Error(`fetch ${url} -> HTML response (not the JS bundle; content-type: ${ct})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1024) throw new Error(`fetch ${url} -> suspiciously small body (${buf.length} B); expected a game bundle`);
  const sha256 = "sha256:" + createHash("sha256").update(buf).digest("hex");
  if (expectHash && sha256 !== expectHash) {
    throw new Error(`hash mismatch for ${url}: got ${sha256}, expected ${expectHash}`);
  }
  await mkdir(outDir, { recursive: true });
  await writeFile(outFile, buf);
  return { kind: bundle.kind, url, outFile, bytes: buf.length, sha256 };
}

/**
 * @param {string} version
 * @param {string} outDir
 * @param {{only?:string, expectHash?:string, chunks?:boolean}} [opts]
 */
export async function fetchVersion(version, outDir, opts = {}) {
  assertVersion(version);
  const want = BUNDLES.filter((b) => !opts.only || b.kind === opts.only);
  const results = [];
  for (const bundle of want) {
    results.push(await fetchBundle(version, bundle, outDir, opts.expectHash));
  }

  // Chunks are discovered from the main bundle we just wrote, not guessed (#3). Off
  // by default: the 0.6.2 chunks are UI-only, so paying four extra requests on every
  // regen buys nothing today — but a future release could move game logic into one,
  // which is exactly what `--chunks` is for checking.
  if (opts.chunks) {
    const mainResult = results.find((r) => r.kind === "main");
    if (!mainResult) {
      throw new Error("--chunks needs the main bundle (it holds the chunk list); drop --only, or use --only main");
    }
    const source = await readFile(mainResult.outFile, "utf8");
    const ids = parseChunkIds(source);
    // `--expect-hash` pins one specific bundle; passing it to every chunk as well
    // would fail all of them. Chunks are unpinned by design.
    for (const id of ids) results.push(await fetchBundle(version, chunkBundle(id), outDir));
  }
  return results;
}

// --- CLI ---
async function main() {
  const version = process.argv[2];
  if (!version) {
    console.error("usage: node src/fetch.mjs <version> [--out dir] [--only main|simworker] [--chunks] [--expect-hash sha256:...]");
    process.exit(2);
  }
  const args = process.argv.slice(3);
  const outIdx = args.indexOf("--out");
  const out = outIdx >= 0 ? args[outIdx + 1] : CACHE;
  const onlyIdx = args.indexOf("--only");
  const only = onlyIdx >= 0 ? args[onlyIdx + 1] : undefined;
  const hashIdx = args.indexOf("--expect-hash");
  const expectHash = hashIdx >= 0 ? args[hashIdx + 1] : undefined;
  const chunks = args.includes("--chunks");

  const results = await fetchVersion(version, out, { only, expectHash, chunks });
  for (const r of results) console.log(JSON.stringify(r));

  // Report skip when the file already exists with the same hash (cache hit).
  for (const r of results) {
    try {
      const st = await stat(r.outFile);
      console.error(`  wrote ${r.kind}: ${r.outFile} (${st.size} B, ${r.sha256})`);
    } catch { /* ignore */ }
  }
}

// `fetch` is global on Node >=18; guard for clarity.
if (typeof fetch !== "function") {
  console.error("fetch.mjs requires Node >= 18 (global fetch).");
  process.exit(1);
}

// Run the CLI only when executed directly — not when imported (e.g. by tests for
// assertVersion / BUNDLES).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

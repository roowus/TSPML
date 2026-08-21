#!/usr/bin/env node
// regen.mjs — one-command candidate-map regeneration + human review (M9).
//
// Ties the pipeline together. On a new PolyTrack release, a maintainer runs:
//
//   node scripts/regen.mjs 0.7.0            # full regen from the live CDN
//   node scripts/regen.mjs 0.7.0 --no-fetch # use an already-cached 0.7.0 bundle
//
// regen does, in order:
//   1. fetch      — download the new build's main bundle (unless --no-fetch)
//   2. unpack     — webcrack the new bundle into webcrack/v<ver>-raw/
//   3. gen-map    — re-match the fixed 0.6.0 source -> new target, emit a candidate
//                   map (targets carried forward verbatim). Spawned as a subprocess
//                   so the verbatim matcher stays the single source of truth.
//   4. diff       — diffMaps(committed, candidate): what moved, what to re-verify
//   5. verify     — verifyTargets(candidate, unpacked): do the carried-forward
//                   targets' anchors still resolve in the new bundle?
//
// The candidate is written to maps/polytrack-<ver>.candidate.json — NEVER clobbering
// the committed map. The human reviews the console report; if green, they promote:
//   cp maps/polytrack-<ver>.candidate.json maps/polytrack-<ver>.json && git commit
//
// Standalone modes (no fetch/unpack/gen — for reviewing an already-generated map):
//   node scripts/regen.mjs --diff  prev.json next.json
//   node scripts/regen.mjs --verify map.json  unpacked-dir
//
// Local-only: needs webcrack + the cached 0.6.0 renamed source (gitignored). Not run
// in CI (the bundle is not committed). The pure diff/verify logic IS unit-tested.

import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, stat, access } from "node:fs/promises";
import { constants } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { diffMaps, formatDiff, assertTargetsCarried, assertChunksCarried, assertWasmCarried } from "../src/diff.mjs";
import { verifyTargets, formatVerifications, loadModuleSources } from "../src/verify-targets.mjs";
import { fetchVersion } from "../src/fetch.mjs";

const PKG_DIR = fileURLToPath(new URL(".", import.meta.url)).replace(/\/scripts\/$/, "/");
const CACHE = join(PKG_DIR, ".cache");
const UNPACK = join(PKG_DIR, "src/unpack.mjs");
const GEN_MAP = join(PKG_DIR, "../../source/mappings/scripts/gen-map.mjs");
const MAPS_DIR = join(PKG_DIR, "../../source/mappings/maps");
const exists = (p) => access(p, constants.F_OK).then(() => true, () => false);

/** Short webcrack dir tag from a version: "0.7.0" -> "v070" (major+minor, no dots). */
function verTag(v) {
  const [maj, min] = v.split(".");
  return `v${maj}${min ?? "0"}`;
}

/** Pick the latest committed map strictly older than `version` (the regen baseline).
 *  Ignores *.candidate.json. Returns an absolute path or throws. */
async function latestCommittedMap(version) {
  const files = (await readdir(MAPS_DIR)).filter(
    (f) => f.startsWith("polytrack-") && f.endsWith(".json") && !f.includes(".candidate"),
  );
  const parsed = files
    .map((f) => ({ f, ver: f.replace(/^polytrack-/, "").replace(/\.json$/, "") }))
    .filter((x) => /^[0-9]+\.[0-9]+\.[0-9]+$/.test(x.ver) && compareSemver(x.ver, version) < 0)
    .sort((a, b) => compareSemver(b.ver, a.ver));
  if (!parsed.length) throw new Error(`no committed map older than ${version} in ${MAPS_DIR}; pass --prev <map.json>`);
  return join(MAPS_DIR, parsed[0].f);
}

/** -1 / 0 / 1 for "a.b.c" semver strings. */
function compareSemver(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** Spawn a node script, inherit stdio (so gen-map's report + the candidate path show
 *  through), reject on non-zero exit. Array args only — never shell=True.
 *
 *  Uses `spawn`, not `execFile`: `execFile` has no `stdio` option, so the
 *  `stdio: "inherit"` this function was passing was silently dropped and gen-map's
 *  report — the thing a maintainer reads to decide whether to promote a candidate
 *  map — was buffered into a discarded string instead of being printed. `execFile`
 *  would also have truncated it at the 1 MB default `maxBuffer`. Found by the #25
 *  typecheck, not by a run: the failure looks like "gen-map is quiet", which reads
 *  as normal.
 *
 *  Exported so a test can drive the REAL function. A test that re-declared this
 *  shape would have passed against the broken `execFile` version too. */
export function runNode(script, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      env: { ...process.env, ...env },
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`${script} exited ${code}`)),
    );
  });
}

const readJson = (p) => readFile(p, "utf8").then((t) => JSON.parse(t));

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------

async function modeDiff() {
  const [prevPath, nextPath] = process.argv.slice(process.argv.indexOf("--diff") + 1);
  if (!prevPath || !nextPath) {
    console.error("usage: regen.mjs --diff <prev.json> <next.json>");
    process.exit(2);
  }
  const [prev, next] = [prevPath, nextPath].map((p) => readJson(p));
  const diff = diffMaps(await prev, await next);
  process.stdout.write(formatDiff(diff) + "\n");
  process.exit(diff.riskLevel === "high" ? 1 : 0);
}

/**
 * Load `surfaceFile -> moduleId -> source` for verification (#98).
 *
 * A surface with no unpacked dir is simply absent from the returned map, which
 * `verifyTargets` reports as SKIPPED. Absent-means-unchecked is the whole contract
 * here: substituting main's modules for a missing chunk would produce confident
 * passes for anchors nobody looked at.
 * @param {string} mainDir           unpacked main bundle
 * @param {Record<string,string>} chunkDirs  chunk id -> unpacked dir
 */
async function loadSurfaceSources(mainDir, chunkDirs = {}) {
  const bySurface = new Map();
  bySurface.set("main.bundle.js", await loadModuleSources(mainDir));
  for (const [id, dir] of Object.entries(chunkDirs)) {
    bySurface.set(`${id}.bundle.js`, await loadModuleSources(dir));
  }
  return bySurface;
}

async function modeVerify() {
  const rest = process.argv.slice(process.argv.indexOf("--verify") + 1);
  const [mapPath, dir, ...pairs] = rest;
  if (!mapPath || !dir) {
    console.error("usage: regen.mjs --verify <map.json> <unpacked-main-dir> [<chunkId>=<unpacked-chunk-dir> ...]");
    process.exit(2);
  }
  // `112=/path/to/unpacked` — explicit rather than inferred from a directory naming
  // convention, so a typo'd path is a hard error here instead of a silent SKIPPED.
  /** @type {Record<string, string>} chunk id -> unpacked dir */
  const chunkDirs = {};
  for (const p of pairs) {
    const eq = p.indexOf("=");
    const id = eq > 0 ? p.slice(0, eq) : "";
    if (!/^\d{1,6}$/.test(id)) {
      console.error(`--verify: expected <chunkId>=<dir> (chunk id is 1-6 digits), got: ${p}`);
      process.exit(2);
    }
    chunkDirs[id] = p.slice(eq + 1);
  }
  const map = await readJson(mapPath);
  const v = verifyTargets(map, await loadSurfaceSources(dir, chunkDirs));
  process.stdout.write(formatVerifications(v) + "\n");
  // SKIPPED is a non-zero exit alongside fail: the run verified less than the map
  // claims, and a 0 here would let a partial check pass for a complete one in CI.
  process.exit(v.some((x) => x.status === "fail" || x.status === "skipped") ? 1 : 0);
}

async function modeRegen(version, flags) {
  const tag = verTag(version);
  const srcDir = flags.src ?? join(CACHE, "webcrack/v060-renamed");
  const tgtDir = flags.tgt ?? join(CACHE, `webcrack/${tag}-raw`);
  const bundle = flags.bundle ?? join(CACHE, `pt-${version}-raw-main.js`);
  const prevPath = flags.prev ?? (await latestCommittedMap(version));
  const outPath = flags.out ?? join(MAPS_DIR, `polytrack-${version}.candidate.json`);
  // Candidate-never-clobbers-committed: a user-supplied --out inside maps/ must keep
  // the .candidate.json suffix — the promote `cp` is the only write path to a committed name.
  if (flags.out && resolve(outPath).startsWith(resolve(MAPS_DIR)) && !outPath.endsWith(".candidate.json")) {
    throw new Error(`--out inside maps/ must end in .candidate.json (refusing to risk clobbering a committed map): ${outPath}`);
  }
  const prev = await readJson(prevPath);

  if (!(await exists(srcDir))) {
    throw new Error(`source unpacked dir not found: ${srcDir}\n  (the fixed 0.6.0 renamed source is gitignored; it must exist locally to regen)`);
  }

  // 1. fetch
  /** @type {{id:string, file:string, hash:string, bytes:number}[]} */
  let chunkFetches = [];
  if (!flags.noFetch) {
    process.stderr.write(`[1/5] fetch ${version} from CDN\n`);
    const fetched = await fetchVersion(version, CACHE, { only: "main", chunks: flags.chunks });
    // Chunks are a real pipeline input since #98: their bytes are pinned in the map
    // and their modules are verified like main's. Still opt-in via --chunks, because
    // the 0.6.2 chunks are UI-only and paying four requests plus four webcrack runs on
    // every regen buys nothing — but a release that moves game logic into one is
    // visible here rather than as a mystery drop in match rate.
    chunkFetches = fetched
      .filter((r) => r.kind.startsWith("chunk-"))
      .map((r) => ({ id: r.kind.slice("chunk-".length), file: r.outFile, hash: r.sha256, bytes: r.bytes }));
    if (flags.chunks) {
      process.stderr.write(
        chunkFetches.length
          ? `      chunks: ${chunkFetches.map((c) => c.id).join(", ")} (re-pinned + unpacked below)\n`
          : `      chunks: none — this build declares no split chunks\n`,
      );
    }
  } else {
    process.stderr.write(`[1/5] fetch skipped (--no-fetch)\n`);
    if (flags.chunks) {
      // --no-fetch --chunks cannot re-pin: a pin is a hash of bytes this run did not
      // download. Emitting carried-forward pins while the caller asked for --chunks
      // would look like a re-pin and silently ship stale hashes.
      throw new Error(
        "--chunks needs a fetch to re-pin chunk hashes; --no-fetch would carry the previous build's pins forward while looking like a re-pin. Drop one of the two flags.",
      );
    }
  }
  if (!(await exists(bundle))) throw new Error(`bundle not found after fetch step: ${bundle}`);

  // 2. unpack (skip if already unpacked, unless --reunpack)
  if ((await exists(tgtDir)) && !flags.reunpack) {
    process.stderr.write(`[2/5] unpack skipped (${tgtDir} exists; --reunpack to redo)\n`);
  } else {
    process.stderr.write(`[2/5] unpack -> ${tgtDir}\n`);
    await runNode(UNPACK, [bundle, tgtDir]);
  }
  // Each chunk unpacks into its OWN dir, never merged with main's: two surfaces can
  // both contain a module named `112.js`, and a merged map would silently drop one.
  /** @type {Record<string,string>} chunk id -> unpacked dir */
  const chunkDirs = {};
  for (const c of chunkFetches) {
    const dir = join(CACHE, `webcrack/${tag}-chunk-${c.id}`);
    chunkDirs[c.id] = dir;
    if ((await exists(dir)) && !flags.reunpack) {
      process.stderr.write(`      chunk ${c.id}: unpack skipped (${dir} exists)\n`);
    } else {
      process.stderr.write(`      chunk ${c.id}: unpack -> ${dir}\n`);
      await runNode(UNPACK, [c.file, dir]);
    }
  }

  // 3. gen-map (spawn the verbatim matcher; carry targets forward into the candidate)
  process.stderr.write(`[3/5] gen-map candidate -> ${outPath}\n`);
  /** @type {Record<string, string>} */
  const genEnv = {
    GEN_SRC: srcDir, GEN_TGT: tgtDir, GEN_BUNDLE: bundle,
    GEN_VERSION: version, GEN_OUT: outPath, GEN_PREV_MAP: prevPath,
  };
  // Fresh pins from THIS fetch. Absent on a run without --chunks, in which case
  // gen-map carries the baseline's pins and stamps a warning into generated.note.
  if (chunkFetches.length) {
    genEnv.GEN_CHUNKS = JSON.stringify(chunkFetches.map((c) => ({ id: c.id, hash: c.hash, bytes: c.bytes })));
  }
  await runNode(GEN_MAP, [], genEnv);
  const candidate = await readJson(outPath);

  // Non-vacuous gate: refuse a candidate that lost targets vs the baseline — otherwise
  // verify-targets would check 0 targets and print a misleading "ALL TARGETS RESOLVE".
  assertTargetsCarried(prev, candidate);
  // Same gate for the chunk allowlist (#98). A chunk-less candidate is the quieter
  // loss of the two: it validates, resolves every main-bundle symbol, and serves the
  // game correctly — only chunk transforms stop, with nothing logged.
  assertChunksCarried(prev, candidate, { allowDrop: flags.allowChunkDrop });
  // And for the physics binary (#43) — quieter still, since regen never re-pins it and
  // so has no fresh-pin path that could make the loss visible.
  assertWasmCarried(prev, candidate);

  // 4. diff
  process.stderr.write(`[4/5] diff vs committed ${prevPath}\n`);
  const diff = diffMaps(prev, candidate);
  process.stdout.write("\n=== MAP DIFF ===\n" + formatDiff(diff) + "\n");

  // 5. verify targets, each against its OWN surface's unpacked modules (#98)
  const surfaceList = ["main", ...Object.keys(chunkDirs)].join(", ");
  process.stderr.write(`[5/5] verify targets against ${surfaceList}\n`);
  const verif = verifyTargets(candidate, await loadSurfaceSources(tgtDir, chunkDirs));
  process.stdout.write("\n=== TARGET VERIFICATION ===\n" + formatVerifications(verif) + "\n");

  // A skipped target is not a pass. Without --chunks a chunk-scoped target has no
  // sources to check against, so the run verified less than the map claims — the
  // same vacuous-green that assertTargetsCarried guards from the other side.
  const notVerified = verif.some((v) => v.status === "fail" || v.status === "skipped");
  process.stdout.write(`\ncandidate written: ${outPath}\n`);
  process.stdout.write(`committed baseline: ${prevPath}\n`);
  if (diff.riskLevel !== "high" && !notVerified) {
    process.stdout.write(`\nGREEN: review the diff, then promote:\n  cp ${outPath} ${join(MAPS_DIR, `polytrack-${version}.json`)} && git add -A && git commit\n`);
  } else {
    process.stdout.write("\nACTION REQUIRED: address the items above before promoting.\n");
    if (verif.some((v) => v.status === "skipped") && !flags.chunks) {
      process.stdout.write("  (some targets live in chunks — re-run with --chunks to fetch, unpack and verify them.)\n");
    }
  }
  process.exit(diff.riskLevel === "high" || notVerified ? 1 : 0);
}

// ---------------------------------------------------------------------------
// arg parsing
// ---------------------------------------------------------------------------
async function main() {
  if (process.argv.includes("--diff")) return modeDiff();
  if (process.argv.includes("--verify")) return modeVerify();

  const version = process.argv[2];
  if (!version) {
    console.error(`usage:
  regen.mjs <version> [options]        full regen + review
    --no-fetch        use an already-cached bundle (skip CDN download)
    --chunks          also fetch + re-pin the build's split chunks (#98)
    --allow-chunk-drop  accept a candidate that declares fewer chunks than the
                      baseline (only after confirming the new runtime really
                      stopped shipping them)
    --reunpack        re-webcrack even if the unpacked dir exists
    --src <dir>       source unpacked dir (default .cache/webcrack/v060-renamed)
    --tgt <dir>       target unpacked dir (default .cache/webcrack/v<ver>-raw)
    --bundle <file>   new main bundle (default .cache/pt-<ver>-raw-main.js)
    --prev <map.json> committed baseline (default: latest map < <version>)
    --out <map.json>  candidate output (default maps/polytrack-<ver>.candidate.json)
  regen.mjs --diff <prev.json> <next.json>
  regen.mjs --verify <map.json> <unpacked-main-dir> [<chunkId>=<unpacked-chunk-dir> ...]`);
    process.exit(2);
  }
  const flag = (k) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
  return modeRegen(version, {
    noFetch: process.argv.includes("--no-fetch"),
    chunks: process.argv.includes("--chunks"),
    allowChunkDrop: process.argv.includes("--allow-chunk-drop"),
    reunpack: process.argv.includes("--reunpack"),
    src: flag("--src"), tgt: flag("--tgt"), bundle: flag("--bundle"),
    prev: flag("--prev"), out: flag("--out"),
  });
}

// Run the CLI only when executed directly, so a test can import `runNode` without
// kicking off a regen. Mirrors the same guard in src/fetch.mjs.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(`\nregen failed: ${e.message}`); process.exit(1); });
}

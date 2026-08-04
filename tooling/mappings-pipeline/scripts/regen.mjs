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

import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, stat, access } from "node:fs/promises";
import { constants } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { diffMaps, formatDiff, assertTargetsCarried } from "../src/diff.mjs";
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
 *  through), reject on non-zero exit. Array args only — never shell=True. */
function runNode(script, args, env = {}) {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [script, ...args], { env: { ...process.env, ...env }, stdio: "inherit" }, (err) =>
      err ? reject(err) : resolve(),
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

async function modeVerify() {
  const [mapPath, dir] = process.argv.slice(process.argv.indexOf("--verify") + 1);
  if (!mapPath || !dir) {
    console.error("usage: regen.mjs --verify <map.json> <unpacked-dir>");
    process.exit(2);
  }
  const map = await readJson(mapPath);
  const sources = await loadModuleSources(dir);
  const v = verifyTargets(map, sources);
  process.stdout.write(formatVerifications(v) + "\n");
  process.exit(v.some((x) => x.status === "fail") ? 1 : 0);
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
  if (!flags.noFetch) {
    process.stderr.write(`[1/5] fetch ${version} from CDN\n`);
    const fetched = await fetchVersion(version, CACHE, { only: "main", chunks: flags.chunks });
    // Chunk coverage is a review signal, not a pipeline input (#3): in 0.6.2 the four
    // split chunks are UI-only (editor/verifier/profile/settings panels) and hold zero
    // mod-facing target anchors, so gen-map still matches main alone. Report what was
    // downloaded so a release that moves game logic into a chunk is visible here
    // rather than discovered as a mystery drop in match rate.
    const chunks = fetched.filter((r) => r.kind.startsWith("chunk-"));
    if (flags.chunks) {
      process.stderr.write(
        chunks.length
          ? `      chunks: ${chunks.map((c) => c.kind.slice(6)).join(", ")} (fetched for review; not matched)\n`
          : `      chunks: none — this build declares no split chunks\n`,
      );
    }
  } else {
    process.stderr.write(`[1/5] fetch skipped (--no-fetch)\n`);
  }
  if (!(await exists(bundle))) throw new Error(`bundle not found after fetch step: ${bundle}`);

  // 2. unpack (skip if already unpacked, unless --reunpack)
  if ((await exists(tgtDir)) && !flags.reunpack) {
    process.stderr.write(`[2/5] unpack skipped (${tgtDir} exists; --reunpack to redo)\n`);
  } else {
    process.stderr.write(`[2/5] unpack -> ${tgtDir}\n`);
    await runNode(UNPACK, [bundle, tgtDir]);
  }

  // 3. gen-map (spawn the verbatim matcher; carry targets forward into the candidate)
  process.stderr.write(`[3/5] gen-map candidate -> ${outPath}\n`);
  await runNode(GEN_MAP, [], {
    GEN_SRC: srcDir, GEN_TGT: tgtDir, GEN_BUNDLE: bundle,
    GEN_VERSION: version, GEN_OUT: outPath, GEN_PREV_MAP: prevPath,
  });
  const candidate = await readJson(outPath);

  // Non-vacuous gate: refuse a candidate that lost targets vs the baseline — otherwise
  // verify-targets would check 0 targets and print a misleading "ALL TARGETS RESOLVE".
  assertTargetsCarried(prev, candidate);

  // 4. diff
  process.stderr.write(`[4/5] diff vs committed ${prevPath}\n`);
  const diff = diffMaps(prev, candidate);
  process.stdout.write("\n=== MAP DIFF ===\n" + formatDiff(diff) + "\n");

  // 5. verify targets against the unpacked new bundle
  process.stderr.write(`[5/5] verify targets against ${tgtDir}\n`);
  const sources = await loadModuleSources(tgtDir);
  const verif = verifyTargets(candidate, sources);
  process.stdout.write("\n=== TARGET VERIFICATION ===\n" + formatVerifications(verif) + "\n");

  process.stdout.write(`\ncandidate written: ${outPath}\n`);
  process.stdout.write(`committed baseline: ${prevPath}\n`);
  if (diff.riskLevel !== "high" && !verif.some((v) => v.status === "fail")) {
    process.stdout.write(`\nGREEN: review the diff, then promote:\n  cp ${outPath} ${join(MAPS_DIR, `polytrack-${version}.json`)} && git add -A && git commit\n`);
  } else {
    process.stdout.write("\nACTION REQUIRED: address the items above before promoting.\n");
  }
  process.exit(diff.riskLevel === "high" || verif.some((v) => v.status === "fail") ? 1 : 0);
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
    --chunks          also fetch the build's split chunks (review only; see #3)
    --reunpack        re-webcrack even if the unpacked dir exists
    --src <dir>       source unpacked dir (default .cache/webcrack/v060-renamed)
    --tgt <dir>       target unpacked dir (default .cache/webcrack/v<ver>-raw)
    --bundle <file>   new main bundle (default .cache/pt-<ver>-raw-main.js)
    --prev <map.json> committed baseline (default: latest map < <version>)
    --out <map.json>  candidate output (default maps/polytrack-<ver>.candidate.json)
  regen.mjs --diff <prev.json> <next.json>
  regen.mjs --verify <map.json> <unpacked-dir>`);
    process.exit(2);
  }
  const flag = (k) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
  return modeRegen(version, {
    noFetch: process.argv.includes("--no-fetch"),
    chunks: process.argv.includes("--chunks"),
    reunpack: process.argv.includes("--reunpack"),
    src: flag("--src"), tgt: flag("--tgt"), bundle: flag("--bundle"),
    prev: flag("--prev"), out: flag("--out"),
  });
}

main().catch((e) => { console.error(`\nregen failed: ${e.message}`); process.exit(1); });

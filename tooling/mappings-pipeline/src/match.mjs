// match.mjs — cross-version module matcher for the M1 drift spike (honest version).
//
// Matches modules between a webcrack-unpacked SOURCE (known/descriptive names)
// and a minified TARGET by IDF-weighted shared string-literal anchors, with:
//   - aggregate/entry files excluded (they're universal string sinks → false matches)
//   - a margin requirement over the runner-up (rejects ambiguous weak matches)
//   - a curated GAME-LOGIC metric (modules the rename gave real game names) as the
//     primary go/no-go signal, since broad buckets catch CSS/utility chaff
//
// Usage: node src/match.mjs <src-unpacked> <tgt-unpacked> [report.json]
import { readdir, readFile, writeFile, stat } from "node:fs/promises";
import { join, basename } from "node:path";

const SRC = process.argv[2];
const TGT = process.argv[3];
const OUT = process.argv[4];
if (!SRC || !TGT) {
  console.error("usage: node src/match.mjs <src-unpacked> <tgt-unpacked> [report.json]");
  process.exit(2);
}

const STRING_RE = /(["'`])(?:\\.|(?!\1).)*\1/g;
const IDENT_RE = /\b[A-Za-z_$][A-Za-z0-9_$]{2,}\b/g;
// distinctive numeric anchors: 3+ digit ints, decimals, hex. Skips 0-99 (loop indices).
const NUMBER_RE = /(?<![\w.$])0x[0-9a-f]{2,}\b|(?<![\w.$])-?\d+\.\d+\b|(?<![\w.$])-?\d{3,}\b/gi;
const TRIVIAL = new Set([
  "use strict", "use asm", "strict", "http", "https", "svg", "div", "span",
  "none", "auto", "hidden", "visible", "true", "false", "null", "undefined",
  "object", "function", "string", "number", "boolean", "length", "prototype",
]);
const MAX_MODULE_BYTES = 1_000_000; // exclude reconstructed whole-bundle entry files
const isAggregate = (name, size) => size > MAX_MODULE_BYTES || name === "deobfuscated.js";

async function listJs(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...await listJs(p));
    else if (e.name.endsWith(".js")) out.push(p);
  }
  return out;
}

function extract(code) {
  const anchors = new Set();
  STRING_RE.lastIndex = 0;
  let m;
  while ((m = STRING_RE.exec(code))) {
    const s = m[0].slice(1, -1);
    if (s.length >= 3 && !TRIVIAL.has(s) && !/^\s*$/.test(s)) anchors.add("s:" + s);
  }
  NUMBER_RE.lastIndex = 0;
  while ((m = NUMBER_RE.exec(code))) anchors.add("n:" + m[0].toLowerCase());
  const idents = new Set();
  IDENT_RE.lastIndex = 0;
  while ((m = IDENT_RE.exec(code))) idents.add(m[0]);
  return { anchors, idents };
}

async function loadDir(dir) {
  const mods = [];
  for (const f of await listJs(dir)) {
    const st = await stat(f);
    const name = f.slice(dir.length + 1);
    if (isAggregate(name, st.size)) continue; // drop the whole-bundle sink
    const code = await readFile(f, "utf8");
    const { anchors, idents } = extract(code);
    mods.push({ name, size: st.size, anchors, idents });
  }
  return mods;
}

const srcMods = await loadDir(SRC);
const tgtMods = await loadDir(TGT);

const df = new Map();
for (const mod of [...srcMods, ...tgtMods])
  for (const s of mod.anchors) df.set(s, (df.get(s) || 0) + 1);
const N = srcMods.length + tgtMods.length;
const idf = (s) => Math.log((N + 1) / ((df.get(s) || 0) + 1)) + 1;

function sharedWeight(a, b) {
  const [small, big] = a.size < b.size ? [a, b] : [b, a];
  let w = 0;
  let count = 0;
  for (const s of small) if (big.has(s)) { w += idf(s); count += 1; }
  return { w, count };
}

// curated game-logic tokens — modules the cwcinc rename gave real game names.
// these are the "known stable symbols" we actually need to relocate across builds.
const GAME_TOKENS = [
  "car", "vehicle", "wheel", "suspension", "chassis", "steer", "throttle", "brake",
  "drivetrain", "track", "checkpoint", "lap", "finish", "race", "respawn",
  "leaderboard", "record", "replay", "verify", "determinism", "ghost",
  "multiplayer", "invite", "websocket", "peer", "render", "camera", "scene",
  "mesh", "shader", "collision", "skin", "physics", "audio", "sound",
];
const isGameLogic = (mod) => {
  for (const id of mod.idents) {
    const low = id.toLowerCase();
    if (low.length < 4) continue;
    for (const t of GAME_TOKENS) if (low.includes(t)) return true;
  }
  return false;
};

// The tuple annotation is load-bearing for the #25 typecheck: without it the array
// widens to `(string | RegExp)[][]` and `re.test(...)` below is an error, because
// nothing tells the checker that element 0 is always the pattern.
/** @type {readonly [RegExp, string][]} */
const SUBSYS = [
  [/car|vehicle|wheel|suspension|chassis|steer|throttle|brake|drivetrain/i, "Car/Physics"],
  [/track|part|block|road|grid|environment/i, "Track"],
  [/checkpoint|lap|finish|race|respawn/i, "Checkpoint/Race"],
  [/render|camera|scene|mesh|light|material|shader|texture|geometry|webgl/i, "Render"],
  [/leaderboard|record|replay|verify|determinism|ghost/i, "Records"],
  [/multiplayer|invite|websocket|peer|connect|signal|turn|stun/i, "Network"],
  [/audio|sound|volume|haptics/i, "Audio"],
  [/menu|hud|toolbar|button|dropdown|tooltip|modal|keybind/i, "UI"],
];
const classify = (mod) => {
  const blob = [...mod.idents, ...mod.anchors].join(" ");
  return SUBSYS.filter(([re]) => re.test(blob)).map(([, n]) => n);
};

let matched = 0;
let total = 0;
let glMatched = 0;
let glTotal = 0;
const perSub = {};
const tgtWins = new Map();
const examples = [];
const unmatched = [];
const margin = 1.25;

for (const m of srcMods) {
  if (m.anchors.size === 0) continue;
  total += 1;
  const gl = isGameLogic(m);
  if (gl) glTotal += 1;
  let best = null;
  let second = null;
  for (const n of tgtMods) {
    const { w, count } = sharedWeight(m.anchors, n.anchors);
    if (!best || w > best.w) { second = best; best = { n, w, count }; }
    else if (!second || w > second.w) second = { n, w, count };
  }
  const hasMargin = !second || best.w >= margin * second.w;
  const ok = best && hasMargin && ((best.count >= 2 && best.w >= 8) || (best.count === 1 && best.w >= 5));
  if (ok) {
    matched += 1;
    if (gl) glMatched += 1;
    tgtWins.set(best.n.name, (tgtWins.get(best.n.name) || 0) + 1);
  }
  const subs = classify(m);
  for (const s of subs) {
    (perSub[s] ??= { total: 0, matched: 0 });
    perSub[s].total += 1;
    if (ok) perSub[s].matched += 1;
  }
  if (ok && examples.length < 15 && gl)
    examples.push({ src: m.name, tgt: best.n.name, shared: best.count, w: Math.round(best.w), subs });
  else if (!ok && unmatched.length < 15 && gl)
    unmatched.push({ src: m.name, subs, anchors: m.anchors.size, bestShared: best ? best.count : 0 });
}

const perSubOut = Object.fromEntries(
  Object.entries(perSub).map(([k, v]) => [k, { ...v, rate: v.total ? +(v.matched / v.total).toFixed(3) : 0 }]),
);
const topSinks = [...tgtWins.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([n, c]) => ({ tgt: n, won: c }));

const report = {
  src: SRC,
  tgt: TGT,
  srcModules: srcMods.length,
  tgtModules: tgtMods.length,
  srcWithAnchors: total,
  overallMatchRate: total ? +(matched / total).toFixed(3) : 0,
  gameLogicTotal: glTotal,
  gameLogicMatched: glMatched,
  gameLogicMatchRate: glTotal ? +(glMatched / glTotal).toFixed(3) : 0,
  perSubsystem: perSubOut,
  topTargetSinks: topSinks,
  examples,
  unmatchedGameLogicSample: unmatched,
};
const text = JSON.stringify(report, null, 2);
if (OUT) await writeFile(OUT, text);
console.log(text);

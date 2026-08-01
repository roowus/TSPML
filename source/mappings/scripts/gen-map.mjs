// gen-map.mjs — generate the v1 PolyTrack 0.6.2 symbol map.
//
// This is the M2 map generator. It reproduces the M1 drift-spike matcher
// (tooling/mappings-pipeline/src/match.mjs) WITHOUT the human-sample caps so it
// can emit EVERY matched game-logic module, then:
//   - extracts representative stable names from each 0.6.0 renamed module,
//   - computes the bundleHash (sha256 of the 0.6.2 main bundle),
//   - writes maps/polytrack-0.6.2.json.
//
// The matcher logic is copied verbatim from the spike (same regexes, IDF, margin,
// and accept criterion) so the generated matches are consistent with the
// report-sn-relaxed.json results — only the artificial `examples.length < 15`
// cap is removed. File lists are sorted for deterministic output.
//
// Usage: node scripts/gen-map.mjs
//   (paths are hardcoded to the pipeline cache; run from the package root.)
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_DIR = fileURLToPath(new URL(".", import.meta.url));
const CACHE = join(PKG_DIR, "../../../tooling/mappings-pipeline/.cache");
// Env-var overridable (M9): lets `GEN_VERSION=0.7.0 GEN_TGT=... node gen-map.mjs`
// regenerate a candidate map for ANY version without editing this file.
const SRC = process.env.GEN_SRC ?? join(CACHE, "webcrack/v060-renamed");
const TGT = process.env.GEN_TGT ?? join(CACHE, "webcrack/v062-raw");
const BUNDLE = process.env.GEN_BUNDLE ?? join(CACHE, "pt-0.6.2-raw-main.js");
const GAME_VERSION = process.env.GEN_VERSION ?? "0.6.2";
const OUT = process.env.GEN_OUT ?? join(PKG_DIR, `../maps/polytrack-${GAME_VERSION}.json`);

// ---------------------------------------------------------------------------
// Matcher (verbatim from tooling/mappings-pipeline/src/match.mjs)
// ---------------------------------------------------------------------------
const STRING_RE = /(["'`])(?:\\.|(?!\1).)*\1/g;
const IDENT_RE = /\b[A-Za-z_$][A-Za-z0-9_$]{2,}\b/g;
const NUMBER_RE = /(?<![\w.$])0x[0-9a-f]{2,}\b|(?<![\w.$])-?\d+\.\d+\b|(?<![\w.$])-?\d{3,}\b/gi;
const TRIVIAL = new Set([
  "use strict", "use asm", "strict", "http", "https", "svg", "div", "span",
  "none", "auto", "hidden", "visible", "true", "false", "null", "undefined",
  "object", "function", "string", "number", "boolean", "length", "prototype",
]);
const MAX_MODULE_BYTES = 1_000_000;
const isAggregate = (name, size) => size > MAX_MODULE_BYTES || name === "deobfuscated.js";

async function listJs(dir) {
  const out = [];
  for (const e of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
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
    if (isAggregate(name, st.size)) continue;
    const code = await readFile(f, "utf8");
    const { anchors, idents } = extract(code);
    mods.push({ name, size: st.size, anchors, idents, code });
  }
  return mods;
}

// ---------------------------------------------------------------------------
// Game-logic curation + subsystem classification (verbatim from the spike)
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Stable-name extraction (NEW for M2 — not in the spike)
// ---------------------------------------------------------------------------
// Pick a few descriptive, distinctive identifiers from the renamed 0.6.0 module
// to serve as the module's "representative stable names". These are what mods
// target and what the resolver indexes. Generic identifiers (JS keywords,
// builtins, three.js / webpack / webcrack artifacts) are filtered out.
const STOP = new Set([
  // JS keywords / literals
  "const", "let", "var", "function", "return", "class", "extends", "super",
  "this", "new", "delete", "typeof", "instanceof", "void", "yield", "await",
  "async", "static", "get", "set", "export", "import", "from", "default",
  "else", "case", "break", "continue", "for", "while", "switch", "throw",
  "try", "catch", "finally", "if", "do", "in", "of", "with", "debugger",
  "true", "false", "null", "undefined", "arguments",
  // builtins / common
  "Array", "Object", "String", "Number", "Boolean", "Math", "JSON", "Date",
  "Map", "Set", "WeakMap", "WeakSet", "Promise", "Symbol", "Error", "RegExp",
  "TypeError", "RangeError", "console", "window", "document", "globalThis",
  "self", "global", "process", "module", "exports", "require", "define",
  "constructor", "prototype", "call", "apply", "bind", "hasOwnProperty",
  "toString", "valueOf", "length", "name", "props", "config", "data", "value",
  "key", "keys", "values", "entries", "item", "items", "list", "array", "object",
  "buffer", "bytes", "byteLength", "offset", "index", "count", "size", "type",
  "start", "end", "first", "last", "next", "prev", "current", "target", "source",
  "src", "dst", "dest", "self", "that", "this", "result", "results", "output",
  "input", "options", "opts", "args", "params", "context", "ctx", "event",
  "events", "handler", "callback", "resolve", "reject", "then", "catch",
  // three.js / webgl / webpack chaff (commonly present even in game modules)
  "BufferGeometry", "BufferAttribute", "Color", "Material", "Mesh", "Texture",
  "Vector", "Vector2", "Vector3", "Vector4", "Matrix", "Matrix3", "Matrix4",
  "Quaternion", "Euler", "Ray", "Plane", "Sphere", "Box", "Frustum",
  "Geometry", "Shader", "Uniform", "Attribute", "Camera", "Scene", "Light",
  "Object3D", "Group", "Line", "Points", "Sprite", "LensFlare",
  "attributeIDs", "attributeTypes", "taskCosts", "taskLoad", "loadLibrary",
  "releaseTask", "initDecoder", "createHash", "arraybuffer",
  // typed arrays / buffer views (common physics/render chaff)
  "ArrayBuffer", "DataView", "Float32Array", "Float64Array", "Int32Array",
  "Uint8Array", "Uint16Array", "Uint32Array", "Int8Array", "Int16Array",
  "BigUint64Array", "BigInt64Array",
  // three.js transform / object methods (transform-matrix chaff)
  "translateX", "translateY", "translateZ", "rotateX", "rotateY", "rotateZ",
  "rotateOnAxis", "translateOnAxis", "lookAt", "updateMatrix", "updateMatrixWorld",
  "applyMatrix4", "applyQuaternion", "setPosition", "setRotationFromQuaternion",
  "getWorldPosition", "getWorldDirection", "localToWorld", "worldToLocal",
  "matrixWorld", "matrixAutoUpdate", "quaternion", "position", "rotation", "scale",
  "up", "uuid", "id",
  // extremely generic single game-token words used far too broadly to locate a module
  "record", "records", "track", "tracks", "race", "car", "cars", "render",
  "physics", "audio", "sound", "mesh", "scene", "camera", "wheel",
]);

function stableNames(idents, docFreq) {
  const game = (n) => GAME_TOKENS.some((t) => n.toLowerCase().includes(t));
  const scored = [...idents]
    .filter((n) => n.length >= 4 && !STOP.has(n) && !/^\d/.test(n))
    .filter((n) => !(n === n.toUpperCase() && n.length > 4 && n.includes("_")) || game(n))
    .map((n) => {
      let s = 0;
      if (game(n)) s += 100;
      if (/[a-z]/.test(n) && /[A-Z]/.test(n)) s += 25; // camelCase / PascalCase
      if (/^[A-Z][a-z]/.test(n)) s += 5;
      s += Math.min(n.length, 28);
      if (!game(n) && /^[a-z]+$/.test(n)) s -= 15; // plain lowercase word
      if (!game(n) && /^[A-Z][A-Z0-9_]+$/.test(n)) s -= 10; // SCREAMING enum/data
      // rarity: identifiers unique to this module are far better locators than
      // ones shared across many modules (e.g. a protocol enum copied into N files).
      const df = docFreq.get(n) || 1;
      s += df === 1 ? 60 : df === 2 ? 20 : df === 3 ? 5 : -25;
      return { n, s };
    })
    .sort((a, b) => b.s - a.s || a.n.localeCompare(b.n));
  const seen = new Set();
  const out = [];
  for (const { n, s } of scored) {
    if (s <= 0) break;
    const k = n.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(n);
    if (out.length >= 6) break;
  }
  return out;
}

// Derive a human concept label + slug key from a module's stable names.
function conceptFor(names, subs, srcId) {
  if (names.length === 0) {
    return { label: `${subs[0] ?? "Module"} #${srcId}`, slug: `${(subs[0] ?? "module").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${srcId}` };
  }
  const lead = names[0];
  // collapse to a readable concept: e.g. controlCar -> "Control Car"; BlockBridge -> "Block Bridge"
  const words = lead
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/\s+/);
  const label = words
    .map((w) => (w === w.toUpperCase() && w.length > 1 ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
  const slug = lead.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return { label, slug };
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
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

// Document frequency of each identifier across the renamed 0.6.0 corpus — used
// to prefer identifiers UNIQUE to a module (better stable-name locators).
const identDocFreq = new Map();
for (const m of srcMods) {
  for (const id of m.idents) identDocFreq.set(id, (identDocFreq.get(id) || 0) + 1);
}

const margin = 1.25;
const matched = []; // { src, tgt, count, w, subs, names }
const unresolved = []; // { src, subs, anchors, bestShared }
for (const m of srcMods) {
  if (m.anchors.size === 0) continue;
  const gl = isGameLogic(m);
  if (!gl) continue; // v1 map covers game-logic only (spike scope)
  let best = null;
  let second = null;
  for (const n of tgtMods) {
    const { w, count } = sharedWeight(m.anchors, n.anchors);
    if (!best || w > best.w) { second = best; best = { n, w, count }; }
    else if (!second || w > second.w) second = { n, w, count };
  }
  const hasMargin = !second || best.w >= margin * second.w;
  const ok = best && hasMargin && ((best.count >= 2 && best.w >= 8) || (best.count === 1 && best.w >= 5));
  const subs = classify(m);
  const srcId = m.name.replace(/\.js$/, "");
  if (ok) {
    matched.push({
      srcId,
      tgtId: best.n.name.replace(/\.js$/, ""),
      count: best.count,
      w: Math.round(best.w),
      subs: subs.length ? subs : ["Unknown"],
      names: stableNames(m.idents, identDocFreq),
    });
  } else {
    unresolved.push({
      srcId,
      subs: subs.length ? subs : ["Unknown"],
      anchors: m.anchors.size,
      bestShared: best ? best.count : 0,
    });
  }
}

// Build the modules map (keyed by concept slug, collision-suffixed by srcId).
const modules = {};
const usedKeys = new Set();
const stableIndex = {}; // stableName -> moduleId (first-wins; reported on collision)
const collisions = [];
for (const m of matched) {
  const { label, slug } = conceptFor(m.names, m.subs, m.srcId);
  let key = slug;
  while (usedKeys.has(key)) key = `${slug}-${m.srcId}`;
  usedKeys.add(key);
  modules[key] = {
    concept: label,
    stableNames: m.names,
    subsystem: m.subs[0],
    subsystems: m.subs,
    moduleId: m.tgtId,
    matchWeight: m.w,
    sharedAnchors: m.count,
    sourceModuleId: m.srcId,
  };
  for (const n of m.names) {
    const k = n.toLowerCase();
    if (stableIndex[k] !== undefined) {
      collisions.push({ name: n, first: stableIndex[k], dup: m.tgtId });
    } else {
      stableIndex[k] = m.tgtId;
    }
  }
}

const unresolvedOut = unresolved.map((u) => ({
  sourceModuleId: u.srcId,
  subsystem: u.subs[0],
  subsystems: u.subs,
  reason: `no confident match (best shared anchors: ${u.bestShared}/${u.anchors})`,
}));

const bundle = await readFile(BUNDLE);
const bundleHash = "sha256:" + createHash("sha256").update(bundle).digest("hex");

const map = {
  formatVersion: 1,
  gameVersion: GAME_VERSION,
  bundleHash,
  generated: {
    from: "M1 drift spike (tooling/mappings-pipeline)",
    matcher: "report-sn-relaxed configuration (margin 1.25, >=2 anchors w>=8 | 1 anchor w>=5)",
    granularity: "module + targets (M5-C)",
    note: "v1 module-level map. `targets` (stable name -> TargetSpec) are hand-curated + carried forward on regen; verify against the new build.",
  },
  modules,
  unresolved: unresolvedOut,
};

// Carry forward the hand-curated `targets` section from the existing map (M5-C).
// On a new version, the human verifies each target's anchor still matches.
try {
  const prev = JSON.parse(await readFile(OUT, "utf8"));
  if (prev.targets && typeof prev.targets === "object") {
    map.targets = prev.targets;
    console.error(`targets carried forward: ${Object.keys(prev.targets).length} entries (verify against the new build)`);
  }
} catch {
  // No existing map — no targets to carry (human adds them later).
}

await writeFile(OUT, JSON.stringify(map, null, 2) + "\n", "utf8");

// ---------------------------------------------------------------------------
// Report (stderr; the JSON file is the artifact)
// ---------------------------------------------------------------------------
const verify = ["1196", "1223", "1312", "1635", "1728", "1882", "2108", "2203", "2493", "2646", "2709", "2825", "2931", "2951", "2970"];
const seen = new Set(matched.map((m) => m.srcId));
const missing = verify.filter((id) => !seen.has(id));
console.error(`bundleHash      : ${bundleHash}`);
console.error(`matched modules : ${matched.length}`);
console.error(`unresolved      : ${unresolved.length}`);
console.error(`stable names    : ${Object.keys(stableIndex).length} (collisions: ${collisions.length})`);
console.error(`example pairs   : ${verify.length - missing.length}/${verify.length} reproduced${missing.length ? ` (missing: ${missing.join(",")})` : ""}`);
console.error(`wrote           : ${OUT}`);
if (collisions.length) console.error(`collisions:\n` + collisions.slice(0, 10).map((c) => `  ${c.name}: ${c.first} vs ${c.dup}`).join("\n"));

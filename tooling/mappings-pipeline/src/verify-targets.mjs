// verify-targets.mjs — confirm carried-forward `targets` still resolve in a new build.
//
// `gen-map.mjs` carries the hand-curated `targets` section (stable name ->
// TargetSpec{anchor, selector}) forward VERBATIM on every regen. That is only safe
// if each target's anchor literals still appear together in the new build's
// (webcrack-unpacked) modules — otherwise a target silently points at nothing and a
// mod's mixin fail-closes at runtime with a confusing "anchor not found". This
// module is the gate that catches that at REVIEW time, not at mod-load time.
//
// It reads the unpacked new-bundle directory (webcrack output: one .js per module,
// named <moduleId>.js) and, for each target, finds which module file(s) contain ALL
// of the anchor's literals (>= minHits). The transform locator itself anchors on
// literal presence, so this is a faithful proxy for "will the locator find it".
//
// Pure-ish: filesystem read only (no network, no mutation). Unit-testable against a
// fixture directory of fake module files.
//
// Usage (programmatic): import { verifyTargets } from "../src/verify-targets.mjs";
//        (CLI):           node scripts/regen.mjs --verify map.json unpacked-dir

import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

/** @typedef {import("../../../source/mappings/src/types.ts").GameMap} GameMap */
/** @typedef {import("../../../source/mappings/src/types.ts").TargetSpec} TargetSpec */

// Mirror match.mjs / gen-map.mjs: skip the reconstructed whole-bundle sink and any
// oversize aggregate file — they contain every literal and would match everything.
const MAX_MODULE_BYTES = 1_000_000;
const isAggregate = (name, size) => size > MAX_MODULE_BYTES || name === "deobfuscated.js";

/** Recursively list <moduleId>.js files (name without extension = webcrack id). */
async function listModules(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...await listModules(p));
    else if (e.name.endsWith(".js")) out.push(p);
  }
  return out;
}

/**
 * Load every non-aggregate module file in a webcrack-unpacked dir, keyed by
 * moduleId (filename stem), with its source text. Cached text lets a caller verify
 * many targets against one dir without re-reading.
 * @param {string} dir  unpacked bundle dir (e.g. .../.cache/webcrack/v062-raw)
 * @returns {Promise<Map<string, string>>} moduleId -> source text
 */
export async function loadModuleSources(dir) {
  const sources = new Map();
  for (const f of await listModules(dir)) {
    const st = await stat(f);
    const rel = f.slice(dir.length + 1); // relative path incl. extension
    if (isAggregate(rel, st.size)) continue; // skip the whole-bundle sink (matches match.mjs)
    sources.set(rel.replace(/\.js$/, ""), await readFile(f, "utf8"));
  }
  return sources;
}

/**
 * Which modules contain every one of `literals` (>= minHits DISTINCT literals present)?
 *
 * Counts DISTINCT literals present (one per literal, regardless of how many times it
 * repeats) — INTENTIONALLY CONSERVATIVE vs the runtime locator, which counts AST
 * StringLiteral OCCURRENCES. Consequence: a pass here GUARANTEES the locator also
 * finds the anchor (distinct-present >= minHits => occurrences >= minHits, since each
 * present literal occurs >= 1 time). A fail/ambiguous here is a re-verify signal, not
 * proof the locator misses it (a module repeating a subset of literals >= minHits
 * times would pass the locator but fail here). For the real targets (minHits ==
 * literals.length, distinctive enum strings) the two agree exactly. Matching is
 * substring-on-source; short numeric literals can substring-match longer tokens
 * (e.g. "256" in "1256"), but the real targets are distinctive strings, and the
 * ambiguity check below surfaces multi-module hits regardless.
 *
 * @param {Map<string, string>} sources  moduleId -> source text
 * @param {(string|number)[]} literals
 * @param {number} minHits
 * @returns {string[]} moduleIds whose source contains >= minHits distinct literals
 */
export function modulesContaining(sources, literals, minHits) {
  const needles = (literals ?? []).map((l) => String(l));
  const hits = [];
  for (const [modId, code] of sources) {
    let n = 0;
    for (const needle of needles) if (code.includes(needle)) n += 1;
    if (n >= minHits) hits.push(modId);
  }
  return hits.sort((a, b) => a.localeCompare(b));
}

/**
 * @typedef {Object} TargetVerification
 * @property {string} target           stable name
 * @property {"pass" | "fail" | "ambiguous"} status
 * @property {string[]} modules        moduleIds containing the anchor (>= minHits)
 * @property {number} literals
 * @property {number} minHits
 * @property {string} note
 */

/**
 * Verify every target in `map.targets` against the unpacked new-build modules.
 * @param {GameMap} map
 * @param {Map<string, string>} sources  moduleId -> source text (from loadModuleSources)
 * @returns {TargetVerification[]}
 */
export function verifyTargets(map, sources) {
  const targets = map.targets ?? {};
  /** @type {TargetVerification[]} */
  const out = [];
  for (const [name, spec] of Object.entries(targets)) {
    const literals = spec.anchor.literals ?? [];
    const minHits = spec.anchor.minHits ?? literals.length;
    const modules = modulesContaining(sources, literals, minHits);
    let status;
    let note;
    if (modules.length === 1) {
      status = "pass";
      note = `anchor resolves to module ${modules[0]}`;
    } else if (modules.length > 1) {
      // The runtime locator picks the FIRST module in source order with hits >= minHits
      // (the selector disambiguates WITHIN a module, not BETWEEN modules). So >1 hit at
      // review time means the anchor is no longer unique and the locator may bind the
      // wrong one — flag it so a human can tighten the anchor.
      status = "ambiguous";
      note = `anchor present in ${modules.length} modules (${modules.join(", ")}); the locator picks the first in source order — confirm it is the intended one, or tighten the anchor`;
    } else {
      status = "fail";
      note = `anchor NOT found in any module (${minHits}/${literals.length} literals required) — target will fail-closed at runtime`;
    }
    out.push({ target: name, status, modules, literals: literals.length, minHits, note });
  }
  return out;
}

/**
 * @param {TargetVerification[]} verifications
 * @returns {string}
 */
export function formatVerifications(verifications) {
  const out = [];
  const pass = verifications.filter((v) => v.status === "pass");
  const amb = verifications.filter((v) => v.status === "ambiguous");
  const fail = verifications.filter((v) => v.status === "fail");
  out.push(`target verification: ${pass.length} pass, ${amb.length} ambiguous, ${fail.length} fail (of ${verifications.length})`);
  for (const v of verifications) {
    const tag = v.status === "pass" ? "OK " : v.status === "ambiguous" ? "?? " : "XX ";
    out.push(`  ${tag}${v.target} -> ${v.modules.length ? v.modules.join(",") : "(none)"}  ${v.note}`);
  }
  if (fail.length) out.push("\n==> FAIL: one or more carried-forward targets no longer resolve. Re-curate");
  else if (amb.length) out.push("\n==> AMBIGUOUS: tighten the affected anchors (add a more distinctive literal) before promoting.");
  else if (verifications.length === 0) out.push("\n==> 0 targets checked (map has no targets section). If this is a regen, the carry-forward FAILED — do NOT treat this as green.");
  else out.push("\n==> ALL TARGETS RESOLVE. Safe to carry the targets section forward.");
  return out.join("\n");
}

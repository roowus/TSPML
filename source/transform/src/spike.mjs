// @tspml/transform — M3 de-risk spike
//
// Question: can Babel AST transforms surgically modify the REAL, minified
// PolyTrack 0.6.2 bundle and still emit valid JS? If yes, the JS-Mixin
// transform pipeline (technique [C] in docs/research/fabric-architecture.md)
// is viable for Tier-2 ops (docs/design/hook-system.md).
//
// Three concrete mixin operations are demonstrated on REAL targets in the
// cached 0.6.2 main bundle, each validated: parse-ok, injection-present,
// webpack structure intact, size + timing reported.
//
//   (a) `before` / @Inject-HEAD  — inject at the head of Car.controlCar
//   (b) `modifyArg`-equivalent   — rewrite the version:"0.6.2" string literal
//   (c) module-load intercept    — HOF-wrap the Car module's webpack factory
//
// Run:  node src/spike.mjs
// Test: vitest run src/spike.test.mjs

import { readFileSync } from "node:fs";
import * as parser from "@babel/parser";
import _traverse from "@babel/traverse";
import * as t from "@babel/types";
import _generate from "@babel/generator";

// ESM/CJS interop: @babel/traverse + @babel/generator ship as CJS with a
// `default` export; under Node's ESM interop the namespace itself may be the
// function OR expose `.default`. Handle both shapes.
const traverse = /** @type {any} */ (_traverse).default ?? _traverse;
const generate = /** @type {any} */ (_generate).default ?? _generate;

export const BUNDLE_PATH =
  "/Users/rewis/projects/TSPML/tooling/mappings-pipeline/.cache/pt-0.6.2-raw-main.js";

// Markers injected into the bundle — also asserted by the test.
export const MARKERS = Object.freeze({
  head: "[tspml] head-hook fired: controlCar",
  versionSuffix: "-tspml",
  interceptPre: "[tspml] module-load intercept: car-protocol (pre)",
  interceptPost: "[tspml] module-load intercept: car-protocol (post)",
});

const ns = (hrtime) => Number(hrtime) / 1e6; // bigint ns -> ms

/**
 * Parse the bundle with a parser config tuned for big minified webpack output.
 * `sourceType: "unambiguous"` lets Babel auto-detect module vs script (the
 * webpack IIFE is a script at the top level even though inner modules use
 * ESM-ish syntax). `errorRecovery: true` guarantees we still get an AST even
 * if a future bundle trips a parser edge-case — important for robustness.
 */
export function parseBundle(src) {
  return parser.parse(src, {
    sourceType: "unambiguous",
    errorRecovery: true,
    allowReturnOutsideFunction: true,
  });
}

/**
 * Locate the Car physics-protocol module's entry in the webpack module map.
 *
 * SELECTOR STRATEGY (the load-bearing robustness choice):
 *   We do NOT select by webpack module id (5220 here) — ids are UNSTABLE
 *   across builds (the M1 drift spike documented 1223->5220 shifting).
 *   Instead we anchor on the TypeScript-compiled protocol enum, whose
 *   string-literal members ("CreateCar" / "ControlCar" / "TestDeterminism")
 *   survive minification and are globally unique to this module. This is the
 *   same lexical-anchor technique validated at 0.94 precision for the
 *   Car/Physics subsystem in docs/research/mappings-drift-spike.md.
 *
 * Returns the NodePath for the ObjectProperty (key=module id, value=factory).
 */
export function findCarModulePath(ast) {
  let found = null;
  traverse(ast, {
    ObjectProperty(path) {
      if (found) return path.stop();
      const v = path.node.value;
      // A module-map entry is `{ <numericId>: (e,t,n) => {...} }`.
      if (!t.isObjectExpression(path.parent)) return;
      if (!(t.isArrowFunctionExpression(v) || t.isFunctionExpression(v))) return;
      // Count distinctive enum literals inside THIS factory only.
      let hits = 0;
      path.traverse({
        StringLiteral(p) {
          if (
            p.node.value === "CreateCar" ||
            p.node.value === "ControlCar" ||
            p.node.value === "TestDeterminism"
          )
            hits++;
        },
      });
      if (hits >= 3) {
        found = path;
        path.stop();
      }
    },
  });
  return found;
}

/** Count sibling entries in the module map that holds the given property. */
function moduleMapSiblingCount(propPath) {
  const owner = propPath.parent;
  if (!t.isObjectExpression(owner)) return -1;
  return owner.properties.length;
}

/** True if the top-level node is the webpack bootstrap IIFE `(()=>{...})()`. */
function isIIFE(ast) {
  const stmt = ast.program.body[0];
  if (!t.isExpressionStatement(stmt)) return false;
  const call = stmt.expression;
  if (!t.isCallExpression(call)) return false;
  return (
    t.isArrowFunctionExpression(call.callee) ||
    t.isFunctionExpression(call.callee)
  );
}

/**
 * Apply all three mixin ops to a FRESH ast (call on a newly-parsed tree each
 * time so the spike and the test are independent). Returns a structured
 * result describing what happened — never throws on success.
 */
export function applyMixins(ast) {
  const report = {
    carModuleId: null,
    ops: {
      a: { name: "before/@Inject-HEAD", applied: false, target: null },
      b: { name: "modifyArg/literal-rewrite", applied: false, target: null, old: null, new: null },
      c: { name: "module-load intercept (HOF wrap)", applied: false, target: null },
    },
  };

  const carPropPath = findCarModulePath(ast);
  if (!carPropPath) {
    throw new Error("Car module not found — enum anchor (CreateCar/ControlCar/TestDeterminism) missing");
  }
  const keyNode = carPropPath.node.key;
  report.carModuleId = t.isNumericLiteral(keyNode) ? keyNode.value : String(keyNode.value ?? keyNode.name ?? "?");

  // ---- (a) before / @Inject-HEAD on Car.controlCar ------------------------
  // Secondary anchor: the CLASS METHOD NAME. Method names survive minification
  // here (controlCar has 5 occurrences, all in the car subsystem) because
  // terser preserves object/class member names. We scope the search to the
  // car module so common names can't collide.
  let headInjected = false;
  const maybeInject = (path) => {
    if (headInjected) return;
    const k = path.node.key;
    const name = t.isIdentifier(k) ? k.name : t.isStringLiteral(k) ? k.value : null;
    if (name !== "controlCar") return;
    path.get("body").unshiftContainer(
      "body",
      t.expressionStatement(
        t.callExpression(
          t.memberExpression(t.identifier("console"), t.identifier("log")),
          [t.stringLiteral(MARKERS.head)],
        ),
      ),
    );
    headInjected = true;
    report.ops.a.applied = true;
    report.ops.a.target = `ClassMethod#${name}`;
    path.stop();
  };
  carPropPath.traverse({
    ClassMethod: maybeInject,
    ObjectMethod: maybeInject,
  });

  // ---- (b) modifyArg-equivalent / literal rewrite -------------------------
  // Structural selector: an ObjectProperty whose key is `version` and whose
  // value is a StringLiteral — scoped to the car module. We deliberately do
  // NOT match the literal VALUE "0.6.2" (it changes every release); the
  // property-name anchor is stable across versions.
  let literalRewritten = false;
  carPropPath.traverse({
    ObjectProperty(path) {
      if (literalRewritten) return;
      const k = path.node.key;
      const name = t.isIdentifier(k) ? k.name : t.isStringLiteral(k) ? k.value : null;
      if (name !== "version") return;
      if (!t.isStringLiteral(path.node.value)) return;
      const before = path.node.value.value;
      // Avoid double-applying if the value already carries our suffix.
      if (before.endsWith(MARKERS.versionSuffix)) {
        literalRewritten = true;
        return;
      }
      path.node.value = t.stringLiteral(before + MARKERS.versionSuffix);
      report.ops.b.old = before;
      report.ops.b.new = path.node.value.value;
      literalRewritten = true;
      report.ops.b.applied = true;
      report.ops.b.target = `ObjectProperty#version (StringLiteral)`;
    },
  });

  // ---- (c) module-load interception (technique [B]) -----------------------
  // Wrap the Car module's webpack factory in a higher-order arrow that logs
  // pre/post and delegates to the original — the analog of wrapping
  // __webpack_require__, but scoped to ONE module id (less fragile than
  // hooking the mangled global require fn). The original factory (already
  // carrying ops (a)+(b)) becomes the inline callee, so all three ops compose.
  const origFactory = carPropPath.node.value;
  if (t.isArrowFunctionExpression(origFactory) || t.isFunctionExpression(origFactory)) {
    // Clone the original param list (webpack passes (module, exports, require)).
    const passthrough = origFactory.params.map((p) => t.cloneNode(p, true));
    const log = (msg) =>
      t.expressionStatement(
        t.callExpression(
          t.memberExpression(t.identifier("console"), t.identifier("log")),
          [t.stringLiteral(msg)],
        ),
      );
    const wrapper = t.arrowFunctionExpression(
      passthrough,
      t.blockStatement([
        log(MARKERS.interceptPre),
        t.variableDeclaration("const", [
          t.variableDeclarator(
            t.identifier("__tspml_r"),
            t.callExpression(origFactory, origFactory.params.map((p) => t.cloneNode(p, true))),
          ),
        ]),
        log(MARKERS.interceptPost),
        t.returnStatement(t.identifier("__tspml_r")),
      ]),
    );
    carPropPath.node.value = wrapper;
    report.ops.c.applied = true;
    report.ops.c.target = `webpack factory for module ${report.carModuleId}`;
  }

  return report;
}

/** End-to-end: read, parse, transform, generate, re-parse, validate. */
export async function runSpike(bundlePath = BUNDLE_PATH) {
  const bytesBefore = readFileSync(bundlePath); // Buffer (raw bytes)
  const src = bytesBefore.toString("utf8");

  const tParse0 = process.hrtime.bigint();
  const ast = parseBundle(src);
  const tParse1 = process.hrtime.bigint();

  // Structure snapshot BEFORE mutation.
  const carBefore = findCarModulePath(ast);
  const moduleMapCountBefore = carBefore ? moduleMapSiblingCount(carBefore) : -1;
  const iifeBefore = isIIFE(ast);
  const parserErrorsOriginal = /** @type {any[]} */ (ast.errors ?? []).slice();

  const tTx0 = process.hrtime.bigint();
  const report = applyMixins(ast);
  const tTx1 = process.hrtime.bigint();

  const tGen0 = process.hrtime.bigint();
  const out = generate(ast, { compact: true }).code;
  const tGen1 = process.hrtime.bigint();

  // (i) re-parse the generated output — MUST be valid JS.
  const tReparse0 = process.hrtime.bigint();
  const ast2 = parseBundle(out);
  const tReparse1 = process.hrtime.bigint();
  const parserErrorsRegenerated = /** @type {any[]} */ (ast2.errors ?? []).slice();

  // (iii) structure intact on the REGENERATED ast.
  const carAfter = findCarModulePath(ast2);
  const moduleMapCountAfter = carAfter ? moduleMapSiblingCount(carAfter) : -1;
  const iifeAfter = isIIFE(ast2);

  // (ii) injection/rewrite present in generated source.
  const present = {
    head: out.includes(MARKERS.head),
    versionSuffix: out.includes(`version:"${report.ops.b.old}${MARKERS.versionSuffix}"`),
    interceptPre: out.includes(MARKERS.interceptPre),
    interceptPost: out.includes(MARKERS.interceptPost),
  };

  const result = {
    bundlePath,
    bytesBefore: bytesBefore.length,
    bytesAfter: Buffer.byteLength(out, "utf8"),
    charLenBefore: src.length,
    charLenAfter: out.length,
    timingMs: {
      parse: ns(tParse1 - tParse0),
      transform: ns(tTx1 - tTx0),
      generate: ns(tGen1 - tGen0),
      reparse: ns(tReparse1 - tReparse0),
    },
    parseOk: {
      original: parserErrorsOriginal.length === 0,
      regenerated: parserErrorsRegenerated.length === 0,
      originalErrorCount: parserErrorsOriginal.length,
      regeneratedErrorCount: parserErrorsRegenerated.length,
    },
    ops: report.ops,
    carModuleId: report.carModuleId,
    present,
    structure: {
      iifeBefore,
      iifeAfter,
      moduleMapCountBefore,
      moduleMapCountAfter,
      moduleMapCountEqual: moduleMapCountBefore === moduleMapCountAfter,
    },
  };
  return result;
}

// --- CLI entry ---------------------------------------------------------------
const isMain = (() => {
  try {
    return import.meta.url === `file://${process.argv[1]}`;
  } catch {
    return false;
  }
})();

if (isMain) {
  runSpike()
    .then((r) => {
      console.log("=".repeat(72));
      console.log("TSPML M3 de-risk spike — Babel AST transform on REAL 0.6.2 bundle");
      console.log("=".repeat(72));
      console.log(`bundle:                  ${r.bundlePath}`);
      console.log(`car module id located:    ${r.carModuleId}  (selected by enum anchor, NOT by id)`);
      console.log(`bytes before / after:     ${r.bytesBefore} -> ${r.bytesAfter}  (delta ${r.bytesAfter - r.bytesBefore >= 0 ? "+" : ""}${r.bytesAfter - r.bytesBefore})`);
      console.log(`chars before / after:     ${r.charLenBefore} -> ${r.charLenAfter}`);
      console.log("");
      console.log("timing (ms):");
      console.log(`  parse original          ${r.timingMs.parse.toFixed(1)}`);
      console.log(`  transform (3 ops)       ${r.timingMs.transform.toFixed(2)}`);
      console.log(`  generate                ${r.timingMs.generate.toFixed(1)}`);
      console.log(`  re-parse regenerated    ${r.timingMs.reparse.toFixed(1)}`);
      console.log("");
      console.log("parse-ok:");
      console.log(`  original   errors=${r.parseOk.originalErrorCount}   ok=${r.parseOk.original}`);
      console.log(`  regenerated errors=${r.parseOk.regeneratedErrorCount}   ok=${r.parseOk.regenerated}`);
      console.log("");
      console.log("operations applied:");
      for (const [k, op] of Object.entries(r.ops)) {
        console.log(`  (${k}) ${op.name.padEnd(34)} applied=${op.applied}  target=${op.target}${op.new ? `  ('${op.old}' -> '${op.new}')` : ""}`);
      }
      console.log("");
      console.log("injection present in generated source:");
      for (const [k, v] of Object.entries(r.present)) console.log(`  ${k.padEnd(14)} ${v}`);
      console.log("");
      console.log("webpack structure intact:");
      console.log(`  IIFE preserved          before=${r.structure.iifeBefore} after=${r.structure.iifeAfter}`);
      console.log(`  module-map entries      before=${r.structure.moduleMapCountBefore} after=${r.structure.moduleMapCountAfter}  equal=${r.structure.moduleMapCountEqual}`);
      console.log("");
      const verdict =
        r.parseOk.original &&
        r.parseOk.regenerated &&
        r.ops.a.applied &&
        r.ops.b.applied &&
        r.ops.c.applied &&
        r.present.head &&
        r.present.versionSuffix &&
        r.present.interceptPre &&
        r.present.interceptPost &&
        r.structure.iifeAfter &&
        r.structure.moduleMapCountEqual
          ? "VIABLE — all 3 mixin ops produced valid JS on the real 0.6.2 bundle; webpack structure intact."
          : "PARTIAL — see flags above.";
      console.log("VERDICT: " + verdict);
      console.log("=".repeat(72));
      if (!r.parseOk.regenerated) process.exitCode = 1;
    })
    .catch((e) => {
      console.error("spike failed:", e);
      process.exitCode = 1;
    });
}

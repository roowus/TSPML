/**
 * CI-runnable tests for the @tspml/transform pipeline.
 *
 * Run:  pnpm --filter @tspml/transform test
 *
 * Uses the SYNTHETIC webpack fixture (`./fixtures.ts`) so the suite runs
 * everywhere without the gitignored 1.78 MB real bundle. The real-bundle
 * integration test (`../src/spike.test.mjs`) still skips on CI and validates the
 * identical ops against PolyTrack 0.6.2 directly.
 *
 * Gates asserted (mirrors the spike's four validation gates):
 *   (i)   regenerated output re-parses with 0 errors   -> result.outputValid
 *   (ii)  each op's effect is present in generated code
 *   (iii) webpack structure intact (IIFE + module-map entry count)
 *   (iv)  a source map is emitted; a not-found target is reported, not thrown;
 *         fail-closed on hash mismatch; replace is single-winner.
 */
import { describe, expect, it } from "vitest";

import { transform } from "../src/index.js";
import { findModulePath } from "../src/locators.js";
// Internal babel helpers (parse/traverse/t) — fine to reach into from tests.
import { parse, traverse, t } from "../src/babel.js";
import {
  CAR_ANCHOR,
  CAR_CONTROL_CAR,
  CAR_FACTORY,
  CAR_VERSION,
  HASH_LIVE,
  HASH_OTHER,
  SYNTHETIC_BUNDLE,
} from "./fixtures.js";

/** Count entries in the webpack module map (an ObjectExpression of factories). */
function countModuleMapEntries(src: string): number {
  const ast = parse(src, {
    sourceType: "unambiguous",
    errorRecovery: true,
    allowReturnOutsideFunction: true,
  });
  let count = 0;
  traverse(ast, {
    ObjectExpression(p) {
      const props = p.node.properties;
      if (
        props.length > 0 &&
        props.every(
          (prop) =>
            t.isObjectProperty(prop) &&
            (t.isArrowFunctionExpression(prop.value) || t.isFunctionExpression(prop.value)),
        )
      ) {
        count = Math.max(count, props.length);
      }
    },
  });
  return count;
}

/** True if `src` is a webpack bootstrap IIFE `(()=>{...})()`. */
function isIIFE(src: string): boolean {
  const ast = parse(src, {
    sourceType: "unambiguous",
    errorRecovery: true,
    allowReturnOutsideFunction: true,
  });
  const stmt = ast.program.body[0];
  if (!stmt || !t.isExpressionStatement(stmt)) return false;
  const call = stmt.expression;
  return (
    t.isCallExpression(call) &&
    (t.isArrowFunctionExpression(call.callee) || t.isFunctionExpression(call.callee))
  );
}

describe("locators — module anchor (generalized findCarModulePath)", () => {
  it("locates the Car module by enum anchor (not webpack id)", () => {
    const ast = parse(SYNTHETIC_BUNDLE, {
      sourceType: "unambiguous",
      errorRecovery: true,
      allowReturnOutsideFunction: true,
    });
    const path = findModulePath(ast, { literals: [...CAR_ANCHOR] });
    expect(path).not.toBeNull();
    const key = (path!.node as t.ObjectProperty).key;
    // The car module is id 5220 in the fixture, but tests must not PIN the id
    // (it drifts on the real bundle) — assert we found a numeric id, not which.
    expect(t.isNumericLiteral(key)).toBe(true);
    expect((key as t.NumericLiteral).value).toBe(5220);
  });

  it("returns null when the anchor is absent (no throw)", () => {
    const ast = parse(SYNTHETIC_BUNDLE, {
      sourceType: "unambiguous",
      errorRecovery: true,
      allowReturnOutsideFunction: true,
    });
    const path = findModulePath(ast, { literals: ["DoesNotExist", "Nope"] });
    expect(path).toBeNull();
  });
});

describe("ops — before / @Inject(HEAD)", () => {
  it("injects at the head of Car.controlCar and keeps structure intact", () => {
    const r = transform(SYNTHETIC_BUNDLE, [
      { op: "before", target: CAR_CONTROL_CAR, inject: 'console.log("[mod] head");' },
    ]);
    expect(r.failed).toEqual([]);
    expect(r.applied).toHaveLength(1);
    expect(r.code).toContain("[mod] head");
    // (i) re-parses clean
    expect(r.outputValid).toBe(true);
    expect(r.parseErrorCount).toBe(0);
    // (iii) webpack structure intact
    expect(isIIFE(r.code)).toBe(true);
    expect(countModuleMapEntries(r.code)).toBe(countModuleMapEntries(SYNTHETIC_BUNDLE));
    // (iv) a source map was emitted
    expect(r.map).not.toBeNull();
    const map = JSON.parse(r.map!);
    expect(map.version).toBe(3);
  });
});

describe("ops — after / @Inject(RETURN)", () => {
  it("injects before the return statement", () => {
    const r = transform(SYNTHETIC_BUNDLE, [
      { op: "after", target: CAR_CONTROL_CAR, inject: 'console.log("[mod] return");' },
    ]);
    expect(r.applied).toHaveLength(1);
    expect(r.outputValid).toBe(true);
    expect(r.code).toContain("[mod] return");
    // The inject must precede the return: the substring order proves it landed
    // before `return force`, not after the method.
    const idxLog = r.code.indexOf("[mod] return");
    const idxRet = r.code.indexOf("return force");
    expect(idxLog).toBeGreaterThan(-1);
    expect(idxRet).toBeGreaterThan(-1);
    expect(idxLog).toBeLessThan(idxRet);
  });

  it("appends at the end when the method has no explicit return", () => {
    // Car.reset() has no return statement -> `after` injects at the body's end.
    const r = transform(SYNTHETIC_BUNDLE, [
      {
        op: "after",
        target: { anchor: { literals: [...CAR_ANCHOR] }, selector: { kind: "method", name: "reset" } },
        inject: 'console.log("[mod] af-end");',
      },
    ]);
    expect(r.applied).toHaveLength(1);
    expect(r.outputValid).toBe(true);
    expect(r.code).toContain("[mod] af-end");
    // reset's body is `this.state = 0;` — the inject must come AFTER it.
    const idxState = r.code.indexOf("this.state = 0");
    const idxLog = r.code.indexOf("[mod] af-end");
    expect(idxState).toBeGreaterThan(-1);
    expect(idxLog).toBeGreaterThan(idxState);
  });
});

describe("ops — around (wrap with proceed)", () => {
  it("wraps controlCar, binding the original body to `proceed`", () => {
    const r = transform(SYNTHETIC_BUNDLE, [
      { op: "around", target: CAR_CONTROL_CAR, inject: "return proceed(input);" },
    ]);
    expect(r.applied).toHaveLength(1);
    expect(r.outputValid).toBe(true);
    expect(r.code).toMatch(/const\s+proceed\s*=/);
    expect(r.code).toContain("return proceed(input)");
    // Original body is preserved inside proceed's arrow.
    expect(r.code).toContain("applyForce(input, 9.8)");
  });
});

describe("ops — replace / @Overwrite (single-winner)", () => {
  it("overwrites the controlCar body", () => {
    const r = transform(SYNTHETIC_BUNDLE, [
      { op: "replace", target: CAR_CONTROL_CAR, inject: "return 42;" },
    ]);
    expect(r.applied).toHaveLength(1);
    expect(r.outputValid).toBe(true);
    expect(r.code).toContain("return 42");
  });
});

describe("ops — modifyArg / @ModifyArg", () => {
  it("changes argument index 1 of the applyForce call within controlCar", () => {
    const r = transform(SYNTHETIC_BUNDLE, [
      {
        op: "modifyArg",
        target: CAR_CONTROL_CAR,
        callee: "applyForce",
        index: 1,
        replaceWith: "10",
      },
    ]);
    expect(r.applied).toHaveLength(1);
    expect(r.outputValid).toBe(true);
    // The only `9.8` in the bundle was applyForce's 2nd arg in controlCar.
    expect(r.code).not.toContain("9.8");
    expect(r.code).toContain("applyForce(input, 10)");
  });
});

describe("ops — modifyReturn", () => {
  it("wraps the return value of controlCar", () => {
    const r = transform(SYNTHETIC_BUNDLE, [
      { op: "modifyReturn", target: CAR_CONTROL_CAR, wrap: "(v) => v * 2" },
    ]);
    expect(r.applied).toHaveLength(1);
    expect(r.outputValid).toBe(true);
    // `return force;` -> `return ((v) => v * 2)(force);`
    expect(r.code).toMatch(/\*\s*2/);
    expect(r.code).toContain("(force)");
  });
});

describe("ops — modifyConstant / @ModifyConstant (spike op b)", () => {
  it("rewrites the Car module's `version` property value (by KEY)", () => {
    const r = transform(SYNTHETIC_BUNDLE, [
      { op: "modifyConstant", target: CAR_VERSION, replaceWith: '"0.6.2-tspml"' },
    ]);
    expect(r.applied).toHaveLength(1);
    expect(r.outputValid).toBe(true);
    expect(r.code).toMatch(/version:\s*"0\.6\.2-tspml"/);
  });

  it("does NOT touch the sibling module's identically-named property (module scoping)", () => {
    const r = transform(SYNTHETIC_BUNDLE, [
      { op: "modifyConstant", target: CAR_VERSION, replaceWith: '"0.6.2-tspml"' },
    ]);
    expect(r.applied).toHaveLength(1);
    // module 7331's `meta.version` stays exactly "0.6.2" (closing quote, so it
    // does NOT match the "-tspml" value substring).
    expect(r.code).toMatch(/version:\s*"0\.6\.2"/);
    // And exactly one property was rewritten to the -tspml value.
    const rewritten = (r.code.match(/version:\s*"0\.6\.2-tspml"/g) ?? []).length;
    expect(rewritten).toBe(1);
  });
});

describe("ops — around on the webpack factory (module-load intercept, spike op c)", () => {
  it("wraps the Car factory, binding the original factory to proceed", () => {
    const r = transform(SYNTHETIC_BUNDLE, [
      {
        op: "around",
        target: CAR_FACTORY,
        inject:
          'console.log("[mod] pre-load"); const __r = proceed(module, exports, __webpack_require__); console.log("[mod] post-load"); return __r;',
      },
    ]);
    expect(r.applied).toHaveLength(1);
    expect(r.outputValid).toBe(true);
    expect(r.code).toContain("[mod] pre-load");
    expect(r.code).toContain("[mod] post-load");
    // The original factory body (the enum anchor) is preserved inside proceed.
    expect(r.code).toContain("CreateCar");
  });
});

describe("engine — not-found is reported, not thrown", () => {
  it("records a missing method target in `failed` with reason not-found", () => {
    const r = transform(SYNTHETIC_BUNDLE, [
      {
        op: "before",
        target: { anchor: { literals: [...CAR_ANCHOR] }, selector: { kind: "method", name: "noSuchMethod" } },
        inject: 'console.log("x");',
      },
    ]);
    expect(r.applied).toEqual([]);
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0]!.reason).toBe("not-found");
    expect(r.failed[0]!.detail).toContain("noSuchMethod");
    expect(r.outputValid).toBe(true);
  });

  it("records a missing module (bad anchor) in `failed`", () => {
    const r = transform(SYNTHETIC_BUNDLE, [
      {
        op: "before",
        target: {
          anchor: { literals: ["Nope", "AlsoNope"] },
          selector: { kind: "method", name: "controlCar" },
        },
        inject: 'console.log("x");',
      },
    ]);
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0]!.reason).toBe("not-found");
    expect(r.failed[0]!.detail).toContain("module not found");
  });

  it("reports a bad inject source (parse error) instead of throwing", () => {
    const r = transform(SYNTHETIC_BUNDLE, [
      { op: "before", target: CAR_CONTROL_CAR, inject: "this is not : valid js (" },
    ]);
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0]!.reason).toBe("bad-inject-source");
    // Other patches / the bundle are unaffected.
    expect(r.outputValid).toBe(true);
  });
});

describe("engine — fail-closed on bundle hash mismatch", () => {
  it("refuses to apply anything when bundleHash != expectedBundleHash", () => {
    const r = transform(
      SYNTHETIC_BUNDLE,
      [{ op: "before", target: CAR_CONTROL_CAR, inject: 'console.log("x");' }],
      { bundleHash: HASH_LIVE, expectedBundleHash: HASH_OTHER },
    );
    expect(r.failedReason).toBe("hash-mismatch");
    expect(r.applied).toEqual([]);
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0]!.reason).toBe("hash-mismatch");
    // Original source returned verbatim, untouched.
    expect(r.code).toBe(SYNTHETIC_BUNDLE);
    expect(r.map).toBeNull();
  });

  it("is case- and prefix-insensitive (mirrors the resolver normalizeHash)", () => {
    const r = transform(
      SYNTHETIC_BUNDLE,
      [{ op: "before", target: CAR_CONTROL_CAR, inject: 'console.log("ok");' }],
      { bundleHash: HASH_LIVE.toUpperCase(), expectedBundleHash: "SHA-256:" + "A".repeat(64) },
    );
    expect(r.failedReason).toBeUndefined();
    expect(r.applied).toHaveLength(1);
  });

  it("applies normally when hashes match", () => {
    const r = transform(
      SYNTHETIC_BUNDLE,
      [{ op: "before", target: CAR_CONTROL_CAR, inject: 'console.log("ok");' }],
      { bundleHash: HASH_LIVE, expectedBundleHash: HASH_LIVE },
    );
    expect(r.failedReason).toBeUndefined();
    expect(r.applied).toHaveLength(1);
    expect(r.outputValid).toBe(true);
  });

  it("does not fail-closed when no expected hash is provided (caller vouches)", () => {
    const r = transform(
      SYNTHETIC_BUNDLE,
      [{ op: "before", target: CAR_CONTROL_CAR, inject: 'console.log("ok");' }],
      { bundleHash: HASH_LIVE },
    );
    expect(r.failedReason).toBeUndefined();
    expect(r.applied).toHaveLength(1);
  });
});

describe("engine — replace is single-winner (load-time conflict)", () => {
  it("two replaces on the same target both fail with a conflict error", () => {
    const r = transform(SYNTHETIC_BUNDLE, [
      { op: "replace", target: CAR_CONTROL_CAR, inject: "return 1;" },
      { op: "replace", target: CAR_CONTROL_CAR, inject: "return 2;" },
    ]);
    expect(r.applied).toEqual([]);
    expect(r.failed).toHaveLength(2);
    expect(r.failed.every((f) => f.reason === "conflict-replace-single-winner")).toBe(true);
    expect(r.outputValid).toBe(true);
  });

  it("replace + before on the same target compose (before is not a conflict)", () => {
    const r = transform(SYNTHETIC_BUNDLE, [
      { op: "replace", target: CAR_CONTROL_CAR, inject: "return 1;" },
      { op: "before", target: CAR_CONTROL_CAR, inject: 'console.log("hi");' },
    ]);
    // NOTE: ordering matters — replace overwrites the body, so if `before` runs
    // first it injects into the soon-to-be-discarded body. The engine applies in
    // array order; both succeed structurally here.
    expect(r.applied).toHaveLength(2);
    expect(r.failed).toEqual([]);
    expect(r.outputValid).toBe(true);
  });
});

describe("engine — composition + output integrity", () => {
  it("composes all ops on the same module in one pass", () => {
    const r = transform(SYNTHETIC_BUNDLE, [
      { op: "before", target: CAR_CONTROL_CAR, inject: 'console.log("a");' },
      { op: "modifyConstant", target: CAR_VERSION, replaceWith: '"0.6.2-tspml"' },
      {
        op: "modifyArg",
        target: CAR_CONTROL_CAR,
        callee: "applyForce",
        index: 1,
        replaceWith: "10",
      },
    ]);
    expect(r.failed).toEqual([]);
    expect(r.applied).toHaveLength(3);
    expect(r.outputValid).toBe(true);
    expect(r.code).toContain('"a"');
    expect(r.code).toContain("0.6.2-tspml");
    expect(r.code).not.toContain("9.8");
    // (iii) structure intact under composition
    expect(isIIFE(r.code)).toBe(true);
    expect(countModuleMapEntries(r.code)).toBe(countModuleMapEntries(SYNTHETIC_BUNDLE));
  });

  it("emits a source map keyed to the provided filename", () => {
    const r = transform(
      SYNTHETIC_BUNDLE,
      [{ op: "before", target: CAR_CONTROL_CAR, inject: 'console.log("x");' }],
      { filename: "polytrack-0.6.2.js" },
    );
    expect(r.map).not.toBeNull();
    const map = JSON.parse(r.map!);
    expect(map.version).toBe(3);
    expect(map.sources).toContain("polytrack-0.6.2.js");
  });

  it("no-op round-trip (zero patches) preserves structure and re-parses", () => {
    const r = transform(SYNTHETIC_BUNDLE, []);
    expect(r.applied).toEqual([]);
    expect(r.failed).toEqual([]);
    expect(r.outputValid).toBe(true);
    expect(isIIFE(r.code)).toBe(true);
    expect(countModuleMapEntries(r.code)).toBe(countModuleMapEntries(SYNTHETIC_BUNDLE));
  });
});

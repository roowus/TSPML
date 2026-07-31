// CI-runnable validators for the M3 de-risk spike.
// Run:  vitest run src/spike.test.mjs   (or: pnpm test)
//
// These tests assert the four validation gates from the spike brief on the
// REAL 0.6.2 bundle:
//   (i)   regenerated output re-parses with 0 errors
//   (ii)  each injection/rewrite is present in the generated source
//   (iii) webpack structure is intact (IIFE + module-map entry count)
//   (iv)  size + timing are reported (finite numbers)

import { existsSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { runSpike, MARKERS, BUNDLE_PATH } from "./spike.mjs";

// The spike validates against the REAL (gitignored, machine-local) 0.6.2 bundle
// in the mappings-pipeline cache. It is absent on CI, so the suite skips there
// and runs fully locally. (The transform pipeline built on top of this will
// have fixture-based unit tests that DO run on CI.)
describe.skipIf(!existsSync(BUNDLE_PATH))(
  "M3 de-risk spike on real PolyTrack 0.6.2 bundle (skips when the cached real bundle is absent, e.g. on CI)",
  () => {
  // runSpike does a full read -> parse -> transform -> generate -> re-parse.
  it("locates the Car module by enum anchor (not by webpack id)", async () => {
    const r = await runSpike();
    // The car module is whatever id holds the CreateCar/ControlCar enum.
    // We assert we FOUND it; we deliberately do NOT pin the id (it drifts).
    expect(r.carModuleId).toBeTruthy();
    expect(typeof r.carModuleId).toMatch(/^(number|string)$/);
  });

  it("(a) before/@Inject-HEAD injects at the head of Car.controlCar", async () => {
    const r = await runSpike();
    expect(r.ops.a.applied).toBe(true);
    expect(r.ops.a.target).toContain("controlCar");
    expect(r.present.head).toBe(true); // MARKERS.head substring present in output
  });

  it("(b) modifyArg/literal-rewrite edits the version string literal", async () => {
    const r = await runSpike();
    expect(r.ops.b.applied).toBe(true);
    expect(r.ops.b.old).toBe("0.6.2");
    expect(r.ops.b.new).toBe("0.6.2" + MARKERS.versionSuffix);
    expect(r.present.versionSuffix).toBe(true);
  });

  it("(c) module-load intercept HOF-wraps the Car module's factory", async () => {
    const r = await runSpike();
    expect(r.ops.c.applied).toBe(true);
    expect(r.ops.c.target).toContain(String(r.carModuleId));
    expect(r.present.interceptPre).toBe(true);
    expect(r.present.interceptPost).toBe(true);
  });

  it("(i) regenerated bundle re-parses with zero errors", async () => {
    const r = await runSpike();
    expect(r.parseOk.original).toBe(true);
    expect(r.parseOk.regenerated).toBe(true);
    expect(r.parseOk.regeneratedErrorCount).toBe(0);
  });

  it("(iii) webpack structure is intact (IIFE + module-map count)", async () => {
    const r = await runSpike();
    expect(r.structure.iifeBefore).toBe(true);
    expect(r.structure.iifeAfter).toBe(true);
    // 0.6.2 has 211 module-map entries; assert before==after rather than a
    // magic number so the test survives a bundle refresh.
    expect(r.structure.moduleMapCountBefore).toBeGreaterThan(100);
    expect(r.structure.moduleMapCountEqual).toBe(true);
  });

  it("(iv) reports finite bytes-before/after and timings", async () => {
    const r = await runSpike();
    expect(Number.isFinite(r.bytesBefore)).toBe(true);
    expect(Number.isFinite(r.bytesAfter)).toBe(true);
    expect(r.bytesBefore).toBeGreaterThan(1_000_000); // ~1.78 MB
    expect(r.bytesAfter).toBeGreaterThan(r.bytesBefore); // we added code
    for (const k of ["parse", "transform", "generate", "reparse"]) {
      expect(Number.isFinite(r.timingMs[k])).toBe(true);
      expect(r.timingMs[k]).toBeLessThan(20_000); // generous upper bound for CI
    }
  });
});

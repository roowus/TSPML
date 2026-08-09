/**
 * The migrated bridge patches against the REAL (gitignored, machine-local)
 * PolyTrack 0.6.2 bundle — the check no synthetic fixture can perform: that
 * every `__TSPML_PARAM<n>__` ordinal in `bridge-patches.ts` resolves against
 * the actual minified signatures (#24).
 *
 * Skips on CI (the bundle never leaves the developer machine — it must not be
 * committed, cached in CI, or uploaded anywhere). Same skip pattern as the
 * transform package's `spike.test.mjs`. The fixture-based suites in this
 * package are the CI-runnable coverage; this one is the local ground truth.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { transform } from "@tspml/transform";

import { BRIDGE_PATCHES } from "../src/bridge-patches.js";

const BUNDLE_PATH = new URL(
  "../../../tooling/mappings-pipeline/.cache/pt-0.6.2-raw-main.js",
  import.meta.url,
).pathname;

describe.skipIf(!existsSync(BUNDLE_PATH))(
  "bridge patches on the real 0.6.2 bundle (skips when the cached bundle is absent, e.g. on CI)",
  () => {
    // transform() is pure on its inputs; run once, assert many.
    const run = (() => {
      let cached: ReturnType<typeof transform> | null = null;
      return () => (cached ??= transform(readFileSync(BUNDLE_PATH, "utf8"), BRIDGE_PATCHES));
    })();

    it("applies every patch — every placeholder ordinal resolves", () => {
      const r = run();
      expect(r.failed, JSON.stringify(r.failed)).toEqual([]);
      expect(r.applied).toHaveLength(BRIDGE_PATCHES.length);
    }, 120_000);

    it("leaves no placeholder text in the output bundle", () => {
      expect(run().code).not.toContain("__TSPML_PARAM");
    }, 120_000);

    it("regenerates a bundle that re-parses clean", () => {
      const r = run();
      expect(r.outputValid).toBe(true);
      expect(r.parseErrorCount).toBe(0);
    }, 120_000);

    it("substitutes the REAL minified param names into the controlCar emit", () => {
      // controlCar(e,t,n,i,a,s) in the pinned 0.6.2 build. If a future bundle
      // renames them, the emit follows automatically — this assertion pins the
      // CURRENT ground truth so a locator drift is loud.
      const code = run().code;
      const at = code.indexOf('"car.control"');
      expect(at).toBeGreaterThan(-1);
      const emit = code.slice(at, at + 200);
      expect(emit).toContain("carId: e");
      expect(emit).toContain("reset: !!s");
    }, 120_000);
  },
);

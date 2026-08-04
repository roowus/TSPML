/**
 * Regression guard on `regen.mjs`'s subprocess helper.
 *
 * `runNode` used `execFile` with `stdio: "inherit"` — an option `execFile` does not
 * have. Node silently ignored it, so gen-map's report was buffered into a string the
 * callback discarded instead of being printed. That report is the whole point of the
 * step: it is what a maintainer reads to decide whether to promote a candidate map.
 * The failure mode was "the regen is oddly quiet", which reads as normal, so it
 * survived every run and every test. (`execFile` would also have truncated it at the
 * 1 MB default `maxBuffer` had anything ever read it.)
 *
 * Caught by the #25 typecheck, so this test exists to keep it caught if someone
 * "simplifies" back to `execFile` — which accepts and ignores `stdio`, so the revert
 * would be silent again.
 *
 * Two deliberate choices about how this is tested:
 *
 *  1. It imports the REAL `runNode` from `regen.mjs`. A test that re-declared the
 *     spawn shape locally would have passed against the broken version too.
 *  2. It spawns REAL processes rather than mocking `node:child_process`. The bug was
 *     that Node ignored an option we passed; a mock asserting "we passed
 *     stdio: inherit" would also have passed against the broken code. The only
 *     assertion that separates them is that the parent's own fd receives the child's
 *     bytes.
 */
import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REGEN = fileURLToPath(new URL("../scripts/regen.mjs", import.meta.url));

/**
 * Run a driver script and capture ITS pipes. The driver calls regen's `runNode` on a
 * grandchild; inherited stdio means the grandchild writes to the driver's fds, which
 * are the pipes we read here. If the `stdio` option were dropped, the grandchild's
 * bytes would go to a buffer inside the driver and never reach us.
 */
function runCapturing(script) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += String(d)));
    child.stderr.on("data", (d) => (stderr += String(d)));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

/** A driver that imports the real helper out of regen.mjs. */
function driverSource(body) {
  return `import { runNode } from ${JSON.stringify(REGEN)};\n${body}\n`;
}

describe("regen runNode", () => {
  it("passes the child's stdout AND stderr through to the parent", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tspml-runnode-"));
    try {
      const grandchild = join(dir, "grandchild.mjs");
      await writeFile(
        grandchild,
        'console.log("GRANDCHILD_STDOUT");console.error("GRANDCHILD_STDERR");',
      );
      const driver = join(dir, "driver.mjs");
      await writeFile(driver, driverSource(`await runNode(${JSON.stringify(grandchild)}, []);`));

      const r = await runCapturing(driver);
      expect(r.code).toBe(0);
      // The assertion that the old execFile form failed.
      expect(r.stdout).toContain("GRANDCHILD_STDOUT");
      expect(r.stderr).toContain("GRANDCHILD_STDERR");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects on a non-zero child exit, naming the script and the code", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tspml-runnode-fail-"));
    try {
      const grandchild = join(dir, "boom.mjs");
      await writeFile(grandchild, "process.exit(3);");
      const driver = join(dir, "driver.mjs");
      await writeFile(
        driver,
        driverSource(
          `try { await runNode(${JSON.stringify(grandchild)}, []); console.log("RESOLVED"); }
           catch (e) { console.log("REJECTED:" + e.message); }`,
        ),
      );
      const r = await runCapturing(driver);
      expect(r.stdout).toContain("REJECTED:");
      expect(r.stdout).toContain("exited 3");
      expect(r.stdout).not.toContain("RESOLVED");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("forwards extra env to the child without dropping process.env", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tspml-runnode-env-"));
    try {
      const grandchild = join(dir, "env.mjs");
      // PATH stands in for "inherited process.env" — always set, never set by us.
      await writeFile(
        grandchild,
        'console.log("EXTRA=" + process.env.TSPML_TEST_EXTRA + " HASPATH=" + !!process.env.PATH);',
      );
      const driver = join(dir, "driver.mjs");
      await writeFile(
        driver,
        driverSource(
          `await runNode(${JSON.stringify(grandchild)}, [], { TSPML_TEST_EXTRA: "yes" });`,
        ),
      );
      const r = await runCapturing(driver);
      expect(r.stdout).toContain("EXTRA=yes");
      expect(r.stdout).toContain("HASPATH=true");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("importing regen.mjs does not start a regen", async () => {
    // The import guard this test relies on is also a safety property: importing the
    // module must not fetch bundles or write candidate maps.
    const dir = await mkdtemp(join(tmpdir(), "tspml-runnode-import-"));
    try {
      const driver = join(dir, "driver.mjs");
      await writeFile(driver, driverSource('console.log("IMPORTED_CLEANLY");'));
      const r = await runCapturing(driver);
      expect(r.code).toBe(0);
      expect(r.stdout).toContain("IMPORTED_CLEANLY");
      expect(r.stdout).not.toMatch(/regen|fetching|unpack/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("uses spawn, never execFile", async () => {
    const src = await readFile(REGEN, "utf8");
    expect(src).toContain('import { spawn } from "node:child_process"');
    // Strip comments — the explanatory comment names execFile deliberately.
    const code = src
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("*") && !l.trimStart().startsWith("//"))
      .join("\n");
    expect(code).not.toMatch(/execFile\s*\(/);
  });
});

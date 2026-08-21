/**
 * End-to-end guard on `regen.mjs --verify` (#98).
 *
 * The unit tests in verify-targets.test.mjs prove the ROUTING is right. This file
 * proves the CLI wires it up, and it spawns the real script rather than importing a
 * helper for one reason: the thing most likely to break is the exit code, and an exit
 * code only exists in a process. A run that verifies nothing but exits 0 is
 * indistinguishable in CI from a run that verified everything — which is the whole
 * class of failure #98's SKIPPED status was introduced to make visible.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REGEN = fileURLToPath(new URL("../scripts/regen.mjs", import.meta.url));

function run(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [REGEN, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += String(d)));
    child.stderr.on("data", (d) => (stderr += String(d)));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

let root;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "tspml-verifycli-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** A map with one main target and one chunk-scoped target. */
const MAP = {
  formatVersion: 1,
  gameVersion: "0.6.2",
  bundleHash: `sha256:${"a".repeat(64)}`,
  generated: { from: "test", matcher: "test", granularity: "module", note: "" },
  modules: {},
  unresolved: [],
  chunks: { 112: { id: "112", hash: `sha256:${"b".repeat(64)}`, bytes: 10, role: "track editor" } },
  targets: {
    Car: {
      anchor: { literals: ["CreateCar", "ControlCar"], minHits: 2 },
      selector: { kind: "factory" },
    },
    Editor: {
      anchor: { literals: ["How to use the editor"], minHits: 1 },
      selector: { kind: "method", name: "draw" },
      surface: "112.bundle.js",
    },
  },
};

/** Write the map plus a main dir; return their paths. */
async function fixture() {
  const mapPath = join(root, "map.json");
  await writeFile(mapPath, JSON.stringify(MAP));
  const mainDir = join(root, "main");
  await mkdir(mainDir, { recursive: true });
  await writeFile(join(mainDir, "5220.js"), "CreateCar ControlCar");
  return { mapPath, mainDir };
}

async function chunkDir(code = "How to use the editor") {
  const dir = join(root, "chunk112");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "100.js"), code);
  return dir;
}

describe("regen.mjs --verify (#98)", () => {
  it("exits NON-ZERO when a chunk target has no sources, even though everything checked passed", async () => {
    // The headline case. Car resolves; Editor is never looked at. Reporting this as
    // green would promote a map whose editor targets nobody verified.
    const { mapPath, mainDir } = await fixture();
    const r = await run(["--verify", mapPath, mainDir]);
    expect(r.stdout).toContain("1 SKIPPED");
    expect(r.stdout).toContain("INCOMPLETE");
    expect(r.stdout).not.toContain("ALL TARGETS RESOLVE");
    expect(r.code).toBe(1);
  });

  it("exits 0 once the chunk dir is supplied and both surfaces resolve", async () => {
    const { mapPath, mainDir } = await fixture();
    const r = await run(["--verify", mapPath, mainDir, `112=${await chunkDir()}`]);
    expect(r.stdout).toContain("Car [main.bundle.js]");
    expect(r.stdout).toContain("Editor [112.bundle.js]");
    expect(r.stdout).toContain("ALL TARGETS RESOLVE");
    expect(r.code).toBe(0);
  });

  it("fails the chunk target when its anchor is gone from the chunk", async () => {
    const { mapPath, mainDir } = await fixture();
    const r = await run(["--verify", mapPath, mainDir, `112=${await chunkDir("unrelated code")}`]);
    expect(r.stdout).toContain("XX Editor [112.bundle.js]");
    expect(r.code).toBe(1);
  });

  it("rejects a malformed <chunkId>=<dir> argument instead of silently skipping", async () => {
    // A typo'd chunk id would otherwise land the target in SKIPPED, which reads as
    // "you forgot to unpack it" rather than "your command line is wrong".
    const { mapPath, mainDir } = await fixture();
    const r = await run(["--verify", mapPath, mainDir, "/some/path"]);
    expect(r.stderr).toContain("expected <chunkId>=<dir>");
    expect(r.code).toBe(2);
  });
});

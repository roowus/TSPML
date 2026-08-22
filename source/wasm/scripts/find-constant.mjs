#!/usr/bin/env node
// find-constant.mjs — the authoring command for a `physics.json` (#43).
//
// Until this existed, a mod author could not produce a physics patch at all. The
// spec documented `signature` as "…64 hex chars…", the loader validated it, the
// portal applied it, and nothing in the project emitted one: the only deriving code
// was a dev-only script reading a gitignored cache. A capability nobody outside this
// repo can invoke is not shipped.
//
//   node scripts/find-constant.mjs 1.05
//   node scripts/find-constant.mjs 1.05 --emit grip=1.4
//   node scripts/find-constant.mjs -9.81 --wasm ./polytrack_physics.wasm
//
// By default it fetches the live binary from the game's CDN — the same bytes the
// portal proxies, so a plan derived here pins the build a player will actually run.
// `--wasm <path>` reads a local copy instead.
//
// The binary is fetched into memory and never written to disk. TSPML does not
// redistribute PolyTrack, and a tool that left a copy of the game's physics binary
// in the author's working directory would be doing exactly that by accident.
//
// Requires a build first (`pnpm --filter @tspml/wasm build`): the logic lives in
// src/derive.ts and this script imports the compiled package, so that one
// implementation is what both the portal and this command run.
import { readFile } from "node:fs/promises";

import { findConstant, toPhysicsJson } from "../dist/index.js";

const DEFAULT_VERSION = "0.6.2";
const DEFAULT_FILE = "polytrack_physics.wasm";

const USAGE = `Usage: find-constant <value> [options]

  <value>                the f32 constant to look for, e.g. 1.05 or -9.81

Options:
  --wasm <path>          read a local binary instead of fetching the live one
  --version <ver>        game version to fetch (default ${DEFAULT_VERSION})
  --emit <name>=<value>  print a ready-to-paste physics.json for the single
                         patchable candidate, renaming the constant <name> and
                         setting it to <value>
  -h, --help             this text

Examples:
  find-constant 1.05
  find-constant 1.05 --emit grip=1.4
  find-constant -9.81 --wasm ./polytrack_physics.wasm
`;

function parseArgs(argv) {
  const opts = { value: null, wasm: null, version: DEFAULT_VERSION, emit: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") return { help: true };
    else if (a === "--wasm") opts.wasm = argv[++i] ?? null;
    else if (a === "--version") opts.version = argv[++i] ?? DEFAULT_VERSION;
    else if (a === "--emit") opts.emit = argv[++i] ?? null;
    // A negative constant is the ordinary case (gravity is the first thing anyone
    // searches for), so a leading '-' cannot by itself mean "option". Anything that
    // parses as a finite number is a value; '-h' and '--wat' still do not.
    else if (a.startsWith("-") && !Number.isFinite(Number(a)))
      return { error: `unknown option '${a}'` };
    else if (opts.value === null) opts.value = a;
    else return { error: `unexpected argument '${a}'` };
  }
  if (opts.value === null) return { error: "a value to search for is required" };
  const n = Number(opts.value);
  if (!Number.isFinite(n)) return { error: `'${opts.value}' is not a finite number` };
  opts.value = n;
  if (opts.emit !== null) {
    // `name=value`, split at the LAST '=' so a name containing one still works.
    const at = opts.emit.lastIndexOf("=");
    if (at <= 0) return { error: "--emit takes <name>=<value>, e.g. --emit grip=1.4" };
    const newValue = Number(opts.emit.slice(at + 1));
    if (!Number.isFinite(newValue)) return { error: "--emit's value must be a finite number" };
    opts.emit = { name: opts.emit.slice(0, at), newValue };
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
if (opts.help) {
  console.log(USAGE);
  process.exit(0);
}
if (opts.error) {
  console.error(`${opts.error}\n\n${USAGE}`);
  process.exit(1);
}

let bytes;
if (opts.wasm !== null) {
  bytes = new Uint8Array(await readFile(opts.wasm));
  console.error(`read ${opts.wasm} (${bytes.length} bytes)`);
} else {
  const url = `https://app-polytrack.kodub.com/${opts.version}/${DEFAULT_FILE}`;
  console.error(`fetching ${url}`);
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`fetch failed: HTTP ${res.status}. Is ${opts.version} a real version?`);
    process.exit(1);
  }
  bytes = new Uint8Array(await res.arrayBuffer());
  console.error(`  ${bytes.length} bytes`);
}

// Under `--emit` the physics.json is the product and STDOUT belongs to it alone, so
// `--emit … > physics.json` writes a valid file; the listing becomes context and
// moves to stderr. Without `--emit` the listing IS the product and stays on stdout.
const report = opts.emit === null ? console.log : console.error;

const found = findConstant(bytes, opts.value);
console.error(`binary sha256: ${found.wasmHash}`);
console.error(`searching for f32 ${found.searched}\n`);

if (found.candidates.length === 0) {
  // Deliberately not an error exit dressed up as advice: "not found" is a real and
  // common answer, and the f32 caveat is the reason it is usually wrong to trust.
  report("No occurrences.");
  report("\nThe binary stores f32, so a value that looks right may be stored slightly");
  report("differently. Try neighbouring values, or search for a rounder constant");
  report("nearby and work outwards.");
  process.exit(1);
}

const patchable = found.candidates.filter((c) => c.patchable);
report(
  `${found.candidates.length} occurrence${found.candidates.length === 1 ? "" : "s"}, ` +
    `${patchable.length} patchable:\n`,
);
for (const [i, c] of found.candidates.entries()) {
  const mark = c.patchable ? "✓" : "✗";
  report(`${mark} [${i}] function ${c.functionIndex} — value ${c.value}`);
  report(`      signature ${c.signature}`);
  report(
    `      ${c.constantsInFunction} f32 constant${c.constantsInFunction === 1 ? "" : "s"} in this function` +
      `, payload at 0x${c.payloadOffset.toString(16)}`,
  );
  if (!c.patchable) {
    // Say what the writer would say, and what to do about it. A refusal an author
    // cannot act on is just as opaque as no message at all.
    report(
      c.verdict === "ambiguous-function"
        ? "      REFUSED: this function's fingerprint matches more than one function,\n" +
            "               so no signature can name it. Pick a different constant in a\n" +
            "               function that is structurally distinct."
        : "      REFUSED: this value occurs more than once inside its own function, so\n" +
            "               oldValue cannot say which site is meant. Pick a constant that\n" +
            "               occurs once.",
    );
  }
  report("");
}

// This tool never picks. Which constant governs grip is a question about the game's
// physics, and nothing in this repo can answer it — reporting every hit and refusing
// to rank them is the honest behaviour, not a missing feature.
if (opts.emit === null) {
  console.log("Re-run with --emit <name>=<value> to print a physics.json for a");
  console.log("single patchable candidate.");
  process.exit(0);
}

if (patchable.length === 0) {
  console.error("Nothing to emit: no candidate is patchable (see the refusals above).");
  process.exit(1);
}
if (patchable.length > 1) {
  console.error(
    `Refusing to emit: ${patchable.length} candidates are patchable and choosing between\n` +
      "them is a question about the game's physics, not about this binary. Identify the\n" +
      "one you want (its function index is printed above) and write the physics.json by\n" +
      "hand from its signature.",
  );
  process.exit(1);
}

const r = toPhysicsJson(found.wasmHash, opts.emit.name, patchable[0], opts.emit.newValue);
if (!r.ok) {
  console.error(`Refused: ${r.reason}`);
  process.exit(1);
}
console.error("physics.json:\n");
process.stdout.write(r.json);

// Unpack a webpack bundle into per-module files using webcrack's programmatic API.
// Usage: node src/unpack.mjs <bundle.js> <outdir>
//
// Why programmatic (not the CLI): webcrack@2.x declares engines
// `>=22 <23 || >=24 <25`, and TSPML pins Node 25. That range is an npm-packaging
// constraint, not a runtime one — the library itself runs fine on 25. But
// `npx webcrack` exits 1 having written nothing, after only an `npm warn
// EBADENGINE` that never names webcrack, so it reads as a silent no-op with an
// empty output dir. Calling the API sidesteps npm entirely. See the README (#5).
import { readFile, mkdir, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { webcrack } from "webcrack";
import { sandboxOptions } from "./sandbox.mjs";

async function countJs(dir) {
  let n = 0;
  let bytes = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      const r = await countJs(p);
      n += r.n;
      bytes += r.bytes;
    } else if (entry.name.endsWith(".js")) {
      n += 1;
      bytes += (await stat(p)).size;
    }
  }
  return { n, bytes };
}

const input = process.argv[2];
const outDir = process.argv[3];
if (!input || !outDir) {
  console.error("usage: node src/unpack.mjs <bundle.js> <outdir>");
  process.exit(2);
}

const code = await readFile(input, "utf8");
process.stderr.write(`webcrack: ${input} (${code.length} bytes) -> ${outDir}\n`);

const t0 = Date.now();
const result = await webcrack(code, sandboxOptions());
await mkdir(outDir, { recursive: true });
await result.save(outDir);
const { n, bytes } = await countJs(outDir);

console.log(JSON.stringify({ input, outDir, modules: n, bytes, ms: Date.now() - t0 }));

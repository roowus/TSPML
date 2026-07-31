// Unpack a webpack bundle into per-module files using webcrack's programmatic API.
// Usage: node src/unpack.mjs <bundle.js> <outdir>
//
// Why programmatic (not the CLI): webcrack's bin enforces a Node engine range
// that this machine exceeds, but the library itself runs fine — so we call the API.
import { readFile, mkdir, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { webcrack } from "webcrack";

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
const result = await webcrack(code);
await mkdir(outDir, { recursive: true });
await result.save(outDir);
const { n, bytes } = await countJs(outDir);

console.log(JSON.stringify({ input, outDir, modules: n, bytes, ms: Date.now() - t0 }));

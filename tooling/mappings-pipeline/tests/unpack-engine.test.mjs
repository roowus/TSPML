// Guard for #5: webcrack's *library* must keep working on whatever Node we pin,
// even when that Node is outside webcrack's declared `engines` range.
//
// Why a test and not just a README note: the README explains that the range is an
// npm-packaging constraint rather than a real runtime incompatibility. That claim
// is true of webcrack 2.16 on Node 25 (measured), but it is exactly the kind of
// claim that silently stops being true on a dependency bump — and the failure mode
// is the one #5 describes, an empty output directory that reads like "the bundle
// had no modules". So assert it instead of asserting it in prose.
//
// This unpacks a two-line string, not the game bundle: no `.cache/`, no network,
// no proprietary input, ~15ms. CI-runnable.
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { webcrack } from 'webcrack';

describe('webcrack library on the pinned Node (#5)', () => {
  it('unpacks and writes output, despite the engines range excluding this Node', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tspml-unpack-'));
    const out = join(dir, 'out');

    const result = await webcrack('const a = 1 + 1; console.log(a);');
    await result.save(out);

    // The #5 failure mode is silence: exit-without-writing. An empty directory is
    // the symptom, so assert on files existing, not merely on not throwing.
    const files = await readdir(out);
    expect(files.length).toBeGreaterThan(0);
    expect(await readFile(join(out, files[0]), 'utf8')).toMatch(/console\.log/);
  });

  it("the pipeline's own unpack entry point is the library API, not the CLI", async () => {
    // If someone 'simplifies' src/unpack.mjs back to spawning `npx webcrack`, the
    // pipeline regains the silent-no-op bug on Node 25. Pin the import.
    const src = await readFile(new URL('../src/unpack.mjs', import.meta.url), 'utf8');
    expect(src).toMatch(/import \{ webcrack \} from ["']webcrack["']/);

    // Strip `//` comments before looking for the CLI: the file's own header
    // explains the npx hazard by name, and matching that prose would fail on a
    // correct file — the same false-alarm class as #19's stand-in drift test.
    const code = src
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('//'))
      .join('\n');
    expect(code).not.toMatch(/npx|child_process|execa/);
  });
});

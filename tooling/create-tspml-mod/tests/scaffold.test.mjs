import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { modFiles, scaffoldMod, titleFromId } from '../src/scaffold.mjs';

const execFileAsync = promisify(execFile);

/**
 * The body of `interface TspmlApi { ... }` in the stand-in, brace-balanced.
 *
 * Scoping matters: a naive `/readonly (\w+):/` over the whole file also picks up
 * `readonly id` from KeybindBinding, and reports it as an `api.id` member that
 * TspmlApi does not declare — a false drift alarm on a correct stand-in.
 */
function apiBody(src) {
  const start = src.indexOf('interface TspmlApi {');
  if (start === -1) throw new Error('stand-in declares no `interface TspmlApi`');
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i);
  }
  throw new Error('unbalanced braces in `interface TspmlApi`');
}
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');

describe('create-tspml-mod — titleFromId', () => {
  it('title-cases a hyphenated id', () => {
    expect(titleFromId('my-cool-mod')).toBe('My Cool Mod');
    expect(titleFromId('speedometer')).toBe('Speedometer');
  });
});

describe('create-tspml-mod — modFiles', () => {
  it('generates a loader-valid manifest + entrypoint + mixin', () => {
    const f = modFiles('speedometer');
    const mod = JSON.parse(f['mod.json']);
    expect(mod.schemaVersion).toBe(1); // required by the loader
    expect(mod.id).toBe('speedometer');
    expect(mod.targets).toEqual(['>=0.6.0 <0.7.0']);
    // dist/src/..., not entrypoint.js: rootDir is "." (types/ sits beside src/),
    // so tsc emits under dist/src. The old value pointed at a file that never
    // existed after a build — see the emit test below (#19).
    expect(mod.entrypoint).toBe('dist/src/entrypoint.js');
    expect(mod.mixins[0].config).toBe('mixins.json');

    const mixins = JSON.parse(f['mixins.json']);
    expect(mixins.patches[0].symbol).toBe('Car'); // mappings-resolved target

    const entry = f['src/entrypoint.ts'];
    expect(entry).toContain("api.events.on('car.control'"); // Tier-1 event
    expect(entry).toContain("'speedometer.toggle'"); // keybind id
  });
});

// #72: the old marker interpolated the id into a global NAME
// (`window.__my-cool-modMixin=true`), which for hyphenated ids parses as
// subtraction → ReferenceError → eaten by the inject's own try/catch → silent
// no-op. Shape-checking the JSON passed the whole time; only EXECUTING the
// inject catches this class of bug.
describe('create-tspml-mod — the starter mixin marker actually lands (#72)', () => {
  /** Run the generated inject against a stub window; return the stub. */
  function runInject(id) {
    const inject = JSON.parse(modFiles(id)['mixins.json']).patches[0].inject;
    const stub = {};
    // `window` resolves to the parameter, standing in for the game frame's
    // global. NO surrounding try/catch here: a parse error must fail the test.
    new Function('window', inject)(stub);
    return stub;
  }

  it('sets the marker for a hyphenated id (the case the old code silently dropped)', () => {
    const w = runInject('my-cool-mod');
    expect(w.__tspmlMixinMarkers).toEqual({ 'my-cool-mod': true });
  });

  it('sets the marker for a plain id and composes with an existing marker object', () => {
    expect(runInject('speedometer').__tspmlMixinMarkers).toEqual({ speedometer: true });
    // Two mods' markers share the namespace object instead of clobbering it.
    const w = { __tspmlMixinMarkers: { earlier: true } };
    const inject = JSON.parse(modFiles('later-mod')['mixins.json']).patches[0].inject;
    new Function('window', inject)(w);
    expect(w.__tspmlMixinMarkers).toEqual({ earlier: true, 'later-mod': true });
  });

  it('the committed checkpoint-counter demo mixin passes the same evaluation', async () => {
    // We shipped #72 ourselves in this file — keep it pinned to the fixed shape.
    const src = await readFile(
      join(REPO, 'environments/demo-mods/tspml-checkpoint-counter/mixins.json'),
      'utf8',
    );
    const stub = {};
    new Function('window', JSON.parse(src).patches[0].inject)(stub);
    expect(stub.__tspmlMixinMarkers).toEqual({ 'tspml-checkpoint-counter': true });
  });
});

describe('create-tspml-mod — scaffoldMod (disk)', () => {
  it('writes all files to the target dir', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tspml-scaffold-'));
    try {
      const created = await scaffoldMod('neon-trails', dir);
      expect(created).toContain('mod.json');
      expect(created).toContain('src/entrypoint.ts');
      const mod = JSON.parse(await readFile(join(dir, 'mod.json'), 'utf8'));
      expect(mod.id).toBe('neon-trails');
      const entry = await readFile(join(dir, 'src/entrypoint.ts'), 'utf8');
      expect(entry).toContain('api.keybinds.register');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects an invalid id (dots, caps, empty)', async () => {
    await expect(scaffoldMod('Bad.Id', '/tmp/x')).rejects.toThrow(/Invalid mod id/);
    await expect(scaffoldMod('Caps', '/tmp/x')).rejects.toThrow(/Invalid mod id/);
    await expect(scaffoldMod('', '/tmp/x')).rejects.toThrow(/Invalid mod id/);
  });
});

// #19: the scaffold was unusable outside this monorepo, and every test above
// still passed — they assert on file CONTENTS, and the content was fine. The
// failure was in what happens when you run the two commands the CLI prints:
// `workspace:*` made `pnpm install` die with ERR_PNPM_WORKSPACE_PKG_NOT_FOUND
// on the very first step. Asserting the generated text is not asserting the
// generated project works.
describe('create-tspml-mod — the scaffold is standalone (#19)', () => {
  it('declares no workspace: or unpublished @tspml dependency', () => {
    const pkg = JSON.parse(modFiles('standalone-check')['package.json']);
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    for (const [name, range] of Object.entries(deps)) {
      expect(String(range), `${name} uses a workspace protocol`).not.toMatch(/^workspace:/);
      // @tspml/api is not on npm yet, so depending on it by ANY range breaks
      // install for an external author. Drop this guard when it is published.
      expect(name).not.toMatch(/^@tspml\//);
    }
  });

  it('mod.json entrypoint matches where tsc actually emits', () => {
    const f = modFiles('emit-check');
    const mod = JSON.parse(f['mod.json']);
    const ts = JSON.parse(f['tsconfig.json']);
    const { outDir, rootDir } = ts.compilerOptions;
    // rootDir "." + outDir "dist" => src/entrypoint.ts lands at dist/src/entrypoint.js
    const expected = join(outDir, rootDir, 'src/entrypoint.js').replace(/\\/g, '/');
    expect(mod.entrypoint).toBe(expected.replace('./', ''));
  });

  it('the local type stand-in covers every member the entrypoint uses', () => {
    const f = modFiles('types-check');
    const types = f['types/tspml-api.d.ts'];
    const entry = f['src/entrypoint.ts'];
    // Every `api.<member>` the starter touches must exist in the stand-in.
    // Skip import lines: '../types/tspml-api.js' contains a literal "api." that
    // matches \bapi\. (the hyphen is a word boundary) and yields a phantom
    // member 'js' the stand-in can never declare.
    const body = entry
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('import'))
      .join('\n');
    const used = [...body.matchAll(/\bapi\.([a-zA-Z]+)/g)].map((m) => m[1]);
    expect(used).toContain('keybinds'); // the extraction itself works
    for (const member of new Set(used)) {
      expect(apiBody(types), `stand-in is missing 'api.${member}'`).toMatch(
        new RegExp(`readonly ${member}\\b`),
      );
    }
    expect(entry).toContain("from '../types/tspml-api.js'");
    expect(entry).not.toContain("from '@tspml/api'");
  });

  // The stand-in is a hand-written subset, so it can drift from the real thing
  // silently — and a scaffold that typechecks against a stale API is worse than
  // one that fails to build. Pin the member NAMES to the published interface.
  it('the stand-in does not drift from the published TspmlApi', async () => {
    const real = await readFile(join(REPO, 'packages/api/src/api.ts'), 'utf8');
    const realMembers = [...real.matchAll(/^\s*readonly (\w+):/gm)].map((m) => m[1]);
    expect(realMembers).toContain('logger');

    const stand = modFiles('drift-check')['types/tspml-api.d.ts'];
    const standMembers = [...apiBody(stand).matchAll(/^\s*readonly (\w+):/gm)].map((m) => m[1]);

    // Subset, not equality: the stand-in deliberately omits members the starter
    // does not use (tracks, audio). What must never happen is a member that the
    // real API no longer has.
    for (const m of standMembers) {
      expect(realMembers, `stand-in declares 'api.${m}', which TspmlApi does not`).toContain(m);
    }
  });

  // The end-to-end claim: `npx create-tspml-mod x && pnpm install && pnpm build`.
  // Runs the real tsc against a real scaffold on disk — the only check that would
  // have caught #19, and it is why this test does not mock the compiler.
  it('compiles with the repo tsc, with no @tspml packages resolvable', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tspml-build-'));
    try {
      await scaffoldMod('build-check', dir);
      const tsc = join(REPO, 'packages/api/node_modules/.bin/tsc');
      await execFileAsync(tsc, ['-p', join(dir, 'tsconfig.json')], { timeout: 120_000 });
      const emitted = await readFile(join(dir, 'dist/src/entrypoint.js'), 'utf8');
      expect(emitted).toContain('api.keybinds.register');
      expect(emitted).not.toContain('import type'); // types fully erased
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 140_000);
});

/**
 * Rewriting a PML mod's PolyModLoader import (lib/pml/wrap.ts).
 *
 * A PML mod's first line is `import { PolyMod } from "./PolyModLoader.js"`, and
 * TSPML imports mod code from a `blob:` URL, against which a relative specifier
 * resolves to nothing. So this rewrite is not a nicety — it is the difference
 * between the mod running and the mod failing at import time with a network
 * error that names no cause.
 *
 * Two things make these tests worth more than a snapshot would be:
 *
 *  1. The rewrite is TEXTUAL, so the clause forms are the surface area. Each
 *     form below is one a real mod is written in, and a form that silently
 *     produces `''` gets left as written and fails at import.
 *  2. The warnings are the product. An unknown imported name binds to
 *     `undefined` and surfaces ten lines later as `X is not a constructor`;
 *     the warning is the only thing connecting that to its cause, so the tests
 *     assert the name appears in it.
 *
 * The generated source is asserted on by BEHAVIOUR (does it read the runtime,
 * does it bind the right locals) rather than by string equality, so formatting
 * changes do not read as regressions.
 */
import { describe, expect, it } from 'vitest';
import { buildPmlModuleSource, PML_RUNTIME_EXPORTS, PML_RUNTIME_GLOBAL } from '@/lib/pml/wrap';

const KEY = 'somemod#abc';

function wrap(code: string) {
  return buildPmlModuleSource(code, KEY);
}

/** The runtime accessor the rewrite is expected to emit. */
const ACCESS = `globalThis[${JSON.stringify(PML_RUNTIME_GLOBAL)}][${JSON.stringify(KEY)}]`;

describe('buildPmlModuleSource — which specifiers get redirected', () => {
  it.each([
    './PolyModLoader.js',
    '../PolyModLoader.js',
    '/mods/PolyModLoader.js',
    './PolyModLoader',
    './PolyModLoader.mjs',
    './PolyModLoader.ts',
  ])('redirects %s', (spec) => {
    const { redirected, source } = wrap(`import { PolyMod } from "${spec}";`);
    expect(redirected).toBe(1);
    expect(source).toContain(ACCESS);
    expect(source).not.toContain(spec);
  });

  it('leaves a specifier that merely CONTAINS the name alone', () => {
    // `PolyModLoaderExtras.js` is somebody else's file, not PML's loader.
    const { redirected } = wrap(`import x from "./PolyModLoaderExtras.js";`);
    expect(redirected).toBe(0);
  });

  it('leaves bare (non-relative) specifiers alone — those resolve normally', () => {
    const { redirected, source, warnings } = wrap(`import { z } from "three";`);
    expect(redirected).toBe(0);
    expect(source).toContain('"three"');
    expect(warnings).toEqual([]);
  });
});

describe('buildPmlModuleSource — the clause forms', () => {
  it('destructures a named import so an unknown name is undefined, not a throw', () => {
    const { source } = wrap(`import { PolyMod, MixinType } from "./PolyModLoader.js";`);
    expect(source).toContain(`const { PolyMod, MixinType } = ${ACCESS};`);
  });

  it('renames an aliased import to its LOCAL name', () => {
    const { source } = wrap(`import { PolyMod as Base } from "./PolyModLoader.js";`);
    expect(source).toContain(`const { PolyMod: Base } = ${ACCESS};`);
  });

  it('binds a namespace import to the whole runtime object', () => {
    const { source, warnings } = wrap(`import * as pml from "./PolyModLoader.js";`);
    expect(source).toContain(`const pml = ${ACCESS};`);
    expect(warnings).toEqual([]);
  });

  it('binds a default import to the runtime too, and says PML has no default', () => {
    // A mod written against a default export is already confused; binding the
    // adapter object is the reading most likely to work, but it is a guess and
    // has to be declared as one.
    const { source, warnings } = wrap(`import PML from "./PolyModLoader.js";`);
    expect(source).toContain(`const PML = ${ACCESS};`);
    expect(warnings.join(' ')).toMatch(/default export/);
    expect(warnings.join(' ')).toMatch(/'PML'/);
  });

  it('handles a default AND named clause together', () => {
    const { source } = wrap(`import PML, { PolyMod } from "./PolyModLoader.js";`);
    expect(source).toContain(`const PML = ${ACCESS};`);
    expect(source).toContain(`const { PolyMod } = ${ACCESS};`);
  });

  it('rewrites a multi-line clause, which is how real mods import several names', () => {
    const { redirected, source } = wrap(
      ['import {', '  PolyMod,', '  MixinType,', '} from "./PolyModLoader.js";'].join('\n'),
    );
    expect(redirected).toBe(1);
    expect(source).toContain(`const { PolyMod, MixinType } = ${ACCESS};`);
  });

  it('preserves indentation so a rewritten line does not corrupt the source around it', () => {
    const { source } = wrap(`  import { PolyMod } from "./PolyModLoader.js";`);
    expect(source).toMatch(/\n? {2}const \{ PolyMod \}/);
  });

  it('rewrites every PolyModLoader import, not just the first', () => {
    const { redirected } = wrap(
      ['import { PolyMod } from "./PolyModLoader.js";', 'import { MixinType } from "./PolyModLoader.js";'].join('\n'),
    );
    expect(redirected).toBe(2);
  });
});

describe('buildPmlModuleSource — the warnings are the product', () => {
  it('names an imported symbol the adapter does not provide', () => {
    // Binding it to undefined is right — that is what a destructure does — but
    // the failure surfaces later as `X is not a constructor`, and this warning
    // is the only thing tying that back to a name that was never provided.
    const { source, warnings } = wrap(`import { PolyMod, SomethingElse } from "./PolyModLoader.js";`);
    expect(warnings.join(' ')).toMatch(/SomethingElse/);
    // Listing what IS provided saves the author a trip to the docs.
    for (const name of PML_RUNTIME_EXPORTS) expect(warnings.join(' ')).toContain(name);
    // ...and it is still bound, because a destructure of a missing key is fine.
    expect(source).toContain('SomethingElse');
  });

  it('says nothing about names it does provide', () => {
    expect(wrap(`import { PolyMod, MixinType, SettingType } from "./PolyModLoader.js";`).warnings).toEqual(
      [],
    );
  });

  it('names an unresolvable relative import instead of leaving a blob 404 to explain it', () => {
    // Left as written on purpose: rewriting someone else's import would be
    // guessing. But the author hears which specifier will fail, and why.
    const { source, warnings } = wrap(`import { helper } from "./util/helper.js";`);
    expect(source).toContain('./util/helper.js');
    expect(warnings.join(' ')).toMatch(/\.\/util\/helper\.js/);
    expect(warnings.join(' ')).toMatch(/blob:/);
    expect(warnings.join(' ')).toMatch(/one built file/);
  });

  it('removes a side-effect-only PolyModLoader import and says why', () => {
    // `import "./PolyModLoader.js"` imports no names; the author usually
    // expected it to install a global. Deleting it silently would leave that
    // expectation intact and wrong.
    const { source, redirected, warnings } = wrap(`import "./PolyModLoader.js";`);
    expect(redirected).toBe(1);
    expect(source).not.toContain('./PolyModLoader.js');
    expect(warnings.join(' ')).toMatch(/side-effect/);
    expect(warnings.join(' ')).toMatch(/polyModLoader/);
  });
});

describe('buildPmlModuleSource — what it refuses to do', () => {
  it('appends NOTHING, so every export form of polyMod survives', () => {
    // The caller reads `polyMod` off the module namespace. An appended
    // `export default polyMod` would have quietly broken
    // `export { thing as polyMod }`, which is a form real mods use.
    const code = 'const thing = {};\nexport { thing as polyMod };';
    const { source } = wrap(code);
    expect(source).toBe(code);
    expect(source).not.toMatch(/export default/);
  });

  it('leaves a mod with no imports at all completely untouched', () => {
    // Reaching the adapter through the `polyModLoader` global is a shape PML
    // permits; a rewrite that required an import statement would break it.
    const code = 'polyModLoader.registerMod({});';
    const { source, redirected, warnings } = wrap(code);
    expect(source).toBe(code);
    expect(redirected).toBe(0);
    expect(warnings).toEqual([]);
  });

  it('adds a prelude only when something was actually redirected', () => {
    expect(wrap('const x = 1;').source).not.toMatch(/tspml:/);
    expect(wrap(`import { PolyMod } from "./PolyModLoader.js";`).source).toMatch(/tspml:/);
  });

  it('leaves a clause it cannot model as written, and names it', () => {
    // Failing loudly beats emitting a `const` that does not parse: a broken
    // rewrite would take down a mod that was merely unusual.
    const { source, redirected, warnings } = wrap(`import { "str" as x } from "./PolyModLoader.js";`);
    expect(redirected).toBe(0);
    expect(source).toContain('./PolyModLoader.js');
    expect(warnings.join(' ')).toMatch(/could not rewrite/);
  });
});

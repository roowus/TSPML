/**
 * PML manifest → TSPML manifest translation (lib/pml/manifest.ts).
 *
 * This is the half of the adapter that is pure, and therefore the half where a
 * wrong rule is cheap to pin. The rules under test are not cosmetic field
 * renames — each one decides whether a real PML mod loads, loads soft-disabled,
 * or loads and then misbehaves:
 *
 *  - a dropped `targets` entry silently un-gates a mod from the game version it
 *    was written for;
 *  - a translated `dependencies` array would turn "this mod has deps" into
 *    "this mod cannot load", because an unresolvable `depends` is abortive in
 *    the loader's pre-gate;
 *  - a slugified id that did not keep the original breaks `pml.getMod()`, which
 *    is the documented way PML mods reach each other.
 *
 * So these assert on the NOTES as much as on the manifest: a translation that
 * quietly widened a version fence would pass a test that only checked shape.
 *
 * The fixtures in `REAL` are copied byte-for-byte off PML's own CDN. That is
 * deliberate and it is the lesson of the first cut of this file: every fixture
 * here used to be hand-written from the same belief the code was written from
 * (`polymod` always present, `main` a bare stem), so 139 green tests and a
 * passing browser smoke agreed with each other and with nothing real. A fixture
 * built from the assumption under test cannot falsify it.
 */
import { describe, expect, it } from 'vitest';
import {
  isPmlIndexManifest,
  isPmlVersionManifest,
  pickPmlVersion,
  pmlIndexLatest,
  slugifyPmlId,
  translatePmlManifest,
} from '@/lib/pml/manifest';

/**
 * Verbatim bodies from cdn.polymodloader.com, both generations.
 *
 * PolyProxy is the current shape (0.6.2, identity in the index, flat version
 * manifest, `main` a full filename). Cool Cars is the legacy shape (0.5.x, bare
 * index with no wrapper, identity nested under `polymod`).
 */
const REAL = {
  polyproxyIndex: {
    name: 'PolyProxy',
    id: 'polyproxy',
    author: 'Orangy',
    latest: {
      '0.6.0-beta1': '1.1.3',
      '0.6.0': '1.1.7',
      '0.6.1': '1.1.8',
      '0.6.2': '10.0.0',
    },
  },
  polyproxyVersion: {
    targets: ['0.6.2'],
    main: 'main.mod.js',
    dependencies: [],
  },
  coolcarsIndex: { '0.5.0': '1.3.1', '0.5.1': '1.5.0', '0.5.2': '1.6.0' },
  coolcarsVersion: {
    polymod: {
      name: 'Cool Cars',
      id: 'coolcars',
      author: 'CRJakob',
      targets: ['0.5.1', '0.5.2'],
      main: 'main.mod.js',
    },
    dependencies: [{ id: 'carswitcher', version: '1.0.5' }],
  },
} as const;

/** The minimum a PML manifest needs to translate at all. */
function polymod(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { polymod: { id: 'somemod', main: 'main', ...over } };
}

function translated(over: Record<string, unknown> = {}, top: Record<string, unknown> = {}) {
  const res = translatePmlManifest({ ...polymod(over), ...top });
  if (!res.ok) throw new Error(`expected a translation, got: ${res.error}`);
  return res.value;
}

function must(res: ReturnType<typeof translatePmlManifest>) {
  if (!res.ok) throw new Error(`expected a translation, got: ${res.error}`);
  return res.value;
}

describe('slugifyPmlId', () => {
  it('leaves a conformant id alone', () => {
    expect(slugifyPmlId('poly-to-track')).toBe('poly-to-track');
    expect(slugifyPmlId('somemod')).toBe('somemod');
  });

  it('folds the characters TSPML ids do not allow rather than refusing the mod', () => {
    // Refusing a real mod over a character class would be a self-inflicted
    // incompatibility — the id is ours to normalise, the mod is not.
    expect(slugifyPmlId('Some.Mod_v2')).toBe('some-mod-v2');
    expect(slugifyPmlId('--weird--')).toBe('weird');
  });

  it('never returns an empty id', () => {
    // An id of '' would fail `parseVersionManifest` with a message about a
    // missing field, which describes the wrong problem.
    expect(slugifyPmlId('!!!')).toBe('pml-mod');
    expect(slugifyPmlId('')).toBe('pml-mod');
  });
});

describe('manifest shape detection', () => {
  it('tells a version manifest from an index manifest by CONTENT', () => {
    // Both files are conventionally called `manifest.json` depending on where
    // in the tree they sit, so the filename cannot decide this.
    expect(isPmlVersionManifest(polymod())).toBe(true);
    expect(isPmlIndexManifest(polymod())).toBe(false);
    expect(isPmlIndexManifest({ latest: { '0.6.2': '1.2.0' } })).toBe(true);
    expect(isPmlVersionManifest({ latest: { '0.6.2': '1.2.0' } })).toBe(false);
  });

  it('recognises the CURRENT flat version manifest, which has no polymod block', () => {
    // The shape every 0.6.x mod on the CDN actually ships. Requiring `polymod`
    // here is what refused all of them with "this does not look like a PML
    // manifest" while the hand-written fixture said everything was fine.
    expect(isPmlVersionManifest(REAL.polyproxyVersion)).toBe(true);
    expect(isPmlVersionManifest(REAL.coolcarsVersion)).toBe(true);
  });

  it('recognises the LEGACY bare index, which has no `latest` wrapper', () => {
    // 11 of the 20 mods in PML's registry serve this. It carries no marker key
    // at all, so it is recognised by its structure: version keys, string values.
    expect(isPmlIndexManifest(REAL.coolcarsIndex)).toBe(true);
    expect(isPmlIndexManifest(REAL.polyproxyIndex)).toBe(true);
    expect(pmlIndexLatest(REAL.coolcarsIndex)).toEqual(REAL.coolcarsIndex);
    expect(pmlIndexLatest(REAL.polyproxyIndex)).toEqual(REAL.polyproxyIndex.latest);
  });

  it('does not mistake an arbitrary object for a bare index', () => {
    // The bare form has no marker, so a loose test here would swallow any JSON
    // and send the walk chasing a "version" that is not one.
    expect(isPmlIndexManifest({ hello: 'world' })).toBe(false);
    expect(isPmlIndexManifest({ '0.5.1': 42 })).toBe(false);
    expect(isPmlIndexManifest({ '0.5.1': '1.0.0', notaversion: '1.0.0' })).toBe(false);
    expect(isPmlIndexManifest({})).toBe(false);
    // A flat version manifest must read as a VERSION manifest, never an index.
    expect(isPmlIndexManifest(REAL.polyproxyVersion)).toBe(false);
  });

  it('accepts pre-release version keys, which PolyTrack really ships', () => {
    expect(isPmlIndexManifest({ '0.6.0-beta1': '1.1.3' })).toBe(true);
  });

  it('recognises neither in shapes that are neither', () => {
    for (const v of [null, 'a string', [1, 2], { polymod: null }, { latest: [] }]) {
      expect(isPmlVersionManifest(v)).toBe(false);
      expect(isPmlIndexManifest(v)).toBe(false);
    }
  });
});

describe('pickPmlVersion', () => {
  it('takes the exact game version when the index lists it', () => {
    expect(pickPmlVersion({ '0.5.0': '1.0.0', '0.6.2': '1.2.0' }, '0.6.2')).toEqual({
      version: '1.2.0',
      exact: true,
    });
  });

  it('falls back to a lone entry, and says it was not exact', () => {
    // A single-entry index is unambiguous about what it offers; refusing it
    // would fail an import over a version string the author never restated.
    expect(pickPmlVersion({ '0.5.0': '1.0.0' }, '0.6.2')).toEqual({ version: '1.0.0', exact: false });
  });

  it('refuses to guess between two non-matching entries', () => {
    // With a real choice to make, guessing is how you install a build for the
    // wrong game and find out on the track.
    expect(pickPmlVersion({ '0.4.0': '1.0.0', '0.5.0': '1.1.0' }, '0.6.2')).toBeNull();
  });

  it('ignores non-string values rather than returning one', () => {
    expect(pickPmlVersion({ '0.6.2': 42 }, '0.6.2')).toBeNull();
    expect(pickPmlVersion({}, '0.6.2')).toBeNull();
  });
});

describe('translatePmlManifest — the fields', () => {
  it('produces a manifest shaped for parseVersionManifest', () => {
    const { manifest, entryPath } = translated({
      name: 'Some Mod',
      author: 'someone',
      version: '1.2.0',
      description: 'does a thing',
    });
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.id).toBe('somemod');
    expect(manifest.name).toBe('Some Mod');
    expect(manifest.version).toBe('1.2.0');
    expect(manifest.environment).toBe('web');
    expect(manifest.description).toBe('does a thing');
    expect(manifest.authors).toEqual([{ name: 'someone' }]);
    // A bare stem is completed — that is what PML's older docs showed.
    expect(manifest.entrypoint).toBe('main.mod.js');
    expect(entryPath).toBe('main.mod.js');
  });

  it('uses `main` VERBATIM when it already names a file', () => {
    // Every mod on the CDN declares `"main": "main.mod.js"` and PML fetches it
    // unchanged (`${polyModUrl}/${manifest.main}`). Appending unconditionally
    // requested `main.mod.js.mod.js`, which 404s — the mod imports, translates,
    // reports no problem, and then has no code.
    const { manifest, entryPath } = translated({ main: 'main.mod.js' });
    expect(entryPath).toBe('main.mod.js');
    expect(manifest.entrypoint).toBe('main.mod.js');
    expect(must(translatePmlManifest(REAL.coolcarsVersion)).entryPath).toBe('main.mod.js');
    // `.js` and `.mjs` both count as "already a file".
    expect(translated({ main: 'dist/bundle.js' }).entryPath).toBe('dist/bundle.js');
    expect(translated({ main: 'index.mjs' }).entryPath).toBe('index.mjs');
  });

  it('falls back to the raw id for a nameless mod', () => {
    expect(translated().manifest.name).toBe('somemod');
  });

  it("refuses a manifest with no 'id' or no 'main' by naming the field", () => {
    // 'main' is what decides which file to fetch — without it the walk has
    // nowhere to go, and a generic failure would read as a network problem.
    const noId = translatePmlManifest({ polymod: { main: 'main' } });
    expect(noId.ok).toBe(false);
    if (!noId.ok) expect(noId.error).toMatch(/'id'/);
    const noMain = translatePmlManifest({ polymod: { id: 'x' } });
    expect(noMain.ok).toBe(false);
    if (!noMain.ok) expect(noMain.error).toMatch(/'main'/);
  });

  it('says WHERE the id was looked for, since it can come from either file', () => {
    // "the polymod block has no id" describes a block a current mod does not
    // have, and points the reader at the wrong file to fix.
    const res = translatePmlManifest(REAL.polyproxyVersion);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/index manifest/);
  });
});

describe('translatePmlManifest — identity may live in the index', () => {
  it('translates a CURRENT mod, whose version manifest states no identity', () => {
    // PolyProxy 10.0.0 as actually served. Every field but `targets` and `main`
    // comes from the index, and without it this mod cannot be installed at all.
    const { manifest, entryPath, notes } = must(
      translatePmlManifest(REAL.polyproxyVersion, {
        id: REAL.polyproxyIndex.id,
        name: REAL.polyproxyIndex.name,
        author: REAL.polyproxyIndex.author,
        version: '10.0.0',
      }),
    );
    expect(manifest.id).toBe('polyproxy');
    expect(manifest.name).toBe('PolyProxy');
    expect(manifest.version).toBe('10.0.0');
    expect(manifest.authors).toEqual([{ name: 'Orangy' }]);
    expect(manifest.targets).toEqual(['0.6.2']);
    expect(entryPath).toBe('main.mod.js');
    // Nothing was defaulted or dropped, so nothing is worth saying.
    expect(notes).toEqual([]);
  });

  it('translates a LEGACY mod with no index identity at all', () => {
    // The bare index carries none, so everything must come from `polymod`.
    const { manifest } = must(translatePmlManifest(REAL.coolcarsVersion, { version: '1.6.0' }));
    expect(manifest.id).toBe('coolcars');
    expect(manifest.name).toBe('Cool Cars');
    expect(manifest.authors).toEqual([{ name: 'CRJakob' }]);
    expect(manifest.version).toBe('1.6.0');
    expect(manifest.targets).toEqual(['0.5.1', '0.5.2']);
  });

  it('lets the version manifest win over the index', () => {
    // PML merges the same way (`{...index, version, ...versionFile}`): a mod
    // that restates a field in the version file means it.
    const { manifest } = must(
      translatePmlManifest(polymod({ id: 'fromversion', name: 'From Version' }), {
        id: 'fromindex',
        name: 'From Index',
        author: 'indexauthor',
      }),
    );
    expect(manifest.id).toBe('fromversion');
    expect(manifest.name).toBe('From Version');
    // …and still falls back for a field it did NOT restate.
    expect(manifest.authors).toEqual([{ name: 'indexauthor' }]);
  });

  it('takes the resolved mod version from the index without complaint', () => {
    // A flat version manifest never states its own version, so defaulting to
    // '0.0.0' here would put a wrong version on every current PML mod.
    const { manifest, notes } = must(
      translatePmlManifest({ main: 'main.mod.js', targets: ['0.6.2'] }, { id: 'x', version: '10.0.0' }),
    );
    expect(manifest.version).toBe('10.0.0');
    expect(notes.join(' ')).not.toMatch(/no version/);
  });
});

describe('translatePmlManifest — id slugging keeps the PML id', () => {
  it('records the original id so pml.getMod still resolves', () => {
    // `getMod` looks up by PML id, not ours. Losing it here would break the
    // documented way PML mods reach each other's state.
    const { manifest, notes } = translated({ id: 'Some.Mod' });
    expect(manifest.id).toBe('some-mod');
    expect((manifest.custom as { pml: { id: string } }).pml.id).toBe('Some.Mod');
    expect(notes.join(' ')).toMatch(/slugified/);
    expect(notes.join(' ')).toMatch(/getMod\('Some\.Mod'\)/);
  });

  it('says nothing about the id when it needed no change', () => {
    // Scoped to slugging: this fixture declares no version, so it earns the
    // version note either way, and asserting on an empty array would be
    // asserting about an unrelated rule.
    expect(translated({ version: '1.0.0' }).notes).toEqual([]);
  });
});

describe('translatePmlManifest — targets are a fence, not decoration', () => {
  it('carries valid ranges through for the LOADER to gate on', () => {
    // One gate, not two: the adapter states the targets, the loader decides
    // whether they are satisfied — so a PML mod built for 0.5.0 gets
    // soft-disabled with the loader's own reason rather than a second one.
    expect(translated({ targets: ['0.5.0', '^0.6.0'] }).manifest.targets).toEqual(['0.5.0', '^0.6.0']);
  });

  it('drops an invalid range BY NAME instead of widening silently', () => {
    const { manifest, notes } = translated({ targets: ['0.6.2', 'not-a-range'] });
    expect(manifest.targets).toEqual(['0.6.2']);
    expect(notes.join(' ')).toMatch(/not-a-range/);
    expect((manifest.custom as { pml: { droppedTargets: string[] } }).pml.droppedTargets).toEqual([
      'not-a-range',
    ]);
  });

  it('warns loudly when EVERY target failed translation', () => {
    // Empty `targets` means "any game version" to the loader, so an author
    // whose fence came down entirely has to hear that it did.
    const { manifest, notes } = translated({ targets: ['nonsense'] });
    expect(manifest.targets).toEqual([]);
    expect(notes.join(' ')).toMatch(/no longer version-gated/);
  });

  it('says nothing about a mod that declared no targets', () => {
    // Declaring none is a choice; having them all dropped is an accident.
    expect(translated().notes.join(' ')).not.toMatch(/version-gated/);
  });
});

describe('translatePmlManifest — dependencies are recorded, never enforced', () => {
  it('does NOT emit them as `depends`', () => {
    // PML deps are PML-registry ids and resolve against a registry TSPML has
    // no view of. Emitting `depends` would make an unresolvable id abortive in
    // the loader's pre-gate — turning "has deps" into "cannot load".
    const { manifest, notes } = translated({}, { dependencies: ['otherpmlmod'] });
    expect(manifest.depends).toBeUndefined();
    expect((manifest.custom as { pml: { dependencies: string[] } }).pml.dependencies).toEqual([
      'otherpmlmod',
    ]);
    expect(notes.join(' ')).toMatch(/NOT enforced/);
  });

  it('stays quiet about an empty dependency list', () => {
    expect(translated({}, { dependencies: [] }).notes.join(' ')).not.toMatch(/dependenc/);
  });
});

describe('translatePmlManifest — the physics claim', () => {
  it("maps touchingPhysics onto the safety classifier's vanillaSafe", () => {
    // The one PML field whose meaning maps exactly onto something TSPML reads.
    expect(translated({ touchingPhysics: true }).manifest.vanillaSafe).toBe(false);
  });

  it('leaves vanillaSafe unset when the mod makes no such claim', () => {
    expect(translated().manifest.vanillaSafe).toBeUndefined();
    expect(translated({ touchingPhysics: false }).manifest.vanillaSafe).toBeUndefined();
  });
});

describe('translatePmlManifest — defaults are named, not assumed', () => {
  it("uses '0.0.0' for a versionless mod and says so", () => {
    const { manifest, notes } = translated();
    expect(manifest.version).toBe('0.0.0');
    expect(notes.join(' ')).toMatch(/no version/);
  });

  it('carries modThumbnail across as the icon', () => {
    expect(translated({ modThumbnail: 'icon.png' }).manifest.icon).toBe('icon.png');
  });
});

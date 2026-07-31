import { describe, expect, it } from 'vitest';
import {
  ManifestError,
  parseGlobalManifest,
  parseVersionManifest,
} from '../src/index.js';

function baseManifest(o: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: 'cool-cars',
    name: 'Cool Cars',
    version: '1.0.0',
    entrypoint: 'main.js',
    targets: ['>=0.6.0 <0.7.0'],
    ...o,
  };
}

/** Assert that `fn` throws a ManifestError and run `check` against it. */
function expectManifestError(fn: () => void, check: (e: ManifestError) => void): void {
  try {
    fn();
    throw new Error('expected parseVersionManifest to throw a ManifestError');
  } catch (err) {
    if (err instanceof Error && err.message === 'expected parseVersionManifest to throw a ManifestError') {
      throw err;
    }
    if (!(err instanceof ManifestError)) {
      throw new Error(`expected ManifestError, got: ${(err as Error).message ?? err}`);
    }
    check(err);
  }
}

describe('parseVersionManifest', () => {
  it('parses a valid manifest', () => {
    const m = parseVersionManifest(baseManifest());
    expect(m.id).toBe('cool-cars');
    expect(m.version).toBe('1.0.0');
    expect(m.targets).toEqual(['>=0.6.0 <0.7.0']);
  });

  it('parses the full spec example with all optional fields', () => {
    const m = parseVersionManifest(
      baseManifest({
        description: 'desc',
        authors: [{ name: 'alice', contact: 'alice@example.com' }],
        license: 'MIT',
        icon: 'icon.png',
        homepage: 'https://example.com',
        environment: 'worker',
        depends: { 'tspml-api': '^1.0.0' },
        recommends: {},
        suggests: {},
        conflicts: {},
        breaks: { 'cool-cars-old': '*' },
        includes: {},
        provides: ['cars'],
        mixins: [{ config: 'mixins/cars.json', environment: 'worker' }],
        capabilities: ['dom', 'storage'],
        vanillaSafe: true,
        custom: { foo: 'bar' },
      }),
    );
    expect(m.depends).toEqual({ 'tspml-api': '^1.0.0' });
    expect(m.provides).toEqual(['cars']);
    expect(m.authors).toEqual([{ name: 'alice', contact: 'alice@example.com' }]);
    expect(m.environment).toBe('worker');
    expect(m.vanillaSafe).toBe(true);
  });

  it('rejects an invalid id, naming the field', () => {
    expectManifestError(
      () => parseVersionManifest(baseManifest({ id: 'Bad_Id' })),
      (err) => {
        expect(err.field).toBe('Bad_Id: id');
        expect(err.manifestId).toBe('Bad_Id');
      },
    );
  });

  it('rejects a non-string id (no id prefix available)', () => {
    expectManifestError(
      () => parseVersionManifest(baseManifest({ id: 5 })),
      (err) => {
        expect(err.field).toBe('id');
      },
    );
  });

  it('rejects missing required fields, naming each', () => {
    const fields = ['schemaVersion', 'name', 'version', 'entrypoint'];
    for (const field of fields) {
      const raw = baseManifest();
      delete raw[field];
      expectManifestError(() => parseVersionManifest(raw), (err) => {
        expect(err.field).toContain(field);
      });
    }
  });

  it('rejects an unsupported schemaVersion', () => {
    expect(() =>
      parseVersionManifest(baseManifest({ schemaVersion: 2 })),
    ).toThrowError(/unsupported schemaVersion 2/);
  });

  it('rejects a bad semver version, naming the field', () => {
    expectManifestError(
      () => parseVersionManifest(baseManifest({ version: 'not-a-version' })),
      (err) => {
        expect(err.field).toBe('cool-cars: version');
      },
    );
  });

  it('rejects a bad range in targets, naming the index', () => {
    expectManifestError(
      () => parseVersionManifest(baseManifest({ targets: ['not-a-range'] })),
      (err) => {
        expect(err.field).toBe('cool-cars: targets[0]');
      },
    );
  });

  it('rejects a bad range in a dependency map, naming the exact key', () => {
    expectManifestError(
      () => parseVersionManifest(baseManifest({ depends: { lib: 'totally!!broken' } })),
      (err) => {
        expect(err.field).toBe('cool-cars: depends["lib"]');
      },
    );
  });

  it('rejects a non-object dependency map', () => {
    expect(() => parseVersionManifest(baseManifest({ depends: [] }))).toThrowError(
      /'depends' must be an object/,
    );
  });

  it('rejects a bad environment value', () => {
    expect(() =>
      parseVersionManifest(baseManifest({ environment: 'mobile' })),
    ).toThrowError(/environment 'mobile'/);
  });

  it('rejects a non-boolean vanillaSafe', () => {
    expect(() =>
      parseVersionManifest(baseManifest({ vanillaSafe: 'yes' })),
    ).toThrowError(/'vanillaSafe' must be a boolean/);
  });
});

describe('parseGlobalManifest', () => {
  it('parses a valid global manifest', () => {
    const g = parseGlobalManifest({
      id: 'cool-cars',
      name: 'Cool Cars',
      author: 'alice',
      latest: { '0.6.2': '1.0.0', '0.6.1': '1.0.0' },
    });
    expect(g.latest['0.6.2']).toBe('1.0.0');
  });

  it('rejects an invalid id', () => {
    expectManifestError(
      () =>
        parseGlobalManifest({
          id: 'UPPER',
          name: 'x',
          author: 'a',
          latest: {},
        }),
      (err) => {
        expect(err.field).toBe('UPPER: id');
      },
    );
  });

  it('rejects a non-object latest map', () => {
    expect(() =>
      parseGlobalManifest({ id: 'x', name: 'x', author: 'a', latest: [] }),
    ).toThrowError(/'latest' must be an object/);
  });
});

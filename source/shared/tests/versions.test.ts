/**
 * #73 — the reported versions are a compatibility contract, so the thing worth
 * testing is that they cannot drift apart.
 *
 * Three facts have to agree: what `@tspml/shared` exports, what the packages
 * declare in their `package.json`, and what a mod's `depends` range is actually
 * checked against. Nothing enforces that by construction — a `version` bump in
 * `packages/api/package.json` alone compiles fine and silently makes the loader
 * lie about which API a mod is running on. These tests are that enforcement.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TSPML_API_VERSION, TSPML_LOADER_VERSION } from '../src/versions.js';

function packageVersion(relativePath: string): string {
  const url = new URL(relativePath, import.meta.url);
  const raw = readFileSync(fileURLToPath(url), 'utf8');
  const parsed: unknown = JSON.parse(raw);
  const version = (parsed as { version?: unknown }).version;
  if (typeof version !== 'string') {
    throw new Error(`no string "version" in ${relativePath}`);
  }
  return version;
}

describe('reported versions', () => {
  it('matches @tspml/loader package.json', () => {
    expect(TSPML_LOADER_VERSION).toBe(packageVersion('../../loader/package.json'));
  });

  it('matches @tspml/api package.json', () => {
    expect(TSPML_API_VERSION).toBe(packageVersion('../../../packages/api/package.json'));
  });

  it('are plain semver, since the loader feeds them to satisfies()', () => {
    // A prerelease or build-metadata suffix would change range semantics:
    // `^0.5.0` does NOT match `0.5.0-dev` under semver. The harness used to
    // report exactly such a string.
    for (const v of [TSPML_LOADER_VERSION, TSPML_API_VERSION]) {
      expect(v).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it('are not 0.0.0, which fails every honest range', () => {
    // The whole point of #73: `0.0.0` is not neutral. It claims TSPML is
    // installed and then rejects `^0.5.0`, `>=0.5`, and anything else an
    // author following the spec would write.
    for (const v of [TSPML_LOADER_VERSION, TSPML_API_VERSION]) {
      expect(v).not.toBe('0.0.0');
    }
  });
});

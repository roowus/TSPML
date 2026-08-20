/**
 * public/sw.js carries INLINE COPIES of logic that lives canonically in `lib/`
 * (files under /public are served verbatim and cannot import a module). Until
 * now the only thing holding the two together was a comment asking the next
 * person to keep them in sync.
 *
 * Drift here fails in the silent direction, which is why it gets a test rather
 * than a comment. If the SW's bundle matcher and the route's idea of a bundle
 * path disagree, nothing throws: the game boots, plays, and simply never applies
 * the user's mixins to whichever file fell through the gap. Nobody sees a stack
 * trace; the author just concludes their mixin does not work.
 *
 * These tests read the SHIPPED FILE off disk. Parsing it (rather than importing
 * a shared constant) is the point: the copy in /public is the artifact browsers
 * execute, so it is the copy that must be checked.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BUNDLE_PATH_RE, isBundleProxyPath } from '../lib/rewrite';

const SW_SRC = readFileSync(
  fileURLToPath(new URL('../public/sw.js', import.meta.url)),
  'utf8',
);

/** Pull a top-level `const <name> = <literal>;` out of the shipped worker. */
function swConst(name: string): string {
  const m = new RegExp(`^const ${name} = (.+);$`, 'm').exec(SW_SRC);
  if (!m?.[1]) throw new Error(`sw.js has no top-level const ${name}`);
  return m[1];
}

describe('public/sw.js — inline copies match their canonical source', () => {
  it('BUNDLE_PATH_RE is character-identical to lib/rewrite.ts (#98)', () => {
    expect(swConst('BUNDLE_PATH_RE')).toBe(BUNDLE_PATH_RE.toString());
  });

  it('the plan cache location matches lib/user-patches.ts PLAN_CACHE (#62)', async () => {
    const { PLAN_CACHE } = await import('../lib/user-patches');
    expect(swConst('PLAN_CACHE_NAME')).toBe(JSON.stringify(PLAN_CACHE.name).replace(/"/g, "'"));
    expect(swConst('PLAN_CACHE_URL')).toBe(JSON.stringify(PLAN_CACHE.url).replace(/"/g, "'"));
  });

  it('bumps SW_VERSION — a stale worker serves the old intercept logic forever', () => {
    // Browsers only replace an installed worker when its BYTES change; the version
    // string is how a change is made deliberate and greppable.
    expect(swConst('SW_VERSION')).toMatch(/^'tspml-sw-\d+'$/);
  });
});

describe('the shipped worker actually uses the matcher it declares', () => {
  it('routes both fetch-handler branches through isBundleProxyPath', () => {
    // A regex that exists but is bypassed on one branch is the drift this whole
    // file exists to catch: the same-origin branch is the one chunk GETs land in.
    const uses = SW_SRC.match(/isBundleProxyPath\(/g) ?? [];
    // one definition + one call per branch
    expect(uses.length).toBeGreaterThanOrEqual(3);
    expect(SW_SRC).toContain('isBundleProxyPath(rewritten.split');
    expect(SW_SRC).toContain('isBundleProxyPath(url.pathname)');
  });
});

describe('isBundleProxyPath — the paths the SW replays as a POST', () => {
  it.each(['/api/proxy/main.bundle.js', '/api/proxy/112.bundle.js', '/api/proxy/9.bundle.js'])(
    'replays %s',
    (p) => {
      expect(isBundleProxyPath(p)).toBe(true);
    },
  );

  it.each([
    '/api/proxy/',
    '/api/proxy/main.bundle.js.map',
    '/api/proxy/chunks/112.bundle.js',
    '/api/proxy/112.bundle.js/x',
    '/main.bundle.js',
    '/api/proxy/simulation.wasm',
    '/api/proxy/11a.bundle.js',
    '/api/proxy/1234567.bundle.js',
  ])('does not replay %s', (p) => {
    expect(isBundleProxyPath(p)).toBe(false);
  });

  it('matches the SHAPE only — the route owns which chunk ids are real', () => {
    // Deliberate over-match: the allowlist is per-build map data, and a copy in
    // /public would go stale silently. An undeclared id gets a 405 and falls back
    // to the plain GET, which is the correct handling for it anyway.
    expect(isBundleProxyPath('/api/proxy/999999.bundle.js')).toBe(true);
  });
});

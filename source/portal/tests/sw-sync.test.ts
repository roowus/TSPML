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
import { BUNDLE_PATH_RE, isBundleProxyPath, isWasmProxyPath, WASM_PATH_RE } from '../lib/rewrite';

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

  it('WASM_PATH_RE is character-identical to lib/rewrite.ts (#43)', () => {
    expect(swConst('WASM_PATH_RE')).toBe(WASM_PATH_RE.toString());
  });

  it('the physics cache location matches lib/physics-plan.ts PHYSICS_CACHE (#43)', async () => {
    const { PHYSICS_CACHE, PHYSICS_REPORT_MESSAGE } = await import('../lib/physics-plan');
    expect(swConst('PHYSICS_CACHE_NAME')).toBe(JSON.stringify(PHYSICS_CACHE.name).replace(/"/g, "'"));
    expect(swConst('PHYSICS_CACHE_URL')).toBe(JSON.stringify(PHYSICS_CACHE.url).replace(/"/g, "'"));
    // The message type too: the page filters on it, so a drift here means physics
    // reports are posted into the void and the panel stays permanently blank.
    expect(swConst('PHYSICS_REPORT_MESSAGE')).toBe(
      JSON.stringify(PHYSICS_REPORT_MESSAGE).replace(/"/g, "'"),
    );
  });

  it('keeps the two plan caches at DIFFERENT locations', () => {
    // They carry different shapes parsed by different validators. One entry holding
    // both would be half-usable at either end, and the failure would look like "my
    // mixins stopped applying when I added a physics mod".
    expect(swConst('PHYSICS_CACHE_NAME')).not.toBe(swConst('PLAN_CACHE_NAME'));
    expect(swConst('PHYSICS_CACHE_URL')).not.toBe(swConst('PLAN_CACHE_URL'));
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
    expect(SW_SRC).toContain('isBundleProxyPath(rewrittenPath)');
    expect(SW_SRC).toContain('isBundleProxyPath(url.pathname)');
  });

  it('routes both fetch-handler branches through isWasmProxyPath too (#43)', () => {
    // The same-origin branch is the one the physics binary actually lands in (the
    // game requests it relative to the injected <base>), so a wasm matcher wired
    // only into the cross-origin branch would never fire in production.
    expect(SW_SRC).toContain('isWasmProxyPath(rewrittenPath)');
    expect(SW_SRC).toContain('isWasmProxyPath(url.pathname)');
  });

  it('reports the physics outcome on BOTH the POST and the plain-GET path', () => {
    // A wasm response carries no prelude, so the header is the only channel and the
    // SW is the only reader. Reporting on the POST alone would leave 'stale-pin' —
    // the case where no plan is even sent — permanently invisible.
    expect((SW_SRC.match(/reportPhysics\(res\.clone\(\)/g) ?? []).length).toBe(2);
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

describe('isWasmProxyPath — the paths the SW replays with the physics plan (#43)', () => {
  it.each(['/api/proxy/polytrack_physics.wasm', '/api/proxy/sim.wasm', '/api/proxy/a-b.c.wasm'])(
    'replays %s',
    (p) => {
      expect(isWasmProxyPath(p)).toBe(true);
    },
  );

  it.each([
    '/api/proxy/',
    '/api/proxy/main.bundle.js',
    '/api/proxy/sub/physics.wasm',
    '/api/proxy/../physics.wasm',
    '/api/proxy/physics.wasm/x',
    '/api/proxy/physics.wasm.js',
    '/api/proxy/physics.wasm?x=1',
    '/physics.wasm',
  ])('does not replay %s', (p) => {
    expect(isWasmProxyPath(p)).toBe(false);
  });

  it('never overlaps with the bundle matcher', () => {
    // The two POSTs carry different bodies and are read by different validators, so
    // a path matching both would get one of them sent to the wrong parser.
    for (const p of [
      '/api/proxy/main.bundle.js',
      '/api/proxy/112.bundle.js',
      '/api/proxy/polytrack_physics.wasm',
    ]) {
      expect(isBundleProxyPath(p) && isWasmProxyPath(p)).toBe(false);
    }
  });

  it('matches the SHAPE only — the route owns which binaries are declared', () => {
    expect(isWasmProxyPath('/api/proxy/anything_at_all.wasm')).toBe(true);
  });
});

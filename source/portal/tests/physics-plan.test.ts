/**
 * lib/physics-plan.ts — the browser half of #43.
 *
 * What is actually at stake here is different from every other plan in the portal. A
 * mixin that fails to parse means a patch that does not apply; a physics plan that
 * parses WRONG means a float written into a binary the game hands to
 * `WebAssembly.instantiate`. So these tests lean on two things:
 *
 *  1. every refusal is a refusal — nothing defaults, nothing is repaired, nothing
 *     half-applies;
 *  2. every drop is REPORTED. A physics mod that silently does nothing is the most
 *     confusing outcome this feature can produce, and `excluded` is the only channel
 *     the page has for saying why.
 *
 * The server re-validates all of it (`@tspml/wasm`'s `checkPlan`), so none of this is
 * the security boundary. It is the honesty boundary.
 */
import { describe, expect, it } from 'vitest';
import {
  asPhysicsReport,
  buildPhysicsPlan,
  parsePhysicsJson,
  parsePhysicsObject,
  PHYSICS_CACHE,
  PHYSICS_LIMITS,
  PHYSICS_REPORT_MESSAGE,
} from '../lib/physics-plan';
import { PLAN_CACHE } from '../lib/user-patches';
import type { UserModRecord } from '../lib/user-mods';

const HASH_A = 'd4ef02676973d41afc34b23b5248f6950b35dc4cc7e3047e3a9c6bd88e4c180e';
const HASH_B = 'a'.repeat(64);
const SIG_A = '1'.repeat(64);
const SIG_B = '2'.repeat(64);

function patch(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { name: 'grip', signature: SIG_A, oldValue: 1.05, newValue: 1.4, ...over };
}

function physics(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { wasmHash: HASH_A, patches: [patch()], ...over };
}

/**
 * `over` allows `undefined` per key (rather than being a plain
 * `Partial<UserModRecord>`) so a test can say `{ physics: undefined }` and mean
 * "this mod declares none". Under `exactOptionalPropertyTypes` a `Partial` would
 * refuse that, and the alternative — a second no-physics fixture — would let the
 * two drift.
 */
type ModOverrides = { [K in keyof UserModRecord]?: UserModRecord[K] | undefined };

function mod(id: string, over: ModOverrides = {}): UserModRecord {
  return {
    manifest: { id },
    code: 'export default {}',
    enabled: true,
    addedAt: '2026-08-21T00:00:00.000Z',
    physics: physics(),
    ...over,
  } as UserModRecord;
}

/** Assert a refusal and hand back the message, so each test can pin what it says. */
function refusal(r: ReturnType<typeof parsePhysicsJson>): string {
  expect(r.ok).toBe(false);
  if (r.ok) throw new Error('unreachable');
  return r.error;
}

describe('parsePhysicsJson — the paste box', () => {
  it('accepts a well-formed physics.json', () => {
    const r = parsePhysicsJson(JSON.stringify(physics()));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.wasmHash).toBe(HASH_A);
    expect(r.plan.patches).toEqual([
      { name: 'grip', signature: SIG_A, oldValue: 1.05, newValue: 1.4 },
    ]);
  });

  it.each([
    ['bare hex', HASH_A],
    ['sha256: prefixed (how the map writes it)', `sha256:${HASH_A}`],
    ['sha-256: prefixed', `sha-256:${HASH_A}`],
    ['upper case', HASH_A.toUpperCase()],
    ['surrounded by whitespace', `  ${HASH_A}\n`],
  ])('normalises a wasmHash written as %s to bare lower hex', (_label, raw) => {
    // Authors copy pins out of the map (prefixed) and out of `shasum` (bare).
    // Refusing one of those is a papercut with no safety value — but the plan that
    // leaves here must be bare, because the server compares it byte-for-byte
    // against `wasmHash()` output and a prefix would fail every plan.
    const r = parsePhysicsJson(JSON.stringify(physics({ wasmHash: raw })));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.wasmHash).toBe(HASH_A);
  });

  it('refuses a missing wasmHash rather than defaulting one', () => {
    // Without a pin nothing says the author ever saw these bytes, and a fingerprint
    // derived from another build is exactly the unverified write this path exists to
    // refuse. There is no sensible default: "the current binary" is the assumption
    // that makes the pin pointless.
    const { wasmHash: _drop, ...rest } = physics();
    expect(refusal(parsePhysicsJson(JSON.stringify(rest)))).toMatch(/needs "wasmHash"/);
  });

  it.each([
    ['not 64 chars', 'abc123'],
    ['non-hex characters', 'g'.repeat(64)],
    ['a number', 1234],
    ['null', null],
  ])('refuses a wasmHash that is %s', (_label, raw) => {
    expect(refusal(parsePhysicsJson(JSON.stringify(physics({ wasmHash: raw }))))).toMatch(
      /wasmHash/,
    );
  });

  it('refuses text that is not JSON, quoting the parser', () => {
    expect(refusal(parsePhysicsJson('{oops'))).toMatch(/not valid JSON/);
  });

  it.each([
    ['an array', '[]'],
    ['a bare string', '"physics"'],
    ['null', 'null'],
  ])('refuses %s at the top level', (_label, text) => {
    expect(refusal(parsePhysicsJson(text))).toMatch(/must be a JSON object/);
  });

  it('refuses a missing or empty patches array', () => {
    const { patches: _drop, ...rest } = physics();
    expect(refusal(parsePhysicsJson(JSON.stringify(rest)))).toMatch(/non-empty "patches"/);
    expect(refusal(parsePhysicsJson(JSON.stringify(physics({ patches: [] }))))).toMatch(
      /non-empty "patches"/,
    );
  });

  it('refuses a patch with no name, and names the index it could not label', () => {
    const e = refusal(parsePhysicsJson(JSON.stringify(physics({ patches: [patch({ name: '' })] }))));
    expect(e).toMatch(/patch 0/);
    expect(e).toMatch(/"name"/);
  });

  it('refuses a signature that is not a 64-char hex fingerprint', () => {
    const e = refusal(
      parsePhysicsJson(JSON.stringify(physics({ patches: [patch({ signature: 'deadbeef' })] }))),
    );
    // The refusal has to say what a signature IS — an author who wrote a function
    // name there needs to learn it is a fingerprint, not that "signature is invalid".
    expect(e).toMatch(/signature/);
    expect(e).toMatch(/fingerprint/);
    expect(e).toMatch(/grip/);
  });

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
  ])('refuses %s as newValue', (_label, v) => {
    // JSON cannot carry these literally, so they arrive as a hand-built object.
    // A non-finite physics constant is not a tuning choice, it is a sim that breaks
    // at speed, minutes in, rather than at load.
    const r = parsePhysicsObject(physics({ patches: [patch({ newValue: v })] }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/newValue/);
  });

  it.each([
    ['a string', '1.4'],
    ['null', null],
    ['absent', undefined],
  ])('refuses a newValue that is %s', (_label, v) => {
    const r = parsePhysicsObject(physics({ patches: [patch({ newValue: v })] }));
    expect(r.ok).toBe(false);
  });

  it('refuses a non-finite or non-numeric oldValue too', () => {
    expect(refusal(parsePhysicsObject(physics({ patches: [patch({ oldValue: '1.05' })] })))).toMatch(
      /oldValue/,
    );
    expect(
      refusal(parsePhysicsObject(physics({ patches: [patch({ oldValue: Number.NaN })] }))),
    ).toMatch(/oldValue/);
  });

  it('refuses a patch that is not an object', () => {
    expect(refusal(parsePhysicsJson(JSON.stringify(physics({ patches: ['grip'] }))))).toMatch(
      /patch 0 is not an object/,
    );
  });

  it('accepts exactly the per-mod cap and refuses one more', () => {
    const at = Array.from({ length: PHYSICS_LIMITS.maxPatchesPerMod }, (_, i) =>
      patch({ name: `p${i}`, signature: String(i % 10).repeat(64) }),
    );
    expect(parsePhysicsJson(JSON.stringify(physics({ patches: at }))).ok).toBe(true);
    const e = refusal(parsePhysicsJson(JSON.stringify(physics({ patches: [...at, patch()] }))));
    expect(e).toMatch(new RegExp(`limit is ${PHYSICS_LIMITS.maxPatchesPerMod}`));
  });

  it('keeps the parsed plan free of any field the author added', () => {
    // The plan is posted verbatim as the request body and handed to `checkPlan`.
    // Whatever an author pastes alongside must not ride along into it.
    const r = parsePhysicsJson(
      JSON.stringify(physics({ note: 'hi', patches: [patch({ enabled: false })] })),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.keys(r.plan).sort()).toEqual(['patches', 'wasmHash']);
    expect(Object.keys(r.plan.patches[0]!).sort()).toEqual([
      'name',
      'newValue',
      'oldValue',
      'signature',
    ]);
  });

  it('normalises a signature the same way it normalises the pin', () => {
    const r = parsePhysicsJson(
      JSON.stringify(physics({ patches: [patch({ signature: ` ${SIG_A.toUpperCase()} ` })] })),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.patches[0]!.signature).toBe(SIG_A);
  });
});

describe('parsePhysicsObject — re-reading a STORED row', () => {
  it('is the same validation as the paste path', () => {
    expect(parsePhysicsObject(physics())).toEqual(parsePhysicsJson(JSON.stringify(physics())));
  });

  it('does not round-trip through JSON — a cyclic stored object is refused, not thrown', () => {
    // localStorage cannot hold a cycle, but `buildPhysicsPlan` also runs over
    // in-memory records assembled by callers. `JSON.stringify` would throw here and
    // take the whole plan build down with it; refusing one row is the honest outcome.
    const cyclic: Record<string, unknown> = { wasmHash: HASH_A };
    cyclic.self = cyclic;
    expect(() => parsePhysicsObject(cyclic)).not.toThrow();
    expect(parsePhysicsObject(cyclic).ok).toBe(false);
  });
});

describe('buildPhysicsPlan — merging every enabled mod into ONE plan', () => {
  it('returns no plan when nothing declares physics', () => {
    const r = buildPhysicsPlan([mod('a', { physics: undefined }), mod('b', { physics: undefined })]);
    expect(r.plan).toBeNull();
    expect(r.excluded).toEqual([]);
  });

  it('returns no plan for an empty mod list', () => {
    expect(buildPhysicsPlan([])).toEqual({ plan: null, excluded: [] });
  });

  it('carries one mod through unchanged', () => {
    const r = buildPhysicsPlan([mod('a')]);
    expect(r.plan).toEqual({
      wasmHash: HASH_A,
      patches: [{ name: 'grip', signature: SIG_A, oldValue: 1.05, newValue: 1.4 }],
    });
    expect(r.excluded).toEqual([]);
  });

  it('merges two mods that pin the same binary into a single patch list', () => {
    // One binary, one all-or-nothing apply — so unlike the mixin plan there is no
    // per-mod isolation available. Every enabled mod's patches land in one array.
    const b = mod('b', { physics: physics({ patches: [patch({ name: 'drag', signature: SIG_B })] }) });
    const r = buildPhysicsPlan([mod('a'), b]);
    expect(r.excluded).toEqual([]);
    expect(r.plan?.patches.map((p) => p.name)).toEqual(['grip', 'drag']);
  });

  it('skips disabled mods entirely, without reporting an exclusion', () => {
    // A disabled mod is not a failure to explain — the user turned it off.
    const r = buildPhysicsPlan([mod('a', { enabled: false }), mod('b')]);
    expect(r.excluded).toEqual([]);
    expect(r.plan?.patches).toHaveLength(1);
    expect(r.plan?.patches[0]!.name).toBe('grip');
  });

  it('returns no plan when the only physics mod is disabled', () => {
    expect(buildPhysicsPlan([mod('a', { enabled: false })]).plan).toBeNull();
  });

  it('drops a mod pinning a DIFFERENT binary and says which two pins clashed', () => {
    // The two authors derived their fingerprints against different builds and there
    // is no way to tell from here which is current. Keeping the first is arbitrary
    // but stable; the point is that mixing them is not an option.
    const b = mod('b', { physics: physics({ wasmHash: HASH_B }) });
    const r = buildPhysicsPlan([mod('a'), b]);
    expect(r.plan?.wasmHash).toBe(HASH_A);
    expect(r.plan?.patches).toHaveLength(1);
    expect(r.excluded).toHaveLength(1);
    expect(r.excluded[0]!.modId).toBe('b');
    expect(r.excluded[0]!.reason).toBe('hash-conflict');
    expect(r.excluded[0]!.detail).toContain(HASH_B.slice(0, 12));
    expect(r.excluded[0]!.detail).toContain(HASH_A.slice(0, 12));
  });

  it('drops the LATER mod when two patch the same constant', () => {
    // The server refuses a whole plan whose patches resolve to one byte offset, so
    // sending both would take down the earlier mod as well.
    const b = mod('b', { physics: physics({ patches: [patch({ name: 'mine' })] }) });
    const r = buildPhysicsPlan([mod('a'), b]);
    expect(r.plan?.patches).toEqual([
      { name: 'grip', signature: SIG_A, oldValue: 1.05, newValue: 1.4 },
    ]);
    expect(r.excluded).toEqual([
      {
        modId: 'b',
        reason: 'duplicate-target',
        detail: "'mine' targets a constant another enabled mod already patches",
      },
    ]);
  });

  it('drops the WHOLE clashing mod, not just its clashing patch', () => {
    // Half a physics mod is a sim the author never tested. All-or-nothing per mod.
    const b = mod('b', {
      physics: physics({ patches: [patch({ name: 'fine', signature: SIG_B }), patch({ name: 'clash' })] }),
    });
    const r = buildPhysicsPlan([mod('a'), b]);
    expect(r.plan?.patches.map((p) => p.name)).toEqual(['grip']);
    expect(r.excluded[0]!.reason).toBe('duplicate-target');
  });

  it('treats the same signature at a DIFFERENT oldValue as a different site', () => {
    // A function can hold more than one constant; the fingerprint alone does not
    // identify the site. Collapsing these would refuse legitimate pairs of patches.
    const b = mod('b', {
      physics: physics({ patches: [patch({ name: 'other', oldValue: 9.5 })] }),
    });
    const r = buildPhysicsPlan([mod('a'), b]);
    expect(r.excluded).toEqual([]);
    expect(r.plan?.patches).toHaveLength(2);
  });

  it('drops a mod that would push the merged plan over the total cap', () => {
    const many = (n: number, seed: string) =>
      Array.from({ length: n }, (_, i) => patch({ name: `${seed}${i}`, signature: `${seed}${i}`.padEnd(64, '0') }));
    const a = mod('a', { physics: physics({ patches: many(PHYSICS_LIMITS.maxPatchesPerMod, 'a') }) });
    const b = mod('b', { physics: physics({ patches: many(PHYSICS_LIMITS.maxPatchesPerMod, 'b') }) });
    const c = mod('c', { physics: physics({ patches: many(4, 'c') }) });
    const r = buildPhysicsPlan([a, b, c]);
    expect(r.plan?.patches).toHaveLength(PHYSICS_LIMITS.maxPatchesTotal);
    expect(r.excluded).toEqual([
      {
        modId: 'c',
        reason: 'over-cap',
        detail: `the merged plan would exceed ${PHYSICS_LIMITS.maxPatchesTotal} patches`,
      },
    ]);
  });

  it('reports a stored row this build cannot parse as malformed, not as a cap problem', () => {
    // Stored rows passed paste-time validation, so this is a hand-edited store or an
    // older build's shape. Naming it 'over-cap' would send the author looking for a
    // limit they never hit.
    const bad = mod('b', { physics: { wasmHash: HASH_A, patches: [{ name: 'x' }] } });
    const r = buildPhysicsPlan([mod('a'), bad]);
    expect(r.plan?.patches).toHaveLength(1);
    expect(r.excluded).toHaveLength(1);
    expect(r.excluded[0]!.reason).toBe('malformed');
    expect(r.excluded[0]!.modId).toBe('b');
    expect(r.excluded[0]!.detail).toMatch(/signature/);
  });

  it('never throws on a hand-corrupted store', () => {
    const junk = [
      mod('a', { physics: {} }),
      mod('b', { physics: { wasmHash: 'nope', patches: [] } }),
      mod('c', { physics: { patches: 'all of them' } }),
    ];
    expect(() => buildPhysicsPlan(junk)).not.toThrow();
    const r = buildPhysicsPlan(junk);
    expect(r.plan).toBeNull();
    expect(r.excluded.map((e) => e.reason)).toEqual(['malformed', 'malformed', 'malformed']);
  });

  it('skips an id-less mod silently — the loader already pre-fails it', () => {
    const anon: UserModRecord = { ...mod('x'), manifest: {} };
    const r = buildPhysicsPlan([anon, mod('a')]);
    expect(r.excluded).toEqual([]);
    expect(r.plan?.patches).toHaveLength(1);
  });

  it('never mutates the records it reads', () => {
    const mods = [mod('a'), mod('b', { physics: physics({ wasmHash: HASH_B }) })];
    const before = JSON.stringify(mods);
    buildPhysicsPlan(mods);
    expect(JSON.stringify(mods)).toBe(before);
  });
});

describe('asPhysicsReport — reading what the service worker posts', () => {
  const good = {
    type: PHYSICS_REPORT_MESSAGE,
    file: 'polytrack_physics.wasm',
    status: 'patched',
    detail: 'applied 1 constant',
    applied: 1,
  };

  it('reads a well-formed report', () => {
    expect(asPhysicsReport(good)).toEqual(good);
  });

  it.each([
    ['a foreign message type', { ...good, type: 'other' }],
    ['no type at all', { file: 'a', status: 'b' }],
    ['a non-object', 'tspml:physics-report'],
    ['null', null],
    ['an array', []],
    ['a non-string file', { ...good, file: 7 }],
    ['a non-string status', { ...good, status: null }],
  ])('returns null for %s', (_label, data) => {
    // The page's message handler receives everything ANY worker posts, so this is a
    // guard over untrusted-shaped data, not a cast.
    expect(asPhysicsReport(data)).toBeNull();
  });

  it('defaults only the cosmetic fields, never file or status', () => {
    const r = asPhysicsReport({ type: PHYSICS_REPORT_MESSAGE, file: 'w.wasm', status: 'vanilla' });
    expect(r).toEqual({
      type: PHYSICS_REPORT_MESSAGE,
      file: 'w.wasm',
      status: 'vanilla',
      detail: '',
      applied: 0,
    });
  });

  it('passes an UNKNOWN status through verbatim', () => {
    // The status comes off a header this build does not validate. A status a future
    // route introduces must reach the log as itself rather than be coerced into a
    // wrong one the reader would then act on.
    expect(asPhysicsReport({ ...good, status: 'some-future-status' })?.status).toBe(
      'some-future-status',
    );
  });

  it('coerces a non-finite applied count to 0 rather than rendering NaN', () => {
    expect(asPhysicsReport({ ...good, applied: Number.NaN })?.applied).toBe(0);
    expect(asPhysicsReport({ ...good, applied: '3' })?.applied).toBe(0);
  });
});

describe('the two plan caches', () => {
  it('live at different names AND different urls', () => {
    // They carry different shapes read by different validators. One entry holding
    // both would be half-usable at either end, and the symptom would read as "my
    // mixins stopped applying when I added a physics mod".
    expect(PHYSICS_CACHE.name).not.toBe(PLAN_CACHE.name);
    expect(PHYSICS_CACHE.url).not.toBe(PLAN_CACHE.url);
  });

  it('keeps the cache url same-origin and under the portal-private prefix', () => {
    // A Cache API key is a URL. Anything but a same-origin path under our own prefix
    // risks colliding with a real route the game or the portal serves.
    expect(PHYSICS_CACHE.url.startsWith('/__tspml/')).toBe(true);
  });
});

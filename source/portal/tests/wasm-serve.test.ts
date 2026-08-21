/**
 * lib/wasm-serve.ts — deciding the BYTES for a physics request (#43).
 *
 * `wasm-surface.test.ts` covers which files may be patched. This covers what is
 * actually sent once one of them is fetched, and the one invariant worth stating up
 * front is the whole reason the module is written the way it is:
 *
 *   EVERY path that is not `patched` returns the upstream bytes byte-identical.
 *
 * Not "close to", not "re-encoded", not "a copy that should be the same". A game that
 * boots vanilla is a mod that did not apply, which is recoverable and legible. A game
 * handed corrupt bytes is a crash with no explanation, in a WebAssembly.instantiate
 * the player cannot read. So every refusal test below asserts byte equality against
 * the exact input array, and asserts the input was not mutated in place either.
 *
 * Synthetic binaries throughout (the real 396 KB physics binary is proprietary and
 * lives only in a gitignored cache, so a test needing it could not run in CI). What
 * these pin is the mechanism and the refusal posture; the measurements against the
 * real 0.6.2 binary are recorded in docs/research/wasm-structural-location.md.
 */
import { describe, expect, it } from 'vitest';
import { fingerprint, parseFunctions, wasmHash } from '@tspml/wasm';
import type { WasmSurface } from '../lib/transform-surface';
import { hashBytes, serveWasm } from '../lib/wasm-serve';

// ── synthetic wasm assembly (mirrors @tspml/wasm's tests/helpers.ts, which is not
//    exported from the package) ──────────────────────────────────────────────────

function uleb(n: number): number[] {
  const out: number[] = [];
  do {
    let b = n & 0x7f;
    n >>>= 7;
    if (n) b |= 0x80;
    out.push(b);
  } while (n);
  return out;
}

/** `f32.const <v>` as bytes. */
function f32const(v: number): number[] {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setFloat32(0, v, true);
  return [0x43, ...b];
}

/** A binary whose code section holds the given raw function bodies. Parsed only
 *  structurally, so the bodies need not be executable — just well-framed. */
function makeWasm(bodies: readonly number[][]): Uint8Array {
  const encoded = bodies.map((b) => [...uleb(b.length), ...b]);
  const content = [...uleb(bodies.length), ...encoded.flat()];
  return Uint8Array.from([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, // \0asm, version 1
    10, ...uleb(content.length), ...content, // code section
  ]);
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

// ── fixture ────────────────────────────────────────────────────────────────────

const GRIP = Math.fround(1.05);

/** A "grip function" holding one distinctive constant, plus a decoy function so the
 *  fingerprint has something to be distinct FROM. */
const GRIP_BODY = [0x20, 0x00, ...f32const(GRIP), 0x94, 0x0b];
const DECOY_BODY = [...f32const(1.5), 0x0b];
const WASM = makeWasm([DECOY_BODY, GRIP_BODY]);

function fnAt(buf: Uint8Array, i: number): ReturnType<typeof parseFunctions>[number] {
  const fn = parseFunctions(buf)[i];
  if (fn === undefined) throw new Error(`no function at index ${i}`);
  return fn;
}

const GRIP_SIG = fingerprint(WASM, fnAt(WASM, 1));

/** The surface pinned to WASM. `expectedHash` carries the `sha256:` prefix, as map
 *  pins do; the plan's own `wasmHash` is bare hex, as @tspml/wasm's do. Both forms
 *  appear here on purpose — they are different fields with different conventions,
 *  and a test that used one form throughout would not notice them being conflated. */
const SURFACE: WasmSurface = {
  kind: 'wasm',
  file: 'polytrack_physics.wasm',
  expectedHash: hashBytes(WASM),
  role: 'physics simulation',
};

const PLAN = {
  wasmHash: wasmHash(WASM),
  patches: [{ name: 'grip', signature: GRIP_SIG, oldValue: GRIP, newValue: 2 }],
};

/** Offset of the grip constant's 4-byte payload, for reading the write back. */
const GRIP_PAYLOAD = WASM.indexOf(0x43, fnAt(WASM, 1).start) + 1;

function readF32(buf: Uint8Array, offset: number): number {
  return new DataView(buf.buffer, buf.byteOffset, buf.byteLength).getFloat32(offset, true);
}

/** Assert a result served the upstream bytes untouched, and did not mutate the input
 *  array either. Every non-`patched` status must satisfy this. */
function servedVanilla(r: ReturnType<typeof serveWasm>, upstream: Uint8Array): void {
  expect(sameBytes(r.bytes, upstream)).toBe(true);
  expect(hashBytes(upstream)).toBe(r.vanillaHash);
  expect(r.applied).toBe(0);
  expect(r.leaderboardRisk).toBeNull();
}

describe('serveWasm — vanilla', () => {
  it('serves pinned bytes untouched when no plan is requested', () => {
    const upstream = new Uint8Array(WASM);
    const r = serveWasm(upstream, SURFACE, null);
    expect(r.status).toBe('vanilla');
    servedVanilla(r, WASM);
    expect(r.detail).toContain('polytrack_physics.wasm');
  });

  it('treats an absent plan the same as an explicit null', () => {
    // The route passes `user?.wasmPlan ?? null`, so undefined reaches here on the
    // ordinary GET path — by far the most common request this function ever sees.
    expect(serveWasm(new Uint8Array(WASM), SURFACE).status).toBe('vanilla');
    expect(serveWasm(new Uint8Array(WASM), SURFACE, undefined).status).toBe('vanilla');
  });
});

describe('serveWasm — stale pin', () => {
  /** Bytes that parse fine and are structurally identical in shape, but are not the
   *  pinned build. This is what a PolyTrack physics recompile looks like from here. */
  const RECOMPILED = makeWasm([DECOY_BODY, [0x20, 0x00, ...f32const(1.07), 0x94, 0x0b]]);

  it('serves vanilla and says so, rather than patching unverified bytes', () => {
    const r = serveWasm(RECOMPILED, SURFACE, PLAN);
    expect(r.status).toBe('stale-pin');
    servedVanilla(r, RECOMPILED);
    expect(r.detail).toContain(SURFACE.expectedHash);
  });

  it('refuses BEFORE consulting the plan at all', () => {
    // The order matters: on a new build the plan's fingerprints are unverified
    // against these bytes, so "does the plan look valid" is not a question worth
    // asking. A null plan and a live plan must reach the same verdict.
    for (const plan of [null, PLAN, { garbage: true }]) {
      const r = serveWasm(RECOMPILED, SURFACE, plan);
      expect(r.status).toBe('stale-pin');
      servedVanilla(r, RECOMPILED);
    }
  });

  it('reports the vanilla hash of what was actually fetched, not the pin', () => {
    // A mod author debugging a stale pin needs the hash they HAVE, to re-derive
    // against. Echoing the expected hash back would be useless and misleading.
    const r = serveWasm(RECOMPILED, SURFACE, PLAN);
    expect(r.vanillaHash).toBe(hashBytes(RECOMPILED));
    expect(r.vanillaHash).not.toBe(SURFACE.expectedHash);
  });
});

describe('serveWasm — patched', () => {
  it('writes the constant and reports the change', () => {
    const upstream = new Uint8Array(WASM);
    const r = serveWasm(upstream, SURFACE, PLAN);
    expect(r.status).toBe('patched');
    expect(r.applied).toBe(1);
    expect(readF32(r.bytes, GRIP_PAYLOAD)).toBe(2);
    expect(r.detail).toContain('grip');
  });

  it('never mutates the upstream array', () => {
    // The route hands us bytes it read from the upstream response; the caller may
    // still hash or forward them. Patching in place would make `vanillaHash`
    // describe bytes nobody has.
    const upstream = new Uint8Array(WASM);
    const r = serveWasm(upstream, SURFACE, PLAN);
    expect(sameBytes(upstream, WASM)).toBe(true);
    expect(readF32(upstream, GRIP_PAYLOAD)).toBe(GRIP);
    expect(r.bytes).not.toBe(upstream);
  });

  it('changes ONLY bytes inside the constant, leaving the binary framing intact', () => {
    // Neighbouring floats share most of their bytes, so "N bytes changed" is not a
    // property worth asserting. CONTAINMENT is: every differing byte must fall
    // inside the 4-byte f32 payload. A write that strayed one byte left would clobber
    // the 0x43 opcode and produce a binary that no longer instantiates.
    const r = serveWasm(new Uint8Array(WASM), SURFACE, PLAN);
    expect(r.bytes.length).toBe(WASM.length);
    const changed: number[] = [];
    for (let i = 0; i < WASM.length; i++) if (r.bytes[i] !== WASM[i]) changed.push(i);
    expect(changed.length).toBeGreaterThan(0);
    for (const i of changed) {
      expect(i).toBeGreaterThanOrEqual(GRIP_PAYLOAD);
      expect(i).toBeLessThan(GRIP_PAYLOAD + 4);
    }
  });

  it('always warns, because a physics change is ranked-play-relevant by definition', () => {
    // Warn, never block. There is no "small enough" physics edit: the classifier's
    // job is to tell the player, not to decide for them.
    const r = serveWasm(new Uint8Array(WASM), SURFACE, PLAN);
    expect(r.leaderboardRisk).toBe('warn');
  });

  it('reports the vanilla hash, not the patched one', () => {
    // `vanillaHash` answers "what did upstream serve" — the question a stale-pin
    // report and a patched report must answer identically for the same build.
    const r = serveWasm(new Uint8Array(WASM), SURFACE, PLAN);
    expect(r.vanillaHash).toBe(hashBytes(WASM));
    expect(r.vanillaHash).not.toBe(hashBytes(r.bytes));
  });
});

describe('serveWasm — plan refused', () => {
  const refusals: Record<string, unknown> = {
    'not an object': 'grip=2',
    'no wasmHash': { patches: PLAN.patches },
    'empty patches': { wasmHash: PLAN.wasmHash, patches: [] },
    'non-finite newValue': {
      wasmHash: PLAN.wasmHash,
      patches: [{ ...PLAN.patches[0], newValue: Number.POSITIVE_INFINITY }],
    },
    'signature matching no function': {
      wasmHash: PLAN.wasmHash,
      patches: [{ ...PLAN.patches[0], signature: 'f'.repeat(64) }],
    },
    'oldValue not at the located site': {
      wasmHash: PLAN.wasmHash,
      patches: [{ ...PLAN.patches[0], oldValue: 99.5 }],
    },
    'plan pinned to a different binary': {
      wasmHash: 'a'.repeat(64),
      patches: PLAN.patches,
    },
  };

  for (const [why, plan] of Object.entries(refusals)) {
    it(`serves vanilla for a plan with ${why}`, () => {
      const upstream = new Uint8Array(WASM);
      const r = serveWasm(upstream, SURFACE, plan);
      expect(r.status).toBe('plan-refused');
      servedVanilla(r, WASM);
      expect(r.detail).toMatch(/^physics plan refused: /);
    });
  }

  it('refuses the WHOLE plan when one patch of several fails', () => {
    // All-or-nothing. Half a physics plan is a handling model nobody authored and
    // nobody can reproduce; it is strictly worse than vanilla.
    const r = serveWasm(new Uint8Array(WASM), SURFACE, {
      wasmHash: PLAN.wasmHash,
      patches: [PLAN.patches[0], { ...PLAN.patches[0], name: 'ghost', oldValue: 99.5 }],
    });
    expect(r.status).toBe('plan-refused');
    servedVanilla(r, WASM);
    expect(r.detail).toContain('ghost');
  });

  it('reports a body that never became a plan as refused, not as vanilla', () => {
    // The route knows things this function cannot: the POST body was oversized, or was
    // not JSON. Both serve vanilla bytes — but reporting them AS `vanilla` would tell a
    // mod author "nobody asked for a patch" when they demonstrably did.
    const r = serveWasm(new Uint8Array(WASM), SURFACE, null, 'plan body is not JSON');
    expect(r.status).toBe('plan-refused');
    servedVanilla(r, WASM);
    expect(r.detail).toContain('not JSON');
  });

  it('lets a plan error win over a plan, but never over a stale pin', () => {
    // Ordering, stated: the pin gate runs first because on an unpinned build the plan
    // is unverifiable whatever shape it had, and "your plan was malformed" would be a
    // misleading answer to "this is not the build you pinned".
    const stale = makeWasm([DECOY_BODY]);
    expect(serveWasm(stale, SURFACE, PLAN, 'plan body is not JSON').status).toBe('stale-pin');
    expect(serveWasm(new Uint8Array(WASM), SURFACE, PLAN, 'too large').status).toBe(
      'plan-refused',
    );
  });

  it('keeps plan-refused distinct from vanilla, so a mod author can tell them apart', () => {
    // Both serve identical bytes. Collapsing them would make "my mod did nothing"
    // indistinguishable from "nobody asked", which is the single most confusing
    // thing this module could do.
    const refused = serveWasm(new Uint8Array(WASM), SURFACE, { nope: true });
    const vanilla = serveWasm(new Uint8Array(WASM), SURFACE, null);
    expect(sameBytes(refused.bytes, vanilla.bytes)).toBe(true);
    expect(refused.status).not.toBe(vanilla.status);
    expect(refused.detail).not.toBe(vanilla.detail);
  });
});

describe('serveWasm — the detail string crosses a header boundary', () => {
  /** Every status, so a new one cannot skip this check by existing. */
  const everyStatus = [
    serveWasm(new Uint8Array(WASM), SURFACE, null),
    serveWasm(new Uint8Array(WASM), SURFACE, PLAN),
    serveWasm(new Uint8Array(WASM), SURFACE, { nope: true }),
    serveWasm(makeWasm([DECOY_BODY]), SURFACE, PLAN),
  ];

  it('produces a non-empty reason for every status', () => {
    const seen = new Set(everyStatus.map((r) => r.status));
    expect(seen).toEqual(new Set(['vanilla', 'patched', 'plan-refused', 'stale-pin']));
    for (const r of everyStatus) expect(r.detail.length).toBeGreaterThan(0);
  });

  it('stays inside Latin-1 and carries no CR/LF', () => {
    // A response header value is a ByteString: one character above U+00FF throws
    // inside the Response constructor and the request dies with no body at all
    // (#106 shipped exactly that, from an em-dash). setDetailHeader sanitises, but
    // these strings should not be relying on it — an arrow here is `->`, not `→`.
    for (const r of everyStatus) {
      expect(r.detail).not.toMatch(/[\r\n]/);
      for (const ch of r.detail) expect(ch.codePointAt(0)).toBeLessThanOrEqual(0xff);
    }
  });
});

describe('hashBytes', () => {
  it('produces the `sha256:`-prefixed form the map pins use', () => {
    expect(hashBytes(WASM)).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(hashBytes(WASM)).toBe(`sha256:${wasmHash(WASM)}`);
  });

  it('hashes the VIEW, not the whole backing buffer', () => {
    // Node's Buffer allocates small buffers out of a shared 8 KB pool, so bytes read
    // from a request body routinely arrive with a non-zero byteOffset. Hashing
    // `.buffer` instead of the view would fold in a neighbour's bytes and make the
    // pin gate fail at random.
    const pool = new Uint8Array(WASM.length + 64).fill(0xab);
    pool.set(WASM, 32);
    const view = new Uint8Array(pool.buffer, 32, WASM.length);
    expect(hashBytes(view)).toBe(hashBytes(WASM));
  });

  it('lets an offset view through the whole serve path unharmed', () => {
    const pool = new Uint8Array(WASM.length + 64).fill(0xab);
    pool.set(WASM, 8);
    const view = new Uint8Array(pool.buffer, 8, WASM.length);
    const r = serveWasm(view, SURFACE, PLAN);
    expect(r.status).toBe('patched');
    expect(readF32(r.bytes, GRIP_PAYLOAD)).toBe(2);
    // ...and the neighbouring pool bytes are untouched.
    expect(pool[7]).toBe(0xab);
    expect(pool[8 + WASM.length]).toBe(0xab);
  });
});

describe('serveWasm — pin comparison', () => {
  it('accepts a pin written without the prefix or in a different case', () => {
    // The map resolvers normalise `sha256:` and case; this gate must agree with them
    // or a hand-edited map would serve vanilla forever with no explanation. It cannot
    // cause a false match: different bytes differ in at least one hex digit.
    const bare = hashBytes(WASM).replace(/^sha256:/, '');
    for (const h of [bare, bare.toUpperCase(), `SHA256:${bare}`, ` ${hashBytes(WASM)} `]) {
      expect(serveWasm(new Uint8Array(WASM), { ...SURFACE, expectedHash: h }, null).status).toBe(
        'vanilla',
      );
    }
  });

  it('still refuses a pin that differs by one hex digit', () => {
    const bare = hashBytes(WASM).replace(/^sha256:/, '');
    const flipped = `sha256:${bare[0] === '0' ? '1' : '0'}${bare.slice(1)}`;
    expect(serveWasm(new Uint8Array(WASM), { ...SURFACE, expectedHash: flipped }, null).status).toBe(
      'stale-pin',
    );
  });
});

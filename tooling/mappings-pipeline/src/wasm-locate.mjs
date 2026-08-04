// wasm-locate.mjs — structural location of constants inside a WebAssembly binary.
//
// The #43 spike. PML v0.6.2 patches `polytrack_physics.wasm` by raw byte offset
// (`PATCH_F32 @ 0x1234`). That works until the next recompile, and its failure mode
// is the bad one: a stale offset does not fail to match, it writes to whatever now
// lives at that address — arbitrary corruption of the physics sim, not a missed patch.
//
// This module answers the open question #43 poses: can a physics constant be located
// *structurally* — by the shape of the code around it — so the map stays re-derivable
// across recompiles, the way anchor discipline works for JS? Measured answer: yes,
// for 97.4% of functions in the shipped 0.6.2 binary. See README + docs/research.
//
// Nothing here patches anything. Locating is the hard, durable half; a writer built
// on top of it is a later decision, and one gated on the fail-closed hashing that
// #43 (correctly) insists on.
//
// Pure Node built-ins, no wasm runtime — we parse the binary format directly.

import { createHash } from 'node:crypto';

/** Section ids we care about; `10` is the code section (function bodies). */
const CODE_SECTION = 10;
const F32_CONST = 0x43;
const F64_CONST = 0x44;

/** Read an unsigned LEB128 at `off`. @returns {[number, number]} `[value, nextOffset]` */
export function readULEB(buf, off) {
  let result = 0;
  let shift = 0;
  let i = off;
  for (;;) {
    if (i >= buf.length) throw new Error(`truncated LEB128 at ${off}`);
    const byte = buf[i++];
    result += (byte & 0x7f) * 2 ** shift;
    shift += 7;
    if ((byte & 0x80) === 0) break;
    if (shift > 35) throw new Error(`LEB128 too long at ${off}`);
  }
  return [result, i];
}

/**
 * Walk the top-level section headers.
 * @returns {{id:number,start:number,size:number}[]} `start` is the first content byte.
 */
export function parseSections(buf) {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x0061736d) {
    throw new Error('not a wasm binary (bad \\0asm magic)');
  }
  const sections = [];
  let p = 8;
  while (p < buf.length) {
    const id = buf[p];
    const [size, q] = readULEB(buf, p + 1);
    if (q + size > buf.length) throw new Error(`section ${id} overruns the buffer`);
    sections.push({ id, start: q, size });
    p = q + size;
  }
  return sections;
}

/**
 * Split the code section into function bodies.
 *
 * `idx` is the position within the code section — NOT a stable identifier across
 * recompiles, which is the whole reason the fingerprint below exists. It is useful
 * only for reporting inside a single binary.
 *
 * @returns {{idx:number,start:number,size:number}[]}
 */
export function parseFunctions(buf) {
  const code = parseSections(buf).find((s) => s.id === CODE_SECTION);
  if (!code) throw new Error('wasm has no code section');
  let [count, p] = readULEB(buf, code.start);
  const fns = [];
  for (let k = 0; k < count; k++) {
    const [size, q] = readULEB(buf, p);
    fns.push({ idx: k, start: q, size });
    p = q + size;
  }
  const end = code.start + code.size;
  if (p !== end) {
    // A clean parse consumes the section exactly. Anything else means we have
    // misread the format, and every offset downstream would be quietly wrong —
    // exactly the silent-corruption class this module exists to avoid.
    throw new Error(`code section parse ended at ${p}, expected ${end}`);
  }
  return fns;
}

/** Every float constant in a body, as tagged strings (order-independent). */
export function constantsIn(buf, fn) {
  const end = fn.start + fn.size;
  const out = [];
  for (let i = fn.start; i < end; i++) {
    if (buf[i] === F32_CONST && i + 5 <= end) {
      const v = buf.readFloatLE(i + 1);
      if (Number.isFinite(v)) out.push(`f32:${v}`);
    } else if (buf[i] === F64_CONST && i + 9 <= end) {
      const v = buf.readDoubleLE(i + 1);
      if (Number.isFinite(v)) out.push(`f64:${v}`);
    }
  }
  return out;
}

/**
 * A relocation-invariant fingerprint of one function body.
 *
 * Deliberately built only from things a recompile preserves when the *logic* is
 * unchanged — the multiset of float constants and the histogram of opcode bytes.
 * It contains no offsets, no function index, and no absolute address, so shifting
 * the binary cannot change it.
 *
 * The byte histogram is a coarse, cheap proxy for "same instruction mix". It is
 * scanned bytewise rather than decoded, so immediate operands pollute it slightly;
 * that costs some precision (see the collision rate in the README) and buys not
 * having to implement a full instruction decoder. Precision, not correctness, is
 * what a better decoder would improve.
 */
export function fingerprint(buf, fn) {
  const consts = constantsIn(buf, fn).sort();
  const hist = new Uint32Array(256);
  for (let i = fn.start; i < fn.start + fn.size; i++) hist[buf[i]]++;
  return createHash('sha256')
    .update(`${consts.join('|')}#${hist.join(',')}`)
    .digest('hex');
}

/**
 * Fingerprint every function and report how many are uniquely identified.
 * This is the measurement that decides whether structural location is viable at all.
 */
export function fingerprintAll(buf) {
  const fns = parseFunctions(buf);
  const bySig = new Map();
  for (const fn of fns) {
    const sig = fingerprint(buf, fn);
    if (!bySig.has(sig)) bySig.set(sig, []);
    bySig.get(sig).push(fn);
  }
  const groups = [...bySig.values()];
  return {
    total: fns.length,
    distinct: bySig.size,
    unique: groups.filter((g) => g.length === 1).length,
    collisions: groups.filter((g) => g.length > 1).map((g) => g.map((f) => f.idx)),
    bySig,
  };
}

/**
 * Re-derive a function's location in a (possibly recompiled) binary from a
 * fingerprint recorded against an earlier build.
 *
 * **Fails closed.** Returns `{ ok: false }` on zero matches *and* on more than one —
 * an ambiguous match is not "pick the first". For JS a mis-target means a patch that
 * does nothing; here it would mean writing a float into an unrelated function, so
 * anything short of a unique match must refuse. This mirrors the resolver's
 * `bundleHash` posture: serve vanilla rather than mis-target.
 */
export function locateBySignature(buf, sig) {
  const matches = parseFunctions(buf).filter((fn) => fingerprint(buf, fn) === sig);
  if (matches.length === 1) return { ok: true, fn: matches[0] };
  return {
    ok: false,
    reason: matches.length === 0 ? 'not-found' : 'ambiguous',
    count: matches.length,
  };
}

/**
 * Byte offsets of every `f32.const <value>` inside a located function.
 *
 * The offset returned is where the 4-byte IEEE-754 payload begins (i.e. after the
 * 0x43 opcode) — the address a patcher would write to. It is derived at *runtime*
 * from the current binary, never stored in a map, which is the entire point.
 */
export function f32ConstSites(buf, fn, value) {
  const end = fn.start + fn.size;
  const sites = [];
  for (let i = fn.start; i < end; i++) {
    if (buf[i] !== F32_CONST || i + 5 > end) continue;
    const v = buf.readFloatLE(i + 1);
    if (value === undefined || Object.is(Math.fround(value), v)) {
      sites.push({ payloadOffset: i + 1, value: v });
    }
  }
  return sites;
}

/**
 * Structural location of constants inside a WebAssembly binary (#43).
 *
 * PolyTrack's own physics patching analog (PML v0.6.2) rewrites
 * `polytrack_physics.wasm` by raw byte offset. That works until the next
 * recompile, and its failure mode is the bad one: a stale offset does not fail to
 * match, it writes to whatever now lives at that address — arbitrary corruption of
 * the physics sim, not a missed patch.
 *
 * This module answers the question #43 poses: can a physics constant be located
 * *structurally* — by the shape of the code around it — so the map stays
 * re-derivable across recompiles, the way anchor discipline works for JS? Measured
 * answer: yes, for 97.4% of functions in the shipped 0.6.2 binary. See
 * `docs/research/wasm-structural-location.md`.
 *
 * Nothing here patches anything; `patch.ts` is the writer built on top.
 *
 * ── Why this is a package and not a pipeline script ──────────────────────────
 * It began in `tooling/mappings-pipeline`, which is a DEV-ONLY workspace (it pulls
 * webcrack, whose optional native build CI has to skip). The portal cannot depend
 * on that, so the code had to move before anything could reach it at runtime. The
 * pipeline now imports this package rather than keeping a second copy: two
 * implementations of a fail-closed binary patcher is exactly the drift you find out
 * about by corrupting someone's physics sim.
 *
 * No `Buffer`, no `node:` imports beyond the hash: the bytes are plain
 * `Uint8Array` so this runs in a lambda, a worker, or a test unchanged.
 */
import { createHash } from 'node:crypto';

/** Section ids we care about; `10` is the code section (function bodies). */
const CODE_SECTION = 10;
const F32_CONST = 0x43;
const F64_CONST = 0x44;

/** A parsed top-level section header. `start` is the first content byte. */
export interface WasmSection {
  readonly id: number;
  readonly start: number;
  readonly size: number;
}

/**
 * One function body inside the code section.
 *
 * `idx` is the position within the code section — NOT a stable identifier across
 * recompiles, which is the whole reason {@link fingerprint} exists. It is useful
 * only for reporting inside a single binary.
 */
export interface WasmFunction {
  readonly idx: number;
  readonly start: number;
  readonly size: number;
}

/** One `f32.const` site: where its 4-byte payload begins, and what it holds. */
export interface F32Site {
  readonly payloadOffset: number;
  readonly value: number;
}

/** A located function, or a fail-closed refusal. Never "pick the first". */
export type LocateResult =
  | { readonly ok: true; readonly fn: WasmFunction }
  | { readonly ok: false; readonly reason: 'not-found' | 'ambiguous'; readonly count: number };

/** A little-endian view over the bytes, for the float and magic reads. */
function viewOf(buf: Uint8Array): DataView {
  return new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
}

/** Read an unsigned LEB128 at `off`. Returns `[value, nextOffset]`. */
export function readULEB(buf: Uint8Array, off: number): [number, number] {
  let result = 0;
  let shift = 0;
  let i = off;
  for (;;) {
    if (i >= buf.length) throw new Error(`truncated LEB128 at ${off}`);
    const byte = buf[i++]!;
    result += (byte & 0x7f) * 2 ** shift;
    shift += 7;
    if ((byte & 0x80) === 0) break;
    if (shift > 35) throw new Error(`LEB128 too long at ${off}`);
  }
  return [result, i];
}

/** Walk the top-level section headers. */
export function parseSections(buf: Uint8Array): WasmSection[] {
  if (buf.length < 8 || viewOf(buf).getUint32(0, false) !== 0x0061736d) {
    throw new Error('not a wasm binary (bad \\0asm magic)');
  }
  const sections: WasmSection[] = [];
  let p = 8;
  while (p < buf.length) {
    const id = buf[p]!;
    const [size, q] = readULEB(buf, p + 1);
    if (q + size > buf.length) throw new Error(`section ${id} overruns the buffer`);
    sections.push({ id, start: q, size });
    p = q + size;
  }
  return sections;
}

/** Split the code section into function bodies. */
export function parseFunctions(buf: Uint8Array): WasmFunction[] {
  const code = parseSections(buf).find((s) => s.id === CODE_SECTION);
  if (!code) throw new Error('wasm has no code section');
  const [count, first] = readULEB(buf, code.start);
  let p = first;
  const fns: WasmFunction[] = [];
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
export function constantsIn(buf: Uint8Array, fn: WasmFunction): string[] {
  const view = viewOf(buf);
  const end = fn.start + fn.size;
  const out: string[] = [];
  for (let i = fn.start; i < end; i++) {
    if (buf[i] === F32_CONST && i + 5 <= end) {
      const v = view.getFloat32(i + 1, true);
      if (Number.isFinite(v)) out.push(`f32:${v}`);
    } else if (buf[i] === F64_CONST && i + 9 <= end) {
      const v = view.getFloat64(i + 1, true);
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
 * that costs some precision (4 collision groups in the real binary) and buys not
 * having to implement a full instruction decoder. Precision, not correctness, is
 * what a better decoder would improve.
 */
export function fingerprint(buf: Uint8Array, fn: WasmFunction): string {
  const consts = constantsIn(buf, fn).sort();
  const hist = new Uint32Array(256);
  for (let i = fn.start; i < fn.start + fn.size; i++) {
    const byte = buf[i]!;
    hist[byte] = hist[byte]! + 1;
  }
  return createHash('sha256').update(`${consts.join('|')}#${hist.join(',')}`).digest('hex');
}

/** What {@link fingerprintAll} measured about a binary. */
export interface FingerprintReport {
  readonly total: number;
  readonly distinct: number;
  readonly unique: number;
  readonly collisions: number[][];
  readonly bySig: Map<string, WasmFunction[]>;
}

/**
 * Fingerprint every function and report how many are uniquely identified.
 * This is the measurement that decides whether structural location is viable at all.
 */
export function fingerprintAll(buf: Uint8Array): FingerprintReport {
  const fns = parseFunctions(buf);
  const bySig = new Map<string, WasmFunction[]>();
  for (const fn of fns) {
    const sig = fingerprint(buf, fn);
    const group = bySig.get(sig);
    if (group === undefined) bySig.set(sig, [fn]);
    else group.push(fn);
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
export function locateBySignature(buf: Uint8Array, sig: string): LocateResult {
  const matches = parseFunctions(buf).filter((fn) => fingerprint(buf, fn) === sig);
  const first = matches[0];
  if (matches.length === 1 && first !== undefined) return { ok: true, fn: first };
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
 *
 * Physics runs in f32, so a caller passing a JS double must compare through
 * `Math.fround` (this does) or it finds nothing and reads that as "constant absent".
 */
export function f32ConstSites(buf: Uint8Array, fn: WasmFunction, value?: number): F32Site[] {
  const view = viewOf(buf);
  const end = fn.start + fn.size;
  const sites: F32Site[] = [];
  for (let i = fn.start; i < end; i++) {
    if (buf[i] !== F32_CONST || i + 5 > end) continue;
    const v = view.getFloat32(i + 1, true);
    if (value === undefined || Object.is(Math.fround(value), v)) {
      sites.push({ payloadOffset: i + 1, value: v });
    }
  }
  return sites;
}

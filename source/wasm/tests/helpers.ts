/**
 * Synthetic wasm assembly for the #43 tests.
 *
 * These build binaries byte by byte rather than reading the game's
 * `polytrack_physics.wasm`: the real binary is proprietary and lives only in the
 * gitignored `.cache/`, so a test that needed it could not run in CI. The measured
 * results against the real 0.6.2 binary are recorded in
 * `docs/research/wasm-structural-location.md`; these tests pin the *mechanism*.
 */

/** Minimal LEB128 writer (values here are all small, but keep it general). */
export function uleb(n: number): number[] {
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
export function f32const(v: number): number[] {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setFloat32(0, v, true);
  return [0x43, ...b];
}

/**
 * Assemble a wasm binary whose code section holds the given function bodies.
 * Each body is a raw opcode array; we only ever parse it structurally, so it does
 * not need to be executable — just well-formed at the section/body framing level.
 */
export function makeWasm(bodies: readonly number[][]): Uint8Array {
  const encoded = bodies.map((b) => [...uleb(b.length), ...b]);
  const content = [...uleb(bodies.length), ...encoded.flat()];
  return Uint8Array.from([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, // \0asm, version 1
    10, ...uleb(content.length), ...content, // code section
  ]);
}

/** Read an f32 back out of a binary, for assertions. */
export function readF32(buf: Uint8Array, offset: number): number {
  return new DataView(buf.buffer, buf.byteOffset, buf.byteLength).getFloat32(offset, true);
}

/** Byte-equality, replacing Buffer#equals. */
export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

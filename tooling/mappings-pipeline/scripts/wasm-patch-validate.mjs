// One-shot local validation of the #43 writer against the real cached physics
// binary (gitignored .cache/ — local read only, never committed or uploaded).
// Picks a uniquely-fingerprinted function with a distinctive single-occurrence
// f32 constant, applies a doubling patch, and proves: every changed byte lies
// inside the 4-byte f32 field at the reported offset, the field reads back as the
// new value, and a stale-hash plan refuses.
//
// Note the property is CONTAINMENT, not a count. The writer always stores 4 bytes,
// but a diff only counts bytes that actually differ, and f32 neighbours share most
// of their encoding — 2.0 to 4.0 flips a single byte. Asserting "4 bytes changed"
// would fail on a correct patch.
//
// The locator and writer live in @tspml/wasm, not here: the portal serves patched
// physics bytes from the same code, and this package is dev-only tooling nothing at
// runtime can depend on. One implementation, two callers.
import fs from 'node:fs';
import { applyF32Patches, f32ConstSites, fingerprintAll, wasmHash } from '@tspml/wasm';

const buf = fs.readFileSync(new URL('../.cache/pt-0.6.2-polytrack_physics.wasm', import.meta.url));
const hash = wasmHash(buf);
console.log('binary:', buf.length, 'bytes, sha256', hash.slice(0, 16));

const all = fingerprintAll(buf);
let chosen = null;
for (const [sig, fns] of all.bySig) {
  if (fns.length !== 1) continue;
  const sites = f32ConstSites(buf, fns[0]);
  const counts = new Map();
  for (const s of sites) counts.set(s.value, (counts.get(s.value) ?? 0) + 1);
  const uniq = sites.filter((s) => counts.get(s.value) === 1 && Math.abs(s.value) > 1 && Math.abs(s.value) < 100);
  if (uniq.length > 0) {
    chosen = { sig, fn: fns[0], site: uniq[0] };
    break;
  }
}
if (!chosen) {
  console.log('no candidate found');
  process.exit(1);
}
console.log('candidate fn idx', chosen.fn.idx, 'constant', chosen.site.value, '@ payload', chosen.site.payloadOffset);

const plan = {
  wasmHash: hash,
  patches: [{ name: 'probe', signature: chosen.sig, oldValue: chosen.site.value, newValue: chosen.site.value * 2 }],
};
const r = applyF32Patches(buf, plan);
if (r.ok !== true) {
  console.log('REFUSED:', r.reason);
  process.exit(1);
}
const diffs = [];
for (let i = 0; i < buf.length; i++) if (buf[i] !== r.bytes[i]) diffs.push(i);
const at = r.report.applied[0].payloadOffset;
const contained = diffs.every((i) => i >= at && i < at + 4);
console.log('bytes changed:', diffs.length, 'at', diffs.join(','), '— all inside the f32 at', at, ':', contained);
if (!contained || diffs.length === 0) {
  console.log('FAIL: a patch must change something, and only within its own field');
  process.exit(1);
}
// r.bytes is a plain Uint8Array (the package avoids Buffer so it runs in a
// lambda or worker unchanged), so read the float through a DataView.
const readBack = new DataView(r.bytes.buffer, r.bytes.byteOffset, r.bytes.byteLength)
  .getFloat32(r.report.applied[0].payloadOffset, true);
console.log('new value read back:', readBack, 'expected', Math.fround(chosen.site.value * 2));
console.log('risk:', r.report.leaderboardRisk);

const stale = { ...plan, wasmHash: '0'.repeat(64) };
const rs = applyF32Patches(buf, stale);
console.log('stale-pin plan:', rs.ok !== true ? `refused — ${rs.reason.slice(0, 60)}` : 'APPLIED (BAD)');

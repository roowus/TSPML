// One-shot local validation of the #43 writer against the real cached physics
// binary (gitignored .cache/ — local read only, never committed or uploaded).
// Picks a uniquely-fingerprinted function with a distinctive single-occurrence
// f32 constant, applies a doubling patch, and proves: exactly 4 bytes changed,
// at the reported offset, and a stale-hash plan refuses.
import fs from 'node:fs';
import { f32ConstSites, fingerprintAll } from '../src/wasm-locate.mjs';
import { applyF32Patches, wasmHash } from '../src/wasm-patch.mjs';

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
console.log('bytes changed:', diffs.length, 'first at', diffs[0], '— report payloadOffset', r.report.applied[0].payloadOffset);
console.log('new value read back:', r.bytes.readFloatLE(r.report.applied[0].payloadOffset), 'expected', Math.fround(chosen.site.value * 2));
console.log('risk:', r.report.leaderboardRisk);

const stale = { ...plan, wasmHash: '0'.repeat(64) };
const rs = applyF32Patches(buf, stale);
console.log('stale-pin plan:', rs.ok !== true ? `refused — ${rs.reason.slice(0, 60)}` : 'APPLIED (BAD)');

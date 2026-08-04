# Structural location of WASM constants (#43 spike)

> Can a physics constant inside `polytrack_physics.wasm` be located by the *shape* of
> the surrounding code rather than by a raw byte offset — so the map stays
> re-derivable across recompiles, the way anchor discipline works for JS?
>
> **Measured answer: yes, for 97.4% of functions in the shipped 0.6.2 binary.**
> Tool: [`tooling/mappings-pipeline/src/wasm-locate.mjs`](../../tooling/mappings-pipeline/src/wasm-locate.mjs).

## Why the question matters

[#43](https://github.com/roowus/TSPML/issues/43) is the one capability gap identified
in PML's favour: `v0.6.2` shipped `registerPhysicsMixin`, byte-offset patching of the
physics WASM (`PATCH_F32 @ <offset>`). Physics tuning — gravity, grip, top speed,
drift — is a headline mod category, and "you can't change how the car drives" is a
real answer to "why switch loaders".

But copying their offset table would import their fragility. As #43 puts it, an offset
has none of the robustness properties that make the JS map worth having, and the
failure mode is worse than JS's:

| | stale JS anchor | stale WASM offset |
|---|---|---|
| Result | patch does not apply | **writes a float into whatever now lives there** |
| Detectable | yes — no match | no — the write succeeds |

So the durable version of this feature needs a locator that can be **re-derived**, not
a constant that must be **re-measured**. That is what this spike tested.

## Finding 1 — the binary has not changed across the entire 0.6.x line

Fetched from the CDN and hashed:

| Version | `polytrack_physics.wasm` | sha256 |
|---|---|---|
| 0.6.0 | 396,005 B | `d4ef0267…4c180e` |
| 0.6.1 | 396,005 B | `d4ef0267…4c180e` |
| 0.6.2 | 396,005 B | `d4ef0267…4c180e` |

**Byte-identical.** The JS bundle re-minifies every release; the physics binary has
not moved once across the three shipped 0.6.x builds. (0.5.x and 0.6.3/0.7.0 return
404 at that path — the artifact is not versioned back that far, and there is no newer
release.)

This reframes the urgency: patching physics is *currently* stable against a raw
offset, and PML's approach works today. It is the **next recompile** that breaks it,
silently. It also means a wasm-specific hash pin — which #43 argues is required — is
cheap right now, because there is exactly one hash to pin.

Note the artifact lives at `<ver>/polytrack_physics.wasm`, not under `lib/` where the
glue's `importScripts("lib/polytrack_physics.js")` might suggest; the glue resolves
the `.wasm` relative to the document, not to itself.

## Finding 2 — there is no name section to lean on

The binary exports 14 symbols, all single-letter (`j`, `k`, `l`, …), and carries no
custom `name` section. Nothing identifies a function semantically. Structural matching
is not merely the better option here — it is the only one.

Section inventory: type, import, func, table, memory, global, export, elem,
datacount, **code (376,167 B, 549 function bodies)**, data.

## Finding 3 — constants alone are not enough to locate

Scanning the code section:

- **36** distinct plausible `f64` constants — all math-library (π, π/2, trig
  polynomial coefficients). No physics values.
- **98** distinct plausible `f32` constants — this is where the game's own numbers
  live (`0.02`, `1000`, `1.05`, `0.05`, `20`, `10`, …).

Physics runs in **f32**, which matters for any future patcher: a caller passing a JS
double must compare through `Math.fround` or it finds nothing and reads that as
"constant absent".

Two negative results worth recording:

- **No gravity constant.** Nothing in the 9–10.5 range beyond a plain `10`. The Bullet
  integration presumably takes gravity as a runtime parameter rather than baking it
  in, so "patch gravity in the WASM" may not even be the right shape for that
  particular knob.
- **Idiom matching is ambiguous.** A symmetric-clamp signature (`f32.const v` … 
  `f32.const -v` within a short window) for ±10 matches **3 distinct sites**. This is
  precisely the `"PolyTrack2"` anchor problem from
  [mappings-system.md](../design/mappings-system.md) — a locally-plausible pattern
  that is not unique.

## Finding 4 — function fingerprints locate uniquely (the result)

Instead of locating the *constant*, locate the *function that contains it*, then index
the constant within it.

Fingerprint = **sorted multiset of float constants** + **histogram of opcode bytes**.
Both are properties a recompile preserves when the logic is unchanged; neither
contains an offset, an index, or an address.

Against the real 0.6.2 binary:

| Fingerprint | Uniquely identified |
|---|---|
| constants only | 151 / 188 functions that have any constant |
| constants + opcode histogram | **535 / 549 (97.4%)** |

Four collision groups remain (sizes 7, 2, 2, 3) — near-certainly template
instantiations or inlined duplicates that are genuinely byte-identical, which no
signature can separate.

**Relocation was tested for real, not asserted.** Inserting 4,096 bytes before the
code section shifts every body:

```
old offset 343475 -> now points at byte 0x18 (garbage)
matches by signature: 1
relocated to: 347571 (= 343475 + 4096) ✓
```

A hardcoded offset writes to the wrong place; the signature re-derives the exact new
address, uniquely.

## What this buys, and what it does not

It buys the **analog of anchor discipline for WASM**: a map entry can record a
fingerprint instead of an offset, and the offset gets computed at load time against
the binary actually present. A recompile that preserves a function's logic keeps
working with no map edit; one that changes it produces **`not-found`, not a
mis-write**.

`locateBySignature` therefore **fails closed on ambiguity as well as absence** —
`{ ok: false, reason: 'ambiguous' }`, never "pick the first". Same posture as the
resolver's `bundleHash` gate: serve vanilla rather than mis-target.

It does **not** deliver physics patching. Deliberately out of scope here:

- **No writer.** Locating is the durable half; a patcher is a separate decision that
  must be gated on the wasm-specific hash pin #43 calls for.
- **The opcode histogram is a coarse proxy.** Bytes are counted, not decoded, so
  immediate operands pollute the histogram. That costs precision, not correctness — a
  real instruction decoder would shrink the 4 collision groups.
- **Cross-version validation is not yet possible.** Every shipped 0.6.x binary is
  identical, so there is no second version to re-match against. The relocation test
  above is synthetic for exactly that reason. **The first real test of this approach
  is the next PolyTrack release** — and that is the moment to run
  `fingerprintAll` against the new binary and compare.
- **Physics mods stay leaderboard-relevant.** Anything built on this must feed the
  warn-only `classifySafety` labelling, per #43.

## Legal posture

Unchanged and load-bearing. The binary was fetched into the **gitignored `.cache/`**
for offline analysis and is **never committed** — only measurements ship. The unit
tests build synthetic wasm binaries byte by byte so they run in CI without the
proprietary artifact. PML is unlicensed: the design problem was read from their
public behaviour and the issue write-up; no code was copied.

# PML's API story, and an honest re-scoring of our moat

> **2026-08-03.** Prompted by a direct question — *"doesn't PML also have APIs?"* — which
> [polymodloader-analysis.md](./polymodloader-analysis.md) answers only for tag `0.6.1`.
> PML has since shipped **`v0.6.2-2`** (2026-07-31, hours before this was written), so
> this re-reads the current source and the wider org, and revises two claims we were
> making that do not survive contact with it.
>
> Method: read `src/PolyModLoader.ts` at `v0.6.0-8`, `v0.6.2-1`, `v0.6.2-2` (2,990 lines
> at head), the `polytrackmods/pml-api` repo in full, and org/tag/commit metadata.
> Sources listed at the bottom. **No PML code is vendored here** — this is analysis only,
> and PML remains unlicensed (design patterns may be learned from, code may not be copied).

## The direct answer: does PML have an API?

**In core: no event bus, no registries.** The whole extension surface at `v0.6.2-2` is
mixins plus settings/keybinds:

```
registerClassMixin      registerFuncMixin        registerClassWideMixin
registerGlobalMixin     registerChunkMixin       registerSimWorkerMixin
registerPhysicsLibMixin registerPhysicsMixin     ← new in 0.6.2
registerSetting         registerSettingCategory
registerKeybind         registerBindCategory
```

Lifecycle is still the same four (`preInit`/`init`/`postInit`/`onGameLoad`). Grepping the
head revision for an event bus finds only four `addEventListener` calls, all of them the
loader's own DOM wiring — there is no `emit`, no `EventTarget`, nothing a mod subscribes
to. So a PML mod that wants to react to *"a race started"* has no door to knock on; it
string-splices into a minified function. That is the gap our event bus fills, and the
claim survives.

**There is an official API mod — and it is a stub.** `polytrackmods/pml-api` describes
itself as *"a lightweight, modular framework … core hooks, utilities, and extension
points."* The README's body is the literal text **"## TBD"**. The entire mod is ~30 lines
whose only substantive act is:

```ts
simInit = () => {
  this.pml.registerSimWorkerFuncMixin(
    "ammoFunc", MixinType.INSERT, "{",
    "self.pmlApi = {}; self.pmlApi.eventBus = new EventTarget();"
  );
};
```

An empty `EventTarget` in the sim worker. Nothing publishes to it, nothing subscribes.
Last pushed **2025-07-16** — over a year stale.

**It is also broken.** It calls `registerSimWorkerFuncMixin`, and
`grep -c registerSimWorkerFuncMixin` against `v0.6.2-2` returns **0**. The method does not
exist; the current name is `registerSimWorkerMixin`. Their own official API mod does not
run against their own current loader. (This is the same stale-surface problem the 0.6.1
analysis flagged in the wiki — it is not limited to docs.)

**So the accurate framing is not "we have an API and they don't."** It is: *PML's API is
an unstarted intention; ours is shipped and tested.* That is a real lead, but it is a lead
measured in someone else's unfinished work, and unfinished work can get finished. It is
not a moat. **Do not put "we have an API, PML doesn't" in the README** — say what we have
and let it stand on its own.

## Two of our claims do not survive the 0.6.2 source

### 1. "PML breaks on every game rebuild" — overstated, and 0.6.2 is the counterexample

Our story rests on their hardcoded mangled identifiers. So I diffed them:

| | `SettingsClass` | `SettingEnum` | `KeybindEnum` | `SettingUIFunction` |
|---|---|---|---|---|
| `v0.6.0-8` | `Iu` | `R.A` | `ge.A` | `Ns` |
| `v0.6.1` | `uf` | `P.A` | `ge.A` | `no` |
| `v0.6.2-2` | `uf` | `P.A` | `ge.A` | `no` |

**0.6.1 → 0.6.2 changed nothing.** `KeybindEnum` has been `ge.A` across all three. The
mangler is far more stable across point releases than "it reshuffles every build" implies
— webpack's name generation is deterministic given a similar module graph, so a release
that does not reorder modules largely preserves names.

And when names *did* move (0.6.0 → 0.6.1), the delta was **four string constants**.

**The honest version of our claim** is narrower and still true: PML's exposure is
proportional to *how much the graph moved*, it is discovered by breakage rather than
detected, and a wrong-but-present token mis-patches silently. Ours is a hash check that
either passes or fails-closed. That is a **failure-mode** advantage — detection and
blast-radius — **not** a frequency advantage. Rows 2 and 3 of
[pml-shortcomings-and-tspml-improvements.md](./pml-shortcomings-and-tspml-improvements.md)
overclaim on frequency and are corrected there.

### 2. "One map, not N mods" — true, but their update cost is far lower than we assumed

I assumed adapting PML to a new game build was slow, painful, per-mod work. Tag dates:

- `v0.6.0-8` — 2026-05-20
- `v0.6.2-1` — 2026-05-31 (**11 days** later)

Eleven days to move two game versions, and part of that is Kodub's release gap, not PML's
work. Commit messages across the window (`WIP (reaches main screen!)`, `rc1 or something`,
`yeah ok no checking anymore`) read as a couple of evenings of manual re-derivation.

**Our centralization argument still holds** — one map versus every author re-deriving — but
the thing it saves is smaller than the pitch implies, and we should stop implying that PML
updates are an ordeal. Our *own* release-day cost (regenerate → review diff → promote) is
not obviously cheaper than four string constants, and we should measure it honestly the
first time we go through a real one.

## What PML has that we do not

**`registerPhysicsMixin` — byte-offset patching of the physics WASM binary** (new in
0.6.2; absent in 0.6.0). Mods declare `PATCH_F32`/`PATCH_I32` at an offset, the loader
collects them during `preInit` and rewrites the binary before `getPhysicsLibURL()` builds
it. It validates the type tag, integer-ness and sign of the offset, and NaN on the value,
and throws with the offending value named.

There is a careful comment explaining that the wasm URL is rewritten inside
`getPhysicsLibURL()` rather than at prePreInit, *because* prePreInit runs before any mod
and would always miss patches registered in `preInit`. That is exactly the ordering bug
class we hit with the early-capture stub — they found it and wrote it down.

**We cannot do this at all.** Tuning a physics constant is a headline mod category
(gravity, grip, top speed), and constants in a WASM binary have no string or numeric
literal in *JS* to anchor to, so anchor discipline does not merely make it hard — it puts
it out of reach of our current mechanism. Filed as **#43**.

**Also theirs, worth naming:** three delivery surfaces including mobile (`PML-Mobile`,
pushed 2026-08-01), a mod CDN with IndexedDB caching, a TS repo template (updated
2026-07-31), and **users and mods**, which we still have zero of.

## What we can learn from them

1. **Physics is a real gap** (#43). Their approach is the tractable one: byte-offset
   patches with validation, applied before the binary is built. Anchoring is not available
   inside WASM, so a mapping entry there would have to name an offset — which means our
   fail-closed hash gate matters *more* there, not less, since a stale offset writes to
   arbitrary memory. Their design is worth learning from; their code is unlicensed and must
   not be copied.
2. **An "API mod" separate from the loader rots.** `pml-api` calls a method the loader
   removed. Ours is in-tree, imported by the portal and the harness, and covered by tests
   in the same CI run — keep it that way. This is the concrete argument for our layering,
   and it is stronger than the abstract one I reached for earlier.
3. **Their release velocity is the thing to respect.** Eleven days, informally, no tests.
   Our advantage has to be that release day is *routine and verifiable*, not that theirs is
   hard. That makes the mappings pipeline's automation the load-bearing investment.
4. **`pml2` is dead** — last commit 2025-07-31, twelve months cold, 1 star. The
   "incumbent self-disrupts" risk named in the 0.6.1 audit has **not** materialized; the
   effort went into 0.6.2 of the existing loader instead. Downgrade that risk.
5. **Five stars, and the mod org is one small team.** We are not racing a well-resourced
   incumbent. We are also not being handed an ecosystem — nobody is waiting for this.

## Where the moat actually is, after all that

Ranked by how well each survived the source read.

**Holds up:**

- **Fail-closed on a bundle hash.** They have no integrity gate at all. Theirs degrades to
  a wrong patch; ours refuses. In a game with deterministic-replay leaderboard validation,
  that asymmetry is the strongest single thing we have.
- **Structural (AST) matching vs. `indexOf` + `eval`.** Still `eval`-based at head, still
  boot-aborting on a missing token, still 21 `alert()` sites. A short token can silently
  patch the wrong site; an AST match cannot.
- **A shipped, tested event/registry surface.** Not because they lack the idea — because
  their attempt at it is a year-stale stub that no longer runs.
- **No redistribution.** They ship a 3.9 MB `main.bundle.js` plus WASM and assets, and
  spoof the desktop `Origin` in Electron. Structural, and unavailable to them without
  re-architecting.
- **DX.** Types, scaffold, scoped HMR, 252 tests. Their `npm test` launches Electron.

**Weaker than we have been saying:**

- "Breaks every release" — the mangled names were **identical** 0.6.1 → 0.6.2.
- "One map, not N mods" — real, but their adaptation cost is ~4 constants and ~11 days.
- "We have an API" — we have a *better* one; the comparison needs care, not a headline.

**Not a moat at all:** users, mods, mobile, and physics — all theirs today.

**One line:** *the moat is the failure mode, not the frequency.* When the game moves, PML
finds out by breaking and may mis-patch silently; we find out by hash mismatch and fall
back to vanilla. Everything else is execution quality, and execution quality is copyable.

## Sources

- `polytrackmods/PolyModLoader` — `src/PolyModLoader.ts` at `v0.6.0-8`, `v0.6.2-1`,
  `v0.6.2-2`; tags, releases, commit metadata (read 2026-08-03)
- `polytrackmods/pml-api` — full tree; `0.0.0/pml-api.mod.ts`, `README.md`
- `polytrackmods/pml2` — commit history (last activity 2025-07-31)
- Org repo listing for `polytrackmods` (`PML-Mobile`, `PML-Repo-Template-TS`, …)
- Prior: [polymodloader-analysis.md](./polymodloader-analysis.md) ·
  [pml-shortcomings-and-tspml-improvements.md](./pml-shortcomings-and-tspml-improvements.md)

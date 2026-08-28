# PML compatibility

TSPML can install and run mods written for **PolyModLoader (PML)**, PolyTrack's
first mod loader. This page states exactly how much of a PML mod carries across,
what does not, and why the parts that do not are **refused by name** instead of
silently accepted.

> **The short version.** Lifecycle hooks, keybinds, settings, `getMod` and
> **token-anchored mixins** work — mixins are collected on first launch and
> applied as verified source patches on the next. What does not carry — physics
> offsets, method-extent patches, PML's eval bridge — is **refused by name**,
> and the mod keeps running. The portal says all of this at install time rather
> than leaving you to wonder why nothing happened.

## TSPML is still its own loader

This is an **adapter**, not a merge. Nothing on the TSPML path changed to make
it fit: no gate was relaxed, no rule widened. A TSPML mod never touches any of
the code described here.

The adapter lives in `source/portal/lib/pml/` and its job is to hand
`@tspml/loader` an ordinary module — a `default` export carrying
`preInit`/`init`/`ready`/`onUnload`. **The loader is never taught what PML is.**
Everything it already guarantees therefore covers a PML mod for free:

- per-mod failure isolation (one PML mod throwing does not take the set down),
- dependency ordering and soft-disable,
- safety classification (vanilla-safe vs physics-touching),
- reverse-order unload.

That is the whole reason for the shape. A second loader would have had to
re-earn every one of those.

## Mixins: carried, with PML's semantics and TSPML's discipline

The interesting half of compatibility, and it used to be a hard refusal. The
reason it was is still true and still worth reading, so it stays:

| | PML | TSPML |
|---|---|---|
| **When** | at runtime, in the browser | before the bundle is served |
| **How** | `Function.prototype.toString()` → `indexOf(token)` → string splice → `eval()` | structural AST transform |
| **Anchored to** | a literal substring of the minified source | a named symbol in a map pinned to a `bundleHash` |
| **On a game update** | the token silently stops matching | the hash mismatches and the patch **fails closed** |

A PML mixin names a place in the *minified text* of the game source, and by the
time a PML mod's `init` runs under TSPML that bundle has already been
transformed and served — there is no live function left to splice. **Refusing
was the honest answer for as long as "translate the patch" was the only
imagined alternative.** The working answer turned out to be different: don't
translate the patch — **run PML's patch language at TSPML's own patch time**.

How a mixin carries now:

1. **Collect.** The mod's `registerClassMixin` calls are validated per call at
   runtime and collected onto the mod's record. A spec the adapter cannot
   faithfully apply — a method-extent type (`HEAD`/`TAIL`/`OVERRIDE`/
   `CONSTRUCTOR`), a wasm offset, a non-object spec — is refused by name right
   there, exactly as before.
2. **Carry.** The collected specs ride the same request-carried plan as pasted
   TSPML mixins (#62): parked in the Cache API before the game frame mounts,
   POSTed to the transform route, applied per surface.
3. **Apply — before Babel.** A splice edits the RAW bundle text, because PML's
   tokens are written in Kodub's own minified formatting and would not survive
   the engine's regeneration. Then the engine's existing re-parse gate covers
   the spliced source: a splice that breaks syntax fails the whole compose and
   the game boots **vanilla** instead of broken.
4. **Verify — exactly once.** An anchor must match **exactly once** in the
   surface being served, or the patch is refused with the match count. PML
   splices at whatever its lookup finds first; TSPML refuses ambiguity rather
   than guess. The one concession to reality: twin anchors (`tokenStart ===
   tokenEnd`, which is what real PML mods ship) accept one occurrence — the
   single anchor serves as both ends and the span is empty — or two; three or
   more refuse.

The consequence a player sees: **a PML mod's mixins apply on the next launch,
not the first one.** The first boot collects and says so; the reload applies.
That is the same shape as every plan-carrying feature here (physics included),
because the plan must be parked before the frame's first fetch.

What still refuses, and why:

- **Method-extent types** (`HEAD`/`TAIL`/`OVERRIDE`/`CONSTRUCTOR`) anchor to a
  method's extent, which PML resolves by holding the live class — a resolution
  no served-bundle translation can reproduce.
- **Other families** (`registerFuncMixin`, `registerClassWideMixin`,
  `registerGlobalMixin`, `registerChunkMixin`, the sim-worker pair) anchor to
  module scope, the worker bundle, or a chunk this adapter never holds.
- **Physics offsets** (`PATCH_F32`/`PATCH_I32`) get their own reason: TSPML
  *can* patch `polytrack_physics.wasm` (M11 / [#43]) but only through a
  `physics.json` **pinned to a `wasmHash`**. A raw offset arrives with no hash
  to check, and honouring it would mean writing into the simulation that
  produces leaderboard evidence. That gate does not bend for compatibility.
- **PML's eval bridge** (`getFromPolyTrack`, `getFromPolyTrackGlobal`) resolves
  paths inside PML's own patched bundle. TSPML serves an unpatched game with no
  eval sink, so there is nothing to resolve against — use `api.events` /
  `api.keybinds` / `api.editor`, or a `mixins.json` anchor.

### Refusing, not throwing

A refusal returns `undefined` and logs. It does **not** throw, because PML mods
register mixins from `init` — throwing would take the whole mod down over one
call, and a mod that mixes a UI patch with a keybind should keep the keybind.

Refusals are **deduped by (method, target)**, so a mod registering mixins in a
loop produces one line rather than a thousand. A thousand lines an author has to
scroll past is the same as none.

## What carries across

| PML surface | Status | Notes |
|---|---|---|
| `preInit` / `init` / `postInit` / `onGameLoad` | ✅ | See the hook mapping below |
| `registerKeybind` | ✅ | Real registration through `api.keybinds`, namespaced `pml.<id>.<bind>` |
| `registerSetting` / `getSetting` / `setSetting` | ⚠️ Stored | No settings panel yet, so mods run on their defaults |
| `getMod` / `registerMod` | ✅ | Scoped to one session; resolves by PML id **and** by our slug |
| `PolyMod` fields (`modName`, `modID`, `modAuthor`, `modVersion`, `baseUrl`, …) | ✅ | Assigned before the first hook, as PML's own loader does |
| `MixinType` / `SettingType` | ✅ | Full enums, frozen — mods read these at module scope |
| `registerClassMixin` (token-anchored types) | ✅ next launch | Collected, applied at the transform seam; see above |
| Other mixin families (7 of 8) | ❌ Refused | Per call, with the reason above |
| `registerPhysicsMixin` | ❌ Refused | The `wasmHash` gate; see above |
| `getFromPolyTrack*` | ❌ Refused | The eval bridge; see above |

Two PML behaviours are **reproduced as-is even though they are warts**, because
mods have written around them:

- `getSetting` returns a **string** regardless of `SettingType` — so a bool
  setting reads back as `"true"`. Returning a real boolean would be tidier and
  would break exactly the mods that compare against `"true"`.
- `registerKeybind` accepts both an options object and a positional
  `(id, key, fn)` signature, because PML's own signature drifted between
  versions.

### Hook mapping

```
PML                        TSPML
preInit(pml)     ────────► preInit(api)
init(pml)        ────────► init(api)
postInit()   ─┐
onGameLoad() ─┴──────────► ready(api)      (postInit first, then onGameLoad)
```

Both PML post-init hooks mean "the game is up", and PML runs them in that order,
so `ready` runs them in that order too.

**One real behavioural difference, and it is reported rather than hidden:** PML
is *phase-major* (every mod's `preInit`, then every mod's `init`), TSPML is
*mod-major* (one mod's hooks run through to completion before the next starts,
in dependency order). A PML mod reading another PML mod's `init` output from its
own `preInit` may find it missing. The adapter surfaces this **only once a
second PML mod loads** — with one mod there is no cross-mod order to get wrong,
and a warning nobody can act on just teaches players to ignore the box.

## How a PML mod is installed

PML mods are a CDN **directory tree**, not one file:

```
<mod>/manifest.json          {"latest": {"0.6.2": "1.2.0"}}   ← INDEX
<mod>/1.2.0/version.json     {"polymod": {…, "main": "main"}} ← VERSION
<mod>/1.2.0/main.mod.js                                       ← the code
```

Both metadata files are conventionally named `manifest.json` *or* `version.json`
depending on where in the tree they sit — PML's docs and its repo template
disagree — so the walk is driven by **content, not filename**: a body with a
`latest` map is an index (follow it), a body with a `main` is a version
manifest (use it). Point the importer at any of the three and it works.

Every hop re-checks the import URL rules. A manifest cannot redirect the walk at
a kodub host and slip past the entry check.

### Recognising a mod root

PML's registry addresses every mod as a **bare directory** — `.../main/polyproxy`,
no trailing slash, no extension. That shape cannot be read off the path, because
it is also how a gist raw and a hash-named CDN object serve a perfectly ordinary
*TSPML* file. Deciding by path shape alone sent real TSPML URLs into the PML
walk, which then reported a missing `entrypoint` for something that had one.

So the dispatcher (`lib/mod-formats/index.ts`) decides from the **answer**:

- a **trailing slash** is unambiguous — no fetch, straight to the PML walk;
- anything else is fetched once, and a dotless URL goes to PML only when the
  body is a **JSON array** (PML's CDN answers a directory with a GitHub-style
  listing) or the fetch failed outright. No manifest of either format is an
  array and no code file parses as JSON, so nothing that is really a mod is
  misread;
- otherwise the parsed body decides, `entrypoint` before the PML markers, so a
  mod shipping for both loaders resolves to the one we can run natively.

The listing-array shape was verified against the live CDN rather than assumed;
`tests/mod-formats.test.ts` pins both directions.

### Manifest translation

Translation is pure (`lib/pml/manifest.ts`) and every lossy decision is
**named in a note the installer shows you**:

- **`id`** is slugified to TSPML's character class, and the original is kept in
  `custom.pml.id` — `pml.getMod()` looks up by the PML id, so losing it would
  break the documented way PML mods reach each other.
- **`targets`** carry through for the *loader* to gate on. An unparseable range
  is dropped **by name**; if every target was dropped the mod is no longer
  version-gated at all, and that is said loudly.
- **`dependencies`** are recorded in `custom.pml.dependencies` but deliberately
  **not** emitted as `depends`. They are PML-registry ids resolving against a
  registry TSPML has no view of, and an unresolvable `depends` is abortive in
  the loader's pre-gate — that would turn "has deps" into "cannot load".
- **`touchingPhysics`** maps onto `vanillaSafe`, the one PML field whose meaning
  lands exactly on something TSPML already reads.

### The import rewrite

A PML mod's first line is `import { PolyMod } from "./PolyModLoader.js"`. TSPML
imports mod code from a `blob:` URL, against which a relative specifier resolves
to nothing — so that import is rewritten to read the adapter off a global
(`lib/pml/wrap.ts`). Without it the mod fails at import time with a network
error naming no cause.

The rewrite is textual and deliberately conservative:

- it **only** touches `PolyModLoader` specifiers — `PolyModLoaderExtras.js` is
  somebody else's file, and bare specifiers (`"three"`) resolve normally;
- a clause it cannot model is **left as written and named in a warning**, rather
  than replaced with a `const` that might not parse;
- it **appends nothing**, so `export { thing as polyMod }` — a form real mods
  use — still works;
- an unresolvable *relative* import (`./util/helper.js`) is left alone and
  warned about, because rewriting someone else's import would be guessing. PML
  mods ship as one built file; a multi-file mod needs bundling first.

## What you see as a player

At install time the portal shows an **advisory caveat** next to a working
install button — not a block. It is collapsed to one line with the full
reasoning behind an expander (a native `<details>`): the fact is load-bearing
and the reasoning is not, and a paragraph repeated on every PML card is
wallpaper by the third one. Mixin refusals, collections and every warning
above are shown per mod on `/play` — a mod that will mostly not work is visibly
that **before** you go looking for the feature it promised, and a mod whose
patching is collected says so with the restart it needs.

## PML mods in the catalog

`/browse` lists **every mod in PML's own registry** — all twenty, mirrored from
[`PolyLibrary/modlist.json`][modlist] into `public/registry/index.json`. They
install through the adapter like any other entry; nothing about them is a
special case in the code.

Each row carries `"format": "pml"`, and that field is **load-bearing twice
over**: it selects the import walk, and it is the source of the loader-format
chip every card shows. The chip is *derived* from `format` (`entryTags()`),
never hand-written into `tags` — a row whose tag disagreed with its `format`
would advertise one code path and run another. `tests/registry.test.ts` fails
the build if a committed row hand-writes either format into its `tags`.

The chip is a real filter, not a badge: selecting `pml` narrows the grid to
exactly the PML entries and `tspml` to exactly the native ones. Both directions
are asserted in a browser (`smoke:registry`, leg 2b), because a chip that
filtered one way and left the other alone would look like a working control.

Four things about the mirror are worth stating, since they are choices and not
mechanics:

- **The data is PML's, the descriptions are ours.** Names, authors, tags and
  URLs come verbatim from PML's registry. It carries **no descriptions at all**,
  so every `summary` was written from reading that mod's actual source. None is
  invented, and none is generated from the name.
- **`gameVersions` lists what the mod's own index offers**, not a range we wish
  it supported. **Thirteen of the twenty-one rows have no 0.6.2 build**, and the
  card says so — not in hand-written prose (the old rows carried the fact in two
  inconsistent phrasings, a second copy of `gameVersions` that could disagree
  with the field), but as a derived advisory. `buildsForGameVersion()` interprets
  the field — both shapes it really arrives in: exact lists, and the semver
  *range* poly-to-track publishes (`">=0.6.0 <0.7.0"`, which covers 0.6.2 by
  syntax rather than by listing it; a substring check would have put a false
  warning on the one native mod in the catalog). The warning is an advisory and
  never a gate — the mod's index is the authority at install time, so a stale
  catalog row cannot block a mod whose author has since shipped a build. In the
  in-play drawer the advisory is judged against the **running instance's**
  version, not the launcher default.
- **Every PML row is a `mod-root`**, the third `source.type`. PML addresses all
  of its mods as a directory with no trailing slash; a row that had to call
  itself a `mod-json` to be accepted would be lying about what lives there.
- **Every row carries an icon**, from the `icon.png` PML's authors ship inside
  each version directory. The URL points at the row's newest version that has
  one — committed per row rather than derived from the live index, because the
  catalog is a copy and a derived "latest" would rot the day a version ships
  without an icon. The icons are dark line art on transparency, drawn for a
  light UI, so the portal renders them on a light tile.

### People are filter chips too — and versions are the fourth group

The person chips are **derived from the `author` byline** (`entryPersons()`
splits "Cwcinc + Jakob + Orangy" into three names), the same
single-source rule as the format chip: a hand-written copy in `tags` could
disagree with the byline on the first row someone edits. Selecting *Orangy*
narrows the grid to exactly that person's ten rows — solo work plus
collaborations — asserted in a browser (`smoke:registry`, leg 2c).

The filter row is grouped by what kind of fact a chip states — **loader /
category / version / people** — and the version chips are derived too: each
card shows the game versions it **covers** (computed, not listed, so the range
entry `>=0.6.0 <0.7.0` chips as 0.6.0/0.6.1/0.6.2 and the `0.6.2` filter keeps
it), newest first, monospaced, prereleases excluded. A guard test fails the
build if a row hand-writes any of its covered versions into `tags`.

[modlist]: https://raw.githubusercontent.com/polytrackmods/PolyLibrary/refs/heads/main/modlist.json

## Files

| Path | Role |
|---|---|
| `lib/mod-formats/pml.ts` | The CDN walk and format entry point |
| `lib/pml/manifest.ts` | PML manifest → TSPML manifest (pure) |
| `lib/pml/wrap.ts` | Rewrites the `PolyModLoader` import |
| `lib/pml/shim.ts` | The PML runtime a mod actually talks to (collects mixins) |
| `lib/pml/splice.ts` | PML's token-splice language, exactly-once verified |
| `lib/pml/run.ts` | Builds the synthetic module the loader drives |

Tests: `tests/pml-manifest.test.ts`, `tests/pml-wrap.test.ts`,
`tests/pml-shim.test.ts`, `tests/pml-run.test.ts`, `tests/pml-splice.test.ts`,
plus splice-composition cases in `tests/demo-transform.test.ts` and plan
carriage in `tests/user-patches.test.ts`.

## Proved in a browser

Those unit tests run under node, where the one thing that makes this work —
importing a rewritten PML module from a `blob:` URL — cannot happen and has to be
mocked. So there is a CI smoke that does it for real:

| Path | Role |
|---|---|
| `public/sample-pml-mod/` | A fixture PML mod in PML's own three-file CDN layout, served by the portal |
| `scripts/smoke-pml.mjs` | `pnpm --filter @tspml/portal smoke:pml` |

The smoke imports the fixture's **index manifest** through the ordinary "Import
from a URL" form with no format stated (the dispatcher sniffs it), then asserts
the walk resolved, the `PolyModLoader` import rewrite worked, all four lifecycle
hooks ran in order, the identity fields were assigned before the first hook, the
keybind fires when a `keydown` is dispatched in the game frame, and `getSetting`
returns a string.

The mixin legs are the load-bearing ones, and they cover BOTH halves of the
contract:

- **Refusal** — the fixture registers an untranslatable type (an `OVERRIDE`) and
  an untranslatable family (`registerGlobalMixin`); both are refused **by name
  in the UI while the mod is still loaded**, and the code after them ran.
- **Carriage** — the fixture also registers a real splice whose token exists
  exactly once in the vanilla 0.6.2 bundle and executes when the bundle
  evaluates. The first boot asserts it is **collected and has NOT run yet** (the
  running frame predates the plan that carries it); after one reload, the
  marker the splice inserts is found **in the game frame** — which means the
  spliced code executed, not merely that the plan accepted it — and the report
  inside the served bundle reads `applied: 1` on `main.bundle.js`.

A failed run along the way also proved the fail-closed gate does what it claims:
a splice whose `func` broke the bundle's syntax produced `plan-status:
base-failed` and a **vanilla game**, never a corrupted boot.

[#43]: https://github.com/roowus/TSPML/issues/43

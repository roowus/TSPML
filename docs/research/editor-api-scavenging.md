# Editor internals scavenging (#87 — `api.editor.insertParts`)

> What would a Tier-1 "place parts into the open editor session" surface
> ([#87](https://github.com/roowus/TSPML/issues/87)) have to hook, and does the
> current transform architecture reach it?
>
> **Measured answer: the part store is reachable today (it lives in
> `main.bundle.js`, in a module we already anchor); the editor's undo stack and
> "editor is open" state are NOT — they live in a lazily-loaded chunk the
> transform does not cover.** A useful MVP exists without touching the chunk;
> undo-integrated placement requires chunk-transform plumbing first.
>
> All findings are against the pinned 0.6.2 bundle (locally cached, gitignored
> `.cache/pt-0.6.2-raw-main.js` and `.cache/pt-0.6.2-raw-chunk-112.js`, fetched
> with `pnpm run fetch 0.6.2 --chunks`). Minified names quoted below are
> 0.6.2-specific and hash-gate-protected, same caveat as
> `CAR_CONTROLLER_BINDINGS` in `source/shared/src/bridge-patches.ts`.

## Finding 1 — the editor is a lazy webpack chunk, outside the transform

The track editor is not in `main.bundle.js`. The menu's edit action loads it on
demand:

```js
await I.RN("start-editor")                                  // loading screen
const { default: a } = await i.e(112).then(i.bind(i, 7112)) // chunk 112, module 7112
await a.initResources()
$.dispose()
const c = $ = new a(w, p, e, y, b, S, l, d, r, o, k, E, x, R, V,
  (/* exit → rebuild main menu */),
  (/* test-drive → new ws(...) race instance, restore editor on exit */))
```

Chunk 112 is fetched as `<version>/112.bundle.js` (108,037 bytes at 0.6.2;
`fetch.mjs --chunks` discovers and caches it). The portal's proxy transform
covers exactly one path — `shouldTransform` in
`source/portal/app/api/proxy/[[...path]]/route.ts` matches
`segments.join('/') === 'main.bundle.js'` — so **chunk 112 is served vanilla
today**. Nothing inside the chunk (module 7112 or its ~200 sibling modules) can
be anchored, injected, or captured until that changes.

This is the architectural finding of the spike: **any editor feature that needs
code inside the chunk is gated on extending the transform surface to chunk
bundles** (proxy path match, service-worker replay coverage, and a per-chunk
hash pin alongside the main bundle's — a chunk can re-minify independently).

## Finding 2 — the part store is in `main.bundle.js`, in an already-verified module

Module 7112's default export (`const Gi = class`, 17-param constructor,
`static initResources()`) is a thin wrapper: it holds the **Track instance it
was handed as constructor param 0** (private field `pi`) and builds the real
editor state machine (`fi`, 14 params) around it:

```js
constructor(t, e, n, s, o, a, r, h, l, c, d, g, f, p, u, m, v) {
  (0,i.GG)(this, pi, t, "f");                                // ← the Track
  (0,i.GG)(this, bi, new fi(a, r, h, c, t, e, n, d, g, f, p, u, l, m), "f");
  (0,i.gn)(this, pi, "f").clear();                           // wipe…
  (0,i.gn)(this, pi, "f").setPart(0, 0, 0, rt.A.Start, 0, ht.A.YPositive,
                                  at.A.Default, null, 0);    // …place Start
  (0,i.gn)(this, pi, "f").refreshMeshes();
  …
}
```

That Track instance (`w` at the construction site) is the **same shared object
the race scene uses** — and its class is defined in `main.bundle.js`, in the
module we already locate for the `track.afterLoad` event (anchor literals
"Track part color does not exist" / "Track part below ground" / "Checkpoint has
no detector" / "Track part index out of bounds"). Its mod-relevant surface,
read off the minified source:

| Method | Signature (semantic) | Notes |
|---|---|---|
| `setPart` | `(x, y, z, partId, rotation, rotationAxis, color, checkpointOrder, startOrder)` | throws `"Track part color does not exist"` on a bad color; coordinates are in tiles (`* partSize` internally) |
| `deleteSpecificPart` | `(partId, x, y, z, rotation, rotationAxis)` | what undo uses to remove |
| `getPart` | `(partId)` | part-catalog lookup (colors set, checkpoint flag) |
| `forEachPart` | `(cb(x, y, z, id, rotation, rotationAxis, color, checkpointOrder, startOrder))` | the read counterpart |
| `getNextStartOrder` | `()` | how the editor assigns start-pad order |
| `clear` / `refreshMeshes` / `getTrackData` | | `getTrackData()` feeds both save (`saveCustomTrack(meta, data)`) and export (`.toExportString(meta)`) |

So the mechanism `insertParts` needs — validated placement into the live
session, mesh refresh, read-back — is **capturable with the existing
instance-capture pattern** (hook-system.md): a `before`/`after` inject on any
Track method captures `this` into `window.__tspml.captureTrack(...)`, exactly
how `captureTrackManager` rides the track-selection constructor. No new anchor
is even required; the module is a committed, verified target.

## Finding 3 — undo lives in the chunk, as private state

The editor's undo is not on the Track. Chunk 112's `fi` keeps two private-field
stacks (`wn` undo, `bn` redo) of batch entries:

```js
Kn = function () {                       // undo (Ctrl+Z → checkKeyBinding path)
  const t = (0,i.gn)(this, wn, "f").pop();
  if (t != null) {
    for (const e of t.added)   jt.deleteSpecificPart(e.id, e.x, e.y, e.z, e.rotation, e.rotationAxis);
    for (const e of t.removed) jt.setPart(e.x, e.y, e.z, e.id, e.rotation, e.rotationAxis,
                                          e.color, e.checkpointOrder, e.startOrder);
  …
```

and the placement path pushes `{added: [...], removed: [...]}` batches built
alongside its own `setPart` calls. Both stacks are ES private fields on a class
inside the untransformed chunk: **no inject we can write today reaches them**.
Parts inserted by calling the captured Track directly would be invisible to
Ctrl+Z — worse, an undo of a *later* manual edit would happily
`deleteSpecificPart` around them, so the interleaving is coherent but the
inserted batch itself is permanent until manually deleted.

`fi` also holds the "which tool / camera / part is selected" UI state and the
save path (`$t.saveCustomTrack(meta, jt.getTrackData())` — `$t` is a TrackManager,
handed in as `Gi` constructor param 12; same class as the instance the
registry capture grabs, and almost certainly the same bootstrap singleton,
though instance identity was not verified).

## Finding 4 — "is the editor open" has no reachable signal either

The construction site above lives in the bootstrap (same side of the module
wall as the TrackManager construction — instance capture exists because of
exactly this), and the `Gi`/`fi` lifecycle (`dispose()`, the test-drive
enable/disable dance) is chunk code. With only `main.bundle.js` transformable,
the honest options for gating `insertParts` on "editor actually open" are:

1. **Behavioral**: the `Gi` constructor's distinctive `clear()` →
   `setPart(0,0,0,Start,…)` → `refreshMeshes()` sequence on the captured Track
   is observable from Track-side injects — a heuristic, not a contract.
2. **DOM**: the chunk builds `.editor-ui` elements — what
   [poly-to-track](https://github.com/roowus/poly-to-track) already polls. It
   works, but Tier-1 promising a DOM sniff as API semantics is weak.
3. **Chunk transform** (the real answer): capture the editor instance in its
   own constructor, emit `editor.opened` / `editor.closed` from
   constructor/`dispose`, and the gate is exact.

## What this means for the #87 surface

Phased, matching what the architecture reaches today vs. after chunk plumbing:

**Phase A — possible now (main-bundle capture only):**
`api.editor.getParts()` and a caveated `api.editor.insertParts(parts)` via a
captured shared-Track instance; "in editor" gated behaviorally (option 1) and
resolved `{ ok: false, reason: 'not-in-editor' }` otherwise. Documented
limitation: inserted parts bypass the editor's undo stack. This already unlocks
poly-to-track's "paste into the track I'm editing" loop.

**Phase B — needs chunk-transform plumbing (the prerequisite slice):**
extend `shouldTransform` + the SW replay to `<id>.bundle.js`, add per-chunk
hash pins to the map, and anchor discipline inside chunk 112 (it has plenty of
distinctive literals: `"Part index out of bounds"`, `"How to use the editor"`,
`"editor-ui"`, the Editor* keybind names).

**Phase C — full #87 on top of B:** capture the `fi` instance, push a proper
`{added, removed}` batch per `insertParts` call so Ctrl+Z works, emit
`editor.opened`/`closed`, and expose selection read-back.

The issue is filed "no urgency"; Phase B is the load-bearing prerequisite and
is a transform/mappings feature, not an editor feature — it should be its own
issue and land first.

## Provenance

- Chunk fetched and cached locally via `pnpm run fetch 0.6.2 --chunks`
  (chunk discovery added in [#3]; chunk 535 returned CDN 503 and is unrelated).
- Class/field readings from the raw minified sources; nothing here ships game
  code, only structural facts — same legal posture as the other research docs.

[#3]: https://github.com/roowus/TSPML/issues/3

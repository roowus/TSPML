# @tspml/shared

**The single source of truth for what TSPML injects into the game bundle.**

Every delivery surface — the [portal](../portal), the [dev harness](../../environments/dev-harness),
and the extension when it grows a transform ([#8]) — needs the same two things, so
they live here where they cannot drift ([#34]):

| Export | What it is |
|---|---|
| `TIER1_BRIDGE_PATCHES` | The live badge + the 6 Tier-1 event emits (`car.control`, `car.created`, `race.started`, `track.afterLoad`, `checkpoint.passed`, `race.finished`). |
| `TRACK_CAPTURE_PATCHES` | The two instance-capture patches the custom-track registry needs ([#12]) — the game's TrackManager and its track codec. |
| `BRIDGE_PATCHES` | Both of the above, in order. What a surface normally applies. |
| `EARLY_CAPTURE_STUB` / `EARLY_CAPTURE_SCRIPT_TAG` | A pre-bridge shim, injected ahead of the game's own scripts. |
| `readEarlyCaptures(frameWindow)` | Reads back whatever the stub recorded, for the host to replay. |

> Note: this package was scaffolded in M0 with a different remit (manifest/resolution
> types). Those landed in `@tspml/loader` and `@tspml/mappings` instead — the name was
> free, so [#34] took it.

## Why the early-capture stub is not optional

The capture patches fire at very different points in the game's lifecycle. The
TrackManager is handed over when the game builds its track-selection menu (late,
comfortably after the host page's `load` handler). The **codec's module factory runs
during bundle init** — before the host has installed the real `window.__tspml`.

Skip the stub and that capture hits an absent bridge and is silently dropped, so the
registry never attaches even though the manager arrived fine. Inject
`EARLY_CAPTURE_SCRIPT_TAG` into the game's `<head>`, then call `readEarlyCaptures` in
your frame-`load` handler and fold the result into your capture state.

## What does *not* belong here

Anything surface-specific:

- the portal's mappings `{symbol}` resolution and sha256 bundle hash-gate (`lib/demo-transform.ts`)
- the harness's Vite proxy middleware (`src/game-proxy.ts`)
- the extension's content-script plumbing

The test is whether the code would be byte-identical in all three surfaces.

## Contracts to keep

Several injects reference the bundle's **minified parameter names** (`e`, `t`, `n`,
`a`, `s`). That is only sound because every caller **hash-gates** the transform to
the bundle pinned in the mappings map — on a mismatch nothing is applied and the
surface serves vanilla. If you add a patch, preserve that contract
([mappings-system.md](../../docs/design/mappings-system.md)); making the injects
rename-robust is [#24].

Module anchors match string/numeric **literals only**, never identifiers, and a
literal shared with another module resolves to the wrong one silently. Prefer
several narrow literals with a matching `minHits` — the codec patch's comment
records a real instance of this biting.

[#8]: https://github.com/roowus/TSPML/issues/8
[#12]: https://github.com/roowus/TSPML/issues/12
[#24]: https://github.com/roowus/TSPML/issues/24
[#34]: https://github.com/roowus/TSPML/issues/34

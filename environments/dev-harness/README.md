# @tspml/dev-harness

A Vite dev server that runs the **real transformed PolyTrack** plus your mod, with
**scoped mod hot-reload** — save your mod's entrypoint and it hot-swaps in place while
the game keeps running (no reload, no rebuild). This is the modder-DX half of M7.

> Headlessly verified: the transformed game boots, the gate clears, a real race starts,
> Tier-1 `car.control` events fire, the dev mod loads, and editing the mod source
> increments `modLoadCount` without reloading the game (`pnpm smoke`).

## Why

Iterating on a mod against the portal means: edit → rebuild `@tspml/transform` +
`@tspml/api-bridge` → reload the browser (the game reboots, ~seconds each time). The
harness cuts that to: edit → instant. Vite serves the mod from source and, on save,
disposes the old mod's subscriptions and runs the new entrypoint against the live
bridge — the game iframe is untouched.

## Run

```sh
# 1. build the runtime deps the harness imports (once / after they change):
pnpm --filter @tspml/transform --filter @tspml/mappings --filter @tspml/api-bridge --filter @tspml/loader build

# 2. start the harness (serves the UI + game proxy on :5173):
pnpm --filter @tspml/dev-harness dev    # → http://localhost:5173

# 3. headless smokes (in another terminal, while dev is running):
pnpm --filter @tspml/dev-harness smoke          # game boots + mod hot-swaps
pnpm --filter @tspml/dev-harness smoke:tracks   # api.tracks lands a track in the game's list
```

Then open http://localhost:5173 — the game runs transformed (green `TSPML ✔ LIVE`
badge), the dev mod is loaded, and the status line shows the `car.control` event count.

## Iterate on your mod

The harness dev-loads ONE mod's entrypoint from **source** (so edits hot-reload). By
default it points at `@tspml/demo-hud`'s source entrypoint. To iterate on your own mod:

```sh
TSPML_DEV_MOD=/abs/path/to/your-mod/src/entrypoint.ts pnpm --filter @tspml/dev-harness dev
```

The entrypoint must default-export a factory `(api) => { … }` (see
`@tspml/api`). On save, Vite hot-swaps it.

> **HMR scope:** entrypoint logic (event subscriptions, keybinds) hot-swaps. A
> mod-declared **mixin** change (`mixins.json`) alters the bundle transform and needs a
> full reload — the transform is applied once when the bundle is fetched. (Most mod
> iteration is entrypoint logic.)

## How it works

- **`src/game-proxy.ts`** — a Vite dev-server middleware (a `configureServer` plugin)
  that serves the real game under `/game/*`: fetches `app-polytrack.kodub.com/<ver>/`
  with the desktop origin forwarded, injects the `polytrackModConfiguration` gate +
  `<base>` into the HTML, and AST-rewrites `main.bundle.js` with the bridge patches
  (hash-gated via `@tspml/transform` + `@tspml/mappings`). This is the harness
  equivalent of the portal's `/api/proxy` route + service worker — but **simpler: no
  service worker** (Vite intercepts `/game/*` in-process).
- **[`@tspml/shared`](../../source/shared)** — *not* in this package: the Tier-1 bridge
  patches (badge + 6 event emits), the two **capture** patches that hand the registry the
  game's track store + codec ([#12](https://github.com/roowus/TSPML/issues/12)), and the
  pre-bridge early-capture stub all live there, so the harness and the portal cannot drift
  ([#34](https://github.com/roowus/TSPML/issues/34) — they already had). The harness owns
  only the Vite middleware that applies them.
- **`src/tracking-api.ts`** — wraps the bridge `api` so every `events.on`/`once` +
  `keybinds.register` the mod makes is recorded; `disposeAll()` tears them down. This is
  what makes scoped mod HMR possible with **no change to the mod API** — the mod uses
  `api` normally; the harness can clean up after it. Unit-tested.
- **`src/main.ts`** — boots the game iframe, exposes `window.__tspml` (the bridge) to it,
  runs the mod against a tracked api, and wires `import.meta.hot.accept` to hot-swap the
  mod entrypoint on save.

## Tests

```sh
pnpm --filter @tspml/dev-harness test          # tracking-api unit tests (CI-runnable)
pnpm --filter @tspml/dev-harness smoke         # headless: game boots + mod HMR (needs the dev server up)
pnpm --filter @tspml/dev-harness smoke:tracks  # headless: the custom-tracks registry (needs the dev server up)
```

The `smoke` script edits the dev mod's source to prove the hot-swap (restoring it in a
`finally`, so the committed file is left clean).

`smoke:tracks` drives the registry the way a **mod** does — only `api.tracks` — and
checks the result in the **game's own** custom-track list rather than our mirror of it:
register → present in the game's list → invalid code rejected → collision refused →
explicit overwrite accepted → unregister → gone. Every step is time-boxed and named, so
a failure says *which* stage stalled instead of hanging.

## Investigating a new target

`TSPML_EXTRA_PATCHES=/abs/path/to/patches.json` applies extra patches (same shape as a
mod's `mixins.json`) on top of the bridge's. That is how to probe a candidate target
against the real bundle — write the patch, load the page, see whether it applied —
without editing committed code. Dev-only; never in the portal.

Two things that cost real time and are worth knowing before you start:

- **Anchor literals must be unique to the target module.** A literal that also appears
  elsewhere silently resolves to the *wrong* module. Grep the unpacked bundle for each
  literal, and prefer several narrow ones with a matching `minHits`.
- **Capture patches fire whenever their module runs — sometimes before the bridge
  exists.** A module-factory patch can run during bundle init, i.e. before the parent
  frame's `load` handler installs `window.__tspml`; its capture is then dropped with no
  error. `game-proxy.ts` injects an early stub that records into `window.__tspmlEarly`
  for `main.ts` to replay.

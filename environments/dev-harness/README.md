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

# 3. headless smoke (in another terminal, while dev is running):
pnpm --filter @tspml/dev-harness smoke
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
- **`src/bridge-patches.ts`** — the Tier-1 bridge patches (badge + 6 event emits). An
  intentional, attributed copy of the portal's `demo-transform.ts` patches (TODO: extract
  to `@tspml/shared` so portal + harness share one source —
  [#34](https://github.com/roowus/TSPML/issues/34)).
- **`src/tracking-api.ts`** — wraps the bridge `api` so every `events.on`/`once` +
  `keybinds.register` the mod makes is recorded; `disposeAll()` tears them down. This is
  what makes scoped mod HMR possible with **no change to the mod API** — the mod uses
  `api` normally; the harness can clean up after it. Unit-tested.
- **`src/main.ts`** — boots the game iframe, exposes `window.__tspml` (the bridge) to it,
  runs the mod against a tracked api, and wires `import.meta.hot.accept` to hot-swap the
  mod entrypoint on save.

## Tests

```sh
pnpm --filter @tspml/dev-harness test    # tracking-api unit tests (CI-runnable)
pnpm --filter @tspml/dev-harness smoke   # headless browser: game boots + mod HMR (needs the dev server up)
```

The `smoke` script edits the dev mod's source to prove the hot-swap (restoring it in a
`finally`, so the committed file is left clean).

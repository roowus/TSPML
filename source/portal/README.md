# @tspml/portal

Vercel-hosted Next.js web app — TSPML's **flagship delivery surface**. It plays the
**real** PolyTrack game by loading it through a **service worker + server proxy**
(`/api/proxy`), AST-transforms `main.bundle.js` on the way through, and hosts the Tier-1
bridge the mods bind to. The architecture is described in
[`docs/design/injection-and-delivery.md`](../../docs/design/injection-and-delivery.md).

> **Status:** run-validated end to end by three committed headless smokes (below). A real
> mod loads, six Tier-1 events fire during a real race, a mod-declared mixin applies,
> `api.tracks` puts a mod's track in the game's own Custom tracks list, and `api.audio`
> replaces one of the game's own sounds. Still open: leaderboard/multiplayer through the
> proxy ([#7](https://github.com/roowus/TSPML/issues/7) — `vps.kodub.com` is bot-protected,
> so the **extension** is the resilient path there).

## The proxy + service-worker strategy

A naive portal cannot iframe PolyTrack: the game's CSP `frame-ancestors` allows
only `kodub.com` / `webgamer.io` / `kongregate.com`, and page-context `fetch()`
of the bundles hits CORS (Kodub sends no `Access-Control-Allow-Origin`). So the
portal works only via a same-origin service worker plus a server-side proxy:

```
 Browser (tspml.vercel.app)
   │
   ├── Service Worker (scope "/") intercepts fetches to *.kodub.com
   │       └── rewrites them to  /api/proxy/<path>?version=<v>[&host=<h>]
   │
   ├── /api/proxy/<path>  (Next.js route, server runtime)
   │       ├── builds https://app-polytrack.kodub.com/<version>/<path>
   │       │   (or https://<host>/<path> when the SW added host=)
   │       ├── sets Origin/Referer → official desktop origin
   │       │   (https://app-polytrack-desktop.kodub.com)  ← ToS gray area
   │       ├── strips upstream CSP / X-Frame-Options (so the portal can iframe)
   │       ├── injects into the HTML <head>: polytrackModConfiguration (the
   │       │   "unofficial version" gate, ADR-013) · <base href> · the shared
   │       │   pre-bridge early-capture stub
   │       ├── AST-rewrites main.bundle.js when TSPML_TRANSFORM=1 (hash-gated)
   │       └── returns the body with CORS open to the portal origin
   │
   └── Play page iframes  /api/proxy/?version=0.6.2  →  the game's own runtime
       fetches (chunks, WASM, worker) are SW-intercepted and re-proxied.
```

The rewrite is a single pure function in [`lib/rewrite.ts`](lib/rewrite.ts),
covered by [`tests/rewrite.test.ts`](tests/rewrite.test.ts). The static service
worker at [`public/sw.js`](public/sw.js) carries an inline copy of the same
logic (it cannot import the module — files under `/public` are served verbatim);
keep the two in sync.

**The SW must CONTROL the page before the game mounts.** On a first visit it is
registered but not yet the controller, so a runtime kodub fetch escapes it and CORS-fails
("Failed to load track"). `app/page.tsx` therefore mounts the iframe only on
`controllerchange`; the smokes reload once for the same reason.
([#9](https://github.com/roowus/TSPML/issues/9), closed.)

## What gets injected, and who owns it

Nothing injected into the game is defined in this package. Both injections come from
[`@tspml/shared`](../../source/shared) so the portal and the dev harness cannot drift —
they already had, and it cost the portal a whole feature
([#34](https://github.com/roowus/TSPML/issues/34)):

| From `@tspml/shared` | Injected into |
| --- | --- |
| `BRIDGE_PATCHES` | `main.bundle.js`, via `@tspml/transform` — the badge, the 6 Tier-1 event emits, the capture patches for the track store + codec and the audio manager |
| `EARLY_CAPTURE_SCRIPT_TAG` | the game's `<head>`, ahead of its deferred bundles |

The stub is **load-bearing, not defensive**: the track codec's capture fires during bundle
init, *before* `page.tsx`'s frame-`load` handler installs the real `window.__tspml`. Without
a recording stub that capture is silently dropped, the late TrackManager capture succeeds,
and `api.tracks` waits forever on a half-complete pair — with no error anywhere. `page.tsx`
calls `readEarlyCaptures` to replay what the stub caught. The **audio** capture needs no
stub slot: it rides the same late-running constructor as the track store (a different
parameter of it), so it can never arrive pre-bridge. See
[`docs/design/hook-system.md`](../../docs/design/hook-system.md).

What this package *does* own: `lib/demo-transform.ts` — resolving each patch's mappings
`{symbol}` placeholders (fail-closed) and the sha256 `bundleHash` gate. **That gate is the
safety contract:** the injects may reference minified parameter names only because a hash
mismatch means nothing applies at all and the portal serves vanilla.

## Files

| Path | Role |
| --- | --- |
| `app/page.tsx` | "Play" page: registers the SW, mounts the proxied game once controlled, installs the Tier-1 `api` (events · keybinds · tracks · audio) on the iframe window, loads the demo mods + the user's added mods, and renders the live sidebar (including the "Add a mod" form). |
| `app/layout.tsx` | Root layout (App Router). |
| `app/api/proxy/[[...path]]/route.ts` | Server proxy route (GET/OPTIONS) + the three `<head>` injections + the bundle transform. Optional catch-all so the game root (`/api/proxy/?version=…`) also resolves. |
| `lib/rewrite.ts` | Canonical pure `rewriteGameUrl()` + `isGameHost()` — the only place the rewrite rules live (unit-tested). |
| `lib/demo-transform.ts` | Mappings `{symbol}` resolution + the hash-gated application of `@tspml/shared`'s patches. Never throws: on any mismatch the bundle is served untouched. |
| `lib/demo-mods.ts` / `lib/mod-loader.ts` | The bundled demo mods and their load through `@tspml/loader` (per-mod failure isolation — a bad mod never aborts boot). `mod-loader.ts` also routes **user mods** through the same `load()` call. |
| `lib/user-mods.ts` | Runtime user-mod substrate: localStorage persistence (versioned, corruption-tolerant) + Blob-URL `import()` of pasted entrypoint code + the `user:<id>` entry-specifier scheme. Tier-1 only — declared mixins are surfaced as skipped, not applied ([#62](https://github.com/roowus/TSPML/issues/62)). |
| `public/sw.js` | Static service worker; inline copy of `rewriteGameUrl` + a `fetch` listener. |
| `tests/rewrite.test.ts` | vitest unit tests for the rewrite (`demo-transform.ts` is covered indirectly by `@tspml/transform`'s suite plus the smokes). |
| `tests/user-mods.test.ts` | vitest unit tests for the user-mod storage layer + the user-mod path through `loadMods` (injected import — node can't feed a Blob URL to `import()`). |
| `scripts/smoke.mjs`, `scripts/smoke-tracks.mjs`, `scripts/smoke-audio.mjs`, `scripts/smoke-user-mods.mjs` | Playwright headless proofs against the live game (see below). |

## Commands

This package is part of the TSPML pnpm workspace; the orchestrator installs
dependencies. Once installed:

```sh
pnpm --filter @tspml/portal dev    # next dev  → http://localhost:3000
pnpm --filter @tspml/portal build  # next build
pnpm --filter @tspml/portal test   # vitest run (unit)
```

> **Never run `pnpm -r build` while `next dev` is up** — `next build` and `next dev` share
> `.next/`, and the collision serves 500s. Check with `pgrep -f "next dev"` first.

### Headless smokes (need a dev server up, with the transform on)

```sh
TSPML_TRANSFORM=1 pnpm --filter @tspml/portal dev   # terminal 1
pnpm --filter @tspml/portal smoke                   # terminal 2: boot + mods + Tier-1 events
pnpm --filter @tspml/portal smoke:tracks            # terminal 2: the api.tracks registry
pnpm --filter @tspml/portal smoke:audio             # terminal 2: the api.audio registry
pnpm --filter @tspml/portal smoke:usermods          # terminal 2: runtime user-mod loading
```

`smoke.mjs` asserts the transformed bundle runs (badge in DOM + console), the game reaches
gameplay, the demo mods load, the mixin applies, and the race-setup Tier-1 events fire.
`smoke-tracks.mjs` drives **only what a mod can** (`api.tracks` and nothing else): mint a
real import code from the game's own codec → `register` → the track is present in the
**game's** custom-track list → an invalid code is a typed `invalid-code` failure rather than
a throw → `unregister` → gone. It also reports which captures arrived pre-bridge, which is
how we know the stub is load-bearing (`earlyCodec: true`).

`smoke-audio.mjs` does the same for `api.audio`, and its central claim is checkable **by
value**: it synthesizes a WAV blob in the game frame at a deliberately odd 0.37 s, so "did
the override land" is the **game's own** `getBuffer("click")` reporting 0.37 instead of its
real ~0.032 — and reporting ~0.032 again after `unregister`. Also covers a typed
`decode-failed`, an additive new key, a refused collision, and an explicit overwrite.
It needs Chromium's `--autoplay-policy=no-user-gesture-required` (`decodeAudioData` wants a
running `AudioContext`; a headless page never clicks), which the script passes itself.

`smoke-user-mods.mjs` drives the **"+ Add a mod" form** like a modder would: paste a
manifest + built entrypoint → the mod loads through the loader (its entrypoint stamps a
global — the real Blob-URL `import()` the unit tests must fake) → its declared mixin is
surfaced as *skipped* ([#62](https://github.com/roowus/TSPML/issues/62)) → a reload brings
it back from localStorage → disable runs its disposer and drops it (bundled mods
untouched) → remove clears the stored record.

All four portal smokes run in CI (`.github/workflows/smoke.yml`, closing
[#25](https://github.com/roowus/TSPML/issues/25)) — advisory on PRs plus a daily
schedule, never merge-gating, because they fetch the live upstream game and can go
red on a Kodub release rather than a commit. A `pinned-bundle` canary job runs first
so a red smoke is interpretable: canary red = the game shipped a new build.

> Both registry smokes read the captured game objects off the registry's TypeScript-`private`
> `host` field, because the portal deliberately ships **no** dev-only inspection hook (the
> dev harness has `window.__tspmlDev`; the product should not). That coupling is contained
> to these two scripts by design — if a `Tracks`/`Audio` refactor breaks it, fix it there.

### Environment variables (all optional)

| Var | Default | Purpose |
| --- | --- | --- |
| `PORTAL_ORIGIN` | _(unset)_ | Comma-separated list of production origins allowed to read proxied responses (CORS). `localhost`/`127.0.0.1` are always allowed for dev. |
| `POLYTRACK_VERSION` | `0.6.2` | Default game version used by `/api/proxy` when the request omits `?version=`. |
| `NEXT_PUBLIC_POLYTRACK_VERSION` | `0.6.2` | Same, exposed to the browser so the Play page knows which version to iframe. |
| `TSPML_TRANSFORM` | _(unset)_ | `1` enables the AST rewrite of `main.bundle.js`. Off ⇒ the portal is a pure proxy. |

## Known limitations & caveats

- **ToS gray area (origin-forwarding).** The proxy sets `Origin`/`Referer` to
  the official desktop origin so leaderboards/multiplayer trust it (PML's
  Electron trick). This plus running a modified client copy can violate Kodub's
  terms even with zero redistribution. The portal fetches the user's **live**
  game copy and never bundles one; TSPML is warn-only on fairness and will
  comply with takedowns. See
  [`docs/design/safety-and-fairness.md`](../../docs/design/safety-and-fairness.md).
- **Online still fails** ([#7](https://github.com/roowus/TSPML/issues/7)).
  Leaderboard/multiplayer calls 400/502 through the proxy. Root-caused as bot /
  TLS-fingerprint protection on `vps.kodub.com`, not merely an untrusted origin — more
  proxy tuning will not fix it, which is why the extension (a real browser on the real
  origin) is the resilient path. **M8.**
- **`curl` of the game root redirects.** `/api/proxy/?version=…` **308**s to the slashless
  `/api/proxy?version=…`; without `-L` you see an empty body and may wrongly conclude the
  `<head>` injections never landed. This is the same trailing-slash asymmetry the injected
  `<base href="/api/proxy/">` exists to fix — without it the browser treats `proxy` as a
  filename and resolves `<script src="main.bundle.js">` to `/api/main.bundle.js` (404).
- **CORS/CSP caveats.** The route strips the upstream CSP/X-Frame-Options so the
  portal can iframe the proxied document; it drops `Content-Encoding`/`Content-
  Length` (the body is already decompressed server-side). CORS is open only to
  configured portal origins + localhost.
- **Possible Cloudflare 403.** Kodub fronts Cloudflare, which may 403 the
  proxy's `fetch` (user-agent / bot heuristics). The route forwards the client
  `user-agent` to mitigate this; if it persists, the extension/userscript paths
  are the documented fallback.
- **Optional catch-all route.** The proxy uses `app/api/proxy/[[...path]]/`
  (optional catch-all) so the bare game root `/api/proxy/?version=…` resolves;
  a required catch-all (`[...path]`) would 404 on the root.
- **`host=` routing.** Game-asset traffic (default host `app-polytrack.kodub.com`)
  is served as `/<version>/<path>`; other kodub hosts (e.g. `kodub.com` APIs) are
  served as `/<path>` with no version prefix, selected via the `host=` query
  param the SW adds. Only `kodub.com`/`*.kodub.com` hosts are proxied (SSRF
  guard).
- **No `TSPML_EXTRA_PATCHES` here.** That escape hatch is dev-harness-only by design; the
  portal applies exactly the shared, hash-gated set.

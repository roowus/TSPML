# @tspml/portal

Vercel-hosted Next.js web app — TSPML's **flagship delivery surface**. It plays the
**real** PolyTrack game by loading it through a **service worker + server proxy**
(`/api/proxy`), AST-transforms `main.bundle.js` on the way through, and hosts the Tier-1
bridge the mods bind to. The architecture is described in
[`docs/design/injection-and-delivery.md`](../../docs/design/injection-and-delivery.md).

> **Status:** run-validated end to end by five committed headless smokes (below). A real
> mod loads, six Tier-1 events fire during a real race, a mod-declared mixin applies,
> `api.tracks` puts a mod's track in the game's own Custom tracks list, `api.audio`
> replaces one of the game's own sounds, and a **pasted user mod's mixins.json** is
> applied to the served bundle with a per-mod report
> ([#62](https://github.com/roowus/TSPML/issues/62)). Still open: leaderboard/multiplayer
> through the proxy ([#7](https://github.com/roowus/TSPML/issues/7) — `vps.kodub.com` is
> bot-protected, so the **extension** is the resilient path there).

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

## User-mod mixins ([#62](https://github.com/roowus/TSPML/issues/62))

A pasted mod's `mixins.json` (the optional third box in the Add form) reaches the
bundle transform through a **request-carried patch plan** — the server stores nothing:

```
 page.tsx     projects enabled mods' pasted mixins → UserPatchPlan,
              parks it in the Cache API BEFORE the iframe mounts
              (the mount gates on planReady)
 sw.js        intercepts the bundle GET; a parked plan turns it into a
              POST /api/proxy/main.bundle.js with the plan as body
              (no plan → plain GET, byte-identical to pre-#62)
 route.ts     re-validates the plan fail-soft (attacker-shaped body) and
              composes base + user patches in ONE transform() pass
 the bundle   carries the per-mod report back as a
              `;window.__tspmlUserMixins={...};` prelude, which page.tsx
              reads cross-frame on iframe load → the "Your mixins" rows
```

Two contracts, enforced in `lib/demo-transform.ts`:

- **Base patches are all-or-nothing** — any base failure serves vanilla, exactly the
  pre-#62 behavior. A user `replace` aimed at a base-patched target is pre-screened out
  (`conflicts-with-loader-patch`): the engine's conflict detection only groups
  replace-vs-replace, so that replace would otherwise silently splice the bridge hook out.
- **User patches are per-mod isolated** — one mod's bad patch fails that mod's report row
  (`not-found`, `symbol-unresolved`, …); other mods and the base are untouched.

The plan rides only channels writable by same-origin JS (Cache API + POST body) — never
the URL, which would be a reflected-XSS vector and would leak to Kodub via the upstream
query passthrough. Nothing from the POST body is ever forwarded upstream, and POST
responses are `no-store` (per-user bytes must not be cached). Caps live in
`lib/user-patches.ts` (`USER_PATCH_LIMITS`) and are enforced at add time, at plan build,
and again server-side. The running frame keeps the bundle it was served: mixin changes
surface a **restart banner** rather than pretending to apply live.

## Files

| Path | Role |
| --- | --- |
| `app/page.tsx` | "Play" page: registers the SW, mounts the proxied game once controlled, installs the Tier-1 `api` (events · keybinds · tracks · audio) on the iframe window, loads the user's added mods, and renders the live sidebar (including the "Add a mod" form) plus the draggable stage/sidebar resizer. |
| `app/layout.tsx` | Root layout (App Router). |
| `app/globals.css` | All page styling (the page used to inline it; hover/fullscreen/media-query rules can't be inline). The smokes assert on rendered text + structure, so presentation-only changes here are safe. |
| `app/api/proxy/[[...path]]/route.ts` | Server proxy route (GET/POST/OPTIONS) + the three `<head>` injections + the bundle transform. POST is the SW's plan-carrying bundle fetch (#62) — the upstream fetch is always GET, the body never leaves the route. Optional catch-all so the game root (`/api/proxy/?version=…`) also resolves. |
| `lib/rewrite.ts` | Canonical pure `rewriteGameUrl()` + `isGameHost()` — the only place the rewrite rules live (unit-tested). |
| `lib/demo-transform.ts` | Mappings `{symbol}` resolution + the hash-gated application of `@tspml/shared`'s patches, composed with user patch sets (#62: base all-or-nothing, user per-mod isolated, replace pre-screen). Never throws: on any mismatch the bundle is served untouched. |
| `lib/mod-loader.ts` | Routes the user's mods through `@tspml/loader`'s `load()` call (per-mod failure isolation — a bad mod never aborts boot; duplicate-id and dependency pre-gates keep one bad entry from taking the rest down). There are no bundled mods — the demo mods live only in `environments/demo-mods` for the dev harness. |
| `lib/user-mods.ts` | Runtime user-mod substrate: localStorage persistence (versioned, corruption-tolerant) + Blob-URL `import()` of pasted entrypoint code + the `user:<id>` entry-specifier scheme + `parseMixinsJson` for the third paste. |
| `lib/user-patches.ts` | The #62 plan mechanism: caps, plan build/fingerprint (page side), defensive re-parse (server side), and the in-bundle report prelude. |
| `lib/bundle-cache.ts` | In-process memo of the **base** transformed bundle (the plain-GET path) — deterministic per upstream, so a warm instance skips the babel pass. Promise-memoized (the page's prewarm and the SW's real fetch share one compute), short TTL, errors never cached. The #62 POST path is never memoized (per-user report, `no-store`). |
| `lib/mod-import.ts` | "Import from a URL" (#80 first slice): the **browser** fetches a `mod.json` (entrypoint + web-host mixins resolved relative to it) or a single built `.js` (minimal manifest synthesized) — never `/api/proxy`, which stays Kodub-only. Refuses kodub/`/api/` URLs, including ones a manifest resolves to; enforces the #62 caps at import time. |
| `lib/analytics.ts` | Google Analytics 4 wrapper + the mod-usage events (`mod_added`, `mod_loaded`, `mod_load_failed`, `mods_session`). Fully inert unless `NEXT_PUBLIC_GA_ID` is set; sends **mod ids only** — never mod code, mixin contents, import URLs, or share URLs. |
| `public/sample-mod/` | A tiny real mod (`mod.json` + factory entrypoint) the portal serves itself — a known-good same-origin target for "Import from a URL" (and the smoke's URL leg). |
| `public/sw.js` | Static service worker; inline copy of `rewriteGameUrl` + a `fetch` listener + the #62 plan-to-POST replay for the bundle fetch. |
| `tests/rewrite.test.ts` | vitest unit tests for the rewrite. |
| `tests/mod-import.test.ts` | vitest unit tests for URL import: dispatch (manifest / single file / sniffed), relative resolution, host refusals, caps — all against a fake fetch. |
| `tests/bundle-cache.test.ts` | vitest unit tests for the base-bundle memo: hit/miss, in-flight sharing, TTL expiry, per-URL keying, error non-caching — all with injected fetch/transform/clock. |
| `tests/user-mods.test.ts` / `tests/user-patches.test.ts` / `tests/demo-transform.test.ts` | vitest unit tests for the user-mod storage layer + loader path (injected import — node can't feed a Blob URL to `import()`), the #62 plan mechanism, and the compose contracts (driven with a synthetic bundle + map). |
| `scripts/smoke.mjs`, `scripts/smoke-tracks.mjs`, `scripts/smoke-audio.mjs`, `scripts/smoke-user-mods.mjs`, `scripts/smoke-ui.mjs` | Playwright headless proofs against the live game (see below). |
| `scripts/shot-check.mjs` | Dev utility (`pnpm --filter @tspml/portal shot:check`): screenshots the boot overlay, opened Add form, and sidebar to /tmp for a quick visual review. No assertions; not in CI. |

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
pnpm --filter @tspml/portal smoke:usermods          # terminal 2: runtime user mods + pasted mixins
pnpm --filter @tspml/portal smoke:ui                # terminal 2: boot overlay + fullscreen/theater + responsive layout
```

`smoke.mjs` asserts the transformed bundle runs (badge in DOM + console), the game reaches
gameplay, a seeded user mod loads (entrypoint + mixin + unload), and the race-setup Tier-1
events fire.
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
global — the real Blob-URL `import()` the unit tests must fake) → added *without* its
`mixins.json` the declared mixin is surfaced as skipped → re-pasting *with* it raises the
restart banner → the banner's reload brings the mod back from localStorage **and applies
the mixin**: the inject fires in the game frame and the sidebar's "Your mixins" row reads
1/1 applied ([#62](https://github.com/roowus/TSPML/issues/62)) → a second mod with a bogus
`{symbol}` reports 0/1 `symbol-unresolved` while the first mod's row and the base
transform's LIVE badge survive (per-mod isolation) → disable runs its disposer and drops
it (bundled mods untouched) → remove clears the stored records → the Add form's
**"Import from a URL"** method imports the portal's own `/sample-mod/mod.json`
([#80](https://github.com/roowus/TSPML/issues/80) first slice — same-origin, so the
browser's direct fetch needs no CORS cooperation) and the mod loads through the same
pipeline. Unlike the other smokes it **requires** `TSPML_TRANSFORM=1` — the mixin legs
assert on the transformed bundle.

`smoke-ui.mjs` covers the page as a surface rather than the sidebar's claims: the
boot-progress overlay shows during load and clears once every step lands, the
stage's fullscreen button enters/exits fullscreen on the stage wrapper (so the exit
control stays visible) with its label flipping, the expand button toggles theater
mode (the stage covers the tab **without** the Fullscreen API), the sidebar's Log
section exists collapsed and opens onto the timestamped session events, and at phone
width the sidebar stacks below the game. It is the only smoke that does not need
`TSPML_TRANSFORM`.

All five portal smokes run in CI (`.github/workflows/smoke.yml`, closing
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
| `NEXT_PUBLIC_GA_ID` | _(unset)_ | GA4 measurement id (`G-XXXXXXXXXX`). Unset ⇒ no analytics script, no events, nothing to opt out of. See [Analytics](#analytics). |

## Analytics

Off by default. Set `NEXT_PUBLIC_GA_ID` to a GA4 measurement id (Vercel →
project → Settings → Environment Variables, then redeploy — it is inlined at
build time, so a redeploy is required) and the portal loads `gtag.js` and
reports page views plus four custom events:

| Event | Params | Answers |
| --- | --- | --- |
| `mod_added` | `mod_id`, `method` (`paste`/`url`/`share`/`reload`) | Which mods people add, and how they get them |
| `mod_loaded` | `mod_id` | Which mods actually run (one per mod per load pass) |
| `mod_load_failed` | `mod_id` | Which mods are failing in the wild |
| `mods_session` | `count` | How many mods a typical session runs |

**What is deliberately never sent:** mod code, mixin/patch contents, import
URLs, share URLs, failure reason strings, and anything else free-form. A URL
can name a private repo or a user's own host, and a failure reason can quote
manifest contents — the Log section in the sidebar shows those to the user
instead. Events carry the manifest `id` slug and coarse counts, nothing more.
`lib/analytics.ts` is the only module that talks to GA, and
`tests/analytics.test.ts` pins both the payload shape and the unset-id no-op.

## Deployment (tspml.vercel.app)

The portal auto-deploys to **https://tspml.vercel.app** on every push to `main`,
via Vercel's Git integration (project `tspml`, git-connected to `roowus/TSPML`,
production branch `main`). No GitHub Actions workflow is involved — Vercel
builds from its own clone, so CI stays the merge gate and Vercel is only the
delivery vehicle.

Project settings that make the pnpm monorepo build work (set once via
`vercel project update` / the API; recorded here because they live in Vercel,
not in the repo):

| Setting | Value | Why |
|---|---|---|
| Root Directory | `source/portal` | The Next.js app lives here, not at the repo root. Vercel still uploads the whole repo, so workspace deps resolve. |
| Install Command | `pnpm install --ignore-scripts` | Same as CI: skips webcrack's optional `isolated-vm` native build (#2). |
| Build Command | `pnpm --filter @tspml/portal... build` | The `...` builds the portal **and** its workspace deps (they resolve to `./dist`), topologically. |
| Framework | Next.js | Was auto-detected as "Other" at project creation (linked before the root directory was set), which produced a static-only deploy where every route 404'd. |
| Env `TSPML_TRANSFORM=1` | Production | The whole point: serve the AST-transformed bundle. |
| Env `PORTAL_ORIGIN=https://tspml.vercel.app` | Production | CORS allow-list for proxied responses (`/api/proxy` is localhost-only otherwise). |

One repo-side requirement, in `next.config.mjs`: **`outputFileTracingRoot`**
must point at the monorepo root. pnpm hoists dependencies to the root
`node_modules/.pnpm`, two levels above this package; without the setting,
Vercel's file trace resolves those paths relative to `source/portal` and the
deploy fails with `File does not exist: "node_modules/.pnpm/@swc+helpers/..."`.

SSO deployment protection is **disabled** for this project — the portal is a
public site; the game content it proxies is fetched live per user (nothing is
redistributed, same posture as everywhere else in this repo).

For a manual deploy (e.g. testing settings changes without a push):

```sh
cd source/portal
vercel pull --yes --environment=production
vercel build --prod
vercel deploy --prebuilt --prod
```

## Known limitations & caveats

- **ToS gray area (origin-forwarding).** The proxy sets `Origin`/`Referer` to
  the official desktop origin so leaderboards/multiplayer trust it. This plus
  running a modified client copy can violate Kodub's
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

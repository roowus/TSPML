# @tspml/portal

Vercel-hosted Next.js web app — TSPML's **flagship delivery surface**. It plays
the **real** PolyTrack game by loading it through a **service worker + server
proxy** (`/api/proxy`), with the loader present but applying **no game
transforms yet**. This package is the **milestone M2 proof of concept** for the
delivery architecture described in
[`docs/design/injection-and-delivery.md`](../../docs/design/injection-and-delivery.md).

> **Status — honest:** the proxy + SW plumbing is implemented and the rewrite
> logic is unit-tested, but end-to-end "the game actually runs" requires a real
> browser against the live Kodub origin (see the manual test plan). It has NOT
> been validated in a browser yet.

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

## Files

| Path | Role |
| --- | --- |
| `app/page.tsx` | "Play" page: registers the SW, iframes the proxied game, shows a placeholder mod list. |
| `app/layout.tsx` | Root layout (App Router). |
| `app/api/proxy/[[...path]]/route.ts` | Server proxy route (GET/OPTIONS). Optional catch-all so the game root (`/api/proxy/?version=…`) also resolves. |
| `lib/rewrite.ts` | Canonical pure `rewriteGameUrl()` + `isGameHost()` — the only place the rewrite rules live (unit-tested). |
| `public/sw.js` | Static service worker; inline copy of `rewriteGameUrl` + a `fetch` listener. |
| `tests/rewrite.test.ts` | vitest unit tests for the rewrite. |
| `next.config.mjs` / `tsconfig.json` / `vitest.config.ts` | Build / type / test config. |

## Commands

This package is part of the TSPML pnpm workspace; the orchestrator installs
dependencies. Once installed:

```sh
pnpm --filter @tspml/portal dev    # next dev  → http://localhost:3000
pnpm --filter @tspml/portal build  # next build
pnpm --filter @tspml/portal test   # vitest run  (unit tests for lib/rewrite.ts)
```

### Environment variables (all optional)

| Var | Default | Purpose |
| --- | --- | --- |
| `PORTAL_ORIGIN` | _(unset)_ | Comma-separated list of production origins allowed to read proxied responses (CORS). `localhost`/`127.0.0.1` are always allowed for dev. |
| `POLYTRACK_VERSION` | `0.6.2` | Default game version used by `/api/proxy` when the request omits `?version=`. |
| `NEXT_PUBLIC_POLYTRACK_VERSION` | `0.6.2` | Same, exposed to the browser so the Play page knows which version to iframe. |

## Manual test plan (requires a browser)

`pnpm --filter @tspml/portal dev` was NOT run during scaffolding (parallel agent
work); the following must be performed locally/by the orchestrator:

1. `pnpm --filter @tspml/portal dev`, open `http://localhost:3000`.
2. **Unit tests pass:** `pnpm --filter @tspml/portal test` → the `rewrite.test.ts` suite is green.
3. Open DevTools → **Application → Service Workers**: `/sw.js` is registered, scope `/`, status `activated`.
4. **Network tab:** reload. You should see requests to `/api/proxy/…?version=0.6.2` (NOT to `app-polytrack.kodub.com` directly). Confirm:
   - The iframe document request to `/api/proxy/?version=0.6.2` returns HTTP 200 and `text/html`.
   - The game's chunk/WASM/worker requests are served from `/api/proxy/...`.
5. **Proxied request headers:** in the Network tab, inspect a proxied request's server-side behaviour (e.g. via a `curl` to `http://localhost:3000/api/proxy/main.bundle.js?version=0.6.2`) — the upstream request carries `Origin`/`Referer` = the desktop origin. (Browser DevTools show the browser→proxy hop, not the proxy→Kodub hop; use server logs or `curl -v` to confirm origin-forwarding.)
6. **CSP/CORS:** the proxied HTML response has NO `Content-Security-Policy` / `X-Frame-Options` (stripped) so the iframe is allowed; the iframe renders the game canvas.
7. If the game canvas appears and tracks load, the delivery path works. If Kodub returns 403 (Cloudflare bot block) or the game hangs, see limitations.

## Known limitations & caveats

- **Needs browser validation.** The architecture is implemented and the
  rewrite is unit-tested, but "the game runs" has not been confirmed against
  the live origin in a browser. Treat M2 as plumbing-only.
- **ToS gray area (origin-forwarding).** The proxy sets `Origin`/`Referer` to
  the official desktop origin so leaderboards/multiplayer trust it (PML's
  Electron trick). This plus running a modified client copy can violate Kodub's
  terms even with zero redistribution. The portal fetches the user's **live**
  game copy and never bundles one; TSPML is warn-only on fairness and will
  comply with takedowns. See
  [`docs/design/safety-and-fairness.md`](../../docs/design/safety-and-fairness.md).
- **No transforms yet.** The loader is present but inactive. No AST transforms,
  no API bridge, no mod loading in M2 — only the delivery path.
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

# PolyTrack — game internals

> Research target: understand PolyTrack's technology stack and architecture so TSPML can hook it robustly. All facts below are sourced; `WebFetch` could not render the live page (Cloudflare returns HTTP 403 to bots), so structural facts were reconstructed from `curl -I` headers, the official itch.io page, and unofficial static-build mirrors of the shipped browser bundle.

## TL;DR

PolyTrack is a **closed-source**, low-poly racing game by solo developer **Kodub** (kodub.com), inspired by TrackMania. Current version is **0.6.2**. It is a **Three.js (WebGL)** + **ammo.js (Bullet physics compiled to WASM)** browser game, bundled with **webpack** into code-split chunks, with the physics simulation running in a dedicated **Web Worker**. It is **not open source** — only minified bundles ship. The site's Content-Security-Policy is **only** `frame-ancestors` (no `script-src`/`object-src`/`worker-src`), so script injection is **not blocked** today.

## Tech stack & engine

- **Renderer:** Three.js (WebGL). Confirmed via itch.io's "Made with" list (Three.js, Bullet, Blender, GIMP, Inkscape, Audacity) and the `three` dependency in the deobfuscated `package.json` (`three ^0.181.0`).
- **Physics:** Bullet, via **ammo.js** (kripken/ammo.js — Bullet → Emscripten → WASM). The shipped build ships `ammo.wasm.js` (~442 KB JS wrapper) + `ammo.wasm.wasm` (~748 KB WASM). In newer builds this is `polytrack_physics.wasm`, built via `emcc`.
- **Mesh compression:** Google **Draco** (Three.js DracoLoader) — a `draco/` decoder dir is present.
- **No Babylon.js / PlayCanvas / Unity.**

## Bundling & loading

- **webpack** output: a `main.bundle.js` plus numbered code-split chunks (`57/112/168/186/321/535/546/604/615/657/789.bundle.js`), `simulation_worker.bundle.js`, `error_screen.bundle.js`, and (in 0.6.0+) `admin/editor/garage/verifier/haptics/SQLite.bundle.js`.
- `index.html` loads two classic (non-module) deferred scripts: `error_screen.bundle.js` then `main.bundle.js`. `main.bundle.js` lazily loads the chunks and spawns the physics worker. Not Vite.
- Entry DOM: `canvas#screen` + `div#ui` + `div#transition-layer` overlays.

## Architecture — three threads

1. **Main thread** — Three.js rendering, UI/menus (`#ui`), input, car controller, networking.
2. **Simulation worker** (`simulation_worker.bundle.js`) — the physics loop.
3. **Physics WASM** (`polytrack_physics.wasm` / `ammo.wasm.wasm`) — Bullet, driven through the JS glue.

Main ↔ worker communicate by `postMessage`. **Physics is deterministic**, which is what makes input-replay leaderboards possible (see below).

Track data lives as internal `.track` files (`tracks/official/`, `tracks/community/`) plus a shareable text "level/import code" for community sharing. Cars are customizable (0.6.0+). Audio in `audio/`; models are Blender-made and Draco-compressed.

## Multiplayer, leaderboards & anti-cheat (critical for fairness)

- **Multiplayer** (experimental, added 0.6.0): **WebRTC P2P** (`RTCPeerConnection`/`DataChannel`) using **invite codes** (manual signaling) + **TURN/relay** servers (0.6.0 beta 5) for strict-NAT traversal. 0.6.1 let clients also create invites.
- **Leaderboards are server-side.** A record upload includes the **replay**, stored as a series of **timestamps + keyboard inputs** (deterministic input replay, TrackMania-style). The worker-based deterministic sim is what makes replay validation possible.
- The client is trusted for casual play; an **automatic anti-cheat (auto-ban from leaderboards) is in development**.
- **Implication for TSPML:** a mod that alters physics/speed is trivially a leaderboard cheat; the only protection is server-side replay validation (still maturing). Any loader must assume the **client simulation is untrusted**. This drives TSPML's warn-only fairness model.

## Hosting, CSP & version

- **Stack:** Cloudflare (CDN) → Varnish → origin PHP 8.3.32. `cache-control: no-store`, HTTP/2, `alt-svc h3`.
- **CSP:** `frame-ancestors https://kodub.com https://*.kodub.com https://webgamer.io https://www.kongregate.com;` — **the only directive**. There is **no** `script-src`/`object-src`/`worker-src`/`default-src`, so injected scripts, `eval`, Web Workers, and WASM are **all permitted** today. (If Kodub ever adds `script-src`, the userscript path breaks — the browser-extension path survives; see [injection-and-delivery.md](../design/injection-and-delivery.md).)
- **Versions:** 0.6.0 (multiplayer + car customization + editor copy/paste), 0.6.1 (community tracks + client invites + record dates), 0.6.2 (bug fixes, **latest**).

## Source availability

**Closed source.** No official repository. GitHub repos (e.g. `StaticQuasar931/polytrack-0.5.2`, `Hexcein-moonsters/polytrack`, `Joe-The-Chicken/polytrack`, `IAmMyGuy21th/polytrack.3`, `Spike172/polytrack-4.1`) are **unofficial mirrors of the browser build, not source.** Hexcein's note is explicit: *"Source code is never used in this project; all files are available on Kodub's current website."* **Build-time source integration is not possible** — the loader must work against the minified bundles at runtime.

## Community & existing modding

- **Mod loader:** PolyModLoader (PML) — primary repo on Codeberg (`git.polymodloader.com` / `wiki.polymodloader.com`), GitHub mirror `polytrackmods/PolyModLoader`. See [polymodloader-analysis.md](./polymodloader-analysis.md).
- **Mod distribution:** GameBanana (`gamebanana.com/mods/games/20700`), Nexus Mods (nearly empty), Google-Drive mod packs.
- **Track sharing:** in-game editor + text import codes on `polytrackcodes.com`, GitHub (`K-4410/Polytrack-Tracks`), `polytrack.blog`.
- **Records/meta:** `polytrack.best`, `speedrun.com/polytrack`.
- No competing loader of note — PML is the de-facto standard (though the same org maintains a next-gen `pml2`).

## Sources

- https://www.kodub.com/apps/polytrack
- https://www.kodub.com/updates
- https://kodub.itch.io/polytrack
- https://kodub.itch.io/polytrack/devlog/624385/polytrack-030-checkpoints-leaderboards
- https://kodub.itch.io/polytrack/devlog/1539941/polytrack-062-bug-fixes
- https://github.com/StaticQuasar931/polytrack-0.5.2
- https://github.com/cwcinc/polytrack-0.6.0-deobfuscated
- https://github.com/kripken/ammo.js/

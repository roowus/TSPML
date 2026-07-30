# PolyModLoader (PML) — incumbent analysis

> Research target: understand exactly how the existing PolyModLoader works and where it is fragile, so TSPML can improve on it without copying its code (PML has **no license** — only its *design pattern* can be ported). Verified against the GitHub mirror (`polytrackmods/PolyModLoader`, tag `0.6.1`, `src/PolyModLoader.ts` ~2858 lines) and the wiki.

## TL;DR

PML is **not** a userscript, bookmarklet, extension, or runtime proxy. It is a **full self-hosted, statically-patched redistribution of the entire PolyTrack game** (3.4 MB main bundle + WASM physics + all chunks + assets) plus a TypeScript "mixin engine" that monkey-patches the game's **live minified functions** via `Function.prototype.toString()` + literal-substring token matching + `eval()` reassignment. Its central fragility: every hook is keyed to **hardcoded webpack-mangled identifiers** and exact substring tokens, so PML **breaks on every PolyTrack re-build** and must be re-derived by hand per game version (release tags literally encode `gameVersion-build`, e.g. `v0.6.1-0`). Mods are **unsandboxed** ES modules with an `eval(path)` bridge into all game internals. The Electron build even **spoofs the official desktop Origin** to reach multiplayer.

## Injection mechanism — a redistributed, patched game copy

The repo **contains the entire PolyTrack game**: `main.bundle.js` (~3.4 MB), `Untitled-1.js` (~3 MB, a stray un-minified dev artifact), `polytrack_physics.wasm`, `simulation_worker.bundle.js`, a dozen webpack chunks, plus `audio/`, `models/`, `tracks/`, `images/`. `index.html` loads only `error_screen.bundle.js` + `main.bundle.js` — there is **no separate PML script tag**. Instead, `main.bundle.js` was statically **prepended** with the PML bootstrap:

```js
import { ActivePolyModLoader } from "./PolyModLoader.js";
ActivePolyModLoader.initStorage(localStorage);
window.polyModLoader = ActivePolyModLoader;
ActivePolyModLoader.importMods()
  .then(() => ActivePolyModLoader.loadModsFromLauncher())
  .then(() => {
    ActivePolyModLoader.getFromPolyTrackGlobal = (text) => eval(text);
    /* ...the game's webpack runtime... */
  });
```

So PML = (a) a build-time static prepend to the game's main bundle + (b) a runtime mixin engine. A Forgejo action force-pushes this tree to a `pages` branch = `web.polymodloader.com`.

## The Electron shell spoofs the official Origin

`electron/main.js` installs `session.defaultSession.webRequest.onBeforeSendHeaders(...)` that overwrites `Origin` → `https://app-polytrack-desktop.kodub.com` (the official desktop-app origin) so the multiplayer backend treats the PML build as the legitimate client. This is a **trust-model cheat** TSPML explicitly rejects in the loader (the portal's proxy forwards origin only for the portal delivery path, documented as a ToS gray area).

## PML's own stack

TypeScript (`src/PolyModLoader.ts`, `src/PolyTypes.ts`) compiled with plain `tsc` (no app bundler). Desktop wrapper: **Electron 42.0.0-alpha.5** + `@electron/packager` (`--asar`). A separate `PML-Mobile` repo builds iOS/Android (Cordova/Capacitor). Forgejo Actions CI auto-commits compiled JS back to `main` (build artifacts checked in). `lib/` vendors `semver.js` plus Node polyfills. The `test` npm script just launches Electron with devtools — **there is no test framework.**

## Mod loading

A mod is an ES module exporting a `polyMod` instance of a `PolyMod` subclass. Discovery is URL-based via the PML CDN (`https://cdn.polymodloader.com/{gh|cb|gl|bb}/<owner>/<repo>/<branch>/<path>`): fetch root `manifest.json` (`latest[polyVersion]`) → `<version>/version.json` → dynamic `import()`. Caching uses IndexedDB (`'PMLMods'` store) toggled by a setting. Desktop launcher mode fetches `http://localhost:${port}/mods` (an **unsigned** local HTTP server any local process can use — an attack surface). Lifecycle: `preInit → init → postInit → onGameLoad` with semver dependency resolution in `initMods()`.

## The mixin engine — `toString()` + `indexOf(token)` + `eval()` (the core fragility)

`registerClassMixin` (`src/PolyModLoader.ts:1994-2130`): reads `originalFunc.toString()`, finds `tokenIndex = funcStr.indexOf(token)` (literal substring, **not** regex/AST), string-splices the injected body in, re-parses with a regex assuming a fixed function-string shape, and writes back via `eval("scope")["path"] = (function(args){body})`. `REMOVEBETWEEN`/`REPLACEBETWEEN` follow the same shape. **Token matching is exact-substring `indexOf`** — if a token is absent, `indexOf` returns -1 and it throws `Token "..." not found in function "..."`, **aborting PML boot**. `applyChunkMixin` (and the sim-worker/physics/wasm loaders) fetch chunks with **synchronous XHR** (`req.open('GET', url, false)`) on the main thread, then string-surgery them.

## Hardcoded minified identifiers

`enum Variables` (`src/PolyModLoader.ts:228`) pins webpack-mangled names: `SettingsClass='uf'`, `SettingEnum='P.A'`, `KeybindEnum='ge.A'`, `SettingUIFunction='no'`. Recipes also reference `R.gn`, `R.GG`, `i.l` (the webpack chunk loader), `cc.prototype`, `ei.prototype`. **These are mangler outputs that change on every game rebuild** — the root cause of PML's per-update breakage.

## Mod API surface (the thing TSPML replaces)

- **Lifecycle (only 4 in 0.6.1):** `preInit(pml)`, `init(pml)`, `postInit()`, `onGameLoad()`. (The wiki documents a 5th `simInit` and `registerSimWorkerClassMixin`/`registerSimWorkerFuncMixin` that **do not exist** in the 0.6.1 types — the wiki is stale.)
- **No first-class hooks** for pre/post-render, per-frame update, track-load, car-physics-step, checkpoint/lap, input stream, UI/HUD render, or network events — all of that must be done by injecting into minified functions.
- **Mixin API:** `registerClassMixin(scope,path,arg)`, `registerFuncMixin`, `registerClassWideMixin`, `registerGlobalMixin`, `registerChunkMixin(bundleName,arg)`, `registerSimWorkerMixin(arg)` (targets `simulation_worker.bundle.js`), `registerPhysicsLibMixin(arg)` (targets the physics JS glue). `MixinType`: `INSERT {token,func}`, `REPLACEBETWEEN {tokenStart,tokenEnd,func}`, `REMOVEBETWEEN {tokenStart,tokenEnd}`. `MixinToken = string | {token, occ}`.
- **Note (audit correction):** contrary to some research notes, the **sim-worker and physics mixins ARE implemented** in 0.6.1 — `registerSimWorkerMixin` exists and `getSimURL()` fetches `simulation_worker.bundle.js`, string-splices it, and spawns the worker from a Blob URL (same for the physics lib + wasm). So PML **can** reach physics; TSPML's advantage there is DX + determinism-quarantine, not "enabling what PML couldn't."
- **Scope footgun:** injected mixin code runs in **GAME scope**, not the mod's — `this`/closures break; authors must reach state via `ActivePolyModLoader.getMod("<id>")`.
- **Settings/keybinds:** `registerSetting`/`registerKeybind`; `getSetting()` **always returns a string** regardless of declared `SettingType` (a real wart).
- **Extended APIs** (audio, custom blocks) live in a separate `pmlapi` mod, not core.

## Security — effectively none

Mods are dynamic-`import()`'d ES modules in the page realm with **full** DOM/fetch/storage access, **plus** `getFromPolyTrack(path)` / `getFromPolyTrackGlobal(path) = (path) => eval(path)` — an **arbitrary eval sink into the entire game module graph**, including multiplayer netcode. `index.html` ships **no CSP**. The only "safety" is advisory: `touchingPhysics` and `isVanillaCompatible()` feed `isModsVanillaCompatible` into multiplayer invite **metadata** (not enforcement).

## Distribution & docs

Three surfaces (web `pages`-branch, Electron per-OS zips, separate `PML-Mobile`) that must re-release in lockstep per game version. The desktop app **does not auto-update** (the wiki confirms this, despite a `checkForUpdate()` that fetches Codeberg tags — "update check theater"). The README is two sentences with no install steps; the wiki self-describes as "under construction … some information might be outdated."

## Sources

- https://github.com/polytrackmods/PolyModLoader (mirror of git.polymodloader.com / codeberg)
- https://wiki.polymodloader.com/ (quick-start, init-functions, mixins, custom-keybinds-and-settings, pmlapi/audio, pmlapi/blocks, sharing-your-mod, for-users)
- Raw type defs: `PolyModLoader.d.ts`, `PolyTypes.d.ts` (tag `0.6.1`)
- https://web.polymodloader.com/
- https://gamebanana.com/mods/games/20700

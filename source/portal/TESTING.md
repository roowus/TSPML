# Testing TSPML — what you can verify

This guide covers what's testable today and exactly how — especially the **one thing only a browser can confirm**: that a *transformed* PolyTrack bundle actually boots and plays. (Headless tests proved the transforms *parse*; only a real load proves they *run*.)

## 0. One-time setup

```bash
cd /Users/rewis/projects/TSPML          # or: git clone https://github.com/roowus/TSPML.git && cd TSPML
pnpm install --ignore-scripts           # the "isolated-vm" warning is harmless — ignore it
pnpm --filter @tspml/transform build    # build the transform package (the portal demo imports it)
```

## 1. Unit tests — the engines, headless (~15s)

```bash
pnpm -r test
```
Expect **115 passing**: loader 47 + mappings 20 + portal 17 + transform 31. (The 7 real-bundle transform tests run locally; they self-skip on CI.)

## 2. ★ The big one — does a TRANSFORMED game run in a browser?

This is the claim headless tests **cannot** make: "the transform produces *working* JS, not just parse-valid JS."

```bash
# from the repo root:
TSPML_TRANSFORM=1 pnpm --filter @tspml/portal dev
```
Open **http://localhost:3000**.

**What you should see:**
- A green **`TSPML transform ✔ LIVE`** badge fixed in the top-left corner → the transform ran **and** the Car module's factory executed (our injected hook fired at boot).
- In **DevTools → Console**: `[TSPML] transform hook fired — Car module loaded`.
- The game itself should still load and play (the badge floats over a working game).

**What it proves:** the AST-rewritten `main.bundle.js` is not merely parse-valid (`node --check`) — it actually executes, the injected code fires, and the game still runs. That's the core "JS-Mixin is viable for real" claim, confirmed by you in a real browser.

**Diagnosis:**
- **Badge shows but game is broken** → the transform altered runtime behavior somewhere (a closure / `this` / strict-mode issue). Paste me the console error. (This is exactly the gap I flagged: parse-valid ≠ run-valid.)
- **Badge does NOT show** → DevTools → Network → find `main.bundle.js`; its response headers should include `x-tspml-transformed: 1`. If it's `0` or missing, the env didn't take — kill the server and re-run with `TSPML_TRANSFORM=1` on the command.

## 3. Vanilla comparison — does the game play through the proxy at all?

```bash
pnpm --filter @tspml/portal dev     # WITHOUT TSPML_TRANSFORM
```
Open http://localhost:3000. Does the *unmodified* game render and play through the proxy + service worker?
- DevTools → **Network**: confirm game requests go to `/api/proxy/...` (not directly to `kodub.com`, which would CORS-fail). Watch for any 4xx/5xx or an asset type the proxy mishandles — a numbered `*.bundle.js` chunk, `polytrack_physics.wasm`, a `blob:`/`data:` worker URL, or a websocket. These tell us what the proxy needs for full coverage (M2 follow-ups / issue #3).

## What to paste back to me (gold for M4)

- Any **Console** errors (red), comparing the transformed run (step 2) vs vanilla (step 3).
- Any **Network** requests that failed or bypassed `/api/proxy/...`.
- Whether the green badge appeared, and whether the game played in each mode.

## What this does NOT test yet (honest)

- **Real mods with live hooks** — no mod-loading is wired into the running game yet (that's M4+, the API bridge). Today's marker is a hardcoded demo hook, not a loaded mod.
- **Multiplayer / leaderboards** through the proxy (WebRTC/websocket paths are unvalidated in a browser).
- **Chunks** — only `main.bundle.js` is transformed; 0.6.2 splits more code into numbered chunks (issue #3).

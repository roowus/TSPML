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

**What you should see (give it ~35–40s on a cold dev proxy):**
- A green **`TSPML transform ✔ LIVE`** badge fixed in the top-left corner → the transform ran **and** the Car module's factory executed (our injected hook fired at boot). ✅
- In **DevTools → Console**: `[TSPML] transform hook fired — Car module loaded`.
- A **"Unofficial TSPML mod by roowus"** banner (the game recognized the TSPML mod loader via its own `polytrackModConfiguration` hook) → the "unofficial version" gate is cleared.
- The game **boots, loads, and reaches playable gameplay** — the full menu (Play, Official/Community/Custom tracks, Garage, Editor, Multiplayer) and, on Play, a **real race** (HUD: speedometer `km/h`, timer `00:00.000`, `0/3` checkpoints) on a track like **"Summer 1"**. ✅

**What it proves:** the AST-rewritten `main.bundle.js` executes in a real browser, the gate is cleared via the game's own mod-loader hook (no bundle surgery, no origin-spoof), and the transformed, modded game is **fully playable** through the portal. This is the end-to-end claim, confirmed in a real browser.

**Diagnosis:**
- **Stuck on the static "unofficial version" warning (no menu, no Play)** → the `polytrackModConfiguration` injection isn't taking. Check DevTools → Network → the `index.html` response: it must contain `<script>window.polytrackModConfiguration=…</script>` and (header) `x-tspml-unblocked: 1`. If missing, the dev server wasn't started with `TSPML_TRANSFORM=1`.
- **"Failed to load track" error** → the service worker wasn't active on first load (the game's track fetch bypassed it → CORS-failed). A plain **reload** (SW is now `active` + `clients.claim()`-ed) clears it. The smoke test reloads once for exactly this reason.
- **Badge does NOT show** → DevTools → Network → `main.bundle.js` response headers should include `x-tspml-transformed: 1`. If `0`/missing, re-run with `TSPML_TRANSFORM=1`.
- See [docs/research/portal-browser-test-findings.md](../../docs/research/portal-browser-test-findings.md).

## 3. Vanilla comparison — does the game play through the proxy at all?

```bash
pnpm --filter @tspml/portal dev     # WITHOUT TSPML_TRANSFORM
```
Open http://localhost:3000. Does the *unmodified* game render and play through the proxy + service worker? (Note: the vanilla path hits the **same** unofficial-gate / track-load issues as the transformed path — that's the game's own origin check, not the transform.)
- DevTools → **Network**: confirm game requests go to `/api/proxy/...` (not directly to `kodub.com`, which would CORS-fail). Watch for any 4xx/5xx or an asset type the proxy mishandles — a numbered `*.bundle.js` chunk, `polytrack_physics.wasm`, a `blob:`/`data:` worker URL, or a websocket. These tell us what the proxy needs for full coverage (M2 follow-ups / issue #3).

## What to paste back to me (gold for M4)

- Any **Console** errors (red), comparing the transformed run (step 2) vs vanilla (step 3).
- Any **Network** requests that failed or bypassed `/api/proxy/...`.
- Whether the green badge appeared, and whether the game played in each mode.

## What this does NOT test yet (honest)

- **Real mods with live hooks** — no mod-loading is wired into the running game yet (that's the rest of M4, the API bridge). Today's marker is a hardcoded demo hook, not a loaded mod.
- **Online / leaderboards / multiplayer** through the proxy — one `502` on an online call remains (issue #7, M8). Non-blocking for local gameplay.
- **Chunks** — only `main.bundle.js` is transformed; 0.6.2 splits more code into numbered chunks (issue #3).

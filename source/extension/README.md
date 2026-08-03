# TSPML browser extension (M8 — resilient fallback)

The **secondary delivery path**: runs on the real `kodub.com` origin where leaderboard/multiplayer work natively (no proxy, no `vps.kodub.com` bot-protection issue). The portal (Vercel) is the flagship; this extension is the fallback for online features.

## Status (M8 first slice)

✅ **Gate fix** — clears the "unofficial version" warning via `polytrackModConfiguration` (runs at `document_start`, before the game bundle). The game plays on kodub.com without the warning.

🚧 **Later slices:**
- Expose `window.__tspml` (EventBus + Keybinds) — requires bundling `@tspml/api-bridge`.
- Load mods via `@tspml/loader`.
- Apply transforms via `declarativeNetRequest` (rewrite `main.bundle.js` with AST-patched code — requires bundling `@babel/*`).

## Install (for testing)

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top right).
3. **Load unpacked** → select `source/extension/`.
4. Visit https://www.kodub.com/apps/polytrack — the game should load without the "unofficial version" warning (check the console for `[TSPML] extension active`).

## Why this matters

The portal's proxy can't reach `vps.kodub.com` (bot-protected — TLS-fingerprint drop). But the extension runs IN the browser ON `kodub.com` — so the game's own fetches to `vps.kodub.com` succeed (real browser fingerprint). This is the path to working online features (leaderboards, multiplayer).

See [docs/design/injection-and-delivery.md](../../docs/design/injection-and-delivery.md) + [docs/research/portal-browser-test-findings.md](../../docs/research/portal-browser-test-findings.md).

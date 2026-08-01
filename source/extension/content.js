// TSPML browser extension — content script (runs on kodub.com/apps/polytrack).
//
// This is the RESILIENT FALLBACK delivery path: it runs on the REAL kodub.com
// origin (no proxy, no bot-protection issue) where leaderboard/multiplayer work
// natively. The portal (Vercel) is the flagship; this extension is the fallback
// for online features + when the proxy is blocked.
//
// M8 first slice: clears the "unofficial version" gate (the same
// polytrackModConfiguration hook the portal uses) so the game plays. Later
// slices will expose window.__tspml (EventBus + Keybinds) + load mods + apply
// transforms via declarativeNetRequest (bundle rewriting).
//
// Runs at document_start (BEFORE the game bundle) so polytrackModConfiguration
// is set when the game's bootstrap checks it.

(function () {
  "use strict";

  // 1. Gate fix — clear the "unofficial version" warning via the game's own
  //    mod-loader hook (the same mechanism PML + the portal use).
  try {
    window.polytrackModConfiguration = Object.assign(
      window.polytrackModConfiguration || {},
      { modName: "TSPML", author: "extension" }
    );
    console.log("%c[TSPML] extension active — gate cleared, game will play on kodub.com", "color:#39ff14");
  } catch (e) {
    console.error("[TSPML] gate fix failed:", e);
  }

  // 2. (TODO — later slices)
  //    - Expose window.__tspml = { events: EventBus, keybinds: Keybinds, ... }
  //      (requires bundling @tspml/api-bridge into the extension).
  //    - Load mods via @tspml/loader (bundled demo mods or user-selected).
  //    - Apply transforms via declarativeNetRequest (rewrite main.bundle.js
  //      response with the AST-patched version — requires bundling @babel/*).
  //    Until then, this extension just clears the gate (the game plays vanilla
  //    with no unofficial-version warning, on the real origin where online works).
})();

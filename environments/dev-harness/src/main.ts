/**
 * @tspml/dev-harness — the harness client.
 *
 * Boots the real transformed game in a same-origin iframe, exposes the Tier-1
 * bridge (window.__tspml) so the transformed bundle can emit events, and runs the
 * dev mod against a TRACKED api so its subscriptions can be torn down on
 * hot-reload. Vite HMR swaps the mod's entrypoint in place — the game keeps
 * running; only the mod's listeners/keybinds are disposed + re-registered.
 *
 * HMR scope: entrypoint logic (events/keybinds) hot-swaps. A mod-declared MIXIN
 * change alters the bundle transform — that needs a full reload (documented).
 */
import { EventBus, Keybinds } from "@tspml/api-bridge";
import type { ModApi } from "@tspml/loader";
import { trackModApi } from "./tracking-api";
import type { Subscribable } from "./tracking-api";
// The dev mod, aliased to its SOURCE so edits hot-reload (see vite.config.ts).
import initialFactory from "tspml:dev-mod";

const GAME_VERSION = "0.6.2";
const TSPML_VERSION = "0.0.0-dev";

type ModFactory = (api: ModApi) => unknown;
type FrameWindow = Window & { __tspml?: unknown };

const bus = new EventBus();
const frame = document.getElementById("game") as HTMLIFrameElement;
const statusEl = document.getElementById("status") as HTMLElement;

let currentFactory: ModFactory = initialFactory as ModFactory;
let keybinds: Keybinds | null = null;
let tracked = trackModApi({ events: bus as unknown as Subscribable, keybinds: stubKeybinds() });

// Smoke-test observability (the headless harness smoke reads these).
const dev = {
  modLoaded: false,
  modLoadCount: 0,
  controlCount: 0,
  keybindCount: 0,
};
Object.defineProperty(window, "__tspmlDev", { value: dev, writable: true });

/** A no-op registry used until the iframe exists (Keybinds needs the frame window). */
function stubKeybinds() {
  return {
    register: () => () => {},
    unregister: () => {},
  };
}

function setStatus(text: string, kind: "ok" | "warn" | "err" = "ok"): void {
  statusEl.textContent = text;
  statusEl.dataset.kind = kind;
}

/** Run the current mod factory against a fresh tracked api (disposes the previous). */
function runMod(): void {
  if (!keybinds) return; // frame not loaded yet — nothing to bind to
  tracked.disposeAll();
  tracked = trackModApi({
    events: bus as unknown as Subscribable,
    keybinds,
    logger: console,
    version: TSPML_VERSION,
  });
  try {
    currentFactory(tracked as unknown as ModApi);
    dev.modLoaded = true;
    dev.modLoadCount += 1;
    setStatus(`mod loaded (×${dev.modLoadCount})`, "ok");
  } catch (e) {
    dev.modLoaded = false;
    setStatus(`mod entrypoint threw: ${(e as Error).message}`, "err");
    console.error("[tspml] mod entrypoint threw:", e);
  }
}

// Mount the game iframe + wire the bridge on load.
frame.addEventListener("load", () => {
  const w = frame.contentWindow as FrameWindow | null;
  if (!w) return;
  if (!keybinds) keybinds = new Keybinds(w);
  // The raw api the GAME emits to (window.__tspml.events.emit -> our bus).
  w.__tspml = { events: bus, keybinds, logger: console, version: TSPML_VERSION };
  runMod();
});
frame.src = `/game/?version=${GAME_VERSION}`;

// Count car.control + a visible demo keybind for the HUD / smoke.
bus.on("car.control", () => {
  dev.controlCount += 1;
});

// Vite HMR: hot-swap the mod entrypoint while the game keeps running.
if (import.meta.hot) {
  import.meta.hot.accept("tspml:dev-mod", (mod) => {
    if (mod?.default) {
      currentFactory = mod.default as ModFactory;
      runMod();
      console.log("[tspml] mod hot-reloaded");
    }
  });
}

// Throttled HUD refresh.
window.setInterval(() => {
  const c = dev.controlCount;
  setStatus(
    `mod ${dev.modLoaded ? "loaded" : "—"} (×${dev.modLoadCount}) · car.control × ${c}`,
    dev.modLoaded ? "ok" : "warn",
  );
}, 500);

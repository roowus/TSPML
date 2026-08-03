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
import { EventBus, Keybinds, Tracks } from "@tspml/api-bridge";
import type { GameTrackCodec, GameTrackManager } from "@tspml/api-bridge";
import type { ModApi } from "@tspml/loader";
import { readEarlyCaptures } from "@tspml/shared";
import { trackModApi } from "./tracking-api";
import type { Subscribable } from "./tracking-api";
// The dev mod, aliased to its SOURCE so edits hot-reload (see vite.config.ts).
import initialFactory from "tspml:dev-mod";

const GAME_VERSION = "0.6.2";
const TSPML_VERSION = "0.0.0-dev";

type ModFactory = (api: ModApi) => unknown;
type FrameWindow = Window & { __tspml?: unknown };

const bus = new EventBus();
const tracks = new Tracks();
const frame = document.getElementById("game") as HTMLIFrameElement;
const statusEl = document.getElementById("status") as HTMLElement;

/**
 * The custom-track registry needs two objects that only exist once the game has
 * built its menu, so the bridge patches hand them over as they appear (#12). We
 * attach the registry when BOTH have arrived; until then `tracks.register` queues.
 */
let capturedManager: GameTrackManager | null = null;
let capturedCodec: GameTrackCodec | null = null;
function attachTracksIfReady(): void {
  if (!capturedManager || !capturedCodec || tracks.ready) return;
  tracks.attach({ manager: capturedManager, codec: capturedCodec });
  dev.tracksReady = true;
  console.log("[tspml] custom-track registry attached");
}

let currentFactory: ModFactory = initialFactory as ModFactory;
let keybinds: Keybinds | null = null;
let tracked = trackModApi({ events: bus as unknown as Subscribable, keybinds: stubKeybinds() });

// Smoke-test observability (the headless harness smoke reads these).
const dev = {
  modLoaded: false,
  modLoadCount: 0,
  controlCount: 0,
  keybindCount: 0,
  tracksReady: false,
  gameCustomTrackNames,
  sampleTrackCode,
};
Object.defineProperty(window, "__tspmlDev", { value: dev, writable: true });

/**
 * Dev-only track inspection for the headless smoke (scripts/smoke-tracks.mjs).
 *
 * These deliberately reach past `api.tracks`: the smoke's whole point is to check
 * the GAME's own custom-track list (not our mirror of it), and to register it needs
 * a REAL import code — which, since the codec is the game's, can only honestly be
 * obtained by exporting a track the game already has. A mod never needs either.
 * Harness-only: the portal ships none of this.
 */
type DevTrackManager = GameTrackManager & {
  forEachOfficialTrack?(
    fn: (
      id: string,
      group: unknown,
      metadata: unknown,
      environment: unknown,
      load: () => Promise<unknown>,
    ) => void,
  ): void;
};

/** The names in the game's own "Custom tracks" list. */
function gameCustomTrackNames(): string[] {
  const names: string[] = [];
  capturedManager?.forEachCustomTrack((_id, metadata) => names.push(metadata?.name));
  return names;
}

/** Export an official track to a real `PolyTrack2…` code. Null if the game isn't there yet. */
async function sampleTrackCode(name: string, author: string): Promise<string | null> {
  const tm = capturedManager as DevTrackManager | null;
  if (!tm?.forEachOfficialTrack) return null;
  const loaders: (() => Promise<unknown>)[] = [];
  tm.forEachOfficialTrack((_id, _group, _metadata, _environment, load) => {
    loaders.push(load);
  });
  const first = loaders[0];
  if (!first) return null;
  const loaded = (await first()) as { trackData?: { toExportString(m: unknown): string } };
  const data = loaded?.trackData ?? (loaded as unknown as { toExportString?: unknown });
  if (typeof (data as { toExportString?: unknown })?.toExportString !== "function") return null;
  return (data as { toExportString(m: unknown): string }).toExportString({
    name,
    author,
    lastModified: null,
  });
}

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
    tracks,
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
  // The raw api the GAME emits to (window.__tspml.events.emit -> our bus), plus the
  // capture callbacks the track-registry patches call (#12).
  w.__tspml = {
    events: bus,
    keybinds,
    tracks,
    logger: console,
    version: TSPML_VERSION,
    captureTrackManager: (m: GameTrackManager) => {
      capturedManager = m;
      attachTracksIfReady();
    },
    captureTrackCodec: (c: GameTrackCodec) => {
      capturedCodec = c;
      attachTracksIfReady();
    },
  };
  // Anything captured before this handler ran. The codec's module factory executes
  // during bundle init — i.e. BEFORE `load` — so without this replay its capture is
  // lost and the registry never attaches (@tspml/shared's EARLY_CAPTURE_STUB).
  const early = readEarlyCaptures<GameTrackManager, GameTrackCodec>(w);
  if (early.manager) capturedManager = early.manager;
  if (early.codec) capturedCodec = early.codec;
  attachTracksIfReady();
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

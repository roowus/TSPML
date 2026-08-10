// Headless browser smoke test — does the (transformed) PolyTrack game BOOT and
// emit Tier-1 events through the bridge in a real browser?
//
//   TSPML_TRANSFORM=1 pnpm --filter @tspml/portal dev   # serve transformed game
//   pnpm --filter @tspml/portal smoke                    # this script
//
// PASS requires: the transformed bundle ran ([TSPML] marker logged), the
// "unofficial version" gate cleared (pastGate), the bridge is wired, the
// verifiable Tier-1 events fired during the auto-started race — car.control,
// car.created, race.started, track.afterLoad — the portal's own sidebar
// reflects the load (#41), AND a real `pagehide` tears the mod back down (#17).
//
// There are no bundled mods anymore: this smoke SEEDS one user mod into
// localStorage (the same store the Add form writes) before first load. The
// seeded mod replicates what the old bundled demo-hud proved — an entrypoint
// that subscribes car.control, registers a KeyG keybind, and returns a
// disposer — plus a mixins.json patch, so the full user-mod path (storage →
// loader → parked plan → SW POST replay → compose → inject firing in the game
// frame) is under test on every run, not just in smoke-user-mods.
//
// race.started is checked as EXACTLY 1 and attributed to the player's car
// (#10) — it is a per-car event, and this is a solo race. Ghost cars cannot occur
// here (a fresh browser has no saved record to replay), so the player/ghost logic
// itself is covered by an executable fixture in @tspml/shared, not by this script.
// checkpoint.passed / checkpoint.respawn / race.finished need the player to
// actually pass a checkpoint / respawn at one / finish, so they are reported but
// not asserted (expect 0 in this harness — a respawn additionally requires a
// passed checkpoint first, so it is doubly out of reach; the #64 edge semantics
// are covered by the executable fixture in @tspml/shared).
//
// TWO FRAMES, and the distinction matters: the game runs in the /api/proxy
// iframe (`gameFrame`), the portal chrome in the main frame (`page.mainFrame()`).
// Asserting only on the former is how a broken sidebar stayed green.
//
// KEY: events like car.created / track.afterLoad fire at RACE SETUP (early),
// so we subscribe to ALL events the moment the portal exposes window.__tspml —
// before the boot/race window — instead of at a fixed late point.
import { chromium } from "playwright";

const URL = process.env.SMOKE_URL ?? "http://localhost:3000";
const SHOT = process.env.SMOKE_SHOT ?? "/tmp/tspml-smoke.png";

// The seeded user mod (see header). Counters hang off the `api` object, which
// the portal exposes on the GAME frame as window.__tspml — same read path the
// old bundled demo-hud used. The disposer flips `unloaded` for the #17 leg.
const SEEDED_MOD_ID = "smoke-seeded-hud";
const SEEDED_RECORD = {
  manifest: {
    schemaVersion: 1,
    id: SEEDED_MOD_ID,
    name: "Smoke seeded HUD",
    version: "1.0.0",
    entrypoint: "entrypoint.js",
    targets: [">=0.6.0 <0.7.0"],
    mixins: [{ config: "mixins.json" }],
  },
  code: `export default (api) => {
  const c = { control: 0, key: 0, loaded: true };
  api.__smokeHud = c;
  const offControl = api.events.on("car.control", () => { c.control++; });
  const unregister = api.keybinds.register({
    id: "${SEEDED_MOD_ID}.toggle",
    key: "KeyG",
    description: "Seeded HUD: toggle",
    onDown: () => { c.key++; },
  });
  api.logger.log("[${SEEDED_MOD_ID}] loaded");
  return () => { offControl(); unregister(); c.unloaded = true; };
};`,
  // A Tier-2 mixin on the mapped Car symbol (the proven M5-C shape): rides the
  // parked plan → SW POST replay → server compose, and stamps a game-frame
  // global this smoke asserts.
  mixins: [
    {
      op: "after",
      symbol: "Car",
      inject: "(function(){ try { window.__smokeSeededMixin = true; } catch (e) {} })();",
    },
  ],
  enabled: true,
  addedAt: "2026-08-09T00:00:00.000Z",
};

const COUNTED_EVENTS = [
  "car.control",
  "car.created",
  "race.started",
  "track.afterLoad",
  "checkpoint.passed",
  "checkpoint.respawn",
  "race.finished",
];

const browser = await chromium.launch({
  headless: true,
  args: [
    "--use-gl=angle",
    "--use-angle=swiftshader-webgl",
    "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist",
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const consoleMsgs = [];
const pageErrors = [];
const failed = [];
page.on("console", (m) => consoleMsgs.push(`${m.type()}: ${m.text().slice(0, 240)}`));
page.on("pageerror", (e) => pageErrors.push(String(e && e.message ? e.message : e).slice(0, 360)));
page.on("requestfailed", (r) =>
  failed.push(`${r.method()} ${r.url().slice(0, 140)} :: ${r.failure()?.errorText ?? "?"}`),
);

function findFrame(urlIncludes) {
  return (
    page.frames().find((f) => f !== page.mainFrame() && f.url().includes(urlIncludes)) ?? null
  );
}

// Seed the user mod into the SAME localStorage key the Add form writes, before
// any portal script runs — the portal's first load then picks it up exactly as
// it would a mod the user added on a previous visit (persistence path).
await page.addInitScript((record) => {
  try {
    window.localStorage.setItem("tspml.userMods.v1", JSON.stringify([record]));
  } catch {}
}, SEEDED_RECORD);

process.stderr.write(`smoke: goto ${URL}\n`);
await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 30000 });

// Wait for the game iframe to mount (the page mounts it after the service worker
// controls the page), then for the portal to expose window.__tspml (iframe
// onLoad). Subscribe to all Tier-1 events IMMEDIATELY once available.
let gameFrame = null;
for (let i = 0; i < 60 && !gameFrame; i++) {
  gameFrame = findFrame("/api/proxy");
  if (!gameFrame) await page.waitForTimeout(300);
}
gameFrame = gameFrame ?? page.mainFrame();

let bridgeWired = false;
let bridgeError = null;
for (let i = 0; i < 50; i++) {
  const r = await gameFrame
    .evaluate(() => !!(window.__tspml && window.__tspml.events && typeof window.__tspml.events.on === "function"))
    .catch(() => false);
  if (r) {
    bridgeWired = true;
    break;
  }
  await page.waitForTimeout(400);
}
if (bridgeWired) {
  try {
    await gameFrame.evaluate((evs) => {
      window.__tspmlCounts = {};
      // Keep the PAYLOADS of the per-car race events, not just their counts (#10):
      // the whole point of that fix is which car an event came from, and a count
      // cannot show that. Capped so a runaway emit cannot balloon the page.
      window.__tspmlPayloads = {};
      for (const e of evs) {
        window.__tspmlCounts[e] = 0;
        window.__tspmlPayloads[e] = [];
        window.__tspml.events.on(e, (arg) => {
          window.__tspmlCounts[e] = (window.__tspmlCounts[e] || 0) + 1;
          if (window.__tspmlPayloads[e].length < 10 && arg && typeof arg === "object") {
            window.__tspmlPayloads[e].push({ carId: arg.carId ?? null, isReplay: arg.isReplay ?? null });
          }
        });
      }
      // Register a keybind via the registry (api.keybinds) to verify the
      // registry path; dispatch below.
      window.__tspmlKb = 0;
      window.__tspml.keybinds.register({
        id: "smoke.kb",
        key: "KeyP",
        onDown: () => { window.__tspmlKb = (window.__tspmlKb || 0) + 1; },
      });
    }, COUNTED_EVENTS);
  } catch (e) {
    bridgeError = String(e && e.message ? e.message : e).slice(0, 160);
  }
}

// Boot/race window: webpack init → module graph → assets → loading screen →
// menu → auto-started race. car.created + track.afterLoad fire during race
// setup in this window (we are already subscribed).
await page.waitForTimeout(35000);

const dom = await gameFrame.evaluate(() => {
  const badge = document.getElementById("tspml-live-marker");
  const canvas = document.querySelector("canvas");
  const menu = document.querySelector(".menu-ui");
  const buttons = document.querySelector(".main-buttons-container");
  const text = document.body ? document.body.innerText : "";
  return {
    href: location.href,
    badgePresent: !!badge,
    canvasSize: canvas ? `${canvas.width}x${canvas.height}` : null,
    pastGate:
      (menu && menu.classList.contains("loading-screen")) ||
      (buttons && buttons.querySelectorAll("button,[role=button],a").length > 0) ||
      /km\/h|00:00\.\d/.test(text),
    reachedGameplay: /km\/h/.test(text),
    // #62: the seeded mod's mixin rode the parked plan → SW POST replay →
    // server compose, and its inject ran inside the served bundle.
    modMixinApplied: window.__smokeSeededMixin === true,
    bodyText: text.slice(0, 200),
  };
});
// #41: assert the PORTAL'S OWN UI, not just the game frame. Everything above
// reads `gameFrame`; the sidebar lives in the MAIN frame, which this smoke used
// to never look at. A dropped `setSafetyStatus` (exactly what the #32/#33
// collision nearly shipped) compiles fine and leaves every assertion above
// green — the sidebar just silently stops saying anything.
//
// The id is hardcoded on purpose. "the list is non-empty" is satisfied by the
// placeholder row too ("loading…" / "waiting for game…"), so a regression to the
// placeholder would pass. Naming what the portal actually loads is what makes
// this an assertion rather than a shape check.
const EXPECTED_MOD_IDS = [SEEDED_MOD_ID];

const sidebar = await page.mainFrame().evaluate((expected) => {
  const aside = /** @type {HTMLElement | null} */ (
    document.querySelector('aside[aria-label="Mods"]')
  );
  if (!aside) return { present: false, text: "", modIds: [], statuses: [] };
  const text = aside.innerText || "";
  // Scope to the "Loaded mods" section: with user mods seeded, the "Your mods"
  // rows (whose first <span> is the buttons wrapper) and the "Your mixins"
  // report rows also render a <code> — only the loaded list's first <span> is
  // the load status.
  const section = Array.from(aside.querySelectorAll("section")).find(
    (s) => s.querySelector("h2")?.textContent?.trim() === "Loaded mods",
  );
  const rows = Array.from((section ?? aside).querySelectorAll("li"));
  const modIds = rows
    .map((li) => li.querySelector("code"))
    .filter(Boolean)
    .map((el) => el.textContent.trim());
  const statuses = rows
    .map((li) => li.querySelector("code") && li.querySelector("span"))
    .filter(Boolean)
    .map((el) => el.textContent.trim());
  const row = (label) => {
    const m = text.match(new RegExp(`^${label}:\\s*(.+)$`, "m"));
    return m ? m[1].trim() : null;
  };
  return {
    present: true,
    text: text.slice(0, 400),
    modIds,
    statuses,
    missingIds: expected.filter((id) => !modIds.includes(id)),
    // Placeholder copy from page.tsx's empty branch — if either survives to
    // here, the list never populated.
    placeholderVisible: /loading…|waiting for game…/.test(text),
    modsRow: row("mods"),
    safetyRow: row("safety"),
  };
}, EXPECTED_MOD_IDS);

// The safety row renders only when `safetyStatus` is non-empty, so its presence
// IS the regression test for the dropped setter. Require a real classification,
// not merely a non-empty string.
const sidebarOk =
  sidebar.present &&
  !sidebar.placeholderVisible &&
  (sidebar.missingIds || []).length === 0 &&
  sidebar.statuses.length > 0 &&
  sidebar.statuses.every((s) => s === "loaded") &&
  !!sidebar.modsRow &&
  sidebar.modsRow.startsWith("✓") &&
  !!sidebar.safetyRow &&
  /vanillaSafe/.test(sidebar.safetyRow);

const menuShot = SHOT.replace(/\.png$/, "-menu.png");
await page.screenshot({ path: menuShot });

// controlCar (car.control) + race.started are input-driven: race.started fires
// on first throttle. Focus the canvas, then drive + poll for events.
//
// The click can legitimately fail on a CI runner — Playwright's actionability
// checks time out against a swiftshader-rendered canvas that never settles, and
// the first CI run of this smoke failed exactly there: clickOk false, so nothing
// had keyboard focus, so race.started stayed 0 while every non-input assertion
// passed. Fall back to a forced click (skips actionability) and then to focusing
// the canvas directly. The click is only ever a means of getting focus onto the
// game frame; it is not itself under test, which is why a fallback is honest
// here rather than a way of making red go green.
let clickOk = true;
let focusPath = "click";
try {
  await gameFrame.locator("canvas").first().click({ timeout: 5000 });
} catch (e) {
  clickOk = false;
  try {
    await gameFrame.locator("canvas").first().click({ timeout: 5000, force: true });
    focusPath = "force-click";
  } catch (e2) {
    try {
      await gameFrame.locator("canvas").first().focus({ timeout: 3000 });
      focusPath = "focus";
    } catch (e3) {
      focusPath = "none";
    }
  }
}
let counts = {};
for (let attempt = 0; attempt < 8; attempt++) {
  // Re-assert focus each round. A single click at the top is fragile: the game
  // can move focus itself (the race auto-starts, menus mount), and on a slow
  // runner the first rounds land before anything is listening.
  if (attempt > 0) {
    await gameFrame
      .locator("canvas")
      .first()
      .click({ timeout: 2000, force: true })
      .catch(() => {});
  }
  await page.keyboard.down("ArrowUp");
  await page.waitForTimeout(600);
  await page.keyboard.up("ArrowUp");
  if (attempt % 2 === 0) {
    await page.keyboard.down("ArrowLeft");
    await page.waitForTimeout(500);
    await page.keyboard.up("ArrowLeft");
  }
  counts = await gameFrame.evaluate(() => window.__tspmlCounts || {});
  if ((counts["car.control"] || 0) > 0 && (counts["race.started"] || 0) > 0) break;
}

const payloads = await gameFrame.evaluate(() => window.__tspmlPayloads || {});

const raceShot = SHOT.replace(/\.png$/, "-race.png");
await page.screenshot({ path: raceShot });

// Verify the KEYBIND REGISTRY: dispatch the registered key (KeyP) on the game
// frame's window and assert the registered onDown fired exactly once.
let keybindFired = 0;
try {
  keybindFired = await gameFrame.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyP" }));
    return window.__tspmlKb || 0;
  });
} catch (e) {
  keybindFired = -1;
}

// Verify the SEEDED USER MOD: its car.control listener rides the same bus (so
// it should have fired during the race), and its KeyG keybind should fire on
// dispatch. Proves a stored user mod loaded through the real Blob-URL import
// and subscribed via the api.
let mod = { loaded: false, control: 0, key: 0 };
try {
  await gameFrame.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyG" })));
  mod = await gameFrame.evaluate(() => {
    const d = (window.__tspml && window.__tspml.__smokeHud) || {};
    return { loaded: !!d.loaded, control: d.control || 0, key: d.key || 0 };
  });
} catch (e) {
  mod = { loaded: false, control: 0, key: 0 };
}

// #17 — does cleanup actually RUN in a browser? Every piece of the unload chain was
// implemented and unit-tested while nothing invoked it, so the assertion that tells
// "wired" apart from "merely present" is one made against a real page teardown.
//
// Runs LAST, after every reading above has been taken: it deliberately destroys the
// thing under test. The event is `pagehide` because that is what the portal binds
// (`unload` never fires on mobile Safari and disables the bfcache), and it is dispatched
// on the MAIN frame, where the listener lives — the portal chrome, not the game iframe.
//
// The observable is the seeded mod's `unloaded` flag, set by the disposer it
// returns — exactly the old demo-hud contract, now proven on the user-mod path.
const unloadCheck = { before: null, after: null, error: null };
try {
  unloadCheck.before = await gameFrame.evaluate(
    () => window.__tspml?.__smokeHud?.unloaded === true,
  );
  await page.mainFrame().evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false }));
  });
  // Teardown is async (the loader awaits each mod's disposer), so poll rather than read
  // once — a single synchronous read races it and reports a false negative.
  unloadCheck.after = await gameFrame.evaluate(async () => {
    for (let i = 0; i < 40; i++) {
      if (window.__tspml?.__smokeHud?.unloaded === true) return true;
      await new Promise((r) => setTimeout(r, 50));
    }
    return false;
  });
} catch (e) {
  unloadCheck.error = String(e && e.message ? e.message : e).slice(0, 160);
}
// `before === false` is part of the assertion: if the flag were somehow already set,
// `after === true` would prove nothing about the teardown we just triggered.
const unloadOk = unloadCheck.before === false && unloadCheck.after === true;

const markerLogs = consoleMsgs.filter((l) => l.includes("TSPML"));
const c = (e) => counts[e] || 0;

/**
 * #10: `race.started` is PER-CAR, and this harness runs a solo race — so exactly
 * one car starts. The old gate was `> 0`, which is also satisfied by a run where
 * ghosts fire five extra events; that looseness is precisely why the per-car bug
 * went unnoticed for a milestone. Pinning the number is what makes it an assertion
 * (conventions.md: "hardcode what you expect, not just its shape").
 *
 * And the payload must say WHICH car: the player's, so `isReplay === false`. A
 * `null` here would mean the transform applied but the binding read failed —
 * the silent-degradation path, which a count can never distinguish from success.
 */
const startedPayloads = payloads["race.started"] ?? [];
const playerStarted =
  c("race.started") === 1 &&
  startedPayloads.length === 1 &&
  startedPayloads[0]?.isReplay === false &&
  typeof startedPayloads[0]?.carId === "number";
// HARD requirements: gate cleared, bundle ran, bridge wired, the four verifiable
// Tier-1 events fired, the keybind registry fired, AND the portal's own sidebar
// reflects the load (#41). checkpoint.passed / race.finished are reported only
// (need real race progress).
const pass =
  sidebarOk &&
  dom.pastGate &&
  markerLogs.length > 0 &&
  bridgeWired &&
  c("car.control") > 0 &&
  c("car.created") > 0 &&
  playerStarted &&
  c("track.afterLoad") > 0 &&
  keybindFired === 1 &&
  mod.loaded &&
  mod.control > 0 &&
  mod.key === 1 &&
  dom.modMixinApplied &&
  unloadOk;

console.log(
  JSON.stringify(
    {
      PASS: pass,
      verdict: {
        markerConsoleLogged: markerLogs.length > 0,
        pastGate: dom.pastGate,
        reachedGameplay: dom.reachedGameplay,
        bridgeWired,
        keybindFired,
        modLoaded: mod.loaded,
        modControl: mod.control,
        modKey: mod.key,
        modMixinApplied: dom.modMixinApplied,
        // #17: the mod's disposer ran on a real page teardown.
        unloadOk,
        unloadCheck,
        events: {
          "car.control": c("car.control"),
          "car.created": c("car.created"),
          "race.started": c("race.started"),
          "track.afterLoad": c("track.afterLoad"),
          "checkpoint.passed": c("checkpoint.passed"),
          "checkpoint.respawn": c("checkpoint.respawn"),
          "race.finished": c("race.finished"),
        },
        // #10: solo race => exactly one race.started, from the PLAYER's car.
        playerStarted,
        perCarPayloads: {
          "race.started": startedPayloads,
          "checkpoint.passed": payloads["checkpoint.passed"] ?? [],
          "checkpoint.respawn": payloads["checkpoint.respawn"] ?? [],
          "race.finished": payloads["race.finished"] ?? [],
        },
        sidebarOk,
        sidebar: {
          present: sidebar.present,
          modIds: sidebar.modIds,
          statuses: sidebar.statuses,
          missingIds: sidebar.missingIds,
          placeholderVisible: sidebar.placeholderVisible,
          modsRow: sidebar.modsRow,
          safetyRow: sidebar.safetyRow,
        },
        canvasSize: dom.canvasSize,
        badgePresent: dom.badgePresent,
        clickOk,
        // Which route got keyboard focus onto the game frame. Reported, not
        // asserted — "none" alongside a green run is worth knowing about.
        focusPath,
        jsPageErrors: pageErrors.length,
        failedRequests: failed.length,
      },
      bridgeError,
      markerLogs: markerLogs.slice(0, 5),
      pageErrors: pageErrors.slice(0, 8),
      failedSample: failed.slice(0, 10),
      bodyText: dom.bodyText,
      menuShot,
      raceShot,
    },
    null,
    2,
  ),
);

await browser.close();
process.exit(pass ? 0 : 1);

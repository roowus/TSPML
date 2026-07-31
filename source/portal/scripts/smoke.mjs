// Headless browser smoke test — does the (optionally transformed) PolyTrack
// game actually BOOT in a real browser via the portal? This closes the gap that
// `node --check` can't: "parse-valid" != "run-valid". Only a real browser load
// proves the transformed bundle executes.
//
// Run, in two shells:
//   TSPML_TRANSFORM=1 pnpm --filter @tspml/portal dev   # serve transformed game
//   pnpm --filter @tspml/portal smoke                    # this script
// (Drop TSPML_TRANSFORM to smoke the vanilla proxy path instead.)
//
// What it asserts (PASS): the transformed bundle EXECUTED (the `[TSPML]` marker
// logged to the console) AND the game CLEARED its "unofficial version" gate
// (pastGate). If a race actually ran, it MUST have fired `car.control` events
// through the bridge (carControlEvents > 0) — zero during a race is an M4-B/C
// wiring regression. Also reports reachedGameplay, uncaught page errors, failed
// network requests, canvas size, and saves screenshots. The genuinely-subjective
// call ("does it look / play well") is still left to a human.
import { chromium } from "playwright";

const URL = process.env.SMOKE_URL ?? "http://localhost:3000";
const SHOT = process.env.SMOKE_SHOT ?? "/tmp/tspml-smoke.png";

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

process.stderr.write(`smoke: goto ${URL}\n`);
await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 30000 });
// NO reload. The page mounts the game iframe only after the service worker
// controls the page (controllerchange), so a first-visit load already proxies
// the game's track/leaderboard fetches — this is exactly the path that used to
// throw "Failed to load track" on a plain first visit (issue #9). Testing it
// without a reload is the real regression signal.
// Boot window: SW activate → iframe mount → webpack init → module graph → Car
// module load (badge) → assets load → loading screen → menu/race. Through the
// dev proxy clearing the gate + reaching the menu takes ~20s; a full race ~35s.
await page.waitForTimeout(34000);

// The game runs inside a same-origin iframe at /api/proxy/...
const gameFrame =
  page
    .frames()
    .find((f) => f !== page.mainFrame() && f.url().includes("/api/proxy")) ??
  page.mainFrame();

const dom = await gameFrame.evaluate(() => {
  const badge = document.getElementById("tspml-live-marker");
  const canvas = document.querySelector("canvas");
  const menu = document.querySelector(".menu-ui");
  const buttons = document.querySelector(".main-buttons-container");
  const text = document.body ? document.body.innerText : "";
  return {
    href: location.href,
    title: document.title,
    badgePresent: !!badge,
    badgeText: badge ? badge.textContent : null,
    canvasPresent: !!canvas,
    canvasSize: canvas ? `${canvas.width}x${canvas.height}` : null,
    // Did the game get PAST the "unofficial version" gate? The gate holds the
    // game on a static warning screen (no menu, no loading). Once cleared it
    // shows the loading screen + puts the full menu in the DOM (Play, tracks,
    // etc.), and ultimately the race HUD. See docs/research/portal-browser-test-findings.md.
    pastGate:
      (menu && menu.classList.contains("loading-screen")) ||
      (buttons && buttons.querySelectorAll("button,[role=button],a").length > 0) ||
      /km\/h|00:00\.\d/.test(text),
    reachedGameplay: /km\/h/.test(text),
    bodyText: text.slice(0, 300),
  };
});

const menuShot = SHOT.replace(/\.png$/, "-menu.png");
await page.screenshot({ path: menuShot });

// M4-C: subscribe to the bridge's `car.control` event. The portal exposes the
// Tier-1 EventBus on the iframe as `window.__tspml`; the transformed controlCar
// hook emits to it each frame. Count emissions while the race runs below.
const bridgeWired = await gameFrame.evaluate(() => {
  try {
    if (window.__tspml && typeof window.__tspml.on === "function") {
      window.__tspmlControlCount = 0;
      window.__tspml.on("car.control", () => {
        window.__tspmlControlCount = (window.__tspmlControlCount || 0) + 1;
      });
      return true;
    }
  } catch (e) {
    window.__tspmlErr = String(e);
  }
  return false;
});

// Probe: can we get past the menu into actual gameplay? (non-fatal — gameplay may
// legitimately need server calls the proxy doesn't handle yet.)
const errsBefore = pageErrors.length;
const probe = {
  clicked: null,
  candidates: [],
  afterCanvas: dom.canvasSize,
  afterBodyLen: null,
  afterText: null,
  newErrorsAfterClick: 0,
};
try {
  const click = await gameFrame.evaluate(() => {
    const all = [...document.querySelectorAll("button,[role=button],a,div,span,li")];
    const vis = (e) => {
      const r = e.getBoundingClientRect();
      return r.width > 40 && r.height > 14 && r.top >= 0;
    };
    const cands = all
      .filter(vis)
      .map((e) => (e.textContent || "").trim())
      .filter((t) => t && t.length < 28)
      .slice(0, 40);
    const play = all.find(
      (e) =>
        vis(e) &&
        /\b(play|single|race|start|solo|drive|time attack)\b/i.test((e.textContent || "").trim()) &&
        (e.textContent || "").trim().length < 28,
    );
    if (play) {
      play.click();
      return { clicked: (play.textContent || "").trim().slice(0, 28), candidates: cands };
    }
    return { clicked: null, candidates: cands };
  });
  probe.clicked = click.clicked;
  probe.candidates = click.candidates;
  await page.waitForTimeout(7000);
  const after = await gameFrame.evaluate(() => ({
    canvas: (() => {
      const c = document.querySelector("canvas");
      return c ? `${c.width}x${c.height}` : null;
    })(),
    bodyLen: document.body ? document.body.innerText.length : 0,
    text: (document.body ? document.body.innerText : "").slice(0, 240),
  }));
  probe.afterCanvas = after.canvas;
  probe.afterBodyLen = after.bodyLen;
  probe.afterText = after.text;
} catch (e) {
  probe.error = String(e && e.message ? e.message : e).slice(0, 200);
}
probe.newErrorsAfterClick = pageErrors.length - errsBefore;
const raceShot = SHOT.replace(/\.png$/, "-race.png");
await page.screenshot({ path: raceShot });

// `controlCar` is input-CHANGE-driven (fires on keydown/keyup via the input
// state's change callback, not every frame), so a passive observer gets zero
// events. Focus the canvas (recording failure rather than swallowing it), then
// drive + POLL for the first car.control event — decoupling from exact
// race-start timing instead of a single point read.
let clickOk = true;
try {
  await gameFrame.locator("canvas").first().click({ timeout: 3000 });
} catch (e) {
  clickOk = false;
  probe.driveError = `canvas click failed: ${String(e && e.message ? e.message : e).slice(0, 140)}`;
}
probe.clickOk = clickOk;

let bridge = { count: 0, err: null };
for (let attempt = 0; attempt < 6 && bridge.count === 0; attempt++) {
  await page.keyboard.down("ArrowUp");
  await page.waitForTimeout(600);
  await page.keyboard.up("ArrowUp");
  if (attempt % 2 === 0) {
    await page.keyboard.down("ArrowLeft");
    await page.waitForTimeout(500);
    await page.keyboard.up("ArrowLeft");
  }
  bridge = await gameFrame.evaluate(() => ({
    count: window.__tspmlControlCount ?? 0,
    err: window.__tspmlErr ?? null,
  }));
}

const markerLogs = consoleMsgs.filter((l) => l.includes("TSPML"));
const inRace = dom.reachedGameplay || /km\/h/.test(probe.afterText || "");
// HARD requirement (M4-B/C): the bridge must be wired AND `car.control` must
// have fired. A vacuous pass (bridge unwired / zero events) is a FAILURE, not a
// skip — this is the exact wiring the milestone exists to prove. `inRace` is
// reported for diagnosis only.
const pass =
  dom.pastGate &&
  markerLogs.length > 0 &&
  bridgeWired &&
  bridge.count > 0;

console.log(
  JSON.stringify(
    {
      PASS: pass,
      verdict: {
        markerConsoleLogged: markerLogs.length > 0,
        pastGate: dom.pastGate,
        reachedGameplay: dom.reachedGameplay,
        bridgeWired,
        carControlEvents: bridge.count,
        badgePresent: dom.badgePresent,
        canvasPresent: dom.canvasPresent,
        canvasSize: dom.canvasSize,
        jsPageErrors: pageErrors.length,
        failedRequests: failed.length,
      },
      dom,
      markerLogs: markerLogs.slice(0, 5),
      pageErrors: pageErrors.slice(0, 10),
      failedSample: failed.slice(0, 15),
      consoleSample: consoleMsgs.slice(0, 25),
      menuShot,
      raceShot,
      probe,
    },
    null,
    2,
  ),
);

await browser.close();
process.exit(pass ? 0 : 1);

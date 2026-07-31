// Headless browser smoke test — does the (transformed) PolyTrack game BOOT and
// emit Tier-1 events through the bridge in a real browser?
//
//   TSPML_TRANSFORM=1 pnpm --filter @tspml/portal dev   # serve transformed game
//   pnpm --filter @tspml/portal smoke                    # this script
//
// PASS requires: the transformed bundle ran ([TSPML] marker logged), the
// "unofficial version" gate cleared (pastGate), the bridge is wired, AND the
// verifiable Tier-1 events fired during the auto-started race — car.control,
// car.created, race.started, track.afterLoad. checkpoint.passed / race.finished
// need the player to actually pass a checkpoint / finish, so they are reported
// but not asserted (expect 0 in this harness).
//
// KEY: events like car.created / track.afterLoad fire at RACE SETUP (early),
// so we subscribe to ALL events the moment the portal exposes window.__tspml —
// before the boot/race window — instead of at a fixed late point.
import { chromium } from "playwright";

const URL = process.env.SMOKE_URL ?? "http://localhost:3000";
const SHOT = process.env.SMOKE_SHOT ?? "/tmp/tspml-smoke.png";

const COUNTED_EVENTS = [
  "car.control",
  "car.created",
  "race.started",
  "track.afterLoad",
  "checkpoint.passed",
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
    .evaluate(() => !!(window.__tspml && typeof window.__tspml.on === "function"))
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
      for (const e of evs) {
        window.__tspmlCounts[e] = 0;
        window.__tspml.on(e, () => {
          window.__tspmlCounts[e] = (window.__tspmlCounts[e] || 0) + 1;
        });
      }
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
    bodyText: text.slice(0, 200),
  };
});
const menuShot = SHOT.replace(/\.png$/, "-menu.png");
await page.screenshot({ path: menuShot });

// controlCar (car.control) + race.started are input-driven: race.started fires
// on first throttle. Focus the canvas, then drive + poll for events.
let clickOk = true;
try {
  await gameFrame.locator("canvas").first().click({ timeout: 3000 });
} catch (e) {
  clickOk = false;
}
let counts = {};
for (let attempt = 0; attempt < 6; attempt++) {
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

const raceShot = SHOT.replace(/\.png$/, "-race.png");
await page.screenshot({ path: raceShot });

const markerLogs = consoleMsgs.filter((l) => l.includes("TSPML"));
const c = (e) => counts[e] || 0;
// HARD requirements: gate cleared, bundle ran, bridge wired, and the four
// verifiable Tier-1 events all fired. checkpoint.passed / race.finished are
// reported only (they need the player to pass a checkpoint / finish the race).
const pass =
  dom.pastGate &&
  markerLogs.length > 0 &&
  bridgeWired &&
  c("car.control") > 0 &&
  c("car.created") > 0 &&
  c("race.started") > 0 &&
  c("track.afterLoad") > 0;

console.log(
  JSON.stringify(
    {
      PASS: pass,
      verdict: {
        markerConsoleLogged: markerLogs.length > 0,
        pastGate: dom.pastGate,
        reachedGameplay: dom.reachedGameplay,
        bridgeWired,
        events: {
          "car.control": c("car.control"),
          "car.created": c("car.created"),
          "race.started": c("race.started"),
          "track.afterLoad": c("track.afterLoad"),
          "checkpoint.passed": c("checkpoint.passed"),
          "race.finished": c("race.finished"),
        },
        canvasSize: dom.canvasSize,
        badgePresent: dom.badgePresent,
        clickOk,
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

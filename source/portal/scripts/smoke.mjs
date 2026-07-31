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
// What it asserts: the injected TSPML badge appears in the game iframe's DOM
// (=> the Car-module factory ran => the transformed bundle executed without
// throwing up to that point) AND the marker logged to the console. It also
// reports uncaught page errors + failed network requests + whether a <canvas>
// rendered + saves a screenshot. The genuinely-subjective call ("does it look
// / play well") is still left to a human.
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
// Let the service worker register + claim, then reload so runtime requests route
// through the proxy on the second load.
await page.waitForTimeout(2500);
await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
// Boot window: webpack init → module graph → Car module load (badge) → render.
await page.waitForTimeout(12000);

// The game runs inside a same-origin iframe at /api/proxy/...
const gameFrame =
  page
    .frames()
    .find((f) => f !== page.mainFrame() && f.url().includes("/api/proxy")) ??
  page.mainFrame();

const dom = await gameFrame.evaluate(() => {
  const badge = document.getElementById("tspml-live-marker");
  const canvas = document.querySelector("canvas");
  return {
    href: location.href,
    title: document.title,
    badgePresent: !!badge,
    badgeText: badge ? badge.textContent : null,
    canvasPresent: !!canvas,
    canvasSize: canvas ? `${canvas.width}x${canvas.height}` : null,
  };
});

await page.screenshot({ path: SHOT });

const markerLogs = consoleMsgs.filter((l) => l.includes("TSPML"));
const pass = dom.badgePresent && markerLogs.length > 0;

console.log(
  JSON.stringify(
    {
      PASS: pass,
      verdict: {
        badgePresent: dom.badgePresent,
        markerConsoleLogged: markerLogs.length > 0,
        canvasPresent: dom.canvasPresent,
        jsPageErrors: pageErrors.length,
        failedRequests: failed.length,
      },
      dom,
      markerLogs: markerLogs.slice(0, 5),
      pageErrors: pageErrors.slice(0, 10),
      failedSample: failed.slice(0, 15),
      consoleSample: consoleMsgs.slice(0, 25),
      screenshot: SHOT,
    },
    null,
    2,
  ),
);

await browser.close();
process.exit(pass ? 0 : 1);

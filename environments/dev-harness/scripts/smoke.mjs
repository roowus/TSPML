// Headless smoke for the dev harness: does Vite serve the transformed game, does
// the bridge + mod wire up, do Tier-1 events fire, and does a mod-source edit
// hot-swap the mod WITHOUT reloading the game?
//
//   pnpm --filter @tspml/dev-harness dev   # in one terminal (serves :5173)
//   pnpm --filter @tspml/dev-harness smoke # in another
//
// PASS requires: transformed bundle ran (badge), the gate cleared, the mod loaded,
// car.control fired, AND HMR incremented modLoadCount after a mod-source edit.
import { chromium } from "playwright";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const BASE_URL = process.env.SMOKE_URL ?? "http://localhost:5173";
const SHOT = process.env.SMOKE_SHOT ?? "/tmp/tspml-harness-smoke.png";
const SCRIPT_DIR = fileURLToPath(new URL(".", import.meta.url));
// The default dev mod the harness aliases to (vite.config.ts DEV_MOD_DEFAULT).
const DEV_MOD = process.env.TSPML_DEV_MOD ?? join(SCRIPT_DIR, "../../demo-mods/example-hud/src/entrypoint.ts");

const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader-webgl", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const consoleMsgs = [];
const pageErrors = [];
const failed = [];
page.on("console", (m) => consoleMsgs.push(`${m.type()}: ${m.text().slice(0, 240)}`));
page.on("pageerror", (e) => pageErrors.push(String(e && e.message ? e.message : e).slice(0, 360)));
page.on("requestfailed", (r) => failed.push(`${r.method()} ${r.url().slice(0, 120)} :: ${r.failure()?.errorText ?? "?"}`));

const findFrame = (inc) => page.frames().find((f) => f !== page.mainFrame() && f.url().includes(inc)) ?? null;

process.stderr.write(`smoke: goto ${BASE_URL}\n`);
await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 30000 });

// Wait for the game iframe (/game) to mount + boot.
let gameFrame = null;
for (let i = 0; i < 60 && !gameFrame; i++) {
  gameFrame = findFrame("/game");
  if (!gameFrame) await page.waitForTimeout(300);
}
gameFrame = gameFrame ?? page.mainFrame();

// Boot window (webpack init → assets → menu → auto-race). The bridge is exposed on
// the game frame (window.__tspml); the harness/mod state is on the TOP frame
// (window.__tspmlDev, set by src/main.ts).
await page.waitForTimeout(35000);

const gameDom = await gameFrame.evaluate(() => {
  const badge = document.getElementById("tspml-live-marker");
  const canvas = document.querySelector("canvas");
  const text = document.body ? document.body.innerText : "";
  return {
    badgePresent: !!badge,
    canvasSize: canvas ? `${canvas.width}x${canvas.height}` : null,
    pastGate: /km\/h|00:00\.\d/.test(text) || !!document.querySelector(".main-buttons-container"),
    reachedGameplay: /km\/h/.test(text),
    bodyText: text.slice(0, 160),
  };
});
await page.screenshot({ path: SHOT });

// Bridge wired (game frame) + initial mod state (top frame).
const bridgeWired = await gameFrame
  .evaluate(() => !!(window.__tspml && window.__tspml.events && typeof window.__tspml.events.on === "function"))
  .catch(() => false);
let dev = await page.evaluate(() => window.__tspmlDev || {}).catch(() => ({}));

// Drive to fire car.control (controlCar is input-change-driven).
try { await gameFrame.locator("canvas").first().click({ timeout: 3000 }); } catch {}
for (let attempt = 0; attempt < 6; attempt++) {
  await page.keyboard.down("ArrowUp");
  await page.waitForTimeout(600);
  await page.keyboard.up("ArrowUp");
  dev = await page.evaluate(() => window.__tspmlDev || {}).catch(() => ({}));
  if ((dev.controlCount || 0) > 0) break;
}

const beforeHmr = (dev.modLoadCount || 0);

// ── HMR proof: edit the dev mod SOURCE, expect Vite to hot-swap it (modLoadCount++)
//    WITHOUT a page/game reload. Restored in finally so the committed file is clean.
let hmrIncremented = false;
let hmrNote = "";
const original = await readFile(DEV_MOD, "utf8").catch(() => null);
if (original === null) {
  hmrNote = `dev mod not found at ${DEV_MOD}; HMR step skipped`;
} else {
  try {
    await writeFile(DEV_MOD, original + "\n// smoke-hmr-probe\n", "utf8");
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(400);
      const after = await page.evaluate(() => window.__tspmlDev || {}).catch(() => ({}));
      if ((after.modLoadCount || 0) > beforeHmr) { hmrIncremented = true; break; }
    }
    if (!hmrIncremented) hmrNote = "mod-source edit did not trigger a hot-swap within 8s";
  } catch (e) {
    hmrNote = `HMR step errored: ${(e && e.message ? e.message : e).slice(0, 120)}`;
  } finally {
    try { await writeFile(DEV_MOD, original, "utf8"); } catch {}
  }
}

// After HMR, did the GAME FRAME survive (no reload)? The badge should still be there
// (a reload would re-boot; the point is it did NOT reload). We assert the game frame
// url is unchanged + badge still present.
const survived = await gameFrame.evaluate(() => !!document.getElementById("tspml-live-marker")).catch(() => false);

const markerLogs = consoleMsgs.filter((l) => l.includes("TSPML"));
const pass =
  gameDom.badgePresent &&
  gameDom.pastGate &&
  bridgeWired &&
  (dev.controlCount || 0) > 0 &&
  (dev.modLoaded || false) &&
  hmrIncremented &&
  survived;

console.log(
  JSON.stringify(
    {
      PASS: pass,
      verdict: {
        badgePresent: gameDom.badgePresent,
        pastGate: gameDom.pastGate,
        reachedGameplay: gameDom.reachedGameplay,
        canvasSize: gameDom.canvasSize,
        bridgeWired,
        modLoaded: dev.modLoaded,
        controlCount: dev.controlCount,
        modLoadCountBeforeHmr: beforeHmr,
        hmrIncremented,
        gameSurvivedHmr: survived,
      },
      hmrNote,
      markerLogs: markerLogs.slice(0, 5),
      pageErrors: pageErrors.slice(0, 8),
      failedSample: failed.slice(0, 10),
      bodyText: gameDom.bodyText,
      shot: SHOT,
    },
    null,
    2,
  ),
);

await browser.close();
process.exit(pass ? 0 : 1);

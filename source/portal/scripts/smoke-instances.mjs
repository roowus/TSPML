// Headless proof for the PER-INSTANCE MOD OVERLAY (launcher phase 4): does a
// mod switched off for one instance actually stop running there, without
// changing anything for any other instance?
//
//   TSPML_TRANSFORM=1 pnpm --filter @tspml/portal dev    # in one terminal (:3000)
//   pnpm --filter @tspml/portal smoke:instances          # in another
//
// This is the only executable proof the overlay works. vitest runs
// `environment: 'node'`, so the pure resolution in lib/instances.ts is unit
// tested but the wiring — URL → resolved instance → projected mod set → parked
// plans → loader — has no other test, and every one of those steps can be
// individually correct while the composition runs the wrong mods.
//
// The load-bearing leg is `poolUntouched`. The overlay is applied by PROJECTING
// the shared pool through it (`applyInstanceOverlay`) and handing the
// projection to the runtime; hand that same projection to `saveUserMods` by
// mistake and one instance's per-mod switch silently becomes the global one for
// every other instance. That bug loses user data, produces no error, and looks
// exactly like success from every other assertion here — so it is checked
// against localStorage directly, twice, rather than inferred from the UI.
//
// PASS requires, in order:
//   A. keeps    — /play?instance=keep loads the mod and runs its entrypoint;
//                 the row offers "skip in this instance" and not its inverse;
//   B. skips    — /play?instance=skip, same pool, does NOT load it. The
//                 entrypoint never runs, the row is still listed (an overlay
//                 hides a mod from an instance, it does not delete it) and
//                 reads "off here"; the POOL record is still enabled:true and
//                 the instance kept its overlay plus a fresh lastPlayedAt;
//   C. toggles  — clicking "use in this instance" brings it back LIVE, with no
//                 reload: the mod loads, the overlay is cleared from the
//                 instance store, and the pool is STILL untouched;
//   D. skips     — clicking "skip in this instance" unloads it live, writes the
//                 id into the overlay, and leaves the pool record enabled.
//
// Leg D is not symmetry for its own sake, and legs B and C cannot stand in for
// it. B's overlay is SEEDED, so it exercises no write at all, and C only ever
// turns a mod ON — where the projection is equal to the pool and persisting it
// by mistake is invisible. A planted `saveUserMods(projection)` in the toggle
// handler passed B and C and was caught only by D.
//
// SEEDING NOTE, learned the hard way: the init script must guard on
// `window.top !== window`. The game runs in a same-origin /api/proxy iframe, so
// an unguarded addInitScript re-seeds localStorage inside it and clobbers
// whatever the launch effect just wrote — which reads as a lost write in a
// product that wrote correctly.
import { chromium } from "playwright";

const BASE_URL = process.env.SMOKE_URL ?? "http://localhost:3000";
const SHOT = process.env.SMOKE_SHOT ?? "/tmp/tspml-instances-smoke.png";
const MOD_ID = "smoke-overlay-mod";

const step = (msg) => process.stderr.write(`smoke:instances · ${msg}\n`);

// One mod, in the SHARED pool, enabled. Both instances below see this same
// record — that is the whole point of the model under test.
const RECORD = {
  manifest: {
    schemaVersion: 1,
    id: MOD_ID,
    name: "Smoke overlay mod",
    version: "1.0.0",
    entrypoint: "entrypoint.js",
    targets: [">=0.6.0 <0.7.0"],
  },
  code: `export default (api) => {
  window.__smokeOverlayRuns = (window.__smokeOverlayRuns || 0) + 1;
  api.logger.log("[${MOD_ID}] loaded");
  return () => {};
};`,
  enabled: true,
  addedAt: "2026-08-24T00:00:00.000Z",
};

// Two instances differing ONLY in the overlay, so any behavioural difference
// between legs A and B is attributable to it and to nothing else.
const INSTANCES = {
  schemaVersion: 1,
  activeId: "keep",
  instances: [
    {
      id: "keep",
      name: "Keeps it",
      gameVersion: "0.6.2",
      createdAt: "2026-08-24T00:00:00.000Z",
      disabledModIds: [],
    },
    {
      id: "skip",
      name: "Skips it",
      gameVersion: "0.6.2",
      createdAt: "2026-08-24T00:00:00.000Z",
      disabledModIds: [MOD_ID],
    },
  ],
};

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

const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e && e.message ? e.message : e).slice(0, 300)));

await page.addInitScript(
  ({ record, instances }) => {
    // Top frame only — see the SEEDING NOTE in the header.
    if (window.top !== window) return;
    try {
      window.localStorage.setItem("tspml.userMods.v1", JSON.stringify([record]));
      window.localStorage.setItem("tspml.instances.v1", JSON.stringify(instances));
    } catch {}
  },
  { record: RECORD, instances: INSTANCES },
);

const out = {};

/** Open /play for one instance, absorbing the cold-profile SW dance (#9). */
async function open(instanceId) {
  await page.goto(`${BASE_URL}/play?instance=${instanceId}`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  let frame = await page
    .waitForSelector('iframe[title="PolyTrack (proxied)"]', { timeout: 30000 })
    .catch(() => null);
  if (!frame) {
    step("  no iframe — reloading for SW control");
    await page.reload({ waitUntil: "domcontentloaded" });
    frame = await page
      .waitForSelector('iframe[title="PolyTrack (proxied)"]', { timeout: 45000 })
      .catch(() => null);
  }
  return !!frame;
}

const sidebarText = () =>
  page.evaluate(() => {
    const aside = /** @type {HTMLElement | null} */ (
      document.querySelector('aside[aria-label="Mods"]')
    );
    return aside?.innerText ?? "";
  });

/** Wait until the main frame matches (or timeout → false). */
const waitForSidebar = (predicateSource, timeout = 90000) =>
  page
    .waitForFunction(predicateSource, undefined, { timeout, polling: 500 })
    .then(() => true)
    .catch(() => false);

const countButton = (label) =>
  page.locator(`aside[aria-label="Mods"] button:has-text("${label}")`).count();

/** The shared pool, read straight from storage. */
const readPool = () =>
  page.evaluate(() => {
    try {
      return JSON.parse(window.localStorage.getItem("tspml.userMods.v1") ?? "[]");
    } catch {
      return null;
    }
  });

/** One instance, read straight from storage. */
const readInstance = (id) =>
  page.evaluate((wanted) => {
    try {
      const store = JSON.parse(window.localStorage.getItem("tspml.instances.v1") ?? "{}");
      return (store.instances ?? []).find((i) => i.id === wanted) ?? null;
    } catch {
      return null;
    }
  }, id);

/** The pool must never carry the projection: one record, still enabled. */
async function poolIsUntouched() {
  const pool = await readPool();
  return Array.isArray(pool) && pool.length === 1 && pool[0].enabled === true;
}

// ── A. the instance that keeps the mod ──────────────────────────────────────
step("leg A — /play?instance=keep: the mod runs");
out.aFrameMounted = await open("keep");
out.aModLoads = await waitForSidebar(
  () => /mods:\s*✓ .*smoke-overlay-mod/.test(document.body.innerText),
);
out.aEntrypointRan = await page
  .waitForFunction(() => window.__smokeOverlayRuns === 1, undefined, { timeout: 15000 })
  .then(() => true)
  .catch(() => false);
// The control offered must match the state: an instance running a mod can only
// be asked to stop running it.
out.aOffersSkip = (await countButton("skip in this instance")) === 1;
out.aHidesUse = (await countButton("use in this instance")) === 0;

// ── B. the instance that skips it ───────────────────────────────────────────
step("leg B — /play?instance=skip: the same mod does not");
out.bFrameMounted = await open("skip");
// A pool of one, entirely overlaid off, settles at the same honest "none" an
// empty pool does — the loader was handed nothing and says so.
out.bModSkipped = await waitForSidebar(() => /mods:\s*none/.test(document.body.innerText));
out.bEntrypointDidNotRun = await page.evaluate(() => window.__smokeOverlayRuns === undefined);
const bText = await sidebarText();
// Hidden from the instance, NOT removed from the library.
out.bRowStillListed = bText.includes(MOD_ID);
out.bPillSaysOffHere = /off here/i.test(bText);
out.bOffersUse = (await countButton("use in this instance")) === 1;
out.bPoolUntouched = await poolIsUntouched();
const bInstance = await readInstance("skip");
out.bOverlayIntact = !!bInstance && bInstance.disabledModIds.includes(MOD_ID);
// The launch was recorded, which is also what proves the effect ran at all.
out.bLaunchStamped = !!bInstance && typeof bInstance.lastPlayedAt === "string";

// ── C. flip it back on, live ────────────────────────────────────────────────
step("leg C — 'use in this instance' brings it back without a reload");
await page
  .click('aside[aria-label="Mods"] button:has-text("use in this instance")', { timeout: 10000 })
  .catch(() => {});
out.cModLoadsAfterToggle = await waitForSidebar(
  () => /mods:\s*✓ .*smoke-overlay-mod/.test(document.body.innerText),
  60000,
);
out.cEntrypointRan = await page.evaluate(() => window.__smokeOverlayRuns >= 1);
const cInstance = await readInstance("skip");
out.cOverlayCleared = !!cInstance && cInstance.disabledModIds.length === 0;
out.cPoolStillUntouched = await poolIsUntouched();

// ── D. skip it again, live — the leg that can catch a projected write ───────
// The only click in this smoke that makes the projection DIFFER from the pool.
// If the handler ever persisted what it runs, this is where enabled:false would
// land in the shared library and quietly disable the mod for every instance.
step("leg D — 'skip in this instance' unloads it live, pool still enabled");
await page
  .click('aside[aria-label="Mods"] button:has-text("skip in this instance")', { timeout: 10000 })
  .catch(() => {});
out.dModUnloadsLive = await waitForSidebar(() => /mods:\s*none/.test(document.body.innerText), 60000);
const dInstance = await readInstance("skip");
out.dOverlayWritten = !!dInstance && dInstance.disabledModIds.includes(MOD_ID);
out.dPoolStillEnabled = await poolIsUntouched();
// Belt and braces: the row must still be there, still switchable back on. A
// pool write would have flipped it to the library-disabled rendering, which
// offers no per-instance control at all.
out.dStillOffersUse = (await countButton("use in this instance")) === 1;

await page.screenshot({ path: SHOT, fullPage: false }).catch(() => {});

const PASS = Object.values(out).every((v) => v === true) && pageErrors.length === 0;

console.log(
  JSON.stringify(
    {
      PASS,
      verdict: {
        instanceRunsItsMods: (out.aModLoads && out.aEntrypointRan) ?? false,
        overlaySkipsTheMod: (out.bModSkipped && out.bEntrypointDidNotRun) ?? false,
        skippedModStillInLibrary: (out.bRowStillListed && out.bPillSaysOffHere) ?? false,
        // The one that would lose data silently if it broke. `d` is the leg
        // that actually has teeth here — see the header on why b and c do not.
        sharedPoolNeverProjected:
          (out.bPoolUntouched && out.cPoolStillUntouched && out.dPoolStillEnabled) ?? false,
        launchRecorded: out.bLaunchStamped ?? false,
        toggleTakesEffectLive:
          (out.cModLoadsAfterToggle &&
            out.cOverlayCleared &&
            out.dModUnloadsLive &&
            out.dOverlayWritten) ??
          false,
      },
      detail: out,
      pageErrors: pageErrors.slice(0, 6),
      shot: SHOT,
    },
    null,
    2,
  ),
);

await browser.close();
process.exit(PASS ? 0 : 1);

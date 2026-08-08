// Headless proof for RUNTIME USER MODS in the portal: paste a mod through the
// actual "+ Add a mod" form and verify it loads through the same loader path as
// the bundled mods — in a real browser, where the Blob-URL `import()` the unit
// tests must fake (node cannot feed a Blob URL to `import()`) runs for real.
//
//   TSPML_TRANSFORM=1 pnpm --filter @tspml/portal dev    # in one terminal (:3000)
//   pnpm --filter @tspml/portal smoke:usermods           # in another
//
// PASS requires, in order:
//   1. add    — the pasted mod's entrypoint RAN (it stamps a main-frame global),
//               its id shows "loaded" in the sidebar, and the mods row lists it;
//   2. mixins — its declared mixin is surfaced as SKIPPED in the sidebar warning
//               (the honest-unapplied contract, #62), not silently ignored;
//   3. persist— a full page reload loads the mod again from localStorage;
//   4. disable— toggling it off unloads it (its disposer runs) and drops it from
//               the loaded list while the bundled demo mods stay loaded;
//   5. remove — removing it clears the stored record.
//
// The transform does NOT need to have applied for this smoke (the user-mod path
// is bridge-side, not bundle-side), but the standard dev-server setup is used so
// it composes with the other smokes.
import { chromium } from "playwright";

const BASE_URL = process.env.SMOKE_URL ?? "http://localhost:3000";
const SHOT = process.env.SMOKE_SHOT ?? "/tmp/tspml-user-mods-smoke.png";
const MOD_ID = "smoke-user-mod";

const step = (msg) => process.stderr.write(`smoke:usermods · ${msg}\n`);

// What a modder would paste: a mod.json and BUILT entrypoint JS. The entrypoint
// stamps main-frame globals so the assertions are about observable effects, not
// UI copy: ran-count on load, a flag from its disposer on unload. It declares a
// mixin precisely so the smoke can assert the mixin is REPORTED skipped.
const MANIFEST = JSON.stringify({
  schemaVersion: 1,
  id: MOD_ID,
  name: "Smoke user mod",
  version: "1.0.0",
  entrypoint: "entrypoint.js",
  targets: [">=0.6.0 <0.7.0"],
  mixins: [{ config: "mixins.json" }],
});
const CODE = `export default (api) => {
  window.__smokeUserModRuns = (window.__smokeUserModRuns || 0) + 1;
  api.logger.log("[${MOD_ID}] loaded");
  return () => { window.__smokeUserModDisposed = true; };
};`;

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
page.on("console", (m) => consoleMsgs.push(`${m.type()}: ${m.text().slice(0, 200)}`));
page.on("pageerror", (e) => pageErrors.push(String(e && e.message ? e.message : e).slice(0, 300)));

/** The sidebar's full text (main frame — the game frame is irrelevant here). */
const sidebarText = () =>
  page.evaluate(() => {
    const aside = /** @type {HTMLElement | null} */ (
      document.querySelector('aside[aria-label="Mods"]')
    );
    return aside?.innerText ?? "";
  });

/** Wait until the sidebar's mods row matches (or timeout → false). */
async function waitForSidebar(predicateSource, timeout = 60000) {
  return page
    .waitForFunction(predicateSource, undefined, { timeout, polling: 500 })
    .then(() => true)
    .catch(() => false);
}

step(`goto ${BASE_URL}`);
await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });

// SW-control dance (issue #9): on a cold profile the first load may not mount
// the game iframe; one reload fixes it.
let frameEl = await page
  .waitForSelector('iframe[title="PolyTrack (proxied)"]', { timeout: 30000 })
  .catch(() => null);
if (!frameEl) {
  step("  no iframe — reloading for SW control");
  await page.reload({ waitUntil: "domcontentloaded" });
  frameEl = await page
    .waitForSelector('iframe[title="PolyTrack (proxied)"]', { timeout: 45000 })
    .catch(() => null);
}

const out = { frameMounted: !!frameEl };

// The initial (bundled-only) load must finish before the form is exercised —
// otherwise "the user mod loaded" could be conflated with first load.
step("wait for the bundled mods to load");
out.bundledLoaded = await waitForSidebar(
  () => /mods:\s*✓ .*tspml-example-hud/.test(document.body.innerText),
  90000,
);

// 1. Add the mod through the real form.
step("open the Add form and paste the mod");
await page.click('aside[aria-label="Mods"] summary');
const areas = page.locator('aside[aria-label="Mods"] textarea');
await areas.nth(0).fill(MANIFEST);
await areas.nth(1).fill(CODE);
await page.click('aside[aria-label="Mods"] button:has-text("Add mod")');

step("wait for the user mod to load");
out.addedLoaded = await waitForSidebar(
  () => /mods:\s*✓ .*smoke-user-mod/.test(document.body.innerText),
  30000,
);
out.entrypointRuns = await page
  .waitForFunction(() => window.__smokeUserModRuns === 1, undefined, { timeout: 15000 })
  .then(() => true)
  .catch(() => false);
const afterAdd = await sidebarText();
out.sidebarListsMod = afterAdd.includes(MOD_ID);
out.modsRowListsMod = new RegExp(`mods:\\s*✓ .*${MOD_ID}`).test(afterAdd);

// 2. The declared mixin must be surfaced as skipped, by id.
out.mixinSkippedSurfaced = new RegExp(`${MOD_ID}.*not applied`, "s").test(afterAdd);

await page.screenshot({ path: SHOT });

// 3. Persistence: a fresh page context must load the mod from localStorage.
step("reload — the mod must come back from storage");
await page.reload({ waitUntil: "domcontentloaded" });
out.persistedLoaded = await waitForSidebar(
  () => /mods:\s*✓ /.test(document.body.innerText) && window.__smokeUserModRuns === 1,
  90000,
);
out.persistedListed = (await sidebarText()).includes(MOD_ID);

// 4. Disable: the mod unloads (disposer runs) and leaves the loaded list; the
// bundled demo mods survive the reload cycle.
step("disable the mod");
await page.click(`aside[aria-label="Mods"] li:has(code:text-is("${MOD_ID}")) button:has-text("disable")`);
out.disabledUnloaded = await page
  .waitForFunction(() => window.__smokeUserModDisposed === true, undefined, { timeout: 20000 })
  .then(() => true)
  .catch(() => false);
out.disabledDropped = await waitForSidebar(
  () => /mods:\s*✓ /.test(document.body.innerText) && !/mods:.*smoke-user-mod/.test(document.body.innerText),
  20000,
);
out.bundledSurvive = /mods:\s*✓ .*tspml-example-hud/.test(await sidebarText());

// 5. Remove: the stored record is gone.
step("remove the mod");
await page.click(`aside[aria-label="Mods"] li:has(code:text-is("${MOD_ID}")) button:has-text("remove")`);
await page.waitForTimeout(1000);
out.storageCleared = await page.evaluate(() => {
  try {
    const raw = window.localStorage.getItem("tspml.userMods.v1");
    return !raw || !raw.includes("smoke-user-mod");
  } catch {
    return false;
  }
});
out.rowGone = !(await sidebarText()).includes(MOD_ID);

const PASS =
  out.frameMounted === true &&
  out.bundledLoaded === true &&
  out.addedLoaded === true &&
  out.entrypointRuns === true &&
  out.sidebarListsMod === true &&
  out.modsRowListsMod === true &&
  out.mixinSkippedSurfaced === true &&
  out.persistedLoaded === true &&
  out.persistedListed === true &&
  out.disabledUnloaded === true &&
  out.disabledDropped === true &&
  out.bundledSurvive === true &&
  out.storageCleared === true &&
  out.rowGone === true;

console.log(
  JSON.stringify(
    {
      PASS,
      verdict: out,
      modLogs: consoleMsgs.filter((m) => m.includes(MOD_ID)).slice(0, 6),
      pageErrors: pageErrors.slice(0, 5),
      shot: SHOT,
    },
    null,
    2,
  ),
);

await browser.close();
process.exit(PASS ? 0 : 1);

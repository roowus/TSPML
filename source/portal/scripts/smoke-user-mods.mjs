// Headless proof for RUNTIME USER MODS in the portal: paste a mod through the
// actual "+ Add a mod" form and verify it loads through the loader — in a real
// browser, where the Blob-URL `import()` the unit tests must fake (node cannot
// feed a Blob URL to `import()`) runs for real. User mods are the ONLY way mods
// enter the portal (the bundled demo mods were removed), so this smoke covers
// the whole mod pipeline from a cold, empty store.
// Since #62 this is ALSO the end-to-end proof for user-mod MIXINS: pasted
// mixins.json → Cache API plan → SW POST replay → one-pass compose on the
// server → report prelude inside the bundle → per-mod rows in the sidebar →
// the inject actually firing in the GAME frame.
//
//   TSPML_TRANSFORM=1 pnpm --filter @tspml/portal dev    # in one terminal (:3000)
//   pnpm --filter @tspml/portal smoke:usermods           # in another
//
// TSPML_TRANSFORM=1 is REQUIRED (unlike pre-#62): the mixin legs assert on the
// transformed bundle. PASS requires, in order:
//   1. add     — the pasted mod's entrypoint RAN (it stamps a main-frame
//                global), its id shows "loaded" in the sidebar, and the mods
//                row lists it;
//   2. skip    — added WITHOUT its mixins.json, the declared mixin is surfaced
//                as skipped ("manifest declares mixins… not applied"), not
//                silently ignored;
//   3. re-add  — pasting the mod AGAIN with mixins.json (the modder iterate
//                loop, upsert) clears the skip warning and raises the restart
//                banner (the running frame keeps its bundle);
//   4. restart — clicking the banner's "reload now" reloads; the mod comes
//                back from localStorage (persistence) AND its mixin is applied:
//                the game frame carries the injected global and the sidebar's
//                "Your mixins" row reads 1/1 applied;
//   5. negative— a second mod with a bogus {symbol} mixin reports 0/1 applied
//                with symbol-unresolved, per-mod isolated: the first mod stays
//                1/1 and the base transform's LIVE badge survives;
//   6. disable — toggling the first mod off unloads it (disposer runs), drops
//                it from the loaded list (the other mod stays), and raises the
//                restart banner again (its patch set left the plan);
//   7. remove  — removing both mods clears the stored records;
//   8. URL     — (#80 first slice) the Add form's "Import from a URL" method
//                imports the portal's own /sample-mod/mod.json (same-origin,
//                no CORS to negotiate; the manifest's entrypoint is fetched
//                relative to it), the mod loads through the same pipeline,
//                and removing it clears its record;
//   9. pack    — (#80 second slice) a PASTED three-line modpack whose middle
//                line 404s: lines 1 and 3 install, the pack's own notice says
//                one failed, and nothing aborts — fail per mod, not per pack;
//  10. packURL — the same two mods again, this time from a LINKED list
//                (/sample-pack.txt, whose lines are relative to itself), which
//                pins the fetch-the-list path and base-relative resolution.
//                Leg 9 removes its mods first, so leg 10's "loaded" is earned
//                rather than left over.
import { chromium } from "playwright";

const BASE_URL = process.env.SMOKE_URL ?? "http://localhost:3000";
const SHOT = process.env.SMOKE_SHOT ?? "/tmp/tspml-user-mods-smoke.png";
const MOD_ID = "smoke-user-mod";
const BOGUS_ID = "smoke-bogus-mod";
// The portal serves this itself (public/sample-mod/) so the URL-import leg has
// a known-good same-origin target — id from that mod.json.
const URL_MOD_ID = "tspml-sample-url-mod";
// The second sample mod (public/sample-mod-b/) — the pack legs need TWO mods,
// or "the whole pack installed" and "one line installed" look the same.
const PACK_MOD_ID = "tspml-sample-pack-mod";

const step = (msg) => process.stderr.write(`smoke:usermods · ${msg}\n`);

// What a modder would paste: a mod.json, BUILT entrypoint JS, and a mixins.json.
// The entrypoint stamps MAIN-frame globals (ran-count on load, a disposer flag
// on unload); the mixin stamps a GAME-frame global — the same split the real
// feature has (entrypoints run bridge-side, mixins run inside the bundle).
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
// An `after` inject on the mapped Car symbol — the proven M5-C shape.
const MIXINS = JSON.stringify({
  patches: [
    {
      op: "after",
      symbol: "Car",
      inject: "(function(){ try { window.__smokeUserMixin = true; } catch (e) {} })();",
    },
  ],
});
const BOGUS_MANIFEST = JSON.stringify({
  schemaVersion: 1,
  id: BOGUS_ID,
  name: "Smoke bogus-mixin mod",
  version: "1.0.0",
  entrypoint: "entrypoint.js",
  targets: [">=0.6.0 <0.7.0"],
  mixins: [{ config: "mixins.json" }],
});
const BOGUS_CODE = "export default () => {};";
const BOGUS_MIXINS = JSON.stringify({
  patches: [{ op: "after", symbol: "SmokeNoSuchSymbol", inject: "void 0;" }],
});

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

/** The sidebar's full text (main frame). */
const sidebarText = () =>
  page.evaluate(() => {
    const aside = /** @type {HTMLElement | null} */ (
      document.querySelector('aside[aria-label="Mods"]')
    );
    return aside?.innerText ?? "";
  });

/** Wait until the main frame matches (or timeout → false). */
async function waitForSidebar(predicateSource, timeout = 60000) {
  return page
    .waitForFunction(predicateSource, undefined, { timeout, polling: 500 })
    .then(() => true)
    .catch(() => false);
}

/** Find the game iframe's frame object (it detaches on every page reload). */
async function waitForGameFrame(timeout = 45000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const f = page.frames().find((fr) => fr !== page.mainFrame() && fr.url().includes("/api/proxy"));
    if (f) return f;
    await page.waitForTimeout(300);
  }
  return null;
}

/**
 * Remove mods by id, tolerating a row that isn't there.
 *
 * The pack legs' cleanup must not be the thing that fails when a pack leg
 * fails: a missing row means the leg above it already went false, and the run
 * should print that verdict rather than die in the teardown with a 30s locator
 * timeout that names the wrong problem. The short timeout keeps a genuinely
 * stuck row from stretching the run.
 */
async function removeMods(ids) {
  for (const id of ids) {
    await page
      .click(`aside[aria-label="Mods"] li:has(code:text-is("${id}")) button:has-text("remove")`, {
        timeout: 5000,
      })
      .catch(() => {});
  }
}

/** Fill the Add form's three textareas and click Add mod. */
async function addMod(manifest, code, mixins) {
  const areas = page.locator('aside[aria-label="Mods"] textarea');
  await areas.nth(0).fill(manifest);
  await areas.nth(1).fill(code);
  await areas.nth(2).fill(mixins ?? "");
  await page.click('aside[aria-label="Mods"] button:has-text("Add mod")');
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

// The initial load must SETTLE before the form is exercised — otherwise "the
// user mod loaded" could be conflated with first load. There are no bundled
// mods, so a cold profile settles at "mods: none" (the loader ran over an
// empty store and honestly reported nothing).
step("wait for the initial (empty) load to settle at 'mods: none'");
out.initialLoadSettled = await waitForSidebar(
  () => /mods:\s*none/.test(document.body.innerText),
  90000,
);

// 1+2. Add the mod through the real form — WITHOUT its mixins.json first, so
// the declared-but-unpasted skip warning has its moment.
step("open the Add form and paste the mod (no mixins.json yet)");
await page.click('aside[aria-label="Mods"] summary');
await addMod(MANIFEST, CODE);

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

// The declared mixin must be surfaced as skipped, by id ("manifest declares
// mixins but no mixins.json was pasted — … not applied").
out.mixinSkippedSurfaced = await waitForSidebar(
  () => /smoke-user-mod[^]{0,80}manifest declares mixins/.test(document.body.innerText),
  15000,
);

// 3. Re-add WITH the mixins.json (upsert — the modder iterate loop). The skip
// warning must clear and the restart banner must appear (the plan changed but
// the running frame keeps the bundle it was served).
step("re-add the mod with its mixins.json");
await addMod(MANIFEST, CODE, MIXINS);
out.reAddClearsSkipped = await waitForSidebar(
  () => !/manifest declares mixins/.test(document.body.innerText),
  15000,
);
out.restartBannerShown = await waitForSidebar(
  () => /need a restart/.test(document.body.innerText),
  15000,
);

// 4. Click the banner's real "reload now" button. After the reload the mod
// must come back from localStorage AND its mixin must be applied.
step("click 'reload now' and wait for the new page");
const nav = page.waitForEvent("domcontentloaded", { timeout: 30000 }).catch(() => null);
await page.click('aside[aria-label="Mods"] button:has-text("reload now")');
await nav;

out.persistedLoaded = await waitForSidebar(
  () => /mods:\s*✓ /.test(document.body.innerText) && window.__smokeUserModRuns === 1,
  90000,
);
out.persistedListed = (await sidebarText()).includes(MOD_ID);

step("wait for the mixin to fire in the GAME frame");
let gameFrame = await waitForGameFrame();
out.mixinAppliedInGame = gameFrame
  ? await gameFrame
      .waitForFunction(() => window.__smokeUserMixin === true, undefined, { timeout: 90000 })
      .then(() => true)
      .catch(() => false)
  : false;
// The report prelude rode inside the served bundle and the sidebar read it
// cross-frame: the per-mod row must say 1/1 applied.
// Case-insensitive: the row's status span renders with text-transform:
// uppercase, and innerText reflects RENDERED casing ("1/1 APPLIED").
out.mixinReportRow = await waitForSidebar(
  () => /Your mixins[^]*smoke-user-mod[^]{0,80}1\/1 applied/i.test(document.body.innerText),
  30000,
);

// 5. Negative leg: a mod whose mixin names a symbol the pinned map does not
// have. Per-mod isolation is the contract — its row fails, the first mod's
// row and the base transform survive.
step("add the bogus-symbol mod and reload");
// The reload collapsed the Add form's <details>; re-open it or fill() times
// out on the hidden textareas.
await page.click('aside[aria-label="Mods"] summary');
await addMod(BOGUS_MANIFEST, BOGUS_CODE, BOGUS_MIXINS);
out.bogusRestartBanner = await waitForSidebar(
  () => /need a restart/.test(document.body.innerText),
  15000,
);
await page.reload({ waitUntil: "domcontentloaded" });

out.bogusReportRow = await waitForSidebar(
  () =>
    /smoke-bogus-mod[^]{0,80}0\/1 applied/i.test(document.body.innerText) &&
    /symbol-unresolved/.test(document.body.innerText),
  90000,
);
out.goodRowSurvives = await waitForSidebar(
  () => /smoke-user-mod[^]{0,80}1\/1 applied/i.test(document.body.innerText),
  30000,
);
gameFrame = await waitForGameFrame();
out.goodMixinStillApplied = gameFrame
  ? await gameFrame
      .waitForFunction(() => window.__smokeUserMixin === true, undefined, { timeout: 90000 })
      .then(() => true)
      .catch(() => false)
  : false;
// The base transform's own inject survives a user-mixin failure (all-or-nothing
// applies to the base only; user failures are per-mod).
out.liveBadgeSurvives = gameFrame
  ? await gameFrame
      .waitForFunction(() => !!document.getElementById("tspml-live-marker"), undefined, {
        timeout: 30000,
      })
      .then(() => true)
      .catch(() => false)
  : false;

await page.screenshot({ path: SHOT });

// 6. Disable: the mod unloads (disposer runs), leaves the loaded list, the
// OTHER user mod (the bogus-mixin one — its entrypoint is fine, only its mixin
// fails) survives the reload of the set — and the restart banner returns,
// because its patch set left the plan while the frame keeps the patched bundle.
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
out.otherModSurvives = new RegExp(`mods:\\s*✓ .*${BOGUS_ID}`).test(await sidebarText());
out.disableRestartBanner = await waitForSidebar(
  () => /need a restart/.test(document.body.innerText),
  15000,
);

// 7. Remove both mods: the stored records are gone.
step("remove both mods");
await page.click(`aside[aria-label="Mods"] li:has(code:text-is("${MOD_ID}")) button:has-text("remove")`);
await page.click(`aside[aria-label="Mods"] li:has(code:text-is("${BOGUS_ID}")) button:has-text("remove")`);
await page.waitForTimeout(1000);
out.storageCleared = await page.evaluate(() => {
  try {
    const raw = window.localStorage.getItem("tspml.userMods.v1");
    return !raw || (!raw.includes("smoke-user-mod") && !raw.includes("smoke-bogus-mod"));
  } catch {
    return false;
  }
});
// NOT a whole-sidebar text check: the "Your mixins" report honestly keeps its
// row for the still-served bundle. Only the "Your mods" rows have buttons.
out.rowGone = await page.evaluate((ids) => {
  const codes = Array.from(document.querySelectorAll('aside[aria-label="Mods"] li code'));
  return !codes.some(
    (c) => ids.includes(c.textContent ?? "") && c.closest("li")?.querySelector("button"),
  );
}, [MOD_ID, BOGUS_ID]);

// 8. URL import (#80 first slice): switch the Add form's method dropdown to
// "Import from a URL" and import the portal's own sample mod. Same-origin, so
// the browser's direct fetch (never /api/proxy) needs no CORS cooperation —
// this pins the dispatch (manifest URL → entrypoint fetched relative to it)
// and the form wiring without leaving localhost. The paste textareas stay in
// the DOM (.add-hidden collapses them visually), so switching back to paste
// afterwards is hygiene, not a rescue.
step("import the sample mod from a URL");
// Leg 5's reload collapsed the Add form's <details>; the Add form summary is
// the FIRST summary in the aside (the Log section's comes later).
await page.click('aside[aria-label="Mods"] summary');
await page.selectOption('aside[aria-label="Mods"] select.add-select', "url");
await page.fill('aside[aria-label="Mods"] input.add-input', `${BASE_URL}/sample-mod/mod.json`);
await page.click('aside[aria-label="Mods"] button:has-text("Import mod")');
out.urlModLoaded = await waitForSidebar(
  () => /mods:\s*✓ .*tspml-sample-url-mod/.test(document.body.innerText),
  30000,
);
out.urlModListed = (await sidebarText()).includes(URL_MOD_ID);

step("remove the URL-imported mod");
await page.click(
  `aside[aria-label="Mods"] li:has(code:text-is("${URL_MOD_ID}")) button:has-text("remove")`,
);
await page.waitForTimeout(1000);
out.urlModCleared = await page.evaluate((id) => {
  try {
    const raw = window.localStorage.getItem("tspml.userMods.v1");
    return !raw || !raw.includes(id);
  } catch {
    return false;
  }
}, URL_MOD_ID);

// 9. Modpack, PASTED, with a broken line in the middle (#80's stated
// acceptance criterion). The list is three lines and line 2 is a 404 on this
// same origin: a well-formed https URL, so it passes the host rules and fails
// at the fetch — exactly where a real dead link fails. Lines 1 and 3 must
// still install and the pack's notice must say one failed. Asserting only
// "two mods loaded" would pass just as well if the pack aborted after a
// silent success, so the notice is checked too.
step("import a pasted modpack whose middle line 404s");
await page.selectOption('aside[aria-label="Mods"] select.add-select', "pack");
await page.fill(
  'aside[aria-label="Mods"] textarea.pack-input',
  [
    "# smoke pack",
    `${BASE_URL}/sample-mod/mod.json`,
    `${BASE_URL}/sample-mod-missing/mod.json`,
    `${BASE_URL}/sample-mod-b/mod.json`,
  ].join("\n"),
);
await page.click('aside[aria-label="Mods"] button:has-text("Import modpack")');
out.packGoodLinesLoaded = await waitForSidebar(
  () =>
    /mods:\s*✓ .*tspml-sample-url-mod/.test(document.body.innerText) &&
    /mods:\s*✓ .*tspml-sample-pack-mod/.test(document.body.innerText),
  30000,
);
// The failure is REPORTED, not swallowed: the pack box's own notice counts it.
out.packFailureReported = await page
  .locator('aside[aria-label="Mods"] .pack-box')
  .innerText()
  .then((t) => /installed 2 of 3/.test(t) && /1 failed to import/.test(t))
  .catch(() => false);

step("remove both modpack mods");
await removeMods([URL_MOD_ID, PACK_MOD_ID]);
await page.waitForTimeout(1000);
out.packCleared = await page.evaluate((ids) => {
  try {
    const raw = window.localStorage.getItem("tspml.userMods.v1");
    return !raw || ids.every((id) => !raw.includes(id));
  } catch {
    return false;
  }
}, [URL_MOD_ID, PACK_MOD_ID]);

// 10. Modpack, LINKED: one .txt URL in the box is a link TO a list, not the
// list itself. /sample-pack.txt is the portal's own sample pack and its two
// lines are RELATIVE, so this also pins base-relative resolution — the lines
// only reach a mod if they resolved against the list's URL.
step("import the sample modpack from a .txt link");
await page.fill('aside[aria-label="Mods"] textarea.pack-input', `${BASE_URL}/sample-pack.txt`);
await page.click('aside[aria-label="Mods"] button:has-text("Import modpack")');
out.packFromLinkLoaded = await waitForSidebar(
  () =>
    /mods:\s*✓ .*tspml-sample-url-mod/.test(document.body.innerText) &&
    /mods:\s*✓ .*tspml-sample-pack-mod/.test(document.body.innerText),
  30000,
);
out.packFromLinkListed = await sidebarText().then(
  (t) => t.includes(URL_MOD_ID) && t.includes(PACK_MOD_ID),
);

step("remove the linked modpack's mods");
await removeMods([URL_MOD_ID, PACK_MOD_ID]);
await page.waitForTimeout(1000);
out.packFromLinkCleared = await page.evaluate((ids) => {
  try {
    const raw = window.localStorage.getItem("tspml.userMods.v1");
    return !raw || ids.every((id) => !raw.includes(id));
  } catch {
    return false;
  }
}, [URL_MOD_ID, PACK_MOD_ID]);
await page.selectOption('aside[aria-label="Mods"] select.add-select', "paste");

const PASS =
  out.frameMounted === true &&
  out.initialLoadSettled === true &&
  out.addedLoaded === true &&
  out.entrypointRuns === true &&
  out.sidebarListsMod === true &&
  out.modsRowListsMod === true &&
  out.mixinSkippedSurfaced === true &&
  out.reAddClearsSkipped === true &&
  out.restartBannerShown === true &&
  out.persistedLoaded === true &&
  out.persistedListed === true &&
  out.mixinAppliedInGame === true &&
  out.mixinReportRow === true &&
  out.bogusRestartBanner === true &&
  out.bogusReportRow === true &&
  out.goodRowSurvives === true &&
  out.goodMixinStillApplied === true &&
  out.liveBadgeSurvives === true &&
  out.disabledUnloaded === true &&
  out.disabledDropped === true &&
  out.otherModSurvives === true &&
  out.disableRestartBanner === true &&
  out.storageCleared === true &&
  out.rowGone === true &&
  out.urlModLoaded === true &&
  out.urlModListed === true &&
  out.urlModCleared === true &&
  out.packGoodLinesLoaded === true &&
  out.packFailureReported === true &&
  out.packCleared === true &&
  out.packFromLinkLoaded === true &&
  out.packFromLinkListed === true &&
  out.packFromLinkCleared === true;

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

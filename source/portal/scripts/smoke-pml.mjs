// Headless proof for PML COMPATIBILITY: a mod written for PolyModLoader, in
// PML's own CDN layout, imported through the portal's ordinary "Import from a
// URL" form and RUN — in a real browser, where the blob-URL `import()` and the
// import rewrite that makes it possible (lib/pml/wrap.ts) happen for real.
//
//   TSPML_TRANSFORM=1 pnpm --filter @tspml/portal dev    # in one terminal (:3000)
//   pnpm --filter @tspml/portal smoke:pml                # in another
//
// The fixture is `public/sample-pml-mod/`, served by the portal itself, so the
// import is same-origin with no CORS to negotiate. It is a real three-file PML
// tree, not a single file, because the WALK is half of what this proves:
//
//   /sample-pml-mod/manifest.json        {"latest": {"0.6.2": "1.0.0"}}   INDEX
//   /sample-pml-mod/1.0.0/version.json   {"polymod": {…, "main": "main"}} VERSION
//   /sample-pml-mod/1.0.0/main.mod.js                                     code
//
// The import is pointed at the INDEX. Nothing tells the form it is PML: the
// dispatcher sniffs the `latest` map (lib/mod-formats/index.ts), so a passing
// run also proves a PML mod needs no format selector.
//
// PASS requires, in order:
//   1. walk     — the index resolved to the version manifest and the version
//                 manifest to the code; the mod appears in the sidebar under
//                 its SLUGIFIED id (the fixture declares "TSPML.sample.pml",
//                 which is not a legal TSPML id — slugifyPmlId folds it);
//   2. rewrite  — the mod's `import { PolyMod, MixinType } from
//                 "./PolyModLoader.js"` resolved. A relative specifier against
//                 a blob: URL names nothing, so if the rewrite regressed the
//                 module never evaluates and every assertion below is false;
//   3. hooks    — all four PML lifecycle hooks ran, in PML's order:
//                 preInit → init → postInit → onGameLoad. The last two both map
//                 onto TSPML's `ready`, and their relative order is a documented
//                 promise (docs/concepts/pml-compatibility.md);
//   4. identity — the loader wrote modID/modName/modVersion onto the instance
//                 BEFORE the first hook, as PML's own loader does, so a mod
//                 reading `this.getID()` in `init` gets the PML id (NOT our
//                 slug) rather than undefined;
//   5. keybind  — `pml.registerKeybind` produced a REAL binding: a keydown
//                 dispatched in the GAME frame (where Keybinds attaches) runs
//                 the mod's callback. The fixture's key is a KeyboardEvent
//                 `code`, which is what Keybinds.dispatch compares;
//   6. setting  — `getSetting` returns the STRING "true" for a bool, PML's own
//                 wart, reproduced deliberately because mods compare against it;
//   7. refusal  — the mod's `registerClassMixin` is refused BY NAME in the
//                 sidebar's .pml-report block, naming the target it aimed at;
//   8. survives — and the mod is STILL LOADED while that refusal is on screen.
//                 This is the load-bearing pair: lib/mod-loader.ts only emits a
//                 report for a mod in `loaded`, and the code after the refused
//                 call still ran. "Refuse per call, don't abort the mod" is the
//                 entire compatibility contract, and 7+8 together are its proof;
//   9. cleanup  — removing the mod clears its stored record.
import { chromium } from "playwright";

const BASE_URL = process.env.SMOKE_URL ?? "http://localhost:3000";
const PLAY_URL = `${BASE_URL}/play`;
const SHOT = process.env.SMOKE_SHOT ?? "/tmp/tspml-pml-smoke.png";

// The URL the form is pointed at: the mod ROOT's index manifest, one hop from
// the version manifest that actually describes the mod.
const INDEX_URL = `${BASE_URL}/sample-pml-mod/manifest.json`;
// The PML id the fixture declares, and the TSPML id it slugifies to. They
// differ ON PURPOSE — a PML id is not a legal TSPML id, and the fold plus the
// preserved original are both part of the contract.
const PML_ID = "TSPML.sample.pml";
const MOD_ID = "tspml-sample-pml";

const step = (msg) => process.stderr.write(`smoke:pml · ${msg}\n`);

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
page.on("console", (m) => consoleMsgs.push(`${m.type()}: ${m.text().slice(0, 250)}`));
page.on("pageerror", (e) => pageErrors.push(String(e && e.message ? e.message : e).slice(0, 300)));

/** The sidebar's full text (main frame). textContent, not innerText: the Mods
 *  menu is an overlay and a hidden element's innerText reads as "". */
const sidebarText = () =>
  page.evaluate(
    () =>
      /** @type {HTMLElement | null} */ (document.querySelector('aside[aria-label="Mods"]'))
        ?.textContent ?? "",
  );

/** Open the Mods menu overlay (closed by default; every click/fill needs it). */
async function openModsMenu() {
  const hidden = await page.evaluate(
    () =>
      /** @type {HTMLElement | null} */ (document.querySelector('aside[aria-label="Mods"]'))
        ?.hidden ?? false,
  );
  if (hidden) {
    await page.click(".mods-btn");
    await page.waitForSelector('aside[aria-label="Mods"]:not([hidden])', { timeout: 10000 });
  }
}

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
 * Open the Add-a-mod popover from closed, idempotently. The opener TOGGLES, so
 * "is it open" must be the popover's OWN state — a field-visibility proxy reads
 * "closed" once a non-paste method is selected and would toggle it shut.
 */
async function openAddDialog() {
  await openModsMenu();
  const isOpen = () =>
    page.evaluate(
      () => document.getElementById("add-mod-popover")?.matches(":popover-open") ?? false,
    );
  if (!(await isOpen())) {
    await page.click('aside[aria-label="Mods"] .add-opener');
    await page
      .waitForFunction(
        () => document.getElementById("add-mod-popover")?.matches(":popover-open") ?? false,
        undefined,
        { timeout: 10000, polling: 100 },
      )
      .catch(() => {});
  }
}

/** Switch the Add form's method by clicking its radio card, as a user does. */
async function pickAddMethod(value) {
  await openAddDialog();
  await page.click(
    `aside[aria-label="Mods"] .add-method:has(input[name="add-method"][value="${value}"])`,
  );
}

step(`goto ${PLAY_URL}`);
await page.goto(PLAY_URL, { waitUntil: "domcontentloaded", timeout: 60000 });

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

// The cold load must settle first, or "the PML mod loaded" could be conflated
// with the first load finishing. There are no bundled mods: empty is "none".
step("wait for the initial (empty) load to settle at 'mods: none'");
out.initialLoadSettled = await waitForSidebar(
  () => /mods:\s*none/.test(document.querySelector('aside[aria-label="Mods"]')?.textContent ?? ""),
  90000,
);

// 1+2. Import the mod ROOT's index manifest through the ordinary URL method.
// No format is stated: the dispatcher sniffs `latest` → pml.
step(`import the PML mod from ${INDEX_URL}`);
await pickAddMethod("url");
await page.fill('aside[aria-label="Mods"] input.add-input', INDEX_URL);
await page.click('aside[aria-label="Mods"] button:has-text("Import mod")');

step("wait for the PML mod to load (walk + import rewrite + hooks)");
out.pmlModLoaded = await waitForSidebar(
  () =>
    /mods:\s*✓ .*tspml-sample-pml/.test(
      document.querySelector('aside[aria-label="Mods"]')?.textContent ?? "",
    ),
  45000,
);
out.pmlModListed = (await sidebarText()).includes(MOD_ID);

// 3. All four hooks ran, in PML's documented order. `ready` runs postInit
// before onGameLoad — a promise this asserts rather than assumes.
step("check the lifecycle hooks ran in order");
out.hooksRan = await page
  .waitForFunction(
    () => (window.__smokePmlPhases || []).join(",") === "preInit,init,postInit,onGameLoad",
    undefined,
    { timeout: 30000, polling: 250 },
  )
  .then(() => true)
  .catch(() => false);
out.hookOrder = await page.evaluate(() => (window.__smokePmlPhases || []).join(","));

// 4. The instance carried its PML identity into `init` — written before the
// first hook, as PML's own loader does. modID is the PML id, NOT our slug.
out.identityAssigned = await page.evaluate(
  (id) => window.__smokePmlIdentity === `${id}/TSPML sample PML mod/1.0.0`,
  PML_ID,
);

// 5. The keybind is REAL. Keybinds attaches to the GAME frame's window, so the
// keydown has to be dispatched in there — a main-frame dispatch would silently
// never fire and this leg would fail for the wrong reason. The binding matches
// on KeyboardEvent.code.
step("fire the mod's keybind inside the GAME frame");
const gameFrame = await waitForGameFrame();
out.keybindFired = gameFrame
  ? await gameFrame
      .evaluate(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyJ" }));
      })
      .then(() =>
        page.waitForFunction(() => (window.__smokePmlKey || 0) >= 1, undefined, {
          timeout: 15000,
          polling: 200,
        }),
      )
      .then(() => true)
      .catch(() => false)
  : false;

// 6. PML's getSetting wart: a bool reads back as the STRING "true".
out.settingIsString = await page.evaluate(() => window.__smokePmlSetting === "true");

// 7+8. THE contract. The refused mixin is named in the .pml-report block, and
// the mod is still loaded while it is on screen — the code after the refused
// call ran, and mod-loader.ts only reports for a mod in `loaded`.
step("check the mixin was refused BY NAME and the mod kept running");
out.mixinRefusalReported = await waitForSidebar(
  () => {
    const report = document.querySelector('aside[aria-label="Mods"] .pml-report');
    const text = report?.textContent ?? "";
    return /registerClassMixin/.test(text) && /SmokeTarget\.prototype/.test(text);
  },
  30000,
);
out.refusalNamesReason = await page
  .evaluate(
    () =>
      /** @type {HTMLElement | null} */ (
        document.querySelector('aside[aria-label="Mods"] .pml-report')
      )?.textContent ?? "",
  )
  .then((t) => /string-splice/.test(t) && /mixins\.json/.test(t));
// Still loaded, with the refusal showing. Re-read rather than reuse the earlier
// value: "loaded THEN refused" is the claim, and a stale read would not prove it.
out.modSurvivedRefusal = /mods:\s*✓ .*tspml-sample-pml/.test(await sidebarText());
// And the mod's own code past the refused call ran — the refusal returned
// undefined instead of throwing.
out.codeAfterRefusalRan = await page.evaluate(() => window.__smokePmlSurvivedMixin === true);

await page.screenshot({ path: SHOT, fullPage: false }).catch(() => {});

// 9. Cleanup: removing the row clears the stored record.
step("remove the PML mod");
await openModsMenu();
await page
  .click(`aside[aria-label="Mods"] li:has(code:text-is("${MOD_ID}")) button:has-text("remove")`, {
    timeout: 10000,
  })
  .catch(() => {});
await page.waitForTimeout(1000);
out.storageCleared = await page.evaluate((id) => {
  try {
    const raw = window.localStorage.getItem("tspml.userMods.v1");
    return !raw || !raw.includes(id);
  } catch {
    return false;
  }
}, MOD_ID);

const PASS =
  out.frameMounted === true &&
  out.initialLoadSettled === true &&
  out.pmlModLoaded === true &&
  out.pmlModListed === true &&
  out.hooksRan === true &&
  out.identityAssigned === true &&
  out.keybindFired === true &&
  out.settingIsString === true &&
  out.mixinRefusalReported === true &&
  out.refusalNamesReason === true &&
  out.modSurvivedRefusal === true &&
  out.codeAfterRefusalRan === true &&
  out.storageCleared === true;

console.log(
  JSON.stringify(
    {
      PASS,
      verdict: out,
      modLogs: consoleMsgs.filter((m) => m.includes("pml")).slice(0, 8),
      pageErrors: pageErrors.slice(0, 5),
      shot: SHOT,
    },
    null,
    2,
  ),
);

await browser.close();
process.exit(PASS ? 0 : 1);

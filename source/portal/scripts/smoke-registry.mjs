// Headless proof for the REGISTRY + BROWSE surface (launcher phase 3): can a
// player who has never typed a URL find a mod, install it, and have it actually
// run in the game?
//
//   TSPML_TRANSFORM=1 pnpm --filter @tspml/portal dev    # in one terminal (:3000)
//   pnpm --filter @tspml/portal smoke:registry           # in another
//
// The load-bearing leg is the LAST one. Everything before it can pass while the
// install silently writes a record the play page ignores — a browse page that
// looks right and produces nothing is precisely the failure this exists to
// catch, so the smoke follows the mod all the way into a loaded game rather
// than stopping at "the button said installed".
//
// PASS requires, in order:
//   1. browse   — /browse lists the catalog: the seeded sample mod is on the
//                 Mods tab, by name, with its author;
//   2. search   — typing a term that matches nothing empties the list, and
//                 clearing it brings the entry back (proving the filter is
//                 filtering, not that the list happened to be short);
//   3. tabs     — the Modpacks tab shows the seeded pack and NOT the mods, so
//                 the two content types are actually separated;
//   4. detail   — /browse/<id> is a real, directly-navigable URL (opened cold,
//                 not clicked) showing the entry and its source URL;
//   5. confirm  — Install does NOT install on the first click: it reveals the
//                 unsandboxed-code disclosure and waits. Auto-installing from a
//                 deep link someone sent you is the thing this prevents;
//   6. install  — the second click installs, reports success, and writes a
//                 record into tspml.userMods.v1 (the SHARED pool — one library,
//                 not a per-instance copy);
//   7. loads    — /play, opened fresh, shows that mod under "Your mods" and
//                 reports it LOADED. This is the leg that proves the install
//                 path and the play path agree about storage.
import { chromium } from "playwright";

const BASE_URL = process.env.SMOKE_URL ?? "http://localhost:3000";
const BROWSE_URL = `${BASE_URL}/browse`;
const PLAY_URL = `${BASE_URL}/play`;
const SHOT = process.env.SMOKE_SHOT ?? "/tmp/tspml-registry-smoke.png";
// Seeded in public/registry/index.json, served by the portal itself, so this
// smoke needs no network beyond the dev server.
const ENTRY_ID = "tspml-sample-url-mod";
const ENTRY_NAME = "TSPML sample URL mod";
const PACK_NAME = "TSPML sample modpack";

const step = (msg) => process.stderr.write(`smoke:registry · ${msg}\n`);

const browser = await chromium.launch({
  headless: true,
  args: [
    "--use-gl=angle",
    "--use-angle=swiftshader-webgl",
    "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist",
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e && e.message ? e.message : e).slice(0, 300)));

/**
 * Wait for a page predicate, resolving false on timeout rather than throwing.
 *
 * The predicate is a real function rather than a source string so that
 * `tooling/typecheck` (which globs these .mjs files with `checkJs`) actually
 * checks it. `arg` is how values cross into the page — a template-interpolated
 * string would smuggle them past the compiler along with any typo in them.
 *
 * @param {(arg: string) => unknown} predicate
 * @param {string} arg
 * @param {number} [timeout]
 */
const waitFor = (predicate, arg, timeout = 20000) =>
  page
    .waitForFunction(predicate, arg, { timeout, polling: 200 })
    .then(() => true)
    .catch(() => false);

const bodyText = () => page.evaluate(() => document.body.innerText);

/** The mods sidebar's rendered text, or "" before it mounts. */
const sidebarText = () =>
  page.evaluate(() => {
    const aside = /** @type {HTMLElement | null} */ (
      document.querySelector('aside[aria-label="Mods"]')
    );
    // textContent: the Mods menu overlay is closed by default (`hidden` but
    // mounted), and innerText of a hidden element reads as "".
    return aside?.textContent ?? "";
  });

const out = {};

// ---- 1. Browse lists the catalog -------------------------------------------
step(`goto ${BROWSE_URL}`);
await page.goto(BROWSE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
out.entryListed = await waitFor((name) => document.body.innerText.includes(name), ENTRY_NAME, 30000);
// The catalog must be honest about what it is; the copy is part of the feature.
out.saysCurated = (await bodyText()).toLowerCase().includes("curated list");

// ---- 2. Search actually filters --------------------------------------------
step("search filters the list");
const search = page.locator('input[type="search"]');
await search.fill("zzzznotamod");
out.searchEmpties = await waitFor(
  (name) => !document.body.innerText.includes(name),
  ENTRY_NAME,
  10000,
);
await search.fill("");
out.searchRestores = await waitFor(
  (name) => document.body.innerText.includes(name),
  ENTRY_NAME,
  10000,
);

// ---- 3. Tabs separate mods from modpacks ------------------------------------
step("modpacks tab shows packs, not mods");
await page.locator('button[role="tab"]', { hasText: "Modpacks" }).click();
out.packTabShowsPack = await waitFor(
  (name) => document.body.innerText.includes(name),
  PACK_NAME,
  10000,
);
out.packTabHidesMods = !(await bodyText()).includes(ENTRY_NAME);

// ---- 4. The detail page is a real URL ---------------------------------------
// Navigated to COLD rather than clicked: a shareable deep link is the whole
// reason this is a route, so clicking through would test the wrong thing.
step(`goto ${BROWSE_URL}/${ENTRY_ID}`);
await page.goto(`${BROWSE_URL}/${ENTRY_ID}`, { waitUntil: "domcontentloaded", timeout: 60000 });
out.detailShowsEntry = await waitFor(
  (name) => document.body.innerText.includes(name),
  ENTRY_NAME,
  30000,
);
out.detailShowsSource = (await bodyText()).includes("/sample-mod/mod.json");

// ---- 5. The first Install click confirms, it does not install ---------------
step("first Install click discloses rather than installing");
const installBtn = page.locator("button", { hasText: "Install" }).first();
await installBtn.click();
out.disclosureShown = await waitFor(
  (word) => document.body.innerText.toLowerCase().includes(word),
  "unsandboxed",
  10000,
);
out.nothingStoredYet = await page.evaluate(
  () => window.localStorage.getItem("tspml.userMods.v1") === null,
);

// ---- 6. The second click installs into the shared pool ----------------------
step("confirm installs");
await page.locator("button", { hasText: "Install anyway" }).click();
out.installReported = await waitFor(
  (word) => document.body.innerText.toLowerCase().includes(word),
  "installed",
  30000,
);
out.storedId = await page.evaluate(() => {
  try {
    const raw = window.localStorage.getItem("tspml.userMods.v1");
    if (raw === null) return null;
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : parsed.mods;
    if (!Array.isArray(list) || list.length === 0) return null;
    return list[0]?.manifest?.id ?? null;
  } catch {
    return null;
  }
});
out.storedInSharedPool = out.storedId === ENTRY_ID;
await page.screenshot({ path: SHOT });

// ---- 7. The mod loads in the game -------------------------------------------
// Same browser context, so the install's localStorage is what /play reads. This
// is the leg that proves browse and play agree; everything above could pass
// with an install that writes somewhere the game never looks.
step(`goto ${PLAY_URL} — the installed mod must load`);
await page.goto(PLAY_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
// A cold profile may need one reload before the service worker controls the
// page; without control the portal does not mount the frame at all (issue #9).
const framed = await page
  .waitForSelector('iframe[title="PolyTrack (proxied)"]', { timeout: 30000 })
  .catch(() => null);
if (!framed) {
  step("  no iframe — reloading for SW control");
  await page.reload({ waitUntil: "domcontentloaded" });
}
out.listedUnderYourMods = await waitFor(
  (id) => {
    const aside = /** @type {HTMLElement | null} */ (
      document.querySelector('aside[aria-label="Mods"]')
    );
    return (aside?.textContent ?? "").includes(id);
  },
  ENTRY_ID,
  60000,
);
// The loader's own STATUS line, not the word "loaded" anywhere in the sidebar:
// the aside contains a literal "LOADED MODS" section header, so a /loaded/i
// test passes while the loader is still spinning (it did, on the first run of
// this file). `mods: ✓ <id>` is the same assertion smoke-user-mods leg 2 makes.
out.modLoaded = await waitFor(
  (id) => {
    const aside = /** @type {HTMLElement | null} */ (
      document.querySelector('aside[aria-label="Mods"]')
    );
    return new RegExp("mods:\\s*✓ .*" + id).test(aside?.textContent ?? "");
  },
  ENTRY_ID,
  90000,
);
out.sidebarTail = (await sidebarText()).slice(0, 400);

const PASS =
  out.entryListed === true &&
  out.saysCurated === true &&
  out.searchEmpties === true &&
  out.searchRestores === true &&
  out.packTabShowsPack === true &&
  out.packTabHidesMods === true &&
  out.detailShowsEntry === true &&
  out.detailShowsSource === true &&
  out.disclosureShown === true &&
  out.nothingStoredYet === true &&
  out.installReported === true &&
  out.storedInSharedPool === true &&
  out.listedUnderYourMods === true &&
  out.modLoaded === true;

console.log(
  JSON.stringify(
    {
      PASS,
      verdict: {
        catalogListed: out.entryListed ?? false,
        labelledAsCurated: out.saysCurated ?? false,
        searchFilters: (out.searchEmpties && out.searchRestores) ?? false,
        tabsSeparateKinds: (out.packTabShowsPack && out.packTabHidesMods) ?? false,
        detailIsARealUrl: out.detailShowsEntry ?? false,
        // The two that are about trust rather than plumbing.
        confirmBeforeInstall: (out.disclosureShown && out.nothingStoredYet) ?? false,
        installedIntoSharedPool: out.storedInSharedPool ?? false,
        // The one that proves the whole path.
        modLoadsInGame: out.modLoaded ?? false,
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

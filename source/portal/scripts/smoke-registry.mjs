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
//   1. browse   — /browse lists the catalog: poly-to-track (the native entry) is
//                 on the Mods tab, by name, with its author;
//   2. search   — typing a term that matches nothing empties the list, and
//                 clearing it brings the entry back (proving the filter is
//                 filtering, not that the list happened to be short);
//   2b. format  — the loader-format chips are real filters: selecting `pml`
//                 hides the native entry and keeps a PML one, and `tspml` does
//                 the reverse. The chip is derived from each entry's `format`,
//                 which is the field that decides which import walk runs, so a
//                 chip that rendered without filtering would be a control in
//                 appearance and decoration in behaviour;
//   2c. person  — the person chips (derived from the `author` byline, split on
//                 its separators) filter by WHO across collaborations: Orangy's
//                 chip narrows the grid to exactly their ten rows — six solo
//                 and four collaborations — and excludes a mod they had no
//                 hand in. A whole-byline chip would only ever match the trio;
//   3. tabs     — the Modpacks tab shows NO entries (the catalog has no packs
//                 right now) and NOT the mod, so the two content types are
//                 actually separated;
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
//
// The entry legs 4-7 install is poly-to-track, hosted on GitHub raw by its
// author — so they do hit the network (the same fetch a real player makes).
// That is deliberate: a same-origin fixture would prove the wiring but not the
// promise ("install from the catalog works"), and the fixture samples remain in
// public/ for smoke-user-mods' URL-import legs instead.
//
// It is also the catalog's only NATIVE entry; the rest are PML mods mirrored
// from PML's own registry, which is why leg 2b can assert that a format chip
// partitions the list rather than merely rendering.
import { chromium } from "playwright";

const BASE_URL = process.env.SMOKE_URL ?? "http://localhost:3000";
const BROWSE_URL = `${BASE_URL}/browse`;
const PLAY_URL = `${BASE_URL}/play`;
const SHOT = process.env.SMOKE_SHOT ?? "/tmp/tspml-registry-smoke.png";
// The real catalog entry (public/registry/index.json). Kept in sync with it:
// tests/registry.test.ts validates the file's shape, this file its behaviour.
const ENTRY_ID = "poly-to-track";
const ENTRY_NAME = "Poly To Track";
// A PML row, for the format-chip leg. Any one would do; this is the one PML's
// own registry lists first, and it is present for every 0.6.x game version.
const PML_ENTRY_NAME = "PML Core";

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

// ---- 2b. The loader-format chips partition the catalog ----------------------
// Exact-text locators, because `pml` is a substring of `tspml` and a hasText
// chip lookup would grab whichever came first and then assert against the wrong
// button. The two directions are both asserted: a chip that filtered one way
// and left the other alone would be a half-working control that looks whole.
step("format chips filter by loader");
const chip = (t) => page.locator(".tag-row button").filter({ hasText: new RegExp(`^${t}$`) });
await chip("pml").click();
out.pmlChipHidesNative = await waitFor(
  (names) => {
    const [native, pml] = names.split("|");
    const text = document.body.innerText;
    return !text.includes(native ?? "") && text.includes(pml ?? "");
  },
  `${ENTRY_NAME}|${PML_ENTRY_NAME}`,
  10000,
);
await chip("tspml").click();
out.tspmlChipHidesPml = await waitFor(
  (names) => {
    const [native, pml] = names.split("|");
    const text = document.body.innerText;
    return text.includes(native ?? "") && !text.includes(pml ?? "");
  },
  `${ENTRY_NAME}|${PML_ENTRY_NAME}`,
  10000,
);
// Back to an unfiltered list: every leg below reads the whole catalog, and a
// chip left pressed would make the modpack-tab assertion pass for the wrong
// reason (an empty panel because a mod filter is still on).
await page.locator(".tag-row button").filter({ hasText: /^All$/ }).click();
out.allChipRestores = await waitFor(
  (name) => document.body.innerText.includes(name),
  PML_ENTRY_NAME,
  10000,
);

// ---- 2c. A person chip filters by WHO, across collaborations -----------------
// Orangy is the densest byline in the data: solo rows plus four collaborations
// that also name other people. The chip must catch all ten (a whole-byline
// chip would only ever match the exact trio) and must NOT catch a row Orangy
// had nothing to do with.
step("person chip filters across collaborations");
await chip("Orangy").click();
await page.waitForTimeout(400);
// The TOTAL is what proves the filter ran: counting only cards that mention
// Orangy would return 10 before the chip did anything, because those same ten
// bylines are what the filter is derived from. Six solo rows plus four
// collaborations, every one of them still mentioning Orangy, and none of them
// a mod Orangy had nothing to do with.
const filtered = page.locator(".entry-card");
out.personChipNarrowsToTen = (await filtered.count()) === 10;
out.personChipKeepsCollaborations = (await filtered.filter({ hasText: "Orangy" }).count()) === 10;
out.personChipExcludesOthers = !(await filtered.filter({ hasText: "Poly Library" }).count());
await page.locator(".tag-row button").filter({ hasText: /^All$/ }).click();
out.personChipRestores = await waitFor(
  (name) => document.body.innerText.includes(name),
  "Poly Library",
  10000,
);

// ---- 3. Tabs separate mods from modpacks ------------------------------------
// The catalog currently holds no packs (the sample pack was removed from the
// listing — it is a smoke fixture, not player content), so the honest
// assertion is that the pack tab is EMPTY and shows no mods: the two content
// types are separated, and the empty state says so rather than faking content.
step("modpacks tab is empty and shows no mods");
await page.locator('button[role="tab"]', { hasText: "Modpacks" }).click();
await page.waitForTimeout(400);
const packPanel = await bodyText();
out.packTabHidesMods = !packPanel.includes(ENTRY_NAME);
out.packTabEmptyState = /no modpack|nothing here yet/i.test(packPanel);

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
out.detailShowsSource = (await bodyText()).includes("raw.githubusercontent.com/roowus/poly-to-track");

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
  out.pmlChipHidesNative === true &&
  out.tspmlChipHidesPml === true &&
  out.allChipRestores === true &&
  out.personChipNarrowsToTen === true &&
  out.personChipKeepsCollaborations === true &&
  out.personChipExcludesOthers === true &&
  out.personChipRestores === true &&
  out.packTabHidesMods === true &&
  out.packTabEmptyState === true &&
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
        // Both directions, or the chip is decoration. See leg 2b.
        formatChipsFilter:
          (out.pmlChipHidesNative && out.tspmlChipHidesPml && out.allChipRestores) ?? false,
        // Across collaborations, or the chip answers "who exactly" instead of
        // "who". See leg 2c.
        personChipsFilter:
          (out.personChipNarrowsToTen &&
            out.personChipKeepsCollaborations &&
            out.personChipExcludesOthers &&
            out.personChipRestores) ??
          false,
        // Reads what the run actually measured. This line used to name an
        // `out.packTabShowsPack` that nothing assigned, so it reported `false`
        // on every green run — the catalog has held no modpacks since the
        // sample pack was delisted, and the assertion above is that the pack
        // tab is EMPTY, not that it shows one.
        tabsSeparateKinds: (out.packTabHidesMods && out.packTabEmptyState) ?? false,
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

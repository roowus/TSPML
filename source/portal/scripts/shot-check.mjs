// Throwaway visual check: screenshots the launcher, the catalog, the boot
// overlay, the opened Add-a-mod form, and the sidebar. Not a smoke — no
// assertions. Not committed to CI.
//
// /browse is here because the smokes assert on rendered TEXT, which has passed
// over a visibly broken panel before (poly-to-track v0.9.1). The loader-format
// chip in particular is a presentational claim about which code path runs, so
// it wants eyes on it and not just a `toContain`.
import { chromium } from 'playwright';

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader-webgl', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

// The catalog, then its tag row on its own (the chips are unreadable at page
// scale), then the same grid with the `pml` facet applied.
await page.goto('http://localhost:3000/browse', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(800);
await page.screenshot({ path: '/tmp/tspml-browse.png' });
await page
  .locator('.tag-row')
  .first()
  .screenshot({ path: '/tmp/tspml-browse-tagrow.png' })
  .catch(() => {});
// Exact-text: `pml` is a substring of `tspml`, and a hasText lookup grabs
// whichever chip comes first.
await page
  .locator('.tag-row button')
  .filter({ hasText: /^pml$/ })
  .click()
  .catch(() => {});
await page.waitForTimeout(500);
await page.screenshot({ path: '/tmp/tspml-browse-pml.png' });

// A detail page for one of the thirteen entries with no build for this game
// version. Two `.install-caveat` boxes stack here — the PML adapter note and
// the no-build note — and two identically-styled grey boxes in a row is the
// thing to look at rather than assert: it can read as one long paragraph in a
// border, which would bury the more actionable of the two.
await page.goto('http://localhost:3000/browse/pml-coolcars', { waitUntil: 'domcontentloaded' });
// Wait for the CONTENT, not a guessed interval: the catalog is fetched on
// mount, and a fixed timeout caught the "Loading…" state once already — a
// screenshot of a spinner that silently passes for a screenshot of the page.
await page.waitForSelector('.entry-facts', { timeout: 15000 }).catch(() => {});
await page.screenshot({ path: '/tmp/tspml-browse-nobuild.png' });
// The same pair on a CARD, where vertical space is tighter than on the detail
// page and the grid has to stay scannable.
await page.goto('http://localhost:3000/browse', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.entry-card', { timeout: 15000 }).catch(() => {});
await page
  .locator('.entry-card', { hasText: 'Cool Cars' })
  .first()
  .screenshot({ path: '/tmp/tspml-browse-nobuild-card.png' })
  .catch(() => {});

// The POSITIVE case, on the one entry where the advisory logic could fail
// quietly: poly-to-track is native (so no PML adapter caveat) and its
// gameVersions is a RANGE (">=0.6.0 <0.7.0") that covers 0.6.2 by syntax
// rather than by listing it. A substring check would have put a false "no
// build" warning on the one native mod in the catalog. Expect NO grey caveat
// box here, and the facts row saying "covers 0.6.2".
await page.goto('http://localhost:3000/browse/poly-to-track', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.entry-facts', { timeout: 15000 }).catch(() => {});
await page.screenshot({ path: '/tmp/tspml-browse-range.png' });

await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(600);
await page.screenshot({ path: '/tmp/tspml-launcher.png' });
await page.goto('http://localhost:3000/play', { waitUntil: 'domcontentloaded' });
await page.screenshot({ path: '/tmp/tspml-boot.png' });
await page.waitForSelector('.boot-overlay', { state: 'detached', timeout: 90000 }).catch(() => {});
// The Mods menu is an overlay closed by default; open it before the shots.
await page.click('.mods-btn').catch(() => {});
await page.waitForTimeout(400);
await page.click('aside[aria-label="Mods"] .add-opener');
await page.waitForTimeout(400);
await page.locator('.mods-menu').screenshot({ path: '/tmp/tspml-sidebar.png' });
await page.screenshot({ path: '/tmp/tspml-form.png' });
await browser.close();

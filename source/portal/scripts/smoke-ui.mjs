// Headless proof for the Play page LAYOUT: the fullscreen control and the
// responsive stacking added by the UI revamp. The other smokes assert what the
// sidebar SAYS; this one asserts how the page BEHAVES as a surface:
//
//   1. the stage's fullscreen button is visible over the game frame;
//   2. clicking it makes the STAGE (not the iframe) the fullscreen element —
//      the wrapper carries the overlay button, so the way out stays clickable;
//   3. the button's label flips (⛶ Fullscreen ↔ ✕ Exit fullscreen);
//   4. clicking again exits fullscreen;
//   5. at a phone-width viewport the sidebar stacks BELOW the game stage.
//
//   pnpm --filter @tspml/portal dev       # in one terminal (:3000)
//   pnpm --filter @tspml/portal smoke:ui  # in another
//
// TSPML_TRANSFORM is not required — nothing here depends on the transformed
// bundle; the game only needs to mount.
import { chromium } from 'playwright';

const BASE_URL = process.env.SMOKE_URL ?? 'http://localhost:3000';
const SHOT = process.env.SMOKE_SHOT ?? '/tmp/tspml-ui-smoke.png';

const step = (msg) => process.stderr.write(`smoke:ui · ${msg}\n`);

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader-webgl', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

step(`goto ${BASE_URL}`);
await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

// SW-control dance (issue #9): on a cold profile the first load may not mount
// the game iframe; one reload fixes it.
let frame = await page
  .waitForSelector('iframe[title="PolyTrack (proxied)"]', { timeout: 30000 })
  .catch(() => null);
if (!frame) {
  step('  no iframe — reloading for SW control');
  await page.reload({ waitUntil: 'domcontentloaded' });
  frame = await page
    .waitForSelector('iframe[title="PolyTrack (proxied)"]', { timeout: 45000 })
    .catch(() => null);
}

const out = { frameMounted: !!frame };

const fsBtn = page.locator('button.fs-btn');
out.fsButtonVisible = await fsBtn.isVisible().catch(() => false);

step('enter fullscreen');
await fsBtn.click().catch(() => {});
await page.waitForTimeout(500);
out.enteredFullscreen = await page.evaluate(
  () => document.fullscreenElement?.classList?.contains('stage') === true,
);
out.labelInFs = (await fsBtn.textContent().catch(() => '')) ?? '';
out.labelFlipped = /exit/i.test(out.labelInFs);

step('exit fullscreen');
await fsBtn.click().catch(() => {});
await page.waitForTimeout(500);
out.exitedFullscreen = await page.evaluate(() => document.fullscreenElement === null);

step('narrow viewport: sidebar stacks under the stage');
await page.setViewportSize({ width: 480, height: 900 });
await page.waitForTimeout(500);
out.narrowStacked = await page.evaluate(() => {
  const stage = document.querySelector('.stage');
  const side = document.querySelector('.sidebar');
  return (
    !!stage && !!side && side.getBoundingClientRect().top >= stage.getBoundingClientRect().bottom - 1
  );
});
await page.screenshot({ path: SHOT });

const PASS =
  out.frameMounted === true &&
  out.fsButtonVisible === true &&
  out.enteredFullscreen === true &&
  out.labelFlipped === true &&
  out.exitedFullscreen === true &&
  out.narrowStacked === true;

console.log(JSON.stringify({ PASS, verdict: out, shot: SHOT }, null, 2));
await browser.close();
process.exit(PASS ? 0 : 1);

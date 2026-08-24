// Headless proof for the Play page LAYOUT: the boot-progress overlay, the two
// stage controls (fullscreen + theater/expand), and the responsive stacking.
// The other smokes assert what the sidebar SAYS; this one asserts how the page
// BEHAVES as a surface:
//
//   1. the boot-progress overlay shows while TSPML loads, then goes away;
//   2. the stage's fullscreen + expand buttons are visible over the game frame;
//   3. clicking fullscreen makes the STAGE (not the iframe) the fullscreen
//      element — the wrapper carries the overlay buttons, so the way out stays
//      clickable — and the label flips (⛶ Fullscreen ↔ ✕ Exit fullscreen);
//   4. clicking again exits fullscreen;
//   5. clicking expand puts the app in theater mode: the stage covers the whole
//      viewport WITHOUT the Fullscreen API; clicking again restores the layout;
//   6. the sidebar's Log section exists collapsed, and opening it shows the
//      timestamped session events the boot path wrote;
//   7. at a phone-width viewport the sidebar stacks BELOW the game stage.
//
//   pnpm --filter @tspml/portal dev       # in one terminal (:3000)
//   pnpm --filter @tspml/portal smoke:ui  # in another
//
// TSPML_TRANSFORM is not required — nothing here depends on the transformed
// bundle; the game only needs to mount.
import { chromium } from 'playwright';

const BASE_URL = process.env.SMOKE_URL ?? 'http://localhost:3000';
// The play surface. `/` is the launcher now; BASE_URL stays an origin because
// other requests in this file are origin-relative.
const PLAY_URL = `${BASE_URL}/play`;
const SHOT = process.env.SMOKE_SHOT ?? '/tmp/tspml-ui-smoke.png';

const step = (msg) => process.stderr.write(`smoke:ui · ${msg}\n`);

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader-webgl', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

step(`goto ${PLAY_URL}`);
await page.goto(PLAY_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

const out = {};

// 1. Boot progress: the overlay renders while TSPML boots. Catch it early —
// on a warm profile the whole boot can finish in a few seconds.
out.bootOverlayShown = !!(await page
  .waitForSelector('.boot-overlay', { timeout: 15000 })
  .catch(() => null));

// SW-control dance (issue #9): on a cold profile the first load may not mount
// the game iframe; one reload fixes it.
let frame = await page
  .waitForSelector('iframe[title="PolyTrack (proxied)"]', { timeout: 30000 })
  .catch(() => null);
if (!frame) {
  step('  no iframe — reloading for SW control');
  await page.reload({ waitUntil: 'domcontentloaded' });
  // The boot restarts with the page, so the overlay must show again.
  out.bootOverlayShown = !!(await page
    .waitForSelector('.boot-overlay', { timeout: 15000 })
    .catch(() => null));
  frame = await page
    .waitForSelector('iframe[title="PolyTrack (proxied)"]', { timeout: 45000 })
    .catch(() => null);
}
out.frameMounted = !!frame;

// ...and once every boot step lands (SW, plan, game, mods) it unmounts.
step('wait for boot overlay to clear');
out.bootOverlayCleared = await page
  .waitForSelector('.boot-overlay', { state: 'detached', timeout: 90000 })
  .then(() => true)
  .catch(() => false);

const fsBtn = page.locator('button.fs-btn');
const theaterBtn = page.locator('button.theater-btn');
out.fsButtonVisible = await fsBtn.isVisible().catch(() => false);
out.theaterButtonVisible = await theaterBtn.isVisible().catch(() => false);

// Poll, never sleep. The label is React state driven by a `fullscreenchange`
// listener, so it lands one or two frames AFTER the browser has already
// entered fullscreen — a fixed wait is a coin flip on a loaded machine, and
// this leg used to fail roughly 1 run in 12 for that reason alone. Each wait
// still ends in a bounded timeout, so a real regression fails as a false
// assertion rather than hanging.
const settle = (fn, timeout = 8000) =>
  page
    .waitForFunction(fn, undefined, { timeout, polling: 100 })
    .then(() => true)
    .catch(() => false);

step('enter fullscreen');
await fsBtn.click().catch(() => {});
out.enteredFullscreen = await settle(
  () => document.fullscreenElement?.classList?.contains('stage') === true,
);
// Wait for the label separately: the flip is the thing under test, so a miss
// has to read as "the label never flipped", not as "we looked too early".
out.labelFlipped = await settle(() =>
  /exit/i.test(document.querySelector('button.fs-btn')?.textContent ?? ''),
);
out.labelInFs = (await fsBtn.textContent().catch(() => '')) ?? '';

step('exit fullscreen');
await fsBtn.click().catch(() => {});
out.exitedFullscreen = await settle(() => document.fullscreenElement === null);

// 5. Theater mode: stage covers the viewport, fullscreen API NOT engaged.
step('enter theater (expand) mode');
await theaterBtn.click().catch(() => {});
out.theaterCoversTab = await settle(() => {
  const stage = document.querySelector('.stage');
  if (!stage) return false;
  const r = stage.getBoundingClientRect();
  return (
    document.fullscreenElement === null &&
    document.querySelector('main.app')?.classList.contains('theater') === true &&
    r.top <= 1 &&
    r.left <= 1 &&
    r.width >= window.innerWidth - 2 &&
    r.height >= window.innerHeight - 2
  );
});
out.theaterLabelFlipped = await settle(() =>
  /shrink/i.test(document.querySelector('button.theater-btn')?.textContent ?? ''),
);
out.theaterLabel = (await theaterBtn.textContent().catch(() => '')) ?? '';

step('exit theater mode');
await theaterBtn.click().catch(() => {});
out.theaterExited = await settle(
  () => document.querySelector('main.app')?.classList.contains('theater') === false,
);

// 6. Session log: the sidebar's Log section is collapsed by default; opening
// it reveals the timestamped lines the boot path logged (SW registration,
// frame load, mods loaded — anything, we only assert lines exist).
step('open the sidebar Log section');
out.logCollapsed = await page.evaluate(() => {
  const d = document.querySelector('details.log-details');
  return d instanceof HTMLDetailsElement && !d.open;
});
await page.click('details.log-details summary').catch(() => {});
await page.waitForTimeout(200);
out.logHasLines = await page.evaluate(
  () => document.querySelectorAll('details.log-details .log-line').length >= 3,
);

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
  out.bootOverlayShown === true &&
  out.frameMounted === true &&
  out.bootOverlayCleared === true &&
  out.fsButtonVisible === true &&
  out.theaterButtonVisible === true &&
  out.enteredFullscreen === true &&
  out.labelFlipped === true &&
  out.exitedFullscreen === true &&
  out.theaterCoversTab === true &&
  out.theaterLabelFlipped === true &&
  out.theaterExited === true &&
  out.logCollapsed === true &&
  out.logHasLines === true &&
  out.narrowStacked === true;

console.log(JSON.stringify({ PASS, verdict: out, shot: SHOT }, null, 2));
await browser.close();
process.exit(PASS ? 0 : 1);

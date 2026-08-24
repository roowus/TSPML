// Headless proof for #118: input typed into the Add form BEFORE React attaches
// is not thrown away.
//
// The page is server-rendered, so the form is on screen and fully usable a few
// hundred milliseconds before hydration completes. Anything typed in that
// window lives in the DOM but not in React state, and the first re-render after
// hydration renders `value={draft...}` straight over it. Measured on prod
// before the fix: a dropdown choice made while the service-worker badge still
// read "waiting…" was discarded 10 times out of 16.
//
//   pnpm --filter @tspml/portal dev              # in one terminal (:3000)
//   pnpm --filter @tspml/portal smoke:hydration  # in another
//
// TSPML_TRANSFORM is not required: nothing here touches the bundle, the mixin
// plan, or the game frame. This smoke deliberately does NOT wait for the game
// to mount — the whole point is to act early.
//
// WHY THE ROUTE DELAY. Racing the real hydration window would make this flaky
// in exactly the direction that hides bugs: a slow CI runner finishes typing
// after hydration and the smoke passes without ever entering the window it
// exists to test. Delaying the client chunks makes the window deterministic and
// generous. It changes WHEN React attaches, never WHAT it does when it does —
// the code under test is the same code prod runs.
//
// FALSIFIED: with the adopt-on-mount effect in app/play/page.tsx removed, every leg
// below goes false (manifest "", code "", method back to "paste"). The
// `preHydrationConfirmed` guard was falsified separately, by reading it AFTER
// waiting for hydration: it goes false, so a run that missed the window cannot
// quietly pass. (Note that setting the delay to 0 does NOT reliably miss the
// window — dev-server chunks are slow enough on their own — which is the
// reason the guard is an assertion here rather than a comment.)
import { chromium } from 'playwright';

const BASE_URL = process.env.SMOKE_URL ?? 'http://localhost:3000';
const SHOT = process.env.SMOKE_SHOT ?? '/tmp/tspml-hydration-smoke.png';
// Long enough that even a loaded CI runner is still pre-hydration when the
// typing happens; the smoke waits on hydration afterwards rather than sleeping,
// so a generous value costs one fixed delay, not a proportional slowdown.
const CHUNK_DELAY_MS = Number(process.env.SMOKE_HYDRATION_DELAY ?? 3000);

const MANIFEST = '{"schemaVersion":1,"id":"pre-hydration-mod","version":"1.0.0"}';
const CODE = 'export default (api) => { void api; };';

const step = (msg) => process.stderr.write(`smoke:hydration · ${msg}\n`);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e?.message ?? e).slice(0, 300)));

const ASIDE = 'aside[aria-label="Mods"]';
const SELECT = `${ASIDE} select.add-select`;
const AREAS = `${ASIDE} textarea`;

/** True once React has attached a fiber to the sidebar. */
const isHydrated = () => {
  const el = document.querySelector('aside[aria-label="Mods"]');
  return el !== null && Object.keys(el).some((k) => k.startsWith('__reactFiber$'));
};

// Delay every client chunk — that gap IS the pre-hydration window.
await page.route('**/_next/static/chunks/**', async (route) => {
  await new Promise((r) => setTimeout(r, CHUNK_DELAY_MS));
  await route.continue();
});

step(`goto ${BASE_URL} (client chunks delayed ${CHUNK_DELAY_MS}ms)`);
await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

const out = {};

// The server-rendered form must be REACHABLE this early, or there is no bug to
// have and nothing below means anything.
step('open the Add form from server-rendered HTML');
await page.waitForSelector(`${ASIDE} summary`, { timeout: 30000 });
await page.click(`${ASIDE} summary`);
out.formUsableBeforeHydration = !!(await page
  .waitForSelector(SELECT, { timeout: 30000 })
  .catch(() => null));

// Guard against the failure mode that would make this smoke worthless: if
// hydration already happened, the run proves nothing, so say so rather than
// pass. (This is the assertion that keeps the test from being unfalsifiable.)
out.preHydrationConfirmed = !(await page.evaluate(isHydrated));

// Only the PASTE boxes and the dropdown are reachable this early, and that is
// not a gap in the test: the pack and URL fields are collapsed
// (`.add-hidden` is visibility:hidden;height:0) until their method is chosen,
// and choosing it is a React render that by definition has not happened yet.
// The paste boxes plus the select are exactly the pre-hydration surface.
step('type into the form while React is not attached');
await page.locator(`${AREAS} >> nth=0`).fill(MANIFEST);
await page.locator(`${AREAS} >> nth=1`).fill(CODE);
// The one-click control, and so the one a user is likeliest to reach first.
await page.selectOption(SELECT, 'pack');

out.domAcceptedInput = await page.evaluate(() => {
  const a = /** @type {NodeListOf<HTMLTextAreaElement>} */ (
    document.querySelectorAll('aside[aria-label="Mods"] textarea')
  );
  const s = /** @type {HTMLSelectElement | null} */ (
    document.querySelector('aside[aria-label="Mods"] select.add-select')
  );
  return (a[0]?.value ?? '').length > 0 && (a[1]?.value ?? '').length > 0 && s?.value === 'pack';
});

step('wait for hydration, then for a further React render');
out.hydrated = await page
  .waitForFunction(isHydrated, undefined, { timeout: 60000 })
  .then(() => true)
  .catch(() => false);

// Hydration alone is not the moment the value was lost — the overwrite happened
// on the NEXT render (in practice the swState flip to "active"). Wait for a
// state change that is visible in the DOM rather than sleeping a fixed amount:
// the boot log grows on every boot step, so a line count that has increased is
// proof that React has re-rendered this subtree since hydration.
const countLogLines = () =>
  document.querySelectorAll('aside[aria-label="Mods"] .log-line').length;
const linesAtHydration = await page.evaluate(countLogLines);
out.reRenderedAfterHydration = await page
  .waitForFunction(
    (n) => document.querySelectorAll('aside[aria-label="Mods"] .log-line').length !== n,
    linesAtHydration,
    { timeout: 60000, polling: 250 },
  )
  .then(() => true)
  .catch(() => false);
// Plus a settle margin so a later render cannot land just after the read below.
await page.waitForTimeout(2000);

const after = await page.evaluate(() => {
  const a = /** @type {NodeListOf<HTMLTextAreaElement>} */ (
    document.querySelectorAll('aside[aria-label="Mods"] textarea')
  );
  const s = /** @type {HTMLSelectElement | null} */ (
    document.querySelector('aside[aria-label="Mods"] select.add-select')
  );
  const packBox = document.querySelector('aside[aria-label="Mods"] .pack-box');
  return {
    manifest: a[0]?.value ?? '',
    code: a[1]?.value ?? '',
    method: s?.value ?? '',
    packVisible: packBox !== null && !packBox.className.includes('add-hidden'),
  };
});
out.after = after;

// The text survived...
out.manifestKept = after.manifest === MANIFEST;
out.codeKept = after.code === CODE;
// ...and so did the dropdown choice, in BOTH senses: the control still reads
// "pack", and React genuinely believes it (the pack box is the rendered
// consequence of addMethod, so a select that merely looks right while the
// paste boxes are showing would fail here).
out.methodKept = after.method === 'pack';
out.methodReachedReact = after.packVisible === true;

out.pageErrors = pageErrors.slice(0, 5);
await page.screenshot({ path: SHOT });

const PASS =
  out.formUsableBeforeHydration === true &&
  out.preHydrationConfirmed === true &&
  out.domAcceptedInput === true &&
  out.hydrated === true &&
  out.reRenderedAfterHydration === true &&
  out.manifestKept === true &&
  out.codeKept === true &&
  out.methodKept === true &&
  out.methodReachedReact === true &&
  pageErrors.length === 0;

console.log(JSON.stringify({ PASS, verdict: out, shot: SHOT }, null, 2));
await browser.close();
process.exit(PASS ? 0 : 1);

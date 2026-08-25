// Headless proof for the IN-PLAY BROWSE DRAWER (launcher phase 4): can you
// install a mod from the catalog without losing the game you are playing?
//
//   TSPML_TRANSFORM=1 pnpm --filter @tspml/portal dev    # in one terminal (:3000)
//   pnpm --filter @tspml/portal smoke:drawer             # in another
//
// The drawer exists for exactly one reason: a client-side navigation to /browse
// unmounts the game iframe, and the iframe's mount is gated on
// `swState === 'active' && planReady` because the mixin and physics plans must be
// parked in the Cache API BEFORE the frame's first bundle fetch. So "browse while
// playing" cannot be a route, and the drawer is an overlay that never takes the
// iframe out of the tree.
//
// THE LOAD-BEARING LEG IS `sameFrame`. Everything else here could pass while the
// product silently re-booted the game on every install — which is the exact
// failure the drawer was built to prevent, and which looks like success from any
// assertion that only checks "is there an iframe and is the mod loaded". The
// iframe is therefore STAMPED (a property set on its contentWindow) before the
// drawer is opened, and the stamp is re-read after the install: a surviving stamp
// is the same document, a missing one is a remount. `poly-to-track`-style manual
// eyeballing cannot see this, because a remounted game looks identical.
//
// The second leg with teeth is `loadedLive`. The launcher's install target
// deliberately does NOT park plans or reload — it cannot, there is no iframe —
// and says "it loads next time you play". If the drawer were wired to that target
// by mistake, the mod would land in localStorage and the sidebar would keep
// saying `mods: none` until a reload. Storage assertions cannot tell the two
// targets apart; only "did the loader actually run it, now" can.
//
// PASS requires, in order:
//   A. opens    — /play boots, the stage offers Browse, and clicking it reveals
//                 the drawer WITH the catalog in it (the drawer renders the same
//                 Catalog component /browse does, so an empty panel means the
//                 registry fetch or the shared component broke);
//   B. installs — confirm-then-install from inside the drawer loads the mod LIVE:
//                 the sidebar's `mods:` line names it without any navigation, and
//                 the game frame is the SAME DOCUMENT it was before the click;
//   C. no nav   — the URL never changed, and the entry title is not a link (on
//                 /browse it is a <Link> to the detail page; following one from
//                 here would be the navigation that kills the run);
//   D. closes   — Escape closes the drawer, the mod stays loaded, and the game is
//                 STILL the same document.
//
// Leg C is not pedantry. The drawer reuses `Catalog` from the browse route, and
// that component's cards link to /browse/<id> by default. `linkEntries={false}`
// is one prop, in one place, with no other consequence — precisely the kind of
// thing a later refactor drops without noticing, and the failure it causes (a
// player clicks a mod name and their run ends) is worse than not shipping the
// drawer at all.
import { chromium } from "playwright";

const BASE_URL = process.env.SMOKE_URL ?? "http://localhost:3000";
const PLAY_URL = `${BASE_URL}/play`;
const SHOT = process.env.SMOKE_SHOT ?? "/tmp/tspml-drawer-smoke.png";
// The catalog's real entry (public/registry/index.json) — poly-to-track,
// hosted on GitHub raw, so the drawer install here does hit the network the
// same way a player's click does. The old same-origin sample fixture was
// removed from the catalog (it remains in public/ for smoke-user-mods).
const ENTRY_NAME = "Poly To Track";
const MOD_ID = "poly-to-track";

const step = (msg) => process.stderr.write(`smoke:drawer · ${msg}\n`);

/** The Mods menu's full text. The aside is an overlay closed by default but
 *  always mounted — `hidden`, not unrendered — so queries see through it while
 *  innerText would not. textContent + whitespace collapse keeps the status-row
 *  regexes working against a closed menu. */
const modsText = () =>
  page.evaluate(() =>
    (document.querySelector('aside[aria-label="Mods"]')?.textContent ?? "")
      .replace(/\s+/g, " "),
  );

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

// A cold profile: no mods, so `mods: none` before the install is meaningful and
// the sidebar naming the mod afterwards can only have come from the drawer.
await page.addInitScript(() => {
  if (window.top !== window) return; // the game frame is same-origin (/api/proxy)
  try {
    window.localStorage.removeItem("tspml.userMods.v1");
  } catch {}
});

/**
 * Wait for a page predicate, resolving false on timeout rather than throwing.
 *
 * A real function, not a source string, so `tooling/typecheck` (which globs
 * these .mjs files with `checkJs`) actually checks it.
 *
 * @param {() => unknown} predicate
 * @param {number} [timeout]
 */
const waitFor = (predicate, timeout = 30000) =>
  page
    .waitForFunction(predicate, undefined, { timeout, polling: 300 })
    .then(() => true)
    .catch(() => false);

const out = {};

// ── boot ────────────────────────────────────────────────────────────────────
step("booting /play");
await page.goto(PLAY_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
let frame = await page
  .waitForSelector('iframe[title="PolyTrack (proxied)"]', { timeout: 30000 })
  .catch(() => null);
if (!frame) {
  // Cold-profile service-worker dance (#9): the first visit may land before the
  // SW controls the page, and the mount is gated on it.
  step("  no iframe — reloading for SW control");
  await page.reload({ waitUntil: "domcontentloaded" });
  frame = await page
    .waitForSelector('iframe[title="PolyTrack (proxied)"]', { timeout: 45000 })
    .catch(() => null);
}
out.frameMounted = !!frame;
// Wait for the loader to settle before stamping: a stamp set during boot could
// be wiped by a remount that was always going to happen, and would then read as
// a drawer-caused remount later.
out.startsWithNoMods = await waitFor(() => /mods:\s*none/.test((document.querySelector('aside[aria-label="Mods"]')?.textContent ?? "")));

/**
 * Mark the CURRENT game document, so a later check can tell "same document" from
 * "remounted and re-booted". Same-origin (/api/proxy) is what makes this legal.
 *
 * Returns false if the frame or its document is unreachable, which is itself a
 * failure — an unstampable frame cannot prove anything.
 */
const stampFrame = () =>
  page.evaluate(() => {
    const el = /** @type {HTMLIFrameElement | null} */ (
      document.querySelector('iframe[title="PolyTrack (proxied)"]')
    );
    const win = /** @type {(Window & { __smokeDrawerStamp?: number }) | null} */ (
      el?.contentWindow ?? null
    );
    if (!win) return false;
    win.__smokeDrawerStamp = 4321;
    return true;
  });

/** True only if the frame is the very document `stampFrame` marked. */
const frameStillStamped = () =>
  page.evaluate(() => {
    const el = /** @type {HTMLIFrameElement | null} */ (
      document.querySelector('iframe[title="PolyTrack (proxied)"]')
    );
    const win = /** @type {(Window & { __smokeDrawerStamp?: number }) | null} */ (
      el?.contentWindow ?? null
    );
    return win?.__smokeDrawerStamp === 4321;
  });

out.frameStamped = await stampFrame();

const urlBefore = page.url();

// ── A. the drawer opens over the stage, with the catalog in it ──────────────
step("leg A — Browse opens the drawer with the catalog inside");
await page.click("button.browse-btn", { timeout: 10000 }).catch(() => {});
const drawer = page.locator(".browse-drawer");
out.aDrawerVisible = await drawer
  .waitFor({ state: "visible", timeout: 10000 })
  .then(() => true)
  .catch(() => false);
// The shared Catalog rendered, not just an empty panel: the seeded entry is
// listed and its install control is there to click.
out.aCatalogListed = await drawer
  .locator(".entry-card", { hasText: ENTRY_NAME })
  .waitFor({ state: "visible", timeout: 15000 })
  .then(() => true)
  .catch(() => false);
// Opening the drawer must not have disturbed the game.
out.aFrameSurvivedOpen = await frameStillStamped();

// ── B. install from inside the drawer, live ─────────────────────────────────
step("leg B — install from the drawer loads the mod without a reload");
const card = drawer.locator(".entry-card", { hasText: ENTRY_NAME });
await card.locator("button", { hasText: "Install" }).first().click({ timeout: 10000 }).catch(() => {});
// Two-click confirm: mod code runs unsandboxed, so the disclosure is shown
// before anything is fetched. Same control the browse route uses.
out.bConfirmShown = await card
  .locator("button", { hasText: "Install anyway" })
  .waitFor({ state: "visible", timeout: 10000 })
  .then(() => true)
  .catch(() => false);
await card.locator("button", { hasText: "Install anyway" }).click({ timeout: 10000 }).catch(() => {});

// THE leg: the loader ran it, now, in this session. The launcher's install
// target would have written storage and said "loads next time you play", which
// would leave this line reading `mods: none` forever.
out.bLoadedLive = await waitFor(
  () => /mods:\s*✓[^\n]*poly-to-track/.test((document.querySelector('aside[aria-label="Mods"]')?.textContent ?? "")),
  60000,
);
// THE OTHER leg: same document. A remount would have re-booted the game, which
// is the entire thing the drawer exists to avoid and which every other
// assertion here would happily pass through.
out.bSameFrameAfterInstall = await frameStillStamped();
// The card reports what actually happened, in words that match it.
out.bSaysLoaded = await card
  .locator(".install-done")
  .waitFor({ state: "visible", timeout: 20000 })
  .then(() => card.locator(".install-done").innerText())
  .then((t) => /loaded/i.test(t))
  .catch(() => false);

// ── C. nothing navigated, and nothing offers to ─────────────────────────────
step("leg C — no navigation happened and no card offers one");
out.cUrlUnchanged = page.url() === urlBefore;
// On /browse an entry title is a <Link> to /browse/<id>. In here it must be
// inert text: following one would unmount the iframe and end the run.
out.cTitleNotALink = (await drawer.locator("a.entry-name").count()) === 0;
out.cTitleStillShown = (await drawer.locator("span.entry-name").count()) > 0;

// ── D. close, and the game is still the same game ───────────────────────────
step("leg D — Escape closes the drawer; the mod stays, the game stays");
await page.keyboard.press("Escape");
out.dDrawerHidden = await drawer
  .waitFor({ state: "hidden", timeout: 10000 })
  .then(() => true)
  .catch(() => false);
// Closing is not unloading: the mod the player just installed is still running.
out.dModStillLoaded = /mods:\s*✓[^\n]*poly-to-track/.test(await modsText());
out.dSameFrameAfterClose = await frameStillStamped();
// It landed in the shared library too, so it survives to the next launch. Read
// from storage rather than inferred from the UI.
out.dInPool = await page.evaluate((id) => {
  try {
    const pool = JSON.parse(window.localStorage.getItem("tspml.userMods.v1") ?? "[]");
    return Array.isArray(pool) && pool.some((r) => r?.manifest?.id === id);
  } catch {
    return false;
  }
}, MOD_ID);

await page.screenshot({ path: SHOT, fullPage: false }).catch(() => {});

const PASS = Object.values(out).every((v) => v === true) && pageErrors.length === 0;

console.log(
  JSON.stringify(
    {
      PASS,
      verdict: {
        drawerOpensOverTheStage: (out.aDrawerVisible && out.aCatalogListed) ?? false,
        installsLiveIntoTheRunningGame: (out.bLoadedLive && out.bSaysLoaded) ?? false,
        // The one the drawer exists for. If this is false the product still
        // "works" — it just silently restarts your game every time you install,
        // which is the behaviour a route would have given for free.
        gameNeverRemounted:
          (out.aFrameSurvivedOpen && out.bSameFrameAfterInstall && out.dSameFrameAfterClose) ??
          false,
        neverNavigates: (out.cUrlUnchanged && out.cTitleNotALink) ?? false,
        closesWithoutUnloading: (out.dDrawerHidden && out.dModStillLoaded) ?? false,
        persistedToTheLibrary: out.dInPool ?? false,
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

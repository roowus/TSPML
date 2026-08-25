// Headless proof for PHYSICS WASM PATCHING (#43) in the portal: paste a mod
// carrying a physics.json through the real "+ Add a mod" form and verify the
// constant is actually rewritten in the binary the game instantiates.
//
// This is the one #43 leg unit tests cannot reach. `wasm-serve.test.ts` proves
// `serveWasm` decides correctly given bytes and a plan; `physics-plan.test.ts`
// proves the plan is built and parsed correctly. Neither can prove the CARRIAGE:
// page → Cache API → service-worker POST replay → route → `serveWasm` →
// `x-tspml-wasm-*` headers → SW postMessage → the Physics panel. That chain only
// exists in a browser with a registered service worker, and every link in it was
// verified by hand with throwaway scripts until this file existed.
//
//   TSPML_TRANSFORM=1 pnpm --filter @tspml/portal dev    # in one terminal (:3000)
//   pnpm --filter @tspml/portal smoke:physics            # in another
//
// PASS requires, in order:
//   1. derive  — a patch target is derived from the LIVE binary, not hardcoded.
//                A pinned signature would rot into a false failure on the next
//                PolyTrack release; deriving one tests the chain instead of a
//                constant, and re-proves the locator against real bytes each run.
//   2. vanilla — a cold session reports `vanilla`, so the later `patched` is a
//                change this smoke caused and not the resting state.
//   3. skip    — added WITHOUT its physics.json, the manifest's `physics`
//                declaration is surfaced as skipped, not silently ignored.
//   4. refused — a plan pinned to ANOTHER build is refused: the panel reads
//                `plan-refused`, and the detail names the mismatch. This is the
//                leg that makes leg 5 evidence rather than coincidence — same
//                mod, same code, same request, and the only difference is
//                whether the pin matched. Without it, `patched` could be a
//                label the page prints whenever a physics mod is installed.
//   5. patched — with a plan pinned to THIS build, the panel reads `patched`,
//                says one constant was rewritten, and the sidebar's safety row
//                reads the warn-only leaderboard risk. Warn-only is the locked
//                policy: the row must WARN, and the game must still boot.
//   6. remove  — removing the mod clears its stored record.
//
// A stale pin (Kodub shipped a new physics binary) fails-closed to `stale-pin`
// everywhere and is reported as its own verdict, because that is a game release,
// not a defect in this commit — the same distinction the pinned-bundle canary
// job draws for the JS bundle.
import { chromium } from "playwright";
import { f32ConstSites, fingerprintAll, wasmHash } from "@tspml/wasm";

const BASE_URL = process.env.SMOKE_URL ?? "http://localhost:3000";
// The play surface. `/` is the launcher now; BASE_URL stays an origin because
// other requests in this file are origin-relative.
const PLAY_URL = `${BASE_URL}/play`;
const SHOT = process.env.SMOKE_SHOT ?? "/tmp/tspml-physics-smoke.png";
const MOD_ID = "smoke-physics-mod";
const WASM_FILE = "polytrack_physics.wasm";
// A pin that cannot be any real build: 64 hex chars (so it clears the page's
// paste-time shape check) that no binary hashes to (so the server refuses it).
const FOREIGN_PIN = "0".repeat(64);

const step = (msg) => process.stderr.write(`smoke:physics · ${msg}\n`);

const out = {};

// ── 1. Derive a patch target from the live binary ────────────────────────────
// The same two questions the writer will ask, asked here first so a refusal in
// leg 5 means the CARRIAGE broke rather than the target being unpatchable:
// does this signature name exactly one function, and does that value occur
// exactly once inside it?
step(`fetch ${WASM_FILE} through the proxy and derive a target`);
const probeRes = await fetch(`${BASE_URL}/api/proxy/${WASM_FILE}`);
const vanillaBytes = new Uint8Array(await probeRes.arrayBuffer());
out.wasmServed = probeRes.status === 200 && vanillaBytes.length > 0;
// The route's own verdict on an unplanned GET. `stale-pin` here means the live
// binary is not the pinned build and nothing downstream can succeed.
out.probeStatus = probeRes.headers.get("x-tspml-wasm-status") ?? "(none)";
out.pinCurrent = out.probeStatus === "vanilla";

// No status header at all means the wasm surface never engaged, and the only way
// that happens for a 200 is TSPML_TRANSFORM being unset — the route gates both the
// surface and the POST behind it, so every later leg would fail for a reason that
// has nothing to do with physics. Say so here instead of reporting `patched: false`
// and letting someone go looking at the writer. (Cost me a debugging detour.)
if (out.wasmServed && out.probeStatus === "(none)") {
  console.error(
    JSON.stringify(
      {
        PASS: false,
        verdict: out,
        why:
          "no x-tspml-wasm-status on a 200 — the wasm surface is disabled. Start the " +
          "server with TSPML_TRANSFORM=1 (CI sets it; a bare `pnpm dev` does not).",
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

const liveHash = wasmHash(vanillaBytes);
let target = null;
if (out.wasmServed) {
  const all = fingerprintAll(vanillaBytes);
  out.functions = all.bySig.size;
  // Sorted so the chosen target is the same on every run against the same
  // binary: a smoke that patches a different constant each time cannot be
  // debugged from its own output.
  for (const sig of [...all.bySig.keys()].sort()) {
    const fns = all.bySig.get(sig);
    if (fns.length !== 1) continue; // ambiguous fingerprint — the writer refuses these
    const sites = f32ConstSites(vanillaBytes, fns[0]);
    const counts = new Map();
    for (const s of sites) counts.set(s.value, (counts.get(s.value) ?? 0) + 1);
    const usable = sites.filter(
      (s) =>
        counts.get(s.value) === 1 &&
        // Bounded away from zero and from the extremes so the nudge below is
        // representable as a distinct f32 and stays a plausible tuning value.
        Math.abs(s.value) >= 0.5 &&
        Math.abs(s.value) <= 1000 &&
        Math.fround(s.value * 1.0001) !== Math.fround(s.value),
    );
    if (usable.length > 0) {
      target = { signature: sig, oldValue: usable[0].value };
      break;
    }
  }
}
out.targetDerived = target !== null;
if (target !== null) {
  out.target = { signature: `${target.signature.slice(0, 12)}…`, oldValue: target.oldValue };
}

// A deliberately tiny nudge. The point is to prove a constant was rewritten in
// the binary the game instantiates, and this smoke boots the real game three
// times over it — a 0.01% change to an unknown Bullet constant proves that
// without risking a sim that cannot run.
const newValue = target === null ? 0 : Math.fround(target.oldValue * 1.0001);

const MANIFEST = JSON.stringify({
  schemaVersion: 1,
  id: MOD_ID,
  name: "Smoke physics mod",
  version: "1.0.0",
  entrypoint: "entrypoint.js",
  targets: [">=0.6.0 <0.7.0"],
  physics: "physics.json",
});
// No behaviour of its own: this smoke is about the binary, and an entrypoint
// that did anything would make a failure ambiguous between the two paths.
const CODE = "export default () => {};";
const physicsJson = (pin) =>
  JSON.stringify({
    wasmHash: pin,
    patches: [{ name: "smoke-probe", signature: target?.signature ?? "", oldValue: target?.oldValue ?? 0, newValue }],
  });

if (!out.targetDerived) {
  console.log(
    JSON.stringify(
      {
        PASS: false,
        why:
          out.probeStatus === "stale-pin"
            ? `the live ${WASM_FILE} is not the pinned build — every physics path fail-closes to vanilla. This is a PolyTrack release, not a regression in this commit: regenerate the map (pnpm --filter @tspml/mappings-pipeline regen).`
            : `no uniquely-fingerprinted function with a single-occurrence f32 constant was found in ${WASM_FILE}. The locator, not the carriage, is what to look at.`,
        verdict: out,
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

// ── Browser ──────────────────────────────────────────────────────────────────
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

const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e && e.message ? e.message : e).slice(0, 300)));

/** The Physics panel's own text. Scoped to the section rather than read off the
 *  body: "patched" and "vanilla" are ordinary words, and a body-wide regex would
 *  happily match one of them in a log line or a warning elsewhere in the sidebar. */
const physicsPanel = () =>
  page.evaluate(() => {
    const secs = Array.from(document.querySelectorAll('aside[aria-label="Mods"] section.side-section'));
    const sec = secs.find((s) => s.querySelector("h2")?.textContent?.trim() === "Physics");
    // The Mods menu is an overlay closed by default (mounted, `hidden`) —
    // queries see through that but innerText would not, so textContent.
    return sec instanceof HTMLElement ? sec.textContent ?? "" : "";
  });

const sidebarText = () =>
  page.evaluate(() => {
    const aside = document.querySelector('aside[aria-label="Mods"]');
    // textContent, not innerText — see the note on physicsPanel above.
    return aside instanceof HTMLElement ? aside.textContent ?? "" : "";
  });

/** Poll the Physics panel until it matches, or time out to false. The panel is
 *  driven by a SW postMessage that lands whenever the game gets around to
 *  requesting the binary, so there is no navigation event to await. */
async function waitForPanel(re, timeout = 90000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (re.test(await physicsPanel())) return true;
    await page.waitForTimeout(500);
  }
  return false;
}

async function waitForSidebar(predicateSource, timeout = 60000) {
  return page
    .waitForFunction(predicateSource, undefined, { timeout, polling: 500 })
    .then(() => true)
    .catch(() => false);
}

/** Open the Add-a-mod popover if it is closed. The old <details>/<summary>
 *  disclosure is gone — the form lives in a native popover opened by the
 *  shelf's `.add-opener` button, which TOGGLES, so an unguarded click on an
 *  already-open popover would close it and fill() would time out. */
async function openAddForm() {
  // The menu overlay is closed by default; open it before anything inside.
  if (await page.evaluate(() => /** @type {HTMLElement | null} */ (document.querySelector('aside[aria-label="Mods"]'))?.hidden ?? false)) {
    await page.click('.mods-btn');
    await page.waitForSelector('aside[aria-label="Mods"]:not([hidden])', { timeout: 10000 });
  }
  // Open-state is the POPOVER's own (:popover-open), never a field's
  // visibility — this smoke always runs on the paste method so a textarea
  // would work, but the same helper must not learn the bad habit from
  // smoke-user-mods' url/pack legs (method persists across closes).
  if (
    !(await page.evaluate(
      () => document.getElementById('add-mod-popover')?.matches(':popover-open') ?? false,
    ))
  ) {
    await page.click('aside[aria-label="Mods"] .add-opener');
    await page
      .waitForFunction(
        () => document.getElementById('add-mod-popover')?.matches(':popover-open') ?? false,
        undefined,
        { timeout: 10000, polling: 100 },
      )
      .catch(() => {});
  }
}

/** Fill the Add form and submit. Box 4 is physics.json; passing null leaves it
 *  empty, which is leg 3's whole point. */
async function addMod(physics) {
  await openAddForm();
  const areas = page.locator('aside[aria-label="Mods"] textarea');
  await areas.nth(0).fill(MANIFEST);
  await areas.nth(1).fill(CODE);
  await areas.nth(2).fill("");
  await areas.nth(3).fill(physics ?? "");
  await page.click('aside[aria-label="Mods"] button:has-text("Add mod")');
}

/** Reload and wait for the game frame back. A physics change can only take
 *  effect on a fresh load: the running frame already holds the binary it was
 *  served, which is exactly why the page raises a restart banner for one. */
async function reloadAndSettle() {
  const nav = page.waitForEvent("domcontentloaded", { timeout: 30000 }).catch(() => null);
  // The banner lives inside the Mods menu overlay; open it if closed.
  if (await page.evaluate(() => /** @type {HTMLElement | null} */ (document.querySelector('aside[aria-label="Mods"]'))?.hidden ?? false)) {
    await page.click('.mods-btn');
    await page.waitForSelector('aside[aria-label="Mods"]:not([hidden])', { timeout: 10000 });
  }
  const banner = page.locator('aside[aria-label="Mods"] button:has-text("reload now")');
  if ((await banner.count()) > 0) await banner.first().click();
  else await page.reload({ waitUntil: "domcontentloaded" });
  await nav;
  await page.waitForSelector('iframe[title="PolyTrack (proxied)"]', { timeout: 60000 }).catch(() => null);
}

step(`goto ${PLAY_URL}`);
await page.goto(PLAY_URL, { waitUntil: "domcontentloaded", timeout: 60000 });

// SW-control dance (issue #9): on a cold profile the first load may not mount
// the game iframe; one reload fixes it. It matters more here than elsewhere —
// without a controlling service worker there is no POST replay and no report,
// so the panel would sit empty and every leg below would read as a failure.
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
out.frameMounted = !!frameEl;

step("wait for the cold session to settle at 'mods: none'");
out.initialLoadSettled = await waitForSidebar(
  () => /mods:\s*none/.test((document.querySelector('aside[aria-label="Mods"]')?.textContent ?? "")),
  90000,
);

// ── 2. A cold session is vanilla ─────────────────────────────────────────────
// Asserted before anything is installed so that `patched` in leg 5 is a change
// this smoke caused. Also proves the SW→panel report path works at all, which
// is the link a silent failure would hide behind.
step("assert the Physics panel reports vanilla");
out.coldVanilla = await waitForPanel(/vanilla/i, 90000);
out.coldNotPatched = !/patched/i.test(await physicsPanel());

// ── 3. Declared but not pasted ───────────────────────────────────────────────
step("add the mod WITHOUT its physics.json");
await addMod(null);
out.addedLoaded = await waitForSidebar(
  () => /mods:\s*✓ .*smoke-physics-mod/.test((document.querySelector('aside[aria-label="Mods"]')?.textContent ?? "")),
  30000,
);
// "declares a physics.json but none was pasted — the physics binary is [unchanged]".
// A physics mod that silently does nothing is the single most confusing outcome
// this feature can produce, so the gap must be named, by mod id.
out.physicsSkippedSurfaced = await waitForSidebar(
  () => /smoke-physics-mod[^]{0,120}declares[^]{0,40}physics\.json/i.test((document.querySelector('aside[aria-label="Mods"]')?.textContent ?? "")),
  20000,
);

// ── 4. A plan pinned to another build is refused ─────────────────────────────
step("re-add with a plan pinned to ANOTHER build, then reload");
await addMod(physicsJson(FOREIGN_PIN));
out.foreignRestartBanner = await waitForSidebar(() => /need a restart/.test((document.querySelector('aside[aria-label="Mods"]')?.textContent ?? "")), 20000);
await reloadAndSettle();

out.foreignRefused = await waitForPanel(/plan-refused/i, 120000);
const refusedPanel = await physicsPanel();
// The route's own words, not a paraphrase: the author needs to know it was the
// PIN that failed, because the fix (re-derive against this build) follows from
// that and from nothing else the panel could say.
out.foreignDetailNamesHash = /hash/i.test(refusedPanel);
// `plan-refused` and `vanilla` serve identical bytes and must stay tellable
// apart — collapsing them tells an author "nobody asked" when the truth is
// "we read what you sent and refused it".
out.foreignNotPatched = !/patched/i.test(refusedPanel);
out.foreignNotVanillaLabel = !/\bvanilla\b/i.test(refusedPanel);

// ── 5. A plan pinned to THIS build is applied ────────────────────────────────
step("re-add with a plan pinned to THIS build, then reload");
await addMod(physicsJson(liveHash));
out.goodRestartBanner = await waitForSidebar(() => /need a restart/.test((document.querySelector('aside[aria-label="Mods"]')?.textContent ?? "")), 20000);
await reloadAndSettle();

out.patched = await waitForPanel(/patched/i, 120000);
const patchedPanel = await physicsPanel();
out.patchedNamesTheFile = patchedPanel.includes(WASM_FILE);
// The count is the claim the player acts on, and the sentence that follows it
// is the disclosure the warn-only policy turns on.
out.patchedReportsCount = /1 constant rewritten/i.test(patchedPanel);
out.patchedDisclosesRisk = /not vanilla/i.test(patchedPanel);
// Warn-only (docs/design/safety-and-fairness.md): the set-wide safety row must
// WARN for a physics mod. It must not block, and there is no 'block' to reach —
// the assertion that matters is that the row is not silent or green.
out.safetyRowWarns = await waitForSidebar(
  () => /safety:\s*⚠ leaderboard risk/.test((document.querySelector('aside[aria-label="Mods"]')?.textContent ?? "")),
  30000,
);
// Captured HERE, not in the final report: leg 6 removes the mod, and the row
// correctly clears with it. Sampling it at the end would print "(none)" beside
// a passing assertion and read as a contradiction.
const safetyRow = (await sidebarText()).match(/safety:.*/)?.[0] ?? "(none)";
// The game must still be running on patched bytes. A binary the runtime refused
// to instantiate would be a worse outcome than an unpatched one, and it would
// otherwise be invisible here: the panel reports what the ROUTE did.
out.gameFrameSurvives = await page
  .waitForSelector('iframe[title="PolyTrack (proxied)"]', { timeout: 30000 })
  .then(() => true)
  .catch(() => false);
out.gameBooted = await waitForSidebar(
  () => /tracks:\s*✓ attached/.test((document.querySelector('aside[aria-label="Mods"]')?.textContent ?? "")),
  90000,
);

await page.screenshot({ path: SHOT });

// ── 6. Remove ────────────────────────────────────────────────────────────────
step("remove the mod");
// Reloads close the menu; the remove button is inside it.
if (await page.evaluate(() => /** @type {HTMLElement | null} */ (document.querySelector('aside[aria-label="Mods"]'))?.hidden ?? false)) {
  await page.click('.mods-btn');
  await page.waitForSelector('aside[aria-label="Mods"]:not([hidden])', { timeout: 10000 });
}
await page.click(`aside[aria-label="Mods"] li:has(code:text-is("${MOD_ID}")) button:has-text("remove")`);
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
  out.wasmServed === true &&
  out.pinCurrent === true &&
  out.targetDerived === true &&
  out.frameMounted === true &&
  out.initialLoadSettled === true &&
  out.coldVanilla === true &&
  out.coldNotPatched === true &&
  out.addedLoaded === true &&
  out.physicsSkippedSurfaced === true &&
  out.foreignRestartBanner === true &&
  out.foreignRefused === true &&
  out.foreignDetailNamesHash === true &&
  out.foreignNotPatched === true &&
  out.foreignNotVanillaLabel === true &&
  out.goodRestartBanner === true &&
  out.patched === true &&
  out.patchedNamesTheFile === true &&
  out.patchedReportsCount === true &&
  out.patchedDisclosesRisk === true &&
  out.safetyRowWarns === true &&
  out.gameFrameSurvives === true &&
  out.gameBooted === true &&
  out.storageCleared === true;

console.log(
  JSON.stringify(
    {
      PASS,
      verdict: out,
      physicsPanel: patchedPanel.slice(0, 400),
      safetyRow,
      pageErrors: pageErrors.slice(0, 5),
      shot: SHOT,
    },
    null,
    2,
  ),
);

await browser.close();
process.exit(PASS ? 0 : 1);

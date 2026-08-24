// Headless proof for the custom-tracks registry IN THE PORTAL (#36): using only the
// public `api.tracks` surface a mod gets, does a track land in the player's real
// "Custom tracks" list — and come back out cleanly?
//
//   TSPML_TRANSFORM=1 pnpm --filter @tspml/portal dev    # in one terminal (:3000)
//   pnpm --filter @tspml/portal smoke:tracks             # in another
//
// PASS requires: both shared capture patches landed and the registry attached; a
// register() with a real import code succeeded; the track appears in the GAME's own
// list; an invalid code is a typed 'invalid-code' failure (not a throw); and
// unregister removes it again.
//
// This is the portal twin of environments/dev-harness/scripts/smoke-tracks.mjs, with
// one structural difference: the harness exposes a dev-only `window.__tspmlDev` for
// inspection, and the portal deliberately ships no such hook — so this script reads
// the captured game objects off `api.tracks`'s own host instead (see readHost).
//
// Two things come from the game rather than api.tracks, deliberately: the game's own
// track list (checking OUR mirror would prove nothing) and a real PolyTrack2 code (the
// codec is the game's, so the honest way to get one is to export a track it already
// has). Everything a mod does goes through api.tracks.
import { chromium } from "playwright";

const BASE_URL = process.env.SMOKE_URL ?? "http://localhost:3000";
// The play surface. `/` is the launcher now; BASE_URL stays an origin because
// other requests in this file are origin-relative.
const PLAY_URL = `${BASE_URL}/play`;
const SHOT = process.env.SMOKE_SHOT ?? "/tmp/tspml-portal-tracks-smoke.png";
const NAME = "TSPML Smoke Track";
const FRAME_SELECTOR = 'iframe[title="PolyTrack (proxied)"]';

// Every step is time-boxed and announced. A smoke that hangs tells you nothing and
// blocks CI; one that fails at a named stage tells you exactly where to look.
const step = (msg) => process.stderr.write(`smoke:tracks · ${msg}\n`);
async function stage(name, promise, ms = 20000) {
  step(name);
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_r, reject) => {
        timer = setTimeout(() => reject(new Error(`stage timed out after ${ms}ms`)), ms);
      }),
    ]);
  } catch (e) {
    const detail = String(e && e.message ? e.message : e).slice(0, 200);
    step(`  ✗ ${name}: ${detail}`);
    return { __stageError: detail };
  } finally {
    clearTimeout(timer);
  }
}
const failed = (v) => !!(v && typeof v === "object" && v.__stageError);

/**
 * Source for page.evaluate: the captured game objects, reached through the registry.
 *
 * `host` is TypeScript-`private`, i.e. compile-time only — readable at runtime. That
 * coupling is deliberate and contained to this smoke: the alternative is shipping a
 * dev-only inspection hook into the product bundle, which is worse. If this breaks
 * after a Tracks refactor, fix it here.
 */
const readHost = `(() => {
  const w = document.querySelector(${JSON.stringify(FRAME_SELECTOR)})?.contentWindow;
  return w?.__tspml?.tracks?.host ?? null;
})()`;

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

step(`goto ${PLAY_URL}`);
await page.goto(PLAY_URL, { waitUntil: "domcontentloaded", timeout: 60000 });

// The portal mounts the game only once the service worker CONTROLS the page (issue
// #9). On a cold profile the SW registers but isn't the controller yet, so the first
// load may show no iframe at all — one reload fixes it.
step("wait for the game iframe (reloading once if the SW isn't controlling yet)");
let frameEl = await page.waitForSelector(FRAME_SELECTOR, { timeout: 30000 }).catch(() => null);
if (!frameEl) {
  step("  no iframe — reloading for SW control");
  await page.reload({ waitUntil: "domcontentloaded" });
  frameEl = await page.waitForSelector(FRAME_SELECTOR, { timeout: 45000 }).catch(() => null);
}

// The TrackManager capture fires when the game builds its track-selection UI, well
// after boot. Poll the sidebar rather than sleeping a flat interval: usually much
// faster, and a stall is named instead of silent.
const attached = await stage(
  "wait for the capture patches (tracks: ✓ attached)",
  page.waitForFunction(() => (document.querySelector('aside[aria-label="Mods"]')?.textContent ?? "").includes("tracks: ✓ attached"), undefined, {
    timeout: 90000,
    polling: 500,
  }),
  95000,
);
await page.screenshot({ path: SHOT });

// Which captures arrived pre-bridge? Not a pass/fail (it depends on game timing), but
// the reason EARLY_CAPTURE_SCRIPT_TAG must be injected: the codec normally lands here,
// before the page's frame-`load` handler installs the real bridge.
const captures = await stage(
  "which captures arrived pre-bridge?",
  page.evaluate(`(() => {
    const w = document.querySelector(${JSON.stringify(FRAME_SELECTOR)})?.contentWindow;
    const early = w?.__tspmlEarly;
    return {
      ready: !!w?.__tspml?.tracks?.ready,
      earlyStubPresent: !!early,
      earlyManager: !!early?.manager,
      earlyCodec: !!early?.codec,
    };
  })()`),
  10000,
);

// A real import code, minted by the game's own codec (loads a track — allow longer).
const code = await stage(
  "mint a real import code",
  page.evaluate(
    `(async () => {
      const host = ${readHost};
      const mgr = host?.manager;
      if (typeof mgr?.forEachOfficialTrack !== "function") return null;
      const loaders = [];
      mgr.forEachOfficialTrack((_id, _g, _m, _e, load) => loaders.push(load));
      if (!loaders.length) return null;
      const loaded = await loaders[0]();
      const data = loaded?.trackData ?? loaded;
      if (typeof data?.toExportString !== "function") return null;
      return data.toExportString({ name: ${JSON.stringify(NAME)}, author: "smoke", lastModified: null });
    })()`,
  ),
  45000,
);

const out = {
  attached: !failed(attached),
  captures,
  codeOk: typeof code === "string" && code.startsWith("PolyTrack2"),
};

if (out.codeOk) {
  const listGameNames = () =>
    stage(
      "read the game's custom-track list",
      page.evaluate(`(() => {
        const names = [];
        ${readHost}?.manager?.forEachCustomTrack((_id, meta) => names.push(meta?.name));
        return names;
      })()`),
    );

  // Everything below is exactly what a MOD can do: api.tracks and nothing else.
  const modCall = (label, fn, arg) =>
    stage(
      label,
      page.evaluate(
        ([selector, f, a]) => {
          const t = document.querySelector(selector)?.contentWindow?.__tspml?.tracks;
          if (!t) return { error: "no api.tracks on the bridge" };
          return t[f](a);
        },
        [FRAME_SELECTOR, fn, arg],
      ),
    );

  out.register = await modCall("register a track", "register", {
    code,
    name: NAME,
    author: "smoke",
  });
  out.modList = await modCall("api.tracks.list()", "list", undefined);
  out.gameList = await listGameNames();
  out.inGameList = Array.isArray(out.gameList) && out.gameList.includes(NAME);

  // An invalid code must be a TYPED failure, not a throw — a mod's bad input cannot
  // be allowed to break the game.
  out.invalid = await modCall("reject an invalid code", "register", {
    code: "not-a-polytrack-code",
    name: `${NAME} (invalid)`,
    author: "smoke",
  });

  out.unregistered = await modCall("unregister", "unregister", NAME);
  out.gameListAfter = await listGameNames();
  out.goneFromGameList = Array.isArray(out.gameListAfter) && !out.gameListAfter.includes(NAME);
}

const PASS =
  out.attached === true &&
  out.captures?.ready === true &&
  out.codeOk === true &&
  out.register?.ok === true &&
  out.inGameList === true &&
  out.invalid?.ok === false &&
  out.invalid?.reason === "invalid-code" &&
  out.unregistered === true &&
  out.goneFromGameList === true;

console.log(
  JSON.stringify(
    {
      PASS,
      verdict: out,
      trackLogs: consoleMsgs.filter((m) => m.toLowerCase().includes("tspml")).slice(0, 8),
      pageErrors: pageErrors.slice(0, 5),
      shot: SHOT,
    },
    null,
    2,
  ),
);

await browser.close();
process.exit(PASS ? 0 : 1);

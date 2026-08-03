// Headless proof for the custom-tracks registry (#12): using ONLY the public
// `api.tracks` surface a mod gets, does a track land in the player's real
// "Custom tracks" list — and come back out cleanly?
//
//   pnpm --filter @tspml/dev-harness dev          # in one terminal (serves :5173)
//   pnpm --filter @tspml/dev-harness smoke:tracks # in another
//
// PASS requires: the bridge patches captured the game's TrackManager + codec and the
// registry attached; register() with a real import code succeeded; the track appears
// in the GAME's own list; an invalid code is a typed 'invalid-code' failure (not a
// throw); a name collision is refused; overwrite works when asked; and unregister
// removes it from the game's list.
//
// Two things come from window.__tspmlDev rather than api.tracks, deliberately: the
// game's own track list (checking OUR mirror would prove nothing) and a real
// PolyTrack2 code (the codec is the game's, so the honest way to get one is to
// export a track the game already has). Everything a mod does goes through api.tracks.
import { chromium } from "playwright";

const BASE_URL = process.env.SMOKE_URL ?? "http://localhost:5173";
const SHOT = process.env.SMOKE_SHOT ?? "/tmp/tspml-tracks-smoke.png";
const NAME = "TSPML Smoke Track";

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

const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader-webgl", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const consoleMsgs = [];
const pageErrors = [];
page.on("console", (m) => consoleMsgs.push(`${m.type()}: ${m.text().slice(0, 200)}`));
page.on("pageerror", (e) => pageErrors.push(String(e && e.message ? e.message : e).slice(0, 300)));

step(`goto ${BASE_URL}`);
await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 30000 });

step("wait for the game iframe");
let gameFrame = null;
for (let i = 0; i < 60 && !gameFrame; i++) {
  gameFrame = page.frames().find((f) => f !== page.mainFrame() && f.url().includes("/game")) ?? null;
  if (!gameFrame) await page.waitForTimeout(300);
}
gameFrame = gameFrame ?? page.mainFrame();

// The capture patches fire when the game builds its track-selection UI. Poll for the
// registry rather than sleeping a flat 35s: usually much faster, and a stall is named.
step("wait for the capture patches (tracksReady)");
for (let i = 0; i < 150; i++) {
  const ready = await page.evaluate(() => window.__tspmlDev?.tracksReady === true).catch(() => false);
  if (ready) break;
  await page.waitForTimeout(400);
}
await page.screenshot({ path: SHOT });

// Did BOTH capture patches land and the registry attach? (top frame — src/main.ts)
const attached = await stage(
  "registry attached?",
  page.evaluate(() => window.__tspmlDev?.tracksReady === true),
  10000,
);

// A real import code, minted by the game's own codec (loads a track — allow longer).
const code = await stage(
  "mint a real import code",
  page.evaluate(([n]) => window.__tspmlDev?.sampleTrackCode?.(n, "smoke") ?? null, [NAME]),
  45000,
);

const out = {
  attached: attached === true,
  codeOk: typeof code === "string" && code.startsWith("PolyTrack2"),
};

if (out.codeOk) {
  const listNames = () =>
    stage("read the game's custom-track list", page.evaluate(() => window.__tspmlDev?.gameCustomTrackNames?.() ?? null));
  // Everything below is exactly what a MOD can do: api.tracks and nothing else.
  const modCall = (label, fn, arg) =>
    stage(
      label,
      gameFrame.evaluate(
        ([f, a]) => {
          const t = window.__tspml?.tracks;
          if (!t) return { error: "no api.tracks on the bridge" };
          return t[f](a);
        },
        [fn, arg],
      ),
    );

  out.register = await modCall("register a track", "register", { code, name: NAME, author: "smoke" });
  out.modList = await modCall("api.tracks.list()", "list", undefined);
  out.gameList = await listNames();
  out.inGameList = Array.isArray(out.gameList) && out.gameList.includes(NAME);

  // Invalid code must be a typed failure, not a throw.
  out.invalid = await modCall("reject an invalid code", "register", { code: "definitely-not-a-track-code" });
  // A second register of the same name must be refused, not silently clobber.
  out.collision = await modCall("refuse a name collision", "register", { code, name: NAME });
  // Overwrite must be opt-in — and work.
  out.overwrite = await modCall("overwrite when asked", "register", {
    code,
    name: NAME,
    author: "smoke2",
    overwrite: true,
  });

  out.unregistered = await modCall("unregister", "unregister", NAME);
  out.gameListAfter = await listNames();
  out.goneFromGameList = Array.isArray(out.gameListAfter) && !out.gameListAfter.includes(NAME);
} else {
  out.codeSample = typeof code === "string" ? code.slice(0, 40) : code;
}

const pass =
  !Object.values(out).some(failed) &&
  out.attached === true &&
  out.codeOk === true &&
  out.register?.ok === true &&
  out.inGameList === true &&
  out.invalid?.ok === false &&
  out.invalid?.reason === "invalid-code" &&
  out.collision?.ok === false &&
  out.collision?.reason === "name-exists" &&
  out.overwrite?.ok === true &&
  out.unregistered === true &&
  out.goneFromGameList === true;

console.log(
  JSON.stringify(
    {
      PASS: pass,
      verdict: {
        registryAttached: out.attached,
        sampleCodeMinted: out.codeOk,
        registered: out.register?.ok ?? false,
        appearsInGameList: out.inGameList ?? false,
        invalidCodeRejected: out.invalid?.reason ?? null,
        collisionRefused: out.collision?.reason ?? null,
        overwriteWorked: out.overwrite?.ok ?? false,
        unregistered: out.unregistered ?? false,
        goneFromGameList: out.goneFromGameList ?? false,
      },
      detail: out,
      trackLogs: consoleMsgs.filter((l) => l.toLowerCase().includes("tspml")).slice(0, 6),
      pageErrors: pageErrors.slice(0, 6),
      shot: SHOT,
    },
    null,
    2,
  ),
);

await browser.close();
process.exit(pass ? 0 : 1);

// Headless proof for the audio registry IN THE PORTAL (#11): using only the public
// `api.audio` surface a mod gets, does a mod-supplied clip actually replace one of the
// game's sounds where the GAME looks for it — and come back out cleanly?
//
//   TSPML_TRANSFORM=1 pnpm --filter @tspml/portal dev    # in one terminal (:3000)
//   pnpm --filter @tspml/portal smoke:audio              # in another
//
// PASS requires: the capture patch handed over the game's audio manager and the registry
// attached; register() with a real (synthesized) clip succeeded and reports the decoded
// duration; the GAME's own getBuffer(key) returns THAT clip, not its original; an
// undecodable payload is a typed 'decode-failed' failure rather than a throw; a mod-vs-mod
// key collision is refused unless overwrite is set; a new key is additive; and unregister
// restores the game's ORIGINAL clip (not null).
//
// This is the portal twin of environments/dev-harness/scripts/smoke-audio.mjs, with the
// same structural difference the tracks pair has: the harness exposes a dev-only
// `window.__tspmlDev` for inspection, and the portal deliberately ships no such hook — so
// this script reads the captured audio manager off `api.audio`'s own host instead (see
// readManager).
//
// The clip is synthesized in-page as a WAV blob — no network, no committed binary, and a
// duration we choose, which is what makes "did the override land" checkable by value
// rather than by vibe.
import { chromium } from "playwright";

const BASE_URL = process.env.SMOKE_URL ?? "http://localhost:3000";
const SHOT = process.env.SMOKE_SHOT ?? "/tmp/tspml-portal-audio-smoke.png";
const FRAME_SELECTOR = 'iframe[title="PolyTrack (proxied)"]';
// Override one of the game's REAL clips, so a pass means a game sound changed.
const KEY = "click";
const NEW_KEY = "tspml.smoke.horn";
/** Synthesized clip length. Distinct from any real game clip so it is unmistakable. */
const SECONDS = 0.37;

const step = (msg) => process.stderr.write(`smoke:audio · ${msg}\n`);
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
/** Float compare — decoders resample, so the duration lands close, not exact. */
const near = (a, b, tol = 0.05) => typeof a === "number" && Math.abs(a - b) < tol;

/**
 * Source for page.evaluate: the captured audio manager, reached through the registry.
 *
 * `host` is TypeScript-`private`, i.e. compile-time only — readable at runtime. Same
 * deliberate, contained coupling as the tracks smoke: the alternative is shipping a
 * dev-only inspection hook into the product bundle, which is worse. If this breaks after
 * an Audio refactor, fix it here.
 *
 * Note this really is the GAME's lookup: the registry shadows `getBuffer` as an own
 * property of the captured instance, and the game calls `this.getBuffer(key)` — so the
 * method reached here is the one the game reaches.
 */
const readManager = `(() => {
  const w = document.querySelector(${JSON.stringify(FRAME_SELECTOR)})?.contentWindow;
  return w?.__tspml?.audio?.host?.manager ?? null;
})()`;

const browser = await chromium.launch({
  headless: true,
  args: [
    "--use-gl=angle",
    "--use-angle=swiftshader-webgl",
    "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist",
    // Let the AudioContext start without a user gesture: decodeAudioData needs a
    // RUNNING context, and a headless page never clicks anything.
    "--autoplay-policy=no-user-gesture-required",
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const consoleMsgs = [];
const pageErrors = [];
page.on("console", (m) => consoleMsgs.push(`${m.type()}: ${m.text().slice(0, 200)}`));
page.on("pageerror", (e) => pageErrors.push(String(e && e.message ? e.message : e).slice(0, 300)));

step(`goto ${BASE_URL}`);
await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });

// The portal mounts the game only once the service worker CONTROLS the page (issue #9).
// On a cold profile the SW registers but isn't the controller yet, so the first load may
// show no iframe at all — one reload fixes it.
step("wait for the game iframe (reloading once if the SW isn't controlling yet)");
let frameEl = await page.waitForSelector(FRAME_SELECTOR, { timeout: 30000 }).catch(() => null);
if (!frameEl) {
  step("  no iframe — reloading for SW control");
  await page.reload({ waitUntil: "domcontentloaded" });
  frameEl = await page.waitForSelector(FRAME_SELECTOR, { timeout: 45000 }).catch(() => null);
}

// The capture fires when the game builds its track-selection UI, well after boot. Poll the
// sidebar rather than sleeping a flat interval: a stall is then named instead of silent.
const attached = await stage(
  "wait for the capture patch (audio: ✓ attached)",
  page.waitForFunction(() => document.body.innerText.includes("audio: ✓ attached"), undefined, {
    timeout: 90000,
    polling: 500,
  }),
  95000,
);
await page.screenshot({ path: SHOT });

/** The game frame, where a mod's clip URL has to be fetchable from. */
const gameFrame =
  page.frames().find((f) => f !== page.mainFrame() && f.url().includes("/api/proxy")) ??
  page.mainFrame();

/** Build a mono 8-bit PCM WAV of `seconds` as a blob: URL, inside the GAME frame. */
const makeClip = (seconds) =>
  stage(
    "synthesize a clip in the game frame",
    gameFrame.evaluate((secs) => {
      const rate = 8000;
      const samples = Math.round(rate * secs);
      const buf = new ArrayBuffer(44 + samples);
      const view = new DataView(buf);
      const ascii = (off, s) => {
        for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
      };
      ascii(0, "RIFF");
      view.setUint32(4, 36 + samples, true);
      ascii(8, "WAVE");
      ascii(12, "fmt ");
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true); // PCM
      view.setUint16(22, 1, true); // mono
      view.setUint32(24, rate, true);
      view.setUint32(28, rate, true); // byte rate (8-bit mono)
      view.setUint16(32, 1, true);
      view.setUint16(34, 8, true);
      ascii(36, "data");
      view.setUint32(40, samples, true);
      // A quiet ramp — audible content, but nothing that would blast a listener.
      for (let i = 0; i < samples; i++) {
        view.setUint8(44 + i, 128 + Math.round(20 * Math.sin((i / rate) * 440 * 2 * Math.PI)));
      }
      return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
    }, seconds),
    15000,
  );

const out = { attached: !failed(attached) };

// Everything below is exactly what a MOD can do: api.audio and nothing else.
const modCall = (label, fn, arg) =>
  stage(
    label,
    page.evaluate(
      ([selector, f, a]) => {
        const audio = document.querySelector(selector)?.contentWindow?.__tspml?.audio;
        if (!audio) return { error: "no api.audio on the bridge" };
        return audio[f](a);
      },
      [FRAME_SELECTOR, fn, arg],
    ),
    30000,
  );

/** Ask the GAME's own lookup what it holds for a key — our mirror proves nothing. */
const gameDuration = (key) =>
  stage(
    `game getBuffer(${key})`,
    page.evaluate(
      `(() => {
        const buffer = ${readManager}?.getBuffer(${JSON.stringify(key)});
        return buffer ? buffer.duration : null;
      })()`,
    ),
    10000,
  );

if (out.attached) {
  // The game loaded 'click' at boot, so there IS an original to displace and restore.
  out.originalDuration = await gameDuration(KEY);

  const url = await makeClip(SECONDS);
  out.clipMade = typeof url === "string" && url.startsWith("blob:");

  if (out.clipMade) {
    out.register = await modCall("override a game sound", "register", { key: KEY, url });
    // THE assertion: the game's own lookup now answers with the mod's clip.
    out.overriddenDuration = await gameDuration(KEY);
    out.overrideLanded = near(out.overriddenDuration, SECONDS);

    out.modList = await modCall("api.audio.list()", "list", undefined);

    // A new key is additive, and reported as not replacing a builtin.
    out.additive = await modCall("register a new key", "register", { key: NEW_KEY, url });
    out.additiveDuration = await gameDuration(NEW_KEY);

    // Undecodable bytes must be a typed failure, not a throw.
    const badUrl = await stage(
      "make an undecodable payload",
      gameFrame.evaluate(() =>
        URL.createObjectURL(new Blob([new Uint8Array([1, 2, 3, 4, 5])], { type: "audio/wav" })),
      ),
      10000,
    );
    out.badDecode = await modCall("reject undecodable bytes", "register", {
      key: "engine",
      url: badUrl,
    });

    // A second register of the same key must be refused, not silently clobber.
    out.collision = await modCall("refuse a key collision", "register", { key: KEY, url });
    // Overwrite must be opt-in — and work.
    out.overwrite = await modCall("overwrite when asked", "register", {
      key: KEY,
      url,
      overwrite: true,
    });

    // unregister must restore the GAME's original clip, not leave a hole.
    out.unregistered = await modCall("unregister", "unregister", KEY);
    out.restoredDuration = await gameDuration(KEY);
    out.restored =
      near(out.restoredDuration, out.originalDuration) && !near(out.restoredDuration, SECONDS);
  }
}

const PASS =
  !Object.values(out).some(failed) &&
  out.attached === true &&
  out.clipMade === true &&
  out.register?.ok === true &&
  out.register?.replacedBuiltin === true &&
  near(out.register?.duration, SECONDS) &&
  out.overrideLanded === true &&
  out.additive?.ok === true &&
  out.additive?.replacedBuiltin === false &&
  near(out.additiveDuration, SECONDS) &&
  out.badDecode?.ok === false &&
  out.badDecode?.reason === "decode-failed" &&
  out.collision?.ok === false &&
  out.collision?.reason === "key-exists" &&
  out.overwrite?.ok === true &&
  out.unregistered === true &&
  out.restored === true;

console.log(
  JSON.stringify(
    {
      PASS,
      verdict: {
        registryAttached: out.attached ?? false,
        clipSynthesized: out.clipMade ?? false,
        registered: out.register?.ok ?? false,
        reportedBuiltinReplacement: out.register?.replacedBuiltin ?? null,
        // The load-bearing one: the game's OWN lookup serves the mod's clip.
        gameServesModClip: out.overrideLanded ?? false,
        gameOriginalSeconds: out.originalDuration ?? null,
        gameAfterOverrideSeconds: out.overriddenDuration ?? null,
        additiveKeyWorked: out.additive?.ok ?? false,
        undecodableRejected: out.badDecode?.reason ?? null,
        collisionRefused: out.collision?.reason ?? null,
        overwriteWorked: out.overwrite?.ok ?? false,
        unregistered: out.unregistered ?? false,
        originalRestored: out.restored ?? false,
        gameAfterUnregisterSeconds: out.restoredDuration ?? null,
      },
      detail: out,
      audioLogs: consoleMsgs.filter((l) => l.toLowerCase().includes("tspml")).slice(0, 6),
      pageErrors: pageErrors.slice(0, 6),
      shot: SHOT,
    },
    null,
    2,
  ),
);

await browser.close();
process.exit(PASS ? 0 : 1);

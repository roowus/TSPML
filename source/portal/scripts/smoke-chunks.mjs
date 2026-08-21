// Headless proof for the CHUNK SURFACES (#98) at the HTTP boundary — the one
// thing no other smoke touches, and the reason a bodyless 500 reached
// production (#106, tracked as #107).
//
//   TSPML_TRANSFORM=1 pnpm --filter @tspml/portal dev  # in one terminal (:3000)
//   pnpm --filter @tspml/portal smoke:chunks           # in another
//
// No browser. The game lazy-loads chunks, so driving one through the proxy from
// a real page means racing whatever UI happens to trigger the load — the track
// editor for 112, and nothing at all for the chunks the game may never fetch in
// a smoke session. Requesting them directly covers every declared chunk
// deterministically. What is lost is "the game actually used it", which the
// boot/tracks/audio smokes already establish for the main surface.
//
// TSPML_TRANSFORM=1 IS REQUIRED, and unlike smoke:ui that is not incidental.
// With it unset `transformSurface` returns null for everything, the route is a
// pure pass-through, and NO `x-tspml-*` header is set at all — so every
// assertion below would be vacuous rather than failing. This is exactly how a
// green Vercel preview deploy failed to catch #106: a header that is never set
// cannot throw. The script therefore refuses to report PASS unless it has seen
// the main surface transform, which is the proof the env is really on.
//
// WHAT THIS ASSERTS, per declared chunk:
//   1. HTTP 200 with a non-empty body — the #106 regression was 500 + 0 bytes;
//   2. `x-tspml-surface: chunk:<id>` — it was recognised as a surface, not
//      quietly passed through as an unknown file, which would also give a 200;
//   3. the served bytes are the RIGHT bytes, which since #87 means two different
//      things depending on the chunk — see the note below;
//   4. `x-tspml-detail` is present and pure printable ASCII. A header value is
//      a ByteString; the detail is house-style prose containing em-dashes, and
//      `Headers.set` throws above U+00FF. The throw is the bug, so the fact
//      that a response arrived at all is most of the assertion — but the ASCII
//      check is what fails if someone sanitizes on a path that only *some*
//      details take.
//
// ON ASSERTION 3, AND WHY IT IS NOT ONE RULE. Until #87 every declared chunk had
// an empty base, so every chunk was served byte-identical to its pin and one
// hash comparison covered them all. Chunk 112 now carries the editor capture
// patches, so a HEALTHY response for it is transformed bytes that DIFFER from
// the pin — the pin describes what came off the CDN, not what we serve. Keeping
// the old rule would fail on correct behaviour; dropping it would stop checking
// the bytes at all. So the rule branches on the surface's own
// `x-tspml-transformed` header:
//
//   transformed=0 → served bytes MUST equal the pin (untouched pass-through);
//   transformed=1 → served bytes MUST NOT equal the pin (something really ran),
//                   and the body must still parse as JavaScript.
//
// The parse is what makes the transformed branch worth anything. "Different from
// the pin" is satisfied by truncation and by garbage, and a chunk that arrives
// as 200 + non-empty + corrupt is exactly the failure the hash check used to
// catch for free.
//
// Which chunks transform is read from the map and the response, never asserted
// from a literal id — a PolyTrack release can renumber chunks, and #87's own
// notes are explicit that 112 moves when it does.
//
// The chunk ids come from the map, never a literal: `112` is build-specific and
// will not survive a PolyTrack release. Hardcoding it would turn this into a
// false alarm on the next release, which is the failure mode the canary job
// exists to prevent.
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
/** The same pinned map the proxy transforms against (lib/demo-transform.ts). */
const MAP = require('@tspml/mappings/maps/polytrack-0.6.2.json');

const BASE_URL = process.env.SMOKE_URL ?? 'http://localhost:3000';
const VERSION = MAP.gameVersion;

const step = (msg) => process.stderr.write(`smoke:chunks · ${msg}\n`);

/** Printable ASCII only. Control characters count as violations: a CR/LF in a
 *  header value could append headers of its own. */
const isPrintableAscii = (s) => /^[\x20-\x7E]*$/.test(s);

const sha256 = (buf) => `sha256:${createHash('sha256').update(buf).digest('hex')}`;

/**
 * Does the served body still parse as JavaScript?
 *
 * `new Function` compiles without executing, which is the point: this is game
 * code, and running it here would be both wrong and unsurvivable outside a
 * browser. It is a syntax check only — it catches the truncation and brace
 * damage a bad inject produces, not a semantic break.
 */
function parsesAsJs(source) {
  try {
    // eslint-disable-next-line no-new-func
    new Function(source);
    return true;
  } catch {
    return false;
  }
}

/** Fetch one proxied bundle file and report everything the assertions need. */
async function fetchSurface(file) {
  const res = await fetch(`${BASE_URL}/api/proxy/${file}?version=${VERSION}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return {
    status: res.status,
    bytes: buf.length,
    hash: sha256(buf),
    body: buf.toString('utf8'),
    surface: res.headers.get('x-tspml-surface'),
    transformed: res.headers.get('x-tspml-transformed'),
    detail: res.headers.get('x-tspml-detail'),
  };
}

const out = { chunks: {} };

// The env guard. Checked FIRST and reported separately from the chunk results,
// so a run with TSPML_TRANSFORM unset reads as "the smoke could not test
// anything" rather than as a chunk regression.
step(`main.bundle.js — confirming the transform is actually enabled`);
const main = await fetchSurface('main.bundle.js');
out.mainSurface = main.surface;
out.mainTransformed = main.transformed;
out.transformEnabled = main.surface === 'main' && main.transformed === '1';
if (!out.transformEnabled) {
  step(`  !! main surface=${main.surface} transformed=${main.transformed}`);
  step(`  !! the server is not running with TSPML_TRANSFORM=1 — chunk assertions would be vacuous`);
}
// The main detail is long, house-style prose listing every applied patch. It
// crosses the same boundary, so it is held to the same rule.
out.mainDetailAscii = typeof main.detail === 'string' && isPrintableAscii(main.detail);

const declared = Object.keys(MAP.chunks ?? {});
step(`map declares ${declared.length} chunk(s): ${declared.join(', ')}`);
out.declaredCount = declared.length;

for (const id of declared) {
  const file = `${id}.bundle.js`;
  const pin = MAP.chunks[id].hash;
  step(`${file} (${MAP.chunks[id].role ?? 'unknown role'})`);
  const r = await fetchSurface(file);
  const wasTransformed = r.transformed === '1';
  const verdict = {
    status: r.status,
    bytes: r.bytes,
    surface: r.surface,
    transformed: r.transformed,
    detail: r.detail,
    ok200: r.status === 200,
    nonEmpty: r.bytes > 0,
    recognised: r.surface === `chunk:${id}`,
    // An untouched chunk must be byte-identical to the pin; a transformed one
    // must not be, or nothing ran. Both directions are real failures.
    bytesCorrect: wasTransformed ? r.hash !== pin : r.hash === pin,
    // Only meaningful on the transformed branch, where "differs from the pin"
    // alone would also accept truncation and corruption.
    parses: wasTransformed ? parsesAsJs(r.body) : null,
    detailPresent: typeof r.detail === 'string' && r.detail.length > 0,
    detailAscii: typeof r.detail === 'string' && isPrintableAscii(r.detail),
  };
  if (!verdict.bytesCorrect) {
    // Worth printing both. Untouched: either drift (the game shipped a new
    // build, canary is red too) or the proxy serving the wrong bytes.
    // Transformed: the base silently failed and the chunk fell back to vanilla,
    // which looks identical to a healthy pass-through from the outside — this
    // comparison is the only thing that tells them apart.
    step(`  !! transformed=${r.transformed}`);
    step(`  !! hash ${r.hash}`);
    step(`  !! pin  ${pin}`);
  }
  if (verdict.parses === false) step(`  !! transformed body does not parse as JavaScript`);
  if (!verdict.ok200) step(`  !! HTTP ${r.status} with ${r.bytes} byte(s)`);
  if (!verdict.detailAscii) step(`  !! non-ASCII detail: ${JSON.stringify(r.detail)}`);
  out.chunks[id] = verdict;
}

// At least one declared chunk must actually transform. Without this the whole
// suite passes on a build where every base silently failed: each chunk would
// then match its pin, take the untouched branch, and report a clean green — the
// same shape of vacuous pass the TSPML_TRANSFORM guard above exists to prevent.
out.transformedChunks = Object.entries(out.chunks)
  .filter(([, c]) => c.transformed === '1')
  .map(([id]) => id);
const someChunkTransformed = out.transformedChunks.length > 0;
if (!someChunkTransformed) {
  step(`  !! no declared chunk transformed — the editor base (#87) is not running`);
}

const everyChunkOk =
  declared.length > 0 &&
  Object.values(out.chunks).every(
    (c) =>
      c.ok200 &&
      c.nonEmpty &&
      c.recognised &&
      c.bytesCorrect &&
      c.parses !== false &&
      c.detailPresent &&
      c.detailAscii,
  );

const PASS =
  out.transformEnabled === true &&
  out.mainDetailAscii === true &&
  someChunkTransformed === true &&
  everyChunkOk === true;

console.log(JSON.stringify({ PASS, verdict: out }, null, 2));
process.exit(PASS ? 0 : 1);

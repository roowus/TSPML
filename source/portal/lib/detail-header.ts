/**
 * @tspml/portal — put a transform `detail` on a response as `x-tspml-detail`.
 *
 * An HTTP header value is a ByteString. `Headers.set` THROWS a TypeError on any code
 * point above 255, and inside a route handler that throw is an empty-bodied 500 — the
 * response fails because of the one line whose only job was to explain it.
 *
 * The details are prose written for a maintainer reading `curl -I`, so they carry the
 * punctuation prose carries: em-dashes, `≠`, and the `…` that `truncate()` appends.
 * That combination shipped broken in #98 and reached production: the zero-patch detail
 * ("no patches target <file> — served unmodified") is only reachable by a surface with
 * no base patches, and until chunks became surfaces nothing but main was ever proxied,
 * so no request had ever taken that branch.
 *
 * The rule this module encodes: a diagnostic must never be able to fail the response it
 * describes. Sanitize at the boundary rather than ASCII-fying the prose, so the same
 * strings stay readable in logs, tests, and the in-page report, and so a detail added
 * later cannot reintroduce the bug by containing an apostrophe.
 */

/** Cap matching the header's previous inline slice — keeps a long detail out of the
 *  response head without truncating anything a reader needs. */
const HEADER_DETAIL_CAP = 200;

/**
 * Transliterate `detail` to printable ASCII and set it as `x-tspml-detail`.
 *
 * Transliterate rather than drop, so `≠` and `—` stay legible as `!=` and `-`. Slice
 * AFTER transliterating, because transliteration can EXPAND: `…` becomes three
 * characters, so slicing first caps the input rather than the output and a detail of
 * 200 ellipses would emit a 600-character header. Control characters (including CR/LF,
 * which would otherwise let a detail forge a header break) fall through to `?`.
 */
export function setDetailHeader(headers: Headers, detail: string): void {
  const ascii = toHeaderAscii(detail);
  if (ascii) headers.set('x-tspml-detail', ascii.slice(0, HEADER_DETAIL_CAP));
}

/** The transliteration itself, exported so tests assert on the mapping directly. */
export function toHeaderAscii(detail: string): string {
  return (
    detail
      // U+2010..U+2015: hyphen, non-breaking hyphen, figure/en/em dash, horizontal bar.
      .replace(/[‐-―]/g, '-')
      .replace(/…/g, '...')
      .replace(/≠/g, '!=')
      .replace(/≤/g, '<=')
      .replace(/≥/g, '>=')
      .replace(/→/g, '->')
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      // Everything still outside printable ASCII, including control characters.
      .replace(/[^\x20-\x7E]/g, '?')
  );
}

/**
 * @tspml/shared — make a transform `detail` safe to put in an HTTP header.
 *
 * Every surface that proxies the game reports what its transform did in an
 * `x-tspml-detail` response header. An HTTP header value is a ByteString, so both
 * `Headers.set` (portal, extension) and Node's `res.setHeader` (dev harness) THROW on
 * any code point above 255 — and inside a request handler that throw is an
 * empty-bodied 500 on a request that had otherwise fully succeeded. The response dies
 * because of the one line whose only job was to explain it.
 *
 * The details are prose written for a maintainer reading `curl -I`, in a house style
 * that uses em-dashes, and the portal's `truncate()` appends `…` on top. So the throw
 * is not an edge case; it is the default for any detail long or descriptive enough.
 *
 * This shipped to production in #98. The portal's zero-patch detail ("no patches
 * target <file> — served unmodified") is only reachable by a surface with NO base
 * patches, and until chunks became surfaces every proxied surface was main.bundle.js,
 * which always has patches. The change that introduced the bug is the change that
 * first made it reachable. The dev harness carried the same defect on its
 * hash-mismatch path, where it would have surfaced on the next PolyTrack release.
 *
 * Lives here rather than in one surface because the transliteration is identical in
 * all of them — the stated bar for this package. What stays surface-specific is how
 * the header gets set (`Headers.set` vs `res.setHeader`) and the cap policy.
 */

/**
 * Transliterate `detail` to printable ASCII.
 *
 * Transliterate rather than drop, so `≠` and `—` stay legible as `!=` and `-`.
 * Anything still outside printable ASCII becomes `?`, which includes control
 * characters: details are built from map data and mod-supplied symbol names, so a
 * CR/LF passing through could append headers of its own.
 *
 * Callers that also cap the length must cap the RESULT, not the input:
 * transliteration expands (`…` becomes three characters), so capping first bounds the
 * wrong string.
 */
export function toHeaderAscii(detail: string): string {
  return (
    detail
      // U+2010..U+2015: hyphen, non-breaking hyphen, figure/en/em dash, horizontal bar.
      .replace(/[‐-―]/g, "-")
      .replace(/…/g, "...")
      .replace(/≠/g, "!=")
      .replace(/≤/g, "<=")
      .replace(/≥/g, ">=")
      .replace(/→/g, "->")
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[^\x20-\x7E]/g, "?")
  );
}

/** Cap every surface applies to `x-tspml-detail`, so a long detail cannot bloat the
 *  response head. Applied to the transliterated string, never the raw one. */
export const HEADER_DETAIL_CAP = 200;

/** `toHeaderAscii` + the shared cap: the exact value to hand a header setter, or ""
 *  when there is nothing worth reporting. */
export function headerDetail(detail: string): string {
  return toHeaderAscii(detail).slice(0, HEADER_DETAIL_CAP);
}

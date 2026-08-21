// chunk-pins.mjs — decide the `chunks` section of a generated map (#98).
//
// Extracted from gen-map.mjs so it can be tested at all. gen-map's own body only runs
// after a full 0.6.0 -> new-build match against the webcrack cache, which is gitignored
// and absent in CI; the chunk decision has nothing to do with matching, so leaving it
// in there meant the one branch that can silently disable every chunk transform was the
// one branch no test could reach.
//
// The decision itself is small and entirely about which of two bad-looking states you
// are in:
//   - fresh pins supplied (regen --chunks) -> pin them, carry only the human `role`
//     prose across, and name any chunk that appeared or vanished.
//   - no fresh pins -> carry the baseline's pins and SAY SO in generated.note. A carried
//     pin is not merely unverified like a carried target: it is a hash of the previous
//     build's bytes, so on a new version it CANNOT match, and a chunk whose pin does not
//     match serves vanilla without erroring. Nothing crashes; the transforms just stop.
//
// Pure: no filesystem, no env, no clock. Callers pass what they read.

/** @typedef {{id: string, hash: string, bytes: number, role: string}} ChunkPin */

/** Stamped onto `generated.note` when pins ride along from the baseline unverified.
 *  Exported so a test asserts on the same string the map carries, not a copy of it. */
export const CARRIED_NOTE =
  " `chunks` pins were CARRIED FORWARD unverified (no --chunks fetch this run) —" +
  " re-run with --chunks before promoting to a new game version.";

/** Role text for a chunk this build ships but the baseline never described. Deliberately
 *  not inherited from a neighbour: a wrong label is worse than an obvious blank. */
export const UNLABELLED_ROLE = "unreviewed — label this chunk's contents";

/**
 * Parse regen's `GEN_CHUNKS` env value (JSON `[{id, hash, bytes}, ...]`).
 *
 * Throws on anything malformed rather than falling back to the carry path. The fallback
 * is the dangerous direction: the caller set GEN_CHUNKS because it fetched fresh bytes,
 * so quietly emitting the PREVIOUS build's pins would look like a re-pin in every report
 * while shipping hashes that can never match.
 * @param {string | undefined} raw
 * @returns {{id: string|number, hash: string, bytes: number}[] | undefined}
 */
export function parseGenChunks(raw) {
  if (!raw) return undefined;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      "GEN_CHUNKS is set but is not valid JSON; refusing to emit a map whose chunk pins are not the ones the caller supplied",
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error(
      "GEN_CHUNKS is set but is not a JSON array of {id, hash, bytes}; refusing to emit a map whose chunk pins are not the ones the caller supplied",
    );
  }
  for (const c of parsed) {
    if (!c || typeof c.hash !== "string" || !c.hash || c.id === undefined || typeof c.bytes !== "number") {
      throw new Error(
        `GEN_CHUNKS entry is missing id/hash/bytes: ${JSON.stringify(c)}; refusing to emit a map whose chunk pins are not the ones the caller supplied`,
      );
    }
  }
  return parsed;
}

/**
 * @typedef {Object} ChunkDecision
 * @property {Record<string, ChunkPin> | undefined} chunks  the section to write, or
 *   undefined when neither a baseline nor a fetch supplied any (pre-#98 maps)
 * @property {string} noteSuffix  appended to `generated.note` ("" when freshly pinned)
 * @property {string} log         one stderr line (multi-line when it is a warning)
 * @property {boolean} carried    true when these are the previous build's hashes
 */

/**
 * Build the `chunks` section from the baseline's carried section and (optionally) this
 * run's fresh pins.
 * @param {Record<string, ChunkPin> | undefined} carried
 *   `chunks` from the committed baseline map. Typed as complete pins because the
 *   baseline is a committed map and `validateMap` rejects a partial chunk entry; a
 *   hand-edited one still round-trips unchanged on the carry path and gets its missing
 *   `role` filled in on the fresh path.
 * @param {{id: string|number, hash: string, bytes: number}[] | undefined} fresh
 *   fresh pins from this run's fetch (regen --chunks)
 * @param {string} [prevMapPath]  baseline path, for the log line only
 * @returns {ChunkDecision}
 */
export function resolveChunkPins(carried, fresh, prevMapPath = "the baseline map") {
  if (fresh && fresh.length > 0) {
    /** @type {Record<string, ChunkPin>} */
    const chunks = {};
    for (const c of fresh) {
      const id = String(c.id);
      // The `role` label is human-written prose no fetch can regenerate, so it is the
      // one field that crosses over.
      chunks[id] = { id, hash: c.hash, bytes: c.bytes, role: carried?.[id]?.role ?? UNLABELLED_ROLE };
    }
    const added = Object.keys(chunks).filter((id) => !carried?.[id]);
    const dropped = Object.keys(carried ?? {}).filter((id) => !chunks[id]);
    return {
      chunks,
      noteSuffix: "",
      carried: false,
      log:
        `chunks re-pinned from this fetch: ${Object.keys(chunks).length} entries` +
        (added.length ? `; NEW: ${added.join(", ")} (needs a role label)` : "") +
        (dropped.length ? `; GONE from this build: ${dropped.join(", ")}` : ""),
    };
  }
  if (carried && Object.keys(carried).length > 0) {
    return {
      chunks: carried,
      noteSuffix: CARRIED_NOTE,
      carried: true,
      log:
        `chunks carried forward UNVERIFIED: ${Object.keys(carried).length} entries from ${prevMapPath}\n` +
        `  WARNING: these are hashes of the PREVIOUS build's chunk bytes. If this is a new game version they cannot match,\n` +
        `  and every chunk will silently serve vanilla. Re-run regen with --chunks to re-pin them.`,
    };
  }
  // Neither side declared any. Emitting an empty `{}` would be a claim ("this build
  // splits nothing") that no one made; leaving the key off keeps the map pre-#98-shaped
  // and lets assertChunksCarried stay quiet about a baseline that never had chunks.
  return { chunks: undefined, noteSuffix: "", carried: false, log: "chunks: none declared by the baseline and none fetched" };
}

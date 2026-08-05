// select.mjs — pick a source module's target, lexically first and structurally only to
// break a tie. The single place that decision is made (#1).
//
// WHY THIS MODULE EXISTS AT ALL
//
// The scorer was written twice, verbatim: once in `match.mjs` (the measurement harness
// that reports the match rate) and once in `source/mappings/scripts/gen-map.mjs` (the
// generator that writes the map a mod actually resolves against). That duplication was
// tolerable while both were a fixed copy of the M1 spike — it is not tolerable now,
// because the whole claim of #1 is a *delta* between two rates. If the two copies could
// drift, the measured 0.848 -> 0.939 would be a statement about `match.mjs` and not
// about the map, and the number in the README would be unfalsifiable.
//
// So both now call `chooseTarget` here. The rate `match.mjs` reports is the rate the map
// was built at, by construction rather than by inspection.
//
// WHAT THE DECISION IS
//
// Lexical evidence (IDF-weighted shared anchors) decides, and structure is consulted only
// when lexical evidence cannot separate the leaders. See `fingerprint.mjs` for why that
// ordering is the right way round and not merely conservative: anchors are direct
// evidence about *this* module's content, structure is circumstantial.
//
// The absolute-evidence floor applies to the candidate finally CHOSEN, not to the lexical
// leader. A structural promotion swaps in a candidate with a lower lexical weight, and
// letting it inherit the leader's weight for gate purposes would quietly lower the bar for
// exactly the matches that are least certain. Measured: applying the floor to the chosen
// candidate costs nothing on the real pair (all six promotions clear it comfortably) and
// keeps "we had enough direct evidence" an invariant of every accepted match.

import { adjudicate, fingerprintSource } from "./fingerprint.mjs";

/** How many lexical leaders to carry into adjudication. */
export const DEFAULT_TOP_K = 6;

/**
 * A memoising fingerprint accessor keyed on module identity.
 *
 * Fingerprinting is the expensive half (~540 ms for all 421 modules) and every source
 * module scores against the same target corpus, so without memoisation the target side
 * would be re-parsed once per source module — ~200x the work. Keyed by object identity
 * via a WeakMap rather than by name, because the two corpora have overlapping names
 * (webpack reuses ids across versions) and a name-keyed cache would silently hand a
 * source module the target module's shape.
 *
 * @param {object} [parser] passed through to fingerprintSource (tests inject one)
 */
export function makeFpCache(parser) {
  const cache = new WeakMap();
  return (mod) => {
    if (cache.has(mod)) return cache.get(mod);
    // A module with no `code` cannot be fingerprinted; null is "no structural opinion",
    // which `similarity` already treats as 0. This keeps callers that do not load source
    // (or a corpus loaded before this module existed) working, lexically only.
    const fp = typeof mod.code === "string" ? fingerprintSource(mod.code, parser) : null;
    cache.set(mod, fp);
    return fp;
  };
}

/**
 * The top-K lexical candidates for one source module, descending by weight.
 *
 * A full sort of the target corpus per source module would be O(n log n) on ~200 targets
 * for a K of 6; this keeps a small insertion-sorted list instead. The ordering must be
 * total and deterministic — ties broken by name — or two runs over the same corpus could
 * disagree about which of two equal-weight candidates is "best", and a map generator has
 * to be reproducible.
 *
 * @param {{anchors:Set<string>,size:number}} srcMod
 * @param {{name:string,anchors:Set<string>,size:number}[]} tgtMods
 * @param {(a:object,b:object)=>{w:number,count:number}} sharedWeight
 * @param {number} [k]
 */
export function topCandidates(srcMod, tgtMods, sharedWeight, k = DEFAULT_TOP_K) {
  const top = [];
  for (const n of tgtMods) {
    const { w, count } = sharedWeight(srcMod, n);
    if (w <= 0) continue;
    const cand = { name: n.name, mod: n, w, count };
    let i = top.length;
    while (i > 0 && (top[i - 1].w < w || (top[i - 1].w === w && top[i - 1].name > cand.name))) i -= 1;
    if (i >= k) continue;
    top.splice(i, 0, cand);
    if (top.length > k) top.pop();
  }
  return top;
}

/**
 * Choose a target for one source module.
 *
 * @param {object} srcMod
 * @param {object[]} tgtMods
 * @param {{
 *   sharedWeight: (a:object,b:object)=>{w:number,count:number},
 *   fpOf?: (mod:object)=>object|null,
 *   margin?: number,
 *   minStructural?: number,
 *   k?: number,
 *   structural?: boolean,
 * }} opts
 * @returns {{name:string, mod:object, w:number, count:number,
 *            decidedBy:'lexical'|'structural', structural:number,
 *            lexicalRatio:number, accepted:boolean} | null}
 *          null when there is no lexical candidate at all, or when both signals tie.
 *          `accepted` is the absolute-evidence gate; a rejected decision is still
 *          returned so callers can report *why* a module is unresolved.
 */
export function chooseTarget(srcMod, tgtMods, opts) {
  const { sharedWeight, fpOf, margin = 1.25, minStructural = 0.02, k = DEFAULT_TOP_K } = opts;
  // `structural` defaults to on, but only if the caller supplied a way to get shapes.
  // Defaulting it on *without* fpOf would silently degrade to lexical-only and report
  // itself as structural, which is the kind of quiet no-op #1's premise already fell for.
  const structural = (opts.structural ?? true) && typeof fpOf === "function";

  const cands = topCandidates(srcMod, tgtMods, sharedWeight, k);
  if (!cands.length) return null;

  let chosen;
  if (!structural) {
    const [best, second] = cands;
    const lexicalRatio = second && second.w > 0 ? best.w / second.w : Infinity;
    // Lexical-only reproduces the pre-#1 gate exactly, including its rejection of a
    // sub-margin leader. This branch is what the baseline rate is measured with.
    if (lexicalRatio < margin) return null;
    chosen = { ...best, decidedBy: "lexical", structural: 0, lexicalRatio };
  } else {
    chosen = adjudicate(
      cands.map((c) => ({ ...c, fp: fpOf(c.mod) })),
      fpOf(srcMod),
      { margin, minStructural },
    );
    if (!chosen) return null;
  }

  // Absolute evidence floor, verbatim from the M1 spike, applied to the CHOSEN candidate.
  const accepted = (chosen.count >= 2 && chosen.w >= 8) || (chosen.count === 1 && chosen.w >= 5);
  return { ...chosen, accepted };
}

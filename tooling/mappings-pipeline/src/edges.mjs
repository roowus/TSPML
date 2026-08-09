// edges.mjs — the call-graph edge pass: pick targets for modules where BOTH content
// signals saturate (#1, second half).
//
// WHY A THIRD SIGNAL
//
// The anchor scorer and the shape histogram are both statements about a module's own
// CONTENT, and for the four modules still unresolved after the structural tie-break
// the content genuinely does not carry enough bits: tiny enum/table-shaped modules
// fingerprint identically (an exact 1.00000 against three different candidates), and
// their few string anchors are shared across sibling registries. What is left is the
// module's NEIGHBOURHOOD: webpack's `require("./N.js")` edges survive minification
// verbatim — only the ids change — and a module that imports exactly {A, B} and is
// imported only by C is far more distinctive than its shape.
//
// Measured before this was written (docs/research/structural-fingerprints.md, "The
// four still open"): the two rescuable modules' correct targets NEVER SURFACED in the
// lexical top-K at all — the shared-anchor weight ranked the wrong modules first, so
// no adjudication between surfaced candidates could reach them. Unlike `adjudicate()`
// this pass therefore GENERATES candidates from the graph rather than re-ranking
// lexical ones, and a signal allowed to invent matches needs stricter gates, not
// looser ones. Hence:
//
// THE CONTRACT
//
// For an unresolved source module, translate its require edges through the pass-1
// matches (source neighbour id -> matched target id) and accept a target only when:
//
//   1. every translated edge is present on the target, forward AND reverse;
//   2. the target has no edge to a pass-1-claimed module that the source lacks;
//   3. at least `minConfirmed` (default 2) edges agree — one shared import is how
//      "everything requires the math helper" becomes a match;
//   4. exactly ONE target qualifies; and
//   5. no other unresolved source claimed the same target.
//
// Edges to UNMATCHED modules are ignored on both sides, symmetrically: an
// untranslatable source edge cannot be checked, and a target edge to an unclaimed
// module is the mirror image of one. Only the pass-1 landmark set is evidence.
//
// Failing any gate returns a reason, not a guess — the honest unresolved that belongs
// in front of a human. On the real 0.6.0 -> 0.6.2 pair this is not hypothetical: the
// two css-loader modules (3025, 6979) import only the two css helpers (1601, 6314) —
// which pass 1 itself could not match — and are consumed only from inside the excluded
// >1MB aggregate, so they fail gate 3 with zero translated neighbours. (Had the helpers
// been translated, the twins would still tie at gate 4: they import exactly the same
// pair.) Either way, unresolved is the correct answer, not a shortfall.

/**
 * Matches webpack sibling requires as webcrack emits them: `require("./123.js")`.
 * The stem is any single path segment, mirroring how the corpus loaders key modules
 * (filename stem) — webpack ids happen to be numeric in this corpus, but the graphs
 * must agree with the loader's notion of a module, not re-encode a stricter one.
 */
const REQUIRE_RE = /require\((["'])\.\/([^/\\"']+)\.js\1\)/g;

/**
 * The set of sibling module ids `code` requires. Non-sibling requires (npm names,
 * nested paths) are not corpus edges and are ignored.
 *
 * @param {string} code
 * @returns {Set<string>}
 */
export function extractRequires(code) {
  const out = new Set();
  REQUIRE_RE.lastIndex = 0;
  let m;
  while ((m = REQUIRE_RE.exec(code))) out.add(m[2]);
  return out;
}

/**
 * Forward and reverse require graphs for a loaded corpus.
 *
 * Aggregates never appear as nodes — the loaders exclude them — and that asymmetry is
 * consistent across BOTH corpora, so an edge that exists only inside an aggregate is
 * invisible on both sides rather than a spurious disagreement. `rev` may hold keys for
 * ids outside the corpus (edges INTO an excluded file); candidates iterate `fwd` keys,
 * so those never become picks.
 *
 * @param {{name:string, code?:string}[]} mods as the corpus loaders build them
 * @returns {{fwd: Map<string, Set<string>>, rev: Map<string, Set<string>>}}
 */
export function buildGraphs(mods) {
  const fwd = new Map();
  const rev = new Map();
  for (const mod of mods) {
    const id = mod.name.replace(/\.js$/, "");
    const edges = typeof mod.code === "string" ? extractRequires(mod.code) : new Set();
    edges.delete(id); // a self-require is an unpack artifact, never evidence
    fwd.set(id, edges);
    for (const to of edges) {
      if (!rev.has(to)) rev.set(to, new Set());
      rev.get(to).add(id);
    }
  }
  return { fwd, rev };
}

/**
 * One side (forward or reverse) of the agreement check between a translated source
 * edge set and a candidate target's edge set.
 *
 * `claimed` — the image of the pass-1 translation — bounds what counts as a
 * disagreement: a target edge to an unclaimed module is the mirror of an
 * untranslatable source edge, and neither can be checked, so neither votes.
 *
 * @param {Set<string>} want translated source edges
 * @param {Set<string>} have the candidate target's edges
 * @param {Set<string>} claimed target ids owned by a pass-1 match
 */
function sideAgreement(want, have, claimed) {
  let confirmed = 0;
  let disagreements = 0;
  for (const id of want) {
    if (have.has(id)) confirmed += 1;
    else disagreements += 1;
  }
  for (const id of have) if (claimed.has(id) && !want.has(id)) disagreements += 1;
  return { confirmed, disagreements };
}

/**
 * Choose a target for one unresolved source module by edge agreement (gates 1–4).
 *
 * @param {string} srcId
 * @param {{fwd: Map<string,Set<string>>, rev: Map<string,Set<string>>}} srcGraphs
 * @param {{fwd: Map<string,Set<string>>, rev: Map<string,Set<string>>}} tgtGraphs
 * @param {Map<string,string>} translation pass-1 matches, source id -> target id
 * @param {{minConfirmed?: number, claimed?: Set<string>}} [opts]
 * @returns {{ok:true, tgtId:string, confirmed:number}
 *         | {ok:false, reason:'insufficient-edges'|'no-candidate'|'ambiguous'|'contested',
 *            detail?:string}}
 */
export function chooseByEdges(srcId, srcGraphs, tgtGraphs, translation, opts = {}) {
  const minConfirmed = opts.minConfirmed ?? 2;
  const claimed = opts.claimed ?? new Set(translation.values());
  const translate = (ids) => {
    const out = new Set();
    for (const id of ids ?? []) if (translation.has(id)) out.add(translation.get(id));
    return out;
  };
  const wantFwd = translate(srcGraphs.fwd.get(srcId));
  const wantRev = translate(srcGraphs.rev.get(srcId));
  const total = wantFwd.size + wantRev.size;
  // Gate 3, enforced once up front: an eligible candidate is disagreement-free, which
  // means every translated edge was confirmed — `confirmed` always equals `total`.
  if (total < minConfirmed) {
    return { ok: false, reason: "insufficient-edges", detail: `${total} translated neighbour(s)` };
  }

  const eligible = [];
  // Sorted iteration for reproducibility, same reason topCandidates breaks ties by
  // name: a map generator must produce the same bytes from the same corpus.
  for (const tgtId of [...tgtGraphs.fwd.keys()].sort()) {
    if (claimed.has(tgtId)) continue; // a pass-1-owned target already has its counterpart
    const f = sideAgreement(wantFwd, tgtGraphs.fwd.get(tgtId) ?? new Set(), claimed);
    const r = sideAgreement(wantRev, tgtGraphs.rev.get(tgtId) ?? new Set(), claimed);
    if (f.disagreements + r.disagreements > 0) continue; // gates 1 + 2
    eligible.push({ tgtId, confirmed: f.confirmed + r.confirmed });
  }

  if (eligible.length === 0) return { ok: false, reason: "no-candidate" };
  if (eligible.length > 1) {
    return { ok: false, reason: "ambiguous", detail: `${eligible.length} targets agree` };
  }
  return { ok: true, tgtId: eligible[0].tgtId, confirmed: eligible[0].confirmed };
}

/**
 * Run the edge pass over a batch of unresolved source modules, enforcing gate 5:
 * two sources agreeing on one target is a tie ACROSS sources — per-source uniqueness
 * (gate 4) cannot see it, and picking either would be a coin flip. Both become
 * `contested`, which is `ambiguous` wearing its other face.
 *
 * @param {Iterable<string>} srcIds
 * @param {{fwd: Map<string,Set<string>>, rev: Map<string,Set<string>>}} srcGraphs
 * @param {{fwd: Map<string,Set<string>>, rev: Map<string,Set<string>>}} tgtGraphs
 * @param {Map<string,string>} translation
 * @param {{minConfirmed?: number}} [opts]
 * @returns {Map<string, ReturnType<typeof chooseByEdges>>} one result per srcId
 */
export function resolveByEdges(srcIds, srcGraphs, tgtGraphs, translation, opts = {}) {
  const claimed = new Set(translation.values());
  const results = new Map();
  const byTarget = new Map();
  for (const srcId of [...srcIds].sort()) {
    const res = chooseByEdges(srcId, srcGraphs, tgtGraphs, translation, { ...opts, claimed });
    results.set(srcId, res);
    if (res.ok) {
      if (!byTarget.has(res.tgtId)) byTarget.set(res.tgtId, []);
      byTarget.get(res.tgtId).push(srcId);
    }
  }
  for (const [tgtId, claimants] of byTarget) {
    if (claimants.length > 1) {
      for (const s of claimants) {
        results.set(s, {
          ok: false,
          reason: "contested",
          detail: `${claimants.length} sources claim ${tgtId}`,
        });
      }
    }
  }
  return results;
}

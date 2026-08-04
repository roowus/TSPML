// fingerprint.mjs — AST structural fingerprints as a *tie-breaker* for cross-version
// module matching (#1).
//
// WHY THIS EXISTS, AND WHY IT IS A TIE-BREAKER RATHER THAN A MATCHER
//
// The M1 spike left game-logic matching at 0.848 and attributed the residual ~15% to
// "low-anchor modules (1-2 string literals)" that needed structural matching to reach at
// all. Measuring the residual directly says otherwise. All 10 unmatched game-logic
// modules are rejected by the **margin** gate (`best.w >= 1.25 * second.w`), not by
// anchor scarcity:
//
//   src       anchors  best         bw     second       sw     ratio
//   1066.js   9        3339.js      34.9   641.js       29.4   1.18
//   2247.js   2        2600.js      10.2   3080.js      10.2   1.00
//   2387.js   6        2522.js      10.2   5492.js      10.2   1.00
//   3025.js   10       3025.js      29.9   8353.js      25.9   1.15   <- correct, rejected
//   5343.js   20       1648.js      18.5   8063.js      18.5   1.00
//   666.js    18       2849.js      10.6   9437.js       9.4   1.13
//   6979.js   9        6979.js      25.4   6252.js      21.4   1.19   <- correct, rejected
//   7129.js   4        1507.js       6.7   1754.js       6.7   1.00
//   8739.js   2        1507.js       7.0   1566.js       7.0   1.00
//   8928.js   67       8063.js     267.5   494.js      243.1   1.10
//
// Two of them (3025, 6979) have the *right* target already in first place — same webpack
// id across versions — and are thrown away purely for being 1.15x/1.19x ahead instead of
// 1.25x. Four are exact 1.00 ties, where lexical evidence genuinely cannot choose. And
// 8928.js has 67 anchors with 51 shared: the opposite of anchor-starved.
//
// So the useful job for structure is NOT "find matches anchors cannot see". It is
// "adjudicate between the top few candidates anchors already surfaced". That is a much
// smaller, much more testable claim, and it is what this module does: score shape
// similarity between a source module and each of its top-K lexical candidates, and let
// that break the tie. Lowering the margin alone would *also* admit the 1.00 ties on
// coin-flip evidence; structure is what makes admitting them defensible.
//
// WHAT A FINGERPRINT CAPTURES
//
// Minification renames identifiers and rewrites whitespace but preserves *shape*: how
// many functions, with what arity, nested how deeply, containing which control-flow
// constructs, calling how many distinct callees. We record shape as histograms of
// rename-invariant facts, so the fingerprint of a module survives a re-minification that
// destroys every local name.
//
// Deliberately excluded from the fingerprint:
//   - identifier NAMES (the thing minification destroys — that is what anchors are for)
//   - string/number literal VALUES (already covered, and better, by the anchor scorer;
//     including them here would double-count the same evidence and hide disagreement)
//   - source positions and byte offsets (formatting-dependent; see #43 for the same
//     lesson on the WASM side)
//
// The similarity metric is cosine over the histogram vectors. Cosine is scale-free, which
// matters because webcrack sometimes splits or merges a module across versions: a module
// with twice the functions but the same *proportions* still reads as similar.

import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

// @babel/parser is not a direct dependency of this package — it arrives transitively via
// webcrack, which is a devDependency here. Resolving through webcrack's own require is
// deliberate: it pins us to whatever parser version webcrack itself unpacked the bundle
// with, so a fingerprint can never be computed by a different parser than the one that
// produced the modules. Adding a top-level @babel/parser dep would let those drift.
const WEBCRACK_PKG = new URL(
  "../../../node_modules/.pnpm/webcrack@2.16.0/node_modules/webcrack/package.json",
  import.meta.url,
);

let _parser = null;
/** Lazily resolve @babel/parser through webcrack. Throws a legible error if absent. */
export function getParser(pkgUrl = WEBCRACK_PKG) {
  if (_parser) return _parser;
  try {
    _parser = createRequire(pkgUrl)("@babel/parser");
  } catch (cause) {
    throw new Error(
      "fingerprint.mjs needs @babel/parser, which normally arrives via webcrack. " +
        "Run `pnpm install` in the workspace root, or pass an explicit parser to " +
        `fingerprintSource(). (resolve failed: ${cause.message})`,
    );
  }
  return _parser;
}

/** The histogram buckets, in a fixed order — the vector layout. Exported for tests. */
export const FEATURES = [
  // function shape
  "fn.total",
  "fn.arity0",
  "fn.arity1",
  "fn.arity2",
  "fn.arity3plus",
  "fn.arrow",
  "fn.async",
  "fn.generator",
  // control flow
  "cf.if",
  "cf.for",
  "cf.forin",
  "cf.while",
  "cf.switch",
  "cf.try",
  "cf.throw",
  "cf.return",
  "cf.ternary",
  "cf.logical",
  // data shape
  "d.class",
  "d.method",
  "d.object",
  "d.array",
  "d.new",
  "d.call",
  "d.member",
  "d.computed",
  "d.spread",
  "d.template",
  "d.regex",
  "d.await",
  // nesting: how deep functions go, bucketed
  "nest.d1",
  "nest.d2",
  "nest.d3",
  "nest.d4plus",
];

const NODE_TO_FEATURE = {
  IfStatement: "cf.if",
  ForStatement: "cf.for",
  ForOfStatement: "cf.for",
  ForInStatement: "cf.forin",
  WhileStatement: "cf.while",
  DoWhileStatement: "cf.while",
  SwitchStatement: "cf.switch",
  TryStatement: "cf.try",
  ThrowStatement: "cf.throw",
  ReturnStatement: "cf.return",
  ConditionalExpression: "cf.ternary",
  LogicalExpression: "cf.logical",
  ClassDeclaration: "d.class",
  ClassExpression: "d.class",
  ClassMethod: "d.method",
  ObjectMethod: "d.method",
  ObjectExpression: "d.object",
  ArrayExpression: "d.array",
  NewExpression: "d.new",
  CallExpression: "d.call",
  MemberExpression: "d.member",
  SpreadElement: "d.spread",
  TemplateLiteral: "d.template",
  RegExpLiteral: "d.regex",
  AwaitExpression: "d.await",
};

const FN_TYPES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "ObjectMethod",
  "ClassMethod",
]);

/**
 * Walk an AST counting rename-invariant structural facts.
 *
 * Hand-rolled rather than @babel/traverse: traverse builds scope information we do not
 * need and is markedly slower over ~200 modules x 2 versions. A plain recursive walk over
 * own-enumerable node properties is enough, because every fact we count is a node type,
 * a boolean flag, or an array length.
 *
 * @param {object} ast a @babel/parser File node
 * @returns {Record<string, number>} counts keyed by FEATURES entries
 */
export function countFeatures(ast) {
  const counts = Object.fromEntries(FEATURES.map((f) => [f, 0]));
  const bump = (k) => {
    if (k in counts) counts[k] += 1;
  };

  // fnDepth is passed down rather than tracked as mutable state so an early return or a
  // malformed node cannot leave the depth counter desynchronised.
  const walk = (node, fnDepth) => {
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const child of node) walk(child, fnDepth);
      return;
    }
    const type = node.type;
    if (typeof type !== "string") return;

    bump(NODE_TO_FEATURE[type]);

    let childDepth = fnDepth;
    if (FN_TYPES.has(type)) {
      childDepth = fnDepth + 1;
      counts["fn.total"] += 1;
      const arity = Array.isArray(node.params) ? node.params.length : 0;
      bump(arity >= 3 ? "fn.arity3plus" : `fn.arity${arity}`);
      if (type === "ArrowFunctionExpression") counts["fn.arrow"] += 1;
      if (node.async) counts["fn.async"] += 1;
      if (node.generator) counts["fn.generator"] += 1;
      bump(childDepth >= 4 ? "nest.d4plus" : `nest.d${childDepth}`);
    }
    if (type === "MemberExpression" && node.computed) counts["d.computed"] += 1;

    for (const key in node) {
      if (key === "type" || key === "loc" || key === "start" || key === "end") continue;
      walk(node[key], childDepth);
    }
  };

  walk(ast.program ?? ast, 0);
  return counts;
}

/**
 * Fingerprint a module's source. Returns null when the source does not parse — an
 * unparseable module must degrade to "no structural opinion" (the anchor score stands
 * alone), never to a zero vector, which would read as a confident dissimilarity.
 *
 * @param {string} code
 * @param {object} [parser] override for tests
 * @returns {{vector: number[], counts: Record<string,number>, norm: number} | null}
 */
export function fingerprintSource(code, parser = getParser()) {
  let ast;
  try {
    ast = parser.parse(code, {
      sourceType: "unambiguous",
      errorRecovery: true,
      plugins: ["jsx"],
    });
  } catch {
    return null;
  }
  const counts = countFeatures(ast);
  return vectorize(counts);
}

/** Build the {vector, counts, norm} shape from a counts object. */
export function vectorize(counts) {
  // log1p compresses the dynamic range: a module with 4,000 member expressions and one
  // with 40 are both "member-heavy", and without compression that single bucket would
  // dominate the cosine and drown out every other structural signal.
  const vector = FEATURES.map((f) => Math.log1p(counts[f] ?? 0));
  const norm = Math.sqrt(vector.reduce((s, v) => s + v * v, 0));
  return { vector, counts, norm };
}

/**
 * Cosine similarity of two fingerprints, in [0, 1] (all components are non-negative).
 * Returns 0 when either side is missing or is a zero vector — "no opinion", matching the
 * null contract of fingerprintSource.
 */
export function similarity(a, b) {
  if (!a || !b || !a.norm || !b.norm) return 0;
  let dot = 0;
  for (let i = 0; i < a.vector.length; i++) dot += a.vector[i] * b.vector[i];
  return dot / (a.norm * b.norm);
}

/** Fingerprint a file path. Returns null on a read or parse failure. */
export async function fingerprintFile(path, parser) {
  let code;
  try {
    code = await readFile(path, "utf8");
  } catch {
    return null;
  }
  return fingerprintSource(code, parser ?? getParser());
}

/**
 * Adjudicate between lexical candidates using structure (#1).
 *
 * The contract that makes this safe to bolt onto the existing matcher: it may only ever
 * *promote a candidate the lexical scorer already ranked in the top K*, and only when
 * lexical evidence was too close to call. It can never invent a match, and it can never
 * override a decisive lexical win.
 *
 * @param {{name:string,w:number,count:number,fp:object|null}[]} candidates
 *        top-K lexical candidates, descending by `w`
 * @param {object|null} srcFp   source module's fingerprint
 * @param {{margin?:number, minStructural?:number}} [opts]
 * @returns {{name:string, w:number, count:number, decidedBy:'lexical'|'structural',
 *            structural:number, lexicalRatio:number} | null}
 */
export function adjudicate(candidates, srcFp, opts = {}) {
  const margin = opts.margin ?? 1.25;
  const minStructural = opts.minStructural ?? 0.02;
  if (!candidates.length) return null;
  const [best, second] = candidates;
  const lexicalRatio = second && second.w > 0 ? best.w / second.w : Infinity;

  // Decisive lexical win: structure is not consulted. Anchors are direct evidence about
  // *this* module's content; structure is only ever circumstantial, so it does not get a
  // vote when the direct evidence is clear.
  if (lexicalRatio >= margin) {
    return { ...best, decidedBy: "lexical", structural: 0, lexicalRatio };
  }

  // Only candidates the margin gate could not separate are in the tie. A candidate
  // lexically *behind* the band was already rejected on direct evidence, and letting it
  // back in to block the decision on shape alone gets the reasoning backwards.
  //
  // This is not a detail. `8928.js` (67 anchors, 51 shared with `8063.js`, lexical weight
  // 267.5 vs 243.1 for `494.js`) is a real tie between two heavyweights, and structure
  // separates them decisively — 0.99898 vs 0.71643. Scoring the whole top-K instead put
  // `1648.js` (lexical weight 18.5, an order of magnitude behind) second on shape at
  // 0.98159, collapsing the gap to 0.017 and vetoing a call structure had actually made.
  const contenders = candidates.filter((c) => c.w > 0 && best.w / c.w < margin);
  const scored = contenders
    .map((c) => ({ ...c, structural: similarity(srcFp, c.fp) }))
    .sort((a, b) => b.structural - a.structural);
  if (!scored.length) return null;
  const [sBest, sSecond] = scored;

  // Structure must itself be decisive by a real gap, or we are just swapping one
  // coin-flip for another. A near-tie in BOTH signals is the honest "unresolved" that
  // belongs in front of a human — returning null here is the point, not a shortfall.
  //
  // Saturation is the reason this guard earns its keep rather than being defensive
  // boilerplate. Tiny enum-shaped modules fingerprint *identically*: `3025.js` scores an
  // exact 1.00000 against `3025.js`, `1196.js` and `6830.js` alike. The histogram simply
  // does not carry enough bits to separate a two-member enum from another two-member
  // enum, and a gap of 0 is the fingerprint correctly reporting that it cannot tell.
  const gap = sBest.structural - (sSecond ? sSecond.structural : 0);
  if (sBest.structural <= 0 || gap < minStructural) return null;
  return { ...sBest, decidedBy: "structural", lexicalRatio };
}

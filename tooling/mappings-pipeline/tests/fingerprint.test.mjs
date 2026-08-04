// Unit tests for src/fingerprint.mjs — AST structural fingerprints as a match
// tie-breaker (#1).
//
// These are pure: they parse inline source strings, so they run in CI with no bundle.
// The measured effect on the real 0.6.0 -> 0.6.2 pair (game-logic 0.848 -> 0.939) is
// recorded in docs/research/structural-fingerprints.md, not asserted here.
import { describe, expect, it } from 'vitest';
import {
  FEATURES,
  adjudicate,
  countFeatures,
  fingerprintSource,
  getParser,
  similarity,
  vectorize,
} from '../src/fingerprint.mjs';

const parser = getParser();
const fp = (code) => fingerprintSource(code, parser);

describe('countFeatures', () => {
  it('counts function shape by arity and kind', () => {
    const f = fp('function a(){} const b=(x)=>x; async function c(p,q){} function* d(i,j,k){}');
    expect(f.counts['fn.total']).toBe(4);
    expect(f.counts['fn.arity0']).toBe(1);
    expect(f.counts['fn.arity1']).toBe(1);
    expect(f.counts['fn.arity2']).toBe(1);
    expect(f.counts['fn.arity3plus']).toBe(1);
    expect(f.counts['fn.arrow']).toBe(1);
    expect(f.counts['fn.async']).toBe(1);
    expect(f.counts['fn.generator']).toBe(1);
  });

  it('counts control flow and bucket nesting depth', () => {
    const f = fp('function a(){ if(x){ for(;;){ while(y){ try{}catch(e){} } } } }');
    expect(f.counts['cf.if']).toBe(1);
    expect(f.counts['cf.for']).toBe(1);
    expect(f.counts['cf.while']).toBe(1);
    expect(f.counts['cf.try']).toBe(1);
    // one function, at depth 1 — the control flow inside it does not deepen fn nesting
    expect(f.counts['nest.d1']).toBe(1);
  });

  it('buckets nested functions by depth, capping at 4+', () => {
    const f = fp('function a(){ function b(){ function c(){ function d(){ function e(){} } } } }');
    expect(f.counts['nest.d1']).toBe(1);
    expect(f.counts['nest.d2']).toBe(1);
    expect(f.counts['nest.d3']).toBe(1);
    expect(f.counts['nest.d4plus']).toBe(2); // d and e both land in the 4+ bucket
  });

  it('distinguishes computed from static member access', () => {
    // The pair minification cannot collapse: `a.b` vs `a["b"]` survive renaming, so this
    // is one of the few property-access facts that is actually stable across builds.
    expect(fp('a.b.c').counts['d.computed']).toBe(0);
    expect(fp('a[b][c]').counts['d.computed']).toBe(2);
  });

  it('does not desynchronise depth across sibling functions', () => {
    // A regression guard for tracking fnDepth as mutable state instead of passing it
    // down: siblings must both read as depth 1, not 1 and 2.
    const f = fp('function a(){ function inner(){} } function b(){}');
    expect(f.counts['nest.d1']).toBe(2);
    expect(f.counts['nest.d2']).toBe(1);
  });
});

describe('fingerprintSource', () => {
  it('is invariant under renaming and reformatting', () => {
    // The whole premise: minification destroys names and whitespace but not shape.
    const pretty = `
      function computeCarVelocity(carState, deltaTime) {
        if (carState.grounded) {
          for (let wheelIndex = 0; wheelIndex < 4; wheelIndex++) {
            carState.wheels[wheelIndex].spin += deltaTime;
          }
        }
        return carState;
      }`;
    const minified = 'function a(b,c){if(b.d){for(let e=0;e<4;e++){b.f[e].g+=c}}return b}';
    expect(similarity(fp(pretty), fp(minified))).toBeGreaterThan(0.99);
  });

  it('separates structurally different modules', () => {
    const enumLike = 'var i;(function(e){e[e.A=0]="A";e[e.B=1]="B"})(i||={});export const A=i;';
    const loopHeavy =
      'function f(){for(let i=0;i<9;i++){for(let j=0;j<9;j++){if(i&j){try{g()}catch(e){h()}}}}}';
    expect(similarity(fp(enumLike), fp(loopHeavy))).toBeLessThan(0.8);
  });

  it('returns null — not a zero vector — on unparseable source', () => {
    // A zero vector would read as a confident "structurally unlike everything", which
    // would let a parse failure silently veto a good lexical match. No opinion is the
    // only safe degradation.
    expect(fingerprintSource('function ( { ] ) >>>', parser)).toBeNull();
  });

  it('log-compresses so one huge bucket cannot dominate the cosine', () => {
    // Without log1p, 4,000 member expressions vs 40 would swamp every other feature.
    const few = vectorize({ ...zeroCounts(), 'd.member': 40, 'fn.total': 3 });
    const many = vectorize({ ...zeroCounts(), 'd.member': 4000, 'fn.total': 3 });
    expect(similarity(few, many)).toBeGreaterThan(0.9);
    // and the compressed magnitudes stay within a small factor of each other
    const iMember = FEATURES.indexOf('d.member');
    expect(many.vector[iMember] / few.vector[iMember]).toBeLessThan(2.5);
  });
});

describe('similarity', () => {
  it('is 1 for identical fingerprints and 0 when either side has no opinion', () => {
    const a = fp('function f(x){return x+1}');
    expect(similarity(a, a)).toBeCloseTo(1, 10);
    expect(similarity(a, null)).toBe(0);
    expect(similarity(null, a)).toBe(0);
    expect(similarity(a, vectorize(zeroCounts()))).toBe(0); // zero vector = no opinion
  });
});

describe('adjudicate (#1)', () => {
  const withFp = (name, w, count, code) => ({ name, w, count, fp: fp(code) });
  const ENUM = 'var i;(function(e){e[e.A=0]="A"})(i||={});export const A=i;';
  const LOOPS = 'function f(){for(let i=0;i<9;i++){if(i){try{g()}catch(e){}}}}';

  it('does not consult structure when lexical evidence is decisive', () => {
    // Anchors are direct evidence about this module's content; structure is only ever
    // circumstantial. A clear lexical win must not be overridable on shape.
    const cands = [
      withFp('right.js', 100, 20, LOOPS), // lexically decisive, structurally wrong
      withFp('other.js', 10, 2, ENUM),
    ];
    const r = adjudicate(cands, fp(ENUM), { margin: 1.25 });
    expect(r.name).toBe('right.js');
    expect(r.decidedBy).toBe('lexical');
  });

  it('breaks an exact lexical tie using structure', () => {
    const cands = [
      withFp('wrong.js', 10, 2, LOOPS),
      withFp('right.js', 10, 2, ENUM), // same lexical weight, matching shape
    ];
    const r = adjudicate(cands, fp(ENUM), { margin: 1.25 });
    expect(r.name).toBe('right.js');
    expect(r.decidedBy).toBe('structural');
    expect(r.lexicalRatio).toBe(1);
  });

  it('ignores candidates the margin gate already rejected', () => {
    // The real case this guards (`8928.js`): two lexical heavyweights are tied and
    // structure separates them cleanly, but a distant third candidate that happens to
    // look similar would collapse the structural gap and veto a decision structure had
    // actually made. Only candidates inside the lexical tie band get a vote.
    const cands = [
      withFp('a.js', 267, 51, ENUM), //   tied heavyweight, right shape
      withFp('b.js', 243, 46, LOOPS), //  tied heavyweight, wrong shape
      withFp('distant.js', 18, 4, ENUM), // far behind lexically, right shape
    ];
    const r = adjudicate(cands, fp(ENUM), { margin: 1.25 });
    expect(r.name).toBe('a.js');
    expect(r.decidedBy).toBe('structural');
  });

  it('returns null when BOTH signals are ties — the honest unresolved', () => {
    // Real saturation case (`3025.js`): tiny enum-shaped modules fingerprint identically,
    // scoring an exact 1.0 against several targets. The histogram genuinely cannot tell
    // them apart, and reporting that is the point — this is what reaches a human.
    const cands = [withFp('a.js', 10, 2, ENUM), withFp('b.js', 10, 2, ENUM)];
    expect(adjudicate(cands, fp(ENUM), { margin: 1.25 })).toBeNull();
  });

  it('returns null rather than guessing when the source did not parse', () => {
    const cands = [withFp('a.js', 10, 2, ENUM), withFp('b.js', 10, 2, LOOPS)];
    expect(adjudicate(cands, null, { margin: 1.25 })).toBeNull();
  });

  it('returns null on no candidates', () => {
    expect(adjudicate([], fp(ENUM), {})).toBeNull();
  });

  it('treats a lone candidate as a decisive lexical win', () => {
    const r = adjudicate([withFp('only.js', 5, 1, LOOPS)], fp(ENUM), {});
    expect(r.name).toBe('only.js');
    expect(r.decidedBy).toBe('lexical');
    expect(r.lexicalRatio).toBe(Infinity);
  });

  it('respects minStructural — a hairline structural gap is not a decision', () => {
    const cands = [withFp('a.js', 10, 2, ENUM), withFp('b.js', 10, 2, ENUM + 'let q=1;')];
    const gap = adjudicate(cands, fp(ENUM), { margin: 1.25, minStructural: 0 });
    expect(gap).not.toBeNull(); // a gap exists at all
    // but it is far too small to act on at the real threshold
    expect(adjudicate(cands, fp(ENUM), { margin: 1.25, minStructural: 0.2 })).toBeNull();
  });
});

/** All-zero counts, for building synthetic vectors. */
function zeroCounts() {
  return Object.fromEntries(FEATURES.map((f) => [f, 0]));
}

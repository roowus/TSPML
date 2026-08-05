// Unit tests for src/select.mjs — the ONE place a source module's target is chosen (#1).
//
// These are pure: modules are built from inline source strings and a stub weight
// function, so they run in CI with no bundle. The measured effect on the real
// 0.6.0 -> 0.6.2 pair (game-logic 0.848 -> 0.939, six promotions, zero regressions) is
// recorded in docs/research/structural-fingerprints.md, not asserted here.
import { describe, expect, it } from 'vitest';
import { DEFAULT_TOP_K, chooseTarget, makeFpCache, topCandidates } from '../src/select.mjs';

const ENUM = 'var i;(function(e){e[e.A=0]="A"})(i||={});export const A=i;';
const LOOPS = 'function f(){for(let i=0;i<9;i++){if(i){try{g()}catch(e){}}}}';

/** A module as the loaders build them: anchors + size + code. */
const mod = (name, anchors, code = '') => ({
  name,
  size: code.length || 100,
  anchors: new Set(anchors),
  code,
});

/** The real sharedWeight's contract: intersect anchors, 1 unit of weight each. */
const weigh = (a, b) => {
  let w = 0;
  for (const s of a.anchors) if (b.anchors.has(s)) w += 1;
  return { w, count: w };
};

describe('topCandidates', () => {
  it('returns the K heaviest, descending, and drops zero-weight targets', () => {
    const src = mod('src', ['a', 'b', 'c']);
    const tgts = [
      mod('none', ['x']), //         0 shared — must not appear at all
      mod('one', ['a']), //          1
      mod('three', ['a', 'b', 'c']), // 3
      mod('two', ['a', 'b']), //     2
    ];
    const top = topCandidates(src, tgts, weigh, 3);
    expect(top.map((c) => c.name)).toEqual(['three', 'two', 'one']);
    // A zero-weight candidate is not "a weak match", it is no evidence at all. Carrying
    // it into adjudication would let a module with nothing in common cast a shape vote.
    expect(top.some((c) => c.name === 'none')).toBe(false);
  });

  it('still reports a lexical leader where chooseTarget returns null (the bestShared diagnostic)', () => {
    // gen-map records `bestShared` for every UNRESOLVED module. It must come from here and
    // not from chooseTarget, which returns null on a tie or a sub-margin leader — reporting
    // 0 shared anchors for a module that in fact shares plenty.
    //
    // Caught in review, after the first version of the integration did exactly that: the
    // regenerated map said `3025` had `0/10` shared anchors where the committed pre-#1 map
    // says `9/10`. That inverts #1's central finding — these modules are rejected by the
    // MARGIN GATE, not by anchor scarcity — and would send the next reader hunting for
    // missing anchors instead of a too-tight margin.
    const src = mod('src', ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']);
    const cands = [mod('t1', [...src.anchors]), mod('t2', [...src.anchors].slice(0, 9))];
    // A dead-heat-ish pair: chooseTarget refuses to pick (ratio 1.11 < 1.25 margin)...
    expect(chooseTarget(src, cands, { sharedWeight: weigh, structural: false, margin: 1.25 })).toBeNull();
    // ...but the evidence was never absent, and the diagnostic must say so.
    const [leader] = topCandidates(src, cands, weigh, 1);
    expect(leader.count).toBe(10);
  });

  it('breaks equal weights by name so a regen is reproducible', () => {
    // Not cosmetic: the map generator must produce the same bytes from the same corpus.
    // Two equal-weight candidates resolved by arrival order would make the output depend
    // on readdir order, which is filesystem-dependent.
    const src = mod('src', ['a', 'b']);
    const forward = topCandidates(src, [mod('zeta', ['a']), mod('alpha', ['a'])], weigh, 2);
    const reverse = topCandidates(src, [mod('alpha', ['a']), mod('zeta', ['a'])], weigh, 2);
    expect(forward.map((c) => c.name)).toEqual(['alpha', 'zeta']);
    expect(reverse.map((c) => c.name)).toEqual(forward.map((c) => c.name));
  });

  it('honours K even when a late candidate outranks an early one', () => {
    // A truncating insert is easy to get wrong: the heavy candidate arrives last, after
    // the list is already full, and must displace rather than be dropped.
    const src = mod('src', ['a', 'b', 'c']);
    const tgts = [mod('l1', ['a']), mod('l2', ['a']), mod('heavy', ['a', 'b', 'c'])];
    const top = topCandidates(src, tgts, weigh, 2);
    expect(top.map((c) => c.name)).toEqual(['heavy', 'l1']);
    expect(top).toHaveLength(2);
  });
});

describe('chooseTarget — lexical mode reproduces the pre-#1 gate', () => {
  const opts = { sharedWeight: weigh, structural: false, margin: 1.25 };

  it('accepts a decisive leader that clears the evidence floor', () => {
    const src = mod('src', ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
    const pick = chooseTarget(src, [mod('win', [...src.anchors]), mod('other', ['a'])], opts);
    expect(pick.name).toBe('win');
    expect(pick.decidedBy).toBe('lexical');
    expect(pick.accepted).toBe(true);
  });

  it('rejects a sub-margin leader outright — no structural second chance', () => {
    const src = mod('src', ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']);
    // 10 shared vs 9 shared: ratio 1.11, under the 1.25 margin.
    const cands = [mod('best', [...src.anchors]), mod('close', [...src.anchors].slice(0, 9))];
    expect(chooseTarget(src, cands, opts)).toBeNull();
  });

  it('applies the absolute evidence floor, not just the margin', () => {
    // A lone candidate wins the margin by default (ratio Infinity), so the floor is the
    // only thing standing between "uncontested" and "accepted on one weak anchor".
    const thin = chooseTarget(mod('src', ['a']), [mod('t', ['a'])], opts);
    expect(thin.decidedBy).toBe('lexical');
    expect(thin.accepted).toBe(false); // 1 shared anchor, weight 1 — under w>=5

    const fat = chooseTarget(mod('src', ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']),
      [mod('t', ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'])], opts);
    expect(fat.accepted).toBe(true); // 8 shared, weight 8
  });

  it('returns null when nothing shares a single anchor', () => {
    expect(chooseTarget(mod('src', ['a']), [mod('t', ['zzz'])], opts)).toBeNull();
  });
});

describe('chooseTarget — structural mode (#1)', () => {
  const fpOf = makeFpCache();
  const opts = { sharedWeight: weigh, fpOf, margin: 1.25 };

  it('promotes the matching shape out of a lexical tie', () => {
    const src = mod('src', ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'], ENUM);
    const cands = [
      mod('wrongShape', [...src.anchors], LOOPS), //            10 shared, wrong shape
      mod('rightShape', [...src.anchors].slice(0, 9), ENUM), //  9 shared, right shape
    ];
    const pick = chooseTarget(src, cands, opts);
    expect(pick.name).toBe('rightShape');
    expect(pick.decidedBy).toBe('structural');
    expect(pick.accepted).toBe(true);
  });

  it('does NOT consult structure when lexical evidence is decisive', () => {
    // The ordering that makes this safe to ship: anchors are direct evidence about this
    // module's own literals, structure is circumstantial. A clear lexical win stands even
    // against a perfect shape match on a weaker candidate.
    const src = mod('src', ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'], ENUM);
    const cands = [
      mod('lexWinner', [...src.anchors], LOOPS), //          10 shared, wrong shape
      mod('shapeTwin', ['a', 'b', 'c', 'd'], ENUM), //        4 shared, perfect shape
    ];
    const pick = chooseTarget(src, cands, opts);
    expect(pick.name).toBe('lexWinner');
    expect(pick.decidedBy).toBe('lexical');
  });

  it('applies the evidence floor to the CHOSEN candidate, not the lexical leader', () => {
    // A promotion swaps in a candidate with LOWER weight. If the floor were checked
    // against the leader, a promoted match would inherit the leader's evidence and clear
    // a bar it never met — quietly lowering the standard for the least certain matches.
    //
    // The straddle is what makes this assertion bite, and getting it wrong is easy: the
    // leader must be ABOVE the floor and the promoted candidate BELOW it. Weights equal
    // shared-anchor counts here, and the floor is `count >= 2 && w >= 8`, so leader 8 /
    // promoted 7 straddles it. (Measured: an earlier version of this test used 7 and 6 —
    // both under the floor — and stayed green against the leader-based mutation.)
    const src = mod('src', ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], ENUM);
    const cands = [
      mod('heavyWrong', ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], LOOPS), // 8 — clears floor
      mod('lightRight', ['a', 'b', 'c', 'd', 'e', 'f', 'g'], ENUM), //       7 — under it
    ];
    const pick = chooseTarget(src, cands, opts);
    expect(pick.name).toBe('lightRight');
    expect(pick.decidedBy).toBe('structural');
    expect(pick.w).toBe(7); // the promoted candidate's own weight, not the leader's 8
    // The whole point: this match is NOT accepted, because the candidate we actually
    // chose does not carry enough direct evidence on its own.
    expect(pick.accepted).toBe(false);
  });

  it('returns null when both signals tie — the honest unresolved', () => {
    const src = mod('src', ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'], ENUM);
    const cands = [
      mod('twinA', [...src.anchors], ENUM),
      mod('twinB', [...src.anchors].slice(0, 9), ENUM),
    ];
    expect(chooseTarget(src, cands, opts)).toBeNull();
  });

  it('degrades to lexical-only, and says so, when no fingerprint source is available', () => {
    // The quiet-no-op guard. Defaulting structural ON without an fpOf would silently
    // score every shape as "no opinion" while still reporting itself as structural —
    // exactly the kind of inert integration #1's own premise fell for.
    const src = mod('src', ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
    const cands = [mod('t', [...src.anchors])];
    const pick = chooseTarget(src, cands, { sharedWeight: weigh, margin: 1.25 });
    expect(pick.decidedBy).toBe('lexical');
    expect(pick.accepted).toBe(true);
  });

  it('defaults K to DEFAULT_TOP_K', () => {
    expect(DEFAULT_TOP_K).toBeGreaterThanOrEqual(2);
    const src = mod('src', ['a', 'b'], ENUM);
    const tgts = Array.from({ length: DEFAULT_TOP_K + 4 }, (_, i) => mod(`t${i}`, ['a'], ENUM));
    expect(topCandidates(src, tgts, weigh).length).toBe(DEFAULT_TOP_K);
  });
});

describe('makeFpCache', () => {
  it('keys on module identity, not name — the two corpora reuse webpack ids', () => {
    // Keying by name would be the natural shortcut and would be wrong: webpack reuses
    // ids across versions (`3025.js` exists in both), so a name-keyed cache would hand a
    // source module the TARGET module's shape and score it against itself.
    const fpOf = makeFpCache();
    const a = mod('3025.js', [], ENUM);
    const b = mod('3025.js', [], LOOPS);
    expect(fpOf(a)).not.toBe(fpOf(b));
    expect(fpOf(a).counts['cf.for']).toBe(0);
    expect(fpOf(b).counts['cf.for']).toBe(1);
  });

  it('memoises per module, returning the identical object', () => {
    const fpOf = makeFpCache();
    const m = mod('m', [], ENUM);
    expect(fpOf(m)).toBe(fpOf(m));
  });

  it('returns null for a module with no source — no structural opinion', () => {
    const fpOf = makeFpCache();
    expect(fpOf({ name: 'x', size: 1, anchors: new Set() })).toBeNull();
  });
});

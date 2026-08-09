// Unit tests for src/edges.mjs — the call-graph edge pass (#1, second half).
//
// Pure, like select.test.mjs: corpora are built from inline source strings, so these
// run in CI with no bundle. The measured effect on the real 0.6.0 -> 0.6.2 pair
// (7129 -> 8734 and 8739 -> 8482 rescued, 3025/6979 honestly left unresolved) is
// recorded in docs/research/structural-fingerprints.md, not asserted here.
//
// The fixture families are miniatures of the real cases they guard:
//   - a module whose correct target NEVER surfaced lexically, reachable only by its
//     translated neighbourhood (the real 7129/8739 shape);
//   - css-loader twins that import exactly the same helpers and are consumed only by
//     an excluded aggregate — the pass must refuse both. (The real 3025/6979 fail one
//     gate earlier — their helpers never pass-1 matched, so zero translated edges —
//     but the twin shape is what they become the moment the helpers DO match.)
import { describe, expect, it } from 'vitest';
import { buildGraphs, chooseByEdges, extractRequires, resolveByEdges } from '../src/edges.mjs';

/** A module as the corpus loaders build them: name + code (edges live in code). */
const mod = (id, requires = []) => ({
  name: `${id}.js`,
  code: requires.map((r) => `var x${r} = require("./${r}.js");`).join('\n'),
});

/** Build {fwd, rev} graphs from [id, [requiredIds]] pairs. */
const graphs = (pairs) => buildGraphs(pairs.map(([id, reqs]) => mod(id, reqs)));

describe('extractRequires', () => {
  it('finds sibling requires in both quote styles and dedupes', () => {
    const code = 'var a = require("./1635.js"); f(require(\'./4922.js\')); g(require("./1635.js"));';
    expect([...extractRequires(code)].sort()).toEqual(['1635', '4922']);
  });

  it('ignores non-sibling requires — npm names and nested paths are not corpus edges', () => {
    // `./x.js` IS a sibling stem: the graphs mirror the loader's notion of a module
    // (filename stem), not a numeric-id assumption baked in twice.
    const code = 'require("three"); require("./sub/12.js"); require("../9.js"); require("./x.js");';
    expect([...extractRequires(code)]).toEqual(['x']);
  });
});

describe('buildGraphs', () => {
  it('builds forward and reverse edges that mirror each other', () => {
    const g = graphs([['1', ['2']], ['2', []], ['3', ['2', '1']]]);
    expect([...g.fwd.get('3')].sort()).toEqual(['1', '2']);
    expect([...g.rev.get('2')].sort()).toEqual(['1', '3']);
    expect(g.rev.get('1')).toEqual(new Set(['3']));
  });

  it('drops self-requires — an unpack artifact, never evidence', () => {
    const g = buildGraphs([mod('7', ['7', '2']), mod('2', [])]);
    expect(g.fwd.get('7')).toEqual(new Set(['2']));
    expect(g.rev.has('7')).toBe(false);
  });

  it('gives a module with no code an empty edge set rather than crashing', () => {
    const g = buildGraphs([{ name: '5.js' }]);
    expect(g.fwd.get('5')).toEqual(new Set());
  });
});

// The miniature 7129 family. Pass-1 matched a->A, b->B, c->C; source `u` requires
// {a, b} and is required by {c}. Target `U` is the only unclaimed module with the
// translated neighbourhood — and, as in the real pair, nothing lexical points at it.
const SRC = graphs([
  ['a', []], ['b', []], ['c', ['u']],
  ['u', ['a', 'b']],
]);
const TGT = graphs([
  ['A', []], ['B', []], ['C', ['U']],
  ['U', ['A', 'B']],
  // decoys, one per gate:
  ['V', ['A']], //           subset — misses the b->B edge (gate 1)
  ['W', ['A', 'B', 'C']], // superset — extra edge to CLAIMED C the source lacks (gate 2)
]);
const PASS1 = new Map([['a', 'A'], ['b', 'B'], ['c', 'C']]);

describe('chooseByEdges', () => {
  it('picks the unique target whose translated neighbourhood agrees, fwd and rev', () => {
    const res = chooseByEdges('u', SRC, TGT, PASS1);
    expect(res).toEqual({ ok: true, tgtId: 'U', confirmed: 3 }); // a->A, b->B, rev c->C
  });

  it('rejects a target missing a translated edge (gate 1)', () => {
    // Remove U: V remains, agreeing on A but missing B. One eligible candidate would
    // exist if subsets were tolerated — they must not be, or "requires the common
    // helper" becomes a match.
    const tgt = graphs([['A', []], ['B', []], ['C', []], ['V', ['A']]]);
    expect(chooseByEdges('u', SRC, tgt, PASS1)).toEqual({ ok: false, reason: 'no-candidate' });
  });

  it('rejects a target with an extra edge to a claimed module (gate 2)', () => {
    // W satisfies every translated edge — fwd {A, B} and rev {C} — and differs ONLY by
    // the extra edge to claimed D. Gate 1 cannot reject it; only gate 2 can. (The first
    // version of this fixture reused C as the extra edge, which also broke the rev
    // requirement — the mutation check caught gate 2 as untested, not redundant.)
    const tgt = graphs([['A', []], ['B', []], ['C', ['W']], ['D', []], ['W', ['A', 'B', 'D']]]);
    const pass1 = new Map([...PASS1, ['d', 'D']]);
    expect(chooseByEdges('u', SRC, tgt, pass1)).toEqual({ ok: false, reason: 'no-candidate' });
  });

  it('tolerates target edges to UNCLAIMED modules — the mirror of an untranslatable source edge', () => {
    // U also requires Z, which pass 1 never matched. An unclaimed neighbour cannot be
    // checked in either direction, so it must not veto — exclusion is symmetric with
    // ignoring source edges the translation cannot map.
    const tgt = graphs([['A', []], ['B', []], ['C', ['U']], ['Z', []], ['U', ['A', 'B', 'Z']]]);
    const res = chooseByEdges('u', SRC, tgt, PASS1);
    expect(res.ok).toBe(true);
    expect(res.tgtId).toBe('U');
  });

  it('ignores untranslatable SOURCE edges rather than counting them as missing', () => {
    // Source u also requires z, which pass 1 never matched. If that edge were kept as
    // a requirement, no target could ever satisfy it and the pass would be inert.
    const src = graphs([['a', []], ['b', []], ['c', ['u']], ['z', []], ['u', ['a', 'b', 'z']]]);
    const res = chooseByEdges('u', src, TGT, PASS1);
    expect(res.ok).toBe(true);
    expect(res.tgtId).toBe('U');
  });

  it('refuses below the edge floor (gate 3) — one shared import is not a match', () => {
    // Source `one` has a single translated edge. Plenty of targets require A; picking
    // among them on one edge is the "everything imports the math helper" trap.
    const src = graphs([['a', []], ['one', ['a']]]);
    const tgt = graphs([['A', []], ['P', ['A']]]);
    const res = chooseByEdges('one', src, tgt, new Map([['a', 'A']]));
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('insufficient-edges');
  });

  it('refuses when two targets both qualify (gate 4) — the css-loader twins', () => {
    // The real 3025/6979 shape: two source css modules import exactly the same two
    // helpers, two target css modules do too, and no non-aggregate consumer separates
    // them. Any pick would be a coin flip; the honest answer is no pick.
    const src = graphs([['h1', []], ['h2', []], ['css1', ['h1', 'h2']], ['css2', ['h1', 'h2']]]);
    const tgt = graphs([['H1', []], ['H2', []], ['CSS1', ['H1', 'H2']], ['CSS2', ['H1', 'H2']]]);
    const pass1 = new Map([['h1', 'H1'], ['h2', 'H2']]);
    const res = chooseByEdges('css1', src, tgt, pass1);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('ambiguous');
  });

  it('never proposes a target pass 1 already claimed', () => {
    // X's neighbourhood agrees perfectly — but pass 1 already matched some source to
    // it. Proposing it would silently give one target two sources.
    const tgt = graphs([['A', []], ['B', []], ['C', ['X']], ['X', ['A', 'B']]]);
    const pass1 = new Map([...PASS1, ['other', 'X']]);
    expect(chooseByEdges('u', SRC, tgt, pass1)).toEqual({ ok: false, reason: 'no-candidate' });
  });
});

describe('resolveByEdges', () => {
  it('resolves independent modules in one batch', () => {
    const res = resolveByEdges(['u'], SRC, TGT, PASS1);
    expect(res.get('u')).toEqual({ ok: true, tgtId: 'U', confirmed: 3 });
  });

  it('marks BOTH sources contested when they claim one target (gate 5)', () => {
    // Two unresolved sources with identical translated neighbourhoods both find the
    // same unique eligible target. Per-source, each pick looks clean — the collision
    // is only visible across the batch, and awarding the target to either would be
    // exactly the coin flip gate 4 exists to prevent.
    const src = graphs([['a', []], ['b', []], ['u1', ['a', 'b']], ['u2', ['a', 'b']]]);
    const tgt = graphs([['A', []], ['B', []], ['U', ['A', 'B']]]);
    const pass1 = new Map([['a', 'A'], ['b', 'B']]);
    const res = resolveByEdges(['u1', 'u2'], src, tgt, pass1);
    expect(res.get('u1').ok).toBe(false);
    expect(res.get('u1').reason).toBe('contested');
    expect(res.get('u2').reason).toBe('contested');
  });

  it('is order-independent — same picks whatever order the batch arrives in', () => {
    const forward = resolveByEdges(['u'], SRC, TGT, PASS1);
    const reverse = resolveByEdges(['u'], SRC, TGT, PASS1);
    expect(forward.get('u')).toEqual(reverse.get('u'));
  });
});

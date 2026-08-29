/**
 * `lib/pml/splice.ts` — PML's token-anchored patch language under TSPML's
 * exactly-once rule.
 *
 * The fragments below are synthetic but SHAPED like the real thing: the
 * minified formatting PML tokens are written against (spaces, `!1`, method
 * bodies inside a class) comes from ghosttoggle 1.0.8, a real mod on PML's
 * CDN. When a fixture here encodes a formatting assumption, it is Kodub's
 * minifier's assumption, not ours.
 */
import { describe, expect, it } from 'vitest';
import { applyPmlSplice, parsePmlMixinSpec, PML_SPLICE_TYPES } from '../lib/pml/splice';

// A method body in Kodub's 0.6.2 formatting. The ghost-toggle shape: the same
// token twice, spliced BETWEEN — this is what REPLACEBETWEEN exists for.
const GHOST_BODY = 'update(e){const t=e.car.getTime().numberOfFrames;if(e.car.getTime().numberOfFrames>0){e.car.setCarState(t,!1)}return t}';
const TWIN_SOURCE = `class ws{${GHOST_BODY}}`;

describe('applyPmlSplice', () => {
  it('INSERT splices the func immediately AFTER a unique token', () => {
    const r = applyPmlSplice(TWIN_SOURCE, {
      op: 'pml-splice',
      type: 'INSERT',
      token: 'e.car.setCarState(t,!1)',
      func: ';e.car.setVisible(!1);',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.source).toContain('e.car.setCarState(t,!1);e.car.setVisible(!1);');
      // The rest of the method is untouched — one edit, exactly where asked.
      expect(r.source).toContain('return t}');
    }
  });

  it('REPLACE swaps a unique token for the func', () => {
    const r = applyPmlSplice(TWIN_SOURCE, {
      op: 'pml-splice',
      type: 'REPLACE',
      token: 'return t}',
      func: 'return e.car.getTime().numberOfFrames}',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.source).toContain('return e.car.getTime().numberOfFrames}');
      expect(r.source).not.toContain('return t}');
    }
  });

  it('REPLACEBETWEEN splices between two occurrences of the SAME token', () => {
    // The twin shape with TWO occurrences: the func replaces the span between.
    const r = applyPmlSplice(TWIN_SOURCE, {
      op: 'pml-splice',
      type: 'REPLACEBETWEEN',
      classRef: 'ws.prototype',
      method: 'update',
      tokenStart: 'e.car.getTime().numberOfFrames',
      tokenEnd: 'e.car.getTime().numberOfFrames',
      func: '0',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      // Both anchors kept, the span between them (here ";if(") replaced by the
      // func — the anchors are part of the surrounding expression, not the edit.
      expect(r.source).toBe(
        'class ws{update(e){const t=e.car.getTime().numberOfFrames0e.car.getTime().numberOfFrames>0){e.car.setCarState(t,!1)}return t}}',
      );
    }
  });

  it('REPLACEBETWEEN with twin anchors over ONE occurrence inserts at it', () => {
    // ghosttoggle's REAL shape against the real 0.6.2 bundle: the anchor
    // string occurs exactly once in the whole file, so that single occurrence
    // serves as both ends and the span is EMPTY — the func lands immediately
    // after the token, which is how the mod turns a direct frame read into a
    // conditional one. The fragment below is the bundle's actual hit.
    const real = 'for(let n=e.car.getTime().numberOfFrames+1;n<=t;n++)';
    const r = applyPmlSplice(real, {
      op: 'pml-splice',
      type: 'REPLACEBETWEEN',
      tokenStart: 'e.car.getTime().numberOfFrames',
      tokenEnd: 'e.car.getTime().numberOfFrames',
      func: '(ghostOn?e.car.getTime().numberOfFrames:-1)',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.source).toBe(
        'for(let n=e.car.getTime().numberOfFrames(ghostOn?e.car.getTime().numberOfFrames:-1)+1;n<=t;n++)',
      );
    }
  });

  it('refuses twin anchors with THREE occurrences rather than guessing a pair', () => {
    const r = applyPmlSplice('T a T b T', {
      op: 'pml-splice',
      type: 'REPLACEBETWEEN',
      tokenStart: 'T',
      tokenEnd: 'T',
      func: 'x',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('token-ambiguous');
  });

  it('REMOVEBETWEEN deletes the span, keeping both anchors', () => {
    const r = applyPmlSplice('a TOKEN middle TOKEN b', {
      op: 'pml-splice',
      type: 'REMOVEBETWEEN',
      tokenStart: 'TOKEN',
      tokenEnd: 'TOKEN',
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.source).toBe('a TOKENTOKEN b');
  });

  it('refuses a token that appears TWICE (INSERT/REPLACE), with the count', () => {
    const r = applyPmlSplice('x foo y foo z', {
      op: 'pml-splice',
      type: 'REPLACE',
      token: 'foo',
      func: 'bar',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('token-ambiguous');
      expect(r.detail).toContain('2 times');
    }
  });

  it('refuses a token that appears ZERO times, naming the likely cause', () => {
    const r = applyPmlSplice('nothing here', {
      op: 'pml-splice',
      type: 'INSERT',
      classRef: 'ws.prototype',
      method: 'update',
      token: 'e.car.setCarState(t, !1)',
      func: ';x;',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('token-not-found');
      // The count is on the record; the hint says what it usually means.
      expect(r.detail).toContain('0 times');
      expect(r.detail).toContain('build may differ');
    }
  });

  it('refuses a range whose START is ambiguous even when the end is unique', () => {
    const r = applyPmlSplice('S a S b E', {
      op: 'pml-splice',
      type: 'REPLACEBETWEEN',
      tokenStart: 'S',
      tokenEnd: 'E',
      func: 'x',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('token-ambiguous');
  });

  it('refuses a range whose END occurs twice after the start', () => {
    const r = applyPmlSplice('S a E b E', {
      op: 'pml-splice',
      type: 'REMOVEBETWEEN',
      tokenStart: 'S',
      tokenEnd: 'E',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('token-ambiguous');
  });

  it('an end anchor BEFORE the start does not disqualify the range', () => {
    // Only ambiguity after the start matters: the range is start→next-end.
    const r = applyPmlSplice('E x S y E', {
      op: 'pml-splice',
      type: 'REMOVEBETWEEN',
      tokenStart: 'S',
      tokenEnd: 'E',
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.source).toBe('E x SE');
  });

  it('refuses the method-extent types this adapter cannot anchor', () => {
    // Cast like the route does: a stored record claiming an unsupported type is
    // attacker-shaped input by the time it reaches the apply step, and the
    // branch exists to answer it, not to satisfy a compile-time promise.
    for (const type of ['HEAD', 'TAIL', 'OVERRIDE', 'CONSTRUCTOR'] as const) {
      const r = applyPmlSplice('x', { op: 'pml-splice', type, func: 'y' } as unknown as Parameters<typeof applyPmlSplice>[1]);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('unsupported-mixin-type');
    }
  });

  it('applies later patches against the text earlier ones produced', () => {
    // Sequential, in registration order — a later anchor may sit inside an
    // earlier splice's output, which is exactly how PML composes them.
    const first = applyPmlSplice('keep', {
      op: 'pml-splice',
      type: 'INSERT',
      token: 'keep',
      func: 'MARK',
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = applyPmlSplice(first.source, {
      op: 'pml-splice',
      type: 'REPLACE',
      token: 'MARK',
      func: 'DONE',
    });
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.source).toBe('keepDONE');
  });
});

describe('parsePmlMixinSpec', () => {
  it('accepts the object-spec form with all four supported types', () => {
    for (const type of PML_SPLICE_TYPES) {
      const spec =
        type === 'REPLACEBETWEEN' || type === 'REMOVEBETWEEN'
          ? { type, tokenStart: 'a', tokenEnd: 'b', ...(type === 'REPLACEBETWEEN' ? { func: 'c' } : {}) }
          : { type, token: 'a', func: 'b' };
      const r = parsePmlMixinSpec(['ws.prototype', 'update', spec]);
      expect(r.ok, type).toBe(true);
      if (r.ok) expect(r.patch.op).toBe('pml-splice');
    }
  });

  it('maps PML\'s NUMERIC enum — what every mod importing PolyTypes.js ships', () => {
    // The real enum: INSERT=3, REPLACEBETWEEN=5, REMOVEBETWEEN=6 (PolyTypes.js
    // on the CDN). 3decspeed arrives with `type: 5` and was refused as
    // "no type" before the collector was bilingual; this pins the fix.
    expect(parsePmlMixinSpec(['We.prototype', 'update', { type: 3, token: 'a', func: 'b' }]).ok).toBe(true);
    expect(parsePmlMixinSpec(['a', { type: 5, tokenStart: 'a', tokenEnd: 'b', func: 'c' }]).ok).toBe(true);
    expect(parsePmlMixinSpec(['a', { type: 6, tokenStart: 'a', tokenEnd: 'b' }]).ok).toBe(true);
    // Numeric method-extent and class-wide values refuse by NAME after mapping.
    const head = parsePmlMixinSpec(['a', { type: 0, func: 'x' }]);
    expect(head.ok).toBe(false);
    if (!head.ok) expect(head.reason).toContain('HEAD');
    const classIns = parsePmlMixinSpec(['a', { type: 8, token: 't', func: 'f' }]);
    expect(classIns.ok).toBe(false);
    if (!classIns.ok) expect(classIns.reason).toContain('CLASSINSERT');
    // An integer outside the enum refuses as unreadable, naming what arrived.
    const alien = parsePmlMixinSpec(['a', { type: 42, token: 't' }]);
    expect(alien.ok).toBe(false);
    if (!alien.ok) expect(alien.reason).toContain('42');
  });

  it('accepts the three call shapes the CDN mods actually ship', () => {
    // 3decspeed: class family, two strings + spec.
    expect(
      parsePmlMixinSpec(['We.prototype', 'update', { type: 5, tokenStart: 'a', tokenEnd: 'a', func: 'c' }]).ok,
    ).toBe(true);
    // husplits: func family, one name + spec.
    const hu = parsePmlMixinSpec(['gs', { type: 3, token: 'a', func: 'b' }]);
    expect(hu.ok).toBe(true);
    if (hu.ok) expect(hu.patch.classRef).toBe('gs');
    // noitalics: global family, LONE spec object.
    const noit = parsePmlMixinSpec([{ type: 5, tokenStart: 'a', tokenEnd: 'a', func: 'c' }]);
    expect(noit.ok).toBe(true);
    if (noit.ok) expect(noit.patch.classRef).toBeUndefined();
  });

  it('refuses the method-extent types with a reason that names the type', () => {
    const r = parsePmlMixinSpec(['ws.prototype', 'update', { type: 'OVERRIDE', func: 'x' }]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain('OVERRIDE');
      expect(r.reason).toContain('method-extent');
    }
  });

  it('refuses the physics patch types with the wasm-gate reason', () => {
    const r = parsePmlMixinSpec(['phys', 'x', { type: 'PATCH_F32', token: 'a', func: 'b' }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('wasm gate');
  });

  it('refuses an incomplete spec AT COLLECT TIME, not one boot later', () => {
    expect(parsePmlMixinSpec(['a', 'b', { type: 'INSERT', func: 'x' }]).ok).toBe(false);
    expect(parsePmlMixinSpec(['a', 'b', { type: 'REPLACEBETWEEN', tokenStart: 'x', func: 'y' }]).ok).toBe(false);
    expect(parsePmlMixinSpec(['a', 'b']).ok).toBe(false);
    expect(parsePmlMixinSpec([{ nope: 1 }]).ok).toBe(false);
  });

  it('drops non-string fields rather than coercing them', () => {
    // A spec is persisted and re-applied across launches; only plain values
    // survive that trip, so only plain values are accepted at the gate.
    const r = parsePmlMixinSpec(['a', 'b', { type: 'INSERT', token: 'x', func: () => 1 }]);
    expect(r.ok).toBe(true); // a non-string func is simply absent
    if (r.ok) expect(r.patch.func).toBeUndefined();
  });
});

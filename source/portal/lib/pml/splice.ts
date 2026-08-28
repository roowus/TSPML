/**
 * @tspml/portal — PML mixin splices: PML's patch language, applied with
 * TSPML's discipline.
 *
 * A PML mixin (the `registerClassMixin` family) is a token-anchored source
 * edit: "find this exact text in the game's minified source and splice this
 * other text in/at/between it". PML's own loader applies these against the
 * live bundle text before evaluation, which is why the tokens are written in
 * KODUB'S minified formatting — `e.car.setCarState(t, !1)`, spaces and `!1`
 * and all.
 *
 * TSPML carries these across by applying the SAME edit at its own transform
 * seam, under a stricter rule than PML's: the anchor must match EXACTLY ONCE
 * in the surface being served, or the patch is refused with a reason naming
 * the count. PML splices blindly at whatever its lookup finds first; a
 * unique-match requirement makes every applied splice unambiguous, and every
 * ambiguous one a legible failure instead of a corrupted bundle. That is the
 * whole bargain of this file: PML's semantics, TSPML's fail-closed habit.
 *
 * ## What is NOT here, on purpose
 *
 * Only the four token-anchored types ({@link PML_SPLICE_TYPES}). `HEAD`,
 * `TAIL`, `OVERRIDE` and `CONSTRUCTOR` anchor to a method's extent, which
 * PML resolves by holding the live class — a resolution this adapter cannot
 * reproduce (the minified class is module-scoped), so those stay refused at
 * the shim. `PATCH_F32`/`PATCH_I32` are wasm offsets and stay refused by the
 * physics gate (#43's fail-closed hash pin).
 *
 * Pure: no browser, no engine, no globals — the unit tests drive it with
 * realistic minified fragments.
 */

/**
 * The PML mixin types this adapter can carry, as patch records. Everything
 * else a mod tries to register through this family is refused at the shim,
 * before a record like this can exist.
 *
 * `classRef`/`method` ride along for the REPORT (the player should see what
 * the mod claimed to patch) — targeting is by token alone, because that is
 * the only part of PML's addressing that survives translation.
 */
export interface PmlSplicePatch {
  readonly op: 'pml-splice';
  readonly type: 'INSERT' | 'REPLACE' | 'REPLACEBETWEEN' | 'REMOVEBETWEEN';
  /** The mod's own addressing, reported back verbatim. */
  readonly classRef?: string;
  readonly method?: string;
  /** INSERT/REPLACE: the single anchor text. */
  readonly token?: string;
  /** REPLACEBETWEEN/REMOVEBETWEEN: the range's two anchors. */
  readonly tokenStart?: string;
  readonly tokenEnd?: string;
  /** The text to insert/replace with. Absent for REMOVEBETWEEN. */
  readonly func?: string;
}

/** The types {@link applyPmlSplice} can apply — everything else is refused
 *  upstream, and a record claiming one of those here is malformed. */
export const PML_SPLICE_TYPES = ['INSERT', 'REPLACE', 'REPLACEBETWEEN', 'REMOVEBETWEEN'] as const;

export type SpliceResult =
  | { readonly ok: true; readonly source: string; readonly detail: string }
  | { readonly ok: false; readonly reason: string; readonly detail: string };

/** Count non-overlapping occurrences, the only honest answer to "is this
 *  anchor unique?" — a regex with lookarounds would be O(n·m) and no clearer. */
function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let n = 0;
  let at = haystack.indexOf(needle);
  while (at !== -1) {
    n++;
    at = haystack.indexOf(needle, at + needle.length);
  }
  return n;
}

/**
 * Apply one splice to `source`. Never throws: every way this can go wrong is
 * a returned failure a report can show.
 *
 * The uniqueness rule differs by shape, and the difference is load-bearing:
 *
 *  - INSERT/REPLACE: the token must occur EXACTLY ONCE in the whole surface.
 *  - REPLACEBETWEEN/REMOVEBETWEEN with DISTINCT anchors: `tokenStart` exactly
 *    once, `tokenEnd` exactly once after it.
 *  - With TWIN anchors (`tokenStart === tokenEnd`, which is what real PML mods
 *    ship): one occurrence is the single anchor serving both ends — an EMPTY
 *    span, the func inserted right after it (this is ghosttoggle's actual
 *    shape against the real 0.6.2 bundle); two occurrences splice between
 *    them; three or more are ambiguous and refuse.
 */
export function applyPmlSplice(source: string, patch: PmlSplicePatch): SpliceResult {
  const where = patch.classRef === undefined ? '' : `${patch.classRef}.${patch.method ?? ''} `;
  if (!PML_SPLICE_TYPES.includes(patch.type)) {
    return {
      ok: false,
      reason: 'unsupported-mixin-type',
      detail: `PML mixin type '${patch.type}' is not token-anchored (${where.trim()}); this adapter carries INSERT, REPLACE, REPLACEBETWEEN and REMOVEBETWEEN only`,
    };
  }

  if (patch.type === 'INSERT' || patch.type === 'REPLACE') {
    const token = patch.token;
    if (typeof token !== 'string' || token.length === 0) {
      return { ok: false, reason: 'malformed-mixin', detail: 'no token to anchor on' };
    }
    if (patch.type === 'REPLACE' && typeof patch.func !== 'string') {
      return { ok: false, reason: 'malformed-mixin', detail: 'REPLACE needs replacement text (func)' };
    }
    const count = countOccurrences(source, token);
    if (count !== 1) {
      return {
        ok: false,
        reason: count === 0 ? 'token-not-found' : 'token-ambiguous',
        detail: `anchor token for ${where.trim() || 'this patch'} matches ${count} times in this file (it must match exactly once); the game build may differ from the one the mod was written for`,
      };
    }
    const at = source.indexOf(token);
    if (patch.type === 'INSERT') {
      // PML INSERT appends func immediately AFTER the anchor call — the
      // ghosttoggle shape is `token: 'call()', func: ';more();'`.
      const cut = at + token.length;
      return {
        ok: true,
        source: `${source.slice(0, cut)}${patch.func ?? ''}${source.slice(cut)}`,
        detail: `inserted ${patch.func?.length ?? 0} chars after the anchor in ${where.trim() || 'this file'}`,
      };
    }
    return {
      ok: true,
      source: `${source.slice(0, at)}${patch.func ?? ''}${source.slice(at + token.length)}`,
      detail: `replaced a ${token.length}-char anchor with ${(patch.func ?? '').length} chars in ${where.trim() || 'this file'}`,
    };
  }

  // REPLACEBETWEEN / REMOVEBETWEEN. The twin shape is not an edge case — it
  // is the COMMON one: ghosttoggle, a real mod on PML's CDN, passes the same
  // string as both anchors, and in the real 0.6.2 bundle that string occurs
  // exactly ONCE, so the single occurrence serves as both anchors and the
  // span is EMPTY — the func lands immediately after it. A twin with two
  // occurrences splices between them; three or more is ambiguous and refuses.
  const { tokenStart, tokenEnd } = patch;
  if (typeof tokenStart !== 'string' || tokenStart.length === 0) {
    return { ok: false, reason: 'malformed-mixin', detail: 'no tokenStart to anchor the range on' };
  }
  if (typeof tokenEnd !== 'string' || tokenEnd.length === 0) {
    return { ok: false, reason: 'malformed-mixin', detail: 'no tokenEnd to close the range' };
  }
  if (patch.type === 'REPLACEBETWEEN' && typeof patch.func !== 'string') {
    return { ok: false, reason: 'malformed-mixin', detail: 'REPLACEBETWEEN needs replacement text (func)' };
  }
  const twin = tokenStart === tokenEnd;
  const startCount = countOccurrences(source, tokenStart);
  if (startCount === 0) {
    return {
      ok: false,
      reason: 'token-not-found',
      detail: `range start anchor for ${where.trim() || 'this patch'} does not occur in this file`,
    };
  }
  if (!twin && startCount > 1) {
    return {
      ok: false,
      reason: 'token-ambiguous',
      detail: `range start anchor matches ${startCount} times in this file (it must match exactly once)`,
    };
  }
  if (twin && startCount > 2) {
    return {
      ok: false,
      reason: 'token-ambiguous',
      detail: `the anchor matches ${startCount} times, so the range it bounds is a guess (1 or 2 matches carry; 3+ refuse)`,
    };
  }
  const startAt = source.indexOf(tokenStart);
  const afterStart = startAt + tokenStart.length;
  let spanEnd: number;
  if (twin) {
    // Search past the start occurrence; no further hit means the one
    // occurrence IS both anchors — an empty span.
    const second = source.indexOf(tokenEnd, startAt + 1);
    spanEnd = second === -1 ? afterStart : Math.max(second, afterStart);
  } else {
    const endFirst = source.indexOf(tokenEnd, afterStart);
    if (endFirst === -1) {
      return {
        ok: false,
        reason: 'token-not-found',
        detail: `range end anchor does not occur after the start anchor for ${where.trim() || 'this patch'}`,
      };
    }
    const endCountAfterStart = countOccurrences(source.slice(afterStart), tokenEnd);
    if (endCountAfterStart !== 1) {
      return {
        ok: false,
        reason: 'token-ambiguous',
        detail: `range end anchor matches ${endCountAfterStart} times after the start anchor (it must match exactly once)`,
      };
    }
    spanEnd = endFirst;
  }
  const replacement = patch.type === 'REPLACEBETWEEN' ? patch.func! : '';
  const verb = patch.type === 'REPLACEBETWEEN' ? 'replaced' : 'removed';
  const shape = spanEnd === afterStart ? ' (an empty span, inserted at the single anchor)' : '';
  return {
    ok: true,
    source: `${source.slice(0, afterStart)}${replacement}${source.slice(spanEnd)}`,
    detail: `${verb} ${spanEnd - afterStart} chars between the anchors${shape} in ${where.trim() || 'this file'}`,
  };
}

/**
 * Parse a live `registerClassMixin(classRef, method, spec)` call into a patch
 * record, or say why it cannot be carried. This is the shim's gate: a spec
 * that fails here is REFUSED per call (the mod keeps running) exactly like
 * the unsupported families, and for the same reason — better a named refusal
 * the report shows than a record that silently does the wrong thing at boot.
 *
 * Deliberately accepts only STRING fields: a PML spec is data by the time it
 * reaches this API, and the whole point of collecting it is to persist and
 * re-apply it, which only survives for plain values.
 */
export function parsePmlMixinSpec(
  classRef: unknown,
  method: unknown,
  spec: unknown,
): { ok: true; patch: PmlSplicePatch } | { ok: false; reason: string } {
  if (typeof spec !== 'object' || spec === null) {
    return { ok: false, reason: 'the mixin spec is not an object' };
  }
  const s = spec as Record<string, unknown>;
  if (typeof s.type !== 'string') {
    return { ok: false, reason: 'the mixin spec has no type' };
  }
  const type = PML_SPLICE_TYPES.find((t) => t === s.type);
  if (type === undefined) {
    return {
      ok: false,
      reason: `mixin type '${s.type}' is not token-anchored — this adapter carries INSERT, REPLACE, REPLACEBETWEEN and REMOVEBETWEEN; ${s.type.startsWith('PATCH_') ? 'raw physics offsets are refused by the wasm gate' : 'method-extent mixins (HEAD/TAIL/OVERRIDE/CONSTRUCTOR) have no anchor this adapter can resolve'}`,
    };
  }
  const strField = (key: string): string | undefined =>
    typeof s[key] === 'string' ? (s[key] as string) : undefined;
  const patch: PmlSplicePatch = {
    op: 'pml-splice',
    type,
    ...(typeof classRef === 'string' ? { classRef } : {}),
    ...(typeof method === 'string' ? { method } : {}),
    ...(strField('token') === undefined ? {} : { token: strField('token')! }),
    ...(strField('tokenStart') === undefined ? {} : { tokenStart: strField('tokenStart')! }),
    ...(strField('tokenEnd') === undefined ? {} : { tokenEnd: strField('tokenEnd')! }),
    ...(strField('func') === undefined ? {} : { func: strField('func')! }),
  };
  // Structural completeness is checked at APPLY time too, but refusing an
  // obviously incomplete spec at COLLECT time means the report names the
  // mod's own bug the moment it registers, not one boot later.
  const needsToken = type === 'INSERT' || type === 'REPLACE';
  const needsRange = type === 'REPLACEBETWEEN' || type === 'REMOVEBETWEEN';
  if (needsToken && patch.token === undefined) {
    return { ok: false, reason: `${type} needs a 'token' to anchor on` };
  }
  if (needsRange && (patch.tokenStart === undefined || patch.tokenEnd === undefined)) {
    return { ok: false, reason: `${type} needs 'tokenStart' and 'tokenEnd' to bound the range` };
  }
  if (type === 'REPLACEBETWEEN' && patch.func === undefined) {
    return { ok: false, reason: 'REPLACEBETWEEN needs replacement text (func)' };
  }
  if (type === 'REPLACE' && patch.func === undefined) {
    return { ok: false, reason: 'REPLACE needs replacement text (func)' };
  }
  return { ok: true, patch };
}

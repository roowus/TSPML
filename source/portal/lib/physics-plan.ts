/**
 * @tspml/portal — how a mod's PHYSICS patches reach the served binary (#43).
 *
 * The mixin plan (#62) answers "what JS should the server patch into the bundle".
 * This answers the same question for `polytrack_physics.wasm`, and it is a separate
 * module rather than a field on that plan because almost nothing carries over:
 *
 *   - a mixin is JS text located by an anchor string; a physics patch is a float
 *     located by a FINGERPRINT of the function that holds it;
 *   - a mixin plan is validated by `parseUserPatchPlan`; a physics plan is validated
 *     by `@tspml/wasm`'s `checkPlan`, which is also what the mappings pipeline uses;
 *   - a mixin failure means one patch missed; a physics failure means a float written
 *     into an unverified address, so every gate here refuses rather than guesses.
 *
 * The carriage is the one thing they DO share, and deliberately so — it is the part
 * that was hard to get right (#62). The page projects enabled mods into a plan and
 * parks it in the Cache API; the service worker replays the game's wasm GET as a POST
 * with the plan as the body; the route hands it to `serveWasm`, which serves patched
 * bytes or vanilla ones and explains which in a header. A plan NEVER rides a query
 * param: `buildUpstream` forwards unknown params to Kodub, and a URL-carried payload
 * is a reflected-XSS vector on the portal origin. The server stores nothing.
 *
 * Everything here is pure (no browser globals) so the page, the tests, and any future
 * caller share one implementation.
 */
import type { UserModRecord } from './user-mods';
import { userModId } from './user-mods';

/** One constant rewrite as an author writes it in `physics.json`. Mirrors
 *  `@tspml/wasm`'s `WasmPatch`; kept structural (not imported) so this module stays
 *  free of the node-crypto-using package the page would otherwise pull in. */
export interface PhysicsPatch {
  /** Human label, shown in the report and in refusal strings. */
  readonly name: string;
  /** sha256 hex fingerprint of the function holding the constant. */
  readonly signature: string;
  /** The f32 currently at the site. Must occur exactly once in that function. */
  readonly oldValue: number;
  /** What to write. Stored as f32, so the server rounds it through `Math.fround`. */
  readonly newValue: number;
}

/**
 * The request-carried physics plan — exactly the shape `@tspml/wasm.checkPlan`
 * accepts, so the body the SW posts needs no translation at the route.
 *
 * `wasmHash` is BARE hex, no `sha256:` prefix. That differs from the map's pins on
 * purpose and it is not a style choice: this field is compared byte-for-byte against
 * `@tspml/wasm`'s own `wasmHash()` output, and a prefix here would fail every plan.
 */
export interface PhysicsPlan {
  readonly wasmHash: string;
  readonly patches: readonly PhysicsPatch[];
}

/**
 * Caps, enforced at paste time (the author hears it at once) and re-checked wherever
 * a plan is rebuilt. Small on purpose: a physics plan is a handful of tuning
 * constants, not a code payload, and every extra patch is another chance for the
 * all-or-nothing apply to refuse the whole set.
 */
export const PHYSICS_LIMITS = {
  maxPatchesPerMod: 16,
  maxPatchesTotal: 32,
} as const;

/** Cache API location the page writes and the SW reads. Separate key from the mixin
 *  plan's: the two bodies go to different URLs and are parsed by different validators,
 *  so one cache entry holding both would only ever be half-usable at either end. */
export const PHYSICS_CACHE = {
  name: 'tspml-physics-plan-v1',
  url: '/__tspml/physics-plan',
} as const;

/** What the SW reports back to the page after a wasm response (#43). There is no
 *  prelude to ride: a wasm response is a binary the game hands to
 *  `WebAssembly.instantiate`, so the outcome can only travel as headers, and only the
 *  SW can read them. It forwards this to every client as a postMessage. */
export const PHYSICS_REPORT_MESSAGE = 'tspml:physics-report';

/** The message body the SW posts. Field names mirror the `x-tspml-wasm-*` headers. */
export interface PhysicsReport {
  readonly type: typeof PHYSICS_REPORT_MESSAGE;
  readonly file: string;
  /** `vanilla` | `stale-pin` | `patched` | `plan-refused`, as the route reported it.
   *  Typed as string, not a union: it comes off a header the SW does not validate,
   *  and a status this build has never heard of must still reach the log verbatim
   *  rather than being coerced into a wrong one. */
  readonly status: string;
  readonly detail: string;
  readonly applied: number;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

/** Accept a hash written either way, and hand back the bare-hex form a plan needs.
 *  Authors copy pins out of the map (prefixed) and out of `shasum` (bare); refusing
 *  one of those would be a papercut with no safety value. Returns null if neither. */
function bareHex(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const hex = raw.trim().toLowerCase().replace(/^sha-?256:/, '');
  return SHA256_HEX_RE.test(hex) ? hex : null;
}

/** One patch, shallowly validated. Deep semantics (does this signature locate exactly
 *  one function, does `oldValue` sit in it) can only be answered against the binary,
 *  which lives server-side — `@tspml/wasm` owns that and reports honestly. */
function parsePatch(raw: unknown, i: number): { ok: true; patch: PhysicsPatch } | { ok: false; error: string } {
  if (!isRecord(raw)) return { ok: false, error: `patch ${i} is not an object` };
  const { name, signature, oldValue, newValue } = raw;
  if (typeof name !== 'string' || name.length === 0) {
    return { ok: false, error: `patch ${i} needs a non-empty "name"` };
  }
  if (typeof signature !== 'string' || !SHA256_HEX_RE.test(signature.trim().toLowerCase())) {
    return { ok: false, error: `patch '${name}' needs a 64-character hex "signature" (the function fingerprint)` };
  }
  if (typeof oldValue !== 'number' || !Number.isFinite(oldValue)) {
    return { ok: false, error: `patch '${name}' needs a finite numeric "oldValue"` };
  }
  if (typeof newValue !== 'number' || !Number.isFinite(newValue)) {
    // NaN or Infinity in a physics constant is not a tuning choice, it is a broken
    // sim — and one that fails at speed, minutes in, not at load.
    return { ok: false, error: `patch '${name}' needs a finite numeric "newValue" (NaN and Infinity break the sim)` };
  }
  return {
    ok: true,
    patch: { name, signature: signature.trim().toLowerCase(), oldValue, newValue },
  };
}

/**
 * Shallow paste-time validation of a `physics.json` paste:
 *
 * ```json
 * { "wasmHash": "d4ef…", "patches": [ { "name": "grip", "signature": "…",
 *                                       "oldValue": 1.05, "newValue": 1.4 } ] }
 * ```
 *
 * Same division of labour as `parseMixinsJson`: shape here, semantics server-side.
 */
export function parsePhysicsJson(
  text: string,
): { ok: true; plan: PhysicsPlan } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `physics.json is not valid JSON: ${(e as Error).message.slice(0, 80)}` };
  }
  return parsePhysicsObject(parsed);
}

/**
 * The same validation against an ALREADY-PARSED value — what a stored record holds.
 *
 * Split out so re-validating a stored `physics` object does not have to round-trip it
 * through `JSON.stringify`. The round trip is not merely wasteful: it can throw on a
 * cyclic object, and it would silently drop `undefined`-valued keys, so a stored shape
 * would validate here under rules the paste path never applied.
 */
export function parsePhysicsObject(
  parsed: unknown,
): { ok: true; plan: PhysicsPlan } | { ok: false; error: string } {
  if (!isRecord(parsed)) {
    return { ok: false, error: 'physics.json must be a JSON object (the contents of physics.json)' };
  }
  const wasmHash = bareHex(parsed.wasmHash);
  if (wasmHash === null) {
    // Without a pin there is nothing saying the author ever saw these bytes, and a
    // fingerprint derived from another build is exactly the unverified write this
    // whole path exists to refuse. Not defaultable.
    return {
      ok: false,
      error: 'physics.json needs "wasmHash": the sha256 of the exact binary these patches were derived against',
    };
  }
  const patches = parsed.patches;
  if (!Array.isArray(patches) || patches.length === 0) {
    return { ok: false, error: 'physics.json must have a non-empty "patches" array' };
  }
  if (patches.length > PHYSICS_LIMITS.maxPatchesPerMod) {
    return {
      ok: false,
      error: `physics.json has ${patches.length} patches — the limit is ${PHYSICS_LIMITS.maxPatchesPerMod}`,
    };
  }
  const out: PhysicsPatch[] = [];
  for (const [i, raw] of patches.entries()) {
    const r = parsePatch(raw, i);
    if (!r.ok) return r;
    out.push(r.patch);
  }
  return { ok: true, plan: { wasmHash, patches: out } };
}

/** Why a mod's physics patches were left out of the merged plan. Each one is
 *  surfaced to the author: a physics mod that silently does nothing is the single
 *  most confusing outcome this feature can produce. */
export interface PhysicsExclusion {
  readonly modId: string;
  readonly reason: 'hash-conflict' | 'over-cap' | 'duplicate-target' | 'malformed';
  readonly detail: string;
}

/**
 * Project the stored mods into ONE merged physics plan, or null when no enabled mod
 * declares any.
 *
 * The merge is where this differs most from the mixin plan, which keeps each mod's
 * patches in their own set and applies them per-mod isolated. It cannot work that way
 * here: there is one binary and one all-or-nothing apply, so every enabled mod's
 * patches land in a single `patches` array against a single `wasmHash`.
 *
 * Four ways a mod is dropped, all reported rather than silent:
 *
 *  - `malformed` — its stored `physics` does not parse under this build's rules. It
 *    passed paste-time validation, so this means a hand-edited store or an older
 *    build's shape. Report it; never throw, and never guess at a repair.
 *  - `hash-conflict` — it pinned a different binary than the first mod did. One of
 *    the two derived its fingerprints against a build the other never saw, and there
 *    is no way to tell from here which is current. Keeping the FIRST is arbitrary but
 *    stable; the point is that mixing them is not an option.
 *  - `duplicate-target` — two mods patch the same `signature` + `oldValue`. That is
 *    two mods fighting over one constant, and the server would refuse the whole plan
 *    for it ("two patches resolve to the same byte offset"). Dropping the later one
 *    keeps the earlier mod working instead of taking both down.
 *  - `over-cap` — the merged plan exceeded {@link PHYSICS_LIMITS.maxPatchesTotal}.
 */
export function buildPhysicsPlan(mods: readonly UserModRecord[]): {
  plan: PhysicsPlan | null;
  excluded: PhysicsExclusion[];
} {
  const excluded: PhysicsExclusion[] = [];
  const patches: PhysicsPatch[] = [];
  const seenSites = new Set<string>();
  let wasmHash: string | null = null;

  for (const mod of mods) {
    if (!mod.enabled || mod.physics === undefined) continue;
    const modId = userModId(mod);
    if (modId === null) continue; // id-less mods pre-fail in the loader anyway
    const parsed = parsePhysicsObject(mod.physics);
    if (!parsed.ok) {
      // Stored rows were validated at paste time, so this means the store was edited
      // by hand or written by an older build. Report, never throw.
      excluded.push({ modId, reason: 'malformed', detail: parsed.error });
      continue;
    }
    if (wasmHash === null) {
      wasmHash = parsed.plan.wasmHash;
    } else if (parsed.plan.wasmHash !== wasmHash) {
      excluded.push({
        modId,
        reason: 'hash-conflict',
        detail: `pins binary ${parsed.plan.wasmHash.slice(0, 12)} but an earlier mod pins ${wasmHash.slice(0, 12)} - only one build can be patched at a time`,
      });
      continue;
    }
    const fresh: PhysicsPatch[] = [];
    let clashed = false;
    for (const p of parsed.plan.patches) {
      const site = `${p.signature}:${p.oldValue}`;
      if (seenSites.has(site)) {
        excluded.push({
          modId,
          reason: 'duplicate-target',
          detail: `'${p.name}' targets a constant another enabled mod already patches`,
        });
        clashed = true;
        break;
      }
      fresh.push(p);
    }
    if (clashed) continue;
    if (patches.length + fresh.length > PHYSICS_LIMITS.maxPatchesTotal) {
      excluded.push({
        modId,
        reason: 'over-cap',
        detail: `the merged plan would exceed ${PHYSICS_LIMITS.maxPatchesTotal} patches`,
      });
      continue;
    }
    for (const p of fresh) seenSites.add(`${p.signature}:${p.oldValue}`);
    patches.push(...fresh);
  }

  if (wasmHash === null || patches.length === 0) return { plan: null, excluded };
  return { plan: { wasmHash, patches }, excluded };
}

/**
 * Read a SW postMessage and return it as a report, or null if it is not one.
 *
 * The page's message handler receives everything any worker posts, so this is a type
 * guard over untrusted-shaped data, not a cast.
 */
export function asPhysicsReport(data: unknown): PhysicsReport | null {
  if (!isRecord(data) || data.type !== PHYSICS_REPORT_MESSAGE) return null;
  const { file, status, detail, applied } = data;
  if (typeof file !== 'string' || typeof status !== 'string') return null;
  return {
    type: PHYSICS_REPORT_MESSAGE,
    file,
    status,
    detail: typeof detail === 'string' ? detail : '',
    applied: typeof applied === 'number' && Number.isFinite(applied) ? applied : 0,
  };
}

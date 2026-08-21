/**
 * @tspml/portal — serving the physics WASM through the proxy (#43).
 *
 * The physics binary is the one part of PolyTrack the bundle transform cannot reach.
 * `polytrack_physics.wasm` is fetched as its own file, never passes through babel, and
 * until now the proxy streamed it straight from Kodub to the game. That is why "you
 * can't change how the car drives" was still true of TSPML.
 *
 * This module is the serving half. It answers one question — *what bytes do we send for
 * this binary* — and it answers it fail-closed at every step:
 *
 *   1. the file must be an allowlisted {@link WasmSurface} (map data, not a constant);
 *   2. the live bytes must hash to the pin, or they are served vanilla;
 *   3. a plan, if any, must survive `@tspml/wasm`'s own gates (unique function, unique
 *      constant site, finite values, all-or-nothing).
 *
 * Steps 2 and 3 are independent on purpose. The pin says "these are the bytes the plan
 * was authored against"; the structural locator re-derives every address from the bytes
 * in hand and refuses on ambiguity. Either alone would be weaker than both: a pin cannot
 * tell you a fingerprint still matches exactly one function, and a locator cannot tell
 * you the plan's author ever saw this build.
 *
 * ── Why this is not part of the JS transform path ────────────────────────────
 * A `TransformSurface` means "text you may run babel over". Reading a 396 KB binary with
 * `.text()` replaces every non-UTF-8 byte with U+FFFD and yields a plausible string that
 * flows onward silently. The types are kept disjoint so that path cannot be written; see
 * the note on `WasmSurface` in lib/transform-surface.ts.
 *
 * The locator and writer themselves live in `@tspml/wasm`, shared with the mappings
 * pipeline — one implementation of a fail-closed binary patcher, two callers.
 */
import { createHash } from 'node:crypto';

import { applyF32Patches } from '@tspml/wasm';
import mapJson from '@tspml/mappings/maps/polytrack-0.6.2.json';
import { validateMap } from '@tspml/mappings';
import type { GameMap } from '@tspml/mappings';

import { wasmSurfaceFor } from './transform-surface';
import type { WasmSurface } from './transform-surface';

const MAP: GameMap = validateMap(mapJson);

/**
 * The wasm surface for a proxied path against the pinned map, or null to proxy
 * verbatim. Thin wrapper binding the real MAP so the route need not import one.
 */
export function wasmSurfaceForPath(
  isDefaultHost: boolean,
  segments: readonly string[],
): WasmSurface | null {
  return wasmSurfaceFor(MAP, isDefaultHost, segments);
}

/** Why the served bytes are what they are — reported on the response, never guessed at
 *  from outside. `vanilla` and `stale-pin` both mean "unmodified bytes", and keeping
 *  them distinct is the point: one is "nobody asked for a patch", the other is "someone
 *  did and we refused", and a mod author must be able to tell those apart. */
export type WasmServeStatus = 'vanilla' | 'stale-pin' | 'patched' | 'plan-refused';

export interface WasmServeResult {
  /** The bytes to send. Always valid wasm: on any refusal these are the upstream bytes. */
  readonly bytes: Uint8Array;
  readonly status: WasmServeStatus;
  /** sha256 of the UPSTREAM bytes, `sha256:`-prefixed. */
  readonly vanillaHash: string;
  /** Human-readable reason, for the detail header. Short enough to be a header value. */
  readonly detail: string;
  /** Number of patches applied; 0 unless `status` is `'patched'`. */
  readonly applied: number;
  /** Always `'warn'` when patches applied — physics tuning is ranked-play-relevant by
   *  definition. Null when nothing was applied. Warn-only, never a block. */
  readonly leaderboardRisk: 'warn' | null;
}

/** `sha256:`-prefixed hash of some bytes, in the form the map pins use. */
export function hashBytes(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

/** Compare pins tolerantly of the `sha256:` prefix and case, like the map resolvers do.
 *  It cannot cause a false match: different bytes differ in at least one hex digit. */
function sameHash(a: string, b: string): boolean {
  const norm = (h: string): string => h.trim().toLowerCase().replace(/^sha-?256:/, '');
  return norm(a) === norm(b);
}

/**
 * Decide the bytes to serve for one wasm request.
 *
 * NEVER throws and never returns anything but valid wasm: every failure path returns the
 * upstream bytes unchanged, because the alternative to a patched physics sim is a
 * working one, not a broken one. A game that boots vanilla is a mod that did not apply;
 * a game handed corrupt bytes is a crash with no explanation.
 *
 * `plan` is the untrusted, request-carried patch plan (#63) — `unknown` by design, since
 * it arrives in a POST body. `@tspml/wasm`'s `checkPlan` is what validates its shape;
 * this function never inspects its fields.
 *
 * `planError` is for the one thing the caller knows and this function cannot: the body
 * was there but could not be turned into a plan at all (oversized, or not JSON). That
 * has to reach the response as `plan-refused` rather than `vanilla` — the two serve
 * identical bytes, and collapsing them would tell a mod author "nobody asked" when the
 * truth is "we could not read what you sent".
 */
export function serveWasm(
  upstream: Uint8Array,
  surface: WasmSurface,
  plan: unknown = null,
  planError: string | null = null,
): WasmServeResult {
  const vanillaHash = hashBytes(upstream);

  // Gate 1: are these the bytes every fingerprint was derived against? A recompiled
  // binary is not an error — it is the expected state after a PolyTrack release, and the
  // honest response is vanilla physics plus a header saying why.
  if (!sameHash(vanillaHash, surface.expectedHash)) {
    return {
      bytes: upstream,
      status: 'stale-pin',
      vanillaHash,
      detail: `live ${surface.file} is not the pinned build (${surface.expectedHash} expected) - serving vanilla physics`,
      applied: 0,
      leaderboardRisk: null,
    };
  }

  // A plan was sent and never became one. Same bytes as vanilla, different story.
  if (planError !== null) {
    return {
      bytes: upstream,
      status: 'plan-refused',
      vanillaHash,
      detail: `physics plan refused: ${planError}`,
      applied: 0,
      leaderboardRisk: null,
    };
  }

  // Pinned bytes, but nobody asked for a change. Serve them untouched: there is no
  // "identity patch" worth the risk of a round-trip through the writer.
  if (plan === null || plan === undefined) {
    return {
      bytes: upstream,
      status: 'vanilla',
      vanillaHash,
      detail: `no physics patches requested for ${surface.file}`,
      applied: 0,
      leaderboardRisk: null,
    };
  }

  // Gate 2 and 3 live in @tspml/wasm: plan shape, the plan's own hash pin, unique
  // function per signature, unique constant site per value, finite values, and
  // all-or-nothing application.
  const r = applyF32Patches(upstream, plan);
  if (!r.ok) {
    return {
      bytes: upstream,
      status: 'plan-refused',
      vanillaHash,
      // The reason is generated by @tspml/wasm from plan data. It reaches a response
      // HEADER, which is a ByteString: a non-Latin-1 character there throws inside the
      // response constructor and the request dies with no body at all (#106). Sanitising
      // is the caller's job in setDetailHeader, but keeping it short is this one's.
      detail: `physics plan refused: ${r.reason}`,
      applied: 0,
      leaderboardRisk: null,
    };
  }

  return {
    bytes: r.bytes,
    status: 'patched',
    vanillaHash,
    detail: r.report.applied.map((p) => `${p.name}: ${p.oldValue} -> ${p.newValue}`).join(' | '),
    applied: r.report.applied.length,
    leaderboardRisk: r.report.leaderboardRisk,
  };
}

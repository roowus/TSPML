/**
 * @tspml/portal — the user-mixin patch PLAN: how pasted mixins reach the
 * server transform (#62).
 *
 * The problem this solves: user mods live in this browser's localStorage, but
 * the mixin transform runs server-side in the proxy route, on a stateless
 * Vercel lambda. The bridge is REQUEST-CARRIED patches:
 *
 *   page  — projects enabled mods' pasted mixins into a `UserPatchPlan` and
 *           writes it to the Cache API (`PLAN_CACHE`) before the iframe mounts;
 *   sw    — intercepts the game's same-origin `main.bundle.js` GET; when a plan
 *           exists it replays the request as a POST with the plan as the body
 *           (no plan → plain GET, byte-identical to the pre-#62 path);
 *   route — parses the plan defensively (`parseUserPatchPlan`), applies each
 *           mod's patches alongside the base transform (per-mod isolated), and
 *           serves the result with the per-mod report riding INSIDE the bundle
 *           as a `window.__tspmlUserMixins` prelude the page reads cross-frame.
 *
 * Why this shape (judged design competition, #62):
 * - Query-param carriage is DISQUALIFIED: the payload would ride any request
 *   URL, so a crafted `/api/proxy/?um=...` link becomes reflected XSS on the
 *   portal origin (nothing binds a URL to the session that pasted it) — and
 *   `buildUpstream` forwards unknown params to Kodub. A POST body read from
 *   the Cache API is writable only by same-origin JS and dies with the request.
 * - Client-side transform is REJECTED: it ships Babel (~1.5 MB) to every
 *   visitor inside the SW and re-implements the fail-closed story.
 * - The server stores NOTHING: the plan exists in the request body and the
 *   lambda's locals, and the response is `no-store` — no cross-user leakage
 *   surface by construction.
 *
 * This module is pure (no browser or node globals) so the page, the route, and
 * the unit tests all import the same limits and shapes.
 */

import type { UserModRecord } from './user-mods';
import { userModId } from './user-mods';
import { modMixinsApplyToHost } from './mixin-env';

/** One enabled mod's pasted mixin patches, keyed by its claimed manifest id. */
export interface UserPatchSet {
  readonly modId: string;
  readonly patches: readonly Record<string, unknown>[];
}

/** The request-carried plan. `v` guards future shape changes fail-closed. */
export interface UserPatchPlan {
  readonly v: 1;
  readonly sets: readonly UserPatchSet[];
}

/**
 * Caps enforced at ADD time (the author hears it immediately) and re-checked
 * server-side (the body is still attacker-shaped input). Sized for real inject
 * code with an order of magnitude of headroom over typical mod mixins,
 * while bounding the Babel work a request can demand of the lambda.
 */
export const USER_PATCH_LIMITS = {
  maxMods: 16,
  maxPatchesPerMod: 32,
  maxInjectChars: 32_768,
  maxBodyBytes: 262_144,
} as const;

/** Cache API location the page writes and the SW reads. The URL is a reserved
 *  synthetic key — nothing is ever served from it. */
export const PLAN_CACHE = {
  name: 'tspml-user-patches-v1',
  url: '/__tspml/user-patch-plan',
} as const;

/** Where the per-mod apply report rides: prepended to the served bundle as
 *  `;window.__tspmlUserMixins = {...};` and read off the same-origin game frame
 *  by page.tsx after `load` (deferred scripts run before window `load`). */
export const REPORT_GLOBAL = '__tspmlUserMixins';

/** One mod's transform outcome, as reported inside the bundle prelude. */
export interface UserMixinModReport {
  readonly modId: string;
  readonly declared: number;
  readonly applied: number;
  readonly failed: readonly { readonly reason: string; readonly detail: string }[];
}

/** The whole report: plan-level status plus per-mod rows. */
export interface UserMixinReport {
  readonly v: 1;
  /** 'applied' = user patches composed into the served bundle (possibly with
   *  per-mod failures); the rest explain why NO user patch ran. */
  readonly planStatus:
    | 'applied'
    | 'plan-invalid'
    | 'plan-too-large'
    | 'base-failed'
    | 'output-invalid';
  readonly mods: readonly UserMixinModReport[];
  /**
   * Which served file this report describes (#98) — `'main.bundle.js'` or a
   * `<id>.bundle.js` chunk. Optional because a pre-#98 prelude has no such field;
   * absent means the main bundle.
   */
  readonly surface?: string;
  /**
   * Chunk reports merged in by a chunk prelude, keyed by `<id>.bundle.js` (#98).
   * Only ever present on the MAIN report living at `window.__tspmlUserMixins` —
   * each value is itself a whole-file report carrying its own `surface`.
   */
  readonly chunks?: Readonly<Record<string, UserMixinReport>>;
}

/** The DOM event a CHUNK prelude dispatches on `window` after merging itself in. */
export const CHUNK_REPORT_EVENT = 'tspml:chunk-mixins';

/** One served file's rows, for display. */
export interface SurfaceReport {
  /** `'main.bundle.js'` or `'<id>.bundle.js'`. */
  readonly file: string;
  readonly report: UserMixinReport;
}

/** Numeric ordering for `<id>.bundle.js` keys — `'535'` before `'1120'`, which
 *  a lexicographic sort gets backwards. Non-numeric keys sort last, by string. */
function chunkFileOrder(a: string, b: string): number {
  const na = Number.parseInt(a, 10);
  const nb = Number.parseInt(b, 10);
  const aNum = Number.isFinite(na);
  const bNum = Number.isFinite(nb);
  if (aNum && bNum) return na - nb;
  if (aNum) return -1;
  if (bNum) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Flatten a main report plus its merged chunk reports (#98) into per-file rows:
 * main first, then chunks by ascending id.
 *
 * The UI shows them SEPARATELY rather than summing the counts, because the plan
 * carries every mod's whole patch list to every surface: a mixin anchored inside
 * the editor chunk is declared once but ATTEMPTED twice, so it legitimately reads
 * 0/1 on main and 1/1 on `112.bundle.js`. Adding those together would invent a
 * "1/2 applied" that describes nothing the author wrote. {@link modAppliedOn}
 * supplies the missing context instead.
 */
export function surfaceReports(report: UserMixinReport): SurfaceReport[] {
  const out: SurfaceReport[] = [{ file: report.surface ?? 'main.bundle.js', report }];
  const chunks = report.chunks;
  if (chunks) {
    for (const file of Object.keys(chunks).sort(chunkFileOrder)) {
      const r = chunks[file];
      if (r) out.push({ file, report: r });
    }
  }
  return out;
}

/** The other files where `modId` applied at least one patch — the answer to
 *  "why is this mod red here but the mixin clearly works?". */
export function modAppliedOn(
  reports: readonly SurfaceReport[],
  modId: string,
  exceptFile: string,
): string[] {
  return reports
    .filter((s) => s.file !== exceptFile && s.report.mods.some((m) => m.modId === modId && m.applied > 0))
    .map((s) => s.file);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** True when a single patch respects the inject-size cap (non-string inject —
 *  e.g. a malformed patch — passes here and fails honestly in the engine).
 *  A PML splice's payload field is `func`, so it is capped the same way. */
function withinInjectCap(patch: Record<string, unknown>): boolean {
  if (typeof patch.inject === 'string' && patch.inject.length > USER_PATCH_LIMITS.maxInjectChars) {
    return false;
  }
  return typeof patch.func !== 'string' || patch.func.length <= USER_PATCH_LIMITS.maxInjectChars;
}

/**
 * Project the stored mods into a plan: enabled ∧ has a manifest id ∧ has pasted
 * mixins ∧ the manifest's mixin descriptors apply to this (web) host (#21).
 * Mods exceeding a cap are EXCLUDED from the plan and returned in `overCap`;
 * mods whose declared mixins all name another environment land in `envSkipped`
 * — both so the page can pre-report them honestly instead of shipping a plan
 * the server would reject or the author believing patches ran that didn't.
 */
export function buildUserPatchPlan(mods: readonly UserModRecord[]): {
  plan: UserPatchPlan;
  overCap: string[];
  envSkipped: string[];
} {
  const sets: UserPatchSet[] = [];
  const overCap: string[] = [];
  const envSkipped: string[] = [];
  for (const mod of mods) {
    // A PML mod's plan content is its COLLECTED splice specs (`pmlMixins`),
    // not a pasted mixins.json — either can be absent. One set per mod, both
    // kinds together, because the caps and the report are per mod, not per
    // patch kind.
    //
    // Array.isArray rather than `?? []`: localStorage is hand-editable and
    // has survived many deploys — a truthy NON-array here (an object, a
    // string) would throw in the spread below, and a throw in plan parking
    // used to hang the boot overlay forever. Non-array shapes read as
    // "nothing to carry", which is the truth of them.
    const patches = [
      ...(Array.isArray(mod.mixins) ? mod.mixins : []),
      ...(Array.isArray(mod.pmlMixins) ? mod.pmlMixins : []),
    ];
    if (!mod.enabled || patches.length === 0) continue;
    const modId = userModId(mod);
    if (modId === null) continue; // id-less mods pre-fail in the loader anyway
    if (!modMixinsApplyToHost(mod.manifest)) {
      envSkipped.push(modId);
      continue;
    }
    if (patches.length > USER_PATCH_LIMITS.maxPatchesPerMod || !patches.every(withinInjectCap)) {
      overCap.push(modId);
      continue;
    }
    sets.push({ modId, patches });
  }
  // maxMods: keep the FIRST N (stored order = add order) and flag the rest.
  while (sets.length > USER_PATCH_LIMITS.maxMods) {
    const dropped = sets.pop();
    if (dropped) overCap.push(dropped.modId);
  }
  return { plan: { v: 1, sets }, overCap, envSkipped };
}

/**
 * Stable fingerprint of a plan, for change detection only (NOT integrity):
 * "did the effective patch set change since the served bundle was fetched?"
 * FNV-1a over the canonical JSON — collisions merely miss a restart banner.
 */
export function planFingerprint(plan: UserPatchPlan): string {
  const canonical = JSON.stringify(plan.sets.map((s) => [s.modId, s.patches]));
  let h = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) {
    h ^= canonical.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Server-side defensive re-validation of a request body that CLAIMS to be a
 * plan. Returns null on any shape or cap violation — the route then serves the
 * base transform with `planStatus: 'plan-invalid'` (never a 4xx: this response
 * is the `<script>` the game executes, so a bad plan must degrade, not break
 * the boot).
 */
export function parseUserPatchPlan(raw: unknown): UserPatchPlan | null {
  if (!isRecord(raw) || raw.v !== 1 || !Array.isArray(raw.sets)) return null;
  if (raw.sets.length > USER_PATCH_LIMITS.maxMods) return null;
  const sets: UserPatchSet[] = [];
  const seen = new Set<string>();
  for (const entry of raw.sets) {
    if (!isRecord(entry)) return null;
    const { modId, patches } = entry;
    if (typeof modId !== 'string' || modId.length === 0 || seen.has(modId)) return null;
    if (!Array.isArray(patches) || patches.length === 0) return null;
    if (patches.length > USER_PATCH_LIMITS.maxPatchesPerMod) return null;
    if (!patches.every((p): p is Record<string, unknown> => isRecord(p) && withinInjectCap(p))) return null;
    seen.add(modId);
    sets.push({ modId, patches: patches as Record<string, unknown>[] });
  }
  return { v: 1, sets };
}

/**
 * Serialize the report as the bundle prelude. `JSON.stringify` output contains
 * no raw `<` escapes issues here (this is a JS file, not inline HTML), but
 * `</script>`-safe hygiene costs nothing: escape forward slashes after `<`.
 *
 * MAIN vs CHUNK (#98). A chunk executes LONG after the main bundle — when the player
 * opens the editor, possibly minutes in — so a chunk prelude must not do what the main
 * one does. Two differences, both load-bearing:
 *
 *  - it MERGES into `chunks[file]` instead of assigning `window.__tspmlUserMixins`.
 *    A plain assignment would erase the main bundle's report, silently blanking every
 *    row the mixin panel is already showing.
 *  - it dispatches {@link CHUNK_REPORT_EVENT}, because page.tsx reads the global on
 *    iframe `load` and that fired long ago. Without a signal the rows would exist in
 *    the frame and never reach the UI.
 *
 * The chunk prelude is defensive about the main report being absent (transform off for
 * main, or a chunk that somehow loads first): it creates the container rather than
 * throwing inside the game's own script.
 */
export function reportPrelude(report: UserMixinReport): string {
  const json = JSON.stringify(report).replace(/<\//g, '<\\/');
  const surface = report.surface;
  if (surface === undefined || surface === 'main.bundle.js') {
    return `;window.${REPORT_GLOBAL}=${json};\n`;
  }
  const key = JSON.stringify(surface).replace(/<\//g, '<\\/');
  return (
    `;(function(){var r=${json},w=window,m=w.${REPORT_GLOBAL};` +
    `if(!m||typeof m!=="object"){m=w.${REPORT_GLOBAL}={v:1,planStatus:"applied",mods:[],chunks:{}};}` +
    `if(!m.chunks){m.chunks={};}m.chunks[${key}]=r;` +
    `try{w.dispatchEvent(new CustomEvent(${JSON.stringify(CHUNK_REPORT_EVENT)},{detail:r}));}catch(e){}` +
    `})();\n`
  );
}

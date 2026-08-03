// diff.mjs — structured diff between two GameMaps (the human-review core of M9).
//
// On every PolyTrack release, `gen-map.mjs` regenerates a CANDIDATE map by
// re-matching the fixed 0.6.0 renamed source modules against the new build's
// webcrack-unpacked modules. A human then reviews the candidate against the
// committed map before promoting it. This module automates that review: it
// answers the four questions a reviewer actually asks —
//
//   1. Did the bundle change at all?               (bundleHash)
//   2. Did the modules my mixins depend on move?   (moduleId relocation)
//   3. Did any mod-facing stable name relocate?    (stableName index drift)
//   4. Are the hand-curated `targets` at risk?     (target → module correlation)
//
// It is PURE: no I/O, no network, no bundle parsing. That keeps it unit-testable
// with fixture maps (CI-runnable) — the bundle-level anchor check that *proves* a
// carried-forward target still resolves is the separate `verify-targets.mjs` step,
// which reads the unpacked code. The diff's job is to flag WHAT MOVED and WHAT TO
// RE-VERIFY; verify-targets' job is to CONFIRM the anchors survived.
//
// CROSS-VERSION IDENTITY. A regen always matches the SAME source (the fixed
// `v060-renamed` 0.6.0 bundle) against a new target, so every matched module
// carries a stable `sourceModuleId` (a 0.6.0 webcrack id) that is IDENTICAL across
// versions. We therefore key modules by `sourceModuleId`, NOT by the concept slug
// (the slug is derived from the scorer's chosen stable names and drifts between
// regens — keying by it would mis-pair modules). moduleId (the new build's webcrack
// id) is what relocates; sourceModuleId is what stays put.
//
// Usage (programmatic):  import { diffMaps, formatDiff } from "../src/diff.mjs";
// Usage (CLI):           node scripts/regen.mjs --diff prev.json next.json

/** @typedef {import("../../../source/mappings/src/types.ts").GameMap} GameMap */
/** @typedef {import("../../../source/mappings/src/types.ts").ModuleEntry} ModuleEntry */
/** @typedef {import("../../../source/mappings/src/types.ts").TargetSpec} TargetSpec */

/** A match-weight drop large enough to flag for manual review: >=50% relative. Scale-
 *  invariant — matcher weights span ~6–14000, so an absolute floor would fire on noise
 *  for heavy modules (a 40-point drop on a 13k-weight module is 0.3%). */
const CONF_DROP_RELATIVE = 0.5;

/**
 * Index a map's modules by their stable cross-version key (sourceModuleId).
 * @param {GameMap} map
 * @returns {Map<string, ModuleEntry>} sourceModuleId -> entry
 */
function indexBySourceModule(map) {
  const idx = new Map();
  for (const entry of Object.values(map.modules)) {
    // sourceModuleId is unique within a map (gen-map emits one entry per source
    // module); last-wins is defensive but should never trigger.
    idx.set(entry.sourceModuleId, entry);
  }
  return idx;
}

/**
 * Build a stable-name -> moduleId index (lowercased name; first-wins on collision,
 * matching gen-map.mjs's `stableIndex`). Used to detect stable-name relocation.
 * @param {GameMap} map
 * @returns {Map<string, string>} lowercased stable name -> moduleId
 */
function stableNameIndex(map) {
  const idx = new Map();
  for (const entry of Object.values(map.modules)) {
    for (const name of entry.stableNames) {
      const k = name.toLowerCase();
      if (!idx.has(k)) idx.set(k, entry.moduleId);
    }
  }
  return idx;
}

/**
 * Correlate a version-agnostic target to the module (by sourceModuleId) it most
 * likely resolves into, by MAXIMUM overlap of the target's anchor literals with the
 * module's stable names (case-insensitive, >= 1 shared literal).
 *
 * Why max-overlap, not subset: a module's `stableNames` is the scorer's top-~6
 * representative picks — NOT an exhaustive list of every literal in the module. A
 * target's anchor (e.g. [CreateCar, ControlCar, TestDeterminism]) may have literals
 * the scorer didn't pick (e.g. the committed Car module lists ControlCar +
 * TestDeterminism but not CreateCar), so requiring ALL literals present would fail
 * to correlate a target that clearly belongs to that module. The anchor literals are
 * distinctive game enum members, so even 1–2 shared is a strong signal; the
 * AUTHORITATIVE all-literals check is verify-targets against the unpacked bundle.
 * Heuristic by design; documented as such.
 * @param {GameMap} map
 * @param {TargetSpec} target
 * @returns {string | undefined} sourceModuleId of the best-overlap module, or undefined
 */
function sourceModuleForTarget(map, target) {
  const need = (target.anchor.literals ?? []).map((l) => String(l).toLowerCase());
  if (need.length === 0) return undefined;
  let best = undefined; // { srcId, overlap }
  for (const entry of Object.values(map.modules)) {
    const have = new Set(entry.stableNames.map((n) => n.toLowerCase()));
    let overlap = 0;
    for (const l of need) if (have.has(l)) overlap += 1;
    if (overlap === 0) continue;
    if (!best || overlap > best.overlap) best = { srcId: entry.sourceModuleId, overlap };
  }
  return best?.srcId;
}

/**
 * @typedef {Object} RelocatedModule
 * @property {string} sourceModuleId  stable cross-version id
 * @property {string} concept         human label (from the new map)
 * @property {string} fromModule      moduleId in prev
 * @property {string} toModule        moduleId in next
 * @property {number} fromWeight      matchWeight in prev
 * @property {number} toWeight        matchWeight in next
 * @property {number} weightDelta     toWeight - fromWeight
 * @property {string[]} stableNamesAdded
 * @property {string[]} stableNamesRemoved
 */

/**
 * @typedef {Object} StableNameRelocation
 * @property {string} name
 * @property {string} fromModule
 * @property {string} toModule
 */

/**
 * @typedef {Object} TargetImpact
 * @property {string} target          target stable name (e.g. "Car.controlCar")
 * @property {string} [fromModule]    moduleId it resolved into in prev
 * @property {string} [toModule]      moduleId it resolves into in next (if correlatable)
 * @property {"relocated" | "orphaned" | "unresolved"} reason
 * @property {string} note
 */

/**
 * @typedef {Object} ConfidenceDrop
 * @property {string} sourceModuleId
 * @property {string} concept
 * @property {number} fromWeight
 * @property {number} toWeight
 * @property {number} weightDelta
 */

/**
 * @typedef {Object} MapDiff
 * @property {string} prevVersion
 * @property {string} nextVersion
 * @property {boolean} bundleHashChanged
 * @property {string} [prevBundleHash]
 * @property {string} [nextBundleHash]
 * @property {{ matched: number, relocated: RelocatedModule[], added: ModuleEntry[], removed: ModuleEntry[] }} modules
 * @property {{ relocated: StableNameRelocation[], added: string[], removed: string[] }} stableNames
 * @property {{ newlyResolved: string[], newlyUnresolved: string[] }} unresolved
 * @property {TargetImpact[]} targetImpacts
 * @property {ConfidenceDrop[]} confidenceDrops
 * @property {"none" | "low" | "high"} riskLevel
 * @property {string} summary
 */

/**
 * Compute a structured diff between a committed (prev) and candidate (next) map.
 * Pure — no I/O. See module header for the cross-version identity rationale.
 * @param {GameMap} prev
 * @param {GameMap} next
 * @returns {MapDiff}
 */
export function diffMaps(prev, next) {
  const prevMods = indexBySourceModule(prev);
  const nextMods = indexBySourceModule(next);
  const prevSn = stableNameIndex(prev);
  const nextSn = stableNameIndex(next);
  const prevUnresolved = new Set(prev.unresolved.map((u) => u.sourceModuleId));
  const nextUnresolved = new Set(next.unresolved.map((u) => u.sourceModuleId));

  // --- modules: match by sourceModuleId, classify relocated/added/removed ---
  /** @type {RelocatedModule[]} */
  const relocated = [];
  /** @type {ModuleEntry[]} */
  const added = [];
  /** @type {ModuleEntry[]} */
  const removed = [];
  /** @type {ConfidenceDrop[]} */
  const confidenceDrops = [];
  let matched = 0;

  for (const [srcId, prevEntry] of prevMods) {
    const nextEntry = nextMods.get(srcId);
    if (!nextEntry) { removed.push(prevEntry); continue; }
    matched += 1;
    const fromWeight = prevEntry.matchWeight ?? 0;
    const toWeight = nextEntry.matchWeight ?? 0;
    const weightDelta = toWeight - fromWeight;
    // confidence drop: the match still holds but is markedly weaker (>=50% relative) —
    // the anchors the matcher agreed on shrank, so re-verify even if moduleId is stable.
    const dropped = fromWeight > 0 && toWeight / fromWeight <= 1 - CONF_DROP_RELATIVE;
    if (dropped) {
      confidenceDrops.push({ sourceModuleId: srcId, concept: nextEntry.concept, fromWeight, toWeight, weightDelta });
    }
    if (prevEntry.moduleId !== nextEntry.moduleId) {
      const prevNames = new Set(prevEntry.stableNames.map((n) => n.toLowerCase()));
      const nextNames = new Set(nextEntry.stableNames.map((n) => n.toLowerCase()));
      relocated.push({
        sourceModuleId: srcId,
        concept: nextEntry.concept,
        fromModule: prevEntry.moduleId,
        toModule: nextEntry.moduleId,
        fromWeight,
        toWeight,
        weightDelta,
        stableNamesAdded: nextEntry.stableNames.filter((n) => !prevNames.has(n.toLowerCase())),
        stableNamesRemoved: prevEntry.stableNames.filter((n) => !nextNames.has(n.toLowerCase())),
      });
    }
  }
  for (const [srcId, nextEntry] of nextMods) if (!prevMods.has(srcId)) added.push(nextEntry);

  // --- stable names: relocation / added / removed (by lowercased name) ---
  /** @type {StableNameRelocation[]} */
  const snRelocated = [];
  const snAdded = [];
  const snRemoved = [];
  for (const [name, fromMod] of prevSn) {
    const toMod = nextSn.get(name);
    if (toMod === undefined) snRemoved.push(name);
    else if (toMod !== fromMod) snRelocated.push({ name, fromModule: fromMod, toModule: toMod });
  }
  for (const name of nextSn.keys()) if (!prevSn.has(name)) snAdded.push(name);

  // --- unresolved: newly resolved (good) / newly unresolved (regression) ---
  const newlyResolved = [...prevUnresolved].filter((id) => !nextUnresolved.has(id) && nextMods.has(id));
  const newlyUnresolved = [...nextUnresolved].filter((id) => !prevUnresolved.has(id));

  // --- targets: correlate each carried-forward target to its module, flag risk ---
  /** @type {TargetImpact[]} */
  const targetImpacts = [];
  const targetNames = new Set([...Object.keys(prev.targets ?? {}), ...Object.keys(next.targets ?? {})]);
  for (const tname of targetNames) {
    const target = (prev.targets ?? {})[tname] ?? (next.targets ?? {})[tname];
    if (!target) continue;
    const prevSrc = sourceModuleForTarget(prev, target);
    const nextSrc = sourceModuleForTarget(next, target);
    const prevMod = prevSrc ? prevMods.get(prevSrc)?.moduleId : undefined;
    const nextMod = nextSrc ? nextMods.get(nextSrc)?.moduleId : undefined;
    // Check "became unresolved" by prevSrc (cross-version-stable id) against
    // next.unresolved — NOT via sourceModuleForTarget(next), which only scans
    // `modules` (an unresolved module is in `unresolved`, not `modules`).
    if (prevSrc && nextUnresolved.has(prevSrc)) {
      targetImpacts.push({
        target: tname, fromModule: prevMod, toModule: undefined,
        reason: "unresolved",
        note: `backing module ${prevSrc} became UNRESOLVED in the new build — target cannot bind`,
      });
    } else if (prevMod && nextMod && prevMod !== nextMod) {
      targetImpacts.push({
        target: tname, fromModule: prevMod, toModule: nextMod,
        reason: "relocated",
        note: `backing module moved ${prevMod} -> ${nextMod}; re-verify the anchor still resolves`,
      });
    } else if (prevSrc && !nextSrc) {
      targetImpacts.push({
        target: tname, fromModule: prevMod, toModule: undefined,
        reason: "orphaned",
        note: `anchor literals no longer map to a module in the new map — verify against the unpacked bundle`,
      });
    }
    // else: target stable (or brand-new in both) — no impact.
  }

  // --- risk level + summary ---
  const riskLevel =
    targetImpacts.length > 0 || newlyUnresolved.some((id) => backsAnyTarget(id, prev, prevMods))
      ? "high"
      : relocated.length > 0 || confidenceDrops.length > 0 || snRelocated.length > 0
        ? "low"
        : "none";

  const summary = summarize({
    prev, next, matched, relocated, added, removed, snRelocated, snAdded, snRemoved,
    newlyResolved, newlyUnresolved, targetImpacts, confidenceDrops, riskLevel,
  });

  return {
    prevVersion: prev.gameVersion,
    nextVersion: next.gameVersion,
    bundleHashChanged: prev.bundleHash !== next.bundleHash,
    prevBundleHash: prev.bundleHash,
    nextBundleHash: next.bundleHash,
    modules: { matched, relocated, added, removed },
    stableNames: { relocated: snRelocated, added: snAdded, removed: snRemoved },
    unresolved: { newlyResolved, newlyUnresolved },
    targetImpacts,
    confidenceDrops,
    riskLevel,
    summary,
  };
}

/**
 * Does a (now-unresolved) source module back any carried-forward target in prev?
 * Used to escalate newly-unresolved modules that take a target down with them.
 */
function backsAnyTarget(srcId, prev, prevMods) {
  const targets = prev.targets ?? {};
  for (const target of Object.values(targets)) {
    if (sourceModuleForTarget(prev, target) === srcId) return true;
  }
  return false;
}

/**
 * @param {Object} p
 * @returns {string}
 */
function summarize(p) {
  const { prev, next, matched, relocated, added, removed, snRelocated,
    newlyResolved, newlyUnresolved, targetImpacts, confidenceDrops, riskLevel } = p;
  const lines = [];
  lines.push(`map diff: ${prev.gameVersion} -> ${next.gameVersion}`);
  lines.push(`  bundleHash : ${prev.bundleHash === next.bundleHash ? "unchanged" : "CHANGED"}`);
  lines.push(`  modules    : ${matched} matched, ${relocated.length} relocated, +${added.length} new, -${removed.length} dropped`);
  if (snRelocated.length) lines.push(`  stableNames: ${snRelocated.length} relocated to a different module`);
  if (newlyResolved.length) lines.push(`  unresolved : ${newlyResolved.length} newly resolved (good)`);
  if (newlyUnresolved.length) lines.push(`  unresolved : ${newlyUnresolved.length} newly UNRESOLVED (regression)`);
  if (confidenceDrops.length) lines.push(`  confidence : ${confidenceDrops.length} module(s) with a large match-weight drop`);
  if (targetImpacts.length) lines.push(`  targets    : ${targetImpacts.length} at risk (RE-VERIFY before promoting)`);
  lines.push(`  risk       : ${riskLevel.toUpperCase()}`);
  return lines.join("\n");
}

/**
 * Render a MapDiff as a human-readable review report (stderr-style; the JSON
 * candidate map is the artifact, this is the reviewer's console output).
 * @param {MapDiff} diff
 * @returns {string}
 */
export function formatDiff(diff) {
  const out = [];
  out.push(diff.summary);
  out.push("");

  if (diff.modules.relocated.length) {
    out.push("relocated modules (moduleId shifted — confirm mixins still target these):");
    for (const r of diff.modules.relocated) {
      out.push(`  ${r.concept} [src ${r.sourceModuleId}]  ${r.fromModule} -> ${r.toModule}  (w ${r.fromWeight}->${r.toWeight})`);
    }
    out.push("");
  }
  if (diff.stableNames.relocated.length) {
    out.push("stable names that moved module:");
    for (const s of diff.stableNames.relocated) {
      out.push(`  ${s.name}  ${s.fromModule} -> ${s.toModule}`);
    }
    out.push("");
  }
  if (diff.targetImpacts.length) {
    out.push("TARGETS AT RISK — re-verify these anchors against the unpacked new bundle:");
    for (const t of diff.targetImpacts) {
      const mod = t.toModule ? `${t.fromModule} -> ${t.toModule}` : `${t.fromModule ?? "?"} -> ?`;
      out.push(`  [${t.reason.toUpperCase()}] ${t.target}  (${mod})`);
      out.push(`      ${t.note}`);
    }
    out.push("");
  }
  if (diff.confidenceDrops.length) {
    out.push("confidence drops (match still holds but markedly weaker — re-verify):");
    for (const c of diff.confidenceDrops) {
      out.push(`  ${c.concept} [src ${c.sourceModuleId}]  w ${c.fromWeight}->${c.toWeight} (${c.weightDelta})`);
    }
    out.push("");
  }
  if (diff.modules.added.length) {
    out.push(`newly matched modules (+${diff.modules.added.length}):`);
    for (const m of diff.modules.added) out.push(`  + ${m.concept} [src ${m.sourceModuleId}] -> module ${m.moduleId}`);
    out.push("");
  }
  if (diff.modules.removed.length) {
    out.push(`no-longer-matched modules (-${diff.modules.removed.length}):`);
    for (const m of diff.modules.removed) out.push(`  - ${m.concept} [src ${m.sourceModuleId}] (was module ${m.moduleId})`);
    out.push("");
  }
  if (diff.unresolved.newlyUnresolved.length) {
    out.push(`newly UNRESOLVED source modules (-${diff.unresolved.newlyUnresolved.length}): ${diff.unresolved.newlyUnresolved.join(", ")}`);
    out.push("");
  }
  if (diff.riskLevel === "high") {
    out.push("==> HIGH RISK: one or more mod-facing targets are affected. Do NOT promote this");
    out.push("    candidate until verify-targets confirms the anchors survive, or the targets");
    out.push("    are re-curated for the new build.");
  } else if (diff.riskLevel === "low") {
    out.push("==> LOW RISK: modules shifted but no mod-facing target is affected. Run");
    out.push("    verify-targets; if green, promote the candidate and commit.");
  } else {
    out.push("==> NO DRIFT: nothing relocated. (If bundleHash also unchanged, no regen was needed.)");
  }
  return out.join("\n");
}

/**
 * Guard for the regen flow: the candidate must carry forward AT LEAST as many targets
 * as the committed baseline. If it loses targets, verify-targets would check 0 and
 * print a misleading "ALL TARGETS RESOLVE" — defeating the M9 safety gate. Throws on a
 * loss; no-ops when the baseline itself had no targets. (M9 adversarial review: blocker.)
 * @param {GameMap} prev  committed baseline
 * @param {GameMap} next  candidate
 */
export function assertTargetsCarried(prev, next) {
  const a = Object.keys(prev.targets ?? {}).length;
  const b = Object.keys(next.targets ?? {}).length;
  if (a > 0 && b < a) {
    throw new Error(
      `carry-forward lost targets: baseline has ${a}, candidate has ${b}. ` +
      `gen-map must read targets from the committed baseline (GEN_PREV_MAP). Refusing to emit a target-less candidate.`,
    );
  }
}

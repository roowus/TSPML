/**
 * Warn-only mod safety classification (M6).
 *
 * TSPML's fairness model is **warn-only**: it never hard-disables a mod or
 * blocks a leaderboard upload on the user's behalf. Instead it classifies each
 * mod from its declared manifest (`vanillaSafe`, `capabilities`, `mixins`,
 * `physics`) and surfaces clear warnings + a `leaderboardRisk` signal the UI
 * surfaces — leaving the decision to the player. See
 * docs/design/safety-and-fairness.md.
 *
 * Most of what it reads is the author's own CLAIM. `physics` (#43) is the
 * exception and the reason this file is not purely a formatter of declarations:
 * a mod that rewrites a constant in the compiled physics binary changes how
 * every lap time is produced, so it carries the risk regardless of what its
 * `vanillaSafe` field says.
 *
 * `classifySafety` is a PURE function over a validated `VersionManifest` — fully
 * unit-testable, no game coupling.
 */
import type { VersionManifest } from './types.js';

/** A single surfaced warning about a mod. */
export interface SafetyWarning {
  readonly kind:
    | 'leaderboard-risk'
    | 'network'
    | 'capability'
    | 'unsafe-mixin'
    | 'physics';
  readonly message: string;
}

/**
 * The mod's impact on ranked play. TSPML is warn-only: this is `'none' | 'warn'`
 * — there is intentionally NO `'block'` (the loader never hard-blocks; the
 * player decides).
 */
export type LeaderboardRisk = 'none' | 'warn';

/** The result of classifying a mod's safety from its manifest. */
export interface SafetyReport {
  /** The mod's declared (or default) vanilla-safety. */
  readonly vanillaSafe: boolean;
  /** Declared capabilities (dom/storage/network/...). */
  readonly capabilities: readonly string[];
  /** Whether ranked play is at risk — `'warn'` (surface a banner) or `'none'`. */
  readonly leaderboardRisk: LeaderboardRisk;
  /** Human-readable warnings to surface. */
  readonly warnings: readonly SafetyWarning[];
}

/**
 * Classify a mod's safety from its manifest. Defaults: a mod with no
 * `vanillaSafe` declaration is assumed vanilla-safe; capabilities default to
 * none. Warn-only — never throws, never blocks.
 */
export function classifySafety(manifest: VersionManifest): SafetyReport {
  const warnings: SafetyWarning[] = [];
  const capabilities = manifest.capabilities ?? [];
  const vanillaSafe = manifest.vanillaSafe ?? true;
  const hasMixins = (manifest.mixins?.length ?? 0) > 0;
  const hasPhysics = manifest.physics !== undefined;
  const id = manifest.id;

  if (!vanillaSafe) {
    warnings.push({
      kind: 'leaderboard-risk',
      message: `${id}: declares vanillaSafe=false — alters physics/multiplayer; using it risks leaderboard bans.`,
    });
  }
  for (const cap of capabilities) {
    if (cap === 'network') {
      warnings.push({
        kind: 'network',
        message: `${id}: declares the 'network' capability — may contact external servers.`,
      });
    } else {
      warnings.push({
        kind: 'capability',
        message: `${id}: declares capability '${cap}'.`,
      });
    }
  }
  if (vanillaSafe && hasMixins) {
    warnings.push({
      kind: 'unsafe-mixin',
      message: `${id}: declares vanillaSafe=true but uses Tier-2 mixins — verify the mixins don't touch physics/multiplayer before trusting the label.`,
    });
  }
  if (hasPhysics) {
    // #43. Unlike every other signal here this one is not a declaration to be
    // taken at face value: rewriting a constant in the physics binary changes
    // how each lap time is produced, so it is a leaderboard risk whatever the
    // manifest says about vanillaSafe. Still warn-only — the player decides.
    warnings.push({
      kind: 'physics',
      message: `${id}: rewrites constants in the game's physics binary — every lap time it produces is non-vanilla.${
        vanillaSafe ? ' The manifest still declares vanillaSafe=true; that label cannot be true of a physics patch.' : ''
      }`,
    });
  }

  const leaderboardRisk: LeaderboardRisk =
    !vanillaSafe || hasPhysics || capabilities.includes('network') ? 'warn' : 'none';

  return { vanillaSafe, capabilities, leaderboardRisk, warnings };
}

/**
 * Combine per-mod reports into one report for the whole enabled set.
 *
 * A host with a single status line cannot show N reports, and picking one of
 * them is the wrong answer in the direction that matters: with two mods
 * installed, reading only the first hides a physics patch that happens to be
 * second. Risk over a set is a MAXIMUM, never a sample.
 *
 * Rules, each chosen to fail toward disclosure:
 *   - `leaderboardRisk` is `'warn'` if ANY mod warns. Risk does not average out.
 *   - `vanillaSafe` is true only if EVERY mod is. One unsafe mod makes the
 *     session unsafe; the safe mods do not dilute it.
 *   - `capabilities` and `warnings` are the unions, in set order and deduped —
 *     the player's question is "what is running right now", not "what did mod 3
 *     ask for".
 *
 * An EMPTY set returns null rather than a clean report. "No mods" and "mods,
 * all fine" are different facts, and rendering the second for the first leaves
 * a stale safety line on screen after the last mod is removed.
 */
export function summarizeSafety(reports: readonly SafetyReport[]): SafetyReport | null {
  if (reports.length === 0) return null;

  const capabilities: string[] = [];
  const warnings: SafetyWarning[] = [];
  const seenCap = new Set<string>();
  // Warnings are deduped by kind+message: two mods can legitimately raise the
  // same KIND (two physics patches) and both deserve a line, but the identical
  // message twice is noise.
  const seenWarn = new Set<string>();
  let vanillaSafe = true;
  let leaderboardRisk: LeaderboardRisk = 'none';

  for (const r of reports) {
    if (!r.vanillaSafe) vanillaSafe = false;
    if (r.leaderboardRisk === 'warn') leaderboardRisk = 'warn';
    for (const cap of r.capabilities) {
      if (seenCap.has(cap)) continue;
      seenCap.add(cap);
      capabilities.push(cap);
    }
    for (const w of r.warnings) {
      const key = `${w.kind} ${w.message}`;
      if (seenWarn.has(key)) continue;
      seenWarn.add(key);
      warnings.push(w);
    }
  }

  return { vanillaSafe, capabilities, leaderboardRisk, warnings };
}

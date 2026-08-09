import type {
  Mod,
  ResolveContext,
  ResolveResult,
  VersionManifest,
  Warning,
} from './types.js';
import { satisfies } from './semver.js';

/**
 * Hard dependency-resolution failure (missing dep, version conflict, cycle,
 * duplicate id). Resolution errors are abortive: the loader cannot partially
 * order a cyclic or conflicting set. This is distinct from entrypoint
 * failures, which are isolated per mod — and from `breaks`, which since #6
 * soft-disables the declaring mod instead of aborting anything.
 */
export class DependencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DependencyError';
  }
}

const SPECIAL_IDS = new Set(['polytrack', 'tspml', 'tspml-api']);

/** Build a {@link Mod} from a validated manifest plus an optional priority. */
export function modFromManifest(manifest: VersionManifest, priority = 0): Mod {
  return {
    id: manifest.id,
    version: manifest.version,
    priority,
    environment: manifest.environment ?? '*',
    targets: manifest.targets,
    depends: manifest.depends ?? {},
    recommends: manifest.recommends ?? {},
    suggests: manifest.suggests ?? {},
    conflicts: manifest.conflicts ?? {},
    breaks: manifest.breaks ?? {},
    includes: manifest.includes ?? {},
    provides: manifest.provides ?? [],
  };
}

interface ModIndex {
  byId: Map<string, Mod>;
  /** provided id -> providing mod (first wins; deterministic by input order). */
  provided: Map<string, Mod>;
}

function buildIndex(mods: Mod[]): ModIndex {
  const byId = new Map<string, Mod>();
  for (const m of mods) {
    if (byId.has(m.id)) {
      throw new DependencyError(`duplicate mod id '${m.id}'`);
    }
    byId.set(m.id, m);
  }
  const provided = new Map<string, Mod>();
  for (const m of mods) {
    for (const p of m.provides) {
      if (!provided.has(p) && !byId.has(p)) {
        provided.set(p, m);
      }
    }
  }
  return { byId, provided };
}

/** Resolve a dependency id to a concrete version (ambient special id or a mod). */
function resolveVersion(
  depId: string,
  ctx: ResolveContext,
  index: ModIndex,
): string | undefined {
  if (depId === 'polytrack') return ctx.polytrackVersion;
  if (depId === 'tspml') return ctx.loaderVersion;
  if (depId === 'tspml-api') return ctx.apiVersion;
  return (index.byId.get(depId) ?? index.provided.get(depId))?.version;
}

/**
 * Resolve, validate and topologically order a set of mods.
 *
 * Hard failures (missing `depends`, unsatisfiable version requirements,
 * dependency cycles) throw {@link DependencyError}. Soft signals
 * (`conflicts`, missing `recommends`/`suggests`) are returned as
 * {@link Warning}s and never block loading.
 *
 * `breaks` is neither (#6, Fabric-accurate): the DECLARING mod is
 * **soft-disabled** — excluded from `order`, reported in `disabled` and as a
 * warning — while the broken mod and every unrelated mod load normally.
 * Environment mismatches (`ctx.hostEnvironment` set, mod declares a different
 * concrete environment) and targets mismatches (`ctx.polytrackVersion` set,
 * no `targets` range accepts it) soft-disable the same way (#21). A mod whose
 * `depends` can only be satisfied by a disabled mod cascades to disabled too.
 * Every later check runs on the remaining active set, so a disabled mod's own
 * problems (a missing dep) cannot abort a load it is no longer part of.
 *
 * `priority` is a tiebreak only — it orders mods that have no declared
 * relationship. It never overrides topological order (a dependency always
 * loads before its dependents).
 */
export function resolveDependencies(
  mods: Mod[],
  ctx: ResolveContext = {},
): ResolveResult {
  // Full-set index: duplicate-id check (still abortive — two mods with one
  // name cannot be ordered) + the reference for what is INSTALLED.
  const fullIndex = buildIndex(mods);
  const warnings: Warning[] = [];

  // 0a. `breaks` soft-disable (#6). Evaluated against the INSTALLED set in a
  //     single pass, deliberately: iterating to a fixpoint (re-enabling a mod
  //     because its break-target was itself disabled) turns this into an
  //     order-dependent maximization problem — `a breaks b, b breaks a` has
  //     two "maximal" answers and picking one silently is exactly the
  //     ambiguous-first-match behavior TSPML exists to avoid. One pass over
  //     what is installed is deterministic and explainable: the fix is always
  //     "remove or disable the named mod".
  const disabled = new Map<string, string>();
  for (const m of mods) {
    for (const [breakId, range] of Object.entries(m.breaks)) {
      const version = resolveVersion(breakId, ctx, fullIndex);
      if (version !== undefined && satisfies(version, range)) {
        const reason = `mod '${m.id}' declares 'breaks' on '${breakId}@${range}' but '${breakId}@${version}' is installed — '${m.id}' is disabled; '${breakId}' still loads`;
        if (!disabled.has(m.id)) {
          disabled.set(m.id, reason);
          warnings.push({ kind: 'breaks-disabled', mod: m.id, other: breakId, message: reason });
        }
      }
    }
  }

  // 0a2. Environment filtering (#21): a mod declaring a concrete environment
  //      that is not the host's cannot run here — same soft-disable shape as
  //      `breaks`, because "wrong place" is a resolution outcome, not a bug in
  //      the mod. `'*'` on either side means "no constraint". First matching
  //      reason wins (a breaks-disabled mod keeps its breaks reason).
  const host = ctx.hostEnvironment;
  if (host !== undefined && host !== '*') {
    for (const m of mods) {
      if (disabled.has(m.id)) continue;
      if (m.environment !== '*' && m.environment !== host) {
        const reason = `mod '${m.id}' declares environment '${m.environment}' but the host is '${host}' — '${m.id}' is disabled`;
        disabled.set(m.id, reason);
        warnings.push({ kind: 'environment-mismatch', mod: m.id, message: reason });
      }
    }
  }

  // 0a3. Game-version targeting (#21): if we know the running PolyTrack
  //      version, a mod whose `targets` ranges all reject it is soft-disabled.
  //      This used to be a hard THROW after the active set was built — which
  //      meant one stale mod aborted every other mod's load, the exact
  //      all-or-nothing failure #6 removed for `breaks`. The mismatch is still
  //      loud (warning + disabled status + never invoked); it just stops being
  //      collective punishment. No declared targets = no constraint.
  if (ctx.polytrackVersion !== undefined) {
    for (const m of mods) {
      if (disabled.has(m.id) || m.targets.length === 0) continue;
      const range = m.targets.join(' || ');
      if (!satisfies(ctx.polytrackVersion, range)) {
        const reason = `mod '${m.id}' targets '${range}' but polytrack is ${ctx.polytrackVersion} — '${m.id}' is disabled`;
        disabled.set(m.id, reason);
        warnings.push({ kind: 'incompatible-target', mod: m.id, other: 'polytrack', message: reason });
      }
    }
  }

  // 0b. Cascade: a still-active mod whose `depends` was satisfiable in the
  //     installed set but is NOT satisfiable among active mods lost its
  //     provider to 0a — disable it too, naming the chain. (A dep that was
  //     never satisfiable is not our case: step 2 below throws for it with
  //     the established message.) Monotone fixpoint, so iteration order
  //     cannot change the final set.
  let cascading = disabled.size > 0;
  while (cascading) {
    cascading = false;
    const activeMods = mods.filter((m) => !disabled.has(m.id));
    const activeIdx = buildIndex(activeMods);
    for (const m of activeMods) {
      for (const depId of Object.keys(m.depends)) {
        if (resolveVersion(depId, ctx, activeIdx) !== undefined) continue;
        if (resolveVersion(depId, ctx, fullIndex) === undefined) continue;
        const provider = resolveProviderId(depId, fullIndex);
        const via =
          provider !== undefined && provider !== depId
            ? `'${depId}', provided by '${provider}', which is disabled`
            : `'${depId}', which is disabled`;
        const reason = `mod '${m.id}' is disabled because it depends on ${via}`;
        disabled.set(m.id, reason);
        warnings.push({
          kind: 'disabled-dependency',
          mod: m.id,
          other: provider ?? depId,
          message: reason,
        });
        cascading = true;
        break;
      }
    }
  }

  // Everything below sees only the ACTIVE set: a disabled mod must not abort
  // the load (its deps may be missing), must not warn (it isn't loading, so
  // "both will load" would be false), and must not be ordered.
  const active = mods.filter((m) => !disabled.has(m.id));
  const index = buildIndex(active);

  // 1. (moved) Game-version targeting used to hard-throw here. Since #21 it is
  //    the soft-disable pass 0a3 above — a mod built for another game version
  //    is still refused before its entrypoint runs, it just no longer aborts
  //    every OTHER mod's load.

  // 2. `depends`: must be present at a satisfying version. Collect version
  //    violations so a conflict can name every demanding mod + range.
  interface Violation {
    depId: string;
    installedVersion: string;
    mod: string;
    range: string;
  }
  const violations: Violation[] = [];
  for (const m of active) {
    for (const [depId, range] of Object.entries(m.depends)) {
      const version = resolveVersion(depId, ctx, index);
      if (version === undefined) {
        throw new DependencyError(
          `mod '${m.id}' depends on '${depId}' which is not installed`,
        );
      }
      if (!satisfies(version, range)) {
        violations.push({ depId, installedVersion: version, mod: m.id, range });
      }
    }
  }
  if (violations.length > 0) {
    const parts = violations
      .map((v) => `'${v.range}' required by '${v.mod}'`)
      .join('; ');
    const v0 = violations[0];
    if (v0 === undefined) throw new Error('unreachable');
    throw new DependencyError(
      `version conflict: '${v0.depId}' is installed at ${v0.installedVersion} but incompatible with ${parts}`,
    );
  }

  // 3. (retired) `breaks` used to throw here. Since #6 it is handled by the
  //    soft-disable pass (0a/0b) above — nothing left to check at this point.

  // 4. `conflicts`: both load, but warn.
  for (const m of active) {
    for (const [conflictId, range] of Object.entries(m.conflicts)) {
      const version = resolveVersion(conflictId, ctx, index);
      if (version !== undefined && satisfies(version, range)) {
        warnings.push({
          kind: 'conflict',
          mod: m.id,
          other: conflictId,
          message: `mod '${m.id}' conflicts with '${conflictId}@${version}' (both will load)`,
        });
      }
    }
  }

  // 5. `recommends` / `suggests` missing: soft warnings.
  for (const m of active) {
    for (const [recId, range] of Object.entries(m.recommends)) {
      const version = resolveVersion(recId, ctx, index);
      if (version === undefined) {
        warnings.push({
          kind: 'missing-recommendation',
          mod: m.id,
          other: recId,
          message: `mod '${m.id}' recommends '${recId}@${range}' which is not installed`,
        });
      }
    }
    for (const [sugId, range] of Object.entries(m.suggests)) {
      const version = resolveVersion(sugId, ctx, index);
      if (version === undefined) {
        warnings.push({
          kind: 'missing-suggests',
          mod: m.id,
          other: sugId,
          message: `mod '${m.id}' suggests '${sugId}@${range}' which is not installed`,
        });
      }
    }
  }

  // 6. `includes`: PARSED BUT NOT IMPLEMENTED — warn, never silently ignore.
  //
  // The spec defines it as Fabric's JAR-in-JAR analog (nested/contained mods).
  // We have no delivery mechanism for that: TSPML cannot yet install a mod from
  // a directory at all, let alone one nested inside another package. So an
  // author writing `includes` today gets a field that validates cleanly and
  // does nothing — the worst outcome, because the mod appears to load fine and
  // the nested mod simply is not there (#16).
  //
  // Warn rather than reject: rejecting would break a manifest that is valid per
  // the published spec, and the field may be honoured later. But say plainly
  // that the nested mod will NOT be loaded, so this fails loudly at authoring
  // time instead of silently at runtime.
  for (const m of active) {
    for (const [includedId, range] of Object.entries(m.includes)) {
      warnings.push({
        kind: 'unsupported-includes',
        mod: m.id,
        other: includedId,
        message: `mod '${m.id}' declares includes '${includedId}@${range}', which TSPML does not implement — the nested mod will NOT be loaded. Ship it as a separate mod and use 'depends' instead (#16).`,
      });
    }
  }

  // 7. Topological sort (depends-graph) with priority tiebreak — active only.
  const order = topoSort(active, index);

  warnings.sort(compareWarnings);
  return {
    order,
    warnings,
    disabled: [...disabled.entries()]
      .map(([id, reason]) => ({ id, reason }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
}

function compareWarnings(a: Warning, b: Warning): number {
  return (
    a.kind.localeCompare(b.kind) ||
    a.mod.localeCompare(b.mod) ||
    (a.other ?? '').localeCompare(b.other ?? '')
  );
}

/**
 * Resolve a dependency id to the id of an installed mod that satisfies it
 * (either directly or via `provides`). Returns `undefined` for ambient special
 * ids and uninstalled deps.
 */
function resolveProviderId(depId: string, index: ModIndex): string | undefined {
  if (SPECIAL_IDS.has(depId)) return undefined;
  if (index.byId.has(depId)) return depId;
  return index.provided.get(depId)?.id;
}

/** Edges in the depends direction: mod id -> sorted distinct provider mod ids. */
function buildDependsEdges(mods: Mod[], index: ModIndex): Map<string, string[]> {
  const edges = new Map<string, string[]>();
  for (const m of mods) {
    const deps = new Set<string>();
    for (const depId of Object.keys(m.depends)) {
      const providerId = resolveProviderId(depId, index);
      // Edges point at the real provider mod (which may supply the dep via
      // `provides`), never at the alias itself, so the dependent can be ordered.
      if (providerId !== undefined && providerId !== m.id) {
        deps.add(providerId);
      }
    }
    edges.set(
      m.id,
      [...deps].sort((x, y) => x.localeCompare(y)),
    );
  }
  return edges;
}

function topoSort(mods: Mod[], index: ModIndex): Mod[] {
  const edges = buildDependsEdges(mods, index);

  // dependents[d] = mods that depend on d (reverse edges).
  const dependents = new Map<string, Set<string>>();
  for (const m of mods) dependents.set(m.id, new Set());
  for (const m of mods) {
    for (const depId of edges.get(m.id) ?? []) {
      dependents.get(depId)?.add(m.id);
    }
  }

  const inDegree = new Map<string, number>();
  for (const m of mods) inDegree.set(m.id, edges.get(m.id)?.length ?? 0);

  // Ready set: in-degree 0. Pick by priority desc, then id asc, for determinism.
  const ready = mods.filter((m) => (inDegree.get(m.id) ?? 0) === 0);
  const order: Mod[] = [];
  const emitted = new Set<string>();

  const pickNext = (): Mod | undefined => {
    let best: Mod | undefined;
    for (const m of ready) {
      if (emitted.has(m.id)) continue;
      if (
        best === undefined ||
        m.priority > best.priority ||
        (m.priority === best.priority && m.id < best.id)
      ) {
        best = m;
      }
    }
    return best;
  };

  while (ready.length > 0) {
    // Drop emitted entries lazily so we don't rescan the whole history.
    while (ready.length > 0 && emitted.has(ready[0]!.id)) {
      ready.shift();
    }
    const current = pickNext();
    if (current === undefined) break;
    emitted.add(current.id);
    order.push(current);
    for (const depId of dependents.get(current.id) ?? []) {
      const d = (inDegree.get(depId) ?? 0) - 1;
      inDegree.set(depId, d);
      if (d === 0) {
        const depMod = index.byId.get(depId);
        if (depMod !== undefined && !emitted.has(depId)) ready.push(depMod);
      }
    }
  }

  if (order.length < mods.length) {
    throw new DependencyError(detectCycle(mods, edges));
  }
  return order;
}

/**
 * Find one dependency cycle among the mods and render it as `a -> b -> a`.
 * Roots and neighbours are visited in id order so the output is deterministic.
 */
function detectCycle(mods: Mod[], edges: Map<string, string[]>): string {
  const remaining = new Set(
    mods.map((m) => m.id).sort((x, y) => x.localeCompare(y)),
  );
  const stack: string[] = [];
  const onStack = new Set<string>();
  const visited = new Set<string>();
  let cycle: string[] | undefined;

  const visit = (id: string): void => {
    if (cycle !== undefined) return;
    if (onStack.has(id)) {
      const start = stack.indexOf(id);
      cycle = [...stack.slice(start), id];
      return;
    }
    if (visited.has(id)) return;
    visited.add(id);
    onStack.add(id);
    stack.push(id);
    for (const dep of edges.get(id) ?? []) {
      if (!remaining.has(dep)) continue;
      visit(dep);
      if (cycle !== undefined) return;
    }
    onStack.delete(id);
    stack.pop();
  };

  for (const id of remaining) {
    if (cycle !== undefined) break;
    if (!visited.has(id)) visit(id);
  }

  if (cycle === undefined || cycle.length < 2) {
    // Defensive: Kahn's reported a cycle but DFS didn't find one. Shouldn't happen.
    return 'dependency cycle: <unknown>';
  }
  return `dependency cycle: ${cycle.join(' -> ')}`;
}

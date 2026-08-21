/**
 * The fail-closed symbol resolver.
 *
 * `createResolver(map)` returns a `resolve(stableName, ctx)` bound to a loaded
 * map. The critical rule (docs/design/mappings-system.md, "Fail-closed on stale
 * maps"): if `ctx.bundleHash` (the hash of the LIVE bundle about to load) does
 * NOT match `map.bundleHash`, the resolver returns `{ ok: false, reason:
 * 'stale-map' }` and NEVER returns a locator. A stale map would resolve stable
 * names to *wrong* concrete locators — the exact silent mis-target the design
 * accuses PML of — so it must fail closed. The caller must fetch an exact-match
 * map before binding any AST/physics/ranked hook.
 *
 * When the hashes match, the stable name is looked up in the module index.
 * v1 resolves to MODULE granularity (the containing webcrack module); M3 will
 * narrow further to export / prototype / call-site locators.
 */
import type {
  ChunkEntry,
  GameMap,
  Locator,
  ModuleEntry,
  ResolveContext,
  ResolveResult,
  TargetSpec,
  WasmEntry,
} from './types.js';

/**
 * Normalize a bundle hash for comparison: trim, lowercase, and strip an optional
 * `sha256:` / `sha-256:` prefix. This bridges representation variants of the
 * SAME hash (a caller may pass bare hex while the map stores the prefixed form).
 *
 * It cannot cause a false match: two different bundles differ in at least one
 * hex digit, so their normalized forms still differ.
 */
function normalizeHash(h: string): string {
  return h.trim().toLowerCase().replace(/^sha-?256:/, '');
}

/**
 * Build the case-insensitive stable-name -> locator index for a map.
 *
 * Collisions are real and unavoidable: sibling modules genuinely share enums (several
 * track-block registries all declare `TrackPartRotationAxis`), so one name can name
 * several modules. The generator prefers module-unique names, which keeps this rare.
 *
 * **Resolution order, strongest evidence first** — NOT map insertion order:
 *
 *   1. `decidedBy: 'lexical'` beats `'structural'` beats `'edge'`. Anchors are direct
 *      evidence about a module's own literals; shape similarity is circumstantial but
 *      still about the module's own body; a require-graph neighbourhood says nothing
 *      about the body at all — it is the signal of last resort, used precisely when
 *      both content signals saturated. `adjudicate()` already refuses to let structure
 *      override a decisive lexical win *within* one module's decision, and this
 *      applies the same ordering *across* modules.
 *   2. Then higher `matchWeight` — more shared anchor evidence.
 *   3. Then `moduleId`, purely so the result is deterministic.
 *
 * This ordering is load-bearing, not cosmetic. Before #1 was wired into the generator,
 * this function was first-wins over `Object.values(map.modules)` — i.e. over JSON key
 * order. Measured on the real 0.6.0 -> 0.6.2 pair: the six structural promotions took
 * **8 pre-existing stable names** away from lexically-matched modules purely by landing
 * earlier in the file (`trackpartrotationaxis` 11 -> 1648, `checkpoint` 3571 -> 3080,
 * `carstyle` 2522 -> 5492, and five more). Adding modules is meant to be additive; it
 * must not silently re-point a name that already resolved on stronger evidence.
 */
function buildIndex(map: GameMap): Map<string, Locator> {
  const byName = new Map<string, ModuleEntry>();
  for (const entry of Object.values(map.modules)) {
    for (const name of entry.stableNames) {
      const key = name.toLowerCase();
      const held = byName.get(key);
      if (held === undefined || beatsForIndex(entry, held)) byName.set(key, entry);
    }
  }
  const index = new Map<string, Locator>();
  for (const [key, entry] of byName) {
    index.set(key, { type: 'module', moduleId: entry.moduleId });
  }
  return index;
}

/**
 * Evidence strength for collision ranking; lower is stronger. Absent `decidedBy`
 * means lexical — the only decision the pre-#1 generator could make — so every
 * pre-#1 map keeps outranking structural and edge newcomers exactly as before.
 */
function evidenceRank(e: ModuleEntry): number {
  if (e.decidedBy === 'edge') return 2;
  if (e.decidedBy === 'structural') return 1;
  return 0;
}

/** Does `challenger` hold stronger evidence for a shared stable name than `held`? */
function beatsForIndex(challenger: ModuleEntry, held: ModuleEntry): boolean {
  const cr = evidenceRank(challenger);
  const hr = evidenceRank(held);
  if (cr !== hr) return cr < hr;
  if (challenger.matchWeight !== held.matchWeight) return challenger.matchWeight > held.matchWeight;
  return challenger.moduleId < held.moduleId;
}

export interface Resolver {
  /** Resolve a stable name against the bound map, fail-closed on hash mismatch. */
  resolve(stableName: string, ctx: ResolveContext): ResolveResult;
}

/**
 * Create a fail-closed resolver bound to a loaded map. Prefer this over the
 * standalone {@link resolve} when resolving multiple names against one map —
 * the stable-name index is built once.
 */
export function createResolver(map: GameMap): Resolver {
  const index = buildIndex(map);
  const want = normalizeHash(map.bundleHash);
  return {
    resolve(stableName, ctx) {
      if (normalizeHash(ctx.bundleHash) !== want) {
        return {
          ok: false,
          reason: 'stale-map',
          message: `map bundleHash (${map.bundleHash}) does not match live bundle (${ctx.bundleHash}); refusing to return a locator — fetch an exact-match map`,
        };
      }
      const locator = index.get(stableName.toLowerCase());
      if (!locator) {
        return {
          ok: false,
          reason: 'not-found',
          message: `stable name '${stableName}' is not present in the map for PolyTrack ${map.gameVersion}`,
        };
      }
      return { ok: true, locator };
    },
  };
}

/**
 * Stateless one-shot resolution: resolve a single stable name against `map`.
 * Equivalent to `createResolver(map).resolve(stableName, ctx)` but builds the
 * index per call, so prefer the resolver instance for repeated lookups.
 */
export function resolve(map: GameMap, stableName: string, ctx: ResolveContext): ResolveResult {
  return createResolver(map).resolve(stableName, ctx);
}

// ── Target resolution (M5-C) ────────────────────────────────────────────────

export interface TargetResolveSuccess {
  readonly ok: true;
  readonly target: TargetSpec;
}
export type TargetResolveResult =
  | TargetResolveSuccess
  | {
      readonly ok: false;
      readonly reason: 'stale-map' | 'not-found';
      readonly message: string;
    };

/**
 * Resolve a stable TARGET name (from `map.targets`) to a concrete
 * {@link TargetSpec}, **fail-closed** on hash mismatch — same guarantee as the
 * module resolver. Lets mods address e.g. `Car.controlCar` instead of an inline
 * minified anchor.
 */
export function resolveTarget(
  map: GameMap,
  name: string,
  ctx: ResolveContext,
): TargetResolveResult {
  if (normalizeHash(ctx.bundleHash) !== normalizeHash(map.bundleHash)) {
    return {
      ok: false,
      reason: 'stale-map',
      message: `map bundleHash (${map.bundleHash}) does not match live bundle (${ctx.bundleHash}); refusing to resolve target '${name}'`,
    };
  }
  const targets = map.targets;
  if (!targets) {
    return { ok: false, reason: 'not-found', message: `map has no targets section` };
  }
  // Case-insensitive lookup (mirrors the module resolver).
  const key = Object.keys(targets).find((k) => k.toLowerCase() === name.toLowerCase());
  if (key === undefined) {
    return {
      ok: false,
      reason: 'not-found',
      message: `target '${name}' is not in the map for PolyTrack ${map.gameVersion}`,
    };
  }
  return { ok: true, target: targets[key]! };
}

// ── Chunk resolution (#98) ──────────────────────────────────────────────────

export type ChunkResolveResult =
  | { readonly ok: true; readonly chunk: ChunkEntry }
  | {
      readonly ok: false;
      readonly reason: 'not-declared' | 'stale-chunk';
      readonly message: string;
    };

/**
 * May this build's `<id>.bundle.js` be transformed, and against which pin?
 *
 * Two refusals, deliberately distinct because a host reports them differently:
 *
 *  - `'not-declared'` — the id is not in the map's allowlist. Not an error: it is
 *    a chunk TSPML has never verified anchors against, and it is proxied verbatim.
 *  - `'stale-chunk'` — the id IS declared but the live bytes do not match its pin.
 *    The chunk re-minified; its anchors are unverified against these bytes, so
 *    serving it transformed is exactly the silent mis-target the mappings system
 *    exists to prevent. Fail closed.
 *
 * SCOPED FAIL-CLOSED, and this is the load-bearing difference from the main
 * bundle's gate: a stale chunk pin invalidates THAT CHUNK only. Chunks re-minify
 * independently, so a shared verdict would take the whole session vanilla over a
 * chunk the player may never load. The main bundle's gate is untouched by this.
 *
 * `liveHash` is the hash of the bytes about to be served, in the same
 * `sha256:`-prefixed-or-bare form the other resolvers accept. Omit it to ask only
 * the allowlist question ("is this id declared at all") — used by a proxy deciding
 * whether to buffer a response for hashing before it has the bytes.
 */
/**
 * Own-property lookup in an allowlist keyed by a REQUEST-DERIVED string.
 *
 * A plain `record[key]` walks the prototype chain, so `'constructor'` and
 * `'toString'` come back truthy on any object literal and would sail past an
 * `=== undefined` check as if they were declared entries. The caller would then read
 * `.hash` off a function and compare it to a live hash — an allowlist that answers
 * "yes" for names nobody declared. Never a plain index here.
 */
function ownEntry<T>(record: Readonly<Record<string, T>> | undefined, key: string): T | undefined {
  if (record === undefined) return undefined;
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}

export function resolveChunk(
  map: GameMap,
  chunkId: string,
  liveHash?: string,
): ChunkResolveResult {
  const entry = ownEntry(map.chunks, chunkId);
  if (entry === undefined) {
    return {
      ok: false,
      reason: 'not-declared',
      message: `chunk '${chunkId}' is not declared transformable in the map for PolyTrack ${map.gameVersion}; serving it unmodified`,
    };
  }
  if (liveHash !== undefined && normalizeHash(liveHash) !== normalizeHash(entry.hash)) {
    return {
      ok: false,
      reason: 'stale-chunk',
      message: `chunk '${chunkId}' hash (${entry.hash}) does not match the live chunk (${liveHash}); refusing to transform it — the chunk re-minified independently of the main bundle`,
    };
  }
  return { ok: true, chunk: entry };
}

/** Chunk ids this map declares transformable, ascending. Empty when none. */
export function transformableChunkIds(map: GameMap): string[] {
  return Object.keys(map.chunks ?? {}).sort((a, b) => Number(a) - Number(b));
}

// ── WASM resolution (#43) ───────────────────────────────────────────────────

export type WasmResolveResult =
  | { readonly ok: true; readonly wasm: WasmEntry }
  | {
      readonly ok: false;
      readonly reason: 'not-declared' | 'stale-wasm';
      readonly message: string;
    };

/**
 * May this build's `<name>.wasm` be patched, and against which pin?
 *
 * Same two-refusal shape as {@link resolveChunk}, and the same reason for keeping them
 * distinct — a host reports them differently:
 *
 *  - `'not-declared'` — the filename is not in the allowlist. Routine: TSPML has
 *    verified nothing against that binary, so it is proxied verbatim.
 *  - `'stale-wasm'`   — declared, but the live bytes do not match the pin. The binary
 *    recompiled, so every fingerprint derived from the old build is unverified against
 *    these bytes. Fail closed.
 *
 * The stakes differ from the chunk case, which is why this is a hard gate and not a
 * warning. A stale JS pin risks a patch that misses. A stale binary pin risks writing
 * a float into whatever now occupies an address — the physics sim keeps running, wrong,
 * with no error anywhere. `@tspml/wasm` additionally re-derives every location
 * structurally at patch time and refuses on ambiguity, so this pin is the outer of two
 * independent gates rather than the only one.
 *
 * `liveHash` is the hash of the bytes about to be served, prefixed or bare. Omit it to
 * ask only the allowlist question — used by a proxy deciding whether to buffer a
 * response before it has the bytes to hash.
 */
export function resolveWasm(
  map: GameMap,
  file: string,
  liveHash?: string,
): WasmResolveResult {
  const entry = ownEntry(map.wasm, file);
  if (entry === undefined) {
    return {
      ok: false,
      reason: 'not-declared',
      message: `'${file}' is not declared patchable in the map for PolyTrack ${map.gameVersion}; serving it unmodified`,
    };
  }
  if (liveHash !== undefined && normalizeHash(liveHash) !== normalizeHash(entry.hash)) {
    return {
      ok: false,
      reason: 'stale-wasm',
      message: `'${file}' hash (${entry.hash}) does not match the live binary (${liveHash}); refusing to patch it — every recorded fingerprint is unverified against these bytes`,
    };
  }
  return { ok: true, wasm: entry };
}

/** WASM filenames this map declares patchable, sorted. Empty when none. */
export function patchableWasmFiles(map: GameMap): string[] {
  return Object.keys(map.wasm ?? {}).sort();
}

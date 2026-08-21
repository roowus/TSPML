/**
 * Map loader + structural validator.
 *
 * `loadMap(path)` reads + validates a map JSON file into a typed `GameMap`.
 * `loadDefaultMap()` returns the bundled PolyTrack 0.6.2 map. Validation is
 * strict: a malformed map throws `MapParseError` naming the offending field,
 * rather than letting a half-parsed map reach the resolver.
 */
import { readFile } from 'node:fs/promises';

import { MAIN_SURFACE_FILE, MAP_FORMAT_VERSION } from './types.js';
import type {
  BundleHash,
  ChunkEntry,
  GameMap,
  ModuleEntry,
  TargetSpec,
  UnresolvedEntry,
} from './types.js';

/** Thrown when a map file is missing, unparseable, or schema-invalid. */
export class MapParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MapParseError';
  }
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new MapParseError(msg);
}

function isString(v: unknown): v is string {
  return typeof v === 'string';
}

function isNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((e) => typeof e === 'string');
}

const BUNDLE_HASH_RE = /^sha256:[0-9a-fA-F]{64}$/;
/** The two shapes a `targets[].surface` may name (#98). Mirrors the portal's
 *  `BUNDLE_FILE_RE` — a surface is always a served filename, never a bare id. */
const SURFACE_FILE_RE = /^(main|\d{1,6})\.bundle\.js$/;

function validateModuleEntry(raw: unknown, key: string): ModuleEntry {
  assert(isObject(raw), `modules['${key}'] must be an object`);
  assert(isString(raw.concept), `modules['${key}'].concept must be a string`);
  assert(
    isStringArray(raw.stableNames) && raw.stableNames.length > 0,
    `modules['${key}'].stableNames must be a non-empty string array`,
  );
  assert(isString(raw.subsystem), `modules['${key}'].subsystem must be a string`);
  assert(isStringArray(raw.subsystems), `modules['${key}'].subsystems must be a string array`);
  assert(isString(raw.moduleId) && raw.moduleId.length > 0, `modules['${key}'].moduleId must be a non-empty string`);
  assert(isNumber(raw.matchWeight), `modules['${key}'].matchWeight must be a number`);
  assert(isNumber(raw.sharedAnchors), `modules['${key}'].sharedAnchors must be a number`);
  assert(isString(raw.sourceModuleId), `modules['${key}'].sourceModuleId must be a string`);
  // `decidedBy` is optional (#1): pre-#1 maps have no such field, and absent means
  // lexical. But an *unrecognised* value must be rejected rather than tolerated — the
  // resolver ranks evidence kinds when two modules share a stable name, so a typo'd
  // or future value read as "not structural / not edge" would quietly win a collision
  // it should lose. Fail closed on anything we do not understand.
  assert(
    raw.decidedBy === undefined ||
      raw.decidedBy === 'lexical' ||
      raw.decidedBy === 'structural' ||
      raw.decidedBy === 'edge',
    `modules['${key}'].decidedBy must be 'lexical', 'structural' or 'edge' when present`,
  );
  assert(
    raw.structuralSimilarity === undefined || isNumber(raw.structuralSimilarity),
    `modules['${key}'].structuralSimilarity must be a number when present`,
  );
  assert(
    raw.edgeConfirmed === undefined || isNumber(raw.edgeConfirmed),
    `modules['${key}'].edgeConfirmed must be a number when present`,
  );
  return {
    concept: raw.concept,
    stableNames: raw.stableNames,
    subsystem: raw.subsystem,
    subsystems: raw.subsystems,
    moduleId: raw.moduleId,
    matchWeight: raw.matchWeight,
    sharedAnchors: raw.sharedAnchors,
    sourceModuleId: raw.sourceModuleId,
    ...(raw.decidedBy !== undefined ? { decidedBy: raw.decidedBy } : {}),
    ...(raw.structuralSimilarity !== undefined
      ? { structuralSimilarity: raw.structuralSimilarity }
      : {}),
    ...(raw.edgeConfirmed !== undefined ? { edgeConfirmed: raw.edgeConfirmed } : {}),
  };
}

function validateUnresolved(raw: unknown, i: number): UnresolvedEntry {
  assert(isObject(raw), `unresolved[${i}] must be an object`);
  assert(isString(raw.sourceModuleId), `unresolved[${i}].sourceModuleId must be a string`);
  assert(isString(raw.subsystem), `unresolved[${i}].subsystem must be a string`);
  assert(isStringArray(raw.subsystems), `unresolved[${i}].subsystems must be a string array`);
  assert(isString(raw.reason), `unresolved[${i}].reason must be a string`);
  return {
    sourceModuleId: raw.sourceModuleId,
    subsystem: raw.subsystem,
    subsystems: raw.subsystems,
    reason: raw.reason,
  };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Validate a TargetSpec (anchor literals + selector) for the `targets` section. */
function validateTargetSpec(raw: unknown, key: string): TargetSpec {
  assert(isObject(raw), `targets['${key}'] must be an object`);
  assert(isObject(raw.anchor), `targets['${key}'].anchor must be an object`);
  assert(
    Array.isArray(raw.anchor.literals) &&
      raw.anchor.literals.length > 0 &&
      raw.anchor.literals.every((l: unknown) => typeof l === 'string' || typeof l === 'number'),
    `targets['${key}'].anchor.literals must be a non-empty array of strings/numbers`,
  );
  if (raw.anchor.minHits !== undefined) {
    assert(typeof raw.anchor.minHits === 'number', `targets['${key}'].anchor.minHits must be a number`);
  }
  assert(isObject(raw.selector), `targets['${key}'].selector must be an object`);
  assert(
    raw.selector.kind === 'method' || raw.selector.kind === 'property' || raw.selector.kind === 'factory',
    `targets['${key}'].selector.kind must be method | property | factory`,
  );
  let selector: TargetSpec['selector'];
  if (raw.selector.kind === 'method') {
    assert(typeof raw.selector.name === 'string' && raw.selector.name.length > 0, `targets['${key}'].selector.name must be a non-empty string`);
    selector = { kind: 'method', name: raw.selector.name };
  } else if (raw.selector.kind === 'property') {
    assert(typeof raw.selector.key === 'string' && raw.selector.key.length > 0, `targets['${key}'].selector.key must be a non-empty string`);
    selector = { kind: 'property', key: raw.selector.key };
  } else {
    selector = { kind: 'factory' };
  }
  if (raw.surface !== undefined) {
    assert(
      isString(raw.surface) && SURFACE_FILE_RE.test(raw.surface),
      `targets['${key}'].surface must be 'main.bundle.js' or '<id>.bundle.js' (1-6 digits)`,
    );
  }
  return {
    anchor: {
      literals: raw.anchor.literals as readonly (string | number)[],
      ...(raw.anchor.minHits !== undefined ? { minHits: raw.anchor.minHits as number } : {}),
    },
    selector,
    ...(raw.surface !== undefined ? { surface: raw.surface as string } : {}),
  };
}

/**
 * Validate one `chunks` entry (#98).
 *
 * Stricter than it looks like it needs to be, for two reasons:
 *
 *  - `id` must be DIGITS and must equal its own key. A host builds the request
 *    path `<id>.bundle.js` from this value, so anything else is a path-traversal
 *    primitive sitting in the allowlist. `assertVersion` in the pipeline's
 *    fetch.mjs refuses loose versions for exactly this reason; same rule here.
 *  - `hash` must be a real sha256. A malformed pin cannot match any live hash, so
 *    a lenient parse would produce an entry that is permanently stale — a chunk
 *    silently never transformed, which is the kind of quiet no-op this project
 *    treats as worse than a crash.
 */
function validateChunkEntry(raw: unknown, key: string): ChunkEntry {
  assert(isObject(raw), `chunks['${key}'] must be an object`);
  assert(
    isString(raw.id) && /^\d{1,6}$/.test(raw.id),
    `chunks['${key}'].id must be 1-6 digits (it becomes the '<id>.bundle.js' request path)`,
  );
  assert(raw.id === key, `chunks['${key}'].id must equal its key (got '${String(raw.id)}')`);
  assert(
    isString(raw.hash) && BUNDLE_HASH_RE.test(raw.hash),
    `chunks['${key}'].hash must be "sha256:<64 hex>"`,
  );
  assert(
    isNumber(raw.bytes) && raw.bytes > 0,
    `chunks['${key}'].bytes must be a positive number`,
  );
  assert(isString(raw.role) && raw.role.length > 0, `chunks['${key}'].role must be a non-empty string`);
  return {
    id: raw.id,
    hash: raw.hash as BundleHash,
    bytes: raw.bytes,
    role: raw.role,
  };
}

/**
 * Validate an already-parsed object as a {@link GameMap}. Throws `MapParseError`
 * on any structural violation. This is the single chokepoint: `loadMap` and any
 * future network/IPC importer should route through it.
 */
export function validateMap(raw: unknown): GameMap {
  assert(isObject(raw), 'map must be an object');
  assert(raw.formatVersion === MAP_FORMAT_VERSION, `formatVersion must be ${MAP_FORMAT_VERSION}`);
  assert(isString(raw.gameVersion) && raw.gameVersion.length > 0, 'gameVersion must be a non-empty string');
  assert(isString(raw.bundleHash) && BUNDLE_HASH_RE.test(raw.bundleHash), 'bundleHash must be "sha256:<64 hex>"');

  assert(isObject(raw.modules), 'modules must be an object');
  const modules: Record<string, ModuleEntry> = {};
  for (const [key, value] of Object.entries(raw.modules)) {
    modules[key] = validateModuleEntry(value, key);
  }

  assert(Array.isArray(raw.unresolved), 'unresolved must be an array');
  const unresolved: UnresolvedEntry[] = raw.unresolved.map((e, i) => validateUnresolved(e, i));

  // `generated` provenance is informational; validate loosely.
  assert(isObject(raw.generated), 'generated must be an object');

  // `chunks` (#98, optional): chunk id -> ChunkEntry. Absent means "this build
  // declares no transformable chunks" — the pre-#98 main-bundle-only surface.
  // Validated BEFORE targets: a chunk-scoped target is only meaningful if its
  // chunk is declared, and the check below needs this set.
  let chunks: Record<string, ChunkEntry> | undefined;
  if (raw.chunks !== undefined) {
    assert(isObject(raw.chunks), 'chunks must be an object');
    chunks = {};
    for (const [key, value] of Object.entries(raw.chunks)) {
      chunks[key] = validateChunkEntry(value, key);
    }
  }

  // `targets` (M5-C, optional): stable name -> TargetSpec.
  let targets: Record<string, TargetSpec> | undefined;
  if (raw.targets !== undefined) {
    assert(isObject(raw.targets), 'targets must be an object');
    targets = {};
    for (const [key, value] of Object.entries(raw.targets)) {
      const spec = validateTargetSpec(value, key);
      // A target scoped to an UNDECLARED chunk is dead on arrival: the host will not
      // transform that file at all (`transformSurfaceFor` returns null for an
      // undeclared id), so the target can never resolve — and the pipeline has no
      // unpacked dir for it either, so verification never looks. Both failures are
      // silent. Refuse the map instead: an undeclared chunk means the `chunks`
      // section and the `targets` section disagree about what this build contains.
      const surface = spec.surface;
      if (surface !== undefined && surface !== MAIN_SURFACE_FILE) {
        const id = surface.replace(/\.bundle\.js$/, '');
        assert(
          chunks !== undefined && Object.prototype.hasOwnProperty.call(chunks, id),
          `targets['${key}'].surface names chunk '${id}', which the map's chunks section does not declare (an undeclared chunk is never transformed, so the target could never resolve)`,
        );
      }
      targets[key] = spec;
    }
  }

  return {
    formatVersion: raw.formatVersion,
    gameVersion: raw.gameVersion,
    bundleHash: raw.bundleHash as BundleHash,
    generated: {
      from: String(raw.generated.from ?? ''),
      matcher: String(raw.generated.matcher ?? ''),
      granularity: String(raw.generated.granularity ?? ''),
      note: String(raw.generated.note ?? ''),
    },
    modules,
    unresolved,
    ...(targets ? { targets } : {}),
    ...(chunks ? { chunks } : {}),
  };
}

/**
 * Load + validate a map JSON file from `path` (a filesystem path or URL).
 * Rejects malformed JSON or schema-invalid maps with `MapParseError`.
 */
export async function loadMap(path: string | URL): Promise<GameMap> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (err) {
    throw new MapParseError(`could not read map file ${String(path)}: ${(err as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new MapParseError(`invalid JSON in map file ${String(path)}: ${(err as Error).message}`);
  }
  return validateMap(parsed);
}

/** File URL of the bundled PolyTrack 0.6.2 map (relative to this module). */
export const defaultMapUrl = new URL('../maps/polytrack-0.6.2.json', import.meta.url);

/** Load + validate the bundled PolyTrack 0.6.2 map. */
export function loadDefaultMap(): Promise<GameMap> {
  return loadMap(defaultMapUrl);
}

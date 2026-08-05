/**
 * Map loader + structural validator.
 *
 * `loadMap(path)` reads + validates a map JSON file into a typed `GameMap`.
 * `loadDefaultMap()` returns the bundled PolyTrack 0.6.2 map. Validation is
 * strict: a malformed map throws `MapParseError` naming the offending field,
 * rather than letting a half-parsed map reach the resolver.
 */
import { readFile } from 'node:fs/promises';

import { MAP_FORMAT_VERSION } from './types.js';
import type { BundleHash, GameMap, ModuleEntry, TargetSpec, UnresolvedEntry } from './types.js';

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
  // resolver ranks lexical above structural when two modules share a stable name, so a
  // typo'd or future value read as "not structural" would quietly win a collision it
  // should lose. Fail closed on anything we do not understand.
  assert(
    raw.decidedBy === undefined || raw.decidedBy === 'lexical' || raw.decidedBy === 'structural',
    `modules['${key}'].decidedBy must be 'lexical' or 'structural' when present`,
  );
  assert(
    raw.structuralSimilarity === undefined || isNumber(raw.structuralSimilarity),
    `modules['${key}'].structuralSimilarity must be a number when present`,
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
  if (raw.selector.kind === 'method') {
    assert(typeof raw.selector.name === 'string' && raw.selector.name.length > 0, `targets['${key}'].selector.name must be a non-empty string`);
  }
  if (raw.selector.kind === 'property') {
    assert(typeof raw.selector.key === 'string' && raw.selector.key.length > 0, `targets['${key}'].selector.key must be a non-empty string`);
  }
  return {
    anchor: {
      literals: raw.anchor.literals,
      ...(raw.anchor.minHits !== undefined ? { minHits: raw.anchor.minHits } : {}),
    },
    selector: raw.selector,
  } as unknown as TargetSpec;
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

  // `targets` (M5-C, optional): stable name -> TargetSpec.
  let targets: Record<string, TargetSpec> | undefined;
  if (raw.targets !== undefined) {
    assert(isObject(raw.targets), 'targets must be an object');
    targets = {};
    for (const [key, value] of Object.entries(raw.targets)) {
      targets[key] = validateTargetSpec(value, key);
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

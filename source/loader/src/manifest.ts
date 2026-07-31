import type { AuthorEntry, DependencyMap, GlobalManifest, VersionManifest } from './types.js';
import { ID_PATTERN } from './types.js';
import { isValidRange, isValidVersion } from './semver.js';

/**
 * A validation error that names the offending manifest field. The loader treats
 * a bad manifest as a per-mod failure (fail small), so callers can catch this to
 * record a load status rather than aborting the whole batch.
 */
export class ManifestError extends Error {
  constructor(
    /** Dotted path to the bad field, e.g. `depends["tspml-api"]` or `version`. */
    public readonly field: string,
    message: string,
    /** The manifest id, when known. */
    public readonly manifestId?: string,
  ) {
    super(message);
    this.name = 'ManifestError';
  }
}

const ENVIRONMENTS = new Set(['*', 'web', 'desktop', 'worker']);

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isString(v: unknown): v is string {
  return typeof v === 'string';
}

function field(manifestId: string | undefined, path: string): string {
  return manifestId ? `${manifestId}: ${path}` : path;
}

/**
 * Stamp the known manifest id onto a {@link ManifestError} thrown deep in a
 * helper (which only knew the field path). Centralised here so every error
 * carries `manifestId` without each throw site repeating itself.
 */
function attachManifestId(err: unknown, idHint: string | undefined): unknown {
  if (err instanceof ManifestError && err.manifestId === undefined && idHint !== undefined) {
    return new ManifestError(err.field, err.message, idHint);
  }
  return err;
}

/** Validate a mod id against `/^[a-z0-9-]+$/`. */
export function isValidId(id: string): boolean {
  return ID_PATTERN.test(id);
}

/**
 * Validate a VersionManifest-shaped object. Throws {@link ManifestError} naming
 * the offending field on the first problem encountered.
 */
export function parseVersionManifest(input: unknown): VersionManifest {
  const idHint = isObject(input) && isString(input.id) ? input.id : undefined;
  try {
    return parseVersionManifestImpl(input, idHint);
  } catch (err) {
    throw attachManifestId(err, idHint);
  }
}

function parseVersionManifestImpl(input: unknown, idHint: string | undefined): VersionManifest {
  if (!isObject(input)) {
    throw new ManifestError(field(idHint, '<root>'), 'manifest must be an object');
  }

  const m = input;
  const requireString = (key: keyof VersionManifest): string => {
    const v = m[key];
    if (!isString(v) || v.length === 0) {
      throw new ManifestError(
        field(idHint, String(key)),
        `field '${key}' must be a non-empty string`,
      );
    }
    return v;
  };

  // schemaVersion
  if (typeof m.schemaVersion !== 'number' || !Number.isFinite(m.schemaVersion)) {
    throw new ManifestError(field(idHint, 'schemaVersion'), "field 'schemaVersion' must be a number");
  }
  if (m.schemaVersion !== 1) {
    throw new ManifestError(
      field(idHint, 'schemaVersion'),
      `unsupported schemaVersion ${String(m.schemaVersion)} (loader supports 1)`,
    );
  }

  // id
  const id = requireString('id');
  if (!isValidId(id)) {
    throw new ManifestError(
      field(idHint, 'id'),
      `id '${id}' is invalid (must match /${ID_PATTERN.source}/)`,
    );
  }

  // name
  requireString('name');

  // version
  const version = requireString('version');
  if (!isValidVersion(version)) {
    throw new ManifestError(
      field(idHint, 'version'),
      `version '${version}' is not a valid semver`,
    );
  }

  // entrypoint
  requireString('entrypoint');

  // targets
  const targets = validateTargets(m.targets, idHint);

  // optional strings
  for (const key of ['description', 'license', 'icon', 'homepage'] as const) {
    if (key in m && m[key] !== undefined) {
      if (!isString(m[key])) {
        throw new ManifestError(
          field(idHint, key),
          `field '${key}' must be a string`,
        );
      }
    }
  }

  // environment
  let environment: VersionManifest['environment'];
  if (m.environment !== undefined) {
    if (!isString(m.environment) || !ENVIRONMENTS.has(m.environment)) {
      throw new ManifestError(
        field(idHint, 'environment'),
        `environment '${String(m.environment)}' must be one of: *, web, desktop, worker`,
      );
    }
    environment = m.environment as VersionManifest['environment'];
  }

  // authors
  let authors: VersionManifest['authors'];
  if (m.authors !== undefined) {
    authors = validateAuthors(m.authors, idHint);
  }

  // dependency maps
  const depends = validateDependencyMap(m.depends, 'depends', idHint);
  const recommends = validateDependencyMap(m.recommends, 'recommends', idHint);
  const suggests = validateDependencyMap(m.suggests, 'suggests', idHint);
  const conflicts = validateDependencyMap(m.conflicts, 'conflicts', idHint);
  const breaks = validateDependencyMap(m.breaks, 'breaks', idHint);
  const includes = validateDependencyMap(m.includes, 'includes', idHint);

  // provides
  let provides: string[] | undefined;
  if (m.provides !== undefined) {
    provides = validateStringArray(m.provides, 'provides', idHint);
  }

  // mixins
  let mixins: VersionManifest['mixins'];
  if (m.mixins !== undefined) {
    mixins = validateMixins(m.mixins, idHint);
  }

  // capabilities
  let capabilities: string[] | undefined;
  if (m.capabilities !== undefined) {
    capabilities = validateStringArray(m.capabilities, 'capabilities', idHint);
  }

  // vanillaSafe
  let vanillaSafe: boolean | undefined;
  if (m.vanillaSafe !== undefined) {
    if (typeof m.vanillaSafe !== 'boolean') {
      throw new ManifestError(field(idHint, 'vanillaSafe'), "field 'vanillaSafe' must be a boolean");
    }
    vanillaSafe = m.vanillaSafe;
  }

  // custom
  let custom: Record<string, unknown> | undefined;
  if (m.custom !== undefined) {
    if (!isObject(m.custom)) {
      throw new ManifestError(field(idHint, 'custom'), "field 'custom' must be an object");
    }
    custom = m.custom;
  }

  const manifest: VersionManifest = {
    schemaVersion: 1,
    id,
    name: m.name as string,
    version,
    entrypoint: m.entrypoint as string,
    targets,
  };
  if (m.description !== undefined) manifest.description = m.description as string;
  if (authors !== undefined) manifest.authors = authors;
  if (m.license !== undefined) manifest.license = m.license as string;
  if (m.icon !== undefined) manifest.icon = m.icon as string;
  if (m.homepage !== undefined) manifest.homepage = m.homepage as string;
  if (environment !== undefined) manifest.environment = environment;
  if (depends !== undefined) manifest.depends = depends;
  if (recommends !== undefined) manifest.recommends = recommends;
  if (suggests !== undefined) manifest.suggests = suggests;
  if (conflicts !== undefined) manifest.conflicts = conflicts;
  if (breaks !== undefined) manifest.breaks = breaks;
  if (includes !== undefined) manifest.includes = includes;
  if (provides !== undefined) manifest.provides = provides;
  if (mixins !== undefined) manifest.mixins = mixins;
  if (capabilities !== undefined) manifest.capabilities = capabilities;
  if (vanillaSafe !== undefined) manifest.vanillaSafe = vanillaSafe;
  if (custom !== undefined) manifest.custom = custom;

  return manifest;
}

function validateTargets(raw: unknown, idHint: string | undefined): string[] {
  if (!Array.isArray(raw)) {
    throw new ManifestError(field(idHint, 'targets'), "field 'targets' must be an array of semver ranges");
  }
  const out: string[] = [];
  raw.forEach((entry, i) => {
    if (!isString(entry)) {
      throw new ManifestError(
        field(idHint, `targets[${i}]`),
        `targets[${i}] must be a string`,
      );
    }
    if (!isValidRange(entry)) {
      throw new ManifestError(
        field(idHint, `targets[${i}]`),
        `targets[${i}] '${entry}' is not a valid semver range`,
      );
    }
    out.push(entry);
  });
  return out;
}

function validateDependencyMap(
  raw: unknown,
  name: string,
  idHint: string | undefined,
): DependencyMap | undefined {
  if (raw === undefined) return undefined;
  if (!isObject(raw)) {
    throw new ManifestError(field(idHint, name), `field '${name}' must be an object (id -> range)`);
  }
  const out: DependencyMap = {};
  for (const [depId, range] of Object.entries(raw)) {
    if (!isString(range)) {
      throw new ManifestError(
        field(idHint, `${name}["${depId}"]`),
        `${name}["${depId}"] must be a string range`,
      );
    }
    if (!isValidRange(range)) {
      throw new ManifestError(
        field(idHint, `${name}["${depId}"]`),
        `${name}["${depId}"] '${range}' is not a valid semver range`,
      );
    }
    out[depId] = range;
  }
  return out;
}

function validateStringArray(raw: unknown, name: string, idHint: string | undefined): string[] {
  if (!Array.isArray(raw)) {
    throw new ManifestError(field(idHint, name), `field '${name}' must be an array of strings`);
  }
  const out: string[] = [];
  raw.forEach((entry, i) => {
    if (!isString(entry)) {
      throw new ManifestError(field(idHint, `${name}[${i}]`), `${name}[${i}] must be a string`);
    }
    out.push(entry);
  });
  return out;
}

function validateAuthors(raw: unknown, idHint: string | undefined): AuthorEntry | AuthorEntry[] {
  const checkOne = (entry: unknown, path: string): AuthorEntry => {
    if (isString(entry)) return entry;
    if (isObject(entry)) {
      if (!isString(entry.name)) {
        throw new ManifestError(field(idHint, path), `${path}.name must be a string`);
      }
      const author: { name: string; contact?: string } = { name: entry.name };
      if (entry.contact !== undefined) {
        if (!isString(entry.contact)) {
          throw new ManifestError(field(idHint, `${path}.contact`), `${path}.contact must be a string`);
        }
        author.contact = entry.contact;
      }
      return author;
    }
    throw new ManifestError(field(idHint, path), `${path} must be a string or { name, contact? }`);
  };

  if (Array.isArray(raw)) {
    return raw.map((entry, i) => checkOne(entry, `authors[${i}]`));
  }
  return checkOne(raw, 'authors');
}

function validateMixins(raw: unknown, idHint: string | undefined): NonNullable<VersionManifest['mixins']> {
  if (!Array.isArray(raw)) {
    throw new ManifestError(field(idHint, 'mixins'), "field 'mixins' must be an array");
  }
  return raw.map((entry, i) => {
    if (!isObject(entry)) {
      throw new ManifestError(field(idHint, `mixins[${i}]`), `mixins[${i}] must be an object`);
    }
    if (!isString(entry.config)) {
      throw new ManifestError(field(idHint, `mixins[${i}].config`), `mixins[${i}].config must be a string`);
    }
    const out: { config: string; environment?: 'web' | 'desktop' | 'worker' | '*' } = { config: entry.config };
    if (entry.environment !== undefined) {
      if (!isString(entry.environment) || !ENVIRONMENTS.has(entry.environment)) {
        throw new ManifestError(
          field(idHint, `mixins[${i}].environment`),
          `mixins[${i}].environment must be one of: *, web, desktop, worker`,
        );
      }
      out.environment = entry.environment as 'web' | 'desktop' | 'worker' | '*';
    }
    return out;
  });
}

/**
 * Validate a GlobalManifest (`manifest.json`) object. Throws {@link ManifestError}.
 */
export function parseGlobalManifest(input: unknown): GlobalManifest {
  const idHint = isObject(input) && isString(input.id) ? input.id : undefined;
  try {
    return parseGlobalManifestImpl(input, idHint);
  } catch (err) {
    throw attachManifestId(err, idHint);
  }
}

function parseGlobalManifestImpl(input: unknown, idHint: string | undefined): GlobalManifest {
  if (!isObject(input)) {
    throw new ManifestError(field(idHint, '<root>'), 'manifest must be an object');
  }

  const id = input.id;
  if (!isString(id) || id.length === 0) {
    throw new ManifestError(field(idHint, 'id'), "field 'id' must be a non-empty string");
  }
  if (!isValidId(id)) {
    throw new ManifestError(field(idHint, 'id'), `id '${id}' is invalid (must match /${ID_PATTERN.source}/)`);
  }

  if (!isString(input.name) || input.name.length === 0) {
    throw new ManifestError(field(idHint, 'name'), "field 'name' must be a non-empty string");
  }
  if (!isString(input.author) || input.author.length === 0) {
    throw new ManifestError(field(idHint, 'author'), "field 'author' must be a non-empty string");
  }

  const latestRaw = input.latest;
  if (!isObject(latestRaw)) {
    throw new ManifestError(field(idHint, 'latest'), "field 'latest' must be an object (gameVersion -> modVersion)");
  }
  const latest: Record<string, string> = {};
  for (const [gv, mv] of Object.entries(latestRaw)) {
    if (!isString(mv)) {
      throw new ManifestError(field(idHint, `latest["${gv}"]`), `latest["${gv}"] must be a string`);
    }
    latest[gv] = mv;
  }

  return { id, name: input.name, author: input.author, latest };
}

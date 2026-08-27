/**
 * The mod registry: a curated list of mods and modpacks the launcher can browse
 * and install from.
 *
 * Today it is a JSON file we commit (`public/registry/index.json`), fetched at
 * runtime rather than imported at build time. Two reasons, and the second is the
 * one that matters:
 *  - a static import inlines every entry into the JS bundle, so the catalog
 *    would cost every visitor bytes whether or not they ever open Browse;
 *  - swapping in a real HTTP backend later becomes a one-constant change with
 *    the UI untouched, which is the whole point of this file existing.
 *
 * The fetch is same-origin, for our own static asset. It is NOT user-pointed and
 * does not go through `/api/proxy`, so the #80 invariant (the server must never
 * become a fetcher of arbitrary URLs) is untouched.
 *
 * What this is NOT, and the UI says so plainly: a search index. There is no
 * backend, no ratings, no download counts, no version history. It is a list of
 * tens of entries, filtered in the browser. Presenting it as anything larger
 * would be inventing social proof we do not have.
 *
 * ## Trust posture
 *
 * A curated file is NOT a trust upgrade. Every install still goes through
 * `checkImportUrl` and the same caps as a hand-typed URL, and author-supplied
 * `icon`/`homepage`/`docs` go through the same host rules as manifest fields.
 * The file is ours today; the seam exists precisely so it may not be tomorrow,
 * and the checks are three comparisons. Mod code runs unsandboxed either way —
 * that disclosure belongs at the install click, not only in the paste form.
 */
import { checkImportUrl } from './mod-fetch';
import type { ModFormatId } from './mod-formats/types';
import { isSupportedFormat } from './mod-formats';

/** Where the catalog lives. Swap this for an API origin and nothing else moves. */
export const REGISTRY_URL = '/registry/index.json';

/** Cap the catalog response like any other fetch. Tens of entries, not thousands. */
export const REGISTRY_LIMITS = {
  maxChars: 512_000,
  timeoutMs: 15_000,
} as const;

/** The complete set of content types. Texture packs are deliberately absent:
 *  PolyTrack ships one 3D texture and colors its world by material and vertex
 *  color, so asset and model swapping is what an ordinary mod does. */
export type RegistryKind = 'mod' | 'modpack';

export interface RegistrySafety {
  /** The mod ships a `physics.json`. Warn-only, never a block. */
  readonly touchesPhysics: boolean;
  /** How likely using this is to make your times incomparable to other players'. */
  readonly leaderboardRisk: 'none' | 'low' | 'high';
}

export interface RegistryEntry {
  readonly kind: RegistryKind;
  /**
   * Which loader format the entry is authored for.
   *
   * Load-bearing, not decorative: `useInstall` passes it straight to
   * `importModFromUrl`, so it decides which walk runs and how the stored code is
   * later executed. It is also the source of the loader-format tag every entry
   * shows — see {@link entryTags} for why that is derived rather than written.
   */
  readonly format: ModFormatId;
  readonly id: string;
  readonly name: string;
  readonly author: string;
  /** One line, plain text. Not markdown — this is rendered as text content. */
  readonly summary: string;
  /**
   * Content tags — what the entry DOES. The loader-format tag is not in here
   * and must not be written into it; {@link entryTags} derives that from
   * `format`, so the two cannot disagree.
   */
  readonly tags: readonly string[];
  /**
   * Where to fetch it from. `mod-json` is a single manifest URL; `mod-root` is
   * a DIRECTORY that the format's own walk descends (PML addresses mods this
   * way, and its whole registry is directory URLs); `modpack-txt` is a list of
   * mod URLs, one per line.
   *
   * The distinction is descriptive, not dispatch: `format` is what chooses the
   * walk. It exists so a row that is a directory does not have to claim to be a
   * `mod.json`, which would be a lie in our own catalog file about the one
   * field a reader would use to guess what lives at the other end.
   */
  readonly source: { readonly type: 'mod-json' | 'mod-root' | 'modpack-txt'; readonly url: string };
  readonly icon?: string;
  readonly homepage?: string;
  readonly docs?: string;
  /** Free-text range, shown not parsed. There is no resolver to feed it to. */
  readonly gameVersions: readonly string[];
  readonly safety: RegistrySafety;
  /** Other registry ids this needs. Resolved ONLY through the registry. */
  readonly dependencies: readonly string[];
}

export interface Registry {
  readonly schemaVersion: 1;
  readonly entries: readonly RegistryEntry[];
}

export type RegistryResult =
  | { readonly ok: true; readonly registry: Registry }
  | { readonly ok: false; readonly error: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

/**
 * An author-supplied URL as something safe to put in an `href`, or null.
 *
 * Same rules as `userModHomepage`, and deliberately a separate implementation
 * rather than a shared one: that function takes a `UserModRecord` and reads a
 * manifest field off it. Coupling the catalog to the storage record's shape to
 * save nine lines would be the wrong trade — a `javascript:` href here would run
 * in the portal's origin exactly like it would there.
 */
export function registryHttpUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.hostname === 'kodub.com' || url.hostname.endsWith('.kodub.com')) return null;
  return url.href;
}

/**
 * An author-supplied icon as an `<img src>`, or null. `data:image/*` is allowed
 * for the same reason the paste path allows it and nothing else is: an image
 * context does not execute script, and a data: URI cannot navigate.
 */
export function registryIcon(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  if (/^data:image\//i.test(raw)) return raw;
  return registryHttpUrl(raw);
}

/**
 * Validate one entry. Anything malformed is DROPPED rather than defaulted:
 * a catalog row with a missing source URL or an unknown kind is a mistake in
 * our own file, and silently rendering it with invented values would hide the
 * mistake behind a card that fails only when someone clicks Install.
 */
function parseEntry(v: unknown): RegistryEntry | null {
  if (!isRecord(v)) return null;
  const { kind, format, id, name, author, summary, tags, source, gameVersions, safety } = v;
  if (kind !== 'mod' && kind !== 'modpack') return null;
  if (format !== 'tspml' && format !== 'pml') return null;
  if (typeof id !== 'string' || id.length === 0) return null;
  if (typeof name !== 'string' || name.length === 0) return null;
  if (typeof author !== 'string') return null;
  if (typeof summary !== 'string') return null;
  if (!isStringArray(tags)) return null;
  if (!isRecord(source)) return null;
  if (source.type !== 'mod-json' && source.type !== 'mod-root' && source.type !== 'modpack-txt') {
    return null;
  }
  if (typeof source.url !== 'string' || source.url.length === 0) return null;
  if (!isStringArray(gameVersions)) return null;
  if (!isRecord(safety)) return null;
  if (typeof safety.touchesPhysics !== 'boolean') return null;
  const risk = safety.leaderboardRisk;
  if (risk !== 'none' && risk !== 'low' && risk !== 'high') return null;
  const deps = isStringArray(v.dependencies) ? v.dependencies : [];

  const icon = registryIcon(v.icon);
  const homepage = registryHttpUrl(v.homepage);
  const docs = registryHttpUrl(v.docs);
  return {
    kind,
    format,
    id,
    name,
    author,
    summary,
    tags,
    source: { type: source.type, url: source.url },
    ...(icon === null ? {} : { icon }),
    ...(homepage === null ? {} : { homepage }),
    ...(docs === null ? {} : { docs }),
    gameVersions,
    safety: { touchesPhysics: safety.touchesPhysics, leaderboardRisk: risk },
    dependencies: deps,
  };
}

export function parseRegistry(v: unknown): RegistryResult {
  if (!isRecord(v)) return { ok: false, error: 'the registry is not a JSON object' };
  if (v.schemaVersion !== 1) {
    return { ok: false, error: `unsupported registry schemaVersion: ${String(v.schemaVersion)}` };
  }
  if (!Array.isArray(v.entries)) return { ok: false, error: 'the registry has no entries array' };
  const entries: RegistryEntry[] = [];
  const seen = new Set<string>();
  for (const raw of v.entries) {
    const entry = parseEntry(raw);
    // Duplicate ids would make `getRegistryEntry` ambiguous and the detail
    // route non-deterministic. First one wins; the test catches the commit.
    if (entry !== null && !seen.has(entry.id)) {
      seen.add(entry.id);
      entries.push(entry);
    }
  }
  return { ok: true, registry: { schemaVersion: 1, entries } };
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Load the catalog. `fetchImpl` is injectable so tests never touch the network
 * and a future backend swap has an obvious seam.
 */
export async function listRegistry(fetchImpl: FetchLike = fetch): Promise<RegistryResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REGISTRY_LIMITS.timeoutMs);
  try {
    const res = await fetchImpl(REGISTRY_URL, { signal: controller.signal });
    if (!res.ok) return { ok: false, error: `the mod list could not be loaded (HTTP ${res.status})` };
    const text = await res.text();
    if (text.length > REGISTRY_LIMITS.maxChars) {
      return { ok: false, error: 'the mod list is larger than expected and was not read' };
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return { ok: false, error: 'the mod list is not valid JSON' };
    }
    return parseRegistry(json);
  } catch (err) {
    const why = err instanceof Error && err.name === 'AbortError' ? 'timed out' : 'could not be reached';
    return { ok: false, error: `the mod list ${why}` };
  } finally {
    clearTimeout(timer);
  }
}

export function getRegistryEntry(registry: Registry, id: string): RegistryEntry | null {
  return registry.entries.find((e) => e.id === id) ?? null;
}

/**
 * An entry's source URL, absolute.
 *
 * Catalog URLs may be RELATIVE, and the portal's own sample entries are, for a
 * reason worth stating: a committed absolute `https://tspml.vercel.app/...`
 * would make a local dev server install from production, and a preview
 * deployment install from prod too. Both would "work" often enough to hide the
 * mistake. Relative entries resolve against whatever origin is serving the
 * catalog, so each deployment demonstrates itself.
 *
 * This mirrors `parseModpackList`, whose lines are relative to the pack file for
 * the same portability reason. Absolute URLs pass through untouched, which is
 * what every third-party entry will be.
 */
export function resolveSourceUrl(entry: RegistryEntry, origin: string): string {
  try {
    return new URL(entry.source.url, origin).href;
  } catch {
    // Left for `checkImportUrl` to refuse by name rather than throwing here.
    return entry.source.url;
  }
}

/**
 * What a player should know BEFORE installing this entry, or null when there is
 * nothing unusual to say. Advisory: it never blocks.
 *
 * Only `pml` has anything to say today. A PML mod installs and runs through the
 * compatibility adapter in `lib/pml/`, and the parts that carry across (hooks,
 * keybinds, settings, `getMod`) are not the parts that don't (mixins, raw
 * physics offsets, `eval`-shaped patching). Saying so at install time is the
 * whole point: the alternative is a mod that installs cleanly, loads cleanly,
 * reports success, and does nothing — the silence this project exists to end.
 * What exactly was refused, for the mod actually in front of you, arrives after
 * it runs (`ModLoadSummary.pml`); this is the part we can say up front.
 */
export function installCaveat(entry: RegistryEntry): string | null {
  if (entry.format !== 'pml') return null;
  return 'this mod is packaged for PML and installs through TSPML\'s compatibility adapter. Lifecycle hooks, keybinds and settings carry across; mixins do not — PML patches the game by matching minified identifiers at runtime, TSPML patches structurally against a symbol map, so the two are not interchangeable. Each refused call is reported by name once the mod runs, so a mod whose patching was all mixins will load and visibly do less than it claims.';
}

/**
 * Why an entry cannot be installed, or null when it can.
 *
 * Returns the REASON rather than a boolean so the UI can say it out loud. A
 * greyed-out button with no explanation is the thing this is designed to avoid.
 *
 * Since PML compatibility landed, format is no longer a reason to refuse: both
 * `tspml` and `pml` install (see {@link installCaveat} for what a PML install
 * costs). The check stays because {@link SUPPORTED_FORMATS} is what decides,
 * not this function — a build that ships a third format id before it ships the
 * code to run it must refuse by name rather than install a mod nothing can
 * execute.
 */
export function installBlockedReason(entry: RegistryEntry, origin: string): string | null {
  if (!isSupportedFormat(entry.format)) {
    return `this entry is packaged for '${entry.format}', which this build cannot load.`;
  }
  // The curated file gets NO exemption from the URL policy. It is ours today;
  // the seam exists so it may not be tomorrow, and this is three comparisons.
  const checked = checkImportUrl(resolveSourceUrl(entry, origin));
  if (!checked.ok) return `this entry's source URL is not importable: ${checked.error}`;
  return null;
}

export function isInstallable(entry: RegistryEntry, origin: string): boolean {
  return installBlockedReason(entry, origin) === null;
}

/**
 * Resolve `entry`'s dependencies against the registry.
 *
 * Registry ids ONLY, and an unlisted id is returned as `missing` rather than
 * being quietly skipped. There is no dependency graph backend to consult, so
 * "we could not find this" is the complete truth and the UI should print it
 * instead of installing a mod that will fail at load time for a reason the
 * player cannot see.
 */
export function resolveDependencies(
  registry: Registry,
  entry: RegistryEntry,
): { readonly resolved: readonly RegistryEntry[]; readonly missing: readonly string[] } {
  const resolved: RegistryEntry[] = [];
  const missing: string[] = [];
  for (const id of entry.dependencies) {
    const dep = getRegistryEntry(registry, id);
    if (dep === null) missing.push(id);
    else resolved.push(dep);
  }
  return { resolved, missing };
}

/**
 * Every tag an entry shows: its loader format first, then its content tags.
 *
 * The format tag is DERIVED rather than written into each row's `tags` array,
 * and that is the whole design. `format` already decides which walk installs the
 * entry and how its code is later executed; a hand-written `"pml"` in `tags`
 * would be a second, unenforced copy of that fact, and the two would drift on
 * the first row someone edits in a hurry. Deriving it means the chip a player
 * filters by and the code path that actually runs are the same field.
 *
 * It sorts first because it is a different KIND of fact from the rest — `ui` and
 * `car` describe what a mod does, `pml` describes what will happen when you
 * press Install. Grouping it in alphabetically among the content tags would bury
 * the one tag with consequences.
 */
export function entryTags(entry: RegistryEntry): string[] {
  // Deduped: a row that also hand-wrote its format must not render two chips
  // whose keys collide. Dropping the duplicate is right — the derived one is
  // the authoritative copy either way.
  return [entry.format, ...entry.tags.filter((t) => t !== entry.format)];
}

/**
 * Every tag in the catalog, deduped and sorted — the filter row's vocabulary.
 *
 * Format tags lead, so `pml` and `tspml` sit together at the front of the row
 * rather than being scattered through the content tags. Both are real filters:
 * "show me only what runs natively" is a question a player has, and the answer
 * changes what installing costs them.
 */
export function registryTags(entries: readonly RegistryEntry[]): string[] {
  const formats = new Set<string>();
  const content = new Set<string>();
  for (const e of entries) {
    formats.add(e.format);
    for (const t of e.tags) if (t !== e.format) content.add(t);
  }
  return [...[...formats].sort(), ...[...content].sort()];
}

/**
 * Client-side search: name, author, summary, tags, id. Substring, case-folded,
 * every term must match somewhere. Not ranked — with tens of entries a relevance
 * score would be theatre, and an unranked list that is obviously complete beats
 * a ranked one whose ordering nobody can explain.
 *
 * Both the filter and the haystack read {@link entryTags}, not `tags`, so the
 * format chips in the filter row are chips that actually filter and typing
 * "pml" finds the PML mods. A chip that is rendered but not matchable is worse
 * than no chip: it looks like a control and behaves like decoration.
 */
export function searchRegistry(
  entries: readonly RegistryEntry[],
  query: string,
  tag: string | null,
): RegistryEntry[] {
  const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 0);
  return entries.filter((e) => {
    const tags = entryTags(e);
    if (tag !== null && !tags.includes(tag)) return false;
    if (terms.length === 0) return true;
    const hay = `${e.name} ${e.author} ${e.summary} ${tags.join(' ')} ${e.id}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}

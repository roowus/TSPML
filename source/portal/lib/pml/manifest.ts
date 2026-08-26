/**
 * PML manifest → TSPML manifest translation (pure).
 *
 * A PML mod's metadata nests under `polymod`; TSPML's lives at the top level and
 * is validated by `@tspml/loader`'s `parseVersionManifest`. This file is the
 * only place that knows how one becomes the other, and it is deliberately pure:
 * no fetching, no storage, no `api` — so every rule below is a unit test rather
 * than a thing you discover by importing a real mod and squinting.
 *
 * Three translations are load-bearing and none of them is cosmetic:
 *
 * - **`targets` are the game versions the mod was built for**, which is exactly
 *   what TSPML's `targets` means too — so they carry across as semver ranges and
 *   a PML mod built for 0.5.0 gets SOFT-DISABLED on a 0.6.2 portal, with the
 *   loader's own reason. That is the correct outcome, not a bug in the adapter:
 *   the mod patches identifiers that release did not have. A target that isn't a
 *   valid range is dropped and NAMED — silently widening to "runs anywhere" is
 *   how you get a mod that loads and then misbehaves.
 * - **`dependencies` are PML-registry ids**, which resolve against a registry
 *   TSPML does not have. They are recorded under `custom.pml` and deliberately
 *   NOT emitted as `depends`: an unresolvable `depends` is abortive in the
 *   loader's pre-gate, so translating them would turn "this mod has deps" into
 *   "this mod cannot load", which is worse information than saying so plainly.
 * - **`touchingPhysics` becomes `vanillaSafe: false`.** It is the author's own
 *   claim that the mod alters physics, and it is the one field whose meaning
 *   maps exactly onto something TSPML's warn-only safety classifier reads.
 *
 * The original PML id survives verbatim in `custom.pml.id` even when the TSPML
 * id had to be slugified, because `pml.getMod("<id>")` — the documented way PML
 * mods reach each other's state around the game-scope footgun — looks up by the
 * PML id, not ours.
 */
import { isValidRange } from '@tspml/loader';

/** The `polymod` block of a PML manifest, as far as this adapter reads it. */
interface PolymodBlock {
  readonly id?: unknown;
  readonly name?: unknown;
  readonly author?: unknown;
  readonly version?: unknown;
  readonly description?: unknown;
  readonly main?: unknown;
  readonly targets?: unknown;
  readonly modThumbnail?: unknown;
  readonly touchingPhysics?: unknown;
}

export interface PmlManifestTranslation {
  /** A TSPML manifest object, shaped to pass `parseVersionManifest`. */
  readonly manifest: Record<string, unknown>;
  /** The entry file to fetch, relative to the manifest URL (`<main>.mod.js`). */
  readonly entryPath: string;
  /** Non-fatal facts the author should see (dropped targets, defaults used). */
  readonly notes: readonly string[];
}

export type PmlManifestResult =
  | { readonly ok: true; readonly value: PmlManifestTranslation }
  | { readonly ok: false; readonly error: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/**
 * A PML id as a TSPML id (`/^[a-z0-9-]+$/`). PML ids are usually already
 * conformant; the ones that aren't (dots, underscores, capitals) get folded
 * rather than rejected, because refusing a real mod over a character class
 * would be a self-inflicted incompatibility.
 */
export function slugifyPmlId(raw: string): string {
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'pml-mod';
}

/** True when `parsed` is a PML VERSION manifest (carries the `polymod` block). */
export function isPmlVersionManifest(parsed: unknown): boolean {
  return isRecord(parsed) && isRecord(parsed.polymod);
}

/**
 * True when `parsed` is a PML INDEX manifest — the root file mapping a game
 * version to a mod version (`{"latest": {"0.6.2": "1.2.0"}}`). This is the other
 * half of PML's two-file layout and the reason the importer may fetch twice.
 */
export function isPmlIndexManifest(parsed: unknown): boolean {
  return isRecord(parsed) && isRecord(parsed.latest);
}

/**
 * Which mod version an index manifest points at for `gameVersion`.
 *
 * Falls back to the only entry when there is exactly one, because a single-entry
 * index is unambiguous about what it is offering and refusing it would fail an
 * import over a version string the author never got to state twice. With two or
 * more entries and no match there is a real choice to make, and guessing it is
 * how you silently install a build for the wrong game.
 */
export function pickPmlVersion(
  latest: Record<string, unknown>,
  gameVersion: string,
): { readonly version: string; readonly exact: boolean } | null {
  const direct = str(latest[gameVersion]);
  if (direct !== null) return { version: direct, exact: true };
  const entries = Object.entries(latest).filter(([, v]) => str(v) !== null);
  if (entries.length === 1) return { version: entries[0]![1] as string, exact: false };
  return null;
}

/**
 * Translate a parsed PML version manifest.
 *
 * `gameVersion` is only used for reporting (`targets` are carried as declared,
 * and the LOADER decides whether they are satisfied — one gate, not two).
 */
export function translatePmlManifest(parsed: unknown): PmlManifestResult {
  if (!isRecord(parsed)) return { ok: false, error: 'the PML manifest must be a JSON object' };
  const block = parsed.polymod;
  if (!isRecord(block)) {
    return { ok: false, error: "the PML manifest has no 'polymod' block" };
  }
  const p = block as PolymodBlock;

  const rawId = str(p.id);
  if (rawId === null) {
    return { ok: false, error: "the PML manifest's polymod block has no 'id'" };
  }
  const main = str(p.main);
  if (main === null) {
    return { ok: false, error: "the PML manifest's polymod block has no 'main' — cannot tell which file to fetch" };
  }

  const notes: string[] = [];
  const id = slugifyPmlId(rawId);
  if (id !== rawId) {
    notes.push(`mod id '${rawId}' was slugified to '${id}' (TSPML ids are lowercase a-z, 0-9 and dashes); pml.getMod('${rawId}') still resolves`);
  }

  const version = str(p.version) ?? '0.0.0';
  if (str(p.version) === null) {
    notes.push("the manifest declares no version — '0.0.0' was used");
  }

  // Targets: carried as declared, invalid ones dropped BY NAME.
  const rawTargets = Array.isArray(p.targets) ? p.targets : [];
  const targets: string[] = [];
  const dropped: string[] = [];
  for (const t of rawTargets) {
    if (typeof t === 'string' && isValidRange(t)) targets.push(t);
    else dropped.push(typeof t === 'string' ? t : JSON.stringify(t));
  }
  if (dropped.length > 0) {
    notes.push(`target(s) ${dropped.join(', ')} are not valid semver ranges and were dropped`);
  }
  if (rawTargets.length > 0 && targets.length === 0) {
    // Empty `targets` means "any game version" to the loader, so an author whose
    // targets ALL failed translation must hear that the fence came down.
    notes.push('no declared target survived translation — the mod is no longer version-gated and may run against a game build it was never written for');
  }

  const touchingPhysics = p.touchingPhysics === true;

  const manifest: Record<string, unknown> = {
    schemaVersion: 1,
    id,
    name: str(p.name) ?? rawId,
    version,
    environment: 'web',
    entrypoint: `${main}.mod.js`,
    targets,
    custom: {
      pml: {
        id: rawId,
        main,
        ...(Array.isArray(parsed.dependencies) ? { dependencies: parsed.dependencies } : {}),
        ...(rawTargets.length > 0 ? { targets: rawTargets } : {}),
        ...(dropped.length > 0 ? { droppedTargets: dropped } : {}),
      },
    },
  };
  const description = str(p.description);
  if (description !== null) manifest.description = description;
  const author = str(p.author);
  if (author !== null) manifest.authors = [{ name: author }];
  const icon = str(p.modThumbnail);
  if (icon !== null) manifest.icon = icon;
  // The author's own claim that this mod alters physics — the one PML field that
  // maps exactly onto something the warn-only safety classifier reads.
  if (touchingPhysics) manifest.vanillaSafe = false;

  if (Array.isArray(parsed.dependencies) && parsed.dependencies.length > 0) {
    notes.push(
      `declares ${parsed.dependencies.length} PML dependenc${parsed.dependencies.length === 1 ? 'y' : 'ies'} — those resolve against PML's registry, which TSPML has no view of, so they are recorded but NOT enforced. Install them yourself if the mod needs them.`,
    );
  }

  return { ok: true, value: { manifest, entryPath: `${main}.mod.js`, notes } };
}

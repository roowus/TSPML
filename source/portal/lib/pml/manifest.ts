/**
 * PML manifest → TSPML manifest translation (pure).
 *
 * TSPML's metadata lives at the top level of one file and is validated by
 * `@tspml/loader`'s `parseVersionManifest`. PML's is split across two files and
 * has changed shape once already, so this file is the only place that knows how
 * one becomes the other, and it is deliberately pure: no fetching, no storage,
 * no `api` — so every rule below is a unit test rather than a thing you discover
 * by importing a real mod and squinting.
 *
 * ## PML has two manifest generations and both are live
 *
 * **Current (0.6.x).** Identity lives in the INDEX at the mod root and the
 * version manifest is flat, carrying only what varies per version:
 *
 * ```
 * manifest.json      {"name":"PolyProxy","id":"polyproxy","author":"Orangy",
 *                     "latest":{"0.6.2":"10.0.0"}}
 * 10.0.0/version.json {"targets":["0.6.2"],"main":"main.mod.js","dependencies":[]}
 * ```
 *
 * **Legacy (0.5.x).** Identity is nested under `polymod` in the version manifest
 * and the index is a BARE map with no wrapper and no identity at all:
 *
 * ```
 * latest.json           {"0.5.1":"1.5.0","0.5.2":"1.6.0"}
 * 1.6.0/manifest.json   {"polymod":{"name":"Cool Cars","id":"coolcars",…}}
 * ```
 *
 * So `polymod` is OPTIONAL, not the marker it looks like, and the identity
 * fields may arrive from either file. `translatePmlManifest` takes the index's
 * identity as a second argument and lets the version manifest win on conflict —
 * the same precedence PML's own loader uses when it builds a merged manifest
 * (`{...index, version, ...versionFile}`). Getting this backwards would mean
 * every current PML mod is refused for "no id" while every legacy one loads.
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

/** The metadata block of a PML manifest — the `polymod` object on a legacy
 *  manifest, or the manifest object itself on a current one. */
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
  /** The entry file to fetch, relative to the manifest URL. */
  readonly entryPath: string;
  /** Non-fatal facts the author should see (dropped targets, defaults used). */
  readonly notes: readonly string[];
}

/**
 * Identity carried down from an index manifest, when the walk read one.
 *
 * Current PML mods put `name`/`id`/`author` here and nowhere else, so without
 * this the translation of a 0.6.x mod has no id and is refused. `version` is
 * the mod version the index resolved to — PML supplies it the same way, because
 * a flat version manifest does not state its own version either.
 */
export interface PmlIndexIdentity {
  readonly id?: unknown;
  readonly name?: unknown;
  readonly author?: unknown;
  readonly version?: unknown;
  readonly description?: unknown;
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

/**
 * True when `parsed` is a PML VERSION manifest.
 *
 * The reliable marker is `main` — the file to run — not `polymod`, which only
 * legacy manifests have. A current one is flat (`{"targets":…,"main":…}`), a
 * legacy one nests (`{"polymod":{…,"main":…}}`), and both are answered here.
 */
export function isPmlVersionManifest(parsed: unknown): boolean {
  if (!isRecord(parsed)) return false;
  const block = isRecord(parsed.polymod) ? parsed.polymod : parsed;
  return typeof block.main === 'string' && block.main.length > 0;
}

/**
 * True when `parsed` is a PML INDEX manifest — the root file mapping a game
 * version to a mod version. This is the other half of PML's two-file layout and
 * the reason the importer may fetch twice.
 *
 * Two spellings, both live:
 *
 * - current, wrapped:  `{"id":"polyproxy", "latest": {"0.6.2": "10.0.0"}}`
 * - legacy, bare:      `{"0.5.1": "1.5.0", "0.5.2": "1.6.0"}`
 *
 * The bare form has no marker key at all, so it is recognised STRUCTURALLY: a
 * non-empty object whose every key parses as a version and whose every value is
 * a string. That test is deliberately strict — a loose one would swallow any
 * JSON object and send the walk chasing a mod version that isn't one.
 */
export function isPmlIndexManifest(parsed: unknown): boolean {
  return pmlIndexLatest(parsed) !== null;
}

/** `x.y`/`x.y.z` with an optional pre-release tail (`0.6.0-beta1` is a real
 *  PolyTrack version and a real key in PolyProxy's index). */
const VERSION_KEY = /^\d+\.\d+(\.\d+)?(-[0-9A-Za-z.-]+)?$/;

/**
 * The game→mod version map inside an index manifest, in either spelling, or
 * null when `parsed` is not an index at all.
 *
 * Kept as one function rather than two so detection and reading can never
 * disagree about what an index is — the walk asks "is this an index?" and then
 * "what does it map?", and a mod that answered yes to the first and null to the
 * second would fail with a message describing the wrong problem.
 */
export function pmlIndexLatest(parsed: unknown): Record<string, unknown> | null {
  if (!isRecord(parsed)) return null;
  if (isRecord(parsed.latest)) return parsed.latest;
  const entries = Object.entries(parsed);
  if (entries.length === 0) return null;
  for (const [k, v] of entries) {
    if (!VERSION_KEY.test(k) || typeof v !== 'string') return null;
  }
  return parsed;
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
 * Translate a parsed PML version manifest, with identity from the index when
 * the walk read one.
 *
 * Precedence is version-manifest-wins, matching PML's own merge
 * (`{...index, version, ...versionFile}`): a mod that restates its id in the
 * version file means it, and a current mod that states it nowhere but the index
 * still translates.
 *
 * Targets are carried as DECLARED and the LOADER decides whether they are
 * satisfied — one gate, not two.
 */
export function translatePmlManifest(
  parsed: unknown,
  identity: PmlIndexIdentity = {},
): PmlManifestResult {
  if (!isRecord(parsed)) return { ok: false, error: 'the PML manifest must be a JSON object' };
  // Legacy manifests nest under `polymod`; current ones are flat. Neither is
  // wrong, and which one this is decides nothing else.
  const block = isRecord(parsed.polymod) ? parsed.polymod : parsed;
  const p = block as PolymodBlock;

  const rawId = str(p.id) ?? str(identity.id);
  if (rawId === null) {
    return {
      ok: false,
      error:
        "the PML manifest declares no 'id' — neither in the version manifest nor in the index manifest that named it",
    };
  }
  const main = str(p.main);
  if (main === null) {
    return { ok: false, error: "the PML manifest has no 'main' — cannot tell which file to fetch" };
  }

  const notes: string[] = [];
  const id = slugifyPmlId(rawId);
  if (id !== rawId) {
    notes.push(`mod id '${rawId}' was slugified to '${id}' (TSPML ids are lowercase a-z, 0-9 and dashes); pml.getMod('${rawId}') still resolves`);
  }

  // A current version manifest carries no version of its own — the index names
  // it, which is why the walk passes it down.
  const rawVersion = str(p.version) ?? str(identity.version);
  const version = rawVersion ?? '0.0.0';
  if (rawVersion === null) {
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

  // `main` is a FILENAME in every PML mod on the CDN (`"main": "main.mod.js"`),
  // and PML fetches it verbatim: `${polyModUrl}/${manifest.main}`. Older docs
  // showed a bare stem, so a stem is still completed rather than refused — but
  // appending unconditionally is what makes a real mod request
  // `main.mod.js.mod.js` and 404.
  const entryPath = /\.m?js$/i.test(main) ? main : `${main}.mod.js`;

  const manifest: Record<string, unknown> = {
    schemaVersion: 1,
    id,
    name: str(p.name) ?? str(identity.name) ?? rawId,
    version,
    environment: 'web',
    entrypoint: entryPath,
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
  const description = str(p.description) ?? str(identity.description);
  if (description !== null) manifest.description = description;
  const author = str(p.author) ?? str(identity.author);
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

  return { ok: true, value: { manifest, entryPath, notes } };
}

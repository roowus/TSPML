/**
 * The mod-format seam.
 *
 * TSPML is not the only mod format PolyTrack has. PolyModLoader (PML) shipped
 * first and has a real ecosystem, and the intent is for TSPML to eventually run
 * PML mods — natively or through an adapter. This interface exists so that lands
 * as a new file rather than as surgery on the import path.
 *
 * Nothing here builds PML compatibility. What it does is refuse to foreclose it,
 * and the shape below is chosen against PML's ACTUAL layout rather than a guess:
 *
 * - **`import()` takes a base URL and may fetch N times.** PML is a CDN
 *   directory tree, never a single file or a zip: `<mod>/latest.json` maps a
 *   game version to a mod version, `<mod>/<ver>/manifest.json` carries
 *   `{polymod: {name, id, author, targets, main}, dependencies}`, and the code
 *   lives at `<mod>/<ver>/<main>.mod.js` alongside `icon.png`,
 *   `description.html`, and `assets/*.glb`. An interface shaped as "fetch one
 *   manifest, then resolve relative" cannot express that walk; handing the
 *   format a base URL and letting it drive its own fetches can.
 * - **`ImportContext` carries the fetcher, the caps, and the bust token.** A
 *   format cannot reach for `fetch` and thereby skip the URL policy, the size
 *   caps, or the two-layer cache busting — it gets a `fetchText` that already
 *   enforces all three.
 *
 * The two formats genuinely differ at EXECUTION too, which is why the
 * discriminator is also reserved on `UserModRecord`: a TSPML entrypoint is an ES
 * module with a **default export** (factory or class) receiving `api`, while a
 * PML entrypoint exports a named `polyMod` binding and expects a `pml` global.
 */
import type { FetchLike, ProbedBody } from '../mod-fetch';

/** The formats the import path knows about. `tspml` is native; `pml` installs
 *  through the compatibility adapter in `lib/pml/`, partially and labelled. */
export type ModFormatId = 'tspml' | 'pml';

export interface ImportedMod {
  readonly manifest: Record<string, unknown>;
  readonly code: string;
  readonly mixins?: Record<string, unknown>[];
  /** The mod's `physics.json`, fetched relative to the manifest URL when it
   *  declares one (#43). Stored raw and re-validated on every use. */
  readonly physics?: Record<string, unknown>;
  /** Human note about non-obvious handling (e.g. "manifest synthesized"). */
  readonly note?: string;
  /**
   * Which format actually produced this mod — the value that must reach the
   * stored `UserModRecord.format`, because it is what decides how the code is
   * EXECUTED later (default export vs. `polyMod` + adapter).
   *
   * Stamped by the dispatcher from the format's own `id` rather than written by
   * each format, so a format cannot forget it and quietly have its mods run
   * down the wrong path. Absent only if a format result somehow bypasses
   * `dispatchImport`, which callers should treat as `tspml`.
   */
  readonly format?: ModFormatId;
}

export type ImportResult =
  | { readonly ok: true; readonly mod: ImportedMod }
  | { readonly ok: false; readonly error: string };

/**
 * Everything a format may use to fetch. Deliberately not `fetch` itself: the
 * caps and the URL policy are not optional, and a format that could opt out of
 * them would be a hole in #80's invariants rather than a new feature.
 */
export interface ImportContext {
  /** The capped, timeout-guarded, cache-busting fetcher. */
  readonly fetchText: (
    url: string,
    cap: number,
    what: string,
  ) => Promise<{ ok: true; text: string; contentType: string } | { ok: false; error: string }>;
  /** The raw fetch impl, for formats needing a non-text response. Still must
   *  pass `checkImportUrl` first — see `lib/mod-fetch.ts`. */
  readonly fetchImpl: FetchLike;
  /** One value per import, so every file comes from the same freshness horizon. */
  readonly bust: string | null;
  /**
   * The body the dispatcher already fetched while sniffing, when it has one.
   * Passing it forward avoids a second round-trip for the common case where
   * detection and parsing want the same bytes.
   */
  readonly probed?: ProbedBody;
}

export interface ModFormat {
  readonly id: ModFormatId;
  /** Import the mod rooted at `url`. May perform multiple fetches. */
  import(url: URL, ctx: ImportContext): Promise<ImportResult>;
}

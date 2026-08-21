/**
 * Tier-1 track-editor surface (#87).
 *
 * The editor is the one Tier-1 area that is not in the game's main bundle: it is a
 * lazily-loaded webpack chunk the player only fetches when they open it. So unlike
 * the other registries, `api.editor` is unavailable for most of a session and says
 * so honestly rather than pretending.
 *
 * The contract a mod can rely on:
 *
 *  - every call is safe at any time. Before the chunk loads, before the editor
 *    opens, after it closes, on a game build TSPML does not match: the call
 *    resolves a typed refusal, never throws and never half-applies.
 *  - `insertParts` is UNDO-INTEGRATED. What it places goes onto the editor's own
 *    undo stack as one batch, so a single Ctrl+Z removes the whole insert and the
 *    undo/redo buttons update the way they do for the player's own edits.
 *  - nothing here reads or writes the player's saved tracks. It edits the open
 *    session only; saving stays the player's decision, through the game's own UI.
 */

/**
 * One track part, in the same terms the game's own editor uses.
 *
 * Coordinates are in TILES, not world units (the game multiplies by its part size
 * internally). `partId`, `rotation`, `rotationAxis` and `color` are the game's own
 * numeric enums; a mod normally gets them from {@link EditorRegistry.getParts} and
 * feeds them back rather than constructing them from nothing.
 */
export interface EditorPart {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** The game's part-catalog id. */
  readonly partId: number;
  readonly rotation: number;
  readonly rotationAxis: number;
  /** The game's color enum. A color the part does not offer is rejected. */
  readonly color: number;
  /** Checkpoint ordering for checkpoint parts; null for everything else. */
  readonly checkpointOrder: number | null;
  /**
   * Start-pad ordering for start parts; **null** for everything else — the same
   * shape as {@link EditorPart.checkpointOrder}, and for the same reason.
   *
   * Not `0`. The game validates the two order fields against the part's own
   * catalog entry and throws if either is present on a part that does not take
   * one, so `startOrder: 0` on an ordinary road piece is refused with
   * `reason: 'rejected'`. Most parts are neither a start pad nor a checkpoint,
   * so most parts carry `null` in both.
   */
  readonly startOrder: number | null;
}

/**
 * Why an editor call could not do what was asked.
 *
 * `not-available` and `not-in-editor` are the two a correct mod hits in normal
 * play and should handle quietly; the rest mean something is actually wrong.
 */
export type EditorFailureReason =
  /** The editor chunk has not loaded, or TSPML could not capture it on this build. */
  | 'not-available'
  /** The chunk is captured but the editor is not currently open. */
  | 'not-in-editor'
  /** A part in the request is malformed (non-finite coordinate, missing field). */
  | 'invalid-part'
  /** The game refused a part (unknown id, a color that part does not offer, below ground). */
  | 'rejected'
  /** The game's own state was unreachable — a shape change under a matched build. */
  | 'internal';

export interface EditorInsertSuccess {
  readonly ok: true;
  /** How many parts were placed. */
  readonly inserted: number;
  /**
   * Whether the insert landed on the editor's undo stack as one batch.
   *
   * Normally `true`. `false` means the parts ARE placed but Ctrl+Z will not remove
   * them, because the undo stack was unreachable. Reported rather than hidden: a
   * mod that cares can tell the player instead of leaving them to discover it.
   */
  readonly undoable: boolean;
}

export interface EditorFailure {
  readonly ok: false;
  readonly reason: EditorFailureReason;
  readonly detail?: string;
}

export type EditorInsertResult = EditorInsertSuccess | EditorFailure;

/**
 * Tier-1 editor registry. Reachable at `api.editor`, and always present as an
 * object — it is the individual calls that report unavailability, so a mod never
 * has to null-check the registry itself.
 *
 * ```ts
 * api.events.on('editor.opened', async () => {
 *   const r = await api.editor.insertParts([
 *     { x: 4, y: 0, z: 4, partId: 1, rotation: 0, rotationAxis: 0,
 *       color: 0, checkpointOrder: null, startOrder: null },
 *   ]);
 *   if (!r.ok) api.logger.warn('insert refused:', r.reason);
 * });
 * ```
 */
export interface EditorRegistry {
  /**
   * True once the editor chunk has been captured. Does NOT mean the editor is
   * open — see {@link isOpen}. False for the whole session if the player never
   * opens the editor, which is the common case.
   */
  readonly available: boolean;
  /**
   * Whether the editor is open right now.
   *
   * `null` means TSPML cannot tell: the chunk is not captured, or the game's own
   * flag was unreachable. **`null` is not `false`.** A mod that treats it as
   * "closed" will refuse work in a session that is in fact editable; a mod that
   * treats it as "open" will call into nothing. Handle it as unknown.
   */
  isOpen(): boolean | null;
  /**
   * Every part in the open editor session, in the game's own order.
   *
   * Returns an empty array when the editor is unavailable or closed, which is
   * indistinguishable from a genuinely empty track — check {@link isOpen} first
   * if the difference matters.
   */
  getParts(): readonly EditorPart[];
  /**
   * Place parts into the open editor session as ONE undo batch.
   *
   * All-or-nothing on validation: if any part is malformed the whole call is
   * refused with `invalid-part` and nothing is placed. Once placement starts, a
   * part the GAME rejects (bad color, below ground) stops the run, and everything
   * placed so far is rolled back through the game's own delete path so the track
   * is never left half-edited.
   */
  insertParts(parts: readonly EditorPart[]): Promise<EditorInsertResult>;
}

import type {
  EditorInsertResult,
  EditorPart,
  EditorRegistry,
  TspmlEventEmitter,
} from '@tspml/api';

/**
 * The game's Track, captured by the same bridge patch that feeds `api.tracks`.
 *
 * The editor does not own its parts: it mutates the SHARED Track instance the race
 * scene also uses, and every editor edit goes through these methods. So placing
 * parts is a Track call, and the only thing the editor chunk is needed for is the
 * undo stack and the open/closed flag.
 *
 * Structurally typed so a shape change from a game update fails at this boundary
 * rather than deep inside a mod.
 */
export interface GameTrack {
  setPart(
    x: number,
    y: number,
    z: number,
    partId: number,
    rotation: number,
    rotationAxis: number,
    color: number,
    checkpointOrder: number | null,
    startOrder: number,
  ): void;
  deleteSpecificPart(
    partId: number,
    x: number,
    y: number,
    z: number,
    rotation: number,
    rotationAxis: number,
  ): void;
  forEachPart(
    cb: (
      x: number,
      y: number,
      z: number,
      partId: number,
      rotation: number,
      rotationAxis: number,
      color: number,
      checkpointOrder: number | null,
      startOrder: number,
    ) => void,
  ): void;
  refreshMeshes(): void;
}

/**
 * The accessor object the chunk-112 capture patch hands over (see
 * `@tspml/shared`'s `EDITOR_PATCHES`).
 *
 * Every member takes the editor INSTANCE as its first argument. The capture runs at
 * the chunk's module scope, which is before any editor exists, so what it can offer
 * is closures over the module-scope bindings rather than bound state. The instance
 * arrives separately, from the game's own bootstrap.
 *
 * Every member may return a null-ish "cannot tell" — the injected code degrades to
 * null on any failure rather than guessing.
 */
export interface EditorAccessor {
  /** The live Track for an editor instance, or null when unreachable. */
  getTrack(editor: unknown): GameTrack | null;
  /** The game's own open flag. `null` = unreachable, which is NOT `false`. */
  isOpen(editor: unknown): boolean | null;
  /** Push one `{added, removed}` batch onto the editor's undo stack. */
  commitBatch(editor: unknown, batch: unknown): boolean;
  /** Undo-stack depth, or null when unreachable. Lets a smoke prove a batch landed. */
  undoDepth(editor: unknown): number | null;
}

/** The captured game internals this registry needs. */
export interface EditorHost {
  readonly accessor: EditorAccessor;
  /** The live editor instance, from the game's own bootstrap. */
  readonly instance: unknown;
}

export interface EditorOptions {
  /** Called when a game call throws (default: console.error). */
  readonly onError?: (error: unknown, phase: string) => void;
}

/** Every field a part must carry, and the check each one has to survive. */
function validatePart(p: unknown): string | null {
  if (typeof p !== 'object' || p === null) return 'part is not an object';
  const r = p as Record<string, unknown>;
  for (const k of ['x', 'y', 'z', 'partId', 'rotation', 'rotationAxis', 'color', 'startOrder']) {
    const v = r[k];
    // Non-finite is the one that matters: NaN sails through `typeof === 'number'`
    // and the game turns it into a part at an unreachable position that the
    // player can see but never select.
    if (typeof v !== 'number' || !Number.isFinite(v)) return `${k} must be a finite number`;
  }
  const co = r['checkpointOrder'];
  if (co !== null && (typeof co !== 'number' || !Number.isFinite(co))) {
    return 'checkpointOrder must be a finite number or null';
  }
  return null;
}

/**
 * Tier-1 track-editor registry (#87).
 *
 * Unbound until the editor chunk loads AND the game constructs an editor, which
 * for most sessions never happens. So this starts unbound and stays usable: every
 * call answers `not-available` rather than throwing, and `attach()` is what turns
 * it on. That is the opposite of the tracks registry, which QUEUES early calls —
 * queueing would be wrong here, because "place these parts" is meaningless once
 * the session it referred to is gone.
 *
 * The insert is undo-integrated: parts go in through the game's own `setPart`, the
 * game's own mesh refresh runs, and the whole run is committed to the editor's undo
 * stack as one batch, so a single Ctrl+Z removes it. A failed part rolls the run
 * back through the game's own delete path rather than leaving the track half-edited.
 */
export class Editor implements EditorRegistry {
  private host: EditorHost | null = null;
  private readonly onError: (error: unknown, phase: string) => void;

  constructor(host: EditorHost | null = null, options: EditorOptions = {}) {
    this.host = host;
    this.onError = options.onError ?? defaultOnError;
  }

  get available(): boolean {
    return this.host !== null;
  }

  /**
   * Bind the captured editor. Called by the host when both halves have arrived
   * (the accessor from the chunk patch, the instance from the bootstrap).
   *
   * RE-attachable, unlike the other registries: the player can close the editor
   * and open it again, and the second time the game constructs a NEW instance.
   * Keeping the first would leave every call pointed at a disposed editor.
   */
  attach(host: EditorHost): void {
    this.host = host;
  }

  /** Drop the captured editor (the session ended). Calls answer `not-available` again. */
  detach(): void {
    this.host = null;
  }

  /**
   * Loader teardown. Nothing here outlives the page — unlike the tracks registry
   * there is no persisted state to clean up, because this registry never writes
   * anywhere but the open session. Dropping the capture is the whole job, and it
   * matters: a mod holding `api.editor` past teardown must not still be able to
   * edit the player's track.
   */
  dispose(): void {
    this.detach();
  }

  isOpen(): boolean | null {
    const host = this.host;
    if (!host) return null;
    try {
      return host.accessor.isOpen(host.instance);
    } catch (err) {
      this.onError(err, 'isOpen');
      return null;
    }
  }

  getParts(): readonly EditorPart[] {
    const track = this.track();
    if (!track) return [];
    const out: EditorPart[] = [];
    try {
      track.forEachPart((x, y, z, partId, rotation, rotationAxis, color, checkpointOrder, startOrder) => {
        out.push({ x, y, z, partId, rotation, rotationAxis, color, checkpointOrder, startOrder });
      });
    } catch (err) {
      this.onError(err, 'forEachPart');
      // Partial reads are worse than none: a mod diffing against this would see
      // the missing tail as "free space" and build into occupied ground.
      return [];
    }
    return out;
  }

  async insertParts(parts: readonly EditorPart[]): Promise<EditorInsertResult> {
    const host = this.host;
    if (!host) return { ok: false, reason: 'not-available' };
    if (!Array.isArray(parts)) {
      return { ok: false, reason: 'invalid-part', detail: 'parts must be an array' };
    }
    // Validate EVERYTHING before touching the track. A malformed part found
    // halfway through would otherwise mean a rollback of work that never needed
    // to start.
    for (let i = 0; i < parts.length; i++) {
      const bad = validatePart(parts[i]);
      if (bad) return { ok: false, reason: 'invalid-part', detail: `parts[${i}]: ${bad}` };
    }

    const open = this.isOpen();
    // Only an explicit `false` refuses. `null` means the flag was unreachable, and
    // refusing on unknown would make the API useless on any build whose flag
    // drifted while placement itself still works.
    if (open === false) return { ok: false, reason: 'not-in-editor' };

    const track = this.track();
    if (!track) return { ok: false, reason: 'internal', detail: 'track unreachable' };
    if (parts.length === 0) return { ok: true, inserted: 0, undoable: true };

    const placed: EditorPart[] = [];
    for (const p of parts) {
      try {
        track.setPart(
          p.x, p.y, p.z, p.partId, p.rotation, p.rotationAxis, p.color, p.checkpointOrder, p.startOrder,
        );
      } catch (err) {
        // The game refused this part (unknown id, a color it does not offer,
        // below ground). Undo what we already placed, through the game's own
        // delete path, so the session is exactly as we found it.
        this.rollback(track, placed);
        return { ok: false, reason: 'rejected', detail: describe(err) };
      }
      placed.push(p);
    }

    try {
      track.refreshMeshes();
    } catch (err) {
      // The parts ARE in the track; only the visuals are stale. Rolling back
      // here would discard valid work over a redraw.
      this.onError(err, 'refreshMeshes');
    }

    // The batch shape the editor's own undo handler consumes: it deletes
    // everything in `added` and re-places everything in `removed`. An insert
    // removes nothing, so `removed` is empty.
    let undoable = false;
    try {
      undoable = host.accessor.commitBatch(host.instance, {
        added: placed.map(toBatchEntry),
        removed: [],
      });
    } catch (err) {
      this.onError(err, 'commitBatch');
    }

    return { ok: true, inserted: placed.length, undoable };
  }

  /** Undo-stack depth, or null when unreachable. Diagnostics and smokes. */
  undoDepth(): number | null {
    const host = this.host;
    if (!host) return null;
    try {
      return host.accessor.undoDepth(host.instance);
    } catch (err) {
      this.onError(err, 'undoDepth');
      return null;
    }
  }

  private track(): GameTrack | null {
    const host = this.host;
    if (!host) return null;
    try {
      return host.accessor.getTrack(host.instance);
    } catch (err) {
      this.onError(err, 'getTrack');
      return null;
    }
  }

  private rollback(track: GameTrack, placed: readonly EditorPart[]): void {
    // Reverse order, so a part whose placement depended on an earlier one is
    // removed first. Each delete is isolated: one failure must not abandon the
    // rest of the rollback and leave MORE debris than the original failure did.
    for (let i = placed.length - 1; i >= 0; i--) {
      const p = placed[i]!;
      try {
        track.deleteSpecificPart(p.partId, p.x, p.y, p.z, p.rotation, p.rotationAxis);
      } catch (err) {
        this.onError(err, 'rollback/deleteSpecificPart');
      }
    }
    try {
      track.refreshMeshes();
    } catch (err) {
      this.onError(err, 'rollback/refreshMeshes');
    }
  }
}

/**
 * A part in the shape the editor's undo handler expects.
 *
 * Its field names are the game's, not ours (`id`, not `partId`), read off the
 * handler in chunk 112. Getting one wrong makes Ctrl+Z silently skip the part.
 */
function toBatchEntry(p: EditorPart): Record<string, unknown> {
  return {
    id: p.partId,
    x: p.x,
    y: p.y,
    z: p.z,
    rotation: p.rotation,
    rotationAxis: p.rotationAxis,
    color: p.color,
    checkpointOrder: p.checkpointOrder,
    startOrder: p.startOrder,
  };
}

/**
 * Bridge the editor's open/closed transitions onto the event bus (#87).
 *
 * Edge-triggered against the last state we reported, so a poll or a repeated
 * `enable()` does not spam mods with duplicate events. `null` (unreachable) is not
 * a transition: it means we stopped being able to tell, and inventing a `closed`
 * for it would tell mods the session ended when it did not.
 */
export class EditorLifecycle {
  private last: boolean | null = null;

  constructor(
    private readonly bus: Pick<TspmlEventEmitter, 'emit'>,
    private readonly editor: Pick<EditorRegistry, 'isOpen'>,
  ) {}

  /** Sample the editor's state and emit on a change. Safe to call at any rate. */
  poll(): void {
    const now = this.editor.isOpen();
    if (now === null || now === this.last) return;
    this.last = now;
    this.bus.emit(now ? 'editor.opened' : 'editor.closed');
  }

  /** Forget the last reported state (the editor instance was replaced). */
  reset(): void {
    this.last = null;
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function defaultOnError(error: unknown, phase: string): void {
  // eslint-disable-next-line no-console
  console.error(`[TSPML] editor registry: ${phase} threw:`, error);
}

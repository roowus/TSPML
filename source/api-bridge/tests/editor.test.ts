/**
 * The track-editor registry (#87 Phase C).
 *
 * Two things make this registry different from the other three, and the tests are
 * organised around them:
 *
 *   it is UNBOUND for most of a session. The editor chunk loads on demand and most
 *     players never open the editor, so "no host" is the normal state, not an error
 *     state. Every call has to answer rather than throw.
 *   it MUTATES the player's track. A wrong answer here is not a missing feature, it
 *     is debris in someone's save. So the failure paths (validation, rollback, a
 *     game call throwing mid-run) get more attention than the happy path.
 *
 * The fake host mirrors the shapes read off the real chunk 112 and the real main
 * bundle: `setPart` takes nine positional arguments in a fixed order,
 * `deleteSpecificPart` takes six, and the undo batch entry names the part `id`.
 * Getting any of those wrong is silent in production, so they are asserted
 * positionally here rather than through a helper that could share the same mistake.
 */
import { describe, expect, it, vi } from 'vitest';
import { Editor, EditorLifecycle } from '../src/editor.js';
import type { EditorAccessor, GameTrack, GameTrackData } from '../src/editor.js';
import type { EditorPart } from '@tspml/api';

const PART: EditorPart = {
  x: 1,
  y: 2,
  z: 3,
  partId: 44,
  rotation: 0,
  rotationAxis: 1,
  color: 7,
  checkpointOrder: null,
  startOrder: null,
};

const part = (over: Partial<EditorPart> = {}): EditorPart => ({ ...PART, ...over });

interface FakeOptions {
  /** Throw from `setPart` on the Nth call (1-based). Models the game refusing a part. */
  readonly rejectAt?: number;
  readonly isOpen?: boolean | null;
  readonly trackNull?: boolean;
  readonly commitReturns?: boolean;
  readonly throwOn?: 'getTrack' | 'isOpen' | 'commitBatch' | 'getTrackData' | 'forEachPart' | 'refreshMeshes';
  /** Parts the fake track already contains, for getParts. */
  readonly existing?: readonly EditorPart[];
}

function fakeHost(options: FakeOptions = {}) {
  let calls = 0;
  const setPart = vi.fn((...args: unknown[]) => {
    calls += 1;
    if (options.rejectAt === calls) throw new Error(`part ${calls} refused`);
    void args;
  });
  const deleteSpecificPart = vi.fn();
  const refreshMeshes = vi.fn(() => {
    if (options.throwOn === 'refreshMeshes') throw new Error('redraw failed');
  });
  const forEachPart = vi.fn((cb: (...a: never[]) => void) => {
    if (options.throwOn === 'forEachPart') {
      // Emit one part BEFORE throwing: a partial read is the case that matters,
      // because a caller that trusted it would treat the missing tail as free space.
      const p = options.existing?.[0];
      if (p) {
        (cb as unknown as (...a: unknown[]) => void)(
          p.x, p.y, p.z, p.partId, p.rotation, p.rotationAxis, p.color, p.checkpointOrder, p.startOrder,
        );
      }
      throw new Error('iteration failed');
    }
    for (const p of options.existing ?? []) {
      (cb as unknown as (...a: unknown[]) => void)(
        p.x, p.y, p.z, p.partId, p.rotation, p.rotationAxis, p.color, p.checkpointOrder, p.startOrder,
      );
    }
  });

  // Shaped like the REAL game: `forEachPart` is a method of the track-data object
  // the Track builds on demand, NOT of the Track. A fake that flattened the two
  // into one object let `getParts` pass here while throwing "not a function"
  // against the live game, and the empty-array catch made that look like an empty
  // track. `getTrackData` throwing models the same failure the catch handles.
  const getTrackData = vi.fn(() => {
    if (options.throwOn === 'getTrackData') throw new Error('no track data');
    return { forEachPart: forEachPart as unknown as GameTrackData['forEachPart'] };
  });

  const track: GameTrack = {
    setPart: setPart as unknown as GameTrack['setPart'],
    deleteSpecificPart: deleteSpecificPart as unknown as GameTrack['deleteSpecificPart'],
    getTrackData: getTrackData as unknown as GameTrack['getTrackData'],
    refreshMeshes,
  };

  const commitBatch = vi.fn(() => {
    if (options.throwOn === 'commitBatch') throw new Error('undo push failed');
    return options.commitReturns ?? true;
  });

  const accessor: EditorAccessor = {
    getTrack: vi.fn(() => {
      if (options.throwOn === 'getTrack') throw new Error('track unreachable');
      return options.trackNull ? null : track;
    }),
    isOpen: vi.fn(() => {
      if (options.throwOn === 'isOpen') throw new Error('flag unreachable');
      return options.isOpen === undefined ? true : options.isOpen;
    }),
    commitBatch: commitBatch as unknown as EditorAccessor['commitBatch'],
    undoDepth: vi.fn(() => 3),
  };

  const instance = { marker: 'editor-instance' };
  return { accessor, instance, track, setPart, deleteSpecificPart, refreshMeshes, commitBatch };
}

/** An Editor with the errors captured instead of printed. */
function attached(options: FakeOptions = {}) {
  const host = fakeHost(options);
  const errors: Array<{ phase: string; error: unknown }> = [];
  const editor = new Editor(
    { accessor: host.accessor, instance: host.instance },
    { onError: (error, phase) => errors.push({ error, phase }) },
  );
  return { editor, errors, ...host };
}

describe('Editor — unattached, which is the normal state', () => {
  it('answers every call instead of throwing', async () => {
    const editor = new Editor();
    expect(editor.available).toBe(false);
    // `null`, not `false`. Saying `false` would claim the editor is closed, which an
    // unattached registry cannot know — and `insertParts` refuses on an explicit
    // `false`, so the lie would turn into a refusal nobody could explain.
    expect(editor.isOpen()).toBeNull();
    expect(editor.getParts()).toEqual([]);
    expect(editor.undoDepth()).toBeNull();
    await expect(editor.insertParts([PART])).resolves.toEqual({
      ok: false,
      reason: 'not-available',
    });
  });

  it('refuses BEFORE validating, so a bad part cannot mask the real reason', async () => {
    const editor = new Editor();
    const res = await editor.insertParts([part({ x: Number.NaN })]);
    // 'invalid-part' here would send a mod author to fix their input when the actual
    // problem is that the editor was never open.
    expect(res).toEqual({ ok: false, reason: 'not-available' });
  });
});

describe('Editor — attach / detach', () => {
  it('becomes available on attach and unavailable again on detach', async () => {
    const host = fakeHost();
    const editor = new Editor();
    editor.attach({ accessor: host.accessor, instance: host.instance });
    expect(editor.available).toBe(true);
    expect(editor.isOpen()).toBe(true);

    editor.detach();
    expect(editor.available).toBe(false);
    await expect(editor.insertParts([PART])).resolves.toEqual({
      ok: false,
      reason: 'not-available',
    });
  });

  it('RE-attaches to a new instance — a reopened editor is a different object', async () => {
    // The player closing and reopening the editor makes the game construct a fresh
    // editor. A one-shot attach (like the other registries use) would leave every
    // call pointed at the disposed one, which still answers and still has a track.
    const first = fakeHost();
    const second = fakeHost();
    const editor = new Editor({ accessor: first.accessor, instance: first.instance });
    editor.attach({ accessor: second.accessor, instance: second.instance });

    await editor.insertParts([PART]);
    expect(second.setPart).toHaveBeenCalledTimes(1);
    expect(first.setPart).not.toHaveBeenCalled();
  });

  it('dispose drops the capture — a stale api.editor must not still edit the track', async () => {
    const host = fakeHost();
    const editor = new Editor({ accessor: host.accessor, instance: host.instance });
    editor.dispose();
    await editor.insertParts([PART]);
    expect(host.setPart).not.toHaveBeenCalled();
  });

  it('passes the captured INSTANCE to every accessor call', () => {
    // The accessor is a set of closures over the chunk's module scope, captured
    // before any editor existed, so the instance has to be threaded through by hand.
    // Dropping it would leave the accessor operating on `undefined`.
    const { editor, accessor, instance } = attached();
    editor.isOpen();
    editor.undoDepth();
    expect(accessor.isOpen).toHaveBeenCalledWith(instance);
    expect(accessor.undoDepth).toHaveBeenCalledWith(instance);
  });
});

describe('Editor.insertParts — validation, before anything is touched', () => {
  it.each([
    ['a non-finite number', part({ x: Number.NaN }), 'x must be a finite number'],
    ['Infinity', part({ z: Number.POSITIVE_INFINITY }), 'z must be a finite number'],
    ['a string where a number belongs', { ...PART, partId: '44' }, 'partId must be a finite number'],
    ['a missing field', (() => { const p = { ...PART } as Record<string, unknown>; delete p['color']; return p; })(), 'color must be a finite number'],
    ['a non-object', 7, 'part is not an object'],
    ['null', null, 'part is not an object'],
    ['a non-number checkpointOrder', { ...PART, checkpointOrder: 'first' }, 'checkpointOrder must be a finite number or null'],
    // Both order fields are nullable and both still have to be a NUMBER when set.
    // `undefined` is the one that matters: a mod that spreads a part it built by
    // hand and forgets the field gets undefined, not null, and the game would
    // throw on it deep inside setPart rather than here.
    ['an undefined startOrder', { ...PART, startOrder: undefined }, 'startOrder must be a finite number or null'],
    ['a non-finite startOrder', { ...PART, startOrder: Number.NaN }, 'startOrder must be a finite number or null'],
  ])('rejects %s without calling the game', async (_label, bad, detail) => {
    const { editor, setPart } = attached();
    const res = await editor.insertParts([bad as unknown as EditorPart]);
    expect(res).toEqual({ ok: false, reason: 'invalid-part', detail: `parts[0]: ${detail}` });
    expect(setPart).not.toHaveBeenCalled();
  });

  it('accepts a null checkpointOrder — that is the value for a non-checkpoint part', async () => {
    const { editor } = attached();
    await expect(editor.insertParts([part({ checkpointOrder: null })])).resolves.toMatchObject({ ok: true });
  });

  it('validates the WHOLE array before placing anything', async () => {
    // Finding the bad part halfway through would mean rolling back work that never
    // needed to start, and a rollback is itself a sequence of game calls that can fail.
    const { editor, setPart } = attached();
    const res = await editor.insertParts([PART, PART, part({ color: Number.NaN })]);
    expect(res).toEqual({ ok: false, reason: 'invalid-part', detail: 'parts[2]: color must be a finite number' });
    expect(setPart).not.toHaveBeenCalled();
  });

  it('refuses a non-array without treating it as empty', async () => {
    const { editor } = attached();
    const res = await editor.insertParts(undefined as unknown as readonly EditorPart[]);
    // `ok: true, inserted: 0` would be the dangerous answer: a mod would report
    // success to its user for an insert that never happened.
    expect(res).toEqual({ ok: false, reason: 'invalid-part', detail: 'parts must be an array' });
  });

  it('treats an empty array as a real no-op success', async () => {
    const { editor, setPart, commitBatch } = attached();
    await expect(editor.insertParts([])).resolves.toEqual({ ok: true, inserted: 0, undoable: true });
    expect(setPart).not.toHaveBeenCalled();
    // Nothing was added, so an undo entry would make one Ctrl+Z do nothing at all.
    expect(commitBatch).not.toHaveBeenCalled();
  });
});

describe('Editor.insertParts — the open flag', () => {
  it('refuses when the game says the editor is CLOSED', async () => {
    const { editor, setPart } = attached({ isOpen: false });
    await expect(editor.insertParts([PART])).resolves.toEqual({ ok: false, reason: 'not-in-editor' });
    expect(setPart).not.toHaveBeenCalled();
  });

  it('PROCEEDS when the flag is unreachable — null is not false', async () => {
    // The flag is a downlevelled `#private` read. If a game update renames the
    // WeakMap binding, refusing on `null` would take the whole API offline over a
    // diagnostic signal, while placement itself still works perfectly.
    const { editor, setPart } = attached({ isOpen: null });
    await expect(editor.insertParts([PART])).resolves.toMatchObject({ ok: true, inserted: 1 });
    expect(setPart).toHaveBeenCalledTimes(1);
  });

  it('proceeds when the flag THROWS, and records the error', async () => {
    const { editor, errors, setPart } = attached({ throwOn: 'isOpen' });
    await expect(editor.insertParts([PART])).resolves.toMatchObject({ ok: true });
    expect(setPart).toHaveBeenCalledTimes(1);
    expect(errors.map((e) => e.phase)).toContain('isOpen');
  });
});

describe('Editor.insertParts — placing parts', () => {
  it('calls setPart with the game’s nine arguments in the game’s order', async () => {
    // Positional, unnamed, and unvalidated by the game: swapping `rotation` and
    // `rotationAxis` places a part that looks almost right and is impossible to
    // debug from the outside.
    const { editor, setPart } = attached();
    await editor.insertParts([part({ x: 5, y: 6, z: 7, partId: 12, rotation: 2, rotationAxis: 1, color: 3, checkpointOrder: 4, startOrder: 9 })]);
    expect(setPart).toHaveBeenCalledWith(5, 6, 7, 12, 2, 1, 3, 4, 9);
  });

  it('passes a null startOrder THROUGH — the ordinary-part case', async () => {
    // The game reads both order fields against the part's own catalog entry and
    // throws "Non-start part has start order" if one is present on a part that
    // takes none. Most parts are neither a start pad nor a checkpoint, so the
    // common call carries null in both — and a registry that coerced either to 0
    // would make the ordinary case the one that cannot be placed. Verified
    // against the live game, where startOrder: 0 was refused.
    const { editor, setPart } = attached();
    const res = await editor.insertParts([part({ checkpointOrder: null, startOrder: null })]);
    expect(res).toMatchObject({ ok: true, inserted: 1 });
    expect(setPart.mock.calls[0]?.slice(7)).toEqual([null, null]);
  });

  it('places every part, in order, and reports the count', async () => {
    const { editor, setPart } = attached();
    const res = await editor.insertParts([part({ x: 0 }), part({ x: 1 }), part({ x: 2 })]);
    expect(res).toEqual({ ok: true, inserted: 3, undoable: true });
    expect(setPart.mock.calls.map((c) => c[0])).toEqual([0, 1, 2]);
  });

  it('refreshes the meshes once, after the run rather than per part', async () => {
    const { editor, refreshMeshes } = attached();
    await editor.insertParts([PART, PART, PART]);
    expect(refreshMeshes).toHaveBeenCalledTimes(1);
  });

  it('keeps the parts when only the REDRAW fails', async () => {
    // The parts are in the track; the visuals are stale. Rolling back here would
    // discard valid work over a repaint the next frame may well fix.
    const { editor, errors, deleteSpecificPart } = attached({ throwOn: 'refreshMeshes' });
    const res = await editor.insertParts([PART]);
    expect(res).toMatchObject({ ok: true, inserted: 1 });
    expect(deleteSpecificPart).not.toHaveBeenCalled();
    expect(errors.map((e) => e.phase)).toContain('refreshMeshes');
  });

  it('reports internal when the track itself is unreachable', async () => {
    const { editor } = attached({ trackNull: true });
    await expect(editor.insertParts([PART])).resolves.toEqual({
      ok: false,
      reason: 'internal',
      detail: 'track unreachable',
    });
  });
});

describe('Editor.insertParts — rollback when the game refuses a part', () => {
  it('removes everything already placed, in REVERSE order', async () => {
    // Reverse, so a part whose placement depended on an earlier one goes first.
    const { editor, deleteSpecificPart } = attached({ rejectAt: 3 });
    const res = await editor.insertParts([part({ x: 0 }), part({ x: 1 }), part({ x: 2 })]);
    expect(res).toMatchObject({ ok: false, reason: 'rejected' });
    expect((res as { detail: string }).detail).toContain('part 3 refused');
    expect(deleteSpecificPart).toHaveBeenCalledTimes(2);
    expect(deleteSpecificPart.mock.calls.map((c) => c[1])).toEqual([1, 0]);
  });

  it('deletes with the game’s six-argument signature, not the nine-argument one', async () => {
    const { editor, deleteSpecificPart } = attached({ rejectAt: 2 });
    await editor.insertParts([part({ x: 5, y: 6, z: 7, partId: 12, rotation: 2, rotationAxis: 1 }), PART]);
    // id first here, unlike setPart — the two signatures genuinely disagree.
    expect(deleteSpecificPart).toHaveBeenCalledWith(12, 5, 6, 7, 2, 1);
  });

  it('leaves NOTHING behind when the very first part is refused', async () => {
    const { editor, deleteSpecificPart, commitBatch } = attached({ rejectAt: 1 });
    const res = await editor.insertParts([PART, PART]);
    expect(res).toMatchObject({ ok: false, reason: 'rejected' });
    expect(deleteSpecificPart).not.toHaveBeenCalled();
    // A failed run must not push an undo entry: Ctrl+Z would then undo the player's
    // previous edit while looking like it undid ours.
    expect(commitBatch).not.toHaveBeenCalled();
  });

  it('finishes the rollback even when one delete throws', async () => {
    // Abandoning here would leave MORE debris than the original failure did.
    const host = fakeHost({ rejectAt: 4 });
    const errors: string[] = [];
    host.deleteSpecificPart.mockImplementationOnce(() => {
      throw new Error('delete refused');
    });
    const editor = new Editor(
      { accessor: host.accessor, instance: host.instance },
      { onError: (_e, phase) => errors.push(phase) },
    );
    const res = await editor.insertParts([part({ x: 0 }), part({ x: 1 }), part({ x: 2 }), PART]);
    expect(res).toMatchObject({ ok: false, reason: 'rejected' });
    expect(host.deleteSpecificPart).toHaveBeenCalledTimes(3);
    expect(errors).toContain('rollback/deleteSpecificPart');
  });

  it('refreshes the meshes after a rollback too', async () => {
    // Otherwise the removed parts stay on screen and the track LOOKS edited.
    const { editor, refreshMeshes } = attached({ rejectAt: 2 });
    await editor.insertParts([PART, PART]);
    expect(refreshMeshes).toHaveBeenCalledTimes(1);
  });
});

describe('Editor.insertParts — the undo batch', () => {
  it('commits one batch for the whole run, so a single Ctrl+Z removes it', async () => {
    const { editor, commitBatch } = attached();
    await editor.insertParts([PART, PART, PART]);
    expect(commitBatch).toHaveBeenCalledTimes(1);
  });

  it('names the fields the way the game’s undo handler reads them', async () => {
    // `id`, not `partId`. The handler reads these off the entry by name, and a
    // mismatch makes Ctrl+Z silently skip the part while reporting success.
    const { editor, commitBatch, instance } = attached();
    await editor.insertParts([part({ x: 5, y: 6, z: 7, partId: 12, rotation: 2, rotationAxis: 1, color: 3, checkpointOrder: 4, startOrder: 9 })]);
    expect(commitBatch).toHaveBeenCalledWith(instance, {
      added: [{ id: 12, x: 5, y: 6, z: 7, rotation: 2, rotationAxis: 1, color: 3, checkpointOrder: 4, startOrder: 9 }],
      // An insert removes nothing. A non-empty `removed` would make the undo
      // handler re-place parts that were never deleted.
      removed: [],
    });
  });

  it('reports undoable:false when the game refuses the batch, but still ok', async () => {
    // The parts ARE placed. Claiming failure would invite the mod to place them again.
    const { editor } = attached({ commitReturns: false });
    await expect(editor.insertParts([PART])).resolves.toEqual({ ok: true, inserted: 1, undoable: false });
  });

  it('survives the batch commit THROWING', async () => {
    const { editor, errors } = attached({ throwOn: 'commitBatch' });
    await expect(editor.insertParts([PART])).resolves.toEqual({ ok: true, inserted: 1, undoable: false });
    expect(errors.map((e) => e.phase)).toContain('commitBatch');
  });
});

describe('Editor.getParts', () => {
  it('reads the track through the game’s own iterator', () => {
    const existing = [part({ x: 1 }), part({ x: 2, checkpointOrder: 3 })];
    const { editor } = attached({ existing });
    expect(editor.getParts()).toEqual(existing);
  });

  it('returns NOTHING rather than a partial read when iteration throws', () => {
    // A mod diffing against a truncated read would see the missing tail as free
    // space and build straight into occupied ground.
    const { editor, errors } = attached({ existing: [part({ x: 1 })], throwOn: 'forEachPart' });
    expect(editor.getParts()).toEqual([]);
    expect(errors.map((e) => e.phase)).toContain('forEachPart');
  });

  it('returns nothing when the track is unreachable', () => {
    expect(attached({ trackNull: true }).editor.getParts()).toEqual([]);
    const viaThrow = attached({ throwOn: 'getTrack' });
    expect(viaThrow.editor.getParts()).toEqual([]);
    expect(viaThrow.errors.map((e) => e.phase)).toContain('getTrack');
  });

  it('goes through getTrackData() — the iterator is not the Track’s', () => {
    // The bug this pins: `forEachPart` was called straight on the Track, which
    // throws "not a function" against the real game. The catch turned that into
    // `[]`, so a live editor full of parts read as an empty track and nothing
    // anywhere reported a problem.
    const { editor, track } = attached({ existing: [part({ x: 1 })] });
    expect(editor.getParts()).toHaveLength(1);
    expect(track.getTrackData).toHaveBeenCalledTimes(1);
    expect((track as unknown as Record<string, unknown>)['forEachPart']).toBeUndefined();
  });

  it('returns nothing when the track data itself is unreachable', () => {
    const { editor, errors } = attached({ existing: [part({ x: 1 })], throwOn: 'getTrackData' });
    expect(editor.getParts()).toEqual([]);
    expect(errors.map((e) => e.phase)).toContain('forEachPart');
  });
});

describe('EditorLifecycle', () => {
  const busFor = () => {
    const events: string[] = [];
    return { events, bus: { emit: (name: string) => events.push(name) } as never };
  };

  it('emits on a transition and stays quiet on a repeat', () => {
    const { events, bus } = busFor();
    let open: boolean | null = true;
    const cycle = new EditorLifecycle(bus, { isOpen: () => open });

    cycle.poll();
    cycle.poll();
    cycle.poll();
    expect(events).toEqual(['editor.opened']);

    open = false;
    cycle.poll();
    cycle.poll();
    expect(events).toEqual(['editor.opened', 'editor.closed']);
  });

  it('treats null as "cannot tell", never as a close', () => {
    // Inventing a `closed` here would tell every mod the session ended while the
    // player is still editing — and the next real poll would then emit a second
    // `opened` for a session that never stopped.
    const { events, bus } = busFor();
    let open: boolean | null = true;
    const cycle = new EditorLifecycle(bus, { isOpen: () => open });
    cycle.poll();
    open = null;
    cycle.poll();
    cycle.poll();
    expect(events).toEqual(['editor.opened']);

    open = true;
    cycle.poll();
    expect(events).toEqual(['editor.opened']);
  });

  it('re-emits after reset, because the instance was replaced', () => {
    // Reopening the editor builds a NEW editor. Without the reset the tracker still
    // holds `true` from the old one and the reopen emits nothing at all.
    const { events, bus } = busFor();
    const cycle = new EditorLifecycle(bus, { isOpen: () => true });
    cycle.poll();
    cycle.poll();
    expect(events).toEqual(['editor.opened']);

    cycle.reset();
    cycle.poll();
    expect(events).toEqual(['editor.opened', 'editor.opened']);
  });

  it('emits nothing at all while the editor has never been reachable', () => {
    const { events, bus } = busFor();
    const cycle = new EditorLifecycle(bus, { isOpen: () => null });
    cycle.poll();
    cycle.poll();
    expect(events).toEqual([]);
  });
});

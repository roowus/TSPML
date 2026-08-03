import { describe, expect, it, vi } from 'vitest';
import { Tracks } from '../src/tracks.js';
import type { TrackHost, TrackMetadataLike } from '../src/tracks.js';

// A minimal stand-in for the game's track store + codec. Mirrors the REAL shapes
// verified against PolyTrack 0.6.2 in the dev harness (see issue #12): the store
// keys on track NAME, `saveCustomTrack` returns a boolean, and the codec's
// `fromExportString` returns null for an unparseable code.
function mockHost(options: { saveReturns?: boolean; parses?: boolean } = {}) {
  const saved = new Map<string, TrackMetadataLike>();
  const codeName = (code: string) => code.replace(/^PolyTrack2/, '') || 'Unnamed';
  const host: TrackHost & { saved: Map<string, TrackMetadataLike> } = {
    saved,
    manager: {
      saveCustomTrack: vi.fn((metadata: unknown, _data: unknown) => {
        if (options.saveReturns === false) return false;
        const m = metadata as TrackMetadataLike;
        saved.set(m.name, m);
        return true;
      }),
      deleteCustomTrack: vi.fn((name: string) => saved.delete(name)),
      checkCustomTrackNameExists: vi.fn((name: string) => saved.has(name)),
      forEachCustomTrack: vi.fn(),
    },
    codec: {
      fromExportString: vi.fn((code: string) =>
        options.parses === false
          ? null
          : {
              trackMetadata: { name: codeName(code), author: 'codec-author', lastModified: null },
              trackData: { getId: () => `id-${codeName(code)}` },
            },
      ),
    },
  };
  return host;
}

const CODE = 'PolyTrack2Alpha';

describe('Tracks registry', () => {
  it('registers a track through the game store and reports its id', async () => {
    const host = mockHost();
    const tracks = new Tracks(host);

    const res = await tracks.register({ code: CODE });

    expect(res).toEqual({ ok: true, name: 'Alpha', trackId: 'id-Alpha' });
    expect(host.saved.has('Alpha')).toBe(true);
    expect(tracks.list()).toEqual([
      { name: 'Alpha', trackId: 'id-Alpha', author: 'codec-author', persist: false },
    ]);
  });

  it('lets the mod override the name and author the code carries', async () => {
    const host = mockHost();
    const tracks = new Tracks(host);

    const res = await tracks.register({ code: CODE, name: 'My Track', author: 'roowus' });

    expect(res).toEqual({ ok: true, name: 'My Track', trackId: 'id-Alpha' });
    expect(host.saved.get('My Track')?.author).toBe('roowus');
  });

  it('rejects an unparseable code without touching the store', async () => {
    const host = mockHost({ parses: false });
    const tracks = new Tracks(host);

    const res = await tracks.register({ code: 'not-a-track-code' });

    expect(res).toEqual({ ok: false, reason: 'invalid-code' });
    expect(host.manager.saveCustomTrack).not.toHaveBeenCalled();
  });

  it("refuses a name collision rather than clobbering the player's track", async () => {
    const host = mockHost();
    const tracks = new Tracks(host);
    await tracks.register({ code: CODE });
    (host.manager.saveCustomTrack as ReturnType<typeof vi.fn>).mockClear();

    const res = await tracks.register({ code: CODE });

    expect(res).toEqual({ ok: false, reason: 'name-exists', detail: 'Alpha' });
    expect(host.manager.saveCustomTrack).not.toHaveBeenCalled();
  });

  it('overwrites only when explicitly asked', async () => {
    const host = mockHost();
    const tracks = new Tracks(host);
    await tracks.register({ code: CODE });

    const res = await tracks.register({ code: CODE, author: 'second', overwrite: true });

    expect(res.ok).toBe(true);
    expect(host.saved.get('Alpha')?.author).toBe('second');
  });

  it('reports save-failed when the game store refuses', async () => {
    const tracks = new Tracks(mockHost({ saveReturns: false }));

    expect(await tracks.register({ code: CODE })).toEqual({ ok: false, reason: 'save-failed' });
  });

  it('queues registrations made before the game store exists, then drains on attach', async () => {
    const tracks = new Tracks();
    expect(tracks.ready).toBe(false);

    const pending = tracks.register({ code: CODE });
    expect(tracks.pendingCount).toBe(1);
    // A queued registration is still visible to the mod that made it.
    expect(tracks.list()).toHaveLength(1);

    const host = mockHost();
    tracks.attach(host);

    expect(await pending).toEqual({ ok: true, name: 'Alpha', trackId: 'id-Alpha' });
    expect(tracks.ready).toBe(true);
    expect(tracks.pendingCount).toBe(0);
    expect(host.saved.has('Alpha')).toBe(true);
  });

  it('ignores a second attach (the capture patch may fire more than once)', async () => {
    const first = mockHost();
    const second = mockHost();
    const tracks = new Tracks();
    tracks.attach(first);
    tracks.attach(second);

    await tracks.register({ code: CODE });

    expect(first.saved.has('Alpha')).toBe(true);
    expect(second.saved.has('Alpha')).toBe(false);
  });

  it('unregisters through the game store and forgets the entry', async () => {
    const host = mockHost();
    const tracks = new Tracks(host);
    await tracks.register({ code: CODE });

    expect(tracks.unregister('Alpha')).toBe(true);
    expect(host.manager.deleteCustomTrack).toHaveBeenCalledWith('Alpha');
    expect(tracks.list()).toEqual([]);
    // Unknown names are a no-op, not an error.
    expect(tracks.unregister('Alpha')).toBe(false);
  });

  it('dispose removes session tracks but leaves persisted ones alone', async () => {
    const host = mockHost();
    const tracks = new Tracks(host);
    await tracks.register({ code: 'PolyTrack2Session' });
    await tracks.register({ code: 'PolyTrack2Kept', persist: true });

    tracks.dispose();

    expect(host.saved.has('Session')).toBe(false);
    expect(host.saved.has('Kept')).toBe(true);
    expect(tracks.list().map((t) => t.name)).toEqual(['Kept']);
  });

  it('isolates a throwing game call as a typed failure', async () => {
    const host = mockHost();
    host.manager.saveCustomTrack = vi.fn(() => {
      throw new Error('quota exceeded');
    });
    const onError = vi.fn();
    const tracks = new Tracks(host, { onError });

    const res = await tracks.register({ code: CODE });

    expect(res).toEqual({ ok: false, reason: 'save-failed', detail: 'quota exceeded' });
    expect(onError).toHaveBeenCalledOnce();
  });
});

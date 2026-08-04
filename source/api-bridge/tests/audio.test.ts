import { describe, expect, it, vi } from 'vitest';
import { Audio } from '../src/audio.js';
import type { AudioHost, GameAudioManager } from '../src/audio.js';

// A minimal stand-in for the game's audio manager. Mirrors the REAL shapes read
// out of PolyTrack 0.6.2 (issue #11): `context` is a PUBLIC field the game sets to
// null when AudioContext construction throws, and `getBuffer(key)` is a PROTOTYPE
// method returning the decoded clip or null.
//
// Critically, `getBuffer` is on the prototype in the real bundle — so the registry's
// own-property shadow must be deletable to restore it. The mock reproduces that
// (class method, not an instance arrow) or `dispose()` would appear to work here
// while failing against the game.
function mockHost(options: { noContext?: boolean; decodeThrows?: boolean } = {}) {
  const builtins = new Map<string, AudioBuffer>();
  const buf = (duration: number) => ({ duration }) as AudioBuffer;
  builtins.set('click', buf(0.1));

  class MockManager implements GameAudioManager {
    context: AudioContext | null;
    constructor() {
      this.context = options.noContext
        ? null
        : ({
            decodeAudioData: vi.fn((_bytes: ArrayBuffer) =>
              options.decodeThrows
                ? Promise.reject(new Error('Unable to decode audio data'))
                : Promise.resolve(buf(1.5)),
            ),
          } as unknown as AudioContext);
    }
    getBuffer(key: string): AudioBuffer | null {
      return builtins.get(key) ?? null;
    }
  }

  const manager = new MockManager();
  const host: AudioHost & { builtins: Map<string, AudioBuffer>; manager: GameAudioManager } = {
    manager,
    builtins,
  };
  return host;
}

function okFetch(bytes = new ArrayBuffer(8)): typeof fetch {
  return vi.fn(() =>
    Promise.resolve({ ok: true, status: 200, statusText: 'OK', arrayBuffer: () => Promise.resolve(bytes) }),
  ) as unknown as typeof fetch;
}

const URL_OK = 'blob:mod-clip';

describe('Audio registry', () => {
  it('decodes through the game context and serves the clip from getBuffer', async () => {
    const host = mockHost();
    const audio = new Audio(host, { fetchImpl: okFetch() });

    const res = await audio.register({ key: 'engine', url: URL_OK });

    expect(res).toEqual({ ok: true, key: 'engine', duration: 1.5, replacedBuiltin: true });
    // The GAME's own lookup must now answer with the mod's clip — that is the
    // whole mechanism, and it is what makes the override audible.
    expect(host.manager.getBuffer('engine')?.duration).toBe(1.5);
    expect(audio.list()).toEqual([{ key: 'engine', duration: 1.5, replacedBuiltin: true }]);
  });

  it('overrides a builtin the game already loaded, and restores it on unregister', async () => {
    const host = mockHost();
    const audio = new Audio(host, { fetchImpl: okFetch() });
    expect(host.manager.getBuffer('click')?.duration).toBe(0.1);

    await audio.register({ key: 'click', url: URL_OK });
    expect(host.manager.getBuffer('click')?.duration).toBe(1.5);

    expect(audio.unregister('click')).toBe(true);
    // Restored to the game's ORIGINAL clip, not to null.
    expect(host.manager.getBuffer('click')?.duration).toBe(0.1);
  });

  it('marks an unknown key as additive rather than a builtin replacement', async () => {
    const host = mockHost();
    const audio = new Audio(host, { fetchImpl: okFetch() });

    const res = await audio.register({ key: 'my-mod-horn', url: URL_OK });

    expect(res).toEqual({ ok: true, key: 'my-mod-horn', duration: 1.5, replacedBuiltin: false });
    expect(host.manager.getBuffer('my-mod-horn')?.duration).toBe(1.5);
    // ...and an unrelated key still falls through to the game.
    expect(host.manager.getBuffer('nope')).toBeNull();
  });

  it('never calls the game load(): it would throw after boot completes', async () => {
    // This is the load-bearing reason the registry shadows getBuffer. The game's
    // load() starts with addResource(), which throws once the loading screen has
    // completed — i.e. always, by the time a mod can reach the registry.
    const host = mockHost();
    const load = vi.fn(() => {
      throw new Error('Cannot add resources after loading is complete');
    });
    (host.manager as unknown as { load: unknown }).load = load;
    const audio = new Audio(host, { fetchImpl: okFetch() });

    const res = await audio.register({ key: 'engine', url: URL_OK });

    expect(res.ok).toBe(true);
    expect(load).not.toHaveBeenCalled();
  });

  it('queues registrations made before the game is captured, then applies them', async () => {
    const audio = new Audio(null, { fetchImpl: okFetch() });
    expect(audio.ready).toBe(false);

    const pendingRes = audio.register({ key: 'engine', url: URL_OK });
    expect(audio.pendingCount).toBe(1);
    // A queued entry is visible to the mod, with duration unknown so far.
    expect(audio.list()).toEqual([{ key: 'engine', duration: 0, replacedBuiltin: true }]);

    const host = mockHost();
    audio.attach(host);

    expect(await pendingRes).toEqual({
      ok: true,
      key: 'engine',
      duration: 1.5,
      replacedBuiltin: true,
    });
    expect(audio.pendingCount).toBe(0);
    expect(host.manager.getBuffer('engine')?.duration).toBe(1.5);
  });

  it('reports a typed failure when the fetch fails, without throwing', async () => {
    const host = mockHost();
    const fetchImpl = vi.fn(() =>
      Promise.resolve({ ok: false, status: 404, statusText: 'Not Found' }),
    ) as unknown as typeof fetch;
    const audio = new Audio(host, { fetchImpl });

    const res = await audio.register({ key: 'engine', url: 'https://example.invalid/x.ogg' });

    expect(res).toEqual({ ok: false, reason: 'fetch-failed', detail: '404 Not Found' });
    expect(host.manager.getBuffer('engine')).toBeNull();
  });

  it('reports a typed failure when the fetch rejects', async () => {
    const host = mockHost();
    const onError = vi.fn();
    const fetchImpl = vi.fn(() => Promise.reject(new Error('network down'))) as unknown as typeof fetch;
    const audio = new Audio(host, { fetchImpl, onError });

    const res = await audio.register({ key: 'engine', url: URL_OK });

    expect(res).toEqual({ ok: false, reason: 'fetch-failed', detail: 'network down' });
    expect(onError).toHaveBeenCalled();
  });

  it('reports a typed failure when the bytes are not decodable audio', async () => {
    const host = mockHost({ decodeThrows: true });
    const audio = new Audio(host, { fetchImpl: okFetch() });

    const res = await audio.register({ key: 'engine', url: URL_OK });

    expect(res).toEqual({
      ok: false,
      reason: 'decode-failed',
      detail: 'Unable to decode audio data',
    });
    expect(host.manager.getBuffer('engine')).toBeNull();
  });

  it('reports no-audio-context when the game has no AudioContext', async () => {
    // The game catches its own AudioContext failure and runs silent; an override
    // has nothing to play through, and we must not pretend it worked.
    const host = mockHost({ noContext: true });
    const fetchImpl = okFetch();
    const audio = new Audio(host, { fetchImpl });

    const res = await audio.register({ key: 'engine', url: URL_OK });

    expect(res).toEqual({ ok: false, reason: 'no-audio-context' });
    // Bailed before spending a fetch on a clip that could never play.
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses a mod-vs-mod key collision unless overwrite is set', async () => {
    const host = mockHost();
    const audio = new Audio(host, { fetchImpl: okFetch() });
    await audio.register({ key: 'engine', url: URL_OK });

    const clash = await audio.register({ key: 'engine', url: 'blob:other' });
    expect(clash).toEqual({ ok: false, reason: 'key-exists', detail: 'engine' });

    const forced = await audio.register({ key: 'engine', url: 'blob:other', overwrite: true });
    expect(forced.ok).toBe(true);
    expect(audio.list()).toHaveLength(1);
  });

  it('unregister reports false for a key it does not own', () => {
    const audio = new Audio(mockHost(), { fetchImpl: okFetch() });
    // The game's own 'click' is NOT ours to remove.
    expect(audio.unregister('click')).toBe(false);
  });

  it('dispose drops every clip and fully restores the game lookup', async () => {
    const host = mockHost();
    const audio = new Audio(host, { fetchImpl: okFetch() });
    await audio.register({ key: 'click', url: URL_OK });
    await audio.register({ key: 'my-mod-horn', url: URL_OK });
    expect(host.manager.getBuffer('click')?.duration).toBe(1.5);

    audio.dispose();

    expect(audio.list()).toEqual([]);
    // The shadow is gone — the prototype method answers again, not a leftover
    // closure. `getBuffer` must be an own-property no longer.
    expect(Object.prototype.hasOwnProperty.call(host.manager, 'getBuffer')).toBe(false);
    expect(host.manager.getBuffer('click')?.duration).toBe(0.1);
    expect(host.manager.getBuffer('my-mod-horn')).toBeNull();
  });

  it('attach is idempotent and does not double-wrap the game lookup', async () => {
    const host = mockHost();
    const audio = new Audio(host, { fetchImpl: okFetch() });
    audio.attach(host);
    audio.attach(host);

    await audio.register({ key: 'click', url: URL_OK });
    expect(host.manager.getBuffer('click')?.duration).toBe(1.5);

    // One shadow only => one delete restores the original.
    audio.dispose();
    expect(host.manager.getBuffer('click')?.duration).toBe(0.1);
  });

  it('surfaces a frozen manager instead of failing silently later', () => {
    const host = mockHost();
    Object.freeze(host.manager);
    const onError = vi.fn();

    new Audio(host, { fetchImpl: okFetch(), onError });

    expect(onError).toHaveBeenCalledWith(expect.anything(), 'installShadow');
  });
});

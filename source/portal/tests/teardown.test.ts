// Unit tests for lib/teardown.ts — the portal's unload path (#17).
//
// The loader's own teardown was already tested; what was untested was the HOST calling
// it, which is where #17 actually lived. These are pure: fakes for the bus, the unload
// closure, and the registries, so they run in the portal's `node` vitest environment.
import { describe, expect, it, vi } from 'vitest';
import { teardown } from '../lib/teardown.js';

/** A registry that records its disposal into a shared trace. */
const registry = (name: string, trace: string[], throws = false) => ({
  dispose: () => {
    trace.push(name);
    if (throws) throw new Error(`${name} exploded`);
  },
});

describe('teardown', () => {
  it('emits loader.onUnload BEFORE unloading mods and disposing the bridge', async () => {
    // The ordering is the contract, not an implementation detail. A mod's
    // `loader.onUnload` handler is its last chance to release something, and it can only
    // use the bridge if the bridge is still alive. Emitting after disposal would hand
    // every listener a dead registry and silently drop whatever they did in response —
    // which looks identical to "no mod cared" from the outside.
    const trace: string[] = [];
    await teardown({
      bus: { emit: () => trace.push('emit') },
      unloadMods: async () => {
        trace.push('unloadMods');
      },
      registries: [registry('keybinds', trace), registry('tracks', trace)],
    });
    expect(trace).toEqual(['emit', 'unloadMods', 'keybinds', 'tracks']);
  });

  it('unloads mods before disposing registries', async () => {
    // A mod's `onUnload` routinely calls back into the bridge (`keybinds.unregister`,
    // `tracks.remove`). Disposing first would turn every one of those calls into a throw
    // during cleanup — the failure mode cleanup exists to prevent.
    const trace: string[] = [];
    await teardown({
      bus: { emit: () => {} },
      unloadMods: async () => {
        trace.push('mods');
      },
      registries: [registry('bridge', trace)],
    });
    expect(trace).toEqual(['mods', 'bridge']);
  });

  it('still disposes every registry when a mod throws on the way out', async () => {
    // Isolation, not politeness: this runs while the page is leaving, so an escaping
    // exception abandons every step after it. One leaky mod would then leak the whole
    // bridge — window listeners included.
    const trace: string[] = [];
    const logError = vi.fn();
    await expect(
      teardown({
        bus: { emit: () => {} },
        unloadMods: async () => {
          throw new Error('leaky mod');
        },
        registries: [registry('keybinds', trace), registry('tracks', trace)],
        logError,
      }),
    ).resolves.toBeUndefined();
    expect(trace).toEqual(['keybinds', 'tracks']);
    // Reported, never swallowed — it is the mod author's bug and they need to see it.
    expect(logError).toHaveBeenCalledWith(expect.stringContaining('leaky mod'));
  });

  it('disposes the remaining registries when one of them throws', async () => {
    // Same rule one level down. A registry that throws must not strand the ones after
    // it, or a single bad dispose leaks every listener the others hold.
    const trace: string[] = [];
    const logError = vi.fn();
    await teardown({
      bus: { emit: () => {} },
      registries: [registry('bad', trace, true), registry('good', trace)],
      logError,
    });
    expect(trace).toEqual(['bad', 'good']);
    expect(logError).toHaveBeenCalledWith(expect.stringContaining('bad exploded'));
  });

  it('proceeds when a loader.onUnload listener throws', async () => {
    // One mod's bad handler must not cost every other mod its cleanup.
    const trace: string[] = [];
    const logError = vi.fn();
    await teardown({
      bus: {
        emit: () => {
          throw new Error('bad listener');
        },
      },
      unloadMods: async () => {
        trace.push('mods');
      },
      registries: [registry('bridge', trace)],
      logError,
    });
    expect(trace).toEqual(['mods', 'bridge']);
    expect(logError).toHaveBeenCalledWith(expect.stringContaining('bad listener'));
  });

  it('tears the bridge down even when the page unloads mid-load', async () => {
    // Not defensive padding: React StrictMode runs effect cleanup immediately after
    // mount in development, so `unloadMods` is genuinely absent on a routine path. If
    // that skipped the registries, every dev-mode remount would leak a keydown listener.
    const trace: string[] = [];
    await teardown({
      bus: { emit: () => trace.push('emit') },
      unloadMods: undefined,
      registries: [registry('keybinds', trace)],
    });
    expect(trace).toEqual(['emit', 'keybinds']);
  });

  it('skips registries that were never constructed', async () => {
    // `keybindsRef` is null until the iframe loads, so the page can tear down with a
    // hole in the list. A crash here would be a crash on every early navigation.
    const trace: string[] = [];
    await teardown({
      bus: { emit: () => {} },
      registries: [null, registry('tracks', trace), undefined],
    });
    expect(trace).toEqual(['tracks']);
  });
});

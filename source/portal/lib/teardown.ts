/**
 * @tspml/portal — the unload path (#17).
 *
 * The loader has built a complete teardown chain for a while: `load()` returns an
 * idempotent `unload()`, every bridge registry has `dispose()`, and all of it is unit
 * tested. What was missing was a *caller*. A capability nothing invokes is not a
 * feature, and "mods can clean up" was the claim TSPML makes against PML's missing
 * cleanup — so leaving the trigger unwired left that claim resting on nothing.
 *
 * This lives in `lib/` rather than inline in `page.tsx` for a plain reason: the portal's
 * vitest environment is `node`, so anything inside the component is unreachable by a
 * test. Teardown is exactly the code path that must not be "verified" by eyeballing it —
 * it runs while the page is going away, where a thrown error is invisible.
 */
/** The subset of a bridge registry this module needs: something disposable. */
export interface Disposable {
  dispose(): void;
}

/**
 * Just enough of the event bus to announce unload.
 *
 * Structural rather than `TspmlEventEmitter` from `@tspml/api`: the portal does not
 * depend on that package (only on `@tspml/api-bridge`, which re-exports the concrete
 * `EventBus`), and adding a dependency to import one type would be the wrong trade.
 * `EventBus` satisfies this shape.
 */
export interface UnloadEmitter {
  emit(event: 'loader.onUnload'): void;
}

export interface TeardownParts {
  /**
   * Unload every loaded mod (the closure `loadMods` returns). Optional because the
   * page can tear down before the mods have finished loading — see `teardown`.
   */
  readonly unloadMods?: (() => Promise<void>) | undefined;
  /** Bridge registries to dispose, in the order given. */
  readonly registries: readonly (Disposable | null | undefined)[];
  /**
   * The bus to announce `loader.onUnload` on. The loader itself cannot emit — a
   * `ModApi`'s `events` is `on`/`off` only — so the host owns this signal.
   */
  readonly bus: UnloadEmitter;
  /** Where to report a failure. Injected so a test can assert on it. */
  readonly logError?: (message: string) => void;
}

/**
 * Tear the page down: announce, unload mods, then dispose the bridge.
 *
 * **Ordering is the whole design.** `loader.onUnload` is emitted FIRST, while the bus
 * and registries are still live, because a mod's handler is the last chance it has to
 * release something — emitting after disposal would hand every listener a dead bridge
 * and silently drop the work they do in response. Mods unload before registries for the
 * same reason: a mod's `onUnload` may well call `keybinds.unregister`, and pulling the
 * registry first turns that into a throw during cleanup.
 *
 * **Nothing here may throw.** This runs from `pagehide`/effect-cleanup, where the page
 * is already leaving; an exception would abandon every step after it and take the rest
 * of the teardown with it. So each stage is isolated — a leaky mod is reported, not
 * fatal — which is the same fail-small rule the loader applies internally.
 */
export async function teardown(parts: TeardownParts): Promise<void> {
  const { unloadMods, registries, bus, logError = console.error } = parts;

  // Emitted before anything is torn down, and isolated: a mod handler that throws is
  // that mod's bug, and must not cost every other mod its cleanup.
  try {
    bus.emit('loader.onUnload');
  } catch (err) {
    logError(`[tspml] a loader.onUnload listener threw: ${describe(err)}`);
  }

  // `unloadMods` is undefined when the page tears down mid-load. That is a real race
  // (mount → immediate navigate away), not a defensive nicety: React StrictMode runs
  // effect cleanup right after mount in development, so this path executes routinely.
  if (unloadMods) {
    try {
      await unloadMods();
    } catch (err) {
      logError(`[tspml] mod unload failed: ${describe(err)}`);
    }
  }

  // Disposed last, and each one independently — a registry that throws on the way out
  // must not strand the ones after it, or a single bad dispose leaks every listener
  // the others hold.
  for (const registry of registries) {
    if (!registry) continue;
    try {
      registry.dispose();
    } catch (err) {
      logError(`[tspml] registry dispose failed: ${describe(err)}`);
    }
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

import type { TspmlApi } from '@tspml/api';

/**
 * Example HUD mod — the proof that TSPML loads REAL mod packages.
 *
 * `@tspml/loader` discovers this mod (its `mod.json`), parses + validates the
 * manifest, resolves/orders, then invokes this entrypoint's default export with
 * the bridge `api` (events + keybinds). A real HUD would draw an overlay; this
 * demo subscribes to a Tier-1 event and registers a keybind through the registry.
 *
 * Factory form: `export default (api, game) => {}`.
 */

/** Debug counters hung off the api object so the headless smoke can verify the
 *  mod's handlers actually fired (read via `window.__tspml.__demoHud`). */
interface DemoCounters {
  control: number;
  key: number;
  loaded: boolean;
  /** Set by the returned disposer, so the smoke can prove cleanup ran (#17). */
  unloaded?: boolean;
}
/** Extends the published API with smoke-test counters hung off the runtime object. */
interface DemoApi extends TspmlApi {
  __demoHud?: DemoCounters;
}

export default function exampleHud(api: DemoApi, _game: unknown): (() => void) {
  const counters: DemoCounters = { control: 0, key: 0, loaded: true };
  api.__demoHud = counters;

  // Subscribe to a Tier-1 event (a real mod updates a HUD here).
  // `on` returns an unsubscribe; this mod used to throw it away, which is
  // exactly the leak #17 is about — keep it and hand it back below.
  const offControl = api.events.on('car.control', () => {
    counters.control++;
  });

  // Register a keybind through the Tier-1 registry (also returns a disposer).
  const unregister = api.keybinds.register({
    id: 'demo-hud.toggle',
    key: 'KeyG',
    description: 'Example HUD: toggle',
    onDown: () => {
      counters.key++;
    },
  });

  api.logger.log('[demo-hud] loaded — subscribed to car.control, bound KeyG');

  // Factory-form cleanup: return a disposer and the loader calls it on unload.
  return () => {
    offControl();
    unregister();
    counters.unloaded = true;
    api.logger.log('[demo-hud] unloaded — detached car.control, released KeyG');
  };
}

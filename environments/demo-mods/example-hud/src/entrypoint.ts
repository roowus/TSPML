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
}
/** Extends the published API with smoke-test counters hung off the runtime object. */
interface DemoApi extends TspmlApi {
  __demoHud?: DemoCounters;
}

export default function exampleHud(api: DemoApi, _game: unknown): void {
  const counters: DemoCounters = { control: 0, key: 0, loaded: true };
  api.__demoHud = counters;

  // Subscribe to a Tier-1 event (a real mod updates a HUD here).
  api.events.on('car.control', () => {
    counters.control++;
  });

  // Register a keybind through the Tier-1 registry.
  api.keybinds.register({
    id: 'demo-hud.toggle',
    key: 'KeyG',
    description: 'Example HUD: toggle',
    onDown: () => {
      counters.key++;
    },
  });

  api.logger.log('[demo-hud] loaded — subscribed to car.control, bound KeyG');
}

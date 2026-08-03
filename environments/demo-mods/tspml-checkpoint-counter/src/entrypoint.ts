import type { TspmlApi } from '@tspml/api';

/** Debug counters for headless verification (on the api object). */
interface Counters { checkpoints: number; keyPresses: number; loaded: boolean }
interface Api extends TspmlApi { __checkpointCounter?: Counters }

/**
 * Checkpoint Counter — the second demo mod, proving MULTI-MOD loading.
 * Subscribes to checkpoint.passed (different from demo-hud's car.control) +
 * registers a KeyJ keybind (different from demo-hud's KeyG).
 */
export default function checkpointCounter(api: Api): void {
  const counters: Counters = { checkpoints: 0, keyPresses: 0, loaded: true };
  api.__checkpointCounter = counters;

  api.events.on('checkpoint.passed', () => {
    counters.checkpoints++;
  });

  api.keybinds.register({
    id: 'checkpoint-counter.report',
    key: 'KeyJ',
    description: 'Checkpoint Counter: report',
    onDown: () => {
      counters.keyPresses++;
    },
  });

  // (Loaded — the loader's status report confirms this.)
}

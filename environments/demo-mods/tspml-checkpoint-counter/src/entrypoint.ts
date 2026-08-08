import type { TspmlApi } from '@tspml/api';

/** Debug counters for headless verification (on the api object). */
interface Counters {
  /** Checkpoints the PLAYER passed — what a lap timer actually wants. */
  checkpoints: number;
  /** Checkpoints a ghost/replay car passed. Counted separately, never mixed in. */
  ghostCheckpoints: number;
  keyPresses: number;
  loaded: boolean;
}
interface Api extends TspmlApi { __checkpointCounter?: Counters }

/**
 * Checkpoint Counter — the second demo mod, proving MULTI-MOD loading.
 * Subscribes to checkpoint.passed (different from demo-hud's car.control) +
 * registers a KeyJ keybind (different from demo-hud's KeyG).
 */
export default function checkpointCounter(api: Api): void {
  const counters: Counters = {
    checkpoints: 0,
    ghostCheckpoints: 0,
    keyPresses: 0,
    loaded: true,
  };
  api.__checkpointCounter = counters;

  // checkpoint.passed is PER-CAR (#10): a track with a ghost emits for the ghost
  // too. Counting both into one total is the bug the payload's `isReplay` exists to
  // prevent — so this demo does what a real lap-timer must, and splits them.
  // `isReplay === true` (not truthy) because `null` means "TSPML could not tell",
  // which is neither the player nor a ghost and must not be silently claimed.
  api.events.on('checkpoint.passed', ({ isReplay }) => {
    if (isReplay === true) counters.ghostCheckpoints++;
    else counters.checkpoints++;
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

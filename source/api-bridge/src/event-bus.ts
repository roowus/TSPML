import type {
  TspmlEventEmitter,
  TspmlEventMap,
  TspmlListener,
} from '@tspml/api';

/** Internal listener type (erases the generic tuple for storage). */
type AnyListener = (...args: readonly unknown[]) => void;

export interface EventBusOptions {
  /**
   * Called when a listener throws during `emit` (default: `console.error`).
   * The error is swallowed after this so the game tick is never broken by a mod
   * bug.
   */
  readonly onError?: (error: unknown, event: string) => void;
}

/**
 * Loader-owned Tier-1 event bus — the runtime behind every mod's `api.events`.
 *
 * Implements `@tspml/api`'s `TspmlEventEmitter` with **per-listener error
 * isolation**: a listener that throws is caught, reported via `onError`, and
 * skipped — it never prevents sibling listeners or the game from proceeding.
 * This is a direct fix for PML, where one bad hook can crash the whole game.
 *
 * `on`/`once` return an unsubscribe function so mods can clean up without
 * keeping references for `off` (addresses PML's missing-cleanup bug). Listeners
 * are snapshotted at the start of an `emit`, so subscribing/unsubscribing
 * mid-emit is safe and predictable (new listeners don't fire this round;
 * removed ones still do).
 */
export class EventBus implements TspmlEventEmitter {
  private readonly listeners = new Map<keyof TspmlEventMap, Set<AnyListener>>();
  private readonly onError: (error: unknown, event: string) => void;

  constructor(options: EventBusOptions = {}) {
    this.onError = options.onError ?? defaultOnError;
  }

  on<K extends keyof TspmlEventMap>(
    event: K,
    listener: TspmlListener<K>,
  ): () => void {
    this.ensure(event).add(listener as AnyListener);
    return () => this.off(event, listener);
  }

  once<K extends keyof TspmlEventMap>(
    event: K,
    listener: TspmlListener<K>,
  ): () => void {
    const wrapper: TspmlListener<K> = (...args) => {
      this.off(event, wrapper);
      listener(...args);
    };
    return this.on(event, wrapper);
  }

  off<K extends keyof TspmlEventMap>(
    event: K,
    listener: TspmlListener<K>,
  ): void {
    this.listeners.get(event)?.delete(listener as AnyListener);
  }

  emit<K extends keyof TspmlEventMap>(
    event: K,
    ...args: TspmlEventMap[K]
  ): void {
    const set = this.listeners.get(event);
    if (!set || set.size === 0) return;
    // Snapshot: a listener may subscribe/unsubscribe during emit.
    for (const listener of [...set]) {
      try {
        listener(...args);
      } catch (error) {
        this.onError(error, event as string);
      }
    }
  }

  listenerCount<K extends keyof TspmlEventMap>(event: K): number {
    return this.listeners.get(event)?.size ?? 0;
  }

  removeAllListeners<K extends keyof TspmlEventMap>(event?: K): void {
    if (event === undefined) {
      this.listeners.clear();
    } else {
      this.listeners.delete(event);
    }
  }

  private ensure(event: keyof TspmlEventMap): Set<AnyListener> {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    return set;
  }
}

function defaultOnError(error: unknown, event: string): void {
  // A mod listener threw — log and move on. The game must not break.
  // eslint-disable-next-line no-console
  console.error(`[TSPML] listener for "${event}" threw:`, error);
}

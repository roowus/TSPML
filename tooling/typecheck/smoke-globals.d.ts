/**
 * Ambient globals the headless smokes touch inside `page.evaluate()`.
 *
 * Those callbacks are serialized and run in the GAME frame's realm, where the host
 * page installs `window.__tspml` at runtime. There is no static type to import —
 * the value does not exist in the Node process doing the typechecking.
 *
 * Everything here is deliberately `any`. The alternative — mirroring the bridge's
 * real shape — would make every smoke a compile-time consumer of the bridge's
 * internals, so a refactor of `__tspml` would break the typecheck of five scripts
 * that do not care. The point of checking the smokes is to catch *their* typos
 * (`waitForTimeut`, a misspelled destructure, a `const` reassignment), not to
 * re-litigate the bridge's API surface. `api.audio` / `api.tracks` already have
 * real types in `@tspml/api`, and the api-bridge unit tests hold them.
 *
 * The `__tspmlDev` / `__tspmlCounts` / `__demoHud*` entries are smoke-owned
 * scratch state, not product surface.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    /** The bridge the host page installs into the game frame. */
    __tspml?: any;
    /** Dev-harness-only escape hatch (never shipped by the portal). */
    __tspmlDev?: any;
    /** Smoke scratch: per-event counters set up by the smoke's own subscriber. */
    __tspmlCounts?: Record<string, number>;
    /**
     * Smoke scratch: captured per-car payloads (`{carId, isReplay}`) for the race
     * events, so the smoke can assert WHICH car fired, not just how often (#10).
     */
    __tspmlPayloads?: Record<
      string,
      Array<{ carId: number | null; isReplay: boolean | null }>
    >;
    /** Smoke scratch: keybind-registry fire count. */
    __tspmlKb?: number;
    /** Smoke scratch: how many times the pasted user mod's entrypoint ran. */
    __smokeUserModRuns?: number;
    /** Smoke scratch: set by the pasted user mod's disposer on unload. */
    __smokeUserModDisposed?: boolean;
    /** Set in the GAME frame by the pasted user mod's mixin inject (#62). */
    __smokeUserMixin?: boolean;
    /** Set by @tspml/demo-hud's declared mixin — proves a mod mixin applied. */
    __demoHudMixin?: unknown;
  }
}

export {};

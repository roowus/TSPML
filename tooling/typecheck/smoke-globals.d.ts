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
 * The `__tspmlDev` / `__tspmlCounts` / `__smoke*` entries are smoke-owned
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
    /** Set in the GAME frame by smoke.mjs's SEEDED user mod's mixin inject. */
    __smokeSeededMixin?: boolean;
    /**
     * Smoke scratch: how many times smoke-instances.mjs's mod ran. Counted
     * rather than flagged because the per-instance overlay legs assert it
     * stayed UNDEFINED for the instance that skips the mod — a boolean could
     * not tell "never ran" from "ran and set false".
     */
    __smokeOverlayRuns?: number;
    /**
     * Smoke scratch: the PML lifecycle phases the fixture PML mod
     * (`/sample-pml-mod`) has run, in order. An array (not a flag) because
     * smoke-pml asserts the ORDER — preInit, init, postInit, onGameLoad — and
     * a "they all ran" flag could not catch two hooks firing swapped.
     */
    __smokePmlPhases?: string[];
    /** Smoke scratch: the fixture PML mod's `id/name/version` string from `init`. */
    __smokePmlIdentity?: string;
    /** Smoke scratch: fire count of the fixture PML mod's `KeyJ` keybind. */
    __smokePmlKey?: number;
    /**
     * Smoke scratch: the fixture PML mod's setting read back from
     * `pml.getSetting`. Deliberately `string | boolean` — PML's `getSetting`
     * wart is that a bool set through its settings API reads back as the STRING
     * `"true"`, and the leg exists to pin exactly that, so a `boolean`-only type
     * would assume away the behaviour under test.
     */
    __smokePmlSetting?: string | boolean;
    /**
     * Smoke scratch: set only if the fixture PML mod's code ran PAST its refused
     * mixin calls — a refusal must return, not throw.
     */
    __smokePmlSurvivedMixin?: boolean;
    /**
     * Smoke scratch: incremented IN THE GAME FRAME by the fixture PML mod's
     * collected splice, which the transform seam inserts into the served
     * bundle. Presence means the spliced code EXECUTED at bundle eval — the
     * difference between "the plan accepted the patch" and "the patch ran".
     */
    __pmlSpliceRan?: number;
    /** The user-mixin plan report the route prepends to the served bundle. */
    __tspmlUserMixins?: any;
  }
}

export {};

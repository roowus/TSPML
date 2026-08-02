import { describe, expect, it, vi } from "vitest";
import { trackModApi } from "../src/tracking-api";
import type { ModLikeApi } from "../src/tracking-api";

/** Build a mock api whose on/once/register return spy unsubscribers. */
function mockApi() {
  const onOff = vi.fn();
  const onceOff = vi.fn();
  const regOff = vi.fn();
  const api: ModLikeApi = {
    events: { on: vi.fn(() => onOff), once: vi.fn(() => onceOff) },
    keybinds: { register: vi.fn(() => regOff) },
  };
  return { api, onOff, onceOff, regOff };
}

describe("trackModApi — subscription recording", () => {
  it("delegates on/once/register to the underlying api", () => {
    const { api } = mockApi();
    const tracked = trackModApi(api);
    const fn = vi.fn();
    tracked.events.on("car.control", fn);
    tracked.events.once("race.started", fn);
    tracked.keybinds.register({ id: "kb1" });

    expect(api.events.on).toHaveBeenCalledWith("car.control", fn);
    expect(api.events.once).toHaveBeenCalledWith("race.started", fn);
    expect(api.keybinds.register).toHaveBeenCalledWith({ id: "kb1" });
  });

  it("disposeAll tears down every subscription the mod made", () => {
    const { api, onOff, onceOff, regOff } = mockApi();
    const tracked = trackModApi(api);
    tracked.events.on("car.control", vi.fn());
    tracked.events.once("race.started", vi.fn());
    tracked.keybinds.register({ id: "kb1" });

    expect(onOff).not.toHaveBeenCalled();
    tracked.disposeAll();
    expect(onOff).toHaveBeenCalledTimes(1);
    expect(onceOff).toHaveBeenCalledTimes(1);
    expect(regOff).toHaveBeenCalledTimes(1);
  });

  it("disposeAll is idempotent (safe to call twice, e.g. on reload)", () => {
    const { api, onOff } = mockApi();
    const tracked = trackModApi(api);
    tracked.events.on("car.control", vi.fn());
    tracked.disposeAll();
    tracked.disposeAll(); // no double-dispose
    expect(onOff).toHaveBeenCalledTimes(1);
  });

  it("a throwing unsubscriber does not skip the rest", () => {
    const ok = vi.fn();
    const api: ModLikeApi = {
      // first subscription's unsubscribe throws
      events: { on: vi.fn(() => () => { throw new Error("boom"); }), once: vi.fn(() => () => {}) },
      keybinds: { register: vi.fn(() => ok) },
    };
    const tracked = trackModApi(api);
    tracked.events.on("car.control", vi.fn());
    tracked.keybinds.register({ id: "k" });
    expect(() => tracked.disposeAll()).not.toThrow();
    expect(ok).toHaveBeenCalledTimes(1); // the keybind teardown still ran despite the throw
  });

  it("the per-subscription unsubscribe also removes it from the tracked set", () => {
    const { api, onOff } = mockApi();
    const tracked = trackModApi(api);
    const manualOff = tracked.events.on("car.control", vi.fn());
    manualOff(); // mod cleans up its own sub
    expect(onOff).toHaveBeenCalledTimes(1);
    tracked.disposeAll(); // nothing left to dispose
    expect(onOff).toHaveBeenCalledTimes(1); // not called again
  });
});

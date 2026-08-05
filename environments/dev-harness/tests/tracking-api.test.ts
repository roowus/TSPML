import { describe, expect, it, vi } from "vitest";
import { trackModApi } from "../src/tracking-api";
import type { ModLikeApi } from "../src/tracking-api";
import type { AudioRegisterResult, AudioRegistration } from "@tspml/api";

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
    tracked.keybinds.register({ id: "kb1", key: "KeyH" });

    expect(api.events.on).toHaveBeenCalledWith("car.control", fn);
    expect(api.events.once).toHaveBeenCalledWith("race.started", fn);
    expect(api.keybinds.register).toHaveBeenCalledWith({ id: "kb1", key: "KeyH" });
  });

  it("disposeAll tears down every subscription the mod made", () => {
    const { api, onOff, onceOff, regOff } = mockApi();
    const tracked = trackModApi(api);
    tracked.events.on("car.control", vi.fn());
    tracked.events.once("race.started", vi.fn());
    tracked.keybinds.register({ id: "kb1", key: "KeyH" });

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
    tracked.keybinds.register({ id: "k", key: "KeyK" });
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

/**
 * Audio clips (#11) need the same HMR discipline as tracks, and for a louder
 * reason: an override the old mod installed stays in the GAME's buffer lookup, so
 * a hot-swap that forgot to unregister would leave the previous mod's sounds
 * playing with no mod owning them.
 */
describe("trackModApi — audio registrations", () => {
  function mockAudioApi() {
    const unregister = vi.fn((_key: string): boolean => true);
    const register = vi.fn(
      (a: AudioRegistration): Promise<AudioRegisterResult> =>
        Promise.resolve({ ok: true, key: a.key, duration: 1, replacedBuiltin: false }),
    );
    const { api } = mockApi();
    return { api: { ...api, audio: { register, unregister } }, register, unregister };
  }

  it("delegates register and echoes the result through", async () => {
    const { api, register } = mockAudioApi();
    const tracked = trackModApi(api);

    const res = await tracked.audio?.register({ key: "engine", url: "blob:x" });

    expect(register).toHaveBeenCalledWith({ key: "engine", url: "blob:x" });
    expect(res).toEqual({ ok: true, key: "engine", duration: 1, replacedBuiltin: false });
  });

  it("disposeAll unregisters every clip the mod registered", async () => {
    const { api, unregister } = mockAudioApi();
    const tracked = trackModApi(api);
    await tracked.audio?.register({ key: "engine", url: "blob:a" });
    await tracked.audio?.register({ key: "click", url: "blob:b" });

    expect(unregister).not.toHaveBeenCalled();
    tracked.disposeAll();
    expect(unregister).toHaveBeenCalledTimes(2);
    expect(unregister).toHaveBeenCalledWith("engine");
    expect(unregister).toHaveBeenCalledWith("click");
  });

  it("does not record a clip that failed to register", async () => {
    const { api, unregister } = mockAudioApi();
    api.audio.register = vi.fn(
      (): Promise<AudioRegisterResult> => Promise.resolve({ ok: false, reason: "decode-failed" }),
    );
    const tracked = trackModApi(api);

    await tracked.audio?.register({ key: "engine", url: "blob:bad" });
    tracked.disposeAll();

    expect(unregister).not.toHaveBeenCalled();
  });

  it("a mod's own unregister removes it from the disposal set", async () => {
    const { api, unregister } = mockAudioApi();
    const tracked = trackModApi(api);
    await tracked.audio?.register({ key: "engine", url: "blob:a" });

    tracked.audio?.unregister("engine");
    expect(unregister).toHaveBeenCalledTimes(1);
    tracked.disposeAll();
    expect(unregister).toHaveBeenCalledTimes(1); // not disposed twice
  });

  it("a throwing unregister does not skip the remaining clips", async () => {
    const { api } = mockAudioApi();
    const seen: string[] = [];
    api.audio.unregister = vi.fn((key: string) => {
      seen.push(key);
      if (key === "engine") throw new Error("boom");
      return true;
    });
    const tracked = trackModApi(api);
    await tracked.audio?.register({ key: "engine", url: "blob:a" });
    await tracked.audio?.register({ key: "click", url: "blob:b" });

    expect(() => tracked.disposeAll()).not.toThrow();
    expect(seen).toEqual(["engine", "click"]);
  });

  it("falls back to the not-ready stub when the harness has no registry", async () => {
    // `TspmlApi` requires `audio`, so the surface is always present (#18). Before
    // the registries attach it answers `'not-ready'` — the same thing a mod gets
    // calling too early against a real bridge, rather than an undefined it would
    // have to guard on only in the harness.
    const { api } = mockApi();
    const audio = trackModApi(api).audio;
    await expect(audio.register({ key: "engine", url: "blob:x" })).resolves.toEqual({
      ok: false,
      reason: "not-ready",
    });
    expect(audio.list()).toEqual([]);
  });
});

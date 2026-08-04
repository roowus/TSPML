/**
 * The early-capture stub is a STRING injected into the game's HTML, so nothing but a
 * test like this ever type-checks it. It is also the piece whose absence produces the
 * confusing half-failure (#12): the manager arrives, the codec does not, the registry
 * never attaches. Executing it here against a fake window pins the contract.
 */
import { describe, expect, it } from "vitest";
import {
  EARLY_CAPTURE_KEY,
  EARLY_CAPTURE_SCRIPT_TAG,
  EARLY_CAPTURE_STUB,
  readEarlyCaptures,
  type EarlyCaptures,
} from "../src/early-capture.js";

type FakeWindow = Record<string, unknown> & {
  __tspml?: {
    captureTrackManager?: (m: unknown) => void;
    captureTrackCodec?: (c: unknown) => void;
  };
};

/** Run the stub with `window` bound to a fresh fake. */
function runStub(preexisting?: FakeWindow["__tspml"]): FakeWindow {
  const win: FakeWindow = {};
  if (preexisting) win.__tspml = preexisting;
  new Function("window", EARLY_CAPTURE_STUB)(win);
  return win;
}

describe("EARLY_CAPTURE_STUB", () => {
  it("installs the recorder and both capture callbacks", () => {
    const win = runStub();
    expect(win[EARLY_CAPTURE_KEY]).toEqual({ manager: null, codec: null });
    expect(typeof win.__tspml?.captureTrackManager).toBe("function");
    expect(typeof win.__tspml?.captureTrackCodec).toBe("function");
  });

  it("records what the capture patches hand it", () => {
    const win = runStub();
    const manager = { forEachCustomTrack: () => {} };
    const codec = { fromExportString: () => {} };
    win.__tspml?.captureTrackManager?.(manager);
    win.__tspml?.captureTrackCodec?.(codec);
    expect(win[EARLY_CAPTURE_KEY]).toEqual({ manager, codec });
  });

  /**
   * The whole reason the stub exists: the codec's module factory runs during BUNDLE
   * INIT, before the host's `load` handler. So the stub must be able to record a
   * codec that arrives with no manager in sight, and the host must read it back.
   */
  it("survives the codec arriving alone, pre-bridge", () => {
    const win = runStub();
    const codec = { fromExportString: () => {} };
    win.__tspml?.captureTrackCodec?.(codec);
    const early = readEarlyCaptures(win);
    expect(early.codec).toBe(codec);
    expect(early.manager).toBeNull();
  });

  /** A surface that somehow installed the real bridge first must keep it. */
  it("does not clobber a real bridge already present", () => {
    const realManager = (m: unknown) => void m;
    const win = runStub({ captureTrackManager: realManager });
    expect(win.__tspml?.captureTrackManager).toBe(realManager);
    // ...but still fills in the half that was missing.
    expect(typeof win.__tspml?.captureTrackCodec).toBe("function");
  });

  it("is wrapped in a script tag ready to splice into HTML", () => {
    expect(EARLY_CAPTURE_SCRIPT_TAG).toBe(`<script>${EARLY_CAPTURE_STUB}</script>`);
    // A literal `</script>` in the payload would terminate the tag early.
    expect(EARLY_CAPTURE_STUB).not.toContain("</script");
  });
});

describe("readEarlyCaptures", () => {
  it("returns nulls when the stub never ran", () => {
    expect(readEarlyCaptures({})).toEqual({ manager: null, codec: null });
  });

  // The host calls this on `frame.contentWindow`, which is null until the frame loads.
  it("tolerates a null or undefined window", () => {
    expect(readEarlyCaptures(null)).toEqual({ manager: null, codec: null });
    expect(readEarlyCaptures(undefined)).toEqual({ manager: null, codec: null });
  });

  it("normalizes a partially-filled record to nulls", () => {
    const win = { [EARLY_CAPTURE_KEY]: { manager: undefined, codec: undefined } };
    expect(readEarlyCaptures(win)).toEqual({ manager: null, codec: null });
  });

  it("carries the caller's game types through", () => {
    interface Mgr {
      forEachCustomTrack(): void;
    }
    const manager: Mgr = { forEachCustomTrack: () => {} };
    const win = { [EARLY_CAPTURE_KEY]: { manager, codec: null } };
    const early: EarlyCaptures<Mgr, never> = readEarlyCaptures<Mgr, never>(win);
    expect(early.manager?.forEachCustomTrack).toBeTypeOf("function");
  });
});

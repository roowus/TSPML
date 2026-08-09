/**
 * Guards on the shared inject payloads.
 *
 * These are the checks that could not exist while the patches were duplicated: a
 * broken inject used to surface only when a surface ran the transform against the
 * real (gitignored, machine-local) bundle in a browser. Now that there is one copy,
 * CI can hold it to its contracts.
 *
 * What is NOT tested here: that the anchors resolve against the real PolyTrack
 * bundle. That is the transform package's job (synthetic fixtures) and the
 * surfaces' headless smokes (real bundle). See docs/design/mappings-system.md.
 */
import { describe, expect, it } from "vitest";
import type { Patch } from "@tspml/transform";
import {
  BRIDGE_PATCHES,
  REGISTRY_CAPTURE_PATCHES,
  TIER1_BRIDGE_PATCHES,
} from "../src/bridge-patches.js";

/** Every JS source string a patch carries, labelled for readable failures. */
function injectSources(patch: Patch): { label: string; source: string; expression: boolean }[] {
  const out: { label: string; source: string; expression: boolean }[] = [];
  const where = `${patch.op}/${describeSelector(patch)}`;
  if ("inject" in patch && typeof patch.inject === "string") {
    out.push({ label: `${where} inject`, source: patch.inject, expression: false });
  }
  if ("wrap" in patch && typeof patch.wrap === "string") {
    // A wrap is an EXPRESSION (the engine emits `return (wrap)(X)`), not statements.
    out.push({ label: `${where} wrap`, source: patch.wrap, expression: true });
  }
  return out;
}

function describeSelector(patch: Patch): string {
  const s = patch.target.selector;
  return s.kind === "method" ? `method:${s.name}` : s.kind === "property" ? `prop:${s.key}` : s.kind;
}

describe("BRIDGE_PATCHES composition", () => {
  it("is Tier-1 followed by the registry captures, with nothing dropped", () => {
    expect(BRIDGE_PATCHES).toEqual([...TIER1_BRIDGE_PATCHES, ...REGISTRY_CAPTURE_PATCHES]);
  });

  it("ships the badge + the seven Tier-1 emits", () => {
    // One patch carries checkpoint.passed, checkpoint.respawn AND race.finished
    // (it diffs carState in a single setCarState inject), so 7 events come from
    // 5 emitting patches.
    expect(TIER1_BRIDGE_PATCHES).toHaveLength(6);
    const all = TIER1_BRIDGE_PATCHES.flatMap((p) => injectSources(p).map((s) => s.source)).join(
      "\n",
    );
    for (const event of [
      "car.control",
      "car.created",
      "race.started",
      "track.afterLoad",
      "checkpoint.passed",
      "checkpoint.respawn",
      "race.finished",
    ]) {
      expect(all, `missing emit for ${event}`).toContain(event);
    }
  });

  /**
   * #10: every per-car race event carries the `{ carId, isReplay }` discriminator.
   * A static check that the payload SHAPE is there; that it computes the right
   * values is `per-car-events.test.ts`, which executes the transformed output.
   */
  it("tags every per-car race event with carId + isReplay", () => {
    const perCar = TIER1_BRIDGE_PATCHES.filter((p) =>
      ["skidding", "engine", "tires", "BrakeLight"].every((l) =>
        p.target.anchor.literals.includes(l),
      ),
    );
    // start() (race.started) + setCarState() (checkpoint.passed + race.finished).
    expect(perCar).toHaveLength(2);
    for (const patch of perCar) {
      for (const { label, source } of injectSources(patch)) {
        expect(source, `${label} lacks carId`).toContain("carId");
        expect(source, `${label} lacks isReplay`).toContain("isReplay");
      }
    }
  });

  /**
   * Three captures from two patches: the track-selection constructor yields both the
   * track manager and the audio manager, and the codec comes from its own module
   * factory. A count of 2 with 3 capture calls is the point, not an oversight.
   */
  it("captures all three objects the registries need", () => {
    expect(REGISTRY_CAPTURE_PATCHES).toHaveLength(2);
    const all = REGISTRY_CAPTURE_PATCHES.map((p) => injectSources(p)[0]?.source ?? "").join("\n");
    expect(all).toContain("captureTrackManager");
    expect(all).toContain("captureTrackCodec");
    expect(all).toContain("captureAudioManager");
  });

  /**
   * The audio manager (#11) reaches us from the SAME constructor as the track
   * manager, so it rides that patch rather than adding an anchor. If a future edit
   * splits them apart, this fails and the split has to be deliberate.
   */
  it("captures the audio manager from the track-selection constructor", () => {
    const uiPatch = REGISTRY_CAPTURE_PATCHES.find((p) =>
      p.target.anchor.literals.includes("Custom tracks"),
    );
    expect(uiPatch).toBeDefined();
    const source = injectSources(uiPatch as Patch)[0]?.source ?? "";
    expect(source).toContain("captureAudioManager");
    // Both captures in one inject, on one constructor.
    expect(source).toContain("captureTrackManager");
    expect(uiPatch?.target.selector).toEqual({ kind: "method", name: "constructor" });
  });

  /**
   * Each capture is independently guarded. Sharing one inject must not mean that a
   * missing/renamed `captureAudioManager` takes the TRACK capture down with it —
   * that would turn an audio-only game update into a tracks regression.
   */
  it("guards each capture separately so one missing hook cannot break the other", () => {
    const uiPatch = REGISTRY_CAPTURE_PATCHES.find((p) =>
      p.target.anchor.literals.includes("Custom tracks"),
    );
    const source = injectSources(uiPatch as Patch)[0]?.source ?? "";
    expect(source).toContain("window.__tspml.captureTrackManager)");
    expect(source).toContain("window.__tspml.captureAudioManager)");
  });
});

describe("inject payloads", () => {
  const sources = BRIDGE_PATCHES.flatMap(injectSources);

  it("are non-empty", () => {
    expect(sources.length).toBeGreaterThan(0);
    for (const { label, source } of sources) {
      expect(source.trim(), label).not.toBe("");
    }
  });

  // The payload only reaches a parser when a surface transforms a real bundle, so a
  // typo would otherwise ship. `new Function` parses without executing.
  it("parse as JavaScript", () => {
    for (const { label, source, expression } of sources) {
      expect(() => {
        // eslint-disable-next-line @typescript-eslint/no-implied-eval
        new Function(expression ? `return (${source});` : source);
      }, `${label} does not parse`).not.toThrow();
    }
  });

  /**
   * Every payload runs inside GAME code, so an unguarded throw breaks the game, not
   * just the mod — and one of these sits in a per-frame method. Every payload is
   * therefore try/catch-wrapped, unconditionally.
   */
  it("are try/catch-wrapped so a throw cannot escape into game code", () => {
    for (const { label, source } of sources) {
      expect(source, `${label} lacks a try/catch`).toMatch(/try\s*\{/);
    }
  });

  /**
   * A payload that touches the bridge must also tolerate its ABSENCE: a surface can
   * serve a transformed bundle before its own `load` handler installs `__tspml` (and
   * a vanilla-served page never installs one at all), so "no bridge" must mean
   * "silent no-op". The badge inject touches no bridge — it guards `typeof document`
   * instead — hence the condition rather than a blanket assertion.
   */
  it("guard the bridge wherever they touch it", () => {
    const bridgeUsers = sources.filter((s) => s.source.includes("window.__tspml"));
    // Everything except the badge.
    expect(bridgeUsers).toHaveLength(sources.length - 1);
    for (const { label, source } of bridgeUsers) {
      expect(source, `${label} lacks a typeof window guard`).toContain("typeof window");
      // Match the GUARD, not one spelling of it: `window.__tspml &&` (a flat
      // condition) and `window.__tspml)` (the head of a nested if, which the
      // shared track+audio capture uses) are equally valid presence checks.
      expect(source, `${label} lacks a __tspml presence check`).toMatch(
        /window\.__tspml\s*(&&|\))/,
      );
    }
  });

  /** The badge is the one payload with no bridge dependency; it guards the DOM instead. */
  it("guard the DOM in the badge inject", () => {
    const badge = sources.find((s) => s.source.includes("createElement"));
    expect(badge).toBeDefined();
    expect(badge?.source).toContain('typeof document === "undefined"');
    // Runs at module load, which may precede <body>.
    expect(badge?.source).toContain("document.documentElement");
    // Idempotent: two surfaces (or a re-applied transform) must not stack badges.
    expect(badge?.source).toContain("getElementById");
  });

  it("never reference a bare global the game does not define", () => {
    for (const { label, source } of sources) {
      // `window.__tspml`, never a bare `__tspml` — the latter is a ReferenceError in
      // strict-mode module scope rather than `undefined`.
      expect(source.replace(/window\.__tspml/g, ""), `${label} uses a bare __tspml`).not.toMatch(
        /(?<![.\w])__tspml\b/,
      );
    }
  });
});

describe("module anchors", () => {
  const targets = BRIDGE_PATCHES.map((p) => ({ label: describeSelector(p), t: p.target }));

  it("declare at least one literal", () => {
    for (const { label, t } of targets) {
      expect(t.anchor.literals.length, label).toBeGreaterThan(0);
    }
  });

  /**
   * A `minHits` above the literal count can NEVER match. The engine treats an
   * unresolvable target as "patch not applied" rather than an error, so this typo
   * would silently disable a hook — the exact failure class #34 is about.
   */
  it("cannot demand more hits than they offer", () => {
    for (const { label, t } of targets) {
      const { literals, minHits } = t.anchor;
      if (minHits !== undefined) {
        expect(minHits, `${label} minHits > literals`).toBeLessThanOrEqual(literals.length);
        expect(minHits, `${label} minHits must be positive`).toBeGreaterThan(0);
      }
    }
  });

  it("use string literals only (the locator ignores identifiers)", () => {
    for (const { label, t } of targets) {
      for (const lit of t.anchor.literals) {
        expect(["string", "number"], `${label} literal ${String(lit)}`).toContain(typeof lit);
      }
    }
  });

  /**
   * Regression guard. An earlier codec anchor used "PolyTrack2" + "Checkpoint has no
   * checkpoint order" with a loose minHits and silently resolved to the WRONG module
   * (6582/6762), so `fromExportString` was not a function. All four literals are
   * required — do not loosen this without re-verifying against a real bundle.
   */
  it("pin the track codec to all four of its literals", () => {
    const codec = REGISTRY_CAPTURE_PATCHES.find((p) =>
      p.target.anchor.literals.includes("PolyTrack2"),
    );
    expect(codec).toBeDefined();
    expect(codec?.target.anchor.literals).toHaveLength(4);
    expect(codec?.target.anchor.minHits).toBe(4);
  });
});

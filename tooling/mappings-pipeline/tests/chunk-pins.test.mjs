/**
 * Unit tests for src/chunk-pins.mjs — the `chunks` section decision (#98).
 *
 * This logic used to live inside gen-map.mjs, below a matcher that needs the gitignored
 * webcrack cache, so nothing in CI could reach it. That mattered more here than in most
 * places: every failure mode of this decision is silent. A carried (stale) pin cannot
 * match the live chunk, so the chunk serves vanilla and every mixin anchored in it stops
 * applying, with no error anywhere. These tests assert on the states that produce that.
 */
import { describe, expect, it } from "vitest";
import { CARRIED_NOTE, UNLABELLED_ROLE, parseGenChunks, resolveChunkPins } from "../src/chunk-pins.mjs";

const BASELINE = {
  112: { id: "112", hash: "sha256:aaa", bytes: 108037, role: "track editor" },
  535: { id: "535", hash: "sha256:bbb", bytes: 13182, role: "track verifier UI" },
};

describe("parseGenChunks", () => {
  it("returns undefined when regen supplied nothing (the standalone gen-map run)", () => {
    expect(parseGenChunks(undefined)).toBeUndefined();
    expect(parseGenChunks("")).toBeUndefined();
  });

  it("parses the {id, hash, bytes} array regen writes", () => {
    const v = parseGenChunks(JSON.stringify([{ id: "112", hash: "sha256:x", bytes: 10 }]));
    expect(v).toEqual([{ id: "112", hash: "sha256:x", bytes: 10 }]);
  });

  it("THROWS on malformed JSON instead of falling back to the carry path", () => {
    // The fallback is the dangerous direction: the caller set GEN_CHUNKS because it
    // fetched fresh bytes, so silently emitting the previous build's pins would read as
    // a re-pin in every report while shipping hashes that can never match.
    expect(() => parseGenChunks("{not json")).toThrow(/not valid JSON/);
  });

  it("throws when GEN_CHUNKS is valid JSON but not an array", () => {
    expect(() => parseGenChunks('{"112":"sha256:x"}')).toThrow(/not a JSON array/);
  });

  it("throws when an entry is missing hash or bytes rather than pinning `undefined`", () => {
    // A pin of `undefined` compares unequal to every real hash, so the chunk would be
    // permanently stale — the same silent no-transform, arrived at from a typo.
    expect(() => parseGenChunks('[{"id":"112","bytes":10}]')).toThrow(/missing id\/hash\/bytes/);
    expect(() => parseGenChunks('[{"id":"112","hash":"sha256:x"}]')).toThrow(/missing id\/hash\/bytes/);
    expect(() => parseGenChunks('[{"hash":"sha256:x","bytes":10}]')).toThrow(/missing id\/hash\/bytes/);
  });
});

describe("resolveChunkPins — fresh pins (regen --chunks)", () => {
  it("pins this fetch's hashes and does NOT stamp the carried warning", () => {
    const r = resolveChunkPins(BASELINE, [
      { id: "112", hash: "sha256:new1", bytes: 108100 },
      { id: "535", hash: "sha256:new2", bytes: 13182 },
    ]);
    expect(r.carried).toBe(false);
    expect(r.noteSuffix).toBe("");
    expect(r.chunks["112"]).toEqual({ id: "112", hash: "sha256:new1", bytes: 108100, role: "track editor" });
  });

  it("carries the human `role` prose across, since no fetch can regenerate it", () => {
    const r = resolveChunkPins(BASELINE, [{ id: "535", hash: "sha256:new", bytes: 1 }]);
    expect(r.chunks["535"].role).toBe("track verifier UI");
  });

  it("labels a chunk the baseline never described as unreviewed, not with a neighbour's role", () => {
    const r = resolveChunkPins(BASELINE, [{ id: "999", hash: "sha256:new", bytes: 1 }]);
    expect(r.chunks["999"].role).toBe(UNLABELLED_ROLE);
    expect(r.log).toContain("NEW: 999");
  });

  it("names a chunk that vanished from this build", () => {
    const r = resolveChunkPins(BASELINE, [{ id: "112", hash: "sha256:new", bytes: 1 }]);
    expect(r.log).toContain("GONE from this build: 535");
    expect(r.chunks["535"]).toBeUndefined();
  });

  it("normalises numeric ids to strings so the map keys match the served filename", () => {
    const r = resolveChunkPins(undefined, [{ id: 112, hash: "sha256:new", bytes: 1 }]);
    expect(r.chunks["112"].id).toBe("112");
  });
});

describe("resolveChunkPins — carry-forward (no --chunks fetch)", () => {
  it("carries the baseline pins AND stamps the note that says they are unverified", () => {
    // Without the stamp the candidate is indistinguishable from a freshly pinned one:
    // same shape, same ids, hashes that simply do not match the new build's bytes.
    const r = resolveChunkPins(BASELINE, undefined);
    expect(r.carried).toBe(true);
    expect(r.chunks).toBe(BASELINE);
    expect(r.noteSuffix).toBe(CARRIED_NOTE);
    expect(r.noteSuffix).toMatch(/CARRIED FORWARD unverified/);
  });

  it("warns loudly in the log about silent vanilla serving", () => {
    const r = resolveChunkPins(BASELINE, undefined);
    expect(r.log).toContain("UNVERIFIED");
    expect(r.log).toContain("silently serve vanilla");
    expect(r.log).toContain("--chunks");
  });

  it("treats an EMPTY fresh array as no fetch, not as 'this build has no chunks'", () => {
    // regen passes GEN_CHUNKS only when the fetch returned chunks, but a build that
    // momentarily reports none must not be allowed to erase a real allowlist here —
    // assertChunksCarried is the gate for a genuine drop, and it wants a human.
    const r = resolveChunkPins(BASELINE, []);
    expect(r.carried).toBe(true);
    expect(r.chunks).toBe(BASELINE);
  });
});

describe("resolveChunkPins — neither side declares chunks", () => {
  it("omits the section rather than writing an empty {} nobody claimed", () => {
    const r = resolveChunkPins(undefined, undefined);
    expect(r.chunks).toBeUndefined();
    expect(r.noteSuffix).toBe("");
    expect(r.carried).toBe(false);
  });

  it("treats an empty baseline object the same as none", () => {
    expect(resolveChunkPins({}, undefined).chunks).toBeUndefined();
  });
});

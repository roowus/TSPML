/**
 * The harness sets `x-tspml-detail` through Node's `res.setHeader`, which throws on
 * the same characters `Headers.set` does. Its detail strings are built in
 * game-proxy.ts and the hash-mismatch one contains both an em-dash and a `≠`:
 *
 *   `hash-mismatch: live <h> ≠ expected <h> — serving vanilla`
 *
 * That is the detail a NEW PolyTrack release produces. Unfixed, the harness would
 * have answered a maintainer's first post-release request with a bodyless 500 —
 * failing exactly when its job was to explain why the transform stopped applying.
 *
 * The transliteration is covered in @tspml/shared. What this asserts is the harness's
 * own contract: that its detail strings, and the setHeader call it makes with them,
 * agree.
 */
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { headerDetail } from "@tspml/shared";

/** The literal shape game-proxy.ts builds on the hash-mismatch path. */
function hashMismatchDetail(live: string, expected: string): string {
  return `hash-mismatch: live ${live} ≠ expected ${expected} — serving vanilla`;
}

/** Set a header the way game-proxy.ts does, and report whether the response survived. */
async function serveWith(value: string): Promise<{ status: number; header: string | null }> {
  const server = createServer((_req, res) => {
    try {
      if (value) res.setHeader("x-tspml-detail", value);
      res.end("ok");
    } catch {
      res.statusCode = 500;
      res.end("");
    }
  });
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as { port: number }).port;
  const res = await fetch(`http://localhost:${port}/`);
  const out = { status: res.status, header: res.headers.get("x-tspml-detail") };
  await res.text();
  server.close();
  return out;
}

describe("dev harness x-tspml-detail", () => {
  const live = `sha256:${createHash("sha256").update("live").digest("hex")}`;
  const expected = `sha256:${createHash("sha256").update("pinned").digest("hex")}`;

  it("the hash-mismatch detail is NOT header-safe raw (the bug)", async () => {
    const r = await serveWith(hashMismatchDetail(live, expected));
    expect(r.status).toBe(500);
    expect(r.header).toBeNull();
  });

  it("serves 200 with a readable header once passed through headerDetail", async () => {
    const r = await serveWith(headerDetail(hashMismatchDetail(live, expected)));
    expect(r.status).toBe(200);
    expect(r.header).toContain("hash-mismatch");
    expect(r.header).toContain("!=");
    expect(r.header).toContain("- serving vanilla");
  });

  it("keeps both hashes legible — the detail still has to be useful", async () => {
    // Transliteration must not eat the payload: the two hashes are the whole point of
    // the message, and the 200-char cap has to leave room for them.
    const r = await serveWith(headerDetail(hashMismatchDetail(live, expected)));
    expect(r.header).toContain(live);
    expect(r.header).toContain(expected);
  });
});

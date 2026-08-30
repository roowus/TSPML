// Unit tests for lib/mod-fetch.ts fetchText — specifically the TIMEOUT
// COVERAGE of the body read. The old shape cleared the abort timer as soon
// as the HEADERS arrived, so a response whose body never finished streaming
// hung the import forever: no error, no row, the Add form silently wedged
// (observed live against PML's CDN on the fifth install of a sweep).
import { describe, expect, it } from 'vitest';
import { fetchText, IMPORT_LIMITS } from '../lib/mod-fetch';

const res = (over: Partial<Response> = {}): Response =>
  ({ ok: true, status: 200, headers: new Headers(), text: async () => 'body', ...over }) as unknown as Response;

describe('fetchText', () => {
  it('returns the body and content type on the happy path', async () => {
    const r = await fetchText('https://cdn.example/mod.json', 1000, 'manifest', async () =>
      res({ headers: new Headers({ 'content-type': 'application/json' }) }), null,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.text).toBe('body');
      expect(r.contentType).toBe('application/json');
    }
  });

  it('covers the BODY read with the timeout — a stalled stream fails as "timed out", never hangs', async () => {
    // A real stalled stream aborts through the fetch signal: the abort fires
    // at the timeout and the in-flight res.text() rejects with an AbortError.
    // Simulated here by a text() that rejects the same way the signal would
    // make a real one reject — this pins the plumbing (the catch must wrap
    // the body read, or this rejection would be unhandled and the promise
    // would never settle for the caller).
    const abortErr = new Error('The operation was aborted');
    abortErr.name = 'AbortError';
    const r = await fetchText('https://cdn.example/stalled', 1000, 'entry', async () =>
      res({ text: () => Promise.reject(abortErr) }), null,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('timed out');
  });

  it('reports a non-OK status by code and host', async () => {
    const r = await fetchText('https://cdn.example/gone', 1000, 'manifest', async () =>
      res({ ok: false, status: 404 }), null,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain('404');
      expect(r.error).toContain('cdn.example');
    }
  });

  it('refuses a file over the cap, naming both sizes', async () => {
    const big = 'x'.repeat(50);
    const r = await fetchText('https://cdn.example/big.js', 10, 'entry', async () =>
      res({ text: async () => big }), null,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('import limit is 10');
    expect(IMPORT_LIMITS.timeoutMs).toBeGreaterThan(0);
  });
});

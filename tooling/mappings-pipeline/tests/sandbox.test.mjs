// Guards for #2: isolated-vm has no working build on Node 25, so webcrack's
// deobfuscate sandbox is unavailable there.
//
// The bug #2 describes is not "the sandbox is missing" — that is a fact about
// upstream we cannot fix. It is that the *absence is illegible*: a raw "No native
// build was found for … abi=141", or, with a stale source build present, a bare
// SIGSEGV with no JS error at all. These tests pin the legibility, and pin that the
// working path (plain unpacking, which never touches the sandbox) is untouched.
//
// ABI is injected rather than read from the runtime so both branches are exercised
// on whatever Node happens to be running — CI is on 22, local is on 25, and a test
// that only covers the branch its own runtime takes is half a test.
import { describe, expect, it } from 'vitest';
import { PREBUILT_ABIS, sandboxOptions } from '../src/sandbox.mjs';

describe('isolated-vm availability by ABI (#2)', () => {
  it('defers to webcrack on a Node whose ABI has a prebuild', () => {
    // Node 22 (abi127) and Node 24 (abi137) both ship in isolated-vm@6.1.2, so we
    // must pass NO sandbox — overriding it would disable deobfuscation on the very
    // runtimes where it works, turning a compatibility note into a capability loss.
    for (const abi of ['127', '137']) {
      expect(sandboxOptions(abi, 'v22.21.1')).toEqual({});
    }
  });

  it('substitutes a failing sandbox on a Node with no prebuild', () => {
    const opts = sandboxOptions('141', 'v25.2.1');
    expect(opts.sandbox).toBeTypeOf('function');
  });

  it('names the cause, the runtime, and the way out when the sandbox is reached', async () => {
    // The whole point of the substitution. A test asserting only "it rejects" would
    // pass against `throw new Error()`, which is precisely the illegible failure
    // this exists to replace — so assert on the content.
    const { sandbox } = sandboxOptions('141', 'v25.2.1');
    await expect(sandbox('1+1')).rejects.toThrow(/isolated-vm/);
    await expect(sandbox('1+1')).rejects.toThrow(/v25\.2\.1.*ABI 141/);
    await expect(sandbox('1+1')).rejects.toThrow(/Node 22 or 24/);
    await expect(sandbox('1+1')).rejects.toThrow(/#2/);
  });

  it('keys on ABI, not the Node major', () => {
    // Node 25 is excluded for being abi141, not for being 25 — and a future Node
    // that reuses a covered ABI should just work. Encoding the major instead would
    // need editing on every release; encoding the ABI needs editing only when the
    // set of shipped prebuilds actually changes, which is the honest trigger.
    expect([...PREBUILT_ABIS].every((a) => /^\d+$/.test(a))).toBe(true);
    expect(PREBUILT_ABIS.has('22')).toBe(false);
    expect(PREBUILT_ABIS.has('25')).toBe(false);
  });

  it('leaves plain unpacking working — the sandbox is never reached', async () => {
    // The measured fact this whole approach rests on: the PolyTrack bundle is
    // minified, not obfuscator.io-obfuscated, so webcrack never calls the sandbox.
    // If a future webcrack invoked it eagerly, unpacking would start failing on
    // Node 25 and this test would catch it before a regen did.
    const { webcrack } = await import('webcrack');
    const result = await webcrack('const a = 1 + 1; console.log(a);', sandboxOptions('141', 'v25.2.1'));
    expect(result.code).toMatch(/console\.log/);
  });
});

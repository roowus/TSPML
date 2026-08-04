// webcrack's `sandbox` — the one part of webcrack that genuinely does NOT work on
// Node 25 (#2). Its own module so it can be unit-tested; `unpack.mjs` runs on import.
//
// webcrack's deobfuscate stage evaluates an obfuscator.io string-array decoder to
// recover the literals it hides, and it does that inside `isolated-vm`, a native
// addon. On Node 25 there is no working build of isolated-vm *by any route*, measured
// on darwin-arm64:
//
//   - no prebuild — isolated-vm@6.1.2 ships abi127/abi137 (Node 22/24) only, and Node
//     25 is abi141. `require` throws "No native build was found for … abi=141".
//   - no source build — with a working python, node-gyp compiles and links cleanly,
//     and the resulting addon then **segfaults (SIGSEGV) on `new ivm.Isolate()`**,
//     reproducibly. That is worse than the missing prebuild: it dies with no JS error
//     to catch and no output at all.
//   - no newer version — isolated-vm@7 ships abi137/abi147 (Node 24/26) and declares
//     `engines: >=26`. Node 25 falls in the gap on both sides.
//
// This is survivable only because webcrack imports isolated-vm lazily, inside the
// sandbox call. The PolyTrack bundle is minified, not obfuscator.io-obfuscated, so it
// never reaches the decoder: unpacking the real 0.6.2 bundle on Node 25 produces 212
// modules, byte-identical (`diff -rq`, no differences) to the same unpack on Node 22.
//
// So: don't try to make it work, make it *legible*. On a Node with a shipped prebuild
// we pass nothing and webcrack uses its own working sandbox. On any other Node we
// substitute one that throws a catchable JS error naming the real cause — instead of
// a raw "No native build was found", or, if someone has left a stale source build in
// the tree, a bare SIGSEGV.
//
// Keyed on the ABI, not the Node major, because the ABI is what actually has to
// match: prebuilds are named `isolated-vm.abi<N>.node`, and Node 25 is excluded for
// being abi141 — not for being 25. A Node 26 with an isolated-vm@7 prebuild would
// need 147 added here, which is the honest unit of change.
export const PREBUILT_ABIS = new Set(['127', '137']); // isolated-vm@6.1.2: Node 22, 24

/**
 * webcrack options for the current runtime: `{}` where isolated-vm loads, or a
 * sandbox that fails with an explanatory error where it does not.
 *
 * @param {string} [abi] Node ABI (`process.versions.modules`). Injectable for tests.
 * @param {string} [nodeVersion] Node version string, for the message only.
 */
export function sandboxOptions(abi = process.versions.modules, nodeVersion = process.versions.node) {
  if (PREBUILT_ABIS.has(abi)) return {};
  return {
    sandbox: async () => {
      throw new Error(
        [
          'webcrack needs its isolated-vm sandbox to deobfuscate this bundle, and',
          `isolated-vm ships no working build for Node ${nodeVersion} (ABI ${abi}) — see #2.`,
          'The PolyTrack bundle does not need it, so reaching here means the input is',
          'obfuscator.io-obfuscated — a genuinely new situation, not a regression.',
          'Re-run this unpack under Node 22 or 24, where the prebuild loads.',
        ].join(' '),
      );
    },
  };
}

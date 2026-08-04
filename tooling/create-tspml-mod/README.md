# create-tspml-mod

Scaffold CLI — generates a new TSPML mod project (manifest, entrypoint, mixin
config, tsconfig, README).

## Usage

```bash
node bin/create-tspml-mod.mjs my-cool-mod
cd my-cool-mod && pnpm install && pnpm build
```

**Not `npx create-tspml-mod` yet** — this package is still `private` and
unpublished, so `npx` 404s (#19). The path above is the working equivalent.
Publishing is the owner's call; everything else is publish-ready (`files` is
scoped, the bin runs standalone, the output has no workspace deps).

## What it generates

| File | Purpose |
|---|---|
| `mod.json` | Manifest — `schemaVersion` 1, id, targets, `entrypoint: dist/src/entrypoint.js`, mixins. |
| `src/entrypoint.ts` | Factory `(api) => {}` subscribing to `car.control` + registering a `KeyH` keybind. |
| `mixins.json` | A starter Tier-2 mixin targeting the stable name `Car` (mappings-resolved, fail-closed). |
| `types/tspml-api.d.ts` | Local stand-in for `@tspml/api`, which is also unpublished. |
| `tsconfig.json` | Self-contained — does *not* extend the repo base, so the mod builds at any path. |
| `README.md` | Author-facing instructions, including how to swap in `@tspml/api`. |

## The standalone contract (#19)

The generated project must build **outside this monorepo** with nothing but
`typescript`. It previously did not: `@tspml/api@workspace:*` made the very first
advertised command die with `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND`, and `mod.json`
pointed at an `entrypoint.js` that no build ever emitted.

Tests in `tests/scaffold.test.mjs` hold that contract, and each was verified to
fail when its defect is reintroduced:

- no `workspace:` protocol and no `@tspml/*` dependency in the generated manifest;
- `mod.json`'s `entrypoint` is *derived from* the generated tsconfig's
  `outDir`/`rootDir`, so the two cannot drift apart;
- every `api.<member>` the entrypoint touches exists in the stand-in;
- the stand-in never declares a member the real `TspmlApi` lacks — a rename in
  `packages/api/src/api.ts` fails CI here rather than shipping a broken scaffold;
- and an end-to-end test that runs the **real tsc** against a real scaffold on
  disk. Asserting on generated *text* is what let #19 ship — the content was
  always fine; what was broken was what happened when you ran it.

## Tests

```bash
pnpm --filter create-tspml-mod test
```

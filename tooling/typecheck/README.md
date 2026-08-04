# @tspml/typecheck

**Typechecks the code no package build covers.** Two bodies of `.mjs` were read by
nothing — not `pnpm -r build` (per-package `tsc -p` plus `next build`/`vite build`,
none of which see a loose `.mjs`), not vitest (which never imports them):

| Checked | Why it matters |
|---|---|
| `source/portal/scripts/*.mjs` + `environments/dev-harness/scripts/*.mjs` | The five headless smokes are the **only** end-to-end proof a transformed game boots. A typo here surfaces as a baffling failure 30 s into a browser run — or as a smoke that quietly stops asserting what its name claims. |
| `tooling/mappings-pipeline/src/*.mjs` + `scripts/*.mjs` | Regenerates the symbol map on a game release. A mistake does not fail loudly; it produces a **plausible but wrong candidate map**, and the map is what every surface hash-gates against. |

Run via the root script (`pnpm -r lint`), which before [#25] matched no package at all.

## It has already paid for itself

The first run found four things in the pipeline, one a real defect:

`regen.mjs` passed `stdio: "inherit"` to **`execFile`**, which has no `stdio`
option. Node ignored it, so gen-map's report — the thing a maintainer reads to
decide whether to promote a candidate map — was buffered into a discarded string
instead of printed (and would have been truncated at the 1 MB default `maxBuffer`
had anything read it). The symptom was "the regen is oddly quiet", which reads as
normal, so it survived every run and every test. Fixed to `spawn`, with
`tests/regen-runnode.test.mjs` guarding it.

The other three were type hygiene: a `readonly` array passed to a mutable
parameter, a `let status` widened to `string` where a union was meant, and a
mixed-element array that needed a tuple annotation before `re.test()` typechecked.

## Why non-strict, deliberately

Under `strict` the smokes alone produce **231** diagnostics — almost all
`noImplicitAny` on inline callback parameters, plus complaints about result objects
built up field by field. Annotating that is a large diff that makes the smokes
harder to read and catches no defect.

Non-strict `checkJs` still catches what these scripts actually get wrong: a
misspelled property on a typed value (`page.waitForTimeut`), wrong arity on a
Playwright call, a typo'd import, a `const` reassignment. Verified by injecting
each of those and confirming a non-zero exit.

If you tighten this, tighten it because a real defect slipped through — not for
the pleasure of the flag.

## The `any` in `smoke-globals.d.ts` is a decision, not laziness

The smokes read `window.__tspml` inside `page.evaluate()`. Those callbacks are
serialized and run in the **game frame's realm**, where the host installs the
bridge at runtime — there is no static type to import, because the value does not
exist in the Node process doing the checking.

Typing it properly would make five smokes compile-time consumers of the bridge's
internals, so refactoring `__tspml` would break the typecheck of scripts that do
not care. `api.audio` / `api.tracks` already have real types in
[`@tspml/api`](../../packages/api), and the api-bridge unit tests hold them.

## What does *not* belong here

A package that has its own `build`. If `tsc -p` already reads the file, this
package should not.

[#25]: https://github.com/roowus/TSPML/issues/25

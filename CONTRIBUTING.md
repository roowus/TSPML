# Contributing to TSPML

Thanks for your interest! TSPML is a mod loader for PolyTrack — please read the [disclaimers](./README.md#-disclaimers) first.

➡️ **Full guides live in [`docs/contributing/`](./docs/contributing/):**

- [Setup](./docs/contributing/setup.md) — cloning and prerequisites.
- [Conventions](./docs/contributing/conventions.md) — code style, repo layout, commits, mappings maintenance, **momentum & autonomy** (always carry on).

## Quick rules

- **Always carry on — never stop to checkpoint or ask for sub-decisions.** Decide what's best + execute. See [conventions.md → Momentum & autonomy](./docs/contributing/conventions.md#momentum--autonomy-core-practice).
- **Never commit the PolyTrack game**, its WASM, or deobfuscated source. Ship only our code + mappings metadata.
- **Docs are living.** Every non-trivial decision gets an ADR; update progress.md per milestone. Stale docs are a bug.
- **Run it yourself.** If a check is executable, run it. Automate browser checks with Playwright. Don't claim "untested" if you can test it.
- **TypeScript**, strict, ESM. Conventional Commits. CI mandatory.
- `pnpm install --ignore-scripts && pnpm -r build && pnpm -r test && pnpm -r lint` should pass before pushing. (`lint` is [`@tspml/typecheck`](./tooling/typecheck) — it typechecks the `.mjs` no package build reads: the headless smokes and the mappings pipeline. Run it **after** `build`, since it checks scripts importing workspace declarations.)
- **The smokes are not optional proof.** Unit tests cannot see whether a transformed game boots — the injects reference the bundle's minified parameter names and only meet a parser when a real bundle is transformed. `pnpm --filter @tspml/portal smoke{,:tracks,:audio}` runs against the live game; the [Smoke workflow](./.github/workflows/smoke.yml) runs them per-PR (advisory) and daily.

## Writing a mod

```bash
npx create-tspml-mod my-mod   # scaffold a working starter
```

See the [getting-started guide](./docs/getting-started.md).

## Where help is most useful

- **M7-C:** the Vite dev harness (fast mod HMR).
- **M8 continues:** the browser extension (api + transforms — the online path).
- **M9:** the full auto-mappings pipeline.
- **Docs, examples, and demo mods.**

See [`docs/project/roadmap.md`](./docs/project/roadmap.md).

## License

MIT (our code). PolyTrack is © its developer and is not covered by this license.

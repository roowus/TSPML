# @tspml/cli

The `tspml` CLI for maintainer operations.

> **Status: scaffolded.** The mappings regen/diff/verify workflow is implemented in
> [`@tspml/mappings-pipeline`](../mappings-pipeline/) (`regen.mjs`) — it is co-located
> with webcrack and the gitignored `.cache/` it drives, rather than in a
> globally-installable CLI. Run it via `node tooling/mappings-pipeline/scripts/regen.mjs`.
>
> This package is reserved for the future `tspml publish` (mod-registry publish) command.

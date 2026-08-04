# scripts

> **Status: empty on purpose — no repo-level scripts exist yet (#30).**

"Repo and build helper scripts" described an intention, not a directory. Every
script TSPML actually runs is owned by the package it serves:

| What | Where |
|---|---|
| Mappings regen / diff / verify | `tooling/mappings-pipeline/scripts/regen.mjs` (+ `src/*.mjs`) |
| Map generation | `source/mappings/scripts/gen-map.mjs` |
| Headless smokes | `source/portal/scripts/`, `environments/dev-harness/scripts/` |
| Build / test / lint fan-out | root `package.json` → `pnpm -r <script>` |

That co-location is deliberate rather than accidental: the pipeline scripts sit
next to webcrack and the gitignored `.cache/` they drive, and the smokes next to
the app they load.

A script belongs here only if it is genuinely repo-wide and fits in no package.

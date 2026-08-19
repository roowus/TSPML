# Tspml Checkpoint Counter

A [TSPML](https://github.com/roowus/TSPML) mod for PolyTrack.

## Develop

```bash
pnpm install
pnpm build
```

## What it does

- `src/entrypoint.ts` — subscribes to the `car.control` event + registers a `KeyH` keybind.
- `mixins.json` — a starter Tier-2 mixin targeting the stable name `Car` (mappings-resolved, fail-closed).

See the mod API: [docs/api/events-and-registries.md](../../../docs/api/events-and-registries.md) + [docs/api/mixin-reference.md](../../../docs/api/mixin-reference.md).

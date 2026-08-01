# @tspml/api

TypeScript type definitions for the [TSPML](https://github.com/roowus/TSPML) stable mod surface — gives modders autocomplete + type-safety against stable names. **Zero runtime** (types only): mods `import type` from here; the loader supplies the runtime via `@tspml/api-bridge`.

## Install (for mod authors)

```bash
npm install -D @tspml/api
# or: pnpm add -D @tspml/api
```

## Use

```ts
import type { TspmlApi } from '@tspml/api';

export default function myMod(api: TspmlApi) {
  // Typed events (Tier 1)
  api.events.on('car.control', (state) => {
    state.carId; state.up; // fully typed
  });
  // Typed keybind registry
  api.keybinds.register({ id: 'my-mod.toggle', key: 'KeyH', onDown: () => {} });
}
```

See the [events & registries](https://github.com/roowus/TSPML/blob/main/docs/api/events-and-registries.md) + [mixin reference](https://github.com/roowus/TSPML/blob/main/docs/api/mixin-reference.md).

## Publishing (maintainers)

The package is publish-ready (publishConfig `access: public`, `prepublishOnly` builds). From the repo root:

```bash
cd packages/api
npm version patch     # 0.1.0 -> 0.1.1 (when the API changes)
npm publish           # requires `npm login` + org/package ownership
```

`npm pack --dry-run` shows exactly what ships (`dist/` type defs + this README — no source, no runtime).

# Mixin reference (Tier 2 — escape hatch)

> Declarative function surgery against **stable names**, for needs the events/registries don't cover. This is the JS SpongePowered-Mixin analog.
>
> **Status (M5): implemented as transform-time JSON descriptors** — not a runtime `api.mixin.*` object. Mods declare patches in a mixin config file; the portal/loader collects them and `@tspml/transform` applies them to the live bundle before it runs.

## How mixins are authored today

1. Reference a descriptor from `mod.json`:

```jsonc
{
  "mixins": [{ "config": "mixins.json", "environment": "web" }]
}
```

2. Declare patches in that JSON file (see `@tspml/demo-hud`'s `mixins.json`):

```jsonc
{
  "patches": [
    {
      "op": "after",
      "symbol": "Car",                       // stable name → mappings (fail-closed)
      "inject": "(function(){ /* ... */ })();"
    },
    {
      "op": "before",
      "target": {                            // or an inline anchor (escape hatch)
        "anchor": { "literals": ["CreateCar", "ControlCar"], "minHits": 2 },
        "selector": { "kind": "method", "name": "controlCar" }
      },
      "inject": "/* statements at HEAD */"
    }
  ]
}
```

3. The portal resolves `{ symbol }` patches via `@tspml/mappings` (drops unresolvable / stale-map entries) and feeds concrete `Patch`es to `transform()`.

There is **no** runtime `api.mixin.before(...)` on `TspmlApi` today. A future runtime helper is out of scope until needed; the declarative path is the supported escape hatch.

## Operations (transform-time)

| `op` | Fabric analog | Behavior |
|---|---|---|
| `before` | `@Inject` HEAD | inject statement source at the head of the method/factory body |
| `after` | `@Inject` RETURN | inject before each return (or at end if none) |
| `around` | wrap | rebind original body to `proceed` (default name); inject becomes the new body |
| `replace` | `@Overwrite` | overwrite the body — **last resort, single-winner** |
| `modifyArg` | `@ModifyArg` | replace arg `index` of calls to `callee` inside the target |
| `modifyReturn` | — | wrap each returned value: `return (wrap)(X)` |
| `modifyConstant` | `@ModifyConstant` | replace an `ObjectProperty` value selected by key |

Payloads are **JS source strings** (`inject` / `wrap` / `replaceWith`), parsed by Babel and inserted into the AST.

## Targets

A patch targets either:

- a **stable name** — `{ "symbol": "Car.controlCar", "op": "...", ... }` resolved fail-closed through the map's `targets` section, or
- an **inline** `{ "target": { "anchor", "selector" } }` (module by distinctive literals, then method / property / factory).

```ts
// Conceptual TargetSpec (also the map's targets value shape)
{
  anchor: { literals: ["CreateCar", "ControlCar", "TestDeterminism"], minHits: 3 },
  selector: { kind: "method", name: "controlCar" } // or property / factory
}
```

Module anchors use **string/numeric literals only** (not identifiers). INVOKE-style cross-module call-site locators are still open under [#1](https://github.com/roowus/TSPML/issues/1) / M9.

## Conflict policy

| Op | Across mods |
|---|---|
| `before` / `after` / `around` / `modifyArg` / `modifyReturn` / `modifyConstant` | **chain** — applied in **array order**; multiple patches on one target compose (tested). Ordered-by-`priority` is [#13](https://github.com/roowus/TSPML/issues/13) (the `priority` field is declared but not yet used). |
| `replace` | **single-winner** — two mods on the same target = load-time **CONFLICT ERROR** (both fail `conflict-replace-single-winner`, neither applied — implemented + tested). |

**`around` semantics:** `proceed()` invokes the original body (preserving params + `this`); nested `around` hooks compose in array order. Priority-ordered nesting + short-circuit propagation are part of [#13](https://github.com/roowus/TSPML/issues/13).

## Failure behavior

A per-patch miss (target not found) is reported, never thrown — it does **not** block other patches (per-patch isolation, tested).

On `bundleHash` mismatch the engine **fails closed**: no AST patches from a non-matching map (silent-mis-target risk). See [mappings-system.md](../design/mappings-system.md).

## Declarative mixin files (M5 — implemented)

Mixins are packagable, reviewable JSON patches using the ops/targeting/conflict policy above. The portal collects them (`source/portal/lib/demo-mods.ts`) and the transform applies them alongside loader-owned bridge patches.

**Targeting (M5-C — implemented):** stable names such as `Car`, `Car.controlCar`, `Car.createCar` are pinned in the 0.6.2 map's `targets` section and resolved fail-closed.

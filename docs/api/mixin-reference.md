# Mixin reference (Tier 2 — escape hatch)

> Declarative function surgery against **stable names**, for needs the events/registries don't cover. This is the JS SpongePowered-Mixin analog. Status: **M0 sketch**; semantics finalize in M5.

## Operations

```ts
api.mixin.before(target, handler)              // @Inject HEAD — handler(args)
api.mixin.after(target, handler)               // @Inject RETURN — handler(args, result)
api.mixin.around(target, handler)              // wrap — handler(args, proceed) → may short-circuit
api.mixin.modifyArg(target, callsite, i, fn)   // @ModifyArg — change one argument of an internal call
api.mixin.modifyReturn(target, fn)             // transform return value
api.mixin.replace(target, handler)             // @Overwrite — full overwrite; LAST RESORT, single-winner
```

## Targets

A `target` is a **stable path** resolved through the mappings file at bind time:

```ts
{ symbol: "Car.controlCar", point: "HEAD" }                     // method, inject point
{ symbol: "Car.update", invoke: "Car.applyPhysics" }            // an internal INVOKE call site
{ symbol: "Track.afterLoad", point: "RETURN" }
```

The mappings file carries the concrete locator for each symbol (and each named call site). The resolver tries fallback tiers (`exportRef` → `prototypeFn` → `callExpression` → `string`) before declaring failure.

## Conflict policy

| Op | Across mods |
|---|---|
| `before` / `after` / `around` / `modifyArg` / `modifyReturn` | **chain** — applied in array order; multiple patches on one target compose (tested). Ordered-by-`priority` is [#13](https://github.com/roowus/TSPML/issues/13) (the `priority` field is declared but not yet used). |
| `replace` | **single-winner** — two mods on the same target = load-time **CONFLICT ERROR** (both fail `conflict-replace-single-winner`, neither applied — implemented + tested). |

**`around` semantics:** `proceed()` invokes the original body (preserving params + `this`); nested `around` hooks compose in array order. Priority-ordered nesting + short-circuit propagation are part of [#13](https://github.com/roowus/TSPML/issues/13).

## Failure behavior

A per-patch miss (target not found) is reported, never thrown — it does **not** block other patches (per-patch isolation, tested). Each hook's `required: true|false` refines this:

- **required + unresolved** → that one mod is disabled with a specific message (never a boot-abort).
- **optional + unresolved** → skip that hook, keep the rest.

On `bundleHash` mismatch the loader **fails closed**: no AST/physics/ranked locators from a non-matching map (silent-mis-target risk); only runtime-fallback event hooks may bind. See [mappings-system.md](../design/mappings-system.md).

## Declarative mixin files (M5-A — implemented)

Mixins are declared as JSON descriptor files referenced from `mod.json`'s `mixins[]` (e.g. `@tspml/demo-hud`'s `mixins.json`) — packagable, reviewable patches using the same ops/targeting/conflict policy as above. The portal collects them and the transform applies them alongside the loader-owned bridge patches.

**Targeting (M5-C — implemented):** a patch may target either an inline anchor (`{ target: { anchor: { literals }, selector } }`) or a **stable name** (`{ symbol: "Car.controlCar", op, inject }`), resolved fail-closed via `@tspml/mappings` to a concrete `TargetSpec` — so mods are decoupled from the build's minification. The map's `targets` section pins stable names (e.g. `Car`, `Car.controlCar`, `Car.createCar`) for the current build.

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
| `before` / `after` / `around` / `modifyArg` / `modifyReturn` | **chain** (ordered by declared `priority`) |
| `replace` | **single-winner** — two mods on the same target = load-time **CONFLICT ERROR** |

**`around` semantics:** nesting by priority — `proceed()` invokes the next wrapper in the chain or the original; short-circuit propagation is documented. Mods that may short-circuit should declare `may-short-circuit` so others can detect incompatibility at load. (Chained short-circuitable wraps are more permissive than Fabric's single-winner redirects, so the contract must be explicit.)

## Failure behavior

Every resolution returns a bound target or a typed `ResolutionFailure`. Each hook declares `required: true|false`:

- **required + unresolved** → that one mod is disabled with a specific message (never a boot-abort).
- **optional + unresolved** → skip that hook, keep the rest.

On `bundleHash` mismatch the loader **fails closed**: no AST/physics/ranked locators from a non-matching map (silent-mis-target risk); only runtime-fallback event hooks may bind. See [mappings-system.md](../design/mappings-system.md).

## Declarative mixin files

Mixins can also be declared as JSON descriptor files (referenced from `mod.json` `mixins[]`) for packagable, reviewable patches — same ops, same targeting, same conflict policy.

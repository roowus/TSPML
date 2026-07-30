# Fabric (Minecraft) — architecture & its JS translation

> Research target: distill the design principles that make Fabric good, and — crucially — work out what translates to a minified browser-JS game (PolyTrack) and what does not. TSPML is explicitly "like Fabric."

## TL;DR

Fabric is a **deliberately layered** system: **Fabric Loader** (mostly version-independent; discovers mods, parses metadata, resolves/ordered deps, calls entrypoints) → **Fabric API** (a stable, modular, versioned surface of events/registries/hooks) → **SpongePowered Mixin** (the bytecode-weaving engine that lets the API *and* mods surgically rewrite the game at load time). Fabric updates to new Minecraft versions in ~24–48 h (vs weeks for Forge) because of a clean abstraction layer **plus an automated two-stage mappings pipeline** (Intermediary = stable ABI; Yarn = dev-readable names). For TSPML, the loader/metadata/dependency/events/registry layers translate almost 1:1 (and JS is better at hot-reload). The **Mixin layer has no clean JS equivalent** — that gap is bridged by AST transforms + runtime patching + a **maintained per-version mappings file** (the single most important decision).

## The three layers — and why the split matters

- **Fabric Loader** — contains *no game-specific logic*, which is why it survives game updates largely unchanged.
- **Fabric API** — itself just a mod that requires the loader; **modular** (dozens of `-v0/-v1/-v2` modules so breaking changes ship as new modules while old ones remain). Its job: expose hard-to-reach functionality and provide events/hooks/registries.
- **SpongePowered Mixin** — the low-level engine (ASM bytecode weaving) that *both* the API and individual mods use to modify compiled classes at load time.

**The core principle:** the API team writes **one set of mixins** to bridge a stable public API to volatile game internals; ordinary mods code against the stable API and never touch internals. This **concentrates fragility in a small, maintained adapter** rather than spreading it across every mod — the root cause of Fabric's fast update turnaround. TSPML copies this: only the API bridge + mappings file are version-coupled; mods target stable names.

## The Mixin system

**Problem solved:** surgical, load-time modification of compiled internals without reimplementing the game or having source. Mixin classes don't exist at runtime — their members are merged into the target class *during class loading*.

**Injectors** (most → least surgical):
- `@Inject` — insert code at a point (`HEAD`, `RETURN`, or `INVOKE`); `cancellable=true` aborts via `CallbackInfo`; can capture locals.
- `@ModifyArg` — change one argument of one inner call.
- `@ModifyArgs` — change several args at once.
- `@ModifyVariable` — rewrite a local at `STORE`.
- `@ModifyConstant` — replace a numeric literal.
- `@Redirect` — hijack one call/field/new (only one per call site → two mods clash).
- `@Overwrite` — replace a whole method body ("inherently incompatible," last resort).

**Guiding rule:** use the most targeted injector that works — targeted injectors conflict less and chain across mods. `@Inject` **chains** (multiple mods cooperate); `@Redirect`/`@Overwrite` do **not** (single-winner). Targets are specified by name/descriptor + `@At(...)` (HEAD/RETURN/INVOKE/FIELD/NEW + ordinal) + `@Slice(from,to)`.

## Mod metadata (`fabric.mod.json`)

`schemaVersion`; required `id` (lowercase `[a-z0-9-_]`) + `version`; `name`/`description`/`authors`/`contributors`/`contact`/`license`/`icon`; `environment` (`*`|`client`|`server`); `entrypoints` (`main`/`client`/`server` → class or `{adapter,value}`); `mixins` (config paths, side-specific); `access_widener` (JVM-specific, no JS analog); dependency predicates `depends`/`recommends`/`suggests`/`conflicts`/`breaks` (mod-id → version predicate), `includes` (nested JARs); `custom` (tooling data); `provides` (drop-in for another id).

## Events + the Registry pattern

**Events** are the *preferred*, stable extension point (use instead of mixins wherever possible). `EventFactory.create(...)` builds an array-backed event; register/unregister rebuilds an array so dispatch is lock-free and hot-path-fast. Lifecycle events (`ServerTickEvents.END_SERVER_TICK`, `ClientTickEvents.END_CLIENT_TICK`) replace the need to mixin the tick loop. **Registries** key every game object by a namespaced `Identifier` (`modid:path`); `Registry.register(Registries.ITEM, id, obj)` adds content, and `fabric-registry-sync-v0` syncs custom entries to clients automatically. **Why this is the stability moat:** the public `Registry.register`/`Event` signatures stay constant; when the game refactors, the API team updates *one* internal mixin per affected event, and every mod keeps working.

## Dependencies

`depends`/`recommends`/`suggests`/`conflicts`/`breaks` map mod-id → **version predicate** using extended SemVer mirroring npm ranges (`*`, exact, `>`/`>=`/`<`/`<=`, `~`, `^`, `1.x`, space=AND, `||`=OR, Maven intervals). Special ids include `minecraft`, `fabricloader`, `java`, `fabric-api`. **This is the cleanest, most transferable part of Fabric** — and JS has a battle-tested `semver` npm package implementing the *same grammar*.

## Developer experience

**Loom** (Gradle plugin) sets up a deobfuscated dev environment (Minecraft + mods with obfuscation handled; run tasks; remaps dev↔prod namespaces). **Yarn** is the libre, community-maintained, human-readable mapping layered on Intermediary, updated several times per MC version. One-command **mod templates**. Multi-version/multi-language **docs**. **Hot reload** needs DCEVM/JBR (standard JVM hotswap only swaps method bodies); mixins reload on restart. **Key JS insight:** JS/HMR is *natively* better at hot reload than the JVM — re-evaluating a module on save is standard web tooling. TSPML exploits this (scoped to Tier-1 + runtime-rebindable mixin handlers; AST injection-point edits still need transform+reload).

## Why fans prefer Fabric over Forge

Lightweight (~half Forge's size), fast update turnaround (clean API isolates mods; automated mapping pipeline), mixin power (Forge discouraged coremods), and a clean minimal versioned API. Tradeoff: Forge ships more out-of-the-box; Fabric ships less to move fast. **Lesson for TSPML:** keep the core tiny and modular; invest in fast mappings-regeneration tooling (update speed *is* the product); give authors real surgical power but route it through a maintained bridge; resist hand-modding every internal.

## The JS translation (the most important output)

| Fabric concept | JS/web equivalent | Verdict |
|---|---|---|
| Fabric Loader | Mod bootstrap (discover/parse/resolve/order/entrypoints) | **Clean 1:1** |
| `fabric.mod.json` | `mod.json` (same fields; `access_widener` → none) | **Clean 1:1** |
| Dependency resolution (semver) | npm `semver` (same grammar) | **Clean — even better** |
| Fabric API events (`Event<T>`) | `EventEmitter` (`api.events.on('tick', cb)`) | Clean surface; **bridge is hard** |
| Fabric API registries | namespaced registry + sync hook | Clean surface; bridge is hard |
| SpongePowered Mixin (bytecode weaving) | **No direct equivalent** | core problem |
| `@Inject` HEAD/RETURN | runtime method-wrap **or** AST insert at entry/return | partial / full |
| `@Redirect`/`@ModifyArg` | **AST `CallExpression` rewrite only** | AST-only |
| `@ModifyVariable`/`@ModifyConstant` | AST rewrite of assignment / numeric literal | AST-only |
| `@Overwrite` | reassign exposed method / replace `FunctionDeclaration` | OK |
| Mixin config JSON | patch-descriptor (stable name + op + handler) | translates |
| `@At("INVOKE", target=...)` | AST path/locator in the mappings file | far more brittle |
| Classloader hook | webpack `__webpack_require__` wrap, **or** pre-eval AST transform | different mechanism |
| **Intermediary (stable ABI)** | **maintained per-build mappings file (no built-in)** | **no clean equiv — key work** |
| Yarn (dev names) | deobfuscation/rename map for dev ergonomics | maintainable, big DX win |
| Loom (deobf dev env) | npm dev harness loading the patched bundle | easy |
| Hot reload | native JS HMR / module re-eval | **JS is better** |

**Four patching techniques** ranked power/robustness/simplicity:
- **[A] Runtime monkey-patch** of reachable objects (`window.Game.x = wrapped`). Cheap; only reaches exposed boundaries. Analog of `@Inject` HEAD/RETURN + `@Overwrite` for exposed methods only.
- **[B] Module-load interception** — wrap webpack `__webpack_require__` factories to rewrite module exports before use. Reaches module-scope functions; module IDs unstable across builds. The practical default for .io-style games.
- **[C] AST/source transform before eval** (Babel/acorn/SWC → declarative patches → re-stringify → eval/inject with source maps). **The truest Mixin analog** and the *only* way to do `@Redirect`/`@ModifyArg`/`@ModifyVariable`/`@ModifyConstant` on internal call sites. Highest power, **lowest robustness** (build-sensitive), highest complexity. Reserve for the API bridge + advanced mods.
- **[D] Proxy/Reflect** — wrap a whole object to intercept all access. Powerful but breaks `===` identity + prototype assumptions; needs the object reference. Best for whole-subsystem wrapping.

**Recommended hybrid:** layer [B] + a maintained mappings file to expose a curated API (Tier 1); let most mods use the clean API; reserve layer [C] for the surgical internals the API bridge needs.

## Sources

- https://docs.fabricmc.net/ · https://wiki.fabricmc.net/
- https://github.com/FabricMC/fabric-loader · https://github.com/FabricMC/fabric · https://github.com/fabricmc/fabric-loom
- https://github.com/spongepowered/Mixin · https://github.com/2xsaiko/mixin-cheatsheet
- https://emi.dev/blog/mappings-and-maven/ · https://mixin-wiki.readthedocs.io/

# Deobfuscated PolyTrack bundles — the mappings substrate

> Research target: assess the two "deobfuscated" PolyTrack artifacts as the raw material for TSPML's Yarn-style mappings file (stable names → minified locators). This is the most architecture-critical area: it determines whether TSPML's central "mappings moat" is viable.

## TL;DR

There are **two** distinct "deobfuscated" artifacts, and they differ sharply. **`cwcinc/polytrack-0.6.0-deobfuscated` is the genuinely useful one** — a near-complete, runnable dump of the shipped 0.6.0 build with **partial human renaming** (~100 stable names: `VisualCar`, `PartObject`, `Controls`, `createCar`, `controlCar`, `getCarState`, `wheelSuspensionLength`, `checkpointOrder`, `createMultiplayerHostWebSocket`…). **`polytrackmods/PolyDeobfuscated` is nearly useless** — just the raw minified bundle (every class still mangled except `Block`); it was **archived/dead** on 2025-10-07. **Neither is produced by, or references, an automated deobfuscator** — renaming is entirely manual and incomplete, so **neither can be auto-regenerated** on a game update. Crucially, **PML does not build against deobfuscated names at all** — it targets mangled names + raw substring tokens. This is the exact gap TSPML's mappings file fills.

## What they are

| | `cwcinc/polytrack-0.6.0-deobfuscated` | `polytrackmods/PolyDeobfuscated` |
|---|---|---|
| State | Active-ish (3★, 8 forks), runnable Electron/web/Android snapshot | **Archived 2025-10-07**, reference-only |
| Files | full build: `main/admin/editor/garage/simulation_worker/verifier/error_screen/haptics/SQLite.bundle.js`, `index.html`, `electron/`, `polytrack_physics.wasm`, assets | just `main.bundle.js` + `simulation_worker.bundle.js` next to a raw `polytrack/` dir |
| Renaming | **Partial** — ~100 high-level names renamed; most classes still mangled | **Essentially none** — only `class Block` named |
| Target version | **0.6.0** (beta 7) | 0.6.0 |
| Deobfuscation tooling | **None** (only the original build toolchain: webpack 5, ts-loader, emcc/Emscripten, Electron, Capacitor, Jest) | **None** (manual "VSCode rename + Prettier" workflow, abandoned) |

## Version pinning & drift

Both target **0.6.0**; the live game is **0.6.2** — so both are already 1–2 point releases behind. PolyTrack is webpack-bundled and terser-mangled, so **mangled names reshuffle every build**, and webpack even **re-chunked** the bundle at 0.6.0 (editor/garage split into separate chunks). A symbol map pinned to 0.6.0 will **not** match 0.6.1/0.6.2 byte-for-byte. (No public 0.6.1/0.6.2 deobfuscated bundle exists; per-build drift could not be *measured* directly — only reasoned from webpack/terser behavior. **Quantifying that drift is the M1 go/no-go spike**.)

## How produced — manual, not automated (critical for update resilience)

`polytrackmods/PolyDeobfuscated` prescribes a manual workflow ("use the VSCode renaming tool to rename the obfuscated variables" → `npx prettier --write .`, with Mergiraf only to merge multi-contributor renames) and barely started. `cwcinc` ships no deobfuscation tooling at all. **Neither bundles or references webcrack, wakaru, js-deobfuscator, or a custom AST pass.** Consequence: TSPML **cannot auto-regenerate mappings from these repos** — a mappings pipeline must be built separately (see [mappings-system.md](../design/mappings-system.md)).

## Concrete stable symbols (from `cwcinc`) — candidate TSPML hook points

These are the seed of the canonical stable namespace. (Some may be Three.js/library identifiers mis-grouped; instance-vs-static membership is partially inferred. Verify before binding.)

- **Car / physics state:** `VisualCar` (class; statics incl. `detectorBoxCenter`, `massOffset`, `suspensionResetLengthFront/Rear`); `createCar`, `deleteCar`, `updateCar`, `controlCar`, `getCarState`, `setCarState`, `getCarStyle`, `setCarStyle`, `getChassisMatrix`, `carStateBuffers`, `bufferedCarStates`, `carRecording`, `carColors`, `sendCarUpdate`, `sendCarReset`.
- **Wheels/suspension:** `wheelContact`, `wheelDeltaRotation`, `wheelSkidInfo`, `wheelSuspensionLength`, `wheelSuspensionVelocity`, `suspension`.
- **Tracks/parts:** `PartObject` (class); `getTrackData`, `getTrackByName`, `getNextOfficialTrack`, `getAllCustomTrackNames`, `saveCustomTrack`, `deleteCustomTrack`, `addCustomTracksChangedListener`, `trackData`, `trackParts`, `trackPartData`, `trackName`, `trackMetadata`, `getPhysicsParts`, `rotatePartGridPosition`.
- **Checkpoints:** `checkpoint`, `checkpoints`, `checkpointOrder`, `checkpointPartIds`, `checkpointPositions`, `checkpointTimes`, `getCheckpoints`, `getNextCheckpointIndex`, `getTotalNumberOfCheckpointIndices`, `hasCheckpointToRespawnAt`.
- **Records/verify:** `getFinishTime`, `getRecordTime`, `getLeaderboard`, `submitLeaderboard`, `saveRecord`, `setRecord`, `verifyRecordings`, `testDeterminism`, `formatTimeString`.
- **Multiplayer/net:** `createMultiplayerHostWebSocket`, `createMultiplayerJoinWebSocket`, `createInvite`, `resetInvite`, `getPlayers`, `getConnectingPlayers`, `getMaxPlayers`.
- **Profile/UI:** `saveUserProfile`, `submitUserProfile`, `syncUserProfile`, `saveUserProfileSlot`, `saveUnlockedCarStyles`.
- **Rendering/env:** `addToRenderList`, `addLayerUpdate`, `cameraAutoUpdate`, `SunDirection` (class), CSS subsystems (`.speedometer`, `.time-bar`, `.input-visualizer`, `.editor`, `.customization`, `.pause-screen`).
- **Physics worker protocol (`postMessage` string keys — very stable):** `"createCarModel"`, `"updateCarModel"`, `"deleteCarModel"`, `"initializeCarCollisionShape"`, `"testDeterminism"`. (The Bullet core itself is opaque `polytrack_physics.wasm`; only the JS glue is mappable.)
- **In-bundle library code (named, not game code):** Three.js (~r174/r181), `js-sha256`, a WASM `fastMath` module, webpack CSS-loader modules.

## PML does not use deobfuscated names

PML re-hosts the game and its Mixin API takes `scope`/`path` that are the **actual mangled names** from the bundle plus raw substring `token`s. So the modding scene currently codes against **mangled names + fragile token anchors** — there is **no stable mod-facing API surface** for game internals. That is exactly the gap a mappings file fills.

## The mappings strategy — feasible and high-value, but not free

A maintained, per-PolyTrack-build symbol map is the single most leveraged thing TSPML can provide, because the ecosystem has **nothing** equivalent today. Feasibility: `cwcinc` already seeds ~100 stable names. Obstacles + mitigations are worked out in [mappings-system.md](../design/mappings-system.md); the headline risk is that the **auto-regeneration pipeline has never been validated** against a real version bump — that is the **M1 go/no-go spike**.

## License / provenance / legal posture

Both repos redistribute Kodub's compiled/decompiled code with **no license file**. `polytrackmods/PolyDeobfuscated` claims "licensed under the original PolyTrack license" without naming it; PolyTrack is a commercial free-to-play game. **TSPML ships ONLY the map (metadata)** — never the deobfuscated source or the game bundle — applied against the user's own live game copy. This mirrors how Minecraft mapping projects (Yarn/Mojang mappings) distribute mapping data, not the game. Treat `cwcinc` as a **one-time bootstrap only**; commit to regenerating the canonical map from the auto-pipeline against the current live build, and mirror/fork the seed internally so an upstream deletion does not erase the namespace basis.

## Sources

- https://github.com/cwcinc/polytrack-0.6.0-deobfuscated
- https://github.com/polytrackmods/PolyDeobfuscated
- https://www.npmjs.com/package/webcrack · https://wakaru.vercel.app/
- https://www.kodub.com/updates · https://kodub.itch.io/polytrack/devlog/1539941/polytrack-062-bug-fixes

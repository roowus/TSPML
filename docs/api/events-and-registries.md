# Events & registries (Tier 1)

> The stable API surface most mods use — an `EventEmitter` + namespaced registries wired by the loader-owned bridge. Status: **M0 sketch**; signatures finalize in M4 when the bridge lands. Grounded in real deobfuscated symbols (see [deobfuscated-bundles.md](../research/deobfuscated-bundles.md)).

## Lifecycle (on the `api` object)

```ts
api.events.on('loader.preInit',  (api) => {});   // before any game code; only place for global hooks
api.events.on('loader.init',     (api) => {});
api.events.on('loader.ready',    () => {});       // main menu visible
api.events.on('loader.onUnload', () => {});       // cleanup (fixes PML's missing-cleanup bug)
```

## Game events

```ts
// physics (execute INSIDE the sim-worker; see hook-system.md)
api.events.on('physics.preStep',  (dt) => {});
api.events.on('physics.postStep', (dt) => {});

// render (Three.js render loop)
api.events.on('render.preRender',  (scene, camera) => {});
api.events.on('render.postRender', (scene, camera) => {});

// tracks
api.events.on('track.beforeLoad', (trackId) => {});
api.events.on('track.afterLoad',  (trackId) => {});
api.events.on('track.unload',     (trackId) => {});

// car
api.events.on('car.created',     (car) => {});
api.events.on('car.stateUpdate',  (state) => {});
api.events.on('car.styleChanged', (car) => {});

// checkpoints / race
api.events.on('checkpoint.passed',  (index) => {});
api.events.on('checkpoint.respawn',  (index) => {});
api.events.on('race.started',  () => {});
api.events.on('race.finished', (time) => {});

// input
api.events.on('input.keyDown', (e) => {});
api.events.on('input.keyUp',   (e) => {});

// ui
api.events.on('ui.render', () => {});

// network (capability-gated)
api.events.on('network.message',    (msg) => {});
api.events.on('network.connect',    () => {});
api.events.on('network.disconnect', () => {});
```

`on/off` rebuild an array-backed invoker (Fabric `ArrayBackedEvent`) — lock-free, hot-path fast.

## Registries (Fabric Registry analog)

```ts
api.blocks.registerCategory(id, defaultId);
api.blocks.registerModel(url);                 // .glb, solid colors first (textures on roadmap)
api.blocks.registerBlock(id, categoryId, opts);

api.cars.registerCarStyle(id, style);

api.audio.registerSound(name, urls);           // absolute URLs
api.audio.playSound(name, volume);

api.tracks.register(id, data);
api.tracks.override(id, data);

api.ui.addWidget(id, { render, mount, unmount });

api.keybinds.register(name, id, defaultBind, cb);
api.settings.registerCategory(name);
api.settings.register(name, id, type, defaultOption, options?); // type: 'boolean' | 'slider' | 'custom'
api.settings.getSetting(id);                   // returns TYPED value (fixes PML's always-string wart)
```

## Capability scoping

The `api` object is scoped to the mod's declared `capabilities`. Calling a registry/event outside a declared capability throws a clear error at bind time. (Capability declarations are **consented-advisory** — see [safety-and-fairness.md](../design/safety-and-fairness.md).)

> Need deeper control than events/registries expose? Use the [mixin escape hatch](./mixin-reference.md).

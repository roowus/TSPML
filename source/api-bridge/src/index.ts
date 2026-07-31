/**
 * @tspml/api-bridge — loader-owned runtime wiring the stable event/registry API
 * surface to real PolyTrack internals. The only layer besides `@tspml/mappings`
 * that is version-coupled to a game build.
 *
 * M4 slice 1 ships the Tier-1 event bus (`EventBus`). Game-wiring transforms
 * (e.g. the `controlCar` → `car.control` hook) and registries follow.
 */
export { EventBus } from './event-bus.js';
export type { EventBusOptions } from './event-bus.js';

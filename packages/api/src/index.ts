/**
 * @tspml/api — published TypeScript type definitions for the stable TSPML
 * surface. Zero runtime: mods import only types from here (autocomplete +
 * safety against stable names), and the loader supplies the runtime via
 * `@tspml/api-bridge`.
 */

export type {
  CarControlState,
  CarCreatedInfo,
  CarRef,
  CheckpointInfo,
  RaceFinishInfo,
  TspmlEventEmitter,
  TspmlEventMap,
  TspmlEventSubscriber,
  TspmlListener,
} from './events.js';

export type { KeybindBinding, KeybindsRegistry } from './keybinds.js';

export type {
  AudioRegisterFailure,
  AudioRegisterResult,
  AudioRegistration,
  AudioRegistry,
  BuiltinAudioKey,
  RegisteredAudio,
} from './audio.js';

export type {
  RegisteredTrack,
  TrackRegisterFailure,
  TrackRegisterResult,
  TrackRegistration,
  TracksRegistry,
} from './tracks.js';

export type { TspmlApi, TspmlLogger } from './api.js';

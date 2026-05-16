/**
 * Car State Parser
 * Decodes the 227-byte car state buffer from PolyTrack's simulation worker
 *
 * NOTE: Structure is partially reverse-engineered. Some fields may be incorrect.
 * The actual binary format differs from the TypeScript CarState interface.
 */

// Car state structure based on CarState interface from PlayerAPI.ts
export interface ParsedCarState {
  // Bytes 0-3: frames (uint32) - CONFIRMED
  frames: number;
  // Bytes 4-7: speedKmh (float32) - CONFIRMED
  speedKmh: number;
  // Bytes 8-23: Unknown structure (may have mixed types)
  // Bytes 8-11: hasStarted (uncertain - large uint32 value)
  hasStarted: boolean;
  // Bytes 12-15: finishFrames (uncertain)
  finishFrames: number | null;
  // Bytes 16-19: nextCheckpointIndex (uncertain - large uint32 value)
  nextCheckpointIndex: number;
  // Bytes 20-23: hasCheckpointToRespawnAt (uncertain - large uint32 value)
  hasCheckpointToRespawnAt: boolean;
  // Bytes 24-34: Unknown (11 bytes)
  unknown1: Uint8Array;
  // Position (at non-aligned offset) - PARTIAL
  position: { x: number; y: number; z: number };
  // Quaternion (at non-aligned offset) - PARTIAL
  quaternion: { x: number; y: number; z: number; w: number };
  // Additional fields...
}

/**
 * Parse a 227-byte car state buffer
 * @param buffer Uint8Array of exactly 227 bytes
 * @returns Parsed car state object
 */
export function parseCarState(buffer: Uint8Array): ParsedCarState {
  if (buffer.length !== 227) {
    throw new Error(`Invalid car state buffer length: ${buffer.length}, expected 227`);
  }

  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  // Helper to read at specific offset
  const getUint32 = (offset: number) => view.getUint32(offset, true);
  const getFloat32 = (offset: number) => view.getFloat32(offset, true);

  // Parse header (offsets 0-23)
  const frames = getUint32(0);
  const speedKmh = getFloat32(4);
  const hasStartedFlag = getUint32(8) !== 0;
  const finishFramesRaw = getUint32(12);
  const finishFrames = finishFramesRaw === 0 ? null : finishFramesRaw;
  const nextCheckpointIndex = getUint32(16);
  const hasCheckpointToRespawnAt = getUint32(20) !== 0;

  // Unknown bytes 24-34 (11 bytes)
  const unknown1 = buffer.slice(24, 35);

  // Position at offsets 35-46 (12 bytes, 3 floats)
  // NOTE: These offsets may be incorrect - position.x shows invalid values
  const posX = getFloat32(35);
  const posY = getFloat32(39);
  const posZ = getFloat32(43);

  // Quaternion at offsets 47-62 (16 bytes, 4 floats)
  // NOTE: Quaternion.w at offset 59 is confirmed as 1.0
  // But x,y,z values (55, 20, 0) don't look like valid quaternion components
  // This might be Euler angles in degrees or a different format
  const quatX = getFloat32(47);
  const quatY = getFloat32(51);
  const quatZ = getFloat32(55);
  const quatW = getFloat32(59);

  return {
    frames,
    speedKmh,
    hasStarted: hasStartedFlag,
    finishFrames,
    nextCheckpointIndex,
    hasCheckpointToRespawnAt,
    unknown1,
    position: { x: posX, y: posY, z: posZ },
    quaternion: { x: quatX, y: quatY, z: quatZ, w: quatW },
  };
}

/**
 * Parse hex string car state (for debugging)
 */
export function parseCarStateFromHex(hex: string): ParsedCarState {
  // Remove whitespace and convert to bytes
  const cleanHex = hex.replace(/\s+/g, '');
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.substr(i * 2, 2), 16);
  }
  return parseCarState(bytes);
}

/**
 * Format car state for display
 */
export function formatCarState(state: ParsedCarState): string {
  return `CarState {
  frames: ${state.frames}
  speed: ${state.speedKmh.toFixed(2)} km/h
  started: ${state.hasStarted}
  checkpoint: ${state.nextCheckpointIndex}
  position: (${state.position.x.toFixed(2)}, ${state.position.y.toFixed(2)}, ${state.position.z.toFixed(2)})
  rotation: (${state.quaternion.x.toFixed(3)}, ${state.quaternion.y.toFixed(3)}, ${state.quaternion.z.toFixed(3)}, ${state.quaternion.w.toFixed(3)})
}`;
}

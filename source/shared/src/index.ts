/**
 * @tspml/shared — what every delivery surface injects into the game.
 *
 * Two halves, both loader-owned and deliberately surface-agnostic:
 *
 * 1. {@link BRIDGE_PATCHES} — the Tier-1 bridge patches (badge + 6 events) plus the
 *    custom-track capture patches. A surface feeds these to `@tspml/transform`.
 * 2. {@link EARLY_CAPTURE_STUB} — the pre-bridge shim a surface injects into the
 *    game's HTML, without which the codec capture is silently dropped.
 *
 * What does NOT belong here: anything surface-specific. The portal's mappings
 * `{symbol}` resolution and sha256 hash-gate, the harness's Vite middleware, the
 * extension's content-script plumbing all stay in their own packages. The test is
 * whether the code would be identical in all three.
 */
export {
  BRIDGE_PATCHES,
  TIER1_BRIDGE_PATCHES,
  TRACK_CAPTURE_PATCHES,
} from "./bridge-patches.js";
export {
  EARLY_CAPTURE_KEY,
  EARLY_CAPTURE_SCRIPT_TAG,
  EARLY_CAPTURE_STUB,
  readEarlyCaptures,
} from "./early-capture.js";
export type { EarlyCaptures } from "./early-capture.js";

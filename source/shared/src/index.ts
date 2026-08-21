/**
 * @tspml/shared — what every delivery surface injects into the game.
 *
 * Two halves, both loader-owned and deliberately surface-agnostic:
 *
 * 1. {@link BRIDGE_PATCHES} — the Tier-1 bridge patches (badge + 6 events) plus the
 *    registry capture patches (custom tracks + audio). A surface feeds these to
 *    `@tspml/transform`.
 * 2. {@link EARLY_CAPTURE_STUB} — the pre-bridge shim a surface injects into the
 *    game's HTML, without which the codec capture is silently dropped.
 * 3. {@link TSPML_LOADER_VERSION} / {@link TSPML_API_VERSION} — what TSPML reports
 *    about itself when a mod declares `depends` on `tspml` / `tspml-api` (#73).
 * 4. {@link headerDetail} — the `x-tspml-detail` transliteration every proxying
 *    surface needs, because a header value cannot hold the prose the details are
 *    written in and the throw is an empty 500.
 *
 * What does NOT belong here: anything surface-specific. The portal's mappings
 * `{symbol}` resolution and sha256 hash-gate, the harness's Vite middleware, the
 * extension's content-script plumbing all stay in their own packages. The test is
 * whether the code would be identical in all three.
 */
export {
  BRIDGE_PATCHES,
  CAR_CONTROLLER_BINDINGS,
  REGISTRY_CAPTURE_PATCHES,
  TIER1_BRIDGE_PATCHES,
} from "./bridge-patches.js";
export {
  EARLY_CAPTURE_KEY,
  EARLY_CAPTURE_SCRIPT_TAG,
  EARLY_CAPTURE_STUB,
  readEarlyCaptures,
} from "./early-capture.js";
export type { EarlyCaptures } from "./early-capture.js";
export { HEADER_DETAIL_CAP, headerDetail, toHeaderAscii } from "./detail-header.js";
export { TSPML_API_VERSION, TSPML_LOADER_VERSION } from "./versions.js";

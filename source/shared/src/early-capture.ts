/**
 * The pre-bridge early-capture stub — the second half of what a delivery surface
 * must inject, and the reason `api.tracks` is not simply "apply the patches".
 *
 * ## The bug this exists to prevent
 *
 * Capture patches (#12) run wherever their target module runs, and the track
 * CODEC's module factory runs during BUNDLE INIT — before the host page's `load`
 * handler has installed the real `window.__tspml`. Without this stub that capture
 * hits an absent bridge and is silently dropped, while the track MANAGER (captured
 * much later, when the game builds its track-selection menu) arrives fine. The
 * registry then never attaches, and the half-success is what makes the failure so
 * puzzling to debug.
 *
 * So: stand up a minimal `__tspml` early whose capture functions only RECORD, then
 * have the host replay what it recorded when it installs the real bridge — see
 * {@link EarlyCaptures} and `replayEarlyCaptures`.
 *
 * Both surfaces host the game in a SAME-ORIGIN frame (portal: the proxy under
 * `/api/proxy/`; harness: `/game/`), so the host reads this object off the frame's
 * window directly. A cross-origin surface — the extension ([#8]) — would need a
 * postMessage hop instead.
 *
 * [#8]: https://github.com/roowus/TSPML/issues/8
 */

/** The global the stub records into, read back by the host. */
export const EARLY_CAPTURE_KEY = "__tspmlEarly";

/**
 * What {@link EARLY_CAPTURE_STUB} records. Generic over the two game objects so
 * this package stays dependency-light: consumers instantiate it with the
 * `GameTrackManager` / `GameTrackCodec` structural types from `@tspml/api-bridge`.
 */
export interface EarlyCaptures<TManager = unknown, TCodec = unknown> {
  manager: TManager | null;
  codec: TCodec | null;
}

/**
 * Inject this ahead of the game's own scripts (i.e. into `<head>`, before the
 * deferred bundles). Guarded with `if (!…)` on each capture function so that a
 * surface which somehow installs its real bridge first still wins.
 */
export const EARLY_CAPTURE_STUB = `
(function () {
  var early = { manager: null, codec: null };
  window.${EARLY_CAPTURE_KEY} = early;
  window.__tspml = window.__tspml || {};
  if (!window.__tspml.captureTrackManager)
    window.__tspml.captureTrackManager = function (m) { early.manager = m; };
  if (!window.__tspml.captureTrackCodec)
    window.__tspml.captureTrackCodec = function (c) { early.codec = c; };
})();
`.trim();

/** Ready to splice into an HTML rewrite. */
export const EARLY_CAPTURE_SCRIPT_TAG = `<script>${EARLY_CAPTURE_STUB}</script>`;

/**
 * Read back anything the stub captured before the real bridge existed.
 *
 * Call this from the host's frame-`load` handler, AFTER assigning the real
 * `window.__tspml`, and fold the result into whatever the live capture callbacks
 * write to. Returns nulls when nothing was captured early (or when the stub was
 * never injected), so the caller can `??` it against its own state.
 */
export function readEarlyCaptures<TManager = unknown, TCodec = unknown>(
  frameWindow: unknown,
): EarlyCaptures<TManager, TCodec> {
  const early = (frameWindow as Record<string, unknown> | null | undefined)?.[
    EARLY_CAPTURE_KEY
  ] as EarlyCaptures<TManager, TCodec> | undefined;
  return { manager: early?.manager ?? null, codec: early?.codec ?? null };
}

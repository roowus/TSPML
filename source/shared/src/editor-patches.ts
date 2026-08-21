/**
 * The track-editor patches (#87 Phase C) — the first loader-owned patches that
 * target a CHUNK rather than `main.bundle.js`.
 *
 * The editor is not in the main bundle. It is webpack chunk 112, fetched on
 * demand when the player opens it, and until #98 made chunks transform surfaces
 * nothing in here could be anchored at all. These patches are what give chunk
 * 112 a non-empty base patch set.
 *
 * ## What this exposes, and what it deliberately does not
 *
 * Two captures, because the editor arrives in two pieces.
 * `window.__tspml.captureTrackEditor` receives a small accessor object built at
 * module scope, and `window.__tspml.captureTrackEditorInstance` receives the live
 * editor plus its new open/closed state from the class's own lifecycle methods.
 * The portal joins them into `api.editor`. No game behaviour changes: every
 * function here READS the editor's own state or calls the editor's own methods,
 * so a mis-target degrades to "the capture never happens" and `api.editor`
 * reports itself unavailable.
 *
 * ## Why a `factory` selector and not `method: constructor`
 *
 * Module 7112 contains **10 constructors** and the locator takes the FIRST one
 * it finds in source order (`locators.ts`). The first belongs to a resource
 * loader at offset 751; the editor class sits at 71,759. A `constructor`
 * selector would therefore patch a completely unrelated class *and report
 * success*, which is the silent mis-target the mappings system exists to
 * prevent. The factory selector injects at module scope instead, which is also
 * the only scope from which the bindings below are visible.
 *
 * ## The bindings
 *
 * Like {@link CAR_CONTROLLER_BINDINGS} in bridge-patches.ts, these are
 * module-scope WeakMaps, not parameters, so the #24 ordinal placeholders cannot
 * name them. They are hash-gate-protected 0.6.2 specifics centralized in one
 * constant.
 *
 * The scavenging spike originally recorded these as ES private fields that "no
 * inject we can write today reaches". That is true of the SOURCE and false of
 * the SHIPPED bundle: TypeScript downlevels `#private` to module-scope WeakMaps,
 * and `(0,i.gn)(this, wn, "f")` is its accessor helper. Same situation #10 hit
 * in the car-controller module. The correction is recorded in
 * docs/research/editor-api-scavenging.md.
 */
import type { Patch } from "@tspml/transform";

/**
 * The module-scope WeakMaps the editor keeps its state in (chunk 112, module 7112).
 *
 * Read off the shipped 0.6.2 chunk. Every one is `X = new WeakMap()` in a flat
 * declaration block at module scope, so a module-scope inject can name them.
 *
 * ⚠️ Minified identifiers, sound only under the chunk's own hash gate
 * (`chunks["112"].hash`, checked independently of the main bundle's pin).
 */
export const EDITOR_BINDINGS = {
  /** WeakMap<editor, Track> — the shared Track instance the editor mutates. */
  track: "jt",
  /** WeakMap<editor, Batch[]> — the undo stack. `{added, removed}` entries. */
  undoStack: "wn",
  /** WeakMap<editor, Batch[]> — the redo stack. Cleared by any new edit. */
  redoStack: "bn",
  /** WeakMap<editor, HTMLButtonElement> — the undo button. */
  undoButton: "ge",
  /** WeakMap<editor, HTMLButtonElement> — the redo button. */
  redoButton: "fe",
} as const;

/**
 * A guarded read of a module-scope WeakMap binding: `null` on ANY failure.
 *
 * `typeof` rather than truthiness because a RENAMED binding is a ReferenceError
 * in module scope, not `undefined` — the same trap {@link READ_BINDING} in
 * bridge-patches.ts documents. Every failure degrades to `null` so a shape change
 * disables the feature instead of corrupting the player's track.
 */
const READ = (binding: string, receiver: string): string =>
  `(function(__e){ try { return (typeof ${binding} !== "undefined" && ${binding} && typeof ${binding}.get === "function") ? ${binding}.get(__e) : null; } catch (_x) { return null; } })(${receiver})`;

/**
 * Commit one `{added, removed}` batch to the editor's undo stack.
 *
 * This is the game's OWN four-step idiom, measured at three edit sites in the
 * chunk (box-delete, stamp/paste, drag-place) and reproduced exactly:
 *
 * ```js
 * undo.push(batch);        // 1. record
 * redo.length = 0;         // 2. any new edit invalidates the redo branch
 * undoBtn.disabled = undo.length == 0;   // 3.
 * redoBtn.disabled = redo.length == 0;   // 4.
 * ```
 *
 * Steps 3 and 4 are not cosmetic and are the ones an implementation drops by
 * accident. Button state is DERIVED, recomputed from stack length at ten sites
 * in the chunk rather than tracked. A batch pushed without step 3 leaves a
 * working undo behind a greyed-out button, which reads to the player as "the
 * insert is not undoable" — strictly worse than not integrating with undo at
 * all, because it looks like a bug in the game. Step 4 is the mirror image: an
 * insert diverges from any redo branch, so offering to re-apply it is wrong.
 *
 * The buttons are optional on purpose: if only the button bindings drift, the
 * batch still lands and undo still works. Losing a button refresh is a cosmetic
 * failure and must not cost the player their undo history.
 */
const COMMIT_BATCH = (editor: string, batch: string): string => {
  const { undoStack, redoStack, undoButton, redoButton } = EDITOR_BINDINGS;
  return (
    `(function(__e, __b){` +
    ` var __u = ${READ(undoStack, "__e")};` +
    ` if (!__u || typeof __u.push !== "function") return false;` +
    ` __u.push(__b);` +
    ` var __r = ${READ(redoStack, "__e")};` +
    ` if (__r) { try { __r.length = 0; } catch (_x) {} }` +
    ` try { var __ub = ${READ(undoButton, "__e")}; if (__ub) __ub.disabled = __u.length == 0; } catch (_x) {}` +
    ` try { var __rb = ${READ(redoButton, "__e")}; if (__rb) __rb.disabled = !__r || __r.length == 0; } catch (_x) {}` +
    ` return true; })(${editor}, ${batch})`
  );
};

/**
 * The capture inject, appended to module 7112's factory body.
 *
 * Runs at module scope AFTER the WeakMaps are assigned (offset 38,893) and after
 * the editor class is defined (71,759), so every binding it closes over exists.
 * It does not capture an editor INSTANCE — the factory runs once at chunk load,
 * before any editor is constructed. Instead it hands the portal a set of
 * closures that take the instance as an argument, and the portal gets that
 * instance from the game's own bootstrap (see `captureTrackEditor` wiring).
 *
 * Everything is guarded and every accessor degrades to a null-ish answer rather
 * than a guess: `isOpen()` returning `null` means "cannot tell", which the API
 * surfaces as unavailable, NOT as `false`. Reporting a confident `false` for an
 * editor that is in fact open would make `insertParts` refuse valid work.
 */
const EDITOR_CAPTURE_INJECT = (() => {
  const { track } = EDITOR_BINDINGS;
  return [
    `try {`,
    ` if (typeof window !== "undefined" && window.__tspml && window.__tspml.captureTrackEditor) {`,
    `  window.__tspml.captureTrackEditor({`,
    // The live Track for a given editor instance, or null.
    `   getTrack: function (e) { return ${READ(track, "e")}; },`,
    // The game's own open/closed flag, via its own public method. `null` when the
    // method is missing (shape drift) so the caller can tell "closed" from "unknown".
    `   isOpen: function (e) { try { return (e && typeof e.isEnabled === "function") ? !!e.isEnabled() : null; } catch (_x) { return null; } },`,
    // Commit an undo batch built by the caller. Returns false if the stack is unreachable.
    `   commitBatch: function (e, b) { try { return ${COMMIT_BATCH("e", "b")}; } catch (_x) { return false; } },`,
    // Depth is how a smoke proves a batch actually landed, without reading private state.
    `   undoDepth: function (e) { var u = ${READ(EDITOR_BINDINGS.undoStack, "e")}; return u && typeof u.length === "number" ? u.length : null; }`,
    `  });`,
    ` }`,
    `} catch (_e) {}`,
  ].join("\n");
})();

/**
 * The two literals verified unique to module 7112 (the other 6 modules in the
 * chunk carry neither). `editor-ui` was rejected as an anchor: it matches TWO
 * modules, and the locator would take 6057, the wrong one.
 */
const EDITOR_ANCHOR = {
  literals: ["Part index out of bounds", "How to use the editor"],
  minHits: 2,
} as const;

/**
 * Report the editor's open/closed transition, and hand over the INSTANCE.
 *
 * Spliced into the editor class's own `enable()` / `disable()`, so `this` is the
 * live editor. That is the whole reason these two patches exist: the factory
 * capture above runs once at chunk load, before any editor is constructed, so it
 * can only supply closures. The instance has to come from somewhere the game
 * itself touches, and the lifecycle methods are that place.
 *
 * It also makes the open/closed signal exact rather than polled. The flag these
 * fire alongside is the same one `isEnabled()` reads, so `api.editor.isOpen()` and
 * the `editor.opened`/`editor.closed` events can never disagree.
 *
 * Both fire more than once per session: a test drive calls `disable()` and
 * returning calls `enable()` again. The host de-duplicates edges, so the patch
 * stays a dumb reporter.
 */
const LIFECYCLE_INJECT = (open: boolean): string =>
  `try { if (typeof window !== "undefined" && window.__tspml && window.__tspml.captureTrackEditorInstance) { window.__tspml.captureTrackEditorInstance(this, ${open}); } } catch (_e) {}`;

/**
 * Chunk 112's base patch set. Applied ONLY when the surface being served is
 * `112.bundle.js`; the surface's own hash pin gates it.
 *
 * Three patches, and all three are needed for a working `api.editor`: the factory
 * capture supplies the module-scope accessors, and the two lifecycle patches
 * supply the instance to call them with. Base patches are all-or-nothing, so if
 * any one of them misses the chunk serves vanilla and the API reports itself
 * unavailable — which is the honest outcome, since two out of three is not a
 * usable editor surface.
 *
 * `enable`/`disable` are safe as `method` selectors here even though the locator
 * takes the FIRST match in source order: both were measured to resolve to the
 * editor class in module 7112. `dispose` was NOT — the chunk's first `dispose` in
 * source order belongs to an unrelated resource-cleanup class, so an editor-closed
 * signal built on it would silently attach to the wrong object. That is exactly
 * the mis-target the factory selector avoids for the capture itself.
 */
export const EDITOR_PATCHES: readonly Patch[] = [
  {
    op: "after",
    target: { anchor: EDITOR_ANCHOR, selector: { kind: "factory" } },
    inject: EDITOR_CAPTURE_INJECT,
  },
  {
    op: "after",
    target: { anchor: EDITOR_ANCHOR, selector: { kind: "method", name: "enable" } },
    inject: LIFECYCLE_INJECT(true),
  },
  {
    op: "after",
    target: { anchor: EDITOR_ANCHOR, selector: { kind: "method", name: "disable" } },
    inject: LIFECYCLE_INJECT(false),
  },
];

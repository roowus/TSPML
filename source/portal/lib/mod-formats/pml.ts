/**
 * PolyModLoader (PML) format — DETECTED, not installable.
 *
 * PML is the first PolyTrack mod loader and has the ecosystem to show for it.
 * TSPML intends to run PML mods eventually, natively or through an adapter mod.
 * That work is not done, and this file is deliberately the whole of the PML
 * branch until it is.
 *
 * What it buys today is a named refusal. Without it, pointing the importer at a
 * PML `manifest.json` fails with "the manifest has no 'entrypoint'" — technically
 * true and completely unhelpful, because it describes a missing TSPML field
 * rather than the actual situation: this is a real mod, in a real format, that
 * this loader cannot run yet. A user who reads the honest message knows to look
 * for a TSPML build; a user who reads the other one thinks the mod is broken.
 *
 * When compatibility does land, it replaces the body of `import()` and nothing
 * else in the import path moves. Two facts worth carrying into that work:
 *
 *  - The **walk** is a directory tree: `<mod>/latest.json` maps a game version to
 *    a mod version, `<mod>/<ver>/manifest.json` holds
 *    `{polymod: {name, id, author, targets, main}, dependencies}`, and the code
 *    is at `<mod>/<ver>/<main>.mod.js`. That is why `ModFormat.import` takes a
 *    base URL and may fetch more than once.
 *  - **Mixins are the hard part, and are not translatable in general.** PML
 *    patches by `toString()` + `indexOf(token)` + `eval()` against minified
 *    identifiers; TSPML patches structurally through the mappings file and an
 *    AST. An adapter can plausibly carry lifecycle hooks, settings, keybinds,
 *    and `editorExtras` model/block registration. It must refuse or degrade
 *    `registerMixin`-family calls PER CALL, with the reason, and never abort the
 *    whole mod over one of them. Partial compatibility, labelled honestly, is
 *    the achievable target; implying more than that is worse than shipping less.
 */
import { fail } from '../mod-fetch';
import type { ImportResult, ModFormat } from './types';

export const PML_REFUSAL =
  "this looks like a PolyModLoader mod (its manifest has a 'polymod' key). " +
  'PML mods cannot be installed yet — TSPML compatibility is planned. ' +
  'If the mod has a TSPML build, import that instead.';

export const pmlFormat: ModFormat = {
  id: 'pml',
  import(): Promise<ImportResult> {
    return Promise.resolve(fail(PML_REFUSAL));
  },
};

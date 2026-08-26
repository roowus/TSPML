/**
 * Rewriting a PML mod's module source so it can be imported here.
 *
 * A PML mod is an ES module that begins:
 *
 * ```js
 * import { PolyMod, MixinType } from "./PolyModLoader.js";
 * ```
 *
 * That specifier is relative to the mod's location inside PML's own
 * redistributed game tree. TSPML imports a mod's code from a `blob:` URL, and a
 * relative specifier resolved against a blob URL does not name anything — the
 * import fails before a single line of the mod runs, with a network error that
 * says nothing about why. So the ONE thing this file does is redirect that
 * import at a runtime object we hand in through a global, and it does it by
 * rewriting the import statement rather than by shipping a `PolyModLoader.js`
 * for it to find: a real file at a real URL would be a second, silent way for a
 * mod to reach the adapter, and there would be no place to put the warnings.
 *
 * Everything about this rewrite is deliberately narrow:
 *
 * - **Only PolyModLoader specifiers are redirected.** Any OTHER relative import
 *   is left exactly as written and NAMED in `warnings`, because it will fail at
 *   import time and the author deserves to be told which specifier did it
 *   rather than reading a blob-URL 404.
 * - **Imported names are checked against what the runtime actually provides.**
 *   An unknown name binds to `undefined` (which is what a destructure would do
 *   anyway) and is named in `warnings` — silence there produces a
 *   `X is not a constructor` ten lines later with no hint of the cause.
 * - **Nothing is appended.** The mod's `polyMod` export is read from the module
 *   NAMESPACE by the caller, not by injected code, so `export let polyMod`,
 *   `export const polyMod`, and `export { thing as polyMod }` all work
 *   identically. An appended `export default polyMod` would have quietly missed
 *   the third form.
 *
 * The rewrite is textual and therefore fallible in the ways textual rewrites
 * are: an import statement inside a string literal or a comment would be
 * rewritten too. That is acceptable here and nowhere else — this runs against a
 * mod's own entry file, the damage is confined to that mod, and the alternative
 * (parsing ES modules in the browser to move one statement) buys precision
 * nobody needs at a cost everybody pays.
 */

/** The global the rewritten source reads its runtime from. */
export const PML_RUNTIME_GLOBAL = '__tspmlPmlRuntime';

/** The names {@link createPmlRuntime} actually provides. */
export const PML_RUNTIME_EXPORTS = [
  'PolyMod',
  'MixinType',
  'SettingType',
  'ActivePolyModLoader',
  'PolyModLoader',
] as const;

export interface PmlWrapResult {
  /** The source to hand to `import()`. */
  readonly source: string;
  /** How many PolyModLoader imports were redirected. */
  readonly redirected: number;
  /** Non-fatal facts the author needs (unknown names, unresolvable imports). */
  readonly warnings: readonly string[];
}

/** Matches `import <clause> from "<spec>"` and bare `import "<spec>"`. */
const IMPORT_RE = /(^|\n)([ \t]*)import\s+(?:([\s\S]*?)\s+from\s*)?(['"])([^'"\n]+)\4[ \t]*;?/g;

/** True for the specifiers that mean "PML's loader module". */
function isPolyModLoaderSpecifier(spec: string): boolean {
  return /(^|[/\\])PolyModLoader(\.[cm]?[jt]s)?$/.test(spec);
}

/** True for a specifier that cannot resolve from a blob: URL. */
function isRelativeSpecifier(spec: string): boolean {
  return spec.startsWith('./') || spec.startsWith('../') || spec.startsWith('/');
}

/**
 * The `const …` form of an import clause, or null when the clause is a shape
 * this rewrite does not model.
 *
 * `R` is the runtime expression. Named imports become a destructure so an
 * unknown name is `undefined` rather than a throw; `* as ns` and a default
 * import both become the whole runtime object, since PML's module has no
 * default export and a mod asking for one is already confused.
 */
function clauseToConst(clause: string, R: string, warnings: string[]): string {
  const parts: string[] = [];
  const trimmed = clause.trim();

  const namespace = /^\*\s+as\s+([A-Za-z_$][\w$]*)$/.exec(trimmed);
  if (namespace) return `const ${namespace[1]!} = ${R};`;

  // `Default, { a, b }` / `{ a, b }` / `Default`
  const braceAt = trimmed.indexOf('{');
  const head = (braceAt === -1 ? trimmed : trimmed.slice(0, braceAt)).replace(/,\s*$/, '').trim();
  if (head.length > 0) {
    if (/^[A-Za-z_$][\w$]*$/.test(head)) {
      warnings.push(
        `'${head}' is imported as a default export of PolyModLoader, which has none — it was bound to the whole adapter object`,
      );
      parts.push(`const ${head} = ${R};`);
    } else {
      return '';
    }
  }
  if (braceAt !== -1) {
    const closing = trimmed.lastIndexOf('}');
    const inner = trimmed.slice(braceAt + 1, closing === -1 ? undefined : closing);
    const fields: string[] = [];
    for (const raw of inner.split(',')) {
      const spec = raw.trim();
      if (spec.length === 0) continue;
      const aliased = /^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/.exec(spec);
      const name = aliased ? aliased[1]! : spec;
      const local = aliased ? aliased[2]! : spec;
      if (!/^[A-Za-z_$][\w$]*$/.test(name) || !/^[A-Za-z_$][\w$]*$/.test(local)) return '';
      if (!(PML_RUNTIME_EXPORTS as readonly string[]).includes(name)) {
        warnings.push(
          `the mod imports '${name}' from PolyModLoader, which this adapter does not provide — it is undefined (provided: ${PML_RUNTIME_EXPORTS.join(', ')})`,
        );
      }
      fields.push(name === local ? name : `${name}: ${local}`);
    }
    if (fields.length > 0) parts.push(`const { ${fields.join(', ')} } = ${R};`);
  }
  return parts.join(' ');
}

/**
 * Rewrite `code` so its PolyModLoader import reads from the runtime registered
 * under `key`. Returns the source verbatim (with warnings) when there is
 * nothing to redirect — a mod that reaches the adapter only through the
 * `polyModLoader` global is a shape PML permits and this must not break.
 */
export function buildPmlModuleSource(code: string, key: string): PmlWrapResult {
  const warnings: string[] = [];
  const R = `globalThis[${JSON.stringify(PML_RUNTIME_GLOBAL)}][${JSON.stringify(key)}]`;
  let redirected = 0;

  const source = code.replace(IMPORT_RE, (match, lead: string, indent: string, clause: string | undefined, _q: string, spec: string) => {
    if (isPolyModLoaderSpecifier(spec)) {
      if (clause === undefined) {
        // A side-effect-only `import "./PolyModLoader.js"` imports nothing; the
        // statement can simply go, but say so — it usually means the author
        // expected the import to install a global.
        redirected += 1;
        warnings.push(
          "a side-effect-only import of PolyModLoader was removed — the adapter is reached through the imported names or the `polyModLoader` global, not by importing for effect",
        );
        return `${lead}${indent}/* tspml: PolyModLoader side-effect import removed */`;
      }
      const replacement = clauseToConst(clause, R, warnings);
      if (replacement === '') {
        warnings.push(
          `an import from PolyModLoader used a clause this adapter could not rewrite (\`${clause.trim().slice(0, 60)}\`) — it was left as written and will fail to resolve`,
        );
        return match;
      }
      redirected += 1;
      return `${lead}${indent}${replacement}`;
    }
    if (isRelativeSpecifier(spec)) {
      warnings.push(
        `the mod imports '${spec}', a relative path — mod code is imported from a blob: URL here, so that specifier does not resolve. PML mods are expected to ship as one built file (\`<main>.mod.js\`); bundle this import into it.`,
      );
    }
    return match;
  });

  const prelude =
    redirected > 0
      ? `/* tspml: PML compatibility adapter — imports of PolyModLoader are redirected to ${PML_RUNTIME_GLOBAL}[${JSON.stringify(key)}] */\n`
      : '';
  return { source: prelude + source, redirected, warnings };
}

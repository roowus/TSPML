/**
 * Locators — resolve a stable {@link TargetSpec} to a concrete AST path inside
 * the parsed bundle. Generalizes the spike's `findCarModulePath` (which found
 * the Car module by its TypeScript-enum anchor and then the `controlCar`
 * method by name).
 *
 * Two stages, mirroring the validated selector strategy
 * (docs/research/transform-spike.md):
 *   1. {@link findModulePath} locates the webpack module-map entry whose factory
 *      body contains ≥ `minHits` of the anchor literals (NOT by webpack id).
 *   2. {@link locateTarget} narrows within that module to a method (by preserved
 *      name), a property (by KEY), or the factory itself.
 *
 * Every locator returns a typed {@link Found} | {@link NotFound} — it NEVER
 * throws on a miss. A miss is a normal, reportable outcome (the loader disables
 * that one hook, never boot-aborts — docs/api/mixin-reference.md "Failure
 * behavior").
 */
import type { NodePath } from "@babel/traverse";
import type { File } from "@babel/types";

import { t, traverse } from "./babel.js";
import type { ModuleAnchor, TargetSelector, TargetSpec } from "./types.js";

/** A successfully resolved target. */
export interface Found {
  readonly ok: true;
  /** The resolved AST path (a method, property, or factory node). */
  readonly path: NodePath;
  /** Human-readable target description for logs/reports. */
  readonly desc: string;
}

/** A target that could not be resolved. */
export interface NotFound {
  readonly ok: false;
  readonly reason: string;
}

export type LocateResult = Found | NotFound;

/**
 * Read the "name" of an object key / method key node — identifier `.name` or
 * string-literal `.value`. Returns null for computed/private/computed-numeric
 * keys (we only match on plain preserved names).
 */
function keyName(node: t.Node): string | null {
  if (t.isIdentifier(node)) return node.name;
  if (t.isStringLiteral(node)) return node.value;
  return null;
}

/**
 * Locate the webpack module-map entry (an `ObjectProperty` whose key is the
 * module id and whose value is the factory `(e,t,n)=>{...}`) whose factory body
 * contains at least `minHits` of the anchor literals.
 *
 * A module-map entry is recognized structurally: the property's parent must be
 * an `ObjectExpression` (the webpack module map) and its value an arrow or
 * function expression (the factory). This is exactly the shape validated on the
 * real 0.6.2 bundle in the spike.
 *
 * First match wins (anchors are chosen to be module-unique; on collision the
 * earliest in source order is returned — same as the spike's `path.stop()`).
 * Returns null when no module matches.
 */
export function findModulePath(ast: File, anchor: ModuleAnchor): NodePath | null {
  const want = anchor.literals;
  const minHits = anchor.minHits ?? want.length;
  let found: NodePath | null = null;
  traverse(ast, {
    ObjectProperty(path) {
      if (found) return path.stop();
      const v = path.node.value;
      if (!t.isObjectExpression(path.parent)) return;
      if (!(t.isArrowFunctionExpression(v) || t.isFunctionExpression(v))) return;
      let hits = 0;
      path.traverse({
        StringLiteral(p) {
          if (want.includes(p.node.value)) hits++;
        },
        NumericLiteral(p) {
          if (want.includes(p.node.value)) hits++;
        },
      });
      if (hits >= minHits && hits > 0) {
        found = path;
        path.stop();
      }
    },
  });
  return found;
}

/** Extract a readable module id from the located ObjectProperty key. */
function describeModuleId(propPath: NodePath): string {
  const key = (propPath.node as t.ObjectProperty).key;
  if (t.isNumericLiteral(key)) return String(key.value);
  if (t.isStringLiteral(key)) return key.value;
  if (t.isIdentifier(key)) return key.name;
  return "?";
}

/**
 * Resolve a {@link TargetSpec} to a concrete AST path within `ast`.
 *
 * Stage 1 finds the module by anchor; stage 2 narrows within it according to
 * `selector`. Scoping the secondary search to the located module (via
 * `modulePath.traverse`) is what lets common method/property names like
 * `update` or `version` collide freely elsewhere in the bundle without risk.
 */
export function locateTarget(ast: File, spec: TargetSpec): LocateResult {
  const modulePath = findModulePath(ast, spec.anchor);
  if (!modulePath) {
    return {
      ok: false,
      reason: `module not found by anchor [${spec.anchor.literals.join(", ")}]`,
    };
  }
  const moduleId = describeModuleId(modulePath);
  const sel = spec.selector;

  switch (sel.kind) {
    case "factory": {
      // Return the factory's own path so `around`/`replace` can rebind it.
      const valuePath = modulePath.get("value") as NodePath;
      return {
        ok: true,
        path: valuePath,
        desc: `webpack factory for module ${moduleId}`,
      };
    }

    case "method": {
      // Array holder (not a closure-captured `let`): TS's control-flow analysis
      // does not narrow a `let` that is only assigned inside a traverse callback,
      // so reading it after a truthiness guard resolves to `never`. Collecting
      // into an array sidesteps that cleanly.
      const matched: NodePath[] = [];
      modulePath.traverse({
        ClassMethod(path) {
          if (matched.length) {
            path.stop();
            return;
          }
          if (keyName(path.node.key) === sel.name) {
            matched.push(path);
            path.stop();
          }
        },
        ObjectMethod(path) {
          if (matched.length) {
            path.stop();
            return;
          }
          if (keyName(path.node.key) === sel.name) {
            matched.push(path);
            path.stop();
          }
        },
      });
      if (matched.length === 0) {
        return {
          ok: false,
          reason: `method '${sel.name}' not found in module ${moduleId}`,
        };
      }
      const methodPath = matched[0]!;
      return {
        ok: true,
        path: methodPath,
        desc: `${methodPath.node.type}#${sel.name} (module ${moduleId})`,
      };
    }

    case "property": {
      const matched: NodePath[] = [];
      modulePath.traverse({
        ObjectProperty(path) {
          if (matched.length) {
            path.stop();
            return;
          }
          if (keyName(path.node.key) === sel.key) {
            matched.push(path);
            path.stop();
          }
        },
      });
      if (matched.length === 0) {
        return {
          ok: false,
          reason: `property '${sel.key}' not found in module ${moduleId}`,
        };
      }
      const propPath = matched[0]!;
      return {
        ok: true,
        path: propPath,
        desc: `ObjectProperty#${sel.key} (module ${moduleId})`,
      };
    }

    default: {
      // Exhaustiveness guard — if TargetSelector gains a variant this compiler
      // check fails (TS never), surfacing the missing case at build time.
      const exhaustive: never = sel;
      return { ok: false, reason: `unsupported selector ${(exhaustive as { kind: string }).kind}` };
    }
  }
}

/**
 * Mixin operations as AST transforms (docs/design/hook-system.md Tier-2).
 *
 * Each op takes a RESOLVED target path (located by `./locators.ts`) plus the
 * patch payload, mutates the AST in place, and reports an {@link OpOutcome}.
 * Ops never throw on a miss; they return `{ applied: false, ... }` so the engine
 * can record a per-patch result and keep going (one bad hook never aborts the
 * bundle — docs/api/mixin-reference.md "Failure behavior").
 *
 * `before` / `after` / `around` / `replace` / `modifyArg` / `modifyReturn` all
 * operate on a function-like node (a class/object method, or — for module-load
 * intercept — the webpack factory itself). `around` is uniform across both: it
 * rebinds the original body to `proceed` and substitutes the inject, so
 * `around(factory)` is exactly the spike's module-load HOF wrap (technique [B]).
 * `modifyConstant` operates on an `ObjectProperty` (selected by KEY) and is the
 * spike's `version:"0.6.2"` literal rewrite.
 *
 * Inject payloads are JS SOURCE strings, parsed once with @babel/parser and
 * deep-cloned per insertion site (Babel forbids shared nodes across the tree).
 */
import type { NodePath } from "@babel/traverse";

import { parse, parseExpression, t, traverse } from "./babel.js";
import type { Patch, PatchResult } from "./types.js";

type Reason = NonNullable<PatchResult["reason"]>;

export type OpOutcome =
  | { readonly applied: true; readonly detail: string }
  | { readonly applied: false; readonly reason: Reason; readonly detail: string };

/** Parse a JS source fragment into one or more statements. */
function parseStmts(src: string): { ok: true; stmts: t.Statement[] } | { ok: false; error: string } {
  try {
    const file = parse(src, {
      sourceType: "unambiguous",
      allowReturnOutsideFunction: true,
    });
    return { ok: true, stmts: file.program.body as t.Statement[] };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Parse a JS source fragment into a single expression. */
function parseExpr(src: string): { ok: true; expr: t.Expression } | { ok: false; error: string } {
  try {
    const expr = parseExpression(src, { sourceType: "unambiguous" });
    return { ok: true, expr: expr as unknown as t.Expression };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/**
 * A "function-like" node carrying its own param list + block body — the shape
 * `before`/`after`/`around`/`replace`/`modifyArg`/`modifyReturn` operate on.
 * Covers ClassMethod, ObjectMethod, FunctionExpression, ArrowFunctionExpression
 * (the latter only when it has a block body). `body` is the SAME reference as
 * `node.body`, exposed at the narrower `BlockStatement` type so callers can read
 * `body.body` (statements) without re-narrowing the union member type.
 */
interface FunctionLike {
  node: t.ClassMethod | t.ObjectMethod | t.FunctionExpression | t.ArrowFunctionExpression;
  body: t.BlockStatement;
}

/** Narrow a path to FunctionLike (with a block body), or null. */
function asFunctionLike(path: NodePath): FunctionLike | null {
  const n = path.node;
  if (
    t.isClassMethod(n) ||
    t.isObjectMethod(n) ||
    t.isFunctionExpression(n) ||
    t.isArrowFunctionExpression(n)
  ) {
    const body = n.body;
    if (t.isBlockStatement(body)) return { node: n, body };
  }
  return null;
}

/** Read a key/method name node as a string (identifier name or string value). */
function keyName(node: t.Node): string | null {
  if (t.isIdentifier(node)) return node.name;
  if (t.isStringLiteral(node)) return node.value;
  return null;
}

/** Name of a call callee: bare identifier, or member-expression property. */
function calleeName(call: t.CallExpression): string | null {
  const c = call.callee;
  if (t.isIdentifier(c)) return c.name;
  if (t.isMemberExpression(c) && !c.computed) {
    return keyName(c.property);
  }
  return null;
}

/** Collect own-scope ReturnStatements (skipping nested function bodies). */
function collectOwnReturns(scope: NodePath): NodePath<t.ReturnStatement>[] {
  const out: NodePath<t.ReturnStatement>[] = [];
  scope.traverse({
    Function(path) {
      path.skip();
    },
    ReturnStatement(path) {
      out.push(path as NodePath<t.ReturnStatement>);
    },
  });
  return out;
}

/** Apply a single resolved patch to the AST. */
export function applyOp(path: NodePath, patch: Patch): OpOutcome {
  switch (patch.op) {
    case "before":
      return applyBefore(path, patch.inject);
    case "after":
      return applyAfter(path, patch.inject);
    case "around":
      return applyAround(path, patch.inject, patch.proceedName ?? "proceed");
    case "replace":
      return applyReplace(path, patch.inject);
    case "modifyArg":
      return applyModifyArg(path, patch.callee, patch.index, patch.replaceWith);
    case "modifyReturn":
      return applyModifyReturn(path, patch.wrap);
    case "modifyConstant":
      return applyModifyConstant(path, patch.replaceWith);
    default: {
      const exhaustive: never = patch;
      return {
        applied: false,
        reason: "op-not-applicable",
        detail: `unsupported op ${(exhaustive as { op: string }).op}`,
      };
    }
  }
}

function applyBefore(path: NodePath, inject: string): OpOutcome {
  const fn = asFunctionLike(path);
  if (!fn) return { applied: false, reason: "op-not-applicable", detail: "target is not a function with a block body" };
  const parsed = parseStmts(inject);
  if (!parsed.ok) return { applied: false, reason: "bad-inject-source", detail: parsed.error };
  const bodyPath = path.get("body") as NodePath<t.BlockStatement>;
  // unshiftContainer inserts at index 0; iterate reverse so multi-statement
  // inject preserves source order.
  for (let i = parsed.stmts.length - 1; i >= 0; i--) {
    bodyPath.unshiftContainer("body", parsed.stmts[i]!);
  }
  return { applied: true, detail: `injected ${parsed.stmts.length} stmt(s) at HEAD` };
}

function applyAfter(path: NodePath, inject: string): OpOutcome {
  const fn = asFunctionLike(path);
  if (!fn) return { applied: false, reason: "op-not-applicable", detail: "target is not a function with a block body" };
  const parsed = parseStmts(inject);
  if (!parsed.ok) return { applied: false, reason: "bad-inject-source", detail: parsed.error };
  const bodyPath = path.get("body") as NodePath<t.BlockStatement>;

  const returns = collectOwnReturns(path);
  if (returns.length === 0) {
    // No explicit return: run at the natural exit (end of body).
    for (const s of parsed.stmts) bodyPath.pushContainer("body", s);
    return { applied: true, detail: "injected at end (no explicit return)" };
  }
  for (const r of returns) {
    for (const s of parsed.stmts) r.insertBefore(t.cloneNode(s, true));
  }
  return { applied: true, detail: `injected before ${returns.length} return(s)` };
}

function applyAround(path: NodePath, inject: string, proceedName: string): OpOutcome {
  const fn = asFunctionLike(path);
  if (!fn) return { applied: false, reason: "op-not-applicable", detail: "target is not a function with a block body" };
  const parsed = parseStmts(inject);
  if (!parsed.ok) return { applied: false, reason: "bad-inject-source", detail: parsed.error };

  // Rebind the original body to `proceed` (same params, deep-cloned body). The
  // method/factory keeps its own param list, so the inject (and any callers of
  // `proceed`) can forward them. Uniform across methods AND the webpack factory
  // (around(factory) == the spike's module-load HOF wrap, technique [B]).
  const origParams = fn.node.params.map((p) => t.cloneNode(p, true)) as unknown as t.ArrowFunctionExpression["params"];
  const origBody = fn.body.body.map((s) => t.cloneNode(s, true));
  const proceedDecl = t.variableDeclaration("const", [
    t.variableDeclarator(
      t.identifier(proceedName),
      t.arrowFunctionExpression(origParams, t.blockStatement(origBody)),
    ),
  ]);

  // Mutate the existing body's statement list in place (rather than reassigning
  // `node.body`, which TS rejects across the function-like union — its body
  // field types differ). `fn.body` is the live node-body reference.
  fn.body.body.splice(0, fn.body.body.length, proceedDecl, ...parsed.stmts);
  return {
    applied: true,
    detail: `wrapped body; original bound to \`${proceedName}()\``,
  };
}

function applyReplace(path: NodePath, inject: string): OpOutcome {
  const fn = asFunctionLike(path);
  if (!fn) return { applied: false, reason: "op-not-applicable", detail: "target is not a function with a block body" };
  const parsed = parseStmts(inject);
  if (!parsed.ok) return { applied: false, reason: "bad-inject-source", detail: parsed.error };
  // NOTE: single-winner enforcement is the engine's job (it sees all patches);
  // by the time an op runs, this target has no competing replace. Mutate the
  // body's statement list in place (see applyAround for the union-assign caveat).
  fn.body.body.splice(0, fn.body.body.length, ...parsed.stmts);
  return { applied: true, detail: `replaced body with ${parsed.stmts.length} stmt(s)` };
}

function applyModifyArg(
  path: NodePath,
  callee: string,
  index: number,
  replaceWith: string,
): OpOutcome {
  const fn = asFunctionLike(path);
  if (!fn) return { applied: false, reason: "op-not-applicable", detail: "target is not a function with a block body" };
  const parsed = parseExpr(replaceWith);
  if (!parsed.ok) return { applied: false, reason: "bad-inject-source", detail: parsed.error };

  let replaced = 0;
  path.traverse({
    CallExpression(cp) {
      const args = cp.node.arguments;
      if (calleeName(cp.node) !== callee) return;
      if (index < 0 || index >= args.length) return;
      // Clone per site — Babel forbids a node appearing twice in the tree.
      args[index] = t.cloneNode(parsed.expr, true);
      replaced++;
    },
  });
  if (replaced === 0) {
    return {
      applied: false,
      reason: "op-not-applicable",
      detail: `no call to '${callee}' with an argument at index ${index} in target`,
    };
  }
  return { applied: true, detail: `replaced arg ${index} of '${callee}' in ${replaced} call(s)` };
}

function applyModifyReturn(path: NodePath, wrap: string): OpOutcome {
  const fn = asFunctionLike(path);
  if (!fn) return { applied: false, reason: "op-not-applicable", detail: "target is not a function with a block body" };
  const parsed = parseExpr(wrap);
  if (!parsed.ok) return { applied: false, reason: "bad-inject-source", detail: parsed.error };

  const returns = collectOwnReturns(path);
  let wrapped = 0;
  for (const r of returns) {
    const arg = r.node.argument;
    if (!arg) continue; // bare `return;` — nothing to transform
    // `return X;` -> `return (<wrap>)(X);`  (clone wrap per site)
    r.node.argument = t.callExpression(t.cloneNode(parsed.expr, true), [
      t.cloneNode(arg, true),
    ]);
    wrapped++;
  }
  if (wrapped === 0) {
    return {
      applied: false,
      reason: "op-not-applicable",
      detail: "no return-with-value in target to wrap",
    };
  }
  return { applied: true, detail: `wrapped ${wrapped} return(s)` };
}

function applyModifyConstant(path: NodePath, replaceWith: string): OpOutcome {
  const n = path.node;
  if (!t.isObjectProperty(n)) {
    return {
      applied: false,
      reason: "op-not-applicable",
      detail: "modifyConstant requires a `property` selector target",
    };
  }
  const parsed = parseExpr(replaceWith);
  if (!parsed.ok) return { applied: false, reason: "bad-inject-source", detail: parsed.error };
  const v = n.value;
  let before: string | number | boolean | null = null;
  if (t.isStringLiteral(v) || t.isNumericLiteral(v) || t.isBooleanLiteral(v)) {
    before = v.value;
  }
  n.value = parsed.expr;
  return {
    applied: true,
    detail:
      before === null
        ? "replaced property value"
        : `replaced property value (was ${JSON.stringify(before)})`,
  };
}

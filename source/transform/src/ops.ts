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

/**
 * Parameter-ordinal placeholders (#24).
 *
 * A payload may reference the target function's parameters as
 * `__TSPML_PARAM<n>__` (0-based). At apply time each placeholder is renamed to
 * the located function's ACTUAL nth parameter name, so a payload survives a
 * re-minify that renames every parameter — the fragility #24 is about: bare
 * minified names (`e`, `t`, …) were only sound under the hash gate, and broke
 * on any re-terser of the same game version.
 *
 * Resolution is FAIL-CLOSED with reason `param-unresolvable`: an out-of-range
 * ordinal, a non-identifier parameter (destructuring/rest), or a binding that
 * would SHADOW the resolved name (declared by the payload itself, or by a
 * block around an injection site) fails the patch rather than substituting a
 * reference that silently binds to the wrong variable.
 *
 * Substitution is AST-based (Identifier nodes only) — occurrences inside
 * string literals are deliberately left untouched.
 */
export function paramPlaceholder(ordinal: number): string {
  return `__TSPML_PARAM${ordinal}__`;
}

/** Matches an identifier that is (exactly) a placeholder. */
const PARAM_PLACEHOLDER = /^__TSPML_PARAM(\d+)__$/;
/** Cheap pre-test so placeholder-free payloads skip the substitution pass. */
const HAS_PARAM_PLACEHOLDER = /__TSPML_PARAM\d+__/;

interface PreparedFail {
  readonly ok: false;
  readonly reason: "bad-inject-source" | "param-unresolvable";
  readonly detail: string;
}

/** The target's parameter list, or null when the target has none (modifyConstant). */
type TargetParams = readonly t.Node[] | null;

function resolveParamName(
  params: readonly t.Node[],
  ordinal: number,
): { ok: true; name: string } | PreparedFail {
  const p = params[ordinal];
  if (p === undefined) {
    return {
      ok: false,
      reason: "param-unresolvable",
      detail: `${paramPlaceholder(ordinal)} is out of range — the target declares ${params.length} parameter(s)`,
    };
  }
  if (t.isIdentifier(p)) return { ok: true, name: p.name };
  // `x = default` still has a plain name to resolve to.
  if (t.isAssignmentPattern(p) && t.isIdentifier(p.left)) return { ok: true, name: p.left.name };
  return {
    ok: false,
    reason: "param-unresolvable",
    detail: `the target's parameter ${ordinal} is a ${p.type}, not a plain identifier`,
  };
}

/**
 * Rename every placeholder Identifier in `file` to its resolved parameter
 * name. Reports the set of substituted names so ops can run injection-site
 * shadow checks. Mutates `file` in place; on failure the file must be
 * discarded (some placeholders may already be renamed).
 */
function substitutePlaceholders(
  file: t.File,
  params: TargetParams,
): { ok: true; usedNames: readonly string[] } | PreparedFail {
  // Array holder, not a `let` — TS does not narrow a `let` assigned only
  // inside a traverse callback (same workaround as locators.ts).
  const failures: PreparedFail[] = [];
  const used = new Set<string>();
  traverse(file, {
    Identifier(path) {
      const m = PARAM_PLACEHOLDER.exec(path.node.name);
      if (!m) return;
      if (params === null) {
        failures.push({
          ok: false,
          reason: "param-unresolvable",
          detail: `${path.node.name} used against a target with no parameter list`,
        });
        path.stop();
        return;
      }
      const resolved = resolveParamName(params, Number(m[1]));
      if (!resolved.ok) {
        failures.push(resolved);
        path.stop();
        return;
      }
      // A binding of the same name declared INSIDE the payload would capture
      // the substituted reference — a silently wrong read, not an error.
      // (Scope-aware: a `catch (e)` clause only shadows its own block.)
      if (path.isReferencedIdentifier() && path.scope.hasBinding(resolved.name, true)) {
        failures.push({
          ok: false,
          reason: "param-unresolvable",
          detail: `the payload declares its own '${resolved.name}', which would shadow the target's parameter ${m[1]} — rename the local`,
        });
        path.stop();
        return;
      }
      path.node.name = resolved.name;
      used.add(resolved.name);
    },
  });
  if (failures.length > 0) return failures[0]!;
  return { ok: true, usedNames: [...used] };
}

interface PreparedStmts {
  readonly ok: true;
  readonly stmts: t.Statement[];
  /** Resolved parameter names the payload references (empty when none). */
  readonly usedNames: readonly string[];
}

/** Parse statement source and resolve placeholders against `params`. */
function prepareStmts(src: string, params: TargetParams): PreparedStmts | PreparedFail {
  let file: t.File;
  try {
    file = parse(src, {
      sourceType: "unambiguous",
      allowReturnOutsideFunction: true,
    }) as t.File;
  } catch (err) {
    return { ok: false, reason: "bad-inject-source", detail: (err as Error).message };
  }
  if (HAS_PARAM_PLACEHOLDER.test(src)) {
    const sub = substitutePlaceholders(file, params);
    if (!sub.ok) return sub;
    return { ok: true, stmts: file.program.body as t.Statement[], usedNames: sub.usedNames };
  }
  return { ok: true, stmts: file.program.body as t.Statement[], usedNames: [] };
}

interface PreparedExpr {
  readonly ok: true;
  readonly expr: t.Expression;
  readonly usedNames: readonly string[];
}

/** Parse expression source and resolve placeholders against `params`. */
function prepareExpr(src: string, params: TargetParams): PreparedExpr | PreparedFail {
  let expr: t.Expression;
  try {
    expr = parseExpression(src, { sourceType: "unambiguous" }) as unknown as t.Expression;
  } catch (err) {
    return { ok: false, reason: "bad-inject-source", detail: (err as Error).message };
  }
  if (HAS_PARAM_PLACEHOLDER.test(src)) {
    // Scope analysis needs a full File; wrap the expression, substitute in
    // place, and hand back the (mutated) expression node.
    const file = t.file(t.program([t.expressionStatement(expr)]));
    const sub = substitutePlaceholders(file, params);
    if (!sub.ok) return sub;
    return { ok: true, expr, usedNames: sub.usedNames };
  }
  return { ok: true, expr, usedNames: [] };
}

/**
 * True when `name` read at `site` still resolves to the located function's
 * OWN binding (its parameter). A block between the function head and an
 * injection site can shadow a param (`{ let e = 1; return e; }`); substituting
 * a reference there would silently read the WRONG variable, so the op fails
 * the patch instead. An unresolvable binding (stale scope cache after earlier
 * AST surgery) is treated as visible — the pre-#24 status quo, still guarded
 * by the hash gate and the re-parse gate.
 */
function paramVisibleAt(fnNode: t.Node, site: NodePath, name: string): boolean {
  const binding = site.scope.getBinding(name);
  return binding === undefined || binding.scope.block === fnNode;
}

/** First substituted name shadowed at `site`, or null when all are visible. */
function findShadowedParam(
  fnNode: t.Node,
  site: NodePath,
  usedNames: readonly string[],
): string | null {
  for (const name of usedNames) {
    if (!paramVisibleAt(fnNode, site, name)) return name;
  }
  return null;
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
  const parsed = prepareStmts(inject, fn.node.params);
  if (!parsed.ok) return { applied: false, reason: parsed.reason, detail: parsed.detail };
  const bodyPath = path.get("body") as NodePath<t.BlockStatement>;
  const shadowed = findShadowedParam(fn.node, bodyPath, parsed.usedNames);
  if (shadowed !== null) {
    return {
      applied: false,
      reason: "param-unresolvable",
      detail: `the target's own body shadows parameter '${shadowed}' at the injection site`,
    };
  }
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
  const parsed = prepareStmts(inject, fn.node.params);
  if (!parsed.ok) return { applied: false, reason: parsed.reason, detail: parsed.detail };
  const bodyPath = path.get("body") as NodePath<t.BlockStatement>;

  const returns = collectOwnReturns(path);
  // Shadow check at every injection site BEFORE mutating anything — a patch
  // must apply everywhere or nowhere (a half-applied `after` would fire on
  // some exits only).
  const sites: NodePath[] = returns.length === 0 ? [bodyPath] : returns;
  for (const site of sites) {
    const shadowed = findShadowedParam(fn.node, site, parsed.usedNames);
    if (shadowed !== null) {
      return {
        applied: false,
        reason: "param-unresolvable",
        detail: `a block around a return shadows parameter '${shadowed}' at that injection site`,
      };
    }
  }
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
  // No injection-site shadow check: the new body starts fresh at the function
  // root (the original statements move into `proceed`), so only the payload's
  // own bindings could shadow — and substitutePlaceholders already fails those.
  const parsed = prepareStmts(inject, fn.node.params);
  if (!parsed.ok) return { applied: false, reason: parsed.reason, detail: parsed.detail };

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
  // Like `around`: the replacement body IS the function root, so payload-local
  // shadowing is the only hazard and prepareStmts covers it.
  const parsed = prepareStmts(inject, fn.node.params);
  if (!parsed.ok) return { applied: false, reason: parsed.reason, detail: parsed.detail };
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
  const parsed = prepareExpr(replaceWith, fn.node.params);
  if (!parsed.ok) return { applied: false, reason: parsed.reason, detail: parsed.detail };

  // Collect matching sites first: shadow checks must pass at ALL of them
  // before any is mutated (all-or-nothing, same rationale as applyAfter).
  const sites: NodePath<t.CallExpression>[] = [];
  path.traverse({
    CallExpression(cp) {
      const args = cp.node.arguments;
      if (calleeName(cp.node) !== callee) return;
      if (index < 0 || index >= args.length) return;
      sites.push(cp);
    },
  });
  for (const site of sites) {
    const shadowed = findShadowedParam(fn.node, site, parsed.usedNames);
    if (shadowed !== null) {
      return {
        applied: false,
        reason: "param-unresolvable",
        detail: `a block around a '${callee}' call shadows parameter '${shadowed}' at that site`,
      };
    }
  }
  let replaced = 0;
  for (const cp of sites) {
    // Clone per site — Babel forbids a node appearing twice in the tree.
    cp.node.arguments[index] = t.cloneNode(parsed.expr, true);
    replaced++;
  }
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
  const parsed = prepareExpr(wrap, fn.node.params);
  if (!parsed.ok) return { applied: false, reason: parsed.reason, detail: parsed.detail };

  const returns = collectOwnReturns(path);
  for (const r of returns) {
    if (!r.node.argument) continue;
    const shadowed = findShadowedParam(fn.node, r, parsed.usedNames);
    if (shadowed !== null) {
      return {
        applied: false,
        reason: "param-unresolvable",
        detail: `a block around a return shadows parameter '${shadowed}' at that site`,
      };
    }
  }
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
  // `params: null` — an ObjectProperty has no parameter list, so any
  // placeholder in the payload fails with param-unresolvable.
  const parsed = prepareExpr(replaceWith, null);
  if (!parsed.ok) return { applied: false, reason: parsed.reason, detail: parsed.detail };
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

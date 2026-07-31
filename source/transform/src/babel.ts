/**
 * Centralized Babel imports + the CJS/ESM interop fixup.
 *
 * `@babel/traverse` and `@babel/generator` ship as CommonJS with `__esModule`
 * and a `default` export. Under Node's native ESM the default import is the
 * module *namespace object* (the real function lives on `.default`); under a
 * bundler / vitest interop the default import IS the function. We resolve both
 * shapes so the compiled output runs the same under `node`, vitest, and any
 * bundler. (Mirrors the validated pattern in `./spike.mjs`.)
 *
 * `@babel/parser` and `@babel/types` use plain named exports and need no fixup.
 */
import { parse, parseExpression } from "@babel/parser";
import _traverse from "@babel/traverse";
import _generate from "@babel/generator";
import * as t from "@babel/types";

type TraverseFn = typeof _traverse;
type GenerateFn = typeof _generate;

const traverse: TraverseFn =
  (_traverse as unknown as { default?: TraverseFn }).default ?? _traverse;
const generate: GenerateFn =
  (_generate as unknown as { default?: GenerateFn }).default ?? _generate;

export { parse, parseExpression, traverse, generate, t };

// Type re-exports used across the pipeline.
export type { NodePath, Scope, Visitor } from "@babel/traverse";
export type { GeneratorResult } from "@babel/generator";
export type { File, Node, Statement, Expression } from "@babel/types";
export type { ParseResult, ParserOptions } from "@babel/parser";

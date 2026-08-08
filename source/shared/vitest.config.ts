import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      // Resolve to @tspml/transform's SOURCE, not its `dist/`. The per-car event
      // test (#10) imports the transform engine at RUNTIME, and CI runs
      // `pnpm -r test` BEFORE `pnpm -r build` — so `dist/` does not exist yet and
      // the package entry cannot resolve. That failure passed locally (where a
      // stale `dist/` happened to exist) and went red only on CI, which is the
      // kind of green that means nothing. Aliasing to source removes the build
      // ordering dependency entirely. Type-only imports need no alias.
      "@tspml/transform": path.resolve(here, "../transform/src/index.ts"),
    },
  },
});

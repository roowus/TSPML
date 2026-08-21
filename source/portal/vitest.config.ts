import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
  resolve: {
    alias: {
      // Resolve workspace deps to their SOURCE, not `dist/`. The user-mods test
      // imports lib/mod-loader.ts, which imports @tspml/loader at RUNTIME — and
      // CI runs `pnpm -r test` BEFORE `pnpm -r build`, so its `dist/` does not
      // exist yet and the package entry cannot resolve. Same trap
      // source/shared's config documents (#10): green locally off a stale
      // dist, red only on CI.
      '@tspml/loader': path.resolve(here, '../loader/src/index.ts'),
      // demo-transform.test.ts drives the real engine + resolver; alias the
      // whole runtime chain to source for the same test-before-build reason.
      // (`/maps/*` stays unaliased — it resolves via the package's own
      // `./maps/*` export, which needs no build step.)
      '@tspml/mappings/maps': path.resolve(here, '../mappings/maps'),
      '@tspml/mappings': path.resolve(here, '../mappings/src/index.ts'),
      '@tspml/transform': path.resolve(here, '../transform/src/index.ts'),
      '@tspml/shared': path.resolve(here, '../shared/src/index.ts'),
      // lib/wasm-serve.ts (#43) imports @tspml/wasm at RUNTIME — same
      // test-before-build reason as the rest of this list.
      '@tspml/wasm': path.resolve(here, '../wasm/src/index.ts'),
      '@': here,
    },
  },
});

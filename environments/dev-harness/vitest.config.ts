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
      // Resolve the workspace dep to its SOURCE, not `dist/`. CI runs
      // `pnpm -r test` BEFORE `pnpm -r build`, so `@tspml/shared`'s dist does
      // not exist yet and the package entry cannot resolve. The trap is that it
      // passes locally off a stale dist and fails only on CI — exactly what
      // happened here, and the same one source/portal and source/shared already
      // document (#10).
      '@tspml/shared': path.resolve(here, '../../source/shared/src/index.ts'),
    },
  },
});

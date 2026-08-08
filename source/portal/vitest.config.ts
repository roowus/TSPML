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
      // imports lib/mod-loader.ts, which imports @tspml/loader and the two demo
      // mods at RUNTIME — and CI runs `pnpm -r test` BEFORE `pnpm -r build`, so
      // their `dist/` does not exist yet and the package entries cannot resolve.
      // Same trap source/shared's config documents (#10): green locally off a
      // stale dist, red only on CI. Order matters — string aliases are matched
      // first-wins with prefix semantics, so the `/mod.json` subpaths must come
      // before the bare package names.
      '@tspml/demo-hud/mod.json': path.resolve(
        here,
        '../../environments/demo-mods/example-hud/mod.json',
      ),
      '@tspml/demo-hud': path.resolve(
        here,
        '../../environments/demo-mods/example-hud/src/entrypoint.ts',
      ),
      '@tspml/checkpoint-counter/mod.json': path.resolve(
        here,
        '../../environments/demo-mods/tspml-checkpoint-counter/mod.json',
      ),
      '@tspml/checkpoint-counter': path.resolve(
        here,
        '../../environments/demo-mods/tspml-checkpoint-counter/src/entrypoint.ts',
      ),
      '@tspml/loader': path.resolve(here, '../loader/src/index.ts'),
      '@': here,
    },
  },
});

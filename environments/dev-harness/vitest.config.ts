import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (pkg: string) => path.resolve(here, `../../source/${pkg}/src/index.ts`);

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
  resolve: {
    // Resolve workspace deps to their SOURCE, not `dist/`. CI runs `pnpm -r test`
    // BEFORE `pnpm -r build`, so no dist exists yet and the package entry cannot
    // resolve. The trap is that it passes locally off a stale dist and fails only on
    // CI — the same one source/portal's config documents (#10).
    //
    // The whole TRANSITIVE chain has to be listed, not just the package the test
    // imports: `@tspml/shared` pulls in `@tspml/transform`, which pulls in
    // `@tspml/mappings`. Aliasing only the first link moves the error one package
    // along, which is exactly what happened here — the second CI run failed on
    // transform instead of shared. (`/maps/*` stays unaliased: it resolves via the
    // package's own `./maps/*` export, which needs no build step.)
    alias: {
      '@tspml/shared': src('shared'),
      '@tspml/transform': src('transform'),
      '@tspml/mappings': src('mappings'),
    },
  },
});

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // `src/**/*.test.mjs` keeps the real-bundle spike integration test
    // (spike.test.mjs) discoverable — it self-skips when the gitignored 0.6.2
    // bundle is absent (e.g. on CI).
    include: ['tests/**/*.test.ts', 'src/**/*.test.{ts,mjs}'],
  },
});

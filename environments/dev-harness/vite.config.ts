import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { gameProxyMiddleware } from "./src/game-proxy";

// The dev mod under iteration. Defaults to @tspml/demo-hud's SOURCE entrypoint (not
// its built dist) so Vite serves it as a module and edits hot-reload. Point
// TSPML_DEV_MOD at another mod's entry .ts to iterate on it instead.
const DEV_MOD_DEFAULT = fileURLToPath(
  new URL("../demo-mods/example-hud/src/entrypoint.ts", import.meta.url),
);
const DEV_MOD = process.env.TSPML_DEV_MOD ?? DEV_MOD_DEFAULT;

// The port the harness UI + game proxy live on (5173 by default).
const PORT = Number(process.env.TSPML_DEV_PORT ?? 5173);

export default defineConfig({
  plugins: [
    {
      name: "tspml-game-proxy",
      configureServer(server) {
        // Serve the real, transformed, gate-cleared game under /game/* (no SW needed).
        server.middlewares.use(gameProxyMiddleware(server));
      },
    },
  ],
  server: {
    port: PORT,
    strictPort: true,
  },
  resolve: {
    alias: {
      // Alias the mod to its source so Vite HMRs entrypoint edits (a dist import
      // would be pre-bundled and not hot-reloadable).
      "tspml:dev-mod": DEV_MOD,
    },
  },
  optimizeDeps: {
    // Don't pre-bundle the mod; serve + HMR it from source.
    exclude: ["@tspml/demo-hud"],
  },
});

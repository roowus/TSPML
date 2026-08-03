/// <reference types="vite/client" />

// The dev mod is aliased (vite.config.ts `resolve.alias`) to a mod's SOURCE
// entrypoint so Vite can hot-reload edits. Declare its shape for tsc.
declare module "tspml:dev-mod" {
  import type { ModApi } from "@tspml/loader";
  // A mod entrypoint default-exports a factory that receives the bridge api.
  const factory: (api: ModApi) => unknown;
  export default factory;
}

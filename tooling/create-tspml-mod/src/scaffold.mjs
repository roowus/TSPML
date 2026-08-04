// create-tspml-mod — scaffold a new TSPML mod package.
//
// `scaffoldMod(id, dir)` generates a working starter mod into `dir`, mirroring
// the proven @tspml/demo-hud structure so the output actually loads: a mod.json
// (schemaVersion 1, valid id/targets/entrypoint/mixins), an entrypoint factory
// that subscribes to a Tier-1 event + registers a keybind, a starter mixin
// targeting the stable name `Car`, a tsconfig, and a README.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/** Mod id contract (matches @tspml/loader's ID_PATTERN): lowercase [a-z0-9-]+. */
export const ID_PATTERN = /^[a-z0-9-]+$/;

/** Human title from an id: "my-cool-mod" -> "My Cool Mod". */
export function titleFromId(id) {
  return id
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** The files a scaffolded mod consists of (rel path -> content), as a function of the id. */
export function modFiles(id) {
  const title = titleFromId(id);
  const pkg = {
    name: id,
    version: "0.1.0",
    private: true,
    type: "module",
    description: `${title} — a TSPML mod for PolyTrack.`,
    license: "MIT",
    scripts: { build: "tsc -p tsconfig.json" },
    // NO dependency on @tspml/api. It is not published yet, and `workspace:*`
    // made the very first advertised command fail outside this monorepo:
    //   ERR_PNPM_WORKSPACE_PKG_NOT_FOUND  "@tspml/api@workspace:*" is in the
    //   dependencies but no package named "@tspml/api" is present in the workspace
    // (#19). The starter ships its own `types/tspml-api.d.ts` covering the surface
    // it actually uses, so `pnpm install && pnpm build` works with nothing but
    // typescript. Swap it for the real package when that lands — see the README.
    devDependencies: { typescript: "^5.6.0" },
  };
  const mod = {
    schemaVersion: 1,
    id,
    name: title,
    version: "0.1.0",
    description: `${title} — a TSPML mod.`,
    // Matches where tsc emits: rootDir "." + outDir "dist" puts the compiled
    // entrypoint at dist/src/entrypoint.js.
    entrypoint: "dist/src/entrypoint.js",
    targets: [">=0.6.0 <0.7.0"],
    mixins: [{ config: "mixins.json", environment: "web" }],
    authors: ["your-name"],
    license: "MIT",
  };
  const mixins = {
    $comment: `${title} mixin(s). Target STABLE NAMES (mappings-resolved, fail-closed) or inline anchors. See docs/api/mixin-reference.md.`,
    patches: [
      {
        op: "after",
        symbol: "Car",
        inject: `(function(){try{if(typeof window!=='undefined'){window.__${id}Mixin=true;}}catch(e){}})();`,
      },
    ],
  };
  // A minimal local stand-in for @tspml/api, covering exactly the surface this
  // starter touches. Not a copy of the whole package — a copy would rot silently
  // and would be a second definition of the API to keep in sync. The member NAMES
  // here are checked against the real TspmlApi by a test in this package, so a
  // rename upstream fails CI rather than shipping a broken scaffold.
  const apiTypes = `// Local type stand-in for '@tspml/api', which is not published to npm yet.
//
// It declares only the members this starter uses. When @tspml/api ships:
//
//   pnpm add -D @tspml/api
//   # then delete this file and change the import in src/entrypoint.ts to:
//   #   import type { TspmlApi } from '@tspml/api';
//
// The full surface (events, keybinds, tracks, audio, logger, version) is
// documented at https://github.com/roowus/TSPML/tree/main/docs/api

/** Console-shaped logger handed to every mod. */
export type TspmlLogger = Pick<Console, 'log' | 'error' | 'warn' | 'info' | 'debug'>;

export interface KeybindBinding {
  readonly id: string;
  readonly key: string;
  readonly description?: string;
  readonly onDown?: () => void;
  readonly onUp?: () => void;
}

export interface TspmlApi {
  readonly events: {
    on(event: string, listener: (payload: never) => void): () => void;
    off(event: string, listener: (payload: never) => void): void;
  };
  readonly keybinds: { register(binding: KeybindBinding): () => void };
  readonly logger: TspmlLogger;
  readonly version: string;
}
`;
  const entrypoint = `import type { TspmlApi } from '../types/tspml-api.js';

/**
 * ${title} — factory entrypoint: default(api, game) => {}.
 * The loader calls this with the bridge api (events + keybinds).
 */
export default function entrypoint(api: TspmlApi): void {
  // Subscribe to a Tier-1 event (a real mod updates a HUD / reacts to input).
  api.events.on('car.control', () => {
    // ...
  });

  // Register a keybind through the Tier-1 registry.
  api.keybinds.register({
    id: '${id}.toggle',
    key: 'KeyH',
    description: '${title}: toggle',
    onDown: () => {
      api.logger.log('[${id}] hotkey pressed');
    },
  });

  api.logger.log('[${id}] loaded');
}
`;
  // Self-contained tsconfig (NOT extending the repo's base — the mod may live
  // at any depth). Mirrors the strictness settings from tsconfig.base.json.
  //
  // rootDir is "." rather than "src" because `types/` sits alongside it; with
  // rootDir "src" tsc errors that the type file is not under rootDir. Emitted
  // JS therefore lands at dist/src/entrypoint.js, which is what mod.json's
  // `entrypoint` must point at.
  const tsconfig = {
    compilerOptions: {
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "Bundler",
      strict: true,
      declaration: true,
      outDir: "dist",
      rootDir: ".",
    },
    include: ["src", "types"],
  };
  const readme = `# ${title}

A [TSPML](https://github.com/roowus/TSPML) mod for PolyTrack.

## Develop

\`\`\`bash
pnpm install
pnpm build
\`\`\`

## What it does

- \`src/entrypoint.ts\` — subscribes to the \`car.control\` event + registers a \`KeyH\` keybind.
- \`mixins.json\` — a starter Tier-2 mixin targeting the stable name \`Car\` (mappings-resolved, fail-closed).
- \`types/tspml-api.d.ts\` — a local stand-in for \`@tspml/api\`, which is **not published to npm yet**. It declares only the members this starter uses. When the package ships:

  \`\`\`bash
  pnpm add -D @tspml/api
  \`\`\`

  then delete \`types/tspml-api.d.ts\` and change the import in \`src/entrypoint.ts\` to \`from '@tspml/api'\`.

## Loading it

TSPML cannot yet install a mod from a directory — the portal and dev harness load mods that are bundled at build time. To run this mod today, clone [TSPML](https://github.com/roowus/TSPML), drop this folder into \`environments/demo-mods/\`, and add it to the harness. Standalone mod loading is tracked upstream.

See the mod API: [events-and-registries.md](https://github.com/roowus/TSPML/blob/main/docs/api/events-and-registries.md) · [mixin-reference.md](https://github.com/roowus/TSPML/blob/main/docs/api/mixin-reference.md)
`;
  return {
    "package.json": JSON.stringify(pkg, null, 2) + "\n",
    "mod.json": JSON.stringify(mod, null, 2) + "\n",
    "mixins.json": JSON.stringify(mixins, null, 2) + "\n",
    "src/entrypoint.ts": entrypoint,
    "types/tspml-api.d.ts": apiTypes,
    "tsconfig.json": JSON.stringify(tsconfig, null, 2) + "\n",
    "README.md": readme,
  };
}

/**
 * Scaffold a mod project named `id` into `dir`. Throws on an invalid id.
 * @returns the list of created file paths (relative).
 */
export async function scaffoldMod(id, dir) {
  if (typeof id !== "string" || !ID_PATTERN.test(id)) {
    throw new Error(`Invalid mod id '${id}' — must match ${ID_PATTERN} (lowercase, digits, hyphens).`);
  }
  const files = modFiles(id);
  const created = [];
  for (const [rel, content] of Object.entries(files)) {
    const path = join(dir, rel);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, "utf8");
    created.push(rel);
  }
  return created;
}

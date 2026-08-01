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
    dependencies: { "@tspml/api": "workspace:*" },
    devDependencies: { typescript: "^5.6.0" },
  };
  const mod = {
    schemaVersion: 1,
    id,
    name: title,
    version: "0.1.0",
    description: `${title} — a TSPML mod.`,
    entrypoint: "entrypoint.js",
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
  const entrypoint = `import type { TspmlApi } from '@tspml/api';

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
  const tsconfig = {
    extends: "../../tsconfig.base.json",
    compilerOptions: { outDir: "dist", rootDir: "src" },
    include: ["src"],
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

See the mod API: [docs/api/events-and-registries.md](../../docs/api/events-and-registries.md) + [docs/api/mixin-reference.md](../../docs/api/mixin-reference.md).
`;
  return {
    "package.json": JSON.stringify(pkg, null, 2) + "\n",
    "mod.json": JSON.stringify(mod, null, 2) + "\n",
    "mixins.json": JSON.stringify(mixins, null, 2) + "\n",
    "src/entrypoint.ts": entrypoint,
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

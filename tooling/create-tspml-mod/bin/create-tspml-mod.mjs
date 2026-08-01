#!/usr/bin/env node
// `create-tspml-mod <name>` — scaffold a new TSPML mod into ./<name>/.
import { scaffoldMod } from "../src/scaffold.mjs";

const id = process.argv[2];
if (!id) {
  console.error("Usage: create-tspml-mod <name>   (lowercase letters, digits, hyphens)");
  process.exit(1);
}

try {
  const created = await scaffoldMod(id, id);
  console.log(`✓ Created mod '${id}' — ${created.length} files:`);
  for (const f of created) console.log(`  ${id}/${f}`);
  console.log(`\nNext: cd ${id} && pnpm install && pnpm build`);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

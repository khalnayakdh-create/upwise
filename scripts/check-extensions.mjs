// Fails CI on theme-extension mistakes Shopify only reports at release time.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const errors = [];
for (const app of readdirSync("apps")) {
  const extRoot = join("apps", app, "extensions");
  if (!existsSync(extRoot)) continue;
  for (const ext of readdirSync(extRoot)) {
    const blocks = join(extRoot, ext, "blocks");
    if (!existsSync(blocks)) continue;
    for (const file of readdirSync(blocks).filter((f) => f.endsWith(".liquid"))) {
      const path = join(blocks, file);
      const m = readFileSync(path, "utf8").match(/{%-?\s*schema\s*-?%}([\s\S]*?){%-?\s*endschema\s*-?%}/);
      if (!m) { errors.push(`${path}: no {% schema %}`); continue; }
      let schema;
      try { schema = JSON.parse(m[1]); } catch (e) { errors.push(`${path}: schema is not valid JSON (${e.message})`); continue; }
      if (!schema.name || schema.name.length > 25) errors.push(`${path}: name "${schema.name}" must be 1-25 characters`);
      if (/upwise/i.test(JSON.stringify(schema))) errors.push(`${path}: user-visible "Upwise" (use Storevine)`);
    }
  }
}
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
console.log("Theme extension blocks OK");

// Fails CI on theme-extension mistakes Shopify only reports at release time.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const errors = [];
function lookup(obj, path) {
  return path.split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), obj);
}

for (const app of readdirSync("apps")) {
  const extRoot = join("apps", app, "extensions");
  if (!existsSync(extRoot)) continue;
  for (const ext of readdirSync(extRoot)) {
    const blocks = join(extRoot, ext, "blocks");
    if (!existsSync(blocks)) continue;
    const localePath = join(extRoot, ext, "locales", "en.default.json");
    let locale = null;
    if (!existsSync(localePath)) errors.push(`${join(extRoot, ext)}: missing locales/en.default.json`);
    else {
      try { locale = JSON.parse(readFileSync(localePath, "utf8")); } catch (e) { errors.push(`${localePath}: invalid JSON (${e.message})`); }
    }
    for (const file of readdirSync(blocks).filter((f) => f.endsWith(".liquid"))) {
      const path = join(blocks, file);
      const source = readFileSync(path, "utf8");
      // Every translation key used with the t filter must exist in the default locale.
      for (const [, key] of source.matchAll(/'([a-z0-9_]+(?:\.[a-z0-9_]+)+)'\s*\|\s*t\b/g)) {
        if (locale && typeof lookup(locale, key) !== "string") errors.push(`${path}: translation key "${key}" missing from ${localePath}`);
      }
      const m = source.match(/{%-?\s*schema\s*-?%}([\s\S]*?){%-?\s*endschema\s*-?%}/);
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

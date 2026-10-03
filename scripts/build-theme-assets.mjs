#!/usr/bin/env node
/**
 * Minify storefront scripts: apps/<app>/theme-src/<ext>/*.js -> apps/<app>/extensions/<ext>/assets/*.js
 * (sources live outside the extension: theme app extensions only allow assets/blocks/snippets/locales).
 * Shopify flags app-block JavaScript over 10 KB, and theme assets aren't minified for us.
 * Edit the theme-src/ file, then run `npm run build:theme-assets` and commit both.
 * `--check` fails if any asset is out of date (used in CI).
 */
import { build } from "esbuild";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const check = process.argv.includes("--check");
const LIMIT = 10_000;
let failed = false;
for (const app of readdirSync("apps")) {
  const extRoot = join("apps", app, "extensions");
  const srcRoot = join("apps", app, "theme-src");
  if (!existsSync(srcRoot)) continue;
  for (const ext of readdirSync(srcRoot)) {
    const src = join(srcRoot, ext);
    if (!existsSync(join(extRoot, ext, "assets"))) {
      console.error(`${src}: no matching extension ${join(extRoot, ext)}`);
      failed = true;
      continue;
    }
    for (const file of readdirSync(src).filter((f) => f.endsWith(".js"))) {
      const out = join(extRoot, ext, "assets", file);
      const result = await build({
        entryPoints: [join(src, file)],
        bundle: false,
        minify: true,
        target: "es2017",
        legalComments: "none",
        write: !check,
        outfile: out,
        logLevel: "silent",
      });
      const size = check ? result.outputFiles[0].contents.length : readFileSync(out).length;
      if (check) {
        const current = existsSync(out) ? readFileSync(out, "utf8") : "";
        if (current !== result.outputFiles[0].text) {
          console.error(`${out} is out of date: run npm run build:theme-assets`);
          failed = true;
        }
      }
      if (size > LIMIT) {
        console.error(`${out} is ${size} B, over Shopify's ${LIMIT} B app-block limit`);
        failed = true;
      }
      console.log(`${out}: ${size} B`);
    }
  }
}
process.exit(failed ? 1 : 0);

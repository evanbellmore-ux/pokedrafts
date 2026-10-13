// Integration 2: compiles app/globals.css with the app's PostCSS plugin (@tailwindcss/postcss, as postcss.config.mjs) for the
// static layout pages. Run from the repo root: node scripts/.cache/calc-audit/status2/build/int2/render/globals.mjs <out.css>
import fs from "node:fs";
import path from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

const from = path.resolve("app/globals.css");
const out = process.argv[2];
const result = await postcss([tailwind({ base: process.cwd() })]).process(fs.readFileSync(from, "utf8"), { from, to: out });
fs.writeFileSync(out, result.css);
console.log(`globals: ${result.css.length} bytes to ${out}`);

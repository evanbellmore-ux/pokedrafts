import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { readFileSync, writeFileSync } from "node:fs";
const from = process.argv[2], to = process.argv[3];
const result = await postcss([tailwind()]).process(readFileSync(from, "utf8"), { from, to });
writeFileSync(to, result.css);
console.log("css bytes", result.css.length);

// Integration 1b: each REASONS key of doubles-actions.ts with the app files and tests that read it (REASONS.<key>).
//   node scripts/.cache/calc-audit/status2/build/int1b/tools/reasons-use.cjs
const fs = require("fs"), path = require("path");
const src = fs.readFileSync("app/lib/battle/doubles-actions.ts", "utf8");
const start = src.indexOf("export const REASONS = {"); const end = src.indexOf("\n};", start);
const keys = [...src.slice(start, end).matchAll(/^  (\w+):/gm)].map((m) => m[1]);
function walk(d) {
  return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(d, e.name);
    if (e.isDirectory()) return e.name === "node_modules" ? [] : walk(p);
    return /\.(ts|tsx|mts)$/.test(e.name) ? [p] : [];
  });
}
const texts = [...walk("app"), ...walk("tests")].map((f) => [f.split(path.sep).join("/"), fs.readFileSync(f, "utf8")]);
for (const k of keys) {
  const re = new RegExp("REASONS\\." + k + "\\b");
  const app = texts.filter(([f, t]) => f.startsWith("app") && !f.endsWith("doubles-actions.ts") && re.test(t)).map(([f]) => path.basename(f));
  const tst = texts.filter(([f, t]) => f.startsWith("tests") && re.test(t)).map(([f]) => path.basename(f));
  console.log(k.padEnd(22), app.length ? "app: " + app.join(",") : "APP NONE", "| tests:", tst.join(","));
}

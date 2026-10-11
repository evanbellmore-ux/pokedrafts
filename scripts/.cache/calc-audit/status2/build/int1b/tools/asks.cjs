// Integration 1b: applies a JSON of exact single-match replacements ({file: [[from, to], ...]}) to a battle dir.
//   node asks.cjs <asks.json> <battle dir>
const fs = require("fs"), path = require("path");
const [asksFile, dir] = process.argv.slice(2);
const asks = JSON.parse(fs.readFileSync(asksFile, "utf8"));
for (const [file, edits] of Object.entries(asks)) {
  const p = path.isAbsolute(file) ? file : path.join(dir, file);
  const raw = fs.readFileSync(p, "utf8"); const crlf = raw.includes("\r\n");
  let text = raw.split("\r\n").join("\n");
  for (const [from, to] of edits) {
    const n = text.split(from).length - 1;
    if (n !== 1) throw new Error(`${file}: ${n} matches for ${JSON.stringify(from.slice(0, 120))}`);
    text = text.replace(from, () => to);
  }
  fs.writeFileSync(p, crlf ? text.split("\n").join("\r\n") : text);
  console.log(`applied ${edits.length} in ${file}`);
}

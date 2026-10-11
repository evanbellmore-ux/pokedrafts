// Census 1 helper: for each kind-L status move in app/lib/battle/status-table.ts, the line range of its entry in pinned
// Showdown data/moves.ts and in the champions, gen8 and gen7 mods' moves.ts, with the block's text (for reading).
// Run: npx --no-install tsx scripts/.cache/calc-audit/status2/design/census-moves-src.ts [--text] > census-moves-src.out
import { readFileSync } from "node:fs";
import { STATUS_MOVE_TABLE } from "../../../../../app/lib/battle/status-table";

const PS = "node_modules/.cache/champions/pokemon-showdown-c23d2e942c9c0daadb13a7162a385bf78e3c9353";
const FILES = { base: "data/moves.ts", champions: "data/mods/champions/moves.ts", gen8: "data/mods/gen8/moves.ts", gen7: "data/mods/gen7/moves.ts" } as const;

function blocks(file: string): Map<string, { from: number; to: number; text: string }> {
  const lines = readFileSync(`${PS}/${file}`, "utf8").split(/\r?\n/);
  const out = new Map<string, { from: number; to: number; text: string }>();
  for (let i = 0; i < lines.length; i++) {
    const m = /^\t([a-z0-9]+): \{\s*$/.exec(lines[i]);
    if (!m) continue;
    let j = i + 1;
    while (j < lines.length && lines[j] !== "\t}," && lines[j] !== "\t}") j++;
    out.set(m[1], { from: i + 1, to: j + 1, text: lines.slice(i, j + 1).join("\n") });
    i = j;
  }
  return out;
}

const parsed = Object.fromEntries(Object.entries(FILES).map(([key, file]) => [key, blocks(file)])) as Record<keyof typeof FILES, ReturnType<typeof blocks>>;
const text = process.argv.includes("--text");
const L = Object.entries(STATUS_MOVE_TABLE).filter(([, entry]) => entry.kind === "L").map(([id]) => id);
console.log(`L moves: ${L.length}`);
for (const id of L) {
  const where = (Object.keys(FILES) as (keyof typeof FILES)[]).map((key) => {
    const block = parsed[key].get(id);
    return block ? `${key} ${FILES[key]}:${block.from}-${block.to}` : null;
  }).filter(Boolean);
  console.log(`## ${id} games=${Object.keys(STATUS_MOVE_TABLE[id].games).join(",")} :: ${where.join(" | ")}`);
  if (text) for (const key of Object.keys(FILES) as (keyof typeof FILES)[]) {
    const block = parsed[key].get(id);
    if (block) console.log(`--- ${key} ${block.from}\n${block.text}`);
  }
}

// Track A1: print pinned dex entries' handlers per mod. npx --no-install tsx scripts/.cache/calc-audit/status2/build/a1-dex-show.ts <abilities|items|moves|conditions> <id>...
import * as sim from "../../showdown/sim/index.ts";
const { Dex } = sim as any;
const [kind, ...ids] = process.argv.slice(2);
for (const id of ids) {
  const seen = new Map<string, string[]>();
  for (const mod of ["gen9", "champions", "gen8", "gen7"]) {
    const e = Dex.mod(mod)[kind].get(id);
    if (!e?.exists) continue;
    const parts = Object.entries(e).filter(([k, v]) => typeof v === "function" || /Priority$|Order$|SubOrder$/.test(k) || k === "flags" || k === "isNonstandard").map(([k, v]) => `${k}: ${typeof v === "function" ? String(v) : JSON.stringify(v)}`);
    if (e.condition) for (const [k, v] of Object.entries(e.condition)) parts.push(`condition.${k}: ${typeof v === "function" ? String(v) : JSON.stringify(v)}`);
    const text = parts.join("\n  ");
    (seen.get(text) ?? seen.set(text, []).get(text)!).push(mod);
  }
  for (const [text, mods] of seen) console.log(`=== ${kind} ${id} [${mods.join(" ")}]\n  ${text}`);
}

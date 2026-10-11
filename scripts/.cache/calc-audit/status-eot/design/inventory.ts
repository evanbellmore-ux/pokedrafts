// Every residual handler in pinned Showdown c23d2e94 (gen9 + champions mod + gen8 + gen7), with order/subOrder/priority.
//   npx --no-install tsx scripts/.cache/calc-audit/status-eot/design/inventory.ts
import * as sim from "../../showdown/sim/index.ts";
const { Dex } = sim as any;
const rows = new Map<string, string>();
for (const mod of ["gen9", "champions", "gen8", "gen7"]) {
  const dex = Dex.mod(mod);
  const visit = (kind: string, id: string, e: any, name: string) => {
    if (!e) return;
    for (const prefix of ["onResidual", "onFieldResidual", "onSideResidual"]) {
      if (typeof e[prefix] !== "function" && e[`${prefix}Order`] === undefined) continue;
      const key = `${kind}:${id}:${prefix}`;
      const text = `${(e[`${prefix}Order`] ?? "-")}.${e[`${prefix}SubOrder`] ?? "-"}${e[`${prefix}Priority`] ? ` prio ${e[`${prefix}Priority`]}` : ""}${typeof e[prefix] === "function" ? "" : " (no callback)"}${e.duration ? ` dur ${e.duration}` : ""}`;
      const prev = rows.get(key);
      rows.set(key, prev && !prev.includes(`[${mod}]`) && !prev.startsWith(text) ? `${prev} | [${mod}] ${text}` : prev ?? `${text}  ${name}${e.isNonstandard ? ` (${e.isNonstandard})` : ""}`);
    }
  };
  for (const a of dex.abilities.all()) visit("ability", a.id, a, a.name);
  for (const i of dex.items.all()) visit("item", i.id, i, i.name);
  for (const m of dex.moves.all()) visit("move", m.id, m.condition, m.name + (m.isNonstandard ? ` (${m.isNonstandard})` : ""));
  for (const id of Object.keys(dex.data.Conditions)) visit("condition", id, dex.conditions.get(id), id);
}
for (const [key, text] of [...rows].sort((a, b) => {
  const oa = Number(a[1].split(".")[0]) || 99, ob = Number(b[1].split(".")[0]) || 99;
  return oa - ob || a[0].localeCompare(b[0]);
})) console.log(key.padEnd(44), text);

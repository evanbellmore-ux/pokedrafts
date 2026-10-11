// Track U1 probes (status2 ADDENDUM2 §5.2's apply actions) on pinned Showdown c23d2e94 through guards-sim.ts: the stages
// and items right after the leads come in, which the calculator's Commander and Trace-Intimidate buttons store. Run from
// the repo root:  npx --no-install tsx scripts/.cache/calc-audit/status2/build/u1-apply-probes.ts
import { monAt, start, type Mon, type Probe } from "../design/guards-sim";

const ids = ["p1a", "p1b", "p2a", "p2b"] as const;
const boosts = (p: any) => Object.entries(p.boosts as Record<string, number>).filter(([, v]) => v).map(([k, v]) => `${k}${v > 0 ? "+" : ""}${v}`).join(" ") || "0";
function lead(title: string, mons: [Mon, Mon, Mon, Mon], setup?: Probe["setup"]) {
  const b = start({ game: "sv", mons, turns: [], setup });
  console.log(`\n== ${title}`);
  for (const id of ids) {
    const p = monAt(b, id);
    console.log(`  ${id} ${p.name} [${boosts(p)}] item=${p.item || "-"} ability=${p.ability} v:${Object.keys(p.volatiles).join(",")}`);
  }
  for (const line of (b.log as string[]).filter((l) => /^\|(-boost|-unboost|-activate|-ability|-enditem|-item|-block)\|/.test(l))) console.log(`  ${line}`);
}

const tatsugiri: Mon = { species: "Tatsugiri", ability: "Commander", name: "Tatsugiri" };
const dondozo: Mon = { species: "Dondozo", ability: "Oblivious", name: "Dondozo" };
const espathra: Mon = { species: "Espathra", ability: "Opportunist", name: "Espathra" };
const kingambit: Mon = { species: "Kingambit", ability: "Defiant", item: "Mirror Herb", name: "Kingambit" };

lead("U1-CMD-1 sv: Commander at the lead; the foes' Opportunist and Mirror Herb copy", [tatsugiri, dondozo, espathra, kingambit]);
lead("U1-CMD-2 sv: a foe's Neutralizing Gas: no Commander", [tatsugiri, dondozo, { species: "Weezing-Galar", ability: "Neutralizing Gas", name: "Weezing" }, espathra]);
lead("U1-CMD-3 sv: Tatsugiri's Ability Shield under a foe's Neutralizing Gas: Commander; Opportunist suppressed",
  [{ ...tatsugiri, item: "Ability Shield" }, dondozo, { species: "Weezing-Galar", ability: "Neutralizing Gas", name: "Weezing" }, espathra]);
lead("U1-CMD-4 sv: a Simple Mirror Herb holder copies through its own boost()", [tatsugiri, dondozo, { species: "Swoobat", ability: "Simple", item: "Mirror Herb", name: "Swoobat" }, espathra]);
lead("U1-TRC-1 sv: Trace copies Intimidate from two Intimidate foes", [{ species: "Gardevoir", ability: "Trace", name: "Gardevoir" }, { species: "Snorlax", ability: "Thick Fat", name: "Snorlax" },
  { species: "Incineroar", ability: "Intimidate", name: "Incineroar" }, { species: "Gyarados", ability: "Intimidate", name: "Gyarados" }]);
lead("U1-TRC-2 sv: Trace with its own Ability Shield copies nothing", [{ species: "Gardevoir", ability: "Trace", item: "Ability Shield", name: "Gardevoir" }, { species: "Snorlax", ability: "Thick Fat", name: "Snorlax" },
  { species: "Incineroar", ability: "Intimidate", name: "Incineroar" }, { species: "Gyarados", ability: "Intimidate", name: "Gyarados" }]);

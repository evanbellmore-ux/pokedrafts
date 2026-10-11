// T1 exploration: print the public log lines of scripted Champions battles (pinned Showdown c23d2e94).
import { Battle } from "@/app/(app)/training/sim/sim";
const sp = (hp: number, atk: number, def: number, spa: number, spd: number, spe: number) => ({ hp, atk, def, spa, spd, spe });
const set = (species: string, item: string, ability: string, moves: string[], extra: Record<string, unknown> = {}) => ({ name: species, species, item, ability, moves, nature: "Serious", evs: sp(0, 0, 0, 0, 0, 0), ivs: sp(31, 31, 31, 31, 31, 31), level: 50, gender: "M", ...extra });
function run(title: string, p1: object[], p2: object[], turns: [string, string][], seed = [1, 2, 3, 4]) {
  const b = new Battle({ formatid: "gen9championsvgc2026regmc", seed });
  b.setPlayer("p1", { team: p1 as never }); b.setPlayer("p2", { team: p2 as never });
  b.makeChoices(`team ${p1.map((_, i) => i + 1).join("")}`, `team ${p2.map((_, i) => i + 1).join("")}`);
  for (const [a, c] of turns) b.makeChoices(a, c);
  console.log(`==== ${title}`);
  console.log(b.log.filter((l) => !l.startsWith("|t:|") && !l.startsWith("|j|") && l !== "|").slice(b.log.findIndex((l) => l.startsWith("|start"))).join("\n"));
  return b;
}
const lax = (name: string, moves = ["Splash"], extra: Record<string, unknown> = {}) => set("Snorlax", "", "Thick Fat", moves, { name, ...extra });
const which = process.argv[2] ?? "all";
if (which === "all" || which === "stock") run("stockpile", [set("Swalot", "", "Gluttony", ["Stockpile", "Swallow", "Spit Up"]), lax("A")], [lax("B"), lax("C")], [["move 1, move 1", "move 1, move 1"], ["move 1, move 1", "move 1, move 1"], ["move 2, move 1", "move 1, move 1"]]);
if (which === "all" || which === "ptrick") { const b = run("powertrick", [set("Medicham", "", "Pure Power", ["Power Trick", "Power Split"]), lax("A")], [set("Chandelure", "", "Flash Fire", ["Power Split", "Speed Swap"]), lax("C")], [["move 1, move 1", "move 1 1, move 1"], ["move 2 1, move 1", "move 2 1, move 1"]]); console.log(JSON.stringify([b.p1.active[0]!.storedStats, b.p2.active[0]!.storedStats])); }
if (which === "all" || which === "mini") run("minimize", [set("Chandelure", "", "Flash Fire", ["Minimize", "Gastro Acid"]), lax("A")], [set("Grapploct", "", "Limber", ["Octolock", "Soak"]), set("Baxcalibur", "", "Thermal Exchange", ["Glaive Rush", "Mean Look"])], [["move 1, move 1", "move 1 1, move 1 1"], ["move 2 1, move 1", "move 2 1, move 2 1"]]);
if (which === "all" || which === "attract") run("attract", [set("Espeon", "", "Synchronize", ["Psychic Noise", "Attract"], { gender: "F" }), lax("A")], [lax("B"), lax("C")], [["move 2 1, move 1", "move 1, move 1"], ["move 1 2, move 1", "move 1, move 1"], ["move 1 2, move 1", "move 1, move 1"]]);
if (which === "all" || which === "protean") run("protean", [set("Greninja", "", "Protean", ["Ice Beam", "Dark Pulse"]), set("Trevenant", "Sitrus Berry", "Harvest", ["Forest's Curse", "Skill Swap"])], [lax("B"), set("Ditto", "Choice Scarf", "Imposter", ["Transform"])], [["move 1 1, move 1 1", "move 1, move 1"], ["move 2 1, move 2 2", "move 1, move 1"]]);
if (which === "all" || which === "items") run("items", [set("Garbodor", "Air Balloon", "Aftermath", ["Recycle", "Fling"]), set("Polteageist", "Occa Berry", "Weak Armor", ["Teatime"])], [set("Appletun", "Occa Berry", "Ripen", ["Splash", "Flamethrower"]), set("Drampa", "Sitrus Berry", "Berserk", ["Splash"])], [["move 2 1, move 1", "move 1, move 1"], ["move 1, move 1", "move 1, move 1"]]);

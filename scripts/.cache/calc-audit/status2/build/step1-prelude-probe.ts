// status2 Step 1 #15: runPreludeWorlds on TR04 (tied switches into Drought and Drizzle) and TR05 (tied Mega Evolutions),
// the probes of tier2-eot-training-probes-2.ts, to pin the unit test's worlds.
//   npx --no-install tsx scripts/.cache/calc-audit/status2/build/step1-prelude-probe.ts
import { runPreludeWorlds } from "@/app/(app)/training/sim/prelude";
import { Battle, State } from "@/app/(app)/training/sim/sim";

const lax = (name: string, spe: number) => ({ name, species: "Snorlax", ability: "Thick Fat", item: "", moves: ["Splash"], nature: "Serious", evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 50, gender: "M" });
function battleOf(p1: object[], p2: object[], format = "gen9championsvgc2026regmc", setup?: (b: Battle) => void) {
  const b = new Battle({ formatid: format, seed: [1, 2, 3, 4] });
  b.setPlayer("p1", { team: p1 as never });
  b.setPlayer("p2", { team: p2 as never });
  const order = (n: number) => `team ${Array.from({ length: n }, (_, i) => i + 1).join("")}`;
  if (b.requestState === "teampreview") b.makeChoices(order(p1.length), order(p2.length));
  setup?.(b);
  return JSON.stringify(State.serializeBattle(b));
}
const show = (title: string, json: string, choices: { p1: string; p2: string }) => {
  const r = runPreludeWorlds(json, choices, "0".repeat(32));
  if (r.kind === "rollout") { console.log(title, "rollout", r.reasons); return; }
  console.log(title, r.worlds.map((w) => `${w.weight} weather:${w.battle.field.weather || "-"} p1a:${w.battle.p1.active[0]?.species.id} p2a:${w.battle.p2.active[0]?.species.id}`).join(" | "));
};
const tork = { ...lax("Tork", 0), species: "Torkoal", ability: "Drought" };
const toed = { ...lax("Toed", 0), species: "Politoed", ability: "Drizzle" };
show("TR04", battleOf([lax("OutA", 3), lax("Lax1", 1), tork], [lax("OutB", 3), lax("Lax2", 2), toed]), { p1: "switch 3, move 1", p2: "switch 3, move 1" });
const zard = { ...lax("Zard", 0), species: "Charizard", ability: "Blaze", item: "Charizardite Y" };
const ttar = { ...lax("Ttar", 0), species: "Tyranitar", ability: "Sand Stream", item: "Tyranitarite" };
show("TR05", battleOf([zard, lax("Lax1", 1)], [ttar, lax("Lax2", 2)], undefined, (b) => { for (const p of [b.p1.active[0], b.p2.active[0]]) { p.storedStats.spe = 120; (p as unknown as { speed: number }).speed = 120; } }), { p1: "move 1 mega, move 1", p2: "move 1 mega, move 1" });
show("3 tied", battleOf([lax("OutA", 3), lax("OutC", 3), tork, lax("BenchA", 0)], [lax("OutB", 3), lax("Lax2", 2), toed]), { p1: "switch 3, switch 4", p2: "switch 3, move 1" });
show("4 tied", battleOf([lax("OutA", 3), lax("OutC", 3), tork, lax("BenchA", 0)], [lax("OutB", 3), lax("OutD", 3), toed, lax("BenchB", 0)]), { p1: "switch 3, switch 4", p2: "switch 3, switch 4" });

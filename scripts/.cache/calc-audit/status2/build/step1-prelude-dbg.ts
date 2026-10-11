// Debug for step1-prelude-probe.ts: which shuffles and samples the prelude meets (sizes and callers), one run.
import { PRNG, State, type PRNGSeed } from "@/app/(app)/training/sim/sim";
import { Battle } from "@/app/(app)/training/sim/sim";
const lax = (name: string, spe: number) => ({ name, species: "Snorlax", ability: "Thick Fat", item: "", moves: ["Splash"], nature: "Serious", evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 50, gender: "M" });
const tork = { ...lax("Tork", 0), species: "Torkoal", ability: "Drought" };
const toed = { ...lax("Toed", 0), species: "Politoed", ability: "Drizzle" };
const b = new Battle({ formatid: "gen9championsvgc2026regmc", seed: [1, 2, 3, 4] });
b.setPlayer("p1", { team: [lax("OutA", 3), lax("Lax1", 1), tork] as never });
b.setPlayer("p2", { team: [lax("OutB", 3), lax("Lax2", 2), toed] as never });
b.makeChoices("team 123", "team 123");
const json = JSON.stringify(State.serializeBattle(b));
const clone = State.deserializeBattle(json);
clone.restart(() => {});
clone.prng = new PRNG(`sodium,${"0".repeat(32)}` as PRNGSeed);
const prng = clone.prng as unknown as { shuffle: (list: unknown[], start?: number, end?: number) => void };
prng.shuffle = (list: unknown[], start = 0, end = list.length) => {
  const k = end - start;
  if (k >= 2) console.log("shuffle", k, list.slice(start, end).map((x: any) => x?.choice ? `${x.choice}:${x.pokemon?.name}:${x.order}` : x?.effect ? `${x.effect.id}:${x.effectHolder?.name ?? ""}:${x.speed}` : String(x)).join(","), new Error().stack!.split("\n").slice(2, 5).map((s) => s.trim().split(" ")[1]).join("<"));
};
console.log(clone.p1.active.map((p) => `${p.name}:${p.getStat("spe")}`), clone.p2.active.map((p) => `${p.name}:${p.getStat("spe")}`));
try { clone.makeChoices("switch 3, move 1", "switch 3, move 1"); } catch (e) { console.log("err", (e as Error).message); }
console.log(clone.log.slice(-25).join("\n"));

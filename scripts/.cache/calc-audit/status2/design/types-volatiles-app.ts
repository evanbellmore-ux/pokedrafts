// FAMILY 2 (types and volatiles): what today's app does on a few turns of this family (the 2v2 verify harness's app side,
// scripts/.cache/calc-audit/2v2/verify/app-turn.ts), to set against types-volatiles-probes*.out. Read-only: no app code changes.
// Run from the repo root:
//   npx --no-install tsx scripts/.cache/calc-audit/status2/design/types-volatiles-app.ts > scripts/.cache/calc-audit/status2/design/types-volatiles-app.out
import { appTurn } from "../../2v2/verify/app-turn";
import type { Case, CaseMon, CaseAction } from "../../2v2/verify/case-types";

type Slot = CaseMon & { action: CaseAction };
const m = (species: string, ability: string, move: string | null, target?: Case["slots"]["own-left"]["action"]["target"], over: Partial<CaseMon> = {}): Slot =>
  ({ species, ability, ...over, action: { move, ...(target ? { target } : {}) } });
const CASES: Case[] = [
  {
    id: "APP-colorchange", title: "Jolteon Thunderbolt into Kecleon (Color Change); Garchomp Earthquake", game: "usum", checks: "today's Color Change",
    slots: {
      "own-left": m("Jolteon", "Volt Absorb", "Thunderbolt", "opponent-left"), "own-right": m("Chansey", "Natural Cure", null),
      "opponent-left": m("Kecleon", "Color Change", null), "opponent-right": m("Garchomp", "Rough Skin", "Earthquake"),
    },
  },
  {
    id: "APP-soak", title: "Jolteon Soak into Gyarados; Lapras Thunderbolt into Gyarados", game: "sv", checks: "today's L guard",
    slots: {
      "own-left": m("Jolteon", "Volt Absorb", "Soak", "opponent-left"), "own-right": m("Lapras", "Shell Armor", "Thunderbolt", "opponent-left"),
      "opponent-left": m("Gyarados", "Moxie", null), "opponent-right": m("Chansey", "Natural Cure", null),
    },
  },
  {
    id: "APP-protean", title: "Greninja (Protean) Ice Beam into Snorlax; Arcanine Flamethrower into Greninja", game: "sv", checks: "today's Protean guard",
    slots: {
      "own-left": m("Greninja", "Protean", "Ice Beam", "opponent-right"), "own-right": m("Chansey", "Natural Cure", null),
      "opponent-left": m("Arcanine", "Intimidate", "Flamethrower", "own-left"), "opponent-right": m("Snorlax", "Thick Fat", null),
    },
  },
  {
    id: "APP-attract", title: "Jolteon (M) Attract into Snorlax (F); Snorlax Body Slam into Chansey", game: "champions", checks: "today's L guard",
    slots: {
      "own-left": m("Jolteon", "Volt Absorb", "Attract", "opponent-left", { gender: "M" }), "own-right": m("Garchomp", "Rough Skin", null),
      "opponent-left": m("Snorlax", "Thick Fat", "Body Slam", "own-right", { gender: "F" }), "opponent-right": m("Gengar", "Cursed Body", null),
    },
  },
  {
    id: "APP-psychicnoise", title: "Farigiraf Psychic Noise into Snorlax (Sitrus, 150 HP); Garchomp Earthquake", game: "sv", checks: "today's Psychic Noise guard",
    slots: {
      "own-left": m("Farigiraf", "Armor Tail", "Psychic Noise", "opponent-left"), "own-right": m("Chansey", "Natural Cure", null),
      "opponent-left": m("Snorlax", "Thick Fat", null, undefined, { item: "Sitrus Berry", hp: 150 }), "opponent-right": m("Garchomp", "Rough Skin", "Earthquake"),
    },
  },
  {
    id: "APP-roost", title: "Corviknight (100 HP) Roost; Garchomp Earthquake", game: "sv", checks: "today's Roost guard",
    slots: {
      "own-left": m("Corviknight", "Pressure", "Roost", undefined, { hp: 100 }), "own-right": m("Chansey", "Natural Cure", null),
      "opponent-left": m("Garchomp", "Rough Skin", "Earthquake"), "opponent-right": m("Snorlax", "Thick Fat", null),
    },
  },
];

(async () => {
  for (const c of CASES) {
    const out = await appTurn(c);
    const r = out.result;
    console.log(`\n### ${c.id} ${c.game}: ${c.title}`);
    if (out.preflight.length) console.log(`  preflight: ${out.preflight.join(" | ")}`);
    if (out.error) { console.log(`  error: ${out.error.split("\n")[0]}`); continue; }
    if (!r) continue;
    if (r.status !== "ready") { console.log(`  ${r.status}: ${"reason" in r ? r.reason : JSON.stringify((r as any).issues)}`); continue; }
    for (const step of r.steps) {
      console.log(`  step ${step.slot} ${step.moveId} moves ${step.moves}: ${step.facts.map((f) => `${f.text} (${+f.chance.toFixed(4)})`).join(" | ")}`);
      for (const hit of step.hits) console.log(`    hit ${hit.slot} ${hit.kind} ${hit.min}..${hit.max} ko ${+hit.koChance.toFixed(4)} ${hit.facts.map((f) => f.text).join(" | ")}`);
    }
    for (const [slot, hp] of Object.entries(r.hp)) if (hp) console.log(`  hp ${slot} ${hp.min}..${hp.max} avg ${+hp.average.toFixed(2)} ko ${+hp.koChance.toFixed(4)}`);
    console.log(`  end of turn: ${r.endOfTurn.status}${r.endOfTurn.status === "not-estimated" ? ` (${r.endOfTurn.reason})` : ""}`);
  }
})();

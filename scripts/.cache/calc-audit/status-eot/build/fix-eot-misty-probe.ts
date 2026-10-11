// Pinned Showdown: a Misty Terrain (or Gravity) with one turn left ends at order 27, before the Flame Orb (28.3).
import { prepare, pokemonAt } from "../../2v2/verify/sim-dfs";
import type { Case } from "../../2v2/verify/case-types";
const base = (field: Case["field"], species = "Snorlax"): Case => ({
  id: "MP", title: "probe", game: "sv", field,
  slots: {
    "own-left": { species, ability: species === "Snorlax" ? "Thick Fat" : "Pressure", item: "Flame Orb", action: { move: null } },
    "own-right": { species: "Venusaur", ability: "Overgrow", action: { move: null } },
    "opponent-left": { species: "Jolteon", ability: "Volt Absorb", action: { move: null } },
    "opponent-right": { species: "Garchomp", ability: "Rough Skin", action: { move: null } },
  },
} as Case);
for (const [label, c, set] of [
  ["Misty, 1 turn left", base({ terrain: "Misty" }), (b: any) => { b.field.terrainState.duration = 1; }],
  ["Misty, 5 turns left", base({ terrain: "Misty" }), () => {}],
  ["Gravity 1 turn left + Misty 5, Corviknight", base({ terrain: "Misty", gravity: true }, "Corviknight"), (b: any) => { b.field.pseudoWeather.gravity.duration = 1; }],
  ["Gravity 5 + Misty 5, Corviknight", base({ terrain: "Misty", gravity: true }, "Corviknight"), () => {}],
] as const) {
  const { b, choices } = prepare(c);
  set(b);
  b.makeChoices(choices[0], choices[1]);
  console.log(label, "→", (pokemonAt(b, "own-left") as any).status || "no status", "| terrain", b.field.terrain || "none", "| gravity", !!b.field.pseudoWeather.gravity);
}

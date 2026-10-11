import { show, turn, type Mon } from "./eotsim";
const m = (species: string, ability: string, moves: string[] = ["Splash"], extra: Partial<Mon> = {}): Mon => ({ species, ability, moves, ...extra });
for (const n of [1, 2, 3]) {
  try {
    show(`dyn ${n}`, turn({ game: "swsh", p1: [m("Snorlax", "Thick Fat", ["Body Slam"]), m("Blastoise", "Torrent")], p2: [m("Venusaur", "Overgrow"), m("Gengar", "Cursed Body")],
      c1: ["move 1 1 dynamax, move 1", "move 1 1, move 1"], c2: "move 1, move 1", setup: (b) => { b.field.setWeather("sandstorm", "debug"); }, turns: n }));
  } catch (e) { console.log(n, (e as Error).message); }
}

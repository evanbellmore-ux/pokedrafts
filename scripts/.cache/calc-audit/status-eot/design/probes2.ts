// More end-of-turn probes (pinned Showdown c23d2e94): npx --no-install tsx scripts/.cache/calc-audit/status-eot/design/probes2.ts
import { show, turn, type Mon } from "./eotsim";
const m = (species: string, ability: string, moves: string[] = ["Splash"], extra: Partial<Mon> = {}): Mon => ({ species, ability, moves, ...extra });
const at = (b: any, slot: string) => (slot[1] === "1" ? b.p1 : b.p2).active["ab".indexOf(slot[2])];
const run = (id: string, title: string, f: () => ReturnType<typeof turn>) => { try { show(`${id}. ${title}`, f()); } catch (e) { console.log(`\n### ${id}. ${title}\n ERROR ${(e as Error).message}`); } };
// F1. Fire Spin into a Ghost: trapped and damaged? Magic Guard target: no damage.
run("F1", "Fire Spin into Gengar (Ghost) and Clefable (Magic Guard)", () => turn({
  game: "sv", p1: [m("Charizard", "Blaze", ["Fire Spin"]), m("Volcarona", "Flame Body", ["Fire Spin"])], p2: [m("Gengar", "Cursed Body"), m("Clefable", "Magic Guard")],
  c1: "move 1 1, move 1 2", c2: "move 1, move 1",
}));
// F2. Gen 7 Moody: seven stats (accuracy and evasion too).
run("F2", "Moody USUM samples", () => turn({ game: "usum", p1: [m("Smeargle", "Moody"), m("Snorlax", "Thick Fat")], p2: [m("Garchomp", "Rough Skin"), m("Toxapex", "Regenerator")], c1: "move 1, move 1", c2: "move 1, move 1" }));
// F3. Bad poison carried at stage 3: 4/16 this turn.
run("F3", "Toxic stage 3 carried", () => turn({ game: "champions", p1: [m("Snorlax", "Thick Fat"), m("Garchomp", "Rough Skin")], p2: [m("Gengar", "Cursed Body"), m("Toxapex", "Regenerator")],
  c1: "move 1, move 1", c2: "move 1, move 1", setup: (b) => { at(b, "p1a").setStatus("tox", null, null, true); at(b, "p1a").statusState.stage = 3; } }));
// F4. Wish carried (slot condition from last turn) heals the Pokémon now in the slot.
run("F4", "Wish from last turn", () => turn({ game: "champions", p1: [m("Snorlax", "Thick Fat", ["Wish"]), m("Garchomp", "Rough Skin")], p2: [m("Gengar", "Cursed Body"), m("Toxapex", "Regenerator")],
  c1: ["move 1, move 1", "move 1, move 1"], c2: "move 1, move 1", setup: (b) => { const p = at(b, "p1a"); p.sethp(50); }, turns: 2 }));
// F5. Sticky Barb and Black Sludge on a non-Poison type.
run("F5", "Sticky Barb and Black Sludge", () => turn({ game: "champions", p1: [m("Snorlax", "Thick Fat", ["Splash"], { item: "Sticky Barb" }), m("Garchomp", "Rough Skin", ["Splash"], { item: "Black Sludge" })], p2: [m("Gengar", "Cursed Body", ["Splash"], { item: "Black Sludge" }), m("Toxapex", "Regenerator")],
  c1: "move 1, move 1", c2: "move 1, move 1", setup: (b) => { const p = at(b, "p2a"); p.sethp(100); } }));
// F6. Poison then Sitrus at the final Update, Emergency Exit reads HP after it (Golisopod above half after Sitrus: no switch).
run("F6", "Emergency Exit after the final Update (Sitrus back above half)", () => turn({ game: "champions", p1: [m("Golisopod", "Emergency Exit", ["Splash"], { item: "Sitrus Berry" }), m("Snorlax", "Thick Fat")], p2: [m("Garchomp", "Rough Skin"), m("Toxapex", "Regenerator")],
  c1: "move 1, move 1", c2: "move 1, move 1", setup: (b) => { const p = at(b, "p1a"); p.sethp(Math.floor(p.maxhp / 2) + 2); p.setStatus("brn", null, null, true); } }));
// F7. Rain: Rain Dish, Dry Skin heal; sun: Solar Power and Dry Skin hurt; Utility Umbrella.
run("F7", "Sun: Solar Power, Dry Skin, Umbrella", () => turn({ game: "sv", p1: [m("Charizard", "Solar Power"), m("Toxicroak", "Dry Skin")], p2: [m("Heliolisk", "Dry Skin", ["Splash"], { item: "Utility Umbrella" }), m("Toxapex", "Regenerator")],
  c1: "move 1, move 1", c2: "move 1, move 1", setup: (b) => { b.field.setWeather("sunnyday", "debug"); } }));

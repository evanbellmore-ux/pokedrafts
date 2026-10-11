// Status-move architect's probes, batch 5: Destiny Bond taking its knocker-out (replacing today's guard), and a Stuff Cheeks
// / Teatime Berry eaten at any HP. Run: npx --no-install tsx scripts/.cache/calc-audit/status-eot/design/status-probes-5.ts
import { enumerate, report } from "./status-sim";
const L = /^\|(move|faint|-activate|-damage|-heal|-enditem|-boost|-start|-singlemove)\|/;
const blissey = { species: "Blissey", ability: "Natural Cure", moves: ["Splash"] };
const shuckle = { species: "Shuckle", ability: "Gluttony", moves: ["Splash"] };
report("D1 sv: Gengar Destiny Bond, then +6 Snorlax Crunch knocks it out: Snorlax faints too", enumerate({
  game: "sv", mons: [{ species: "Gengar", ability: "Cursed Body", moves: ["Destiny Bond"] }, blissey, { species: "Snorlax", ability: "Thick Fat", moves: ["Crunch"] }, shuckle],
  turns: [["move 1, move 1", "move 1 1, move 1"]], lines: L,
  setup: (b: any) => { b.p2.active[0].boosts.atk = 6; b.p2.active[0].setStatus("", null, null, true); },
}));
report("D2 sv: Snorlax at 40% Stuff Cheeks with Sitrus (eaten at any HP: +1/4, then Def +2)", enumerate({
  game: "sv", mons: [{ species: "Jolteon", ability: "Volt Absorb", moves: ["Splash"] }, { species: "Blissey", ability: "Natural Cure", item: "Oran Berry", moves: ["Splash"] },
    { species: "Snorlax", ability: "Thick Fat", item: "Sitrus Berry", moves: ["Stuff Cheeks"] }, shuckle],
  turns: [["move 1, move 1", "move 1, move 1"]], lines: L,
  setup: (b: any) => { const s = b.p2.active[0]; s.sethp(Math.floor(s.maxhp * 0.9)); },
}));

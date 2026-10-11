// Decision kinds of a probe's first outcomes (diagnosing run counts).
import { enumerate } from "./status-sim";
const r = enumerate({ game: "sv", maxRuns: 2_000_000, mons: [{ species: "Jolteon", ability: "Volt Absorb", moves: ["Teeter Dance"] }, { species: "Chansey", ability: "Natural Cure", moves: ["Splash"] }, { species: "Snorlax", ability: "Thick Fat", moves: ["Splash"] }, { species: "Slowbro", ability: "Own Tempo", moves: ["Splash"] }], turns: [["move 1, move 1", "move 1, move 1"]] });
console.log(r.runs);
for (const o of r.outcomes.slice(0, 2)) console.log(o.kinds.join(","));

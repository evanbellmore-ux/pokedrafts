// Integration 1b: a Future Sight landing whose user is not in battle (PendingAction.userless), into each reaction a residual
// hit can set off, with the first slot of the user's side empty or holding a Sheer Force Nidoking (a Pokémon the hooks must
// not read as the user). SV cases run through the verify harness's appTurn (turn and outcomes); prints the status, the end
// of turn's reason, or the exception. Not oracle cases: a crash probe.
import { appTurn } from "../../../2v2/verify/app-turn";
import type { Case, CaseMon } from "../../../2v2/verify/case-types";
import { carried, idle, lax, mon, slots } from "../../../2v2/verify/case-kit";

const hatterene = mon("Hatterene", "Magic Bounce", { nature: "Modest", evs: { spa: 252 } });
const TARGETS: [string, CaseMon][] = [
  ["Snorlax Leftovers", lax(8, { item: "Leftovers" })],
  ...["Rowap Berry", "Jaboca Berry", "Red Card", "Eject Button", "Weakness Policy", "Sitrus Berry", "Kee Berry", "Maranga Berry", "Absorb Bulb",
    "Cell Battery", "Focus Sash", "Rocky Helmet", "Air Balloon", "Enigma Berry", "Payapa Berry", "Lum Berry", "Eject Pack", "Luminous Moss", "Shell Bell"]
    .flatMap((item): [string, CaseMon][] => [[`Snorlax ${item}`, lax(8, { item })], [`Snorlax ${item} at 60`, lax(8, { item, hp: 60 })]]),
  ...([["Kecleon", "Color Change"], ["Pyukumuku", "Innards Out"], ["Drifblim", "Aftermath"], ["Corviknight", "Mirror Armor"], ["Eldegoss", "Cotton Down"],
    ["Mimikyu", "Disguise"], ["Eiscue", "Ice Face"], ["Mudsdale", "Stamina"], ["Skarmory", "Weak Armor"], ["Drampa", "Berserk"], ["Klawf", "Anger Shell"],
    ["Bellibolt", "Electromorphosis"], ["Arboliva", "Seed Sower"], ["Sandaconda", "Sand Spit"], ["Glimmora", "Toxic Debris"], ["Baxcalibur", "Thermal Exchange"],
    ["Froslass", "Cursed Body"], ["Runerigus", "Wandering Spirit"], ["Cofagrigus", "Mummy"], ["Goodra", "Gooey"], ["Dragonite", "Multiscale"], ["Skarmory", "Sturdy"],
    ["Hatterene", "Magic Bounce"], ["Coalossal", "Steam Engine"], ["Kilowattrel", "Wind Power"]] as const)
    .flatMap(([species, ability]): [string, CaseMon][] => [[`${species} ${ability}`, mon(species, ability)], [`${species} ${ability} at 40`, mon(species, ability, { hp: 40 })]]),
];
const FILLS: [string, (m: CaseMon) => CaseMon][] = [
  ["empty", (m) => ({ ...m, absent: true, action: { move: null } })],
  ["Feraligatr", () => idle(mon("Feraligatr", "Sheer Force"))],
];
let throws = 0;
(async () => {
  for (const game of ["sv", "swsh"] as const) for (const [fill, make] of FILLS) for (const fainted of [true, false]) for (const [label, target] of TARGETS) {
    const c: Case = {
      id: `PROBE-${game}-${fill}-${fainted ? "fainted" : "bench"}-${label}`, game, outcomes: true, title: label,
      slots: slots(make(lax(2)), idle(lax(0)), idle(lax(12)), idle(carried(target, { futureMove: { move: "futuresight", bench: hatterene, benchSide: "own", ...(fainted ? { fainted: true as const } : {}) } }))),
    } as Case;
    const app = await appTurn(c);
    const result = app.result;
    const out = app.outcomes;
    const text = app.error ? `THROWS ${app.error.split("\n").slice(0, 2).join(" | ")}`
      : app.outcomesError ? `OUTCOMES THROW ${app.outcomesError.split("\n").slice(0, 2).join(" | ")}`
      : `${result?.status}${result?.status === "not-estimated" ? ` (${result.reason})` : ""}${result?.status === "issues" ? ` ${JSON.stringify(result.issues).slice(0, 160)}` : ""}`
        + (result?.status === "ready" ? ` | end ${result.endOfTurn.status === "ready" ? "ready" : JSON.stringify(result.endOfTurn).slice(0, 140)}` : "")
        + (out ? ` | outcomes ${out.status}` : "");
    if (/THROW/.test(text)) throws++;
    console.log(`${c.id}: ${text}`);
  }
  console.log(`throws ${throws}`);
})();

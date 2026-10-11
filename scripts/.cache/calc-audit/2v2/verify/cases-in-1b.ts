// status2 wave 1b (Track V2): the IN- cases of inputs.md §8 (ADDENDUM2 §7.2's merges) whose tracks run in wave 1b: M
// (IN-STL-04), E2 (IN-TLK, IN-FLD, IN-CUD, IN-FSL-01/03, IN-TNT, IN-HBK), PR (IN-RTL, IN-ECV), CL (IN-CPY); and the renamed
// T2E cases V1 did not build (IN-STL-05 from T2E IN-ST01/02: N; IN-SFG-02 from T2E IN-SG01: W), new in 1b. IN-BBD-02 is in
// cases-t2m-1b.ts (K). Probes: inputs-probes-1.ts (IN-Pnn), tier2-eot-training-probes-2.ts (TR…). Showdown names; level 50,
// 31 IVs, Serious nature, 0 EVs unless set (Champions: Stat Points). Wired into cases-se.ts through cases-wave1b.ts.
import type { Case, CaseMon, Game } from "./case-types";
import { OL, OR, PL, PR, act, carried, idle, mon, slots } from "./case-kit";
import { L, evs, fastEvs } from "./case-kit2";

const cases: Case[] = [];
const add = (id: string, games: Game[], make: (game: Game) => Omit<Case, "id" | "game">) => {
  for (const game of games) cases.push({ id: `${id}-${game}`, game, ...make(game) });
};
const tackle = (game: Game) => (game === "champions" ? "Body Slam" : "Tackle");

// ---- M: Max Guard with the stall counter (IN-P01's rule) ----
add("IN-STL-04", ["swsh"], () => ({
  title: "A Dynamaxed Snorlax's Max Guard with stall 3 (a protecting move last turn): it works 1/3; a foe's Max Move into it (IN-P01 rule)",
  slots: slots(act(carried(mon("Snorlax", "Thick Fat", { evs: { spe: 252 }, choice: "dynamax" }), { stall: 3 }), "Curse"), idle(L("swsh", 1)),
    idle(L("swsh", 3)), act(mon("Garchomp", "Rough Skin", { choice: "dynamax" }), "Dragon Claw", OL)),
  checks: "maxguard stallingMove: the stall volatile's 1/counter; fails 2/3 and Max Wyrmwind lands.",
}));
// ---- N (new in 1b): T2E's stall cases renamed (ADDENDUM2 §7.2) ----
add("IN-STL-05", ["sv", "champions"], (game) => ({
  title: "Detect with stall 9 (two protecting moves in a row ending last turn): it works 1/9 (T2E IN-ST01)",
  slots: slots(act(carried(mon("Blaziken", "Blaze", { evs: fastEvs(game) }), { stall: 9 }), "Detect"), idle(L(game, 0)),
    act(L(game, 2), tackle(game), OL), idle(L(game, 1))),
  checks: "conditions.ts stall onStallMove: randomChance(1, 9).",
}));
add("IN-STL-05b", ["sv", "champions"], (game) => ({
  title: "Detect with an explicit stall 1 (none last turn): it works, and no assumption fact (T2E IN-ST02, C23)",
  slots: slots(act(carried(mon("Blaziken", "Blaze", { evs: fastEvs(game) }), { stall: 1 }), "Detect"), idle(L(game, 0)),
    act(L(game, 2), tackle(game), OL), idle(L(game, 1))),
  checks: "No stall volatile: Detect is certain; no 'Assumes no protecting move was used last turn.'.",
}));
// ---- W (new in 1b): Safeguard from an earlier turn against status moves (T2E IN-SG01 → IN-SFG-02) ----
add("IN-SFG-02", ["champions", "sv"], (game) => ({
  title: "Safeguard up on the side from an earlier turn: a foe's Will-O-Wisp and Spore (Champions: Thunder Wave) into it fail (T2E IN-SG01)",
  field: { own: { safeguard: true } },
  slots: slots(idle(L(game, 3)), idle(L(game, 4)), game === "champions" ? act(mon("Clefable", "Magic Guard"), "Thunder Wave", OR) : act(mon("Amoonguss", "Effect Spore"), "Spore", OR),
    act(mon("Gengar", "Cursed Body", { evs: fastEvs(game) }), "Will-O-Wisp", OL)),
  checks: "safeguard condition onSetStatus: blocked for a foe's status move.",
}));

// ---- E2: Telekinesis turns left (IN-P06) ----
for (const left of [1, 2] as const) {
  add(`IN-TLK-0${left}`, ["usum"], () => ({
    title: `A drowsy Snorlax with Telekinesis (${left} turn${left > 1 ? "s" : ""} left) under Electric Terrain: ${left === 1 ? "it ends at 19, so the Yawn sleep at 23 meets the terrain: no sleep" : "still floating at 23: it falls asleep"} (IN-P06)`,
    field: { terrain: "Electric" },
    outcomes: true,
    slots: slots(idle(L("usum", 3)), idle(L("usum", 4)), idle(L("usum", 1)), idle(carried(L("usum", 0), { telekinesis: left, yawn: true }))),
    checks: "telekinesis residual order 19 ends it at duration 1; yawn's onEnd at 23 reads the grounding.",
  }));
}
// ---- E2: the field effects that end this turn (IN-P07, T2E §4.6.2) ----
add("IN-FLD-01", ["sv"], () => ({
  title: "Misty Terrain ends this turn (1 left): a grounded Flame Orb Snorlax is burned at 28.3 (IN-P07a)",
  field: { terrain: "Misty" }, fieldTurns: { terrain: 1 },
  outcomes: true,
  slots: slots(idle(L("sv", 3)), idle(L("sv", 4)), idle(L("sv", 1)), idle(L("sv", 0, { item: "Flame Orb" }))),
  checks: "The terrain ends at 27.7 before the Orb at 28.3.",
}));
add("IN-FLD-01", ["usum"], () => ({
  title: "Misty Terrain ends this turn (1 left): a grounded Toxic Orb Snorlax is badly poisoned at 28.3 (IN-P07a)",
  field: { terrain: "Misty" }, fieldTurns: { terrain: 1 },
  outcomes: true,
  slots: slots(idle(L("usum", 3)), idle(L("usum", 4)), idle(L("usum", 1)), idle(L("usum", 0, { item: "Toxic Orb" }))),
  checks: "The terrain's end before the Orb.",
}));
add("IN-FLD-01b", ["sv"], () => ({
  title: "Misty Terrain with 2 turns left: the Flame Orb is blocked (IN-P07a control)",
  field: { terrain: "Misty" }, fieldTurns: { terrain: 2 },
  outcomes: true,
  slots: slots(idle(L("sv", 3)), idle(L("sv", 4)), idle(L("sv", 1)), idle(L("sv", 0, { item: "Flame Orb" }))),
  checks: "The terrain stands at 28.3: no burn; E2 terrain turns 1.",
}));
add("IN-FLD-02", ["sv", "champions"], (game) => ({
  title: "Magic Room ends this turn (1 left): a Flame Orb Snorlax is burned and a Sitrus Snorlax at 100 HP eats at the final Update (IN-P07b, TR08)",
  field: { magicRoom: true }, fieldTurns: { magicRoom: 1 },
  outcomes: true,
  slots: slots(idle(L(game, 3)), idle(L(game, 4)), idle(L(game, 2, { item: "Sitrus Berry", hp: 100 })), idle(L(game, 0, game === "champions" ? { item: "Leftovers", hp: 150 } : { item: "Flame Orb" }))),
  checks: "Magic Room ends at 27.6: the Orb (28.3) and the final Update's Berry work; Leftovers (5.4) was still blocked (Champions has no Flame Orb).",
}));
add("IN-FLD-03", ["sv", "swsh"], (game) => ({
  title: "Gravity ends this turn (1 left) under Misty Terrain: a Flying Flame Orb Corviknight is no longer grounded at 28.3: burned (IN-P07c)",
  field: { terrain: "Misty", gravity: true }, fieldTurns: { gravity: 1 },
  outcomes: true,
  slots: slots(idle(L(game, 3)), idle(L(game, 4)), idle(L(game, 1)), idle(mon("Corviknight", "Pressure", { item: "Flame Orb" }))),
  checks: "Gravity ends at 27.2; Misty Terrain protects only the grounded.",
}));
add("IN-FLD-04", ["champions"], () => ({
  title: "Rain ends this turn (weatherTurns 1): Rain Dish heals before the rain's end? (existing rule)",
  field: { weather: "Rain" }, weatherTurns: 1,
  outcomes: true,
  slots: slots(idle(L("champions", 3)), idle(L("champions", 4)), idle(L("champions", 1)), idle(mon("Blastoise", "Rain Dish", { hp: 100 }))),
  checks: "The weather's countdown (order 1) ends the rain before Rain Dish (order 5.1... its own ability residual).",
}));
// ---- E2: Cud Chew (IN-P09) ----
add("IN-CUD-01", ["sv", "champions"], (game) => ({
  title: "Cud Chew re-eats the Sitrus Berry eaten last turn at 28.2 (IN-P09)",
  outcomes: true,
  slots: slots(idle(L(game, 3)), idle(L(game, 4)), idle(L(game, 1)), idle(carried(mon("Farigiraf", "Cud Chew", { hp: 70 }), { cudChew: "Sitrus Berry" }))),
  checks: "abilities.ts cudchew: the Berry's Eat with no item held.",
}));
// ---- E2: Future Sight landing (IN-P10) ----
add("IN-FSL-01", ["sv"], () => ({
  title: "Future Sight lands from its user at +2 Sp. Atk (gained after the use: it counts) (IN-P10)",
  slots: slots(idle(mon("Hatterene", "Magic Bounce", { nature: "Modest", evs: { spa: 252 }, boosts: { spa: 2 } })), idle(L("sv", 4)),
    idle(L("sv", 12)), idle(carried(L("sv", 8), { futureMove: { move: "futuresight", source: OL } }))),
  checks: "The source's stages as they stand at the landing.",
}));
add("IN-FSL-03", ["champions"], () => ({
  title: "Future Sight lands on the Pokémon standing at the slot after its Ally Switch (IN-P10 rule)",
  slots: slots(idle(mon("Hatterene", "Magic Bounce", { nature: "Modest", evs: { spa: 32 } })), idle(L("champions", 4)),
    idle(L("champions", 12)), act(carried(mon("Audino", "Regenerator", { evs: { spe: 32 } }), { futureMove: { move: "futuresight", source: OL } }), "Ally Switch")),
  checks: "getAtSlot: the Snorlax now at the slot is hit, not Audino.",
}));
// ---- E2: Taunt, Encore, Disable turns left (IN-P17) ----
for (const left of [1, 2] as const) {
  add(`IN-TNT-01${left === 1 ? "" : "b"}`, ["sv", "champions"], (game) => ({
    title: `A Snorlax taunted (${left} turn${left > 1 ? "s" : ""} left); Grimmsnarl Taunts it again: fails${left === 1 ? "; the Taunt ends at 15" : "; E2 taunt 1"} (IN-P17)`,
    outcomes: true,
    slots: slots(act(mon("Grimmsnarl", "Prankster"), "Taunt", PR), idle(L(game, 4)), idle(L(game, 1)), act(carried(L(game, 2), { taunt: left }), tackle(game), OL)),
    checks: "taunt has no onRestart: addVolatile false; residual order 15 counts it down.",
  }));
}
add("IN-TNT-02", ["sv"], () => ({
  title: "Encore with 2 turns left (Body Slam); a foe's Encore into it again fails; E2 encore 1 (IN-P17 rule)",
  outcomes: true,
  slots: slots(act(mon("Whimsicott", "Prankster"), "Encore", PR), idle(L("sv", 4)), idle(L("sv", 1)), act(carried(L("sv", 2, { lastMove: "Body Slam" }), { encore: { move: "Body Slam", turns: 2 } }), "Body Slam", OL)),
  checks: "encore: no restart; residual order 16.",
}));
add("IN-TNT-03", ["champions"], () => ({
  title: "Disable with 1 turn left (Body Slam disabled): its Protect works; the Disable ends at 17 (IN-P17 rule)",
  outcomes: true,
  slots: slots(idle(L("champions", 3)), idle(L("champions", 4)), idle(L("champions", 1)), act(carried(L("champions", 2, { moves: ["Body Slam"] }), { disable: { move: "Body Slam", turns: 1 } }), "Protect")),
  checks: "disable residual order 17: it ends.",
}));
// ---- E2: Heal Block turns left (IN-P15, CR01) ----
add("IN-HBK-01", ["sv"], () => ({
  title: "Heal Block (Psychic Noise) with 1 turn left: a Leftovers Snorlax gets none at 5.4; it ends at 20; its partner's Sitrus at the final Update (IN-P15)",
  outcomes: true,
  slots: slots(idle(L("sv", 3)), idle(L("sv", 4)), idle(carried(L("sv", 1, { item: "Sitrus Berry", hp: 100 }), { healBlock: 1 })), idle(carried(L("sv", 0, { item: "Leftovers", hp: 150 }), { healBlock: 1 }))),
  checks: "healblock residual order 20: Leftovers blocked before; the Sitrus eaten at the final Update after it ends.",
}));
add("IN-HBK-02", ["usum"], () => ({
  title: "Heal Block with 3 turns left under Grassy Terrain: no terrain heal; E2 healblock 2 (CR01 rule)",
  field: { terrain: "Grassy" },
  outcomes: true,
  slots: slots(idle(L("usum", 3)), idle(L("usum", 4)), idle(L("usum", 1)), idle(carried(L("usum", 0, { hp: 150 }), { healBlock: 3 }))),
  checks: "grassyterrain onResidual heal through TryHeal: blocked.",
}));
// ---- PR: Retaliate, Echoed Voice from last turn (IN-P12, IN-P13) ----
add("IN-RTL-01", ["sv", "swsh"], (game) => ({
  title: "Retaliate the turn after its side lost a Pokémon (faintedLastTurn): 140 into Garchomp (IN-P12)",
  faintedLastTurn: { own: true },
  slots: slots(act(mon("Arcanine", "Justified"), "Retaliate", PR), idle(L(game, 3)), idle(L(game, 1)), idle(mon("Garchomp", "Rough Skin", { evs: fastEvs(game) }))),
  checks: "side.faintedLastTurn: chainModify(2).",
}));
add("IN-RTL-01b", ["sv"], () => ({
  title: "Retaliate with no faint on its side last turn (faintedLastTurn false): 70 (IN-P12 control)",
  faintedLastTurn: { own: false },
  slots: slots(act(mon("Arcanine", "Justified"), "Retaliate", PR), idle(L("sv", 3)), idle(L("sv", 1)), idle(mon("Garchomp", "Rough Skin", { evs: { spe: 252 } }))),
  checks: "No doubling.",
}));
add("IN-ECV-01", ["sv", "swsh"], (game) => ({
  title: "Echoed Voice the turn after another Pokémon's (echoedVoice 1): Blissey's Echoed Voice at 80 (IN-P13)",
  echoedVoice: 1,
  slots: slots(idle(mon("Sylveon", "Cute Charm")), act(mon("Blissey", "Natural Cure"), "Echoed Voice", PR), idle(L(game, 1)), idle(mon("Garchomp", "Rough Skin"))),
  checks: "The echoedvoice pseudo-weather of any user: the multiplier 2.",
}));
// ---- CL: Copycat calls the battle's last move (IN-P11) ----
add("IN-CPY-01", ["sv"], () => ({
  title: "Copycat moving first calls last turn's last move (Ember, battleLastMove) at a random foe (IN-P11)",
  battleLastMove: "Ember",
  slots: slots(act(mon("Clefable", "Magic Guard", { evs: { spe: 252 } }), "Copycat"), idle(L("sv", 4)), idle(L("sv", 3)), idle(L("sv", 2))),
  checks: "battle.lastMove kept across turns. (SV has no Liepard: Clefable.)",
}));
add("IN-CPY-01", ["usum"], () => ({
  title: "Copycat moving first calls last turn's last move (Tackle, battleLastMove) at a random foe (IN-P11)",
  battleLastMove: "Tackle",
  slots: slots(act(mon("Liepard", "Limber", { evs: { spe: 252 } }), "Copycat"), idle(mon("Shuckle", "Sturdy")), idle(L("usum", 3)), idle(L("usum", 2))),
  checks: "battle.lastMove kept across turns.",
}));
add("IN-CPY-01b", ["sv"], () => ({
  title: "Copycat moving first with no move used in the battle yet (battleLastMove null): it fails",
  battleLastMove: null,
  slots: slots(act(mon("Clefable", "Magic Guard", { evs: { spe: 252 } }), "Copycat"), idle(L("sv", 4)), idle(L("sv", 3)), idle(L("sv", 2))),
  checks: "No lastMove: Copycat fails ('Copycat fails: no move has been used.').",
}));
void PL; void OR; void evs;
const _unused: CaseMon | undefined = undefined;
void _unused;

/** Wave 1b's IN- cases. */
export const IN_1B_CASES: Case[] = cases;

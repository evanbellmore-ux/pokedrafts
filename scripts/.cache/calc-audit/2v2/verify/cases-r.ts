// status2 wave 2 (Track R-V, ADDENDUM2 §7.2, §8.7; SPEC2 §4.8, §7.2): the switch-outs with a replacement. Each case gives a
// side's bench (Case.bench.{side}.members: DoublesTurnInput.bench), maybe the replacement (Case.replacement) and the hazards
// (CaseSide.hazards / layers: DoublesTurnInput.hazards). The oracle (sim-dfs.ts) answers each switch request from the bench
// and enumerates a random drag over it; compare.ts checks DoublesTurnResult.replaced and hpEntered, the end of turn's,
// the hits and residuals on a newcomer (DoublesHit.id, DoublesResidual.id) and E2's mons[slot].id and benched.
// Ids: G4-SWX-<n>-<game> (guards.md §5.4: 01–11 its list, 12– more of the family), IN-BNC- and IN-HZD- (inputs.md §8),
// IN-FSL-02 (inputs.md §8), T2P-AST- (Assist, tier2-presence.md §3.14), T2P-BTR- (Beat Up from the bench, §3.5 wave 2),
// T2E-BL- (the bench landings, tier2-eot-training.md §4.1.6), CQ-PUR-R- (Pursuit into a switching Pokémon, R-E's wave 2
// presence). Showdown names; level 50, 31 IVs, Serious nature, 0 EVs unless set (Champions: Stat Points). Pokémon from each
// game's app catalog (v1/pick.mjs): Champions has no Blissey (Clefable), no Eject Pack, no Weezing-Galar or Tatsugiri; SV
// has no Golisopod. Wired into cases-se.ts through cases-wave2.ts.
import type { Case, CaseBenchMon, CaseMon, Game } from "./case-types";
import { OL, OR, PL, PR, act, carried, idle, mon, slots } from "./case-kit";
import { L, fastEvs, slowest } from "./case-kit2";

const cases: Case[] = [];
/** One case per game: id `${id}-${game}`, E2 compared (outcomes) unless the case says otherwise. */
const add = (id: string, games: Game[], make: (game: Game) => Omit<Case, "id" | "game">) => {
  for (const game of games) cases.push({ id: `${id}-${game}`, game, outcomes: true, ...make(game) });
};
/** A bench member (its id is the app input's and the oracle set's name). */
const member = (id: string, m: CaseMon): CaseBenchMon => ({ ...m, id });
const bench = (own?: CaseBenchMon[], opponent?: CaseBenchMon[]): Case["bench"] => ({
  ...(own ? { own: { members: own } } : {}), ...(opponent ? { opponent: { members: opponent } } : {}),
});
const fast = (game: Game, m: CaseMon): CaseMon => ({ ...m, evs: { ...(m.evs ?? {}), ...fastEvs(game) } });
/** A second bench Pokémon that differs from a Snorlax: Blissey (Champions has none: Clefable). */
const bliss = (game: Game, extra: Partial<CaseMon> = {}) => (game === "champions" ? mon("Clefable", "Cute Charm", extra) : mon("Blissey", "Natural Cure", extra));
/** A fast U-turn user of the game: Ambipom (SV, USUM), Liepard (SwSh), Rillaboom (Champions). */
const uturner = (game: Game, extra: Partial<CaseMon> = {}) => fast(game, game === "swsh" ? mon("Liepard", "Limber", extra) : game === "champions" ? mon("Rillaboom", "Overgrow", extra) : mon("Ambipom", "Technician", extra));
const chomp = (extra: Partial<CaseMon> = {}) => mon("Garchomp", "Rough Skin", extra);

// ---------------------------------------------------------------------------------------------------------------------
// guards.md §5.4's G4-SWX cases (probes B1–B13), each in SV and another game where it exists
// ---------------------------------------------------------------------------------------------------------------------

add("G4-SWX-01", ["sv", "champions"], (game) => ({
  title: "U-turn brings in an Intimidate Incineroar mid-turn: the slower foe's Dragon Claw meets it at −1 Attack (B2)",
  slots: slots(act(fast(game, mon("Rillaboom", "Overgrow")), "U-turn", PL), idle(L(game, 1)), act(chomp(), "Dragon Claw", OL), idle(L(game, 3))),
  bench: bench([member("inci", mon("Incineroar", "Intimidate"))]),
  checks: "battle.ts:2876-2914 the switch request after U-turn; Intimidate at the newcomer's SwitchIn (runSwitch); Dragon Claw into the position meets Incineroar at −1.",
}));
add("G4-SWX-02", ["champions", "sv"], (game) => ({
  title: "Parting Shot with a chosen replacement (Corviknight, the second on the bench); the foe's slower Dragon Claw meets it at −1 Attack",
  slots: slots(act(fast(game, mon("Incineroar", "Blaze")), "Parting Shot", PL), idle(L(game, 1)), act(chomp(slowest(game)), "Dragon Claw", OL), idle(L(game, 3))),
  bench: bench([member("lax", L(game, 2)), member("corv", mon("Corviknight", "Pressure"))]),
  replacement: { [OL]: "corv" },
  checks: "moves.ts partingshot: −1 Atk −1 SpA, then selfSwitch; Case.replacement picks the second bench Pokémon; Dragon Claw into Steel.",
}));
add("G4-SWX-03", ["sv", "usum"], (game) => ({
  title: "Stealth Rock on its side: the U-turn's newcomer Charizard loses half its HP as it comes in; a later Body Slam into it (B3)",
  field: { own: { hazards: ["stealthrock"] } },
  slots: slots(act(uturner(game), "U-turn", PL), idle(L(game, 1)), act(L(game, 4), "Body Slam", OL), idle(L(game, 3))),
  bench: bench([member("zard", mon("Charizard", "Blaze"))]),
  checks: "conditions.ts stealthrock onSwitchIn: 1/8 × 4 (Rock into Fire/Flying) = 1/2 of 153.",
}));
add("G4-SWX-04", ["swsh", "sv"], (game) => ({
  title: "Roar drags in one of two bench Pokémon at random: each newcomer's Leftovers at the end of turn (B5)",
  slots: slots(act(mon("Arcanine", "Justified"), "Roar", PL), idle(L(game, 1)), act(L(game, 4), "Body Slam", OR), idle(L(game, 3))),
  bench: bench(undefined, [member("lax", { ...L(game, 2), item: "Leftovers", hp: 150 }), member("bliss", mon("Blissey", "Natural Cure", { item: "Leftovers", hp: 200 }))]),
  checks: "battle.ts getRandomSwitchable (sample): 1/2 each; the dragged Pokémon's Body Slam came first (Roar −6); Leftovers on the newcomer at 5.2.",
}));
add("G4-SWX-05", ["sv", "swsh"], (game) => ({
  title: "Icy Wind drops two Eject Pack holders: the first leaves at once, the second at the first newcomer's switch-in; a later Tackle meets the newcomer (B1)",
  slots: slots(act(fast(game, mon("Glalie", "Inner Focus")), "Icy Wind"), act(mon("Venusaur", "Overgrow"), "Tackle", PL),
    idle({ ...L(game, 4), item: "Eject Pack" }), idle(mon("Torkoal", "Shell Armor", { item: "Eject Pack" }))),
  bench: bench(undefined, [member("lax", L(game, 2)), member("bliss", mon("Blissey", "Natural Cure"))]),
  checks: "items.ts ejectpack onAfterBoost / onAnySwitchIn (effectState.eject): two switch requests; the default replacements in bench order.",
}));
add("G4-SWX-06", ["usum", "sv"], (game) => ({
  title: "U-turn brings in Drought Torkoal: Chlorophyll Venusaur's later move is re-sorted ahead of Garchomp from generation 8 (SV), not in USUM (B7)",
  slots: slots(act(fast(game, mon("Ambipom", "Technician")), "U-turn", PR), act(mon("Venusaur", "Chlorophyll"), "Tackle", PL),
    act(chomp(), "Dragon Claw", OR), idle(L(game, 3))),
  bench: bench([member("tork", mon("Torkoal", "Drought"))]),
  checks: "battle.ts:2908-2913 (gen ≥ 8: updateSpeed and queue.sort after each action); USUM keeps the turn's order.",
}));
add("G4-SWX-07", ["sv", "champions"], (game) => ({
  title: "Regenerator: Galarian Slowking's Chilly Reception after the foe's Dragon Claw; it leaves healed by a third (B6)",
  slots: slots(act(mon("Slowking-Galar", "Regenerator", { hp: 120 }), "Chilly Reception"), idle(L(game, 1)), act(chomp(), "Dragon Claw", OL), idle(L(game, 3))),
  bench: bench([member("corv", mon("Corviknight", "Pressure"))]),
  checks: "abilities.ts regenerator onSwitchOut: heal floor(maxhp / 3); moves.ts chillyreception: Snow, then selfSwitch.",
}));
add("G4-SWX-08", ["champions", "sv"], (game) => ({
  title: "Eject Button: Garchomp's Dragon Claw sends the holder out before its Body Slam; the newcomer takes the later Body Slam",
  slots: slots(act(fast(game, chomp()), "Dragon Claw", PL), act(L(game, 1), "Body Slam", PL),
    act({ ...L(game, 4), item: "Eject Button" }, "Body Slam", OL), idle(L(game, 3))),
  bench: bench(undefined, [member("corv", mon("Corviknight", "Pressure")), member("bliss", bliss(game))]),
  checks: "items.ts ejectbutton onAfterMoveSecondary: the holder's switch request; its queued Body Slam cancelled; the first bench Pokémon by default.",
}));
add("G4-SWX-09", ["sv", "usum"], (game) => ({
  title: "Baton Pass passes +2 Attack and +1 evasion to the newcomer; the foe's Dragon Claw meets it (B4a)",
  slots: slots(act(fast(game, mon("Ambipom", "Technician", { boosts: { atk: 2 }, carried: { stages: { evasion: 1 } } })), "Baton Pass"), idle(L(game, 1)),
    act(chomp(), "Dragon Claw", OL), idle(L(game, 3))),
  bench: bench([member("lax", L(game, 2))]),
  checks: "pokemon.ts copyVolatileFrom (selfSwitch copyvolatile): the boosts, accuracy and evasion included.",
}));
add("G4-SWX-10", ["champions", "swsh"], (game) => ({
  title: "Golisopod's Emergency Exit after Garchomp's Dragon Claw takes it below half: it leaves before its own move; the newcomer takes the later Body Slam (B10)",
  slots: slots(act(fast(game, chomp()), "Dragon Claw", PL), act(L(game, 1), "Body Slam", PL),
    act(mon("Golisopod", "Emergency Exit", { hp: 90 }), "Rock Slide"), idle(L(game, 3))),
  bench: bench(undefined, [member("lax", L(game, 2)), member("bliss", bliss(game))]),
  checks: "abilities.ts emergencyexit onEmergencyExit (battle.ts:2862-2869): the switch request; its Rock Slide cancelled.",
}));
add("G4-SWX-11", ["sv", "swsh"], (game) => ({
  title: "Red Card drags the attacker's side's bench in at random (two Pokémon); the foe's later Body Slam meets the newcomer (B9)",
  slots: slots(act(fast(game, chomp()), "Dragon Claw", PL), idle(L(game, 1)), act({ ...L(game, 4), item: "Red Card" }, null), act(L(game, 3), "Body Slam", OL)),
  bench: bench([member("lax", { ...L(game, 2), hp: 180 }), member("bliss", mon("Blissey", "Natural Cure"))]),
  checks: "items.ts redcard onAfterMoveSecondary forceSwitchFlag → dragIn (sample over the living bench).",
}));
// ---- more of the family ----
add("G4-SWX-12", ["champions", "usum"], (game) => ({
  title: "Emergency Exit after the residual: a burned Golisopod falls below half at the burn; its replacement comes in after the turn and meets Stealth Rock",
  field: { opponent: { hazards: ["stealthrock"] } },
  slots: slots(act(L(game, 4), "Body Slam", PR), idle(L(game, 1)), idle(mon("Golisopod", "Emergency Exit", { hp: 80, status: "brn" })), idle(L(game, 3))),
  bench: bench(undefined, [member("lax", { ...L(game, 2), hp: 200 })]),
  checks: "battle.ts:2858-2869 the residual's Emergency Exit; the switch after the turn (DoublesEndOfTurn.replaced) and the newcomer's Stealth Rock (endOfTurn.hpEntered).",
}));
add("G4-SWX-13", ["sv"], () => ({
  title: "Eject Pack at the end of turn: Syrup Bomb's Speed drop sends the holder out after the residual",
  slots: slots(idle(L("sv", 4)), idle(L("sv", 1)), idle(carried({ ...L("sv", 2), item: "Eject Pack" }, { syrupBomb: OL })), idle(L("sv", 3))),
  bench: bench(undefined, [member("lax", { ...L("sv", 5), hp: 150 })]),
  checks: "moves.ts syrupbomb condition onResidual (−1 Spe) → items.ts ejectpack: the switch after the turn.",
}));
add("G4-SWX-13", ["swsh"], () => ({
  title: "Eject Pack at the end of turn: Octolock's drops send the holder out after the residual",
  slots: slots(idle(mon("Grapploct", "Technician")), idle(L("swsh", 1)), idle(carried({ ...L("swsh", 2), item: "Eject Pack" }, { octolock: OL })), idle(L("swsh", 3))),
  bench: bench(undefined, [member("lax", { ...L("swsh", 5), hp: 150 })]),
  checks: "moves.ts octolock condition onResidual (−1 Def −1 SpD) → items.ts ejectpack: the switch after the turn.",
}));
add("G4-SWX-14", ["sv", "swsh"], (game) => ({
  title: "A foe's Neutralizing Gas stays in: the U-turn's newcomer Incineroar has no Intimidate; the foe's Body Slam meets it at full Attack",
  slots: slots(act(uturner(game), "U-turn", PR), idle(L(game, 1)), act(mon("Weezing-Galar", "Neutralizing Gas"), game === "sv" ? "Body Slam" : "Tackle", OL), idle(L(game, 3))),
  // Incineroar at Speed 81, apart from Weezing-Galar's 80 (no tie).
  bench: bench([member("inci", mon("Incineroar", "Intimidate", { evs: { spe: 8 } }))]),
  checks: "abilities.ts neutralizinggas: the newcomer's ability suppressed (no Intimidate at its SwitchIn).",
}));
add("G4-SWX-15", ["sv", "swsh"], (game) => ({
  title: "A Neutralizing Gas newcomer mid-turn (the kept reason)",
  slots: slots(act(uturner(game), "U-turn", PR), idle(L(game, 1)), act(L(game, 4), "Body Slam", OL), idle(L(game, 3))),
  bench: bench([member("weez", mon("Weezing-Galar", "Neutralizing Gas"))]),
  notEstimated: "Weezing-Galar's Neutralizing Gas coming in is not modelled in 2v2.",
  checks: "SPEC2 §4.8 entersWithGas: a gas holder coming in ends the others' abilities (Q5's family): kept.",
}));
add("G4-SWX-16", ["sv", "champions"], (game) => ({
  title: "An Imposter Ditto comes in for the U-turn user and transforms into the foe across (Garchomp); Garchomp's Dragon Claw is super effective on it",
  // A Choice Scarf keeps the Garchomp apart from its copy's Speed (Transform copies the stats, not the item).
  slots: slots(act(uturner(game), "U-turn", PR), idle(L(game, 1)), act(chomp({ ...slowest(game), item: "Choice Scarf" }), "Dragon Claw", OL), idle(L(game, 3))),
  bench: bench([member("ditto", mon("Ditto", "Imposter"))]),
  checks: "abilities.ts imposter onSwitchIn: transformInto(foe.active[length - 1 - position]) = the opponent's left Pokémon (p2b).",
}));
add("G4-SWX-17", ["sv", "champions"], (game) => ({
  title: "A Drizzle newcomer mid-turn: the later Flamethrower is weakened by rain and the newcomer takes a Rock Slide (B11)",
  slots: slots(act(uturner(game), "U-turn", PR), idle(L(game, 1)), act(chomp(slowest(game)), "Rock Slide"), act(L(game, 3), "Flamethrower", OR)),
  bench: bench([member("peli", mon("Pelipper", "Drizzle"))]),
  checks: "abilities.ts drizzle onStart at the newcomer's SwitchIn: rain ×0.5 on Fire; Rock Slide's spread hits the position's newcomer.",
}));
add("G4-SWX-18", ["sv", "usum"], (game) => ({
  title: "Both Pokémon of a side U-turn: the second takes the next bench Pokémon; a paralysed Natural Cure leaver is cured as it leaves",
  slots: slots(act(fast(game, game === "usum" ? mon("Celebi", "Natural Cure", { status: "par" }) : mon("Comfey", "Natural Cure", { status: "par" })), "U-turn", PL),
    act(mon("Ambipom", "Technician"), "U-turn", PR), idle(L(game, 4)), idle(L(game, 3))),
  bench: bench([member("lax", L(game, 2)), member("bliss", mon("Blissey", "Natural Cure"))]),
  checks: "abilities.ts naturalcure onSwitchOut; full paralysis 1/4 (no switch then); the second switcher's default is the next bench Pokémon.",
}));
add("G4-SWX-19", ["sv", "champions"], (game) => ({
  title: "Shed Tail passes its Substitute to the newcomer; the foe's Body Slam hits the Substitute",
  slots: slots(act(fast(game, game === "champions" ? mon("Sceptile", "Overgrow") : mon("Cyclizar", "Regenerator")), "Shed Tail"), idle(L(game, 1)),
    act(L(game, 4), "Body Slam", OL), idle(L(game, 3))),
  bench: bench([member("lax", L(game, 2))]),
  checks: "moves.ts shedtail: the user pays half its HP, the Substitute (1/4 of its max HP) passes (switchCopyFlag 'shedtail').",
}));
add("G4-SWX-20", ["sv"], () => ({
  title: "A Tatsugiri newcomer beside its side's Dondozo (Commander, the kept reason)",
  slots: slots(act(uturner("sv"), "U-turn", PR), idle(mon("Dondozo", "Unaware")), act(L("sv", 4), "Body Slam", OL), idle(L("sv", 3))),
  bench: bench([member("tats", mon("Tatsugiri", "Commander"))]),
  notEstimated: "Commander is not modelled in 2v2.",
  checks: "SPEC2 §4.8: Commander keeps notIn2v2(\"Commander\") for a newcomer pair.",
}));
add("G4-SWX-21", ["swsh", "usum"], (game) => ({
  title: "Teleport (−6) after the moves: the newcomer comes in before the residual and its Leftovers act",
  slots: slots(act(mon("Arcanine", "Justified"), "Teleport"), idle(L(game, 1)), act(L(game, 4), "Body Slam", OL), idle(L(game, 3))),
  bench: bench([member("lax", { ...L(game, 2), item: "Leftovers", hp: 150 })]),
  checks: "moves.ts teleport (gen ≥ 8 selfSwitch, priority −6; USUM: it fails in a trainer battle, no switch).",
}));
add("G4-SWX-22", ["sv", "champions"], (game) => ({
  title: "Volt Switch into a Ground-type Garchomp: no switch; Dragon Tail later drags a foe out at random",
  slots: slots(act(fast(game, mon("Jolteon", "Volt Absorb")), "Volt Switch", PL), idle(L(game, 1)),
    act(chomp(), "Dragon Tail", OR), idle(L(game, 3))),
  bench: bench([member("lax", { ...L(game, 2), hp: 150 }), member("bliss", bliss(game, { hp: 120 }))], [member("olax", L(game, 5))]),
  checks: "Volt Switch fails into the immune target (no selfSwitch); Dragon Tail (−6) drags the target's side's bench at random.",
}));
add("G4-SWX-23", ["sv", "usum"], (game) => ({
  title: "U-turn into an Eject Button holder: the holder leaves, the U-turn user stays (B8)",
  slots: slots(act(uturner(game), "U-turn", PL), idle(L(game, 1)), act({ ...L(game, 4), item: "Eject Button" }, "Body Slam", OR), act(L(game, 3), "Body Slam", PL)),
  bench: bench([member("own", L(game, 5))], [member("lax", L(game, 2))]),
  checks: "items.ts ejectbutton: the holder's switchFlag; the U-turn user's selfSwitch is cancelled (battle-actions.ts: another switch already pending).",
}));
add("G4-SWX-24", ["sv", "swsh"], (game) => ({
  title: "Parting Shot into an Eject Pack holder: its drops set off no Eject Pack; the user switches (B12)",
  slots: slots(act(fast(game, mon("Incineroar", "Blaze")), "Parting Shot", PL), idle(L(game, 1)), act({ ...L(game, 4), item: "Eject Pack" }, "Body Slam", OL), idle(L(game, 3))),
  bench: bench([member("corv", mon("Corviknight", "Pressure"))], [member("lax", L(game, 2))]),
  checks: "items.ts ejectpack onAfterBoost: not for Parting Shot (effect.id === 'partingshot'); the user switches; Body Slam meets the newcomer.",
}));
add("G4-SWX-25", ["sv"], () => ({
  title: "An Eject Button sends a Neutralizing Gas holder out: the gas ends as it leaves (the kept reason, B13)",
  slots: slots(idle(mon("Weezing-Galar", "Neutralizing Gas", { item: "Eject Button" })), idle(L("sv", 1)), act(fast("sv", chomp()), "Body Slam", OL), idle(mon("Incineroar", "Intimidate", { evs: { spe: 8 } }))),
  bench: bench([member("lax", L("sv", 2))]),
  notEstimated: "Neutralizing Gas ending is not modelled in 2v2.",
  checks: "SPEC2 §4.8 (B13): gasEnds stays for an ending gas while a Pokémon it suppressed is still in (Q5).",
}));

add("G4-SWX-26", ["sv", "champions"], (game) => ({
  title: "The U-turn user faints to Rough Skin: no switch (its replacement is the next turn's); the later Body Slam aimed at it goes to its ally's foe-side partner",
  slots: slots(act(uturner(game, { hp: 10 }), "U-turn", PL), idle(L(game, 1)), act(chomp(), "Body Slam", OL), idle(L(game, 3))),
  bench: bench([member("lax", L(game, 2))]),
  checks: "battle-actions.ts selfSwitch only for a user with HP; the fainted Pokémon's replacement after the residual is not a switch-out (not answered).",
}));
add("G4-SWX-27", ["sv", "champions"], (game) => ({
  title: "Volt Switch into a Snorlax: the user switches; the newcomer takes the later Body Slam",
  slots: slots(act(fast(game, mon("Jolteon", "Volt Absorb")), "Volt Switch", PL), idle(L(game, 1)), act(L(game, 4), "Body Slam", OL), idle(L(game, 3))),
  bench: bench([member("corv", mon("Corviknight", "Pressure"))]),
  checks: "moves.ts voltswitch selfSwitch after the hit.",
}));
add("G4-SWX-28", ["sv", "champions"], (game) => ({
  title: "Flip Turn: the user switches; the newcomer takes the later Body Slam",
  slots: slots(act(fast(game, mon("Milotic", "Marvel Scale")), "Flip Turn", PL), idle(L(game, 1)), act(L(game, 4), "Body Slam", OL), idle(L(game, 3))),
  bench: bench([member("corv", mon("Corviknight", "Pressure"))]),
  checks: "moves.ts flipturn selfSwitch after the hit.",
}));
add("G4-SWX-29", ["swsh", "usum"], (game) => ({
  title: "Wimp Out mid-turn: Wimpod falls below half to Garchomp's Body Slam and leaves; the newcomer takes the later Body Slam",
  slots: slots(act(fast(game, chomp()), "Body Slam", PL), act(L(game, 1), "Body Slam", PL), idle(mon("Wimpod", "Wimp Out")), idle(L(game, 3))),
  bench: bench(undefined, [member("lax", L(game, 2))]),
  checks: "abilities.ts wimpout onEmergencyExit (as Emergency Exit).",
}));
add("G4-SWX-30", ["sv", "swsh"], (game) => ({
  title: "The U-turn's Intimidate newcomer sets off a foe's Eject Pack: the foe leaves at the newcomer's switch-in; the later Tackle meets the foe's newcomer",
  slots: slots(act(uturner(game), "U-turn", PR), act(mon("Venusaur", "Overgrow"), "Tackle", PL), idle({ ...L(game, 4), item: "Eject Pack" }), idle(L(game, 3))),
  bench: bench([member("inci", mon("Incineroar", "Intimidate", { evs: { spe: 8 } }))], [member("lax", L(game, 2))]),
  checks: "Intimidate at the SwitchIn (runSwitch) → items.ts ejectpack onAfterBoost: a second switch request (the opponent's), answered before the next move.",
}));

// ---------------------------------------------------------------------------------------------------------------------
// inputs.md §8 (wave 2): the Bench and Replacement controls (IN-BNC) and the hazards (IN-HZD)
// ---------------------------------------------------------------------------------------------------------------------

add("IN-BNC-01", ["sv", "champions"], (game) => ({
  title: "U-turn with a two-Pokémon bench and no Replacement chosen: the first comes in (the turn fact)",
  slots: slots(act(uturner(game), "U-turn", PL), idle(L(game, 1)), act(L(game, 4), "Body Slam", OL), idle(L(game, 3))),
  bench: bench([member("lax", { ...L(game, 2), hp: 200 }), member("corv", mon("Corviknight", "Pressure"))]),
  checks: "IN §5.7: the default replacement is the first bench Pokémon, \"Assumes {Newcomer} comes in for {Name}.\"",
}));
add("IN-BNC-02", ["sv", "champions"], (game) => ({
  title: "Parting Shot with the second bench Pokémon chosen as its Replacement (no fact)",
  slots: slots(act(fast(game, mon("Incineroar", "Blaze")), "Parting Shot", PL), idle(L(game, 1)), act(L(game, 4), "Body Slam", OL), idle(L(game, 3))),
  bench: bench([member("lax", L(game, 2)), member("corv", mon("Corviknight", "Pressure"))]),
  replacement: { [OL]: "corv" },
  checks: "IN §5.7: Replacement set: no default fact; Corviknight comes in.",
}));
add("IN-HZD-01", ["sv"], () => ({
  title: "Stealth Rock and two layers of Spikes on the newcomer Arcanine (1/4 + 1/6); a later Body Slam into it",
  field: { own: { hazards: ["stealthrock", "spikes"], layers: { spikes: 2 } } },
  slots: slots(act(uturner("sv"), "U-turn", PL), idle(L("sv", 1)), act(L("sv", 4), "Body Slam", OL), idle(L("sv", 3))),
  bench: bench([member("arca", mon("Arcanine", "Justified"))]),
  checks: "conditions.ts stealthrock (Rock ×2 into Fire: 1/4), spikes (2 layers: 1/6), both at the newcomer's SwitchIn.",
}));
add("IN-HZD-01", ["swsh"], () => ({
  title: "G-Max Steelsurge and one layer of Spikes on the newcomer Snorlax (1/8 + 1/8)",
  field: { own: { hazards: ["gmaxsteelsurge", "spikes"] } },
  slots: slots(act(uturner("swsh"), "U-turn", PL), idle(L("swsh", 1)), act(L("swsh", 4), "Body Slam", OL), idle(L("swsh", 3))),
  bench: bench([member("lax", L("swsh", 2))]),
  checks: "moves.ts gmaxsteelsurge condition onSwitchIn: Steel-type Stealth Rock; spikes 1/8.",
}));
add("IN-HZD-02", ["sv", "usum"], (game) => ({
  title: "Toxic Spikes poison the newcomer (SV: two layers, bad poison; USUM: one, poison); the end of turn's poison on it",
  field: { own: { hazards: ["toxicspikes"], layers: { toxicSpikes: game === "sv" ? 2 : 1 } } },
  slots: slots(act(uturner(game), "U-turn", PL), idle(L(game, 1)), idle(L(game, 4)), idle(L(game, 3))),
  bench: bench([member("lax", L(game, 2))]),
  checks: "conditions.ts toxicspikes onSwitchIn: layers ≥ 2 tox, else psn; the newcomer's poison at the residual.",
}));
add("IN-HZD-03", ["sv", "usum"], (game) => ({
  title: "A grounded Poison-type newcomer (Toxapex) absorbs the Toxic Spikes",
  field: { own: { hazards: ["toxicspikes"] } },
  slots: slots(act(uturner(game), "U-turn", PL), idle(L(game, 1)), act(L(game, 4), "Body Slam", OL), idle(L(game, 3))),
  bench: bench([member("pex", mon("Toxapex", "Limber"))]),
  checks: "conditions.ts toxicspikes onSwitchIn: a grounded Poison type removes them (E2 hazards).",
}));
add("IN-HZD-04", ["sv", "champions"], (game) => ({
  title: "Sticky Web on a Defiant newcomer (Kingambit): −1 Speed and Defiant's +2 Attack",
  field: { own: { hazards: ["stickyweb"] } },
  slots: slots(act(uturner(game), "U-turn", PL), idle(L(game, 1)), act(L(game, 4), "Body Slam", OL), idle(L(game, 3))),
  bench: bench([member("gambit", mon("Kingambit", "Defiant"))]),
  checks: "conditions.ts stickyweb onSwitchIn: boost spe −1 from the web's side (a foe's drop: Defiant +2).",
}));
add("IN-HZD-05", ["sv", "swsh"], (game) => ({
  title: "Heavy-Duty Boots: the newcomer takes no Stealth Rock or Spikes",
  field: { own: { hazards: ["stealthrock", "spikes"] } },
  slots: slots(act(uturner(game), "U-turn", PL), idle(L(game, 1)), act(L(game, 4), "Body Slam", OL), idle(L(game, 3))),
  bench: bench([member("zard", mon("Charizard", "Blaze", { item: "Heavy-Duty Boots" }))]),
  checks: "items.ts heavydutyboots: hazards' onSwitchIn skip the holder.",
}));

// ---------------------------------------------------------------------------------------------------------------------
// inputs.md §8 IN-FSL-02 and T2E's bench landings (tier2-eot-training.md §4.1.6: under R the source may be a bench Pokémon
// of DoublesTurnInput.bench, and a landing or a Wish meets whoever stands at the position: a newcomer)
// ---------------------------------------------------------------------------------------------------------------------

add("IN-FSL-02", ["sv", "champions"], (game) => ({
  title: "Future Sight lands from a user on the bench (a bench Pokémon of the input): no item, ability or stages",
  slots: slots(idle(L(game, 2)), idle(L(game, 4)), idle(L(game, 12)), idle(carried(L(game, 8), { futureMove: { move: "futuresight", benchId: "hatt", benchSide: "own" } }))),
  bench: bench([member("hatt", mon("Hatterene", "Magic Bounce", { item: "Twisted Spoon", nature: "Modest", evs: game === "champions" ? { spa: 32 } : { spa: 252 } }))]),
  checks: "conditions.ts futuremove onEnd from the inactive source (pokemon.ts ignoringItem / ignoringAbility while not active).",
}));
add("T2E-BL-01", ["sv", "champions"], (game) => ({
  title: "Future Sight lands on the position of a Pokémon that U-turned out: its newcomer takes it",
  slots: slots(idle(mon("Hatterene", "Magic Bounce")), idle(L(game, 4)), idle(L(game, 12)), act(carried(uturner(game), { futureMove: { move: "futuresight", source: OL } }), "U-turn", OR)),
  bench: bench(undefined, [member("lax", L(game, 2))]),
  checks: "conditions.ts futuremove is a slot condition (positional): it hits whoever stands at the position at the residual.",
}));
add("T2E-BL-02", ["sv", "usum"], (game) => ({
  title: "Wish lands on the position of a Pokémon that U-turned out: its hurt newcomer is healed",
  slots: slots(idle(L(game, 4)), idle(L(game, 1)), act(carried(uturner(game), { wish: 100 }), "U-turn", OR), idle(L(game, 3))),
  bench: bench(undefined, [member("lax", { ...L(game, 2), hp: 100 })]),
  checks: "moves.ts wish slot condition onResidual (positional): the newcomer at the position heals 100.",
}));
add("T2E-BL-03", ["sv", "champions"], (game) => ({
  title: "Future Sight's user leaves by Chilly Reception before its landing: it lands with no item and no ability (the user on the bench)",
  slots: slots(act(mon("Slowking-Galar", "Regenerator", { item: "Twisted Spoon", nature: "Modest", evs: game === "champions" ? { spa: 32 } : { spa: 252 } }), "Chilly Reception"),
    idle(L(game, 4)), idle(L(game, 12)), idle(carried(L(game, 8), { futureMove: { move: "futuresight", source: OL } }))),
  bench: bench([member("lax", L(game, 2))]),
  checks: "The landing's source on the bench at the residual: pokemon.ts ignoringItem (not active); Snow from Chilly Reception.",
}));

// ---------------------------------------------------------------------------------------------------------------------
// T2P: Assist from the bench's moves (USUM; tier2-presence.md §3.14) and Beat Up from the bench (§3.5, wave 2)
// ---------------------------------------------------------------------------------------------------------------------

add("T2P-AST-01", ["usum"], () => ({
  title: "Assist calls one of the party's moves (the ally's Body Slam, a bench Arcanine's Flamethrower, a bench Snorlax's Ice Beam) at random",
  slots: slots(act(mon("Liepard", "Limber"), "Assist"), act(L("usum", 1, { exactMoves: true }), "Body Slam", PL), idle(L("usum", 4)), idle(L("usum", 3))),
  bench: bench([member("arca", mon("Arcanine", "Justified", { moves: ["Flamethrower"] })), member("lax", L("usum", 2, { moves: ["Ice Beam"] }))]),
  checks: "moves.ts assist onHit: every move slot of the other party members but noassist ones, sample; the called move at a random foe.",
}));
add("T2P-AST-02", ["usum"], () => ({
  title: "Assist with noassist moves on the bench (Protect, Roar) and a status move (Will-O-Wisp): Thunderbolt, Will-O-Wisp or the ally's Body Slam",
  slots: slots(act(mon("Liepard", "Limber"), "Assist"), act(L("usum", 1, { exactMoves: true }), "Body Slam", PL), idle(L("usum", 4)), idle(L("usum", 3))),
  bench: bench([member("arca", mon("Arcanine", "Justified", { moves: ["Protect", "Roar", "Will-O-Wisp"] })), member("lax", L("usum", 2, { moves: ["Thunderbolt", "Protect"] }))]),
  checks: "Protect and Roar carry noassist (gen 7 data); three callable moves at 1/3.",
}));
add("T2P-BTR-01", ["sv", "champions"], (game) => ({
  title: "Beat Up counts the bench: the user, its ally and the healthy bench Pokémon hit; the paralysed one does not",
  slots: slots(act(mon("Houndoom", "Flash Fire"), "Beat Up", PL), idle(L(game, 1)), idle(L(game, 4)), idle(L(game, 3))),
  bench: bench([member("arca", mon("Arcanine", "Justified")), member("lax", L(game, 2, { status: "par" }))]),
  checks: "moves.ts beatup onModifyMove: side.pokemon alive with no status (the user always), in party order: 5 + floor(base Atk / 10) each.",
}));
add("T2P-BTR-01", ["swsh"], () => ({
  title: "SwSh: Beat Up counts the bench (Charizard's): the user, its ally and the healthy bench Pokémon",
  slots: slots(act(mon("Charizard", "Blaze"), "Beat Up", PL), idle(L("swsh", 1)), idle(L("swsh", 4)), idle(L("swsh", 3))),
  bench: bench([member("arca", mon("Arcanine", "Justified")), member("lax", L("swsh", 2, { status: "par" }))]),
  checks: "moves.ts beatup over the bench.",
}));

// ---------------------------------------------------------------------------------------------------------------------
// Pursuit into a Pokémon that switches out (USUM; R-E's doubles-presence.ts: Pursuit meeting a switching target at 80)
// ---------------------------------------------------------------------------------------------------------------------

add("CQ-PUR-R-01", ["usum"], () => ({
  title: "Pursuit into the U-turn user as it switches: Houndoom's Pursuit runs at its BeforeSwitchOut with 80 power",
  slots: slots(act(fast("usum", mon("Ambipom", "Technician")), "U-turn", PL), idle(L("usum", 1)), act(mon("Houndoom", "Flash Fire"), "Pursuit", OL), idle(L("usum", 3))),
  bench: bench([member("lax", L("usum", 2))]),
  checks: "moves.ts pursuit condition onFoeBeforeSwitchOut: its action cancelled and run now; basePowerCallback ×2 (switchFlag).",
}));
add("CQ-PUR-R-01", ["usum"], () => ({
  // second USUM case of the pair (ids differ by the suffix b).
  title: "Pursuit aimed at the other foe: the U-turn user's BeforeSwitchOut still draws it (any adjacent foe switching)",
  slots: slots(act(fast("usum", mon("Ambipom", "Technician")), "U-turn", PL), idle(L("usum", 1)), act(mon("Houndoom", "Flash Fire"), "Pursuit", OR), idle(L("usum", 3))),
  bench: bench([member("lax", L("usum", 2))]),
  checks: "moves.ts pursuit condition onFoeBeforeSwitchOut: any adjacent foe switching out, at its position.",
}));

// The second CQ-PUR-R-01 entry gets its own id.
{
  const twins = cases.filter((c) => c.id === "CQ-PUR-R-01-usum");
  if (twins.length === 2) twins[1].id = "CQ-PUR-R-02-usum";
}

export const R_CASES: Case[] = cases;

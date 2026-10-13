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

// ---------------------------------------------------------------------------------------------------------------------
// The R-V finish (cloud session): the triggers of census-guards.md §4 without a stored case (Whirlwind, Circle Throw, Teleport
// in SV) and the entry effects of SPEC2 §4.8 / guards.md §5.4 step 6 that only R-E's quick probes held (a Seed, Booster
// Energy, Hospitality, Trace, Unnerve, Air Balloon, Download, a terrain setter, Supersweet Syrup, Cloud Nine, Curious Medicine,
// Costar, Intrepid Sword once used, Wind Rider, Screen Cleaner), a leaver's Zero to Hero, drags that Guard Dog, Ingrain and
// Suction Cups stop, and Dragon Tail into an Eject Button. Each in SV and one other game where it exists (Booster Energy,
// Costar, Wind Rider: SV only; Suction Cups: SwSh and USUM, no holder in SV; Screen Cleaner: Champions and SwSh).
// ---------------------------------------------------------------------------------------------------------------------

add("G4-SWX-21", ["sv"], () => ({
  title: "Teleport (−6) after the moves: the newcomer comes in before the residual and its Leftovers act",
  slots: slots(act(mon("Gardevoir", "Synchronize"), "Teleport"), idle(L("sv", 1)), act(L("sv", 4), "Body Slam", OL), idle(L("sv", 3))),
  bench: bench([member("lax", { ...L("sv", 2), item: "Leftovers", hp: 150 })]),
  checks: "moves.ts:19168 teleport (selfSwitch, priority −6, onTry canSwitch): the switch request after the action; Leftovers on the newcomer at 5.2.",
}));
add("G4-SWX-31", ["sv", "champions"], (game) => ({
  title: "Whirlwind drags in one of two bench Pokémon at random onto Stealth Rock (Snorlax an eighth, Charizard a half); each newcomer's Leftovers",
  field: { opponent: { hazards: ["stealthrock"] } },
  slots: slots(act(mon("Skarmory", "Keen Eye"), "Whirlwind", PR), idle(L(game, 1)), act(L(game, 4), "Body Slam", OL), idle(L(game, 3))),
  bench: bench(undefined, [member("lax", { ...L(game, 2), item: "Leftovers", hp: 150 }), member("zard", mon("Charizard", "Blaze", { item: "Leftovers" }))]),
  checks: "moves.ts:20761 whirlwind (forceSwitch, −6): battle.ts getRandomSwitchable (sample) 1/2 each; conditions.ts stealthrock onSwitchIn on the dragged newcomer; Leftovers at 5.2.",
}));
add("G4-SWX-32", ["sv", "champions"], (game) => ({
  title: "Circle Throw drags in one of two bench Pokémon at random: Intimidate Incineroar lowers Lucario's and its ally's Attack, or a hurt Snorlax's Leftovers heal it",
  slots: slots(act(mon("Lucario", "Justified"), "Circle Throw", PL), idle(L(game, 1)), idle(L(game, 4)), idle(L(game, 3))),
  bench: bench(undefined, [member("inci", mon("Incineroar", "Intimidate")), member("lax", { ...L(game, 2), item: "Leftovers", hp: 150 })]),
  checks: "moves.ts:2451 circlethrow (forceSwitch, −6): the drag after the hit, 1/2 each; Intimidate at the newcomer's SwitchIn.",
}));
add("G4-SWX-33", ["sv", "champions"], (game) => ({
  title: "Electric Terrain: the U-turn's newcomer uses its Electric Seed as it comes in (+1 Defense); the later Body Slam meets it at +1",
  field: { terrain: "Electric" },
  slots: slots(act(uturner(game), "U-turn", PL), idle(L(game, 1)), act(L(game, 4), "Body Slam", OL), idle(L(game, 3))),
  bench: bench([member("seed", { ...L(game, 2), item: "Electric Seed" })]),
  checks: "items.ts:1795 electricseed onSwitchIn / onTerrainChange (useItem when Electric Terrain is active and the holder grounded): +1 Def.",
}));
add("G4-SWX-34", ["sv"], () => ({
  title: "Booster Energy on the U-turn's newcomer Iron Treads: Quark Drive raises its Defense (its highest stat); the later Body Slam meets it",
  slots: slots(act(uturner("sv"), "U-turn", PL), idle(L("sv", 1)), act(L("sv", 4), "Body Slam", OL), idle(L("sv", 3))),
  bench: bench([member("treads", mon("Iron Treads", "Quark Drive", { item: "Booster Energy" }))]),
  checks: "items.ts:622 boosterenergy onUpdate at the SwitchIn; abilities.ts:3650 quarkdrive: Def ×1.3 (its best stat, 140).",
}));
add("G4-SWX-35", ["sv", "champions"], (game) => ({
  title: "Hospitality: the U-turn's newcomer Sinistcha heals its hurt ally by a quarter as it comes in; the ally then takes a Body Slam",
  slots: slots(act(uturner(game), "U-turn", PL), idle(L(game, 1, { hp: 100 })), act(L(game, 4), "Body Slam", OR), idle(L(game, 3))),
  bench: bench([member("sini", mon("Sinistcha", "Hospitality"))]),
  checks: "abilities.ts:1874 hospitality (onSwitchInPriority −2) onStart: heal(ally.baseMaxhp / 4) for each adjacent ally.",
}));
add("G4-SWX-36", ["sv", "champions"], (game) => ({
  title: "Trace on the U-turn's newcomer Gardevoir copies Rough Skin or Defiant at random; Kingambit's later Iron Head knocks it out and loses an eighth to a copied Rough Skin",
  slots: slots(act(uturner(game), "U-turn", PL), idle(L(game, 1)), act(mon("Kingambit", "Defiant"), "Iron Head", OL), idle(chomp())),
  bench: bench([member("gard", mon("Gardevoir", "Trace"))]),
  checks: "abilities.ts:5118 trace onUpdate: sample(adjacent foes with a traceable ability), 1/2 each; roughskin onDamagingHit (contact) 1/8.",
}));
add("G4-SWX-37", ["sv", "swsh"], (game) => ({
  title: "Unnerve on the U-turn's newcomer Corviknight: the foe's Sitrus Berry is not eaten when the later Body Slam takes it below half",
  slots: slots(act(uturner(game), "U-turn", PL), act(L(game, 1), "Body Slam", PR), idle(L(game, 4)), idle(L(game, 3, { item: "Sitrus Berry", hp: 140 }))),
  bench: bench([member("corv", mon("Corviknight", "Unnerve"))]),
  checks: "abilities.ts:5258 unnerve (onFoeTryEatItem false while active) from the newcomer's SwitchIn; items.ts sitrusberry onUpdate below half.",
}));
add("G4-SWX-38", ["sv", "champions"], (game) => ({
  title: "Palafin's Flip Turn: Zero to Hero changes it to its Hero form as it leaves; the newcomer takes the later Body Slam",
  slots: slots(act(fast(game, mon("Palafin", "Zero to Hero")), "Flip Turn", PL), idle(L(game, 1)), act(L(game, 4), "Body Slam", OL), idle(L(game, 3))),
  bench: bench([member("lax", L(game, 2))]),
  checks: "abilities.ts:5625 zerotohero onSwitchOut: formeChange('Palafin-Hero', permanent) on the bench (E2's benched Palafin).",
}));
add("G4-SWX-39", ["sv", "champions"], (game) => ({
  title: "Three layers of Spikes: the U-turn's newcomer holding an Air Balloon is not grounded (no Spikes) and Garchomp's later Earthquake does not hit it",
  field: { own: { hazards: ["spikes"], layers: { spikes: 3 } } },
  slots: slots(act(uturner(game), "U-turn", PR), idle(L(game, 1)), act(chomp(), "Earthquake"), idle(L(game, 3))),
  bench: bench([member("balloon", { ...L(game, 2), item: "Air Balloon" })]),
  checks: "items.ts:185 airballoon (onStart message, ungrounded); conditions.ts spikes onSwitchIn skips an ungrounded Pokémon; Earthquake: immune.",
}));
add("G4-SWX-40", ["sv", "champions"], (game) => ({
  title: "Dragon Tail into a Guard Dog Mabosstiff: Guard Dog keeps it in (no drag); the bench stays",
  slots: slots(act(chomp(), "Dragon Tail", PL), idle(L(game, 1)), idle(mon("Mabosstiff", "Guard Dog")), idle(L(game, 3))),
  bench: bench(undefined, [member("lax", L(game, 2))]),
  checks: "abilities.ts:1727 guarddog onDragOut: null (no switch); Dragon Tail's damage stands.",
}));
add("G4-SWX-41", ["sv", "usum"], (game) => ({
  title: "Download on the U-turn's newcomer Porygon2: the foes' Defense is lower than their Special Defense, so +1 Attack",
  slots: slots(act(uturner(game), "U-turn", PL), idle(L(game, 1)), act(L(game, 4), "Body Slam", OL), idle(L(game, 3))),
  bench: bench([member("pory", mon("Porygon2", "Download"))]),
  checks: "abilities.ts:1017 download onStart: totaldef < totalspd over the foes (Snorlax 85 vs 130 each) → +1 Atk.",
}));
add("G4-SWX-42", ["sv", "champions"], (game) => ({
  title: "Dragon Tail into an Eject Button holder: the drag comes first, so the Eject Button stays unused; one of two bench Pokémon comes in at random",
  slots: slots(act(chomp(), "Dragon Tail", PL), idle(L(game, 1)), idle({ ...L(game, 4), item: "Eject Button" }), idle(L(game, 3))),
  bench: bench(undefined, [member("lax", L(game, 2)), member("bliss", bliss(game))]),
  checks: "battle-actions.ts:1104 forceSwitch (forceSwitchFlag) inside the hit, before items.ts:1680 ejectbutton onAfterMoveSecondary, which returns on target.forceSwitchFlag.",
}));

add("G4-SWX-43", ["sv", "champions"], (game) => ({
  title: "Flip Turn brings in Grassy Surge Rillaboom: Garchomp's later Earthquake is halved on the grounded Pokémon; Grassy Terrain heals at the end of turn",
  slots: slots(act(fast(game, mon("Milotic", "Marvel Scale")), "Flip Turn", PL), idle(L(game, 1)), act(chomp(), "Earthquake"), idle(L(game, 3))),
  bench: bench([member("rilla", mon("Rillaboom", "Grassy Surge"))]),
  checks: "abilities.ts grassysurge onStart at the newcomer's SwitchIn; conditions.ts grassyterrain: Earthquake ×0.5 into a grounded target, 1/16 heal at the residual.",
}));
add("G4-SWX-44", ["sv", "champions"], (game) => ({
  title: "Supersweet Syrup on the U-turn's newcomer Hydrapple lowers both foes' evasion; the later Body Slam meets Hydrapple",
  slots: slots(act(uturner(game), "U-turn", PL), idle(L(game, 1)), act(L(game, 4), "Body Slam", OL), idle(L(game, 3))),
  bench: bench([member("hydra", mon("Hydrapple", "Supersweet Syrup"))]),
  checks: "abilities.ts supersweetsyrup onStart (once per battle: syrupTriggered): −1 evasion on each adjacent foe.",
}));
add("G4-SWX-45", ["sv", "champions"], (game) => ({
  title: "Sun: the U-turn's newcomer with Cloud Nine suppresses it; the foe's later Flamethrower is not boosted",
  field: { weather: "Sun" },
  slots: slots(act(uturner(game), "U-turn", PL), idle(L(game, 1)), idle(L(game, 4)), act(L(game, 3), "Flamethrower", OR)),
  bench: bench([member("nine", game === "champions" ? mon("Drampa", "Cloud Nine") : mon("Golduck", "Cloud Nine"))]),
  checks: "abilities.ts cloudnine (suppressingWeather) onSwitchIn / onStart: field.suppressingWeather(); Flamethrower without the sun's ×1.5.",
}));
add("G4-SWX-46", ["sv", "champions"], (game) => ({
  title: "Curious Medicine on the U-turn's newcomer Galarian Slowking clears its ally's +2 Attack; the later Body Slam meets the newcomer",
  slots: slots(act(uturner(game), "U-turn", PL), idle(L(game, 1, { boosts: { atk: 2 } })), act(L(game, 4), "Body Slam", OL), idle(L(game, 3))),
  bench: bench([member("king", mon("Slowking-Galar", "Curious Medicine"))]),
  checks: "abilities.ts curiousmedicine onStart: clearBoosts on each adjacent ally.",
}));
add("G4-SWX-47", ["sv", "champions"], (game) => ({
  title: "Roar into an Ingrained Snorlax: Ingrain keeps it in (no drag); Ingrain heals it at the end of turn",
  slots: slots(act(mon("Arcanine", "Justified"), "Roar", PL), idle(L(game, 1)), act(carried({ ...L(game, 4), hp: 150 }, { ingrain: true }), "Body Slam", OR), idle(L(game, 3))),
  bench: bench(undefined, [member("lax", L(game, 2))]),
  checks: "conditions.ts ingrain onDragOut: false (the move fails, no switch); its residual heals 1/16.",
}));
add("G4-SWX-48", ["swsh", "usum"], (game) => ({
  title: "Roar into a Suction Cups Octillery: it stays in (no drag)",
  slots: slots(act(mon("Arcanine", "Justified"), "Roar", PL), idle(L(game, 1)), idle(mon("Octillery", "Suction Cups")), idle(L(game, 3))),
  bench: bench(undefined, [member("lax", L(game, 2))]),
  checks: "abilities.ts suctioncups onDragOut: false (the move fails, no switch).",
}));
add("G4-SWX-49", ["sv"], () => ({
  title: "Costar on the U-turn's newcomer Flamigo copies its ally's +2 Attack; the later Body Slam meets Flamigo",
  slots: slots(act(uturner("sv"), "U-turn", PL), idle(L("sv", 1, { boosts: { atk: 2 } })), act(L("sv", 4), "Body Slam", OL), idle(L("sv", 3))),
  bench: bench([member("flam", mon("Flamigo", "Costar"))]),
  checks: "abilities.ts costar onSwitchIn (priority −2) onStart: copies the ally's boosts (and its crit volatiles).",
}));
add("G4-SWX-50", ["sv"], () => ({
  title: "Intrepid Sword on the U-turn's newcomer Zacian, already used this battle: no boost (once per battle from generation 9)",
  slots: slots(act(uturner("sv"), "U-turn", PL), idle(L("sv", 1)), act(L("sv", 4), "Body Slam", OL), idle(L("sv", 3))),
  bench: bench([member("zac", mon("Zacian", "Intrepid Sword", { carried: { onceUsed: ["intrepidsword"] } }))]),
  checks: "abilities.ts:2213 intrepidsword onStart: pokemon.swordBoost already set (DoublesBenchPokemon.carried.onceUsed), no boost.",
}));
add("G4-SWX-50", ["swsh"], () => ({
  title: "Intrepid Sword on the U-turn's newcomer Zacian: +1 Attack as it comes in (SwSh: every entry); the later Body Slam meets it",
  slots: slots(act(uturner("swsh"), "U-turn", PL), idle(L("swsh", 1)), act(L("swsh", 4), "Body Slam", OL), idle(L("swsh", 3))),
  bench: bench([member("zac", mon("Zacian", "Intrepid Sword"))]),
  checks: "mods/gen8/abilities.ts:521 intrepidsword onStart: +1 Atk at every entry (no once-per-battle flag).",
}));
add("G4-SWX-51", ["sv"], () => ({
  title: "Tailwind on its side: the U-turn's newcomer Brambleghast's Wind Rider raises its Attack as it comes in",
  field: { own: { tailwind: true } },
  slots: slots(act(uturner("sv"), "U-turn", PL), idle(L("sv", 1)), act(L("sv", 4), "Body Slam", OL), idle(L("sv", 3))),
  bench: bench([member("bramble", mon("Brambleghast", "Wind Rider"))]),
  checks: "abilities.ts windrider onStart: +1 Atk when its side has Tailwind.",
}));
add("G4-SWX-52", ["champions", "swsh"], (game) => ({
  title: "Screen Cleaner on the U-turn's newcomer Mr. Rime ends the foes' Reflect; the later Body Slam into the foe is not reduced",
  field: { opponent: { reflect: true } },
  slots: slots(act(uturner(game), "U-turn", PL), act(L(game, 1), "Body Slam", PR), idle(L(game, 4)), idle(L(game, 3))),
  bench: bench([member("rime", mon("Mr. Rime", "Screen Cleaner"))]),
  checks: "abilities.ts screencleaner onStart: removeSideCondition reflect / lightscreen / auroraveil on both sides.",
}));

// ---------------------------------------------------------------------------------------------------------------------
// The wave 2 gap fixer (cloud session): a face's Eject Button and Red Card with a bench; a spread move's Eject Buttons and Red
// Cards by Speed; Pursuit and Baton Pass (no BeforeSwitchOut), and Pursuit at a dragged newcomer; Supreme Overlord and Embody
// Aspect newcomers (a bench member with choice "terastallize": Terastallized earlier); a newcomer's Dancer copy, a newcomer
// that leaves again, Ally Switch before a switch, a Sticky Web Eject Pack newcomer; the critic's probes that agree; Room
// Service, Dauntless Shield, Psychic Surge, Mirror Herb at the SwitchIn and Wimp Out after the residual.
// ---------------------------------------------------------------------------------------------------------------------
add("G4-SWX-53", ["sv", "usum"], (game) => ({
  title: "Ambipom's U-turn into Mimikyu's Disguise with an Eject Button: Mimikyu leaves, Ambipom stays and takes the later Body Slam",
  slots: slots(act(fast(game, mon("Ambipom", "Pickup")), "U-turn", PR), idle(L(game, 1)), act(L(game, 3), "Body Slam", OL), idle(mon("Mimikyu", "Disguise", { item: "Eject Button" }))),
  bench: bench([member("lax", L(game, 2))], [member("lax2", L(game, 5))]),
  checks: "items.ts:1680 ejectbutton onAfterMoveSecondary after a face's 0-damage hit (no switchFlag of `true` standing; source.switchFlag = false: the U-turn's switch cancelled).",
}));
add("G4-SWX-54", ["sv", "usum"], (game) => ({
  title: "Garchomp's Iron Head into Mimikyu's Disguise with an Eject Button: Mimikyu leaves before its Shadow Claw; the newcomer does not move",
  slots: slots(act(fast(game, chomp()), "Iron Head", PR), idle(L(game, 1)), idle(L(game, 3)), act(mon("Mimikyu", "Disguise", { item: "Eject Button" }), "Shadow Claw", OL)),
  bench: bench([member("lax", L(game, 2))], [member("lax2", L(game, 5))]),
  checks: "items.ts ejectbutton after a face's hit (doubles-faces.ts afterMoveItems → R's switchOut, which uses the button up).",
}));
add("G4-SWX-55", ["sv", "usum"], (game) => ({
  title: "Garchomp's Iron Head into Mimikyu's Disguise with a Red Card: Garchomp is dragged out; the bench Pokémon takes the later Body Slam",
  slots: slots(act(fast(game, chomp()), "Iron Head", PR), idle(L(game, 1)), act(L(game, 3), "Body Slam", OL), idle(mon("Mimikyu", "Disguise", { item: "Red Card" }))),
  bench: bench([member("lax", L(game, 2))], [member("lax2", L(game, 5))]),
  checks: "items.ts:5142 redcard after a face's hit: the attacker's forceSwitchFlag, a random bench Pokémon (one).",
}));
add("G4-SWX-56", ["sv", "champions"], (game) => ({
  title: "Rock Slide hits two Eject Button holders: only the faster holder leaves; the other keeps its button and its Body Slam follows",
  slots: slots(act(fast(game, chomp()), "Rock Slide"), idle(L(game, 1)), act({ ...L(game, 4), item: "Eject Button" }, "Body Slam", OL), act({ ...L(game, 3), item: "Eject Button" }, "Body Slam", OL)),
  bench: bench(undefined, [member("lax2", L(game, 5)), member("lax3", L(game, 6))]),
  checks: "battle-actions.ts:811 afterMoveSecondaryEvent: runEvent('AfterMoveSecondary', targets) speed-sorts the holders' handlers; the second sees a switchFlag of `true` (items.ts:1691) and keeps its button.",
}));
add("G4-SWX-57", ["sv"], (game) => ({
  title: "A level 1 Garchomp's Rock Slide hits two Eject Button holders of equal Speed: either leaves first at random, the other keeps its button",
  slots: slots(act(chomp({ level: 1 }), "Rock Slide"), idle(L(game, 1)), idle({ ...L(game, 4), item: "Eject Button" }), idle({ ...L(game, 4), item: "Eject Button", hp: 200 })),
  bench: bench(undefined, [member("lax2", L(game, 5))]),
  checks: "speedSort's tie: one order each at random; the first holder leaves, the second keeps its button.",
}));
add("G4-SWX-58", ["sv", "champions"], (game) => ({
  title: "Rock Slide hits two Red Card holders: the faster holder's card drags Garchomp out; the other keeps its card",
  slots: slots(act(fast(game, chomp()), "Rock Slide"), idle(L(game, 1)), idle({ ...L(game, 4), item: "Red Card" }), idle({ ...L(game, 3), item: "Red Card" })),
  bench: bench([member("lax", L(game, 2))]),
  checks: "items.ts:5150 redcard: source.forceSwitchFlag set by the faster holder's card stops the second (its card kept).",
}));
add("CQ-PUR-R-03", ["usum"], (game) => ({
  title: "USUM: Baton Pass skips BeforeSwitchOut, so the foe's Pursuit is not used at Ambipom; it hits the newcomer at 40 power later",
  slots: slots(act(fast(game, mon("Ambipom", "Technician")), "Baton Pass"), idle(L(game, 1)), act(mon("Houndoom", "Flash Fire"), "Pursuit", OL), idle(L(game, 3))),
  bench: bench([member("lax", L(game, 2))]),
  checks: "moves.ts:1108 batonpass self.onHit: skipBeforeSwitchOutEventFlag; battle.ts:2896 skips BeforeSwitchOut; Pursuit (40) at the newcomer.",
}));
add("CQ-PUR-R-04", ["usum"], (game) => ({
  title: "USUM: a Red Card drags Garchomp out (no BeforeSwitchOut); the foe's slower Pursuit hits the newcomer at 40 power",
  slots: slots(act(fast(game, chomp()), "Dragon Claw", PL), idle(L(game, 1)), idle({ ...L(game, 4), item: "Red Card" }), act(mon("Houndoom", "Flash Fire"), "Pursuit", OL)),
  bench: bench([member("lax", L(game, 3)), member("lax9", L(game, 9))]),
  checks: "battle-actions.ts dragIn: no BeforeSwitchOut for a drag; Pursuit's basePowerCallback 40 at the newcomer (no switchFlag).",
}));
add("CQ-PUR-R-05", ["usum"], (game) => ({
  title: "USUM: Parting Shot draws the foe's Pursuit at its BeforeSwitchOut",
  slots: slots(act(fast(game, mon("Pangoro", "Iron Fist")), "Parting Shot", PL), idle(L(game, 1)), act(mon("Houndoom", "Flash Fire"), "Pursuit", OL), idle(L(game, 3))),
  bench: bench([member("lax", L(game, 2))]),
  checks: "moves.ts partingshot (selfSwitch): BeforeSwitchOut runs, Pursuit at 80 at the leaver.",
}));
add("G4-SWX-59", ["sv", "champions"], (game) => ({
  title: "U-turn brings in Kingambit (Supreme Overlord): nothing the turn reads; the later Body Slam meets it",
  slots: slots(act(uturner(game), "U-turn", PL), idle(L(game, 1)), act(L(game, 4), "Body Slam", OL), idle(L(game, 3))),
  bench: bench([member("gambit", mon("Kingambit", "Supreme Overlord"))]),
  checks: "abilities.ts:4730 supremeoverlord onStart stores effectState.fallen, read only by its own onBasePower: nothing this turn.",
}));
add("G4-SWX-60", ["sv"], (game) => ({
  title: "U-turn brings in a Terastallized Ogerpon-Wellspring: Embody Aspect raises its Sp. Def; the later Hyper Voice meets it at +1",
  slots: slots(act(uturner(game), "U-turn", PL), idle(L(game, 1)), act(L(game, 4), "Hyper Voice"), idle(L(game, 3))),
  bench: bench([member("oger", mon("Ogerpon-Wellspring", "Water Absorb", { item: "Wellspring Mask", teraType: "Water", choice: "terastallize" }))]),
  checks: "battle-actions.ts terastallize (Ogerpon's Tera form, permanent); abilities.ts:1237 embodyaspectwellspring onStart +1 SpD at each entry (fresh abilityState).",
}));
add("G4-SWX-61", ["sv"], (game) => ({
  title: "Roar drags in a Terastallized Ogerpon (Teal): Embody Aspect raises its Speed, so it outspeeds nothing this turn; the later Body Slam meets it",
  slots: slots(act(mon("Arcanine", "Justified"), "Roar", PL), idle(L(game, 1)), act(L(game, 4), "Body Slam", OR), idle(L(game, 3))),
  bench: bench(undefined, [member("oger", mon("Ogerpon", "Defiant", { teraType: "Grass", choice: "terastallize" })), member("lax2", L(game, 5))]),
  checks: "abilities.ts:1224 embodyaspectteal onStart +1 Spe on a dragged-in Terastallized Ogerpon (1/2 each).",
}));
add("G4-SWX-62", ["sv"], (game) => ({
  title: "U-turn brings in Ogerpon-Wellspring, not Terastallized: Water Absorb, no boost; the later Hyper Voice meets it",
  slots: slots(act(uturner(game), "U-turn", PL), idle(L(game, 1)), act(L(game, 4), "Hyper Voice"), idle(L(game, 3))),
  bench: bench([member("oger", mon("Ogerpon-Wellspring", "Water Absorb", { item: "Wellspring Mask" }))]),
  checks: "an Ogerpon not Terastallized keeps its mask's form and Water Absorb: no Embody Aspect.",
}));
add("G4-SWX-63", ["sv", "usum"], (game) => ({
  title: "U-turn brings in a Dancer Oricorio; Garchomp's later Swords Dance is copied by it; Body Slam last into Oricorio",
  slots: slots(act(uturner(game), "U-turn", PL), idle(L(game, 1)), act(chomp(), "Swords Dance"), act(L(game, 3), "Body Slam", OL)),
  bench: bench([member("ori", mon("Oricorio", "Dancer"))]),
  checks: "abilities.ts dancer onAnyAfterMove: the newcomer copies (runMove externalMove, sourceEffect Dancer); DoublesStep.id.",
}));
add("G4-SWX-64", ["champions", "usum"], (game) => ({
  title: "U-turn brings in Golisopod above half; Stealth Rock takes it to half or less: Emergency Exit, the next bench Pokémon comes in",
  field: { own: { hazards: ["stealthrock"] } },
  slots: slots(act(uturner(game), "U-turn", PL), idle(L(game, 1)), idle(L(game, 4)), act(L(game, 3), "Body Slam", OL)),
  bench: bench([member("goli", mon("Golisopod", "Emergency Exit", { hp: 85 })), member("lax", L(game, 2))]),
  checks: "conditions.ts stealthrock on the newcomer; abilities.ts emergencyexit after the request's runSwitch (battle.ts:2870): the newcomer leaves again, the next bench Pokémon comes in.",
}));
add("G4-SWX-65", ["sv", "usum"], (game) => ({
  title: "Ally Switch swaps the own side; the U-turn user leaves from its new position; the later Body Slam aimed at a slot",
  slots: slots(act(game === "usum" ? mon("Alakazam", "Inner Focus") : mon("Farigiraf", "Armor Tail"), "Ally Switch"), act(uturner(game), "U-turn", PL), idle(L(game, 4)), act(L(game, 3), "Body Slam", OL)),
  bench: bench([member("lax", L(game, 2))]),
  checks: "moves.ts allyswitch (swapPosition), then U-turn from the new position: the newcomer stands at the swapped position (DoublesOutcome.positions).",
}));
add("G4-SWX-66", ["sv", "swsh"], (game) => ({
  title: "Sticky Web and Stealth Rock: the U-turn's newcomer with an Eject Pack switches out again at its own SwitchIn; the next one takes the Body Slam",
  field: { own: { hazards: ["stickyweb", "stealthrock"] } },
  slots: slots(act(uturner(game), "U-turn", PR), idle(L(game, 1)), idle(L(game, 3)), act(L(game, 2), "Body Slam", OL)),
  bench: bench([member("pack", { ...L(game, 4), item: "Eject Pack" }), member("next", L(game, 5))], [member("lax6", L(game, 6))]),
  checks: "conditions.ts stickyweb on the newcomer; items.ts ejectpack at its own SwitchIn (onAnySwitchIn −4): it leaves again.",
}));
add("G4-SWX-67", ["champions"], (game) => ({
  title: "U-turn into an Eject Button holder: Champions keeps the U-turn user's switch (both leave), SV cancels it",
  slots: slots(act(uturner(game), "U-turn", PL), idle(L(game, 1)), act({ ...L(game, 4), item: "Eject Button" }, "Body Slam", OL), act(L(game, 3), "Body Slam", OL)),
  bench: bench([member("lax", L(game, 2))], [member("lax2", L(game, 5))]),
  checks: "mods/champions/items.ts:266 ejectbutton: no source.switchFlag = false: the U-turn user and the holder both leave.",
}));
add("G4-SWX-68", ["champions"], (game) => ({
  title: "Champions: Red Card drags the attacker's side's bench in at random; the later Body Slam meets the newcomer",
  slots: slots(act(fast(game, chomp()), "Dragon Claw", PL), idle(L(game, 1)), idle({ ...L(game, 4), item: "Red Card" }), act(L(game, 3), "Body Slam", OL)),
  bench: bench([member("lax", L(game, 2)), member("clef", mon("Clefable", "Cute Charm"))]),
  checks: "items.ts redcard in Champions: the attacker dragged, a random bench Pokémon (1/2 each).",
}));
add("G4-SWX-69", ["sv"], (game) => ({
  title: "U-turn brings in Electric Surge Pincurchin: the foe Iron Hands' Quark Drive starts; its later Drain Punch into Pincurchin",
  slots: slots(act(uturner(game), "U-turn", PL), idle(L(game, 1)), act(mon("Iron Hands", "Quark Drive"), "Drain Punch", OL), idle(L(game, 3))),
  bench: bench([member("pin", mon("Pincurchin", "Electric Surge"))]),
  checks: "abilities.ts electricsurge onStart; quarkdrive onTerrainChange on the foe in play.",
}));
add("G4-SWX-70", ["sv"], (game) => ({
  title: "Sun: the U-turn's newcomer Scream Tail's Protosynthesis starts; the later Body Slam meets it",
  field: { weather: "Sun" },
  slots: slots(act(uturner(game), "U-turn", PL), idle(L(game, 1)), act(L(game, 4), "Body Slam", OL), idle(L(game, 3))),
  bench: bench([member("tail", mon("Scream Tail", "Protosynthesis", { evs: { def: 252 } }))]),
  checks: "abilities.ts protosynthesis onStart in sun (its WeatherChange handler): Def ×1.3 (its best stat).",
}));
add("G4-SWX-71", ["sv"], (game) => ({
  title: "Rapid Spin clears the pre-turn Stealth Rock; the slower U-turn's newcomer Charizard takes none",
  field: { own: { hazards: ["stealthrock"] } },
  slots: slots(act(fast(game, mon("Excadrill", "Mold Breaker")), "Rapid Spin", PL), act(mon("Ambipom", "Technician"), "U-turn", PL), idle(L(game, 4)), act(L(game, 3), "Body Slam", OR)),
  bench: bench([member("zard", mon("Charizard", "Blaze"))]),
  checks: "moves.ts rapidspin removes the pre-turn Stealth Rock before the newcomer comes in.",
}));
add("G4-SWX-72", ["sv"], (game) => ({
  title: "Court Change moves Stealth Rock to the foe's side; the foe's slower U-turn's newcomer Charizard takes half",
  field: { own: { hazards: ["stealthrock"] } },
  slots: slots(act(fast(game, mon("Cinderace", "Blaze")), "Court Change"), idle(L(game, 1)), act(mon("Ambipom", "Technician"), "U-turn", OR), act(L(game, 3), "Body Slam", PL)),
  bench: bench(undefined, [member("zard", mon("Charizard", "Blaze"))]),
  checks: "moves.ts courtchange swaps the side conditions; the foe's newcomer takes Stealth Rock.",
}));
add("G4-SWX-73", ["sv"], (game) => ({
  title: "Arcanine's Roar into Hatterene's Magic Bounce: Arcanine is dragged out; Body Slam later into its position",
  slots: slots(act(mon("Arcanine", "Justified"), "Roar", PL), idle(L(game, 1)), idle(mon("Hatterene", "Magic Bounce")), act(L(game, 3), "Body Slam", OL)),
  bench: bench([member("lax", L(game, 2)), member("lax9", L(game, 9))]),
  checks: "abilities.ts magicbounce reflects Roar: its user is dragged out (1/2 each bench Pokémon).",
}));
add("G4-SWX-74", ["sv"], (game) => ({
  title: "Dragon Tail into a Substitute: no drag; the holder's Body Slam follows",
  slots: slots(act(fast(game, chomp()), "Dragon Tail", PL), idle(L(game, 1)), act({ ...L(game, 4), substitute: 59 }, "Body Slam", OL), idle(L(game, 3))),
  bench: bench(undefined, [member("lax2", L(game, 5))]),
  checks: "battle-actions.ts forceSwitch skips a hit into a Substitute: no drag.",
}));
add("G4-SWX-75", ["sv"], (game) => ({
  title: "U-turn into a Substitute: the user switches; the later Body Slam meets the newcomer",
  slots: slots(act(uturner(game), "U-turn", PL), idle(L(game, 1)), idle({ ...L(game, 4), substitute: 59 }), act(L(game, 3), "Body Slam", OL)),
  bench: bench([member("lax", L(game, 2))]),
  checks: "U-turn's selfSwitch after a hit into a Substitute: the user switches.",
}));
add("G4-SWX-76", ["sv"], (game) => ({
  title: "Whirlwind into a Wind Rider Brambleghast: immune, +1 Attack, no drag",
  slots: slots(act(mon("Skarmory", "Keen Eye"), "Whirlwind", PL), idle(L(game, 1)), idle(mon("Brambleghast", "Wind Rider")), act(L(game, 3), "Body Slam", OL)),
  bench: bench(undefined, [member("lax2", L(game, 5))]),
  checks: "abilities.ts windrider onTryHit: immune to Whirlwind (wind), +1 Atk; no drag.",
}));
add("G4-SWX-77", ["sv", "swsh"], (game) => ({
  title: "Trick Room: an Eject Button newcomer's Room Service is used up as it comes in (−1 Speed); the later Body Slam meets it",
  field: { trickRoom: true },
  slots: slots(act(L(game, 1), "Body Slam", PL), act(L(game, 2), "Body Slam", PL), idle({ ...L(game, 4), item: "Eject Button" }), idle(L(game, 3))),
  bench: bench(undefined, [member("rs", { ...L(game, 5), item: "Room Service" })]),
  checks: "items.ts roomservice onSwitchIn under Trick Room: −1 Spe, used up.",
}));
add("G4-SWX-78", ["sv", "swsh"], (game) => ({
  title: "Dauntless Shield on the U-turn's newcomer Zamazenta: +1 Defense as it comes in; the later Body Slam meets it",
  slots: slots(act(uturner(game), "U-turn", PL), idle(L(game, 1)), act(L(game, 4), "Body Slam", OL), idle(L(game, 3))),
  bench: bench([member("zama", mon("Zamazenta", "Dauntless Shield"))]),
  checks: "abilities.ts dauntlessshield onStart: +1 Def (SV: once per battle, the fact; SwSh: every entry).",
}));
add("G4-SWX-79", ["sv", "usum"], (game) => ({
  title: "U-turn brings in a Psychic Surge Pokémon: its ally Espeon's later Psychic is boosted by Psychic Terrain",
  slots: slots(act(uturner(game), "U-turn", PL), act(mon("Espeon", "Synchronize"), "Psychic", PR), idle(L(game, 4)), idle(L(game, 3))),
  bench: bench([member("psy", game === "usum" ? mon("Tapu Lele", "Psychic Surge") : mon("Indeedee", "Psychic Surge"))]),
  checks: "abilities.ts psychicsurge onStart; conditions.ts psychicterrain ×1.3 on a grounded user's Psychic move.",
}));
add("G4-SWX-80", ["sv"], (game) => ({
  title: "Sticky Web drops the U-turn's newcomer Kingambit's Speed; Defiant +2 Attack, which the foe's Mirror Herb copies at the SwitchIn; its later Body Slam at +2",
  field: { own: { hazards: ["stickyweb"] } },
  slots: slots(act(uturner(game), "U-turn", PR), idle(L(game, 1)), act({ ...L(game, 3), item: "Mirror Herb" }, "Body Slam", OL), idle(L(game, 2))),
  bench: bench([member("gambit", mon("Kingambit", "Defiant"))]),
  checks: "items.ts mirrorherb onFoeAfterBoost, used at the SwitchIn's onAnySwitchIn (−3): the foe copies Defiant's +2.",
}));
add("G4-SWX-81", ["swsh", "usum"], (game) => ({
  title: "Wimp Out after the residual (burn to half): the switch after the turn, with Stealth Rock on its newcomer",
  field: { opponent: { hazards: ["stealthrock"] } },
  slots: slots(idle(L(game, 1)), idle(L(game, 2)), idle(mon("Torkoal", "Shell Armor")), idle(mon("Wimpod", "Wimp Out", { hp: 52, status: "brn" }))),
  bench: bench(undefined, [member("zard", mon("Charizard", "Blaze"))]),
  checks: "abilities.ts wimpout after the residual (burn to half): the switch after the turn; Stealth Rock on its newcomer.",
}));
// Integration 2 (census: a Tatsugiri newcomer beside a Pokémon that is not a Dondozo was `Commander starting on Tatsugiri is not
// modelled in 2v2.`): its Commander does nothing; the later Body Slam hits it.
add("G4-SWX-82", ["sv"], (game) => ({
  title: "A Tatsugiri newcomer beside a Snorlax (no Dondozo): its Commander does nothing; the later Body Slam hits it",
  slots: slots(act(uturner(game), "U-turn", PR), idle(L(game, 1)), act(L(game, 4), "Body Slam", OL), idle(L(game, 3))),
  bench: bench([member("tats", mon("Tatsugiri", "Commander"))]),
  checks: "abilities.ts commander onStart → onUpdate: an ally that is not a Dondozo returns with no effect (no commanding volatile).",
}));

// The second CQ-PUR-R-01 entry gets its own id.
{
  const twins = cases.filter((c) => c.id === "CQ-PUR-R-01-usum");
  if (twins.length === 2) twins[1].id = "CQ-PUR-R-02-usum";
}

export const R_CASES: Case[] = cases;

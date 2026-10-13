// R-E's own extra cases (status2 wave 2, the finish): the corners this finish fixed or guards, run on pinned Showdown with
// the verify harness's exhaustive oracle (sim-dfs.ts oracle) and compared with compare.ts compareCase, nothing stored
// (run-cases.ts). Same conventions as verify/cases-r.ts (level 50, 31 IVs, Serious, 0 EVs unless set).
import type { Case, CaseBenchMon, CaseMon, Game } from "../../../2v2/verify/case-types";
import { OL, OR, PL, PR, act, carried, idle, mon, slots } from "../../../2v2/verify/case-kit";
import { L, fastEvs } from "../../../2v2/verify/case-kit2";

export const RE_CASES: Case[] = [];
const add = (id: string, games: Game[], make: (game: Game) => Omit<Case, "id" | "game">) => {
  for (const game of games) RE_CASES.push({ id: `${id}-${game}`, game, outcomes: true, ...make(game) });
};
const member = (id: string, m: CaseMon): CaseBenchMon => ({ ...m, id });
const bench = (own?: CaseBenchMon[], opponent?: CaseBenchMon[]): Case["bench"] => ({
  ...(own ? { own: { members: own } } : {}), ...(opponent ? { opponent: { members: opponent } } : {}),
});
const fast = (game: Game, m: CaseMon): CaseMon => ({ ...m, evs: { ...(m.evs ?? {}), ...fastEvs(game) } });

// Red Card against a Life Orb attacker: not followed (the step's Life Orb loss, which forceSwitchFlag stops).
add("RE-RC-LO", ["sv"], (game) => ({
  title: "Red Card against a Life Orb Garchomp: no Life Orb loss (forceSwitchFlag); not followed: the kept reason",
  slots: slots(act(fast(game, mon("Garchomp", "Rough Skin", { item: "Life Orb" })), "Dragon Claw", PL), idle(L(game, 1)), idle({ ...L(game, 4), item: "Red Card" }), idle(L(game, 3))),
  bench: bench([member("lax", L(game, 2))]),
  checks: "items.ts redcard onAfterMoveSecondary then lifeorb onAfterMoveSecondarySelf (!source.forceSwitchFlag).",
  notEstimated: "Red Card with Life Orb is not modelled in 2v2.",
}));
// The same without a bench (the end of turn not estimated: the attacker leaves after the turn), and a Life Orb Dragon Tail
// into a Red Card holder (the holder is dragged first: no Red Card, the Life Orb loss stands), with a bench and without.
add("RE-RC-LO-KO", ["sv"], (game) => ({
  title: "Red Card against a Life Orb Garchomp at 10 HP: the card drags it first, so Life Orb does not knock it out; not followed",
  slots: slots(act(fast(game, mon("Garchomp", "Rough Skin", { item: "Life Orb", hp: 10 })), "Dragon Claw", PL), idle(L(game, 1)), idle({ ...L(game, 4), item: "Red Card" }), idle(L(game, 3))),
  bench: bench([member("lax", L(game, 2))]),
  checks: "items.ts redcard (source.hp before Life Orb), lifeorb (!source.forceSwitchFlag).",
  notEstimated: "Red Card with Life Orb is not modelled in 2v2.",
}));
add("RE-RC-LO-NB", ["sv"], (game) => ({
  title: "Red Card against a Life Orb Garchomp, no bench given, its move last under Trick Room: not followed (the kept reason)",
  slots: slots(act(fast(game, mon("Garchomp", "Rough Skin", { item: "Life Orb" })), "Dragon Claw", PL), idle(L(game, 1)), idle({ ...L(game, 4), item: "Red Card" }), idle(L(game, 3))),
  field: { trickRoom: true },
  checks: "items.ts redcard then lifeorb (!source.forceSwitchFlag).",
  notEstimated: "Red Card with Life Orb is not modelled in 2v2.",
}));
add("RE-RC-LO-NB2", ["sv"], (game) => ({
  title: "Red Card against a Life Orb Garchomp, no bench given, later actions: today's reason",
  slots: slots(act(fast(game, mon("Garchomp", "Rough Skin", { item: "Life Orb" })), "Dragon Claw", PL), idle(L(game, 1)), idle({ ...L(game, 4), item: "Red Card" }), idle(L(game, 3))),
  checks: "the switch-out with a later action and no bench.",
  notEstimated: "Garchomp switches out: the replacement is not known.",
}));
add("RE-RC-DT", ["sv"], (game) => ({
  title: "A Life Orb Dragon Tail into a Red Card holder: the holder is dragged out (forceSwitch in the hit), its Red Card does not act; the Life Orb loss stands",
  slots: slots(act(fast(game, mon("Garchomp", "Rough Skin", { item: "Life Orb" })), "Dragon Tail", PL), idle(L(game, 1)), idle({ ...L(game, 4), item: "Red Card" }), idle(L(game, 3))),
  bench: bench([member("lax", L(game, 2))], [member("lax2", L(game, 5))]),
  checks: "battle-actions.ts forceSwitch before afterMoveSecondaryEvent; items.ts redcard (target.forceSwitchFlag).",
}));
// A Sheer Force move with a secondary into a Red Card holder and into an Eject Button holder: neither acts.
add("RE-SF-RC", ["sv", "champions"], (game) => ({
  title: "Feraligatr's Sheer Force Ice Beam into a Red Card holder: no drag",
  slots: slots(act(fast(game, mon("Feraligatr", "Sheer Force")), "Ice Beam", PL), idle(L(game, 1)), act({ ...L(game, 4), item: "Red Card" }, "Body Slam", OL), idle(L(game, 3))),
  bench: bench([member("lax", L(game, 2))]),
  checks: "battle-actions.ts afterMoveSecondaryEvent: none after a Sheer Force move with secondaries.",
}));
add("RE-SF-EB", ["sv", "champions"], (game) => ({
  title: "Feraligatr's Sheer Force Ice Beam into an Eject Button holder: no switch; the holder's Body Slam follows",
  slots: slots(act(fast(game, mon("Feraligatr", "Sheer Force")), "Ice Beam", PL), idle(L(game, 1)), act({ ...L(game, 4), item: "Eject Button" }, "Body Slam", OL), idle(L(game, 3))),
  bench: bench(undefined, [member("lax", L(game, 2))]),
  checks: "battle-actions.ts afterMoveSecondaryEvent: none after a Sheer Force move with secondaries.",
}));
// Pursuit by a Technician user at a switching target: 80 power, no Technician.
add("RE-PUR-TECH", ["usum"], () => ({
  title: "Scizor's Technician Pursuit at the U-turn user's BeforeSwitchOut: 80 power (no Technician boost)",
  slots: slots(act(fast("usum", mon("Ambipom", "Pickup")), "U-turn", PR), idle(L("usum", 1)), act(mon("Scizor", "Technician"), "Pursuit", OL), idle(L("usum", 3))),
  bench: bench([member("lax", L("usum", 2))]),
  checks: "moves.ts pursuit basePowerCallback (80), abilities.ts technician (basePowerAfterMultiplier <= 60).",
}));
// Pursuit at an Eject Button holder that used Destiny Bond: its Destiny Bond ends at BeforeSwitchOut.
add("RE-PUR-DB", ["usum"], () => ({
  title: "Gengar used Destiny Bond, then its Eject Button: Tyranitar's Pursuit knocks it out at BeforeSwitchOut and does not faint",
  slots: slots(act(fast("usum", mon("Gengar", "Cursed Body", { item: "Eject Button" })), "Destiny Bond"), idle(L("usum", 1)),
    act(mon("Tyranitar", "Unnerve"), "Pursuit", OR), act({ ...L("usum", 3), evs: { spe: 252 } }, "Crunch", OL)),
  bench: bench([member("lax", L("usum", 2))]),
  checks: "moves.ts pursuit condition onFoeBeforeSwitchOut: pokemon.removeVolatile('destinybond') before runMove.",
}));
// A Future Sight landing from an active Life Orb user into a Red Card holder (bench): the user dragged after the turn, no Life Orb.
add("RE-FS-RC-LO", ["sv"], (game) => ({
  title: "Future Sight from Hatterene (Life Orb) lands on a Red Card holder: Hatterene is dragged out after the turn and loses no HP to Life Orb",
  slots: slots(idle(mon("Hatterene", "Magic Bounce", { item: "Life Orb" })), idle(L(game, 4)), idle(carried({ ...L(game, 12), item: "Red Card" }, { futureMove: { move: "futuresight", source: OL } })), idle(L(game, 3))),
  bench: bench([member("lax", L(game, 2))]),
  checks: "conditions.ts futuremove onEnd: lifeorb's AfterMoveSecondarySelf after the hit (!source.forceSwitchFlag).",
}));
void OR; void PR;
// A U-turn into a Disguise holder with an Eject Button (the face's hit: afterMoveSecondaryEvent runs on a 0-damage hit): the
// holder leaves; U-turn's switchFlag is its move id, which Eject Button does not wait for, and its own switch is cancelled
// (source.switchFlag = false; not in Champions). doubles-faces.ts afterMoveItems' `!selfSwitch` keeps the Eject Button: the
// integrator's line (W2-R-E.md needs).
RE_CASES.push(...(["sv"] as Game[]).map((game): Case => ({
  id: `RE-FACE-EB-UT-${game}`, game, outcomes: true,
  title: "Ambipom's U-turn into Mimikyu's Disguise with an Eject Button: Mimikyu leaves, Ambipom stays and takes the later Body Slam",
  slots: slots(act(fast(game, mon("Ambipom", "Pickup")), "U-turn", PR), idle(L(game, 1)), act(L(game, 3), "Body Slam", OL), idle(mon("Mimikyu", "Disguise", { item: "Eject Button" }))),
  bench: bench([member("lax", L(game, 2))], [member("lax2", L(game, 5))]),
  checks: "items.ts ejectbutton onAfterMoveSecondary (no switchFlag === true standing), source.switchFlag = false.",
})));
// Faces with a bench: an Eject Button and a Red Card on a Disguise holder (the face's hit, doubles-faces.ts afterMoveItems).
RE_CASES.push(...(["sv"] as Game[]).flatMap((game): Case[] => [{
  id: `RE-FACE-EB-${game}`, game, outcomes: true,
  title: "Garchomp's Iron Head into Mimikyu's Disguise with an Eject Button: Mimikyu leaves before its Body Slam; the newcomer is not hit",
  slots: slots(act(fast(game, mon("Garchomp", "Rough Skin")), "Iron Head", PR), idle(L(game, 1)), idle(L(game, 3)), act(mon("Mimikyu", "Disguise", { item: "Eject Button" }), "Shadow Claw", OL)),
  bench: bench([member("lax", L(game, 2))], [member("lax2", L(game, 5))]),
  checks: "items.ts ejectbutton after a face's 0-damage hit.",
}, {
  id: `RE-FACE-RC-${game}`, game, outcomes: true,
  title: "Garchomp's Iron Head into Mimikyu's Disguise with a Red Card: Garchomp is dragged out; the bench Pokémon comes in",
  slots: slots(act(fast(game, mon("Garchomp", "Rough Skin")), "Iron Head", PR), idle(L(game, 1)), act(L(game, 3), "Body Slam", OL), idle(mon("Mimikyu", "Disguise", { item: "Red Card" }))),
  bench: bench([member("lax", L(game, 2))], [member("lax2", L(game, 5))]),
  checks: "items.ts redcard after a face's 0-damage hit.",
}]));
// tests/unit/status2-r-contract.test.ts's turn (Champions, default builds): a chosen replacement takes the later Body Slam.
RE_CASES.push({
  id: "RE-CONTRACT-champions", game: "champions", outcomes: true,
  title: "Corviknight's U-turn brings in the chosen Garchomp; the foe's Body Slam meets it (Rough Skin)",
  slots: slots(act(mon("Corviknight", "Pressure"), "U-turn", PL), idle(L("champions", 1)), idle(L("champions", 2)), act(L("champions", 3), "Body Slam", OL)),
  bench: bench([member("b1", mon("Garchomp", "Rough Skin"))]),
  replacement: { [OL]: "b1" },
  checks: "the switch request answered with the replacement; the later Body Slam at the position meets the newcomer.",
});

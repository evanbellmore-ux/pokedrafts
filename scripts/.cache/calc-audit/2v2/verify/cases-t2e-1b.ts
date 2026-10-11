// status2 wave 1b (Track V2): the T2E- cases of tier2-eot-training.md §4 whose track is E2 (ADDENDUM2 §7.2, §8.5): the
// landing (T2E-FS, §4.1.9), Cud Chew (T2E-CC, §4.2.4), Moody (T2E-MO, §4.3.3), G-Max damage over time (T2E-GX, §4.4.3,
// SwSh), forms at 29 (T2E-FC, §4.5.3). Probes: tier2-eot-training-probes-1.ts (FS…, CC…, MO…, GX…, FC…). Showdown names;
// level 50, 31 IVs, Serious nature, 0 EVs unless set (Champions: Stat Points). Wired into cases-se.ts through
// cases-wave1b.ts.
import type { Case, CaseMon, Game } from "./case-types";
import { OL, OR, PL, PR, act, carried, idle, mon, slots } from "./case-kit";
import { L, evs, fastEvs } from "./case-kit2";

const cases: Case[] = [];
const add = (id: string, games: Game[], make: (game: Game) => Omit<Case, "id" | "game">) => {
  for (const game of games) cases.push({ id: `${id}-${game}`, game, ...make(game) });
};

// ================================ the landing (T2E §4.1, FS01–FS16) ================================
// USUM has no Hatterene: Alakazam.
const hatt = (game: Game, extra: Partial<CaseMon> = {}) => game === "usum"
  ? mon("Alakazam", "Inner Focus", { nature: "Modest", evs: evs(game, { spa: 252, spe: 4 }), ...extra })
  : mon("Hatterene", "Magic Bounce", { nature: "Modest", evs: evs(game, { spa: 252, spe: 4 }), ...extra });
const fs = { move: "futuresight" as const };
add("T2E-FS01", ["sv", "champions"], (game) => ({
  title: "Future Sight from the active Hatterene lands on a Sitrus Snorlax at 150: the Sitrus at the hit's Update, before its partner's Leftovers (5.4) (FS01, FS02)",
  outcomes: true,
  slots: slots(idle(hatt(game)), idle(L(game, 4)), idle(L(game, 12, { item: "Leftovers", hp: 150 })), idle(carried(L(game, 8, { item: "Sitrus Berry", hp: 150 }), { futureMove: { ...fs, source: OL } }))),
  checks: "conditions.ts futuremove onResidualOrder 3: trySpreadMoveHit at the slot; the hit's Update eats the Sitrus.",
}));
add("T2E-FS02", ["sv"], () => ({
  title: "Future Sight from a Choice Specs Hatterene on the bench: no item, ability or stages (FS03b)",
  slots: slots(idle(L("sv", 2)), idle(L("sv", 4)), idle(L("sv", 12)), idle(carried(L("sv", 8), { futureMove: { ...fs, bench: hatt("sv", { item: "Choice Specs" }), benchSide: "own" } }))),
  checks: "pokemon.ts ignoringItem / ignoringAbility while not active: 108–127 (equal to an active Hatterene with no item).",
}));
add("T2E-FS02", ["usum"], () => ({
  title: "Doom Desire from a Jirachi on the bench into a Snorlax",
  slots: slots(idle(L("usum", 2)), idle(L("usum", 4)), idle(L("usum", 12)),
    idle(carried(L("usum", 8), { futureMove: { move: "doomdesire", bench: mon("Jirachi", "Serene Grace", { nature: "Modest", evs: { spa: 252 } }), benchSide: "own" } }))),
  checks: "Doom Desire: Steel 140 from the stored move data.",
}));
add("T2E-FS03", ["sv", "champions"], (game) => ({
  title: "The active source's Calm Mind this turn and its ally's Helping Hand count at the landing (FS04, FS17)",
  slots: slots(act(hatt(game), "Calm Mind"), act(L(game, 4, { evs: fastEvs(game) }), "Helping Hand", OL), idle(L(game, 12)), idle(carried(L(game, 8), { futureMove: { ...fs, source: OL } }))),
  checks: "The source's stages as they stand (+1 Sp. Atk); the helpinghand volatile lasts to the residual's end.",
}));
add("T2E-FS04", ["sv"], () => ({
  title: "Tera Psychic Clefable knocked out this turn before its Future Sight lands: no Tera STAB, no item or ability (FS05b)",
  slots: slots(idle(mon("Clefable", "Unaware", { nature: "Modest", evs: { spa: 252 }, teraType: "Psychic", choice: "terastallize", hp: 1 })), idle(L("sv", 4)),
    act(mon("Garchomp", "Rough Skin", { evs: { spe: 252 } }), "Dragon Claw", OL), idle(carried(L("sv", 8), { futureMove: { ...fs, source: OL } }))),
  checks: "faintMessages deletes terastallized: the landing has no STAB (179 left, as FS05d).",
}));
add("T2E-FS04", ["usum"], () => ({
  title: "A Mega Gardevoir (Mega Evolved this turn) knocked out before its Future Sight lands: base Gardevoir's Sp. Atk (FS05e)",
  slots: slots(idle(mon("Gardevoir", "Pixilate", { item: "Gardevoirite", choice: "mega", appSpecies: "gardevoirmega", nature: "Modest", evs: { spa: 252 }, hp: 1 })), idle(L("usum", 4)),
    act(mon("Garchomp", "Rough Skin", { evs: { spe: 252 } }), "Iron Head", OL), idle(carried(L("usum", 8), { futureMove: { ...fs, source: OL } }))),
  checks: "faintMessages formeRegression: the base species' Sp. Atk 194 (133 left, as FS05g).",
}));
add("T2E-FS05", ["sv", "swsh"], (game) => ({
  title: "An active Life Orb Hatterene's Future Sight into a Dark-type Umbreon: immune, and Life Orb still costs 1/10 (FS07c)",
  slots: slots(idle(hatt(game, { item: "Life Orb" })), idle(L(game, 4)), idle(L(game, 12)), idle(carried(mon("Umbreon", "Synchronize"), { futureMove: { ...fs, source: OL } }))),
  checks: "moveData ignoreImmunity false: -immune; Life Orb's AfterMoveSecondarySelf for an active source either way.",
}));
add("T2E-FS06", ["sv", "champions"], (game) => ({
  title: "The target used Protect this turn: the landing still hits (FS06c)",
  slots: slots(idle(hatt(game)), idle(L(game, 4)), idle(L(game, 12)), act(carried(L(game, 8), { futureMove: { ...fs, source: OL } }), "Protect")),
  checks: "futuremove onEnd removes Protect before the hit (conditions.ts:403-404).",
}));
add("T2E-FS06b", ["sv", "champions"], (game) => ({
  title: "The target used Endure this turn at 30 HP: the landing knocks it out (FS06d)",
  slots: slots(idle(hatt(game)), idle(L(game, 4)), idle(L(game, 12)), act(carried(L(game, 8, { hp: 30 }), { futureMove: { ...fs, source: OL } }), "Endure")),
  checks: "Endure is removed too: it faints.",
}));
add("T2E-FS07", ["sv", "champions"], (game) => ({
  title: "Ally Switch on the target's side: the Pokémon now at the slot is hit (FS11a)",
  slots: slots(idle(hatt(game)), idle(L(game, 4)), idle(L(game, 12)), act(carried(mon("Espathra", "Frisk", { evs: fastEvs(game) }), { futureMove: { ...fs, source: OL } }), "Ally Switch")),
  checks: "getAtSlot(targetSlot): the partner standing there after the swap. (Indeedee has no Ally Switch in these catalogs: Espathra.)",
}));
add("T2E-FS07b", ["sv"], () => ({
  title: "Future Sight into its own ally's slot, then the user Ally Switches into it: no hit (the target is the user) (FS11b)",
  slots: slots(act(mon("Espathra", "Frisk", { evs: { spe: 252 } }), "Ally Switch"), idle(carried(L("sv", 4), { futureMove: { ...fs, source: OL } })), idle(L("sv", 8)), idle(L("sv", 12))),
  checks: "futuremove onEnd: target === source: a hint, no hit.",
}));
const meow = () => mon("Meowstic-F", "Infiltrator", { nature: "Modest", evs: { spa: 32 } });
add("T2E-FS08", ["champions"], () => ({
  title: "An active Infiltrator Meowstic-F's landing into Light Screen and a 40 HP Substitute: both bypassed (FS08a)",
  field: { opponent: { lightScreen: true } },
  slots: slots(idle(meow()), idle(L("champions", 4)), idle(L("champions", 12)), idle(carried(L("champions", 8, { substitute: 40 }), { futureMove: { ...fs, source: OL } }))),
  checks: "moveData infiltrates from the active source's Infiltrator (gen 6+): 142–157 to the Pokémon.",
}));
add("T2E-FS08b", ["champions"], () => ({
  title: "The same Meowstic-F on the bench: its Infiltrator does not count; the Substitute takes it (FS08b)",
  field: { opponent: { lightScreen: true } },
  slots: slots(idle(L("champions", 2)), idle(L("champions", 4)), idle(L("champions", 12)), idle(carried(L("champions", 8, { substitute: 40 }), { futureMove: { ...fs, bench: meow(), benchSide: "own" } }))),
  checks: "hasAbility is false off the field: no infiltrates.",
}));
const beh = () => mon("Beheeyem", "Analytic", { nature: "Modest", evs: { spa: 252 } });
add("T2E-FS09", ["swsh"], () => ({
  title: "An active Analytic Beheeyem's landing: ×1.3 (no one will move) (FS09a)",
  slots: slots(idle(beh()), idle(L("swsh", 4)), idle(L("swsh", 12)), idle(carried(L("swsh", 8), { futureMove: { ...fs, source: OL } }))),
  checks: "abilities.ts analytic onBasePower: queue.willMove of none.",
}));
add("T2E-FS09b", ["swsh"], () => ({
  title: "The same Beheeyem on the bench: no Analytic (FS09b)",
  slots: slots(idle(L("swsh", 2)), idle(L("swsh", 4)), idle(L("swsh", 12)), idle(carried(L("swsh", 8), { futureMove: { ...fs, bench: beh(), benchSide: "own" } }))),
  checks: "Off the field: no ability.",
}));
add("T2E-FS10", ["sv"], () => ({
  title: "The landing into a Corviknight charging Fly this turn: it misses (FS14)",
  slots: slots(idle(hatt("sv")), idle(L("sv", 4)), idle(L("sv", 12)), act(carried(mon("Corviknight", "Pressure"), { futureMove: { ...fs, source: OL } }), "Fly", OL)),
  checks: "hitStepInvulnerabilityEvent: -miss.",
}));
add("T2E-FS10", ["usum"], () => ({
  title: "The landing into a Garchomp digging this turn: it misses (FS14)",
  slots: slots(idle(hatt("usum")), idle(L("usum", 4)), idle(L("usum", 12)), act(carried(mon("Garchomp", "Rough Skin"), { futureMove: { ...fs, source: OL } }), "Dig", OL)),
  checks: "The Dig user is semi-invulnerable at the residual.",
}));
add("T2E-FS11", ["sv"], () => ({
  title: "The landing into a Weakness Policy Annihilape: +2 Atk, +2 Sp. Atk (FS15a)",
  slots: slots(idle(mon("Clefable", "Unaware", { nature: "Modest", evs: { spa: 252 } })), idle(L("sv", 4)), idle(L("sv", 12)), idle(carried(mon("Annihilape", "Defiant", { item: "Weakness Policy" }), { futureMove: { ...fs, source: OL } }))),
  checks: "The landing's hit is a super-effective hit: Weakness Policy.",
  outcomes: true,
}));
add("T2E-FS11", ["champions"], () => ({
  title: "The landing takes a Berserk Drampa (110 HP) to half or less: +1 Sp. Atk (FS15b)",
  slots: slots(idle(mon("Clefable", "Unaware", { nature: "Modest", evs: { spa: 32 } })), idle(L("champions", 4)), idle(L("champions", 12)), idle(carried(mon("Drampa", "Berserk", { hp: 110 }), { futureMove: { ...fs, source: OL } }))),
  checks: "abilities.ts berserk onAfterMoveSecondary on the landing.",
  outcomes: true,
}));
add("T2E-FS12", ["sv", "champions"], (game) => ({
  title: "Psychic Terrain boosts the landing of a grounded Hatterene on the bench (FS12b)",
  field: { terrain: "Psychic" },
  slots: slots(idle(L(game, 2)), idle(L(game, 4)), idle(L(game, 12)), idle(carried(L(game, 8), { futureMove: { ...fs, bench: hatt(game), benchSide: "own" } }))),
  checks: "psychicterrain onBasePower reads the source's grounding (no Air Balloon or Levitate off the field).",
}));
add("T2E-FS13", ["sv", "swsh"], (game) => ({
  title: "A Hatterene that fainted on an earlier turn (on the bench at 0 HP): its Future Sight still lands (FS16)",
  slots: slots(idle(L(game, 2)), idle(L(game, 4)), idle(L(game, 12)), idle(carried(L(game, 8), { futureMove: { ...fs, bench: hatt(game), benchSide: "own", fainted: true } }))),
  checks: "Only target === source and a fainted target stop it (conditions.ts:398-401): 108–127.",
}));
add("T2E-FS14", ["sv", "champions"], (game) => ({
  title: "An active Shell Bell Hatterene at 50 HP: its landing heals it nothing (FS07b)",
  slots: slots(idle(hatt(game, { item: "Shell Bell", hp: 50 })), idle(L(game, 4)), idle(L(game, 12)), idle(carried(L(game, 8), { futureMove: { ...fs, source: OL } }))),
  checks: "Only Life Orb's AfterMoveSecondarySelf runs for the landing.",
}));

// ================================ Cud Chew (T2E §4.2, CC01–CC10, SV and Champions) ================================
const giraf = (extra: Partial<CaseMon> = {}) => mon("Farigiraf", "Cud Chew", extra);
const CC: Game[] = ["sv", "champions"];
add("T2E-CC01", CC, (game) => ({
  title: "Cud Chew re-eats the Sitrus Berry it ate last turn: +48 at 28.2 (CC04a without Unnerve)",
  outcomes: true,
  slots: slots(idle(carried(giraf({ hp: 100 }), { cudChew: "Sitrus Berry" })), idle(L(game, 1)), idle(L(game, 3)), idle(L(game, 2))),
  checks: "abilities.ts cudchew onResidual: --counter 0, singleEvent Eat: trunc(195/4).",
}));
add("T2E-CC02", CC, (game) => ({
  title: "The Sitrus eaten in the moves: counter 2 → 1 at this residual, no re-eat; E2 cudChew (CC01 turn 1)",
  outcomes: true,
  slots: slots(idle(giraf({ item: "Sitrus Berry", hp: 150 })), idle(L(game, 1)), idle(L(game, 3)), act(mon("Garchomp", "Rough Skin", { evs: fastEvs(game) }), "Dragon Claw", OL)),
  checks: "onEatItem sets berry and counter 2; the residual lowers it to 1.",
}));
add("T2E-CC03", CC, (game) => ({
  title: "The Sitrus eaten at the sandstorm's Update (order 1, the queue empty): counter 1, re-eaten at 28.2 the same turn (CC02)",
  outcomes: true, field: { weather: "Sand" },
  slots: slots(idle(giraf({ item: "Sitrus Berry", hp: 105 })), idle(mon("Tyranitar", "Sand Stream")), idle(L(game, 3)), idle(L(game, 2))),
  checks: "counter-- when the queue is empty: the same residual's 28.2 re-eats it (93 → 141 → 189).",
}));
add("T2E-CC04", CC, (game) => ({
  title: "The Sitrus eaten at the final Update after Leech Seed: counter 1, due next turn (E2 cudChew) (CC03)",
  outcomes: true,
  slots: slots(idle(carried(giraf({ item: "Sitrus Berry", hp: 110 }), { leechSeed: PR })), idle(L(game, 1)), idle(L(game, 3)), idle(L(game, 2))),
  checks: "The final Update (after 28.2) eats it; the counter starts at 1 for the next turn.",
}));
add("T2E-CC05", CC, (game) => ({
  title: "Cud Chew's Berry due now beside a foe's Unnerve: re-eaten (+48) (CC04a)",
  outcomes: true,
  slots: slots(idle(carried(giraf({ hp: 100 }), { cudChew: "Sitrus Berry" })), idle(L(game, 1)), idle(L(game, 3)), idle(mon("Tyranitar", "Unnerve"))),
  checks: "The re-eat is an Eat event: no TryEatItem, Unnerve passes.",
}));
add("T2E-CC06", CC, (game) => ({
  title: "Cud Chew's Berry due now under Heal Block: eaten, no HP (CC04b)",
  outcomes: true,
  slots: slots(idle(carried(giraf({ hp: 100 }), { cudChew: "Sitrus Berry", healBlock: 3 })), idle(L(game, 1)), idle(L(game, 3)), idle(L(game, 2))),
  checks: "The Sitrus' heal through TryHeal: Heal Block stops it; the counter ends.",
}));
add("T2E-CC07", ["champions", "sv"], (game) => ({
  title: "A Lum Berry re-eaten cures the poison a foe's Toxic gave this turn (after the poison damage at 9) (CC05)",
  outcomes: true,
  slots: slots(idle(carried(giraf(), { cudChew: "Lum Berry" })), idle(L(game, 1)), idle(L(game, 3)), act(mon("Glimmora", "Toxic Debris", { evs: fastEvs(game) }), "Toxic", OL)),
  checks: "tox damage at 9, then 28.2's Lum cures it.",
}));
add("T2E-CC08", ["sv"], () => ({
  title: "A Liechi Berry re-eaten: +1 Attack, copied by a foe's Opportunist at 29 (CC06)",
  outcomes: true,
  slots: slots(idle(carried(giraf(), { cudChew: "Liechi Berry" })), idle(L("sv", 1)), idle(L("sv", 3)), idle(mon("Espathra", "Opportunist"))),
  checks: "The rise goes through boost(): Opportunist copies it at the residual's end.",
}));
add("T2E-CC08b", ["sv"], () => ({
  title: "A Liechi Berry re-eaten with no copier: +1 Attack (CC06 control). Champions has no Liechi Berry: SV twice",
  outcomes: true,
  slots: slots(idle(carried(giraf(), { cudChew: "Liechi Berry" })), idle(L("sv", 1)), idle(L("sv", 3)), idle(L("sv", 2))),
  checks: "+1 Attack at 28.2.",
}));
add("T2E-CC09", ["sv"], () => ({
  title: "A Starf Berry re-eaten at Attack +6: one of the other four stats +2, 1/4 each (CC09). Champions has no Starf Berry",
  outcomes: true,
  slots: slots(idle(carried(giraf({ boosts: { atk: 6 } }), { cudChew: "Starf Berry" })), idle(L("sv", 1)), idle(L("sv", 3)), idle(L("sv", 2))),
  checks: "starfberry onEat: sample over the stats below +6.",
}));
add("T2E-CC10", CC, (game) => ({
  title: "A Lum Berry eaten in the moves replaces the due Sitrus: the Sitrus is not re-eaten, the Lum is due next turn (CC10)",
  outcomes: true,
  slots: slots(idle(carried(giraf({ item: "Lum Berry", hp: 100 }), { cudChew: "Sitrus Berry" })), idle(L(game, 1)), idle(L(game, 3)), act(mon("Glimmora", "Toxic Debris", { evs: fastEvs(game) }), "Toxic", OL)),
  checks: "onEatItem overwrites berry with counter 2: no re-eat this turn (E2 cudChew lumberry).",
}));
// ADDENDUM2 §9's cross-family checklist: a Berry a foe's Bug Bite took is not Cud Chew's.
add("T2E-CC12", ["sv"], () => ({
  title: "A foe's Bug Bite eats Farigiraf's Sitrus Berry: Cud Chew has nothing due (the Berry was not its own eat)",
  outcomes: true,
  slots: slots(idle(giraf({ item: "Sitrus Berry", hp: 150 })), idle(L("sv", 1)), idle(L("sv", 3)), act(mon("Lokix", "Tinted Lens", { evs: { spe: 252 } }), "Bug Bite", OL)),
  checks: "abilities.ts cudchew onEatItem skips a Berry eaten through Bug Bite or Pluck (the eater is the attacker).",
}));
add("T2E-CC11", ["champions", "sv"], (game) => ({
  title: "Cud Chew's Sitrus due now at full HP: eaten, no HP (CC07)",
  outcomes: true,
  slots: slots(idle(carried(giraf(), { cudChew: "Sitrus Berry" })), idle(L(game, 1)), idle(L(game, 3)), idle(L(game, 2))),
  checks: "The heal at full HP is nothing; the counter ends.",
}));

// ================================ Moody (T2E §4.3, MO01–MO05) ================================
const moody = (game: Game, extra: Partial<CaseMon> = {}) => mon(game === "usum" ? "Octillery" : "Glalie", "Moody", extra);
add("T2E-MO01", ["sv", "champions"], (game) => ({
  title: "Moody from 0: +2 to one of five, −1 to another of the rest: 20 outcomes (MO01, MO06)",
  outcomes: true,
  slots: slots(idle(moody(game)), idle(L(game, 1)), idle(L(game, 3)), idle(L(game, 2))),
  checks: "abilities.ts moody onResidual (gen 8+): two samples, one boost().",
}));
add("T2E-MO02", ["usum"], () => ({
  title: "Generation 7 Moody from 0: accuracy and evasion too: 42 outcomes (MO02)",
  outcomes: true,
  slots: slots(idle(moody("usum")), idle(L("usum", 1)), idle(L("usum", 3)), idle(L("usum", 2))),
  checks: "mods/gen7 moody: seven stats.",
}));
add("T2E-MO02b", ["usum"], () => ({
  title: "Generation 7 Moody at evasion +6: the rise among the other six",
  outcomes: true,
  slots: slots(idle(carried(moody("usum"), { stages: { evasion: 6 } })), idle(L("usum", 1)), idle(L("usum", 3)), idle(L("usum", 2))),
  checks: "No rise for a stat at +6.",
}));
add("T2E-MO03", ["sv", "swsh"], (game) => ({
  title: "Moody at Attack +6 and Speed −6: four rises, then three or four drops (MO03)",
  outcomes: true,
  slots: slots(idle(moody(game, { boosts: { atk: 6, spe: -6 } })), idle(L(game, 1)), idle(L(game, 3)), idle(L(game, 2))),
  checks: "The candidates read the stages: 1/12 and 1/16 paths.",
}));
add("T2E-MO04", ["sv", "champions"], (game) => ({
  title: "Moody with its own White Herb: the −1 restored at 29, the Herb used (MO04)",
  slots: slots(idle(moody(game, { item: "White Herb" })), idle(L(game, 1)), idle(L(game, 3)), idle(L(game, 2))),
  checks: "whiteherb at the final Update after Moody's drop.",
  outcomes: true,
}));
add("T2E-MO05", ["sv", "champions"], (game) => ({
  title: "Moody's +2 copied by a foe's Opportunist at 29 (MO05)",
  slots: slots(idle(moody(game)), idle(L(game, 1)), idle(L(game, 3)), idle(mon("Espathra", "Opportunist"))),
  checks: "Opportunist copies the rise (not the drop).",
  outcomes: true,
}));

// ================================ G-Max damage over time (T2E §4.4, SwSh, GX01–GX06) ================================
const G = (species: string, ability: string, extra: Partial<CaseMon> = {}): CaseMon =>
  mon(species, ability, { evs: { spe: 252 }, choice: "dynamax", gigantamax: true, appBuild: { mechanic: "gigantamax", configuration: { dynamaxLevel: 10, gigantamax: true } }, ...extra });
add("T2E-GX01", ["swsh"], () => ({
  title: "G-Max Wildfire into a non-Fire pair on Grassy Terrain, one with Leftovers: 1/6 at 5.1 before the terrain (5.2) and Leftovers (5.4) (GX01)",
  field: { terrain: "Grassy" },
  slots: slots(act(G("Charizard", "Blaze"), "Flamethrower", PR), idle(L("swsh", 1)), idle(L("swsh", 3)), idle(L("swsh", 2, { item: "Leftovers" }))),
  checks: "gmaxwildfire side condition onResidual 5.1 for each active non-Fire foe.",
  outcomes: true,
}));
add("T2E-GX01b", ["swsh"], () => ({
  title: "G-Max Wildfire into a Substitute: the side condition is still set (GX02)",
  slots: slots(act(G("Charizard", "Blaze"), "Flamethrower", PR), idle(L("swsh", 1)), idle(L("swsh", 3)), idle(L("swsh", 2, { substitute: 60 }))),
  checks: "self.onHit on a Substitute hit.",
  outcomes: true,
}));
add("T2E-GX02", ["swsh"], () => ({
  title: "G-Max Wildfire through a Protect (a quarter): the side condition is set (GX03)",
  slots: slots(act(G("Charizard", "Blaze"), "Flamethrower", PR), idle(L("swsh", 1)), idle(L("swsh", 3)), act(L("swsh", 2), "Protect")),
  checks: "Max Moves through protection: 1/4 and their effects.",
  outcomes: true,
}));
add("T2E-GX02b", ["swsh"], () => ({
  title: "G-Max Cannonade with a Magic Guard Clefable (nothing) and a Dynamaxed Snorlax (floor(base max HP / 6)) on the foe side (GX04)",
  slots: slots(act(G("Blastoise", "Torrent"), "Surf", PR), idle(L("swsh", 1)), act(L("swsh", 3, { choice: "dynamax" }), "Body Slam", OR), idle(mon("Clefable", "Magic Guard"))),
  checks: "Magic Guard: no residual damage; a Dynamaxed foe takes baseMaxhp / 6.",
  outcomes: true,
}));
add("T2E-GX03", ["swsh"], () => ({
  title: "G-Max Centiferno traps both foes; Centiskorch is then knocked out by a slower Stone Edge; each trap still deals 1/8 (GX05)",
  slots: slots(act(G("Centiskorch", "Flash Fire", { hp: 30 }), "Fire Lash", PR), idle(L("swsh", 1)), act(mon("Garchomp", "Rough Skin", { nature: "Brave", ivs: { spe: 0 } }), "Stone Edge", OL), idle(L("swsh", 2))),
  checks: "partiallytrapped with gmaxEffect: it continues after the source left (conditions.ts:222-260).",
}));
add("T2E-GX03b", ["swsh"], () => ({
  title: "G-Max Sandblast from a Binding Band Sandaconda: both foes trapped, 1/6 each",
  slots: slots(act(G("Sandaconda", "Sand Spit", { item: "Binding Band" }), "Earthquake", PR), idle(L("swsh", 1)), idle(L("swsh", 3)), idle(L("swsh", 2))),
  checks: "Binding Band: boundDivisor 6. (Sand Spit: the hits start a sandstorm.)",
}));
add("T2E-GX04", ["swsh"], () => ({
  title: "G-Max Vine Lash on the foe side from an earlier turn (3 turns left): 1/6 to each non-Grass foe at 5.1 (GX06)",
  field: { opponent: { gmaxResidual: ["gmaxvinelash"] } },
  slots: slots(idle(L("swsh", 1)), idle(L("swsh", 4)), idle(L("swsh", 3)), idle(mon("Venusaur", "Overgrow"))),
  checks: "SideConditions.gmaxResidual: the Grass Venusaur takes none.",
  outcomes: true,
}));
add("T2E-GX04b", ["swsh"], () => ({
  title: "G-Max Volcalith on the foe side from an earlier turn beside a Rock-type Tyranitar: the Snorlax 1/6, Tyranitar none",
  field: { weather: "Sand", opponent: { gmaxResidual: ["gmaxvolcalith"] } },
  slots: slots(idle(L("swsh", 1)), idle(L("swsh", 4)), idle(mon("Tyranitar", "Sand Stream")), idle(L("swsh", 3))),
  checks: "gmaxvolcalith spares Rock types.",
  outcomes: true,
}));

// ================================ forms at 29 (T2E §4.5, FC01–FC06) ================================
add("T2E-FC01", ["usum"], () => ({
  title: "A poisoned Darmanitan (95/180) falls to half: Zen Mode at 29 (Fire/Psychic, Speed 115 → 75), its HP unchanged (FC01)",
  outcomes: true,
  slots: slots(idle(mon("Darmanitan", "Zen Mode", { status: "psn", hp: 95 })), idle(L("usum", 1)), idle(L("usum", 3)), idle(L("usum", 2))),
  checks: "abilities.ts zenmode onResidual 29: formeChange darmanitanzen (not permanent).",
}));
add("T2E-FC01", ["swsh"], () => ({
  title: "A poisoned Galarian Darmanitan (95/180) falls to half: Zen Mode (Ice/Fire) (FC03)",
  outcomes: true,
  slots: slots(idle(mon("Darmanitan-Galar", "Zen Mode", { status: "psn", hp: 95 })), idle(L("swsh", 1)), idle(L("swsh", 3)), idle(L("swsh", 2))),
  checks: "darmanitangalarzen.",
}));
add("T2E-FC02", ["usum"], () => ({
  title: "Darmanitan-Zen above half after its Leftovers (85 → 96 of 180): back to Darmanitan at 29 (FC02)",
  outcomes: true,
  slots: slots(idle(mon("Darmanitan-Zen", "Zen Mode", { item: "Leftovers", hp: 85 })), idle(L("usum", 1)), idle(L("usum", 3)), idle(L("usum", 2))),
  checks: "zenmode: above half, the base form.",
}));
add("T2E-FC02", ["swsh"], () => ({
  title: "Galarian Darmanitan-Zen above half after its Leftovers: back to Galarian Darmanitan (FC02)",
  outcomes: true,
  slots: slots(idle(mon("Darmanitan-Galar-Zen", "Zen Mode", { item: "Leftovers", hp: 85 })), idle(L("swsh", 1)), idle(L("swsh", 3)), idle(L("swsh", 2))),
  checks: "darmanitangalar.",
}));
add("T2E-FC03", ["sv", "usum"], (game) => ({
  title: "Shields Down Minior (Meteor at the start) seeded to half: its Core at 29, Speed up (FC04)",
  outcomes: true,
  slots: slots(idle(carried(mon("Minior", "Shields Down", { appSpecies: "miniormeteor", hp: 70 }), { leechSeed: PR })), idle(L(game, 1)), idle(L(game, 3)), idle(L(game, 2))),
  checks: "shieldsdown onResidual 29: the Core form below half (Leech Seed 1/8 of 135).",
}));
add("T2E-FC04", ["swsh", "usum"], (game) => ({
  title: "Schooling Wishiwashi (School) poisoned to a quarter or less: Solo at 29 (FC05)",
  outcomes: true,
  slots: slots(idle(mon("Wishiwashi", "Schooling", { appSpecies: "wishiwashischool", status: "psn", hp: 35 })), idle(L(game, 1)), idle(L(game, 3)), idle(L(game, 2))),
  checks: "schooling onResidual 29: Solo at or under a quarter.",
}));
add("T2E-FC05", ["usum", "swsh"], (game) => ({
  title: "Power Construct Zygarde poisoned to half or less: Complete at 29: the end of turn's kept reason (FC06)",
  endNotEstimated: "Power Construct changing Zygarde's form is not modelled in 2v2.",
  slots: slots(idle(mon("Zygarde", "Power Construct", { status: "psn", hp: 100 })), idle(L(game, 1)), idle(L(game, 3)), idle(L(game, 2))),
  checks: "REASONS.formChange (kept, §2.3 #39): the maximum HP changes per outcome.",
}));
void OR; void PL;

/** Wave 1b's T2E- cases (E2). */
export const T2E_1B_CASES: Case[] = cases;

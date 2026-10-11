// status2 IN- cases (inputs.md §8, merged by ADDENDUM2 §7.2): every earlier-turn input in a turn that reads it, against
// pinned Showdown c23d2e94. Wave 1a (Track V1): the cases whose tracks merge at integration 1a (N: IN-STL but -04, IN-DBD,
// IN-ENT, IN-PRT; H: IN-CHG-01; W: IN-SFG; the kernel's charging release and Laser Focus: IN-CHG-02…04, IN-LSF; A1: IN-STK,
// IN-ACC; A2: IN-ATR; A3: IN-MST, IN-SPT; the existing paths: IN-SEC, IN-NBL). The 1b ones (IN-STL-04, IN-TLK, IN-FLD,
// IN-CUD, IN-FSL, IN-TNT, IN-HBK, IN-RTL, IN-ECV, IN-CPY, IN-BBD) are V2's. Probes: inputs-probes-1.ts (IN-Pnn).
// Showdown names; level 50, 31 IVs, Serious nature, 0 EVs unless set (Champions: Stat Points). Wired into cases-se.ts.
import type { Case, Game } from "./case-types";
import { OL, OR, PL, PR, act, carried, idle, lax, mon, perGame, slots } from "./case-kit";

/** Speed EVs giving Speed 50 + k for Snorlax-like bases (native: 8 EVs a point; Champions: one Stat Point a point). */
const k = (game: Game, n: number) => (game === "champions" ? n : n * 8);
const fastSpe = (game: Game) => (game === "champions" ? 32 : 252);
/** Champions has no Tackle: Body Slam there. */
const tackle = (game: Game) => (game === "champions" ? "Body Slam" : "Tackle");

// ---- N: the stall counter (IN-P01, IN-P02; C23) ----
const STL: Case[] = [
  ...perGame("IN-STL-01", ["sv", "champions"], (game) => ({
    title: "Garchomp Protect with stall 3 (a protecting move last turn); a slower foe's attack into it (IN-P01)",
    slots: slots(act(carried(mon("Garchomp", "Rough Skin", { evs: { spe: fastSpe(game) } }), { stall: 3 }), "Protect"), idle(lax(k(game, 0))),
      act(lax(k(game, 2)), tackle(game), OL), idle(lax(k(game, 1)))),
    checks: "PS/data/conditions.ts stall onStallMove: Protect works 1/3 (randomChance(1, 3)); it fails 2/3 and the attack lands.",
  })),
  ...perGame("IN-STL-01b", ["sv"], (game) => ({
    title: "The same with an explicit stall 1 (no protecting move last turn): Protect works, no assumption fact (C23)",
    slots: slots(act(carried(mon("Garchomp", "Rough Skin", { evs: { spe: fastSpe(game) } }), { stall: 1 }), "Protect"), idle(lax(k(game, 0))),
      act(lax(k(game, 2)), tackle(game), OL), idle(lax(k(game, 1)))),
    checks: "No stall volatile: Protect is certain; the app gives no 'Assumes no protecting move was used last turn.' fact for an explicit 1.",
  })),
  ...perGame("IN-STL-02", ["sv"], (game) => ({
    title: "Snorlax at 40 HP Endures with stall 9; Garchomp's Dragon Claw into it (IN-P01's rule)",
    slots: slots(act(carried(lax(k(game, 0), { hp: 40 }), { stall: 9 }), "Endure"), idle(lax(k(game, 1))),
      act(mon("Garchomp", "Rough Skin"), "Dragon Claw", OL), idle(lax(k(game, 2)))),
    checks: "Endure works 1/9 (the stall roll): Snorlax survives at 1 HP; 8/9 it fails and Dragon Claw (81-96) knocks it out.",
  })),
  ...perGame("IN-STL-03", ["sv"], (game) => ({
    title: "A confused Garchomp under Gravity uses Protect with stall 3; a slower foe's Tackle (IN-P02)",
    field: { gravity: true },
    slots: slots(act(carried(mon("Garchomp", "Rough Skin", { evs: { spe: fastSpe(game) } }), { stall: 3, confusion: { attempts: 0 } }), "Protect"), idle(lax(k(game, 0))),
      act(lax(k(game, 2)), "Tackle", OL), idle(lax(k(game, 1)))),
    checks: "Confusion runs first (a 1/3 self-hit), then the stall roll at PrepareHit (1/3); Gravity does not stop Protect (no gravity flag) (IN-C4).",
  })),
];

// ---- H and the kernel: a two-turn move charged last turn (IN-P03, IN-P03b; C38) ----
const CHG: Case[] = [
  ...perGame("IN-CHG-01", ["sv", "champions"], (game) => ({
    title: "Garchomp's Dig charged last turn: a faster Weavile's Night Slash into it misses; Dig released into Weavile; Snorlax's Earthquake (IN-P03)",
    slots: slots(act(mon("Weavile", "Pressure", { evs: { spe: fastSpe(game) } }), "Night Slash", PR), act(lax(k(game, 0)), "Earthquake"),
      idle(lax(k(game, 1))), act(carried(mon("Garchomp", "Rough Skin"), { charging: "dig" }), "Dig", OL)),
    checks: "twoturnmove + dig from last turn: out of reach from the turn's start (Night Slash [miss]); Dig released with no charge; Earthquake then hits Garchomp normally.",
  })),
  ...perGame("IN-CHG-02", ["sv"], () => ({
    title: "Venusaur's Solar Beam charged last turn released with no sun; its Power Herb stays held (IN-P03b)",
    slots: slots(act(carried(mon("Venusaur", "Overgrow", { item: "Power Herb" }), { charging: "solarbeam" }), "Solar Beam", PL), idle(lax(0)),
      idle(lax(16)), idle(lax(8))),
    checks: "The release is the move with no charge turn (moves.ts solarbeam onTryMove: removeVolatile then hit); Power Herb is not used.",
    outcomes: true,
  })),
  ...perGame("IN-CHG-03", ["champions"], () => ({
    title: "Archaludon's Electro Shot charged last turn released with no rain (the +1 Sp. Atk came with the charge)",
    slots: slots(act(carried(mon("Archaludon", "Stamina", { boosts: { spa: 1 } }), { charging: "electroshot" }), "Electro Shot", PL), idle(lax(0)),
      idle(lax(2)), idle(lax(1))),
    checks: "Electro Shot's release: no new boost (its +1 came on the charge turn), the hit at +1.",
    outcomes: true,
  })),
  ...perGame("IN-CHG-04", ["usum"], () => ({
    title: "Xerneas's Geomancy charged last turn released: +2 Sp. Atk, Sp. Def, Speed",
    slots: slots(act(carried(mon("Xerneas", "Fairy Aura"), { charging: "geomancy" }), "Geomancy"), idle(lax(0)),
      idle(lax(16)), idle(lax(8))),
    checks: "SPEC2 A1: the generic two-turn release (C38): Geomancy boosts at its release.",
    outcomes: true,
  })),
];

// ---- the kernel and Step 0b's crit ratio: Laser Focus from last turn (IN-P04) ----
const LSF: Case[] = [
  ...perGame("IN-LSF-01", ["usum", "swsh"], () => ({
    title: "Kommo-o used Laser Focus last turn: Close Combat into Snorlax is critical (IN-P04)",
    slots: slots(act(carried(mon("Kommo-o", "Bulletproof"), { laserFocus: true }), "Close Combat", PL), idle(lax(0)),
      idle(lax(16)), idle(lax(8))),
    checks: "laserfocus (1 turn left) onModifyCritRatio 5: always critical (IN-P04: -crit, a KO).",
  })),
  ...perGame("IN-LSF-02", ["usum"], () => ({
    title: "Laser Focus last turn, Close Combat into a Lucky Chant side: no critical hit (IN-P04, F35)",
    field: { opponent: { luckyChant: true } },
    slots: slots(act(carried(mon("Kommo-o", "Bulletproof"), { laserFocus: true }), "Close Combat", PL), idle(lax(0)),
      idle(lax(16)), idle(lax(8))),
    checks: "luckychant onCriticalHit false beats Laser Focus's ratio.",
  })),
];

// ---- N: Destiny Bond from last turn (IN-P05, IN-P05b; IN-C5) ----
const gengar = (spe: number, extra = {}) => mon("Gengar", "Cursed Body", { evs: { spe }, hp: 1, ...extra });
const DBD: Case[] = [
  ...perGame("IN-DBD-01", ["sv", "champions"], (game) => ({
    title: "Gengar (1 HP) has Destiny Bond up from last turn; a faster Weavile's Night Slash knocks it out (IN-P05)",
    slots: slots(act(mon("Weavile", "Pressure", { evs: { spe: fastSpe(game) } }), "Night Slash", PR), idle(lax(k(game, 0))),
      idle(lax(k(game, 1))), idle(carried(gengar(0, { ivs: { spe: 0 }, nature: "Brave" }), { destinyBond: true }))),
    checks: "destinybond onFaint: Weavile faints too (-activate Destiny Bond, faint Weavile).",
  })),
  ...perGame("IN-DBD-02", ["sv"], () => ({
    title: "Gengar with Destiny Bond up uses Destiny Bond again: it fails; a slower Snorlax's Crunch then knocks it out (IN-P05b)",
    slots: slots(act(lax(0), "Crunch", PR), idle(lax(8)),
      idle(lax(16)), act(carried(gengar(0), { destinyBond: true }), "Destiny Bond")),
    checks: "moves.ts destinybond onPrepareHit: removeVolatile returns true, the move fails; no Destiny Bond stands when Crunch knocks it out.",
  })),
  ...perGame("IN-DBD-03", ["usum"], () => ({
    title: "An asleep Gengar (1 HP) with Destiny Bond up: its aborted action removes it; a slower Snorlax's Crunch knocks it out",
    slots: slots(act(lax(0), "Crunch", PR), idle(lax(8)),
      idle(lax(16)), act(carried(gengar(252, { status: "slp" }), { destinyBond: true }), "Shadow Ball", OL)),
    checks: "destinybond onMoveAborted: removed when sleep stops the action; Snorlax lives.",
  })),
];

// ---- N: the entry order for redirection ties (IN-P08; IN-C3, C37) ----
const ENT: Case[] = [
  ...perGame("IN-ENT-01", ["sv"], () => ({
    title: "Two equal-Speed Clefairy use Follow Me; Snorlax's Body Slam at the left one; the right Clefairy entered first (IN-P08a)",
    entryOrder: { "opponent-right": 0, "opponent-left": 1 },
    slots: slots(act(lax(0, { ivs: { spe: 0 } }), "Body Slam", PL), idle(lax(8)),
      act(mon("Clefairy", "Magic Guard"), "Follow Me"), act(mon("Clefairy", "Magic Guard"), "Follow Me")),
    checks: "sim/battle.ts compareRedirectOrder: the older ability state (the right Clefairy's) takes the Body Slam, whichever Follow Me came first.",
  })),
  ...perGame("IN-ENT-01b", ["sv"], () => ({
    title: "The same with the left Clefairy entered first: it keeps the Body Slam",
    entryOrder: { "opponent-left": 0, "opponent-right": 1 },
    slots: slots(act(lax(0, { ivs: { spe: 0 } }), "Body Slam", PL), idle(lax(8)),
      act(mon("Clefairy", "Magic Guard"), "Follow Me"), act(mon("Clefairy", "Magic Guard"), "Follow Me")),
    checks: "The order the other way: the left Clefairy's state is older.",
  })),
  ...perGame("IN-ENT-01", ["champions"], () => ({
    title: "Champions: two equal-Speed Volcarona use Rage Powder; Snorlax's Body Slam at the left one; the right Volcarona entered first",
    entryOrder: { "opponent-right": 0, "opponent-left": 1 },
    slots: slots(act(lax(0), "Body Slam", PL), idle(lax(1)),
      act(mon("Volcarona", "Swarm"), "Rage Powder"), act(mon("Volcarona", "Swarm"), "Rage Powder")),
    checks: "Rage Powder's ties read the holders' ability states as Follow Me's (IN-C3).",
  })),
  ...perGame("IN-ENT-01b", ["champions"], () => ({
    title: "Champions: the same with the left Volcarona entered first",
    entryOrder: { "opponent-left": 0, "opponent-right": 1 },
    slots: slots(act(lax(0), "Body Slam", PL), idle(lax(1)),
      act(mon("Volcarona", "Swarm"), "Rage Powder"), act(mon("Volcarona", "Swarm"), "Rage Powder")),
    checks: "The order the other way.",
  })),
  ...perGame("IN-ENT-02", ["sv"], () => ({
    title: "Lightning Rod on both sides at one Speed (Raichu beside the attacker, Zebstrika on the foe's side); Rotom's Thunderbolt at Snorlax; Raichu entered first (IN-P08b)",
    entryOrder: { "own-right": 0, "opponent-right": 1 },
    slots: slots(act(mon("Rotom", "Levitate"), "Thunderbolt", PL), idle(mon("Raichu", "Lightning Rod", { evs: { spe: 48 } })),
      idle(lax(0)), idle(mon("Zebstrika", "Lightning Rod"))),
    checks: "The older holder (Raichu) takes the Thunderbolt (its Sp. Atk +1).",
  })),
  ...perGame("IN-ENT-02b", ["sv"], () => ({
    title: "The same with Zebstrika entered first: it takes the Thunderbolt",
    entryOrder: { "opponent-right": 0, "own-right": 1 },
    slots: slots(act(mon("Rotom", "Levitate"), "Thunderbolt", PL), idle(mon("Raichu", "Lightning Rod", { evs: { spe: 48 } })),
      idle(lax(0)), idle(mon("Zebstrika", "Lightning Rod"))),
    checks: "The order the other way: Zebstrika's state is older.",
  })),
  ...perGame("IN-ENT-02c", ["sv"], () => ({
    title: "The same with the entry order not given: the reason",
    notEstimated: "Lightning Rod needs whether Raichu or Zebstrika came in first.",
    slots: slots(act(mon("Rotom", "Levitate"), "Thunderbolt", PL), idle(mon("Raichu", "Lightning Rod", { evs: { spe: 48 } })),
      idle(lax(0)), idle(mon("Zebstrika", "Lightning Rod"))),
    checks: "REASONS.needsEntryOrder (ADDENDUM2 §2.4) while the order is Unknown.",
  })),
  ...perGame("IN-ENT-02", ["usum"], () => ({
    title: "USUM: Storm Drain on both sides at one Speed (Finneon beside the attacker, Lumineon on the foe's side); Starmie's Scald at Snorlax; Finneon entered first",
    entryOrder: { "own-right": 0, "opponent-right": 1 },
    slots: slots(act(mon("Starmie", "Illuminate"), "Scald", PL), idle(mon("Finneon", "Storm Drain")),
      idle(lax(0)), idle(mon("Lumineon", "Storm Drain", { ivs: { spe: 0 }, nature: "Brave" }))),
    checks: "Storm Drain's tie by the ability states (IN-C3): Finneon takes the Scald (Sp. Atk +1).",
  })),
  ...perGame("IN-ENT-02b", ["usum"], () => ({
    title: "USUM: the same with Lumineon entered first",
    entryOrder: { "opponent-right": 0, "own-right": 1 },
    slots: slots(act(mon("Starmie", "Illuminate"), "Scald", PL), idle(mon("Finneon", "Storm Drain")),
      idle(lax(0)), idle(mon("Lumineon", "Storm Drain", { ivs: { spe: 0 }, nature: "Brave" }))),
    checks: "The order the other way.",
  })),
];

// ---- A1: Stockpile's counts (SA09, SA09b; C17) ----
const STK: Case[] = [
  ...perGame("IN-STK-01", ["sv"], () => ({
    title: "Swalot with 2 Stockpile layers (+2 Def, +2 Sp. Def; counts −2, −2) at 100 HP uses Swallow",
    slots: slots(act(carried(mon("Swalot", "Liquid Ooze", { hp: 100, boosts: { def: 2, spd: 2 } }), { stockpile: { layers: 2, def: -2, spd: -2 } }), "Swallow"), idle(lax(0)),
      idle(lax(16)), idle(lax(8))),
    checks: "moves.ts swallow: heals 1/2 for 2 layers; the stockpile End lowers Def and Sp. Def by the counts (back to 0).",
    outcomes: true,
  })),
  ...perGame("IN-STK-01", ["usum"], () => ({
    title: "USUM: Simple Numel with 1 layer at +2 Def / +2 Sp. Def (counts −1, −1) uses Swallow at 60 HP",
    slots: slots(act(carried(mon("Numel", "Simple", { hp: 60, boosts: { def: 2, spd: 2 } }), { stockpile: { layers: 1, def: -1, spd: -1 } }), "Swallow"), idle(lax(0)),
      idle(lax(16)), idle(lax(8))),
    checks: "The End goes through boost() with Simple: −2 each (CQ01b's rule), back to 0.",
    outcomes: true,
  })),
  ...perGame("IN-STK-02", ["champions"], () => ({
    title: "Champions: Swalot with 3 layers and no counts given uses Spit Up into Snorlax",
    slots: slots(act(carried(mon("Swalot", "Liquid Ooze", { boosts: { def: 3, spd: 3 } }), { stockpile: { layers: 3 } }), "Spit Up", PL), idle(lax(0)),
      idle(lax(2)), idle(lax(1))),
    checks: "Spit Up 300 power; counts absent: the app assumes −3 each (the fact), as the oracle's setup does; the End lowers both by 3.",
    outcomes: true,
  })),
];

// ---- A2: infatuation from an earlier turn (SPEC2 A2) ----
const ATR: Case[] = [
  ...perGame("IN-ATR-01", ["sv", "champions"], (game) => ({
    title: "A male Garchomp infatuated by the female Snorlax across (last turn) uses Dragon Claw into it: 1/2 immobilised",
    slots: slots(act(carried(mon("Garchomp", "Rough Skin", { gender: "M" }), { attract: PR }), "Dragon Claw", PR), idle(lax(k(game, 0))),
      idle(lax(k(game, 1))), idle(lax(k(game, 2), { gender: "F" }))),
    checks: "moves.ts attract condition onBeforeMove: randomChance(1, 2) cant Attract.",
  })),
];

// ---- A1 / D: a carried evasion stage read this turn (IN-P16, F4 D) ----
const ACC: Case[] = [
  ...perGame("IN-ACC-01", ["sv", "champions"], (game) => ({
    title: "A Pokémon at evasion +6 (earlier turns) uses Acupressure on itself: six stats, 1/6 each (IN-P16)",
    slots: slots(idle(lax(k(game, 0))), act(carried(game === "sv" ? mon("Tsareena", "Leaf Guard") : mon("Medicham", "Pure Power"), { stages: { evasion: 6 } }), "Acupressure", OR),
      idle(lax(k(game, 2))), idle(lax(k(game, 1)))),
    checks: "moves.ts acupressure samples among the stats below +6: six with evasion at +6.",
    outcomes: true,
  })),
  ...perGame("IN-ACC-02", ["sv"], () => ({
    title: "Espathra with a carried evasion +2 uses Stored Power into Snorlax (F4 D)",
    slots: slots(act(carried(mon("Espathra", "Opportunist"), { stages: { evasion: 2 } }), "Stored Power", PL), idle(lax(0)),
      idle(lax(16)), idle(lax(8))),
    checks: "Stored Power counts accuracy and evasion stages: 20 + 20 × 2 = 60 power.",
  })),
];

// ---- W: Safeguard from before the turn (SPEC2 A, T2M §3.27) ----
const SFG: Case[] = [
  ...perGame("IN-SFG-01", ["sv", "usum"], () => ({
    title: "The opponent's side has Safeguard from an earlier turn: Raichu's Thunder Wave and Pikachu's Nuzzle into it",
    field: { opponent: { safeguard: true } },
    slots: slots(act(mon("Raichu", "Static", { evs: { spe: 252 } }), "Thunder Wave", PL), act(mon("Pikachu", "Static"), "Nuzzle", PR),
      idle(lax(16)), idle(lax(8))),
    checks: "safeguard onSetStatus: no paralysis from either (Nuzzle's damage lands).",
    outcomes: true,
  })),
];

// ---- A3: Mist, the Sports from before the turn (F40, F75) ----
const MST: Case[] = [
  ...perGame("IN-MST-01", ["sv", "swsh"], () => ({
    title: "The opponent's side has Mist from an earlier turn: Lapras's Icy Wind lowers no Speed there",
    field: { opponent: { mist: true } },
    slots: slots(act(mon("Lapras", "Shell Armor"), "Icy Wind"), idle(lax(0)),
      idle(lax(16)), idle(lax(8))),
    checks: "mist onTryBoost: the foes' Speed drops are stopped; no line for the ally side (Icy Wind hits only foes).",
    outcomes: true,
  })),
];
const SPT: Case[] = [
  ...perGame("IN-SPT-01", ["usum"], () => ({
    title: "USUM: Mud Sport from an earlier turn: Raichu's Thunderbolt into Snorlax at 1352/4096 power",
    field: { mudSport: true },
    slots: slots(act(mon("Raichu", "Static"), "Thunderbolt", PL), idle(lax(0)), idle(lax(16)), idle(lax(8))),
    checks: "mudsport onBasePower (gen 6+): Electric ×1352/4096.",
  })),
  ...perGame("IN-SPT-02", ["usum"], () => ({
    title: "USUM: Water Sport from an earlier turn: Charizard's Flamethrower into Snorlax at 1352/4096 power",
    field: { waterSport: true },
    slots: slots(act(mon("Charizard", "Blaze"), "Flamethrower", PL), idle(lax(0)), idle(lax(16)), idle(lax(8))),
    checks: "watersport onBasePower (gen 6+): Fire ×1352/4096.",
  })),
];

// ---- the existing paths through the calculator's mapping (IN-P19), a side with no Pokémon left ----
const SEC: Case[] = [
  ...perGame("IN-SEC-01", ["sv", "champions"], (game) => ({
    title: "Leech Seed, Salt Cure, drowsy and perish count 1 from earlier turns on the opponent's Snorlax (IN-P19)",
    slots: slots(idle(lax(k(game, 0))), idle(lax(k(game, 1))),
      idle(carried(lax(k(game, 2), { hp: 200 }), game === "sv" ? { leechSeed: OL, saltCure: true } : { leechSeed: OL })),
      idle(carried(lax(k(game, 3)), { yawn: true, perish: 1 }))),
    checks: "Leech Seed −29 (to the seeder), Salt Cure −29 (SV), the drowsy one falls asleep, perish 1 faints it.",
    outcomes: true,
  })),
];
const NBL: Case[] = [
  ...perGame("IN-NBL-01", ["sv", "champions"], (game) => ({
    title: "The opponent's side has no Pokémon left: its last two fall to the first two moves; the third action does not happen",
    canSwitch: { opponent: false },
    slots: slots(act(mon("Garchomp", "Rough Skin", { evs: { spe: fastSpe(game) } }), "Dragon Claw", PL), act(mon("Weavile", "Pressure", { evs: { spe: fastSpe(game) } }), "Night Slash", PR),
      act(lax(k(game, 1), { hp: 20 }), "Body Slam", OL), act(lax(k(game, 2), { hp: 20 }), "Body Slam", OR)),
    checks: "battleOver: once both foes faint (no bench), the turn ends; Snorlax's Body Slams never run.",
  })),
];

// ---- N: a used Protean with its types given (SPEC2 A2, ADDENDUM2 §2.4 typeUnknown) ----
const PRT: Case[] = [
  ...perGame("IN-PRT-01", ["sv", "champions"], (game) => ({
    title: "Meowscarada used Protean earlier (now Dark type); a foe's Close Combat into it is super effective",
    slots: slots(idle(mon("Meowscarada", "Protean", { types: ["Dark"], appBuild: { abilityActive: false } })), idle(lax(k(game, 0))),
      act(mon(game === "sv" ? "Kingambit" : "Machamp", game === "sv" ? "Defiant" : "Guts"), game === "sv" ? "Low Kick" : "Close Combat", OL), idle(lax(k(game, 1)))),
    checks: "setType(['Dark'], true) and abilityState.protean (gen 9, once per entry): the Fighting move is 2x into Dark.",
  })),
  ...perGame("IN-PRT-01b", ["sv", "champions"], (game) => ({
    title: "The same with the used Protean's type not given: the reason",
    notEstimated: "Meowscarada's type after Protean is not known.",
    slots: slots(idle(mon("Meowscarada", "Protean", { appBuild: { abilityActive: false } })), idle(lax(k(game, 0))),
      act(mon(game === "sv" ? "Kingambit" : "Machamp", game === "sv" ? "Defiant" : "Guts"), game === "sv" ? "Low Kick" : "Close Combat", OL), idle(lax(k(game, 1)))),
    checks: "REASONS.typeUnknown (ADDENDUM2 §2.4).",
  })),
];

/** Wave 1a's IN- cases. */
export const IN_CASES: Case[] = [...STL, ...CHG, ...LSF, ...DBD, ...ENT, ...STK, ...ATR, ...ACC, ...SFG, ...MST, ...SPT, ...SEC, ...NBL, ...PRT];

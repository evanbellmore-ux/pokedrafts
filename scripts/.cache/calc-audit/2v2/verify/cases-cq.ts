// status2 CQ- cases (ADDENDUM2 §7.2, the critic's probes critic2-probes-1.ts): wave 1a's (Track V1): CQ-STK-01 (A1),
// CQ-ETT-03 (E1), CQ-STL-01 (N), CQ-DBD-01 (N), CQ-SKD-01, 02 (H), CQ-ENT-01 (N), CQ-ALY-01 (E1). Step 1's CQ-CRS and
// CQ-ETT-01, 02, 04 are in cases-status2-step1.ts; the 1b ones (CQ-ECV, CQ-BID, CQ-PUR, CQ-CMD) are V2's.
// Showdown names; level 50, 31 IVs, Serious nature, 0 EVs unless set (Champions: Stat Points). Wired into cases-se.ts.
import type { Case, Game } from "./case-types";
import { OL, OR, PL, PR, act, carried, idle, lax, mon, perGame, slots } from "./case-kit";

const k = (game: Game, n: number) => (game === "champions" ? n : n * 8);
const fastSpe = (game: Game) => (game === "champions" ? 32 : 252);

// ---- CQ-STK-01 (CQ01b; C17): Stockpile's counts through Simple. No catalog Pokémon with Contrary learns Stockpile, Swallow
// or Spit Up (v1/who.mjs over the four catalogs), so CQ01a's Contrary half has no case; Simple's runs in SV and USUM (Numel;
// SwSh has neither Numel nor Swalot). ----
const STK: Case[] = perGame("CQ-STK-01", ["sv", "usum"], () => ({
  title: "Simple Numel at +6 Def / +2 Sp. Def with one Stockpile layer (counts −1, −1: its Def rose only once) uses Spit Up into Snorlax",
  slots: slots(act(carried(mon("Numel", "Simple", { boosts: { def: 6, spd: 2 } }), { stockpile: { layers: 1, def: -1, spd: -1 } }), "Spit Up", PL), idle(lax(0)),
    idle(lax(16)), idle(lax(8))),
  checks: "CQ01b: the End boosts by the counts through Simple: −2 each: Def +4, Sp. Def 0 (critic2-probes-1.out q:11-14).",
  outcomes: true,
}));

// ---- CQ-ETT-03 (CQ03c; C19): an item used earlier this turn, picked up by a foe's Pickup at this end of turn ----
const ETT: Case[] = [
  ...perGame("CQ-ETT-03", ["sv"], () => ({
    title: "A Snorlax used its Electric Seed earlier this turn (Electric Terrain as it came in); the foe's itemless Ambipom picks it up at the end of turn",
    field: { terrain: "Electric" },
    slots: slots(idle(mon("Pincurchin", "Electric Surge")), idle(lax(16, { boosts: { def: 1 }, lastItem: "Electric Seed", earlierThisTurn: { usedItem: true } })),
      idle(mon("Ambipom", "Pickup")), idle(lax(32))),
    checks: "abilities.ts pickup: an adjacent Pokémon's lastItem with usedItemThisTurn: Ambipom gets the Electric Seed at 28.2 (critic2-probes-1.out q:114-125).",
    outcomes: true,
  })),
  ...perGame("CQ-ETT-03", ["swsh"], () => ({
    title: "SwSh: the same with Tapu Koko's Electric Surge and a foe's Linoone (Pickup)",
    field: { terrain: "Electric" },
    slots: slots(idle(mon("Tapu Koko", "Electric Surge")), idle(lax(16, { boosts: { def: 1 }, lastItem: "Electric Seed", earlierThisTurn: { usedItem: true } })),
      idle(mon("Linoone", "Pickup")), idle(lax(32))),
    checks: "The same Pickup in SwSh.",
    outcomes: true,
  })),
];

// ---- CQ-STL-01 (CQ05a; C23): Quick Guard last turn raised the counter to 3; Protect now rolls 1/3 ----
const STL: Case[] = perGame("CQ-STL-01", ["sv", "champions"], (game) => ({
  title: "Snorlax used Quick Guard last turn (stall 3, no roll); its Protect now works 1/3 against a slower Snorlax's attack",
  slots: slots(act(carried(lax(k(game, 20)), { stall: 3 }), "Protect"), idle(lax(k(game, 1))),
    act(lax(k(game, 2)), game === "champions" ? "Body Slam" : "Tackle", OL), idle(lax(k(game, 3)))),
  checks: "CQ05a: Quick Guard's onHitSide adds stall without a roll; this Protect works 1/3, else fails and deletes the counter (q:196-217).",
}));

// ---- CQ-DBD-01 (CQ06a, b; IN-C5): a carried Destiny Bond on an asleep holder ----
const DBD: Case[] = [];
for (const game of ["sv", "usum"] as Game[]) {
  const gengar = (spe: number) => carried(mon("Gengar", "Cursed Body", { evs: { spe }, hp: 1, status: "slp" }), { destinyBond: true });
  DBD.push(
    {
      id: `CQ-DBD-01a-${game}`, game,
      title: "An asleep Gengar (1 HP, Destiny Bond from last turn); a faster Weavile's Knock Off knocks it out before its BeforeMove",
      slots: slots(act(mon("Weavile", "Pressure", { evs: { spe: 252 } }), "Knock Off", PR), idle(lax(8)), idle(lax(16)), idle(gengar(0))),
      checks: "CQ06a: the volatile stands until Gengar's own BeforeMove: Weavile faints too (q:243-254).",
    },
    {
      id: `CQ-DBD-01b-${game}`, game,
      title: "The same with Gengar faster than Weavile: its aborted BeforeMove (asleep) removes Destiny Bond; Weavile lives",
      slots: slots(act(mon("Weavile", "Pressure", { nature: "Brave" }), "Knock Off", PR), idle(lax(8)), idle(lax(16)), idle(gengar(252))),
      checks: "CQ06b: destinybond onMoveAborted on the sleep turn (q:255-265).",
    },
  );
}

// ---- CQ-SKD-01, 02 (CQ08, CQ08b; C21): Sky Drop's charge turn ----
const SKD: Case[] = [
  {
    id: "CQ-SKD-01-usum", game: "usum",
    title: "Braviary's Sky Drop lifts Clefairy: its queued Pound is lost; its partner's Tackle at Braviary misses",
    slots: slots(act(mon("Braviary", "Keen Eye", { evs: { spe: 252 } }), "Sky Drop", PL), idle(lax(8)),
      act(mon("Clefairy", "Friend Guard", { evs: { spe: 4 } }), "Pound", OL), act(lax(24), "Tackle", OL)),
    checks: "CQ08: skydrop onFoeBeforeMove null for the lifted; the user is out of reach but to Gust, Twister and the pass list (q:283-300).",
  },
  {
    id: "CQ-SKD-02-usum", game: "usum",
    title: "The same with the partner Butterfree's Gust at Braviary: it hits at twice the power",
    slots: slots(act(mon("Braviary", "Keen Eye", { evs: { spe: 252 } }), "Sky Drop", PL), idle(lax(8)),
      act(mon("Clefairy", "Friend Guard", { evs: { spe: 4 } }), "Pound", OL), act(mon("Butterfree", "Compound Eyes"), "Gust", OL)),
    checks: "CQ08b: Gust ×2 base power at a Sky Drop user (PS/data/moves.ts:16774-16784).",
  },
];

// ---- CQ-ENT-01 (CQ09; IN-C3, C37): equal-Speed Lightning Rods across the sides, entryOrder both ways ----
const ENT: Case[] = [];
for (const game of ["sv", "champions"] as Game[]) {
  // SV: two Raichu; Champions: Raichu and Manectric (+5 Stat Points: 130 each).
  const rodA = mon("Raichu", "Lightning Rod");
  const rodB = game === "sv" ? mon("Zebstrika", "Lightning Rod", { ivs: { spe: 19 } }) : mon("Manectric", "Lightning Rod", { evs: { spe: 5 } });
  for (const [suffix, order] of [["a", { "own-left": 0, "opponent-left": 1 }], ["b", { "opponent-left": 0, "own-left": 1 }]] as const) {
    ENT.push({
      id: `CQ-ENT-01${suffix}-${game}`, game, entryOrder: { ...order },
      title: `Lightning Rods on both sides at one Speed; Jolteon's Thunderbolt at the Snorlax beside one; ${suffix === "a" ? "your" : "the opponent's"} rod entered first`,
      slots: slots(idle(rodA), idle(lax(k(game, 1))), idle(rodB), act(mon("Jolteon", "Volt Absorb"), "Thunderbolt", OR)),
      checks: "CQ09: compareRedirectOrder, no shuffle: the older ability state takes it, whichever side it is on (q:301-309).",
    });
  }
}

// ---- CQ-ALY-01 (C32): Leech Seed, Fire Spin and (SV) Syrup Bomb from an ally ----
const ALY: Case[] = perGame("CQ-ALY-01", ["sv", "champions"], (game) => ({
  title: "Snorlax seeded, trapped by Fire Spin and (SV) Syrup-Bombed by its own ally Venusaur on earlier turns: the end of turn",
  slots: slots(idle(carried(lax(k(game, 0), { hp: 200 }), { leechSeed: OR, trap: { source: OR, bindingBand: false }, ...(game === "sv" ? { syrupBomb: OR } : {}) })),
    idle(mon("Venusaur", "Overgrow", { hp: 100 })), idle(lax(k(game, 2))), idle(lax(k(game, 1)))),
  checks: "C32: the handlers read the source's position, not its side: Leech Seed heals Venusaur, Fire Spin's 1/8, Syrup Bomb's −1 Speed.",
  outcomes: true,
}));

/** Wave 1a's CQ- cases. */
export const CQ_CASES: Case[] = [...STK, ...ETT, ...STL, ...DBD, ...SKD, ...ENT, ...ALY];
void PR;

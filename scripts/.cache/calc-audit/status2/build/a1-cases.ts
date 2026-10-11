// Track A1 (status2 wave 1a): A1's own oracle cases (F1 §13.1's SAT list, SPEC2 §7.2 and the C1/C2 additions), run by
// a1-run.ts against pinned Showdown c23d2e94 (sim-dfs.ts) beside the app. V1's cases-sat.ts holds the gate's copies; these
// are A1's development set (ids A1-…). Showdown names; level 50, 31 IVs, Serious nature, 0 EVs unless set (Champions: Stat
// Points).
import type { Case, Game } from "../../2v2/verify/case-types";
import { OL, OR, PL, PR, act, carried, idle, lax, mon, perGame, slots } from "../../2v2/verify/case-kit";

const k = (game: Game, n: number) => (game === "champions" ? n : n * 8);
const fast = (game: Game) => (game === "champions" ? 32 : 252);
const body = (game: Game) => (game === "champions" ? "Body Slam" : "Body Slam");

export const A1_CASES: Case[] = [
  // ---- Acupressure (SA01, SA02b) ----
  ...perGame("A1-ACU-1", ["sv", "usum"], (game) => ({
    title: "Smeargle's Acupressure on its ally Snorlax, then Snorlax's Body Slam and a foe's: one world per stat, 1/7",
    slots: slots(act(mon("Smeargle", "Own Tempo", { evs: { spe: fast(game) } }), "Acupressure", OR), act(lax(k(game, 0)), body(game), PL),
      act(lax(k(game, 1)), body(game), OR), idle(lax(k(game, 2)))),
    checks: "SA01: 7 worlds of 1/7; the Speed world moves Snorlax before the foe in SV (re-sort), not in USUM; the Attack world deals more.",
    outcomes: true,
  })),
  ...perGame("A1-ACU-3", ["sv", "champions"], (game) => ({
    title: "Contrary Malamar at +6 Attack uses Acupressure on itself: six stats, each −2",
    slots: slots(act(mon("Malamar", "Contrary", { boosts: { atk: 6 } }), "Acupressure", OL), idle(lax(k(game, 0))), idle(lax(k(game, 1))), idle(lax(k(game, 2)))),
    checks: "SA02b: stats below +6 before ChangeBoost.",
    outcomes: true,
  })),
  // ---- Psych Up (SA03) ----
  ...perGame("A1-PSY-1", ["sv"], (game) => ({
    title: "Smeargle (White Herb) Psych Ups a protecting Snorlax at +2 Atk −2 Def; a foe's Body Slam into Smeargle after",
    slots: slots(act(mon("Smeargle", "Own Tempo", { item: "White Herb", evs: { spe: fast(game) } }), "Psych Up", PL), idle(lax(k(game, 0))),
      act(lax(k(game, 4), { boosts: { atk: 2, def: -2 } }), "Protect"), act(lax(k(game, 1)), body(game), OL)),
    checks: "SA03: Psych Up passes Protect, copies +2 Atk −2 Def; White Herb restores the Def at AfterMove; the later hit reads +0 Def.",
    outcomes: true,
  })),
  // ---- Heart Swap, Power Swap, Guard Swap (SA04) ----
  ...perGame("A1-SWP-1", ["sv", "usum"], (game) => ({
    title: "Smeargle (+2 Atk) Heart Swaps a −2 Def Snorlax holding White Herb; then Snorlax's Body Slam into Smeargle",
    slots: slots(act(mon("Smeargle", "Own Tempo", { boosts: { atk: 2 }, evs: { spe: fast(game) } }), "Heart Swap", PL), idle(lax(k(game, 0))),
      act(lax(k(game, 2), { item: "White Herb", boosts: { def: -2, spa: 1 } }), body(game), OL), idle(lax(k(game, 1)))),
    checks: "SA04b: all seven swapped; White Herb restores Smeargle's received −2 Def? no: Snorlax's received stages are Smeargle's (+2 Atk); Smeargle gets −2 Def.",
    outcomes: true,
  })),
  ...perGame("A1-SWP-2", ["champions"], () => ({
    title: "Champions: Farigiraf's Guard Swap with a +2 Def Snorlax, then that Snorlax's Body Slam is taken by Farigiraf",
    slots: slots(act(mon("Farigiraf", "Armor Tail", { evs: { spe: 32 } }), "Guard Swap", PL), idle(lax(0)),
      act(lax(4, { boosts: { def: 2, spd: 1 } }), "Body Slam", OL), idle(lax(1))),
    checks: "SA04d: the Def and Sp. Def stages swap.",
    outcomes: true,
  })),
  // ---- Speed Swap (K10) ----
  ...perGame("A1-SPD-1", ["sv", "usum"], (game) => ({
    title: "Smeargle (fast) Speed Swaps a slow Snorlax: the Snorlax ally's later move order",
    slots: slots(act(mon("Smeargle", "Own Tempo", { evs: { spe: fast(game) } }), "Speed Swap", PL), act(lax(k(game, 3)), body(game), PL),
      act(lax(k(game, 0)), body(game), OR), idle(lax(k(game, 1)))),
    checks: "K10: SV re-sorts after the swap (the foe Snorlax at Smeargle's Speed moves next); USUM's order is frozen.",
    outcomes: true,
  })),
  // ---- Guard Split, Power Split (K12, SA06, SA06b) ----
  ...perGame("A1-SPL-1", ["sv", "champions"], (game) => ({
    title: "Guard Split between a frail user and Snorlax, then Snorlax's ally Body Slams the user",
    slots: slots(act(game === "sv" ? mon("Smeargle", "Own Tempo", { evs: { spe: fast(game) } }) : mon("Alakazam", "Inner Focus", { evs: { spe: 32 } }), "Guard Split", PL), idle(lax(k(game, 0))),
      act(lax(k(game, 2), { evs: { def: game === "champions" ? 32 : 252 } }), "Protect"), act(lax(k(game, 1)), body(game), OL)),
    checks: "K12: both Defs averaged (floor); Protect blocks Guard Split? No: it has the protect flag: Guard Split is blocked.",
    outcomes: true,
  })),
  ...perGame("A1-SPL-2", ["sv", "champions"], (game) => ({
    title: "Guard Split between a frail user and Snorlax (with Def training), then the other Snorlax Body Slams the user",
    slots: slots(act(game === "sv" ? mon("Smeargle", "Own Tempo", { evs: { spe: fast(game) } }) : mon("Alakazam", "Inner Focus", { evs: { spe: 32 } }), "Guard Split", PL), idle(lax(k(game, 0))),
      idle(lax(k(game, 2), { evs: { def: game === "champions" ? 32 : 252 } })), act(lax(k(game, 1)), body(game), OL)),
    checks: "K12: both Defs averaged (floor); the later Body Slam reads the averaged stored Def.",
    outcomes: true,
  })),
  // ---- Power Trick (K11, SA07) ----
  ...perGame("A1-TRK-1", ["sv", "champions"], (game) => ({
    title: "Forretress's Power Trick, then a foe's Body Slam into it and its own nothing",
    slots: slots(act(mon("Forretress", "Sturdy", { evs: { spe: fast(game) } }), "Power Trick"), idle(lax(k(game, 0))),
      act(lax(k(game, 2)), body(game), OL), idle(lax(k(game, 1)))),
    checks: "K11: stored Atk and Def swapped: the hit reads the low Atk as Def.",
    outcomes: true,
  })),
  ...perGame("A1-TRK-2", ["sv"], (game) => ({
    title: "Forretress with Power Trick from an earlier turn uses it again: it ends (stats back); a foe's Body Slam after",
    slots: slots(act(carried(mon("Forretress", "Sturdy", { evs: { spe: fast(game) } }), { powerTrick: true }), "Power Trick"), idle(lax(k(game, 0))),
      act(lax(k(game, 2)), body(game), OL), idle(lax(k(game, 1)))),
    checks: "SA07: onRestart removes the volatile; onEnd swaps back.",
    outcomes: true,
  })),
  // ---- Topsy-Turvy (SA08) ----
  ...perGame("A1-TOP-1", ["sv", "usum"], (game) => ({
    title: "Topsy-Turvy on a +2 Atk −1 Def Snorlax holding White Herb (Defiant ally does not react)",
    slots: slots(act(mon("Malamar", "Contrary", { evs: { spe: fast(game) } }), "Topsy-Turvy", PL), idle(lax(k(game, 0))),
      act(lax(k(game, 2), { item: "White Herb", boosts: { atk: 2, def: -1 } }), body(game), OL), idle(lax(k(game, 1)))),
    checks: "SA08: inverted to −2 Atk +1 Def; White Herb restores the Atk at AfterMove.",
    outcomes: true,
  })),
  // ---- Tidy Up (K24) ----
  ...perGame("A1-TID-1", ["sv", "champions"], (game) => ({
    title: "Maushold's Tidy Up removes a foe's Substitute (carried), then its partner's Body Slam hits that foe",
    slots: slots(act(mon("Maushold", "Technician", { evs: { spe: fast(game) } }), "Tidy Up"), act(lax(k(game, 1)), body(game), PL),
      idle(lax(k(game, 0), { substitute: 50 })), idle(lax(k(game, 2)))),
    checks: "K24: Substitutes removed; +1 Atk +1 Spe; the hit lands on the Pokémon.",
    outcomes: true,
  })),
  // ---- No Retreat (SA12) ----
  ...perGame("A1-NRT-1", ["sv", "swsh"], (game) => ({
    title: "Falinks's No Retreat (+1 all five), then a foe's Body Slam into it",
    slots: slots(act(mon("Falinks", "Battle Armor", { evs: { spe: fast(game) } }), "No Retreat"), idle(lax(k(game, 0))),
      act(lax(k(game, 2)), body(game), OL), idle(lax(k(game, 1)))),
    checks: "SA12: the boosts, the volatile (E2 noretreat).",
    outcomes: true,
  })),
  ...perGame("A1-NRT-2", ["sv"], (game) => ({
    title: "Falinks with No Retreat from an earlier turn uses it again: it fails",
    slots: slots(act(carried(mon("Falinks", "Battle Armor", { evs: { spe: fast(game) } }), { noRetreat: true }), "No Retreat"), idle(lax(k(game, 0))),
      act(lax(k(game, 2)), body(game), OL), idle(lax(k(game, 1)))),
    checks: "SA12: onTry fails while the volatile stands.",
    outcomes: true,
  })),
  // ---- Autotomize (K18) ----
  ...perGame("A1-AUT-1", ["swsh", "usum"], (game) => ({
    title: "Aggron's Autotomize (Spe +2, 100 kg lighter), then a foe's Low Kick into it",
    slots: slots(act(mon("Aggron", "Sturdy", { evs: { spe: fast(game) } }), "Autotomize"), idle(lax(k(game, 0))),
      act(mon("Machamp", "Guts", { evs: { spe: 4 } }), "Low Kick", OL), idle(lax(k(game, 1)))),
    checks: "K18: weighthg 3600 → 2600: Low Kick 100 power, not 120.",
    outcomes: true,
  })),
  // ---- Minimize (SA13) ----
  ...perGame("A1-MIN-1", ["sv", "champions"], (game) => ({
    title: "Minimize, then a foe's Body Slam into it (double damage)",
    slots: slots(act(mon(game === "sv" ? "Qwilfish" : "Qwilfish", "Swift Swim", { evs: { spe: fast(game) } }), "Minimize"), idle(lax(k(game, 0))),
      act(lax(k(game, 2)), body(game), OL), idle(lax(k(game, 1)))),
    checks: "SA13: evasion +2 and the ×2 in the final chain for Body Slam.",
    outcomes: true,
  })),
  ...perGame("A1-MIN-2", ["sv", "usum"], (game) => ({
    title: "A Minimized Qwilfish (earlier turn) takes Stomp and Heavy Slam",
    slots: slots(idle(carried(mon("Qwilfish", "Swift Swim"), { minimize: true })), idle(lax(k(game, 0))),
      act(mon("Camerupt", "Solid Rock", { evs: { spe: k(game, 2) } }), "Heavy Slam", OL), act(mon("Camerupt", "Solid Rock"), "Stomp", OL)),
    checks: "Minimize's ×2 for Stomp and Heavy Slam.",
    outcomes: true,
  })),
  // ---- Geomancy (K21) ----
  ...perGame("A1-GEO-1", ["usum"], () => ({
    title: "Smeargle's Geomancy with Power Herb (+2 SpA SpD Spe now), then a foe's Body Slam",
    slots: slots(act(mon("Smeargle", "Own Tempo", { item: "Power Herb", evs: { spe: 252 } }), "Geomancy"), idle(lax(0)),
      act(lax(16), "Body Slam", OL), idle(lax(8))),
    checks: "K21: Power Herb skips the charge.",
    outcomes: true,
  })),
  ...perGame("A1-GEO-2", ["usum", "swsh"], (game) => ({
    title: "Geomancy without Power Herb: the charge turn (no boosts); E2 twoturnmove",
    slots: slots(act(mon(game === "swsh" ? "Xerneas" : "Smeargle", game === "swsh" ? "Fairy Aura" : "Own Tempo", { evs: { spe: 252 } }), "Geomancy"), idle(lax(0)),
      act(lax(16), "Body Slam", OL), idle(lax(8))),
    checks: "geomancy onTryMove: twoturnmove, no boosts.",
    outcomes: true,
  })),
  // ---- Gear Up, Magnetic Flux ----
  ...perGame("A1-PLM-1", ["sv", "champions"], (game) => ({
    title: "Magnetic Flux with a Plus ally (and a Minus user): both +1 Def +1 SpD",
    slots: slots(act(mon(game === "sv" ? "Magnezone" : "Ampharos", game === "sv" ? "Magnet Pull" : "Plus", { evs: { spe: fast(game) } }), "Magnetic Flux"),
      idle(mon(game === "sv" ? "Toxtricity-Low-Key" : "Toxtricity-Low-Key", "Minus")), act(lax(k(game, 2)), body(game), OR), idle(lax(k(game, 1)))),
    checks: "magneticflux onHitSide: the Plus and Minus holders of the user's side.",
    outcomes: true,
  })),
  ...perGame("A1-PLM-2", ["usum"], () => ({
    title: "USUM: Klinklang's Gear Up with a Plus ally (Klinklang has Plus too)",
    slots: slots(act(mon("Klinklang", "Plus", { evs: { spe: 252 } }), "Gear Up"), idle(mon("Minun", "Minus")), act(lax(16), "Body Slam", OR), idle(lax(8))),
    checks: "gearup onHitSide: both +1 Atk +1 SpA.",
    outcomes: true,
  })),
  // ---- Flower Shield (K22), Rototiller (K23) ----
  ...perGame("A1-FLS-1", ["usum", "swsh"], () => ({
    title: "Flower Shield: every Grass type +1 Def (a foe's Defiant does not react: a rise)",
    slots: slots(act(mon("Comfey", "Flower Veil", { evs: { spe: 252 } }), "Flower Shield"), idle(mon("Venusaur", "Overgrow")),
      idle(mon("Ferrothorn", "Iron Barbs")), act(lax(8), "Body Slam", OR)),
    checks: "K22: Venusaur and Ferrothorn +1 Def; the hit reads it.",
    outcomes: true,
  })),
  ...perGame("A1-ROT-1", ["usum"], () => ({
    title: "Rototiller: a grounded Grass type +1 Atk +1 SpA; a Flying-type Grass is immune",
    slots: slots(act(mon("Diggersby", "Huge Power", { evs: { spe: 252 } }), "Rototiller"), idle(mon("Venusaur", "Overgrow")),
      idle(mon("Tropius", "Chlorophyll")), act(lax(8), "Body Slam", OR)),
    checks: "K23: Tropius (Flying) -immune; Venusaur boosted.",
    outcomes: true,
  })),
  // ---- Skill Swap (K5, SA14, SA14b, SA14f, Q2, SA21) ----
  ...perGame("A1-SKS-1", ["sv", "usum"], (game) => ({
    title: "Skill Swap takes Bronzong's Levitate onto Smeargle; then Earthquake from the foe's partner hits Bronzong",
    slots: slots(act(mon("Smeargle", "Own Tempo", { evs: { spe: fast(game) } }), "Skill Swap", PL), idle(lax(k(game, 0))),
      idle(mon("Bronzong", "Levitate")), act(mon("Garchomp", "Rough Skin"), "Earthquake")),
    checks: "K5: Bronzong gets Own Tempo and is hit; Smeargle gets Levitate and is immune.",
    outcomes: true,
  })),
  ...perGame("A1-SKS-7", ["sv", "champions"], (game) => ({
    title: "Skill Swap gives Intimidate (from Incineroar) to the user: both foes −1 Atk; then the foes' Body Slams",
    slots: slots(act(game === "sv" ? mon("Smeargle", "Own Tempo", { evs: { spe: fast(game) } }) : mon("Alakazam", "Inner Focus", { evs: { spe: 32 } }), "Skill Swap", OR),
      idle(mon("Incineroar", "Intimidate")), act(lax(k(game, 2)), body(game), OL), act(lax(k(game, 1)), body(game), OR)),
    checks: "Q2: the user's new Intimidate's Start lowers both foes (the swap is between allies).",
    outcomes: true,
  })),
  ...perGame("A1-SKS-6", ["sv", "usum"], (game) => ({
    title: "Skill Swap gives Insomnia to a sleeping ally (Rest sleep), which then moves",
    slots: slots(act(mon("Hypno", "Insomnia", { evs: { spe: fast(game) } }), "Skill Swap", OR),
      act(carried(lax(k(game, 1), { status: "slp" }), { sleep: { attempts: 0, rest: true } }), body(game), PL), idle(lax(k(game, 2))), idle(lax(k(game, 0)))),
    checks: "SA14f: cured at the Update; the ally then moves.",
    outcomes: true,
  })),
  ...perGame("A1-SKS-8", ["sv", "usum"], (game) => ({
    title: "Skill Swap gives Download (Porygon2's) to Smeargle: its Start reads the foes",
    slots: slots(act(mon("Smeargle", "Own Tempo", { evs: { spe: fast(game) } }), "Skill Swap", OR), act(mon("Porygon2", "Download", { boosts: { atk: 1 }, appBoosts: { atk: 0 } }), "Tackle", PL),
      idle(lax(k(game, 2), { boosts: { def: 2 } })), idle(lax(k(game, 1)))),
    checks: "SA21: the foes' Def (with stages) ≥ SpD: +1 SpA for Smeargle.",
    outcomes: true,
  })),
  // ---- Role Play (SA15), Entrainment (SA27), Simple Beam, Worry Seed, Gastro Acid ----
  ...perGame("A1-RPL-1", ["sv", "usum"], (game) => ({
    title: "Role Play copies a protecting Incineroar's Intimidate: both foes −1 Atk",
    slots: slots(act(mon("Smeargle", "Own Tempo", { evs: { spe: fast(game) } }), "Role Play", PL), idle(lax(k(game, 0))),
      act(mon("Incineroar", "Intimidate"), "Protect"), act(lax(k(game, 1)), body(game), OL)),
    checks: "SA15: no protect flag; the Start lowers both foes, the protecting one too.",
    outcomes: true,
  })),
  ...perGame("A1-ENT-1", ["sv", "usum"], (game) => ({
    title: "Entrainment gives a foe Intimidate: its Start lowers the user's side; Inner Focus blocks it in SV",
    slots: slots(act(mon("Smeargle", "Intimidate", { evs: { spe: fast(game) }, appBuild: { abilityChanged: true } }), "Entrainment", PL), idle(mon("Lucario", "Inner Focus")),
      idle(lax(k(game, 1))), act(lax(k(game, 0)), body(game), OL)),
    checks: "SA27: the entrained Snorlax's Intimidate drops Smeargle and Lucario (Inner Focus blocks in SV, not USUM).",
    outcomes: true,
  })),
  ...perGame("A1-SBM-1", ["sv", "usum"], (game) => ({
    title: "Simple Beam on a foe, then the foe's Swords Dance (+4)",
    slots: slots(act(mon("Smeargle", "Own Tempo", { evs: { spe: fast(game) } }), "Simple Beam", PL), idle(lax(k(game, 0))),
      act(mon("Garchomp", "Rough Skin"), "Swords Dance"), idle(lax(k(game, 1)))),
    checks: "K8: Simple doubles the later boost.",
    outcomes: true,
  })),
  ...perGame("A1-WSD-1", ["sv", "usum"], (game) => ({
    title: "Worry Seed on a sleeping foe (Rest): cured; it then moves",
    slots: slots(act(mon("Smeargle", "Own Tempo", { evs: { spe: fast(game) } }), "Worry Seed", PL), idle(lax(k(game, 0))),
      act(carried(lax(k(game, 2), { status: "slp" }), { sleep: { attempts: 0, rest: true } }), body(game), OL), idle(lax(k(game, 1)))),
    checks: "Q2b: Insomnia, the sleep cured; the Body Slam lands.",
    outcomes: true,
  })),
  ...perGame("A1-GAS-1", ["sv", "usum"], (game) => ({
    title: "Gastro Acid on Bronzong (Levitate), then Earthquake hits it",
    slots: slots(act(mon("Smeargle", "Own Tempo", { evs: { spe: fast(game) } }), "Gastro Acid", PL), idle(lax(k(game, 0))),
      idle(mon("Bronzong", "Levitate")), act(mon("Garchomp", "Rough Skin"), "Earthquake")),
    checks: "K7: Levitate suppressed: hit.",
    outcomes: true,
  })),
  ...perGame("A1-DDL-1", ["sv"], () => ({
    title: "Doodle copies a foe's Intimidate onto Smeargle and its ally: two Intimidates",
    slots: slots(act(mon("Smeargle", "Own Tempo", { evs: { spe: 252 } }), "Doodle", PL), idle(lax(0)),
      idle(mon("Incineroar", "Intimidate")), act(lax(8), "Body Slam", OL)),
    checks: "K9: both get Intimidate, each Start lowers both foes.",
    outcomes: true,
  })),
  // ---- Transform (K13, SA19, SA19c) ----
  ...perGame("A1-TRF-1", ["sv", "champions"], (game) => ({
    title: "Ditto Transforms into a +2 Def Snorlax, then a foe's Body Slam into Ditto",
    slots: slots(act(mon("Ditto", "Limber", { evs: { spe: fast(game) } }), "Transform", PL), idle(lax(k(game, 0))),
      idle(lax(k(game, 2), { boosts: { def: 2 } })), act(lax(k(game, 1)), body(game), OL)),
    checks: "K13: Ditto copies Snorlax's stats and +2 Def; the hit reads them.",
    outcomes: true,
  })),
  ...perGame("A1-TRF-2", ["sv", "usum"], (game) => ({
    title: "Transform into Gyarados: Ditto Water/Flying (Earthquake immune) and Intimidate's Start",
    slots: slots(act(mon("Ditto", "Limber", { evs: { spe: fast(game) } }), "Transform", PL), idle(lax(k(game, 0))),
      idle(mon("Gyarados", "Intimidate")), act(mon("Garchomp", "Rough Skin"), "Earthquake")),
    checks: "SA19: types and the ability copied; the copied Intimidate lowers both foes.",
    outcomes: true,
  })),
  // ---- Stockpile, Swallow, Spit Up (SA09, SA09b, SA09c; C17) ----
  ...perGame("A1-STK-1", ["sv", "champions"], (game) => ({
    title: "Swalot with 2 layers (from earlier turns) Stockpiles again (3), then a foe's Body Slam into it",
    slots: slots(act(carried(mon("Swalot", "Liquid Ooze", { boosts: { def: 2, spd: 2 }, evs: { spe: fast(game) } }), { stockpile: { layers: 2, def: -2, spd: -2 } }), "Stockpile"),
      idle(lax(k(game, 0))), act(lax(k(game, 2)), body(game), OL), idle(lax(k(game, 1)))),
    checks: "SA09: the third layer +1/+1; E2 stockpile 3:−3:−3.",
    outcomes: true,
  })),
  ...perGame("A1-STK-2", ["sv"], (game) => ({
    title: "Swalot with 3 layers tries to Stockpile again: it fails",
    slots: slots(act(carried(mon("Swalot", "Liquid Ooze", { boosts: { def: 3, spd: 3 }, evs: { spe: fast(game) } }), { stockpile: { layers: 3, def: -3, spd: -3 } }), "Stockpile"),
      idle(lax(k(game, 0))), act(lax(k(game, 2)), body(game), OL), idle(lax(k(game, 1)))),
    checks: "SA09: onTry fails at three layers.",
    outcomes: true,
  })),
  ...perGame("A1-STK-3", ["sv", "usum"], (game) => ({
    title: "Swalot at +6 Def with one layer (counts 0, −1) stockpiles: only Sp. Def changes and counts",
    slots: slots(act(carried(mon("Swalot", "Liquid Ooze", { boosts: { def: 6, spd: 1 }, evs: { spe: fast(game) } }), { stockpile: { layers: 1, def: 0, spd: -1 } }), "Stockpile"),
      idle(lax(k(game, 0))), act(lax(k(game, 2)), body(game), OL), idle(lax(k(game, 1)))),
    checks: "SA09b: at +6 Def only Sp. Def changes: counts 0, −2.",
    outcomes: true,
  })),
  ...perGame("A1-STK-4", ["sv", "champions"], (game) => ({
    title: "Swalot (2 layers) at 60 HP uses Swallow (1/2 heal), its Stockpile ends; a foe's Body Slam after",
    slots: slots(act(carried(mon("Swalot", "Liquid Ooze", { hp: 60, boosts: { def: 2, spd: 2 }, evs: { spe: fast(game) } }), { stockpile: { layers: 2, def: -2, spd: -2 } }), "Swallow"),
      idle(lax(k(game, 0))), act(lax(k(game, 2)), body(game), OL), idle(lax(k(game, 1)))),
    checks: "swallow: modify(maxhp, 0.5), then the End −2/−2.",
    outcomes: true,
  })),
  ...perGame("A1-STK-5", ["sv"], (game) => ({
    title: "Swalot with no Stockpile uses Swallow: it fails",
    slots: slots(act(mon("Swalot", "Liquid Ooze", { hp: 60, evs: { spe: fast(game) } }), "Swallow"), idle(lax(k(game, 0))), act(lax(k(game, 2)), body(game), OL), idle(lax(k(game, 1)))),
    checks: "swallow onTry: no Stockpile.",
    outcomes: true,
  })),
  ...perGame("A1-STK-6", ["sv", "champions"], (game) => ({
    title: "Swalot (3 layers) Spit Ups into a protecting foe: the Stockpile still ends at AfterMove",
    slots: slots(act(carried(mon("Swalot", "Liquid Ooze", { boosts: { def: 3, spd: 3 }, evs: { spe: fast(game) } }), { stockpile: { layers: 3, def: -3, spd: -3 } }), "Spit Up", PL),
      idle(lax(k(game, 0))), act(lax(k(game, 2)), "Protect"), act(lax(k(game, 1)), body(game), OL)),
    checks: "spitup onAfterMove: removeVolatile whatever the move did.",
    outcomes: true,
  })),
  ...perGame("A1-STK-7", ["sv"], (game) => ({
    title: "Swalot with no Stockpile uses Spit Up: it fails",
    slots: slots(act(mon("Swalot", "Liquid Ooze", { evs: { spe: fast(game) } }), "Spit Up", PL), idle(lax(k(game, 0))), act(lax(k(game, 2)), body(game), OL), idle(lax(k(game, 1)))),
    checks: "spitup onTry.",
    outcomes: true,
  })),
  // ---- Intimidate gained mid-turn: its reactions (F1 §3.4.7, SA27) ----
  ...perGame("A1-INT-1", ["sv", "champions"], (game) => ({
    title: "Role Play copies Intimidate: a Guard Dog foe (+1 Atk) and an Inner Focus foe (no drop); their attacks after",
    slots: slots(act(game === "sv" ? mon("Smeargle", "Own Tempo", { evs: { spe: fast(game) } }) : mon("Alakazam", "Magic Guard", { evs: { spe: 32 } }), "Role Play", OR),
      idle(mon("Incineroar", "Intimidate")), act(mon("Mabosstiff", "Guard Dog"), body(game), OL), act(mon("Lucario", "Inner Focus"), "Close Combat", OL)),
    checks: "guarddog onTryBoost (priority 2): +1 Atk; innerfocus onTryBoost (gen 8+): no drop.",
    outcomes: true,
  })),
  ...perGame("A1-INT-2", ["sv", "swsh"], (game) => ({
    title: "Role Play copies Intimidate: a Mirror Armor foe sends the drop back; a Defiant foe gets +2",
    slots: slots(act(mon(game === "sv" ? "Smeargle" : "Absol", game === "sv" ? "Own Tempo" : "Pressure", { evs: { spe: fast(game) } }), "Role Play", OR),
      idle(mon("Incineroar", "Intimidate")), act(mon("Corviknight", "Mirror Armor"), body(game), OL), act(mon(game === "sv" ? "Kingambit" : "Bisharp", "Defiant"), "Iron Head", OL)),
    checks: "mirrorarmor reflects to the copier; defiant +2.",
    outcomes: true,
  })),
  ...perGame("A1-INT-3", ["sv", "usum"], (game) => ({
    title: "Role Play copies a foe's Intimidate (behind a Substitute: immune to the copy); the other foe's Adrenaline Orb (+1 Spe, used)",
    slots: slots(act(mon("Smeargle", "Own Tempo", { evs: { spe: fast(game) } }), "Role Play", PL), idle(lax(k(game, 0))),
      idle(mon("Incineroar", "Intimidate", { substitute: 40 })), idle(lax(k(game, 2), { item: "Adrenaline Orb" }))),
    checks: "adrenalineorb onAfterBoost: useItem; the Substitute holder: -immune.",
    outcomes: true,
  })),
  ...perGame("A1-INT-4", ["swsh", "usum"], (game) => ({
    title: "Role Play copies Intimidate: a Rattled foe (+1 Spe from generation 8)",
    slots: slots(act(mon(game === "swsh" ? "Absol" : "Smeargle", game === "swsh" ? "Pressure" : "Own Tempo", { evs: { spe: 252 } }), "Role Play", OR),
      idle(mon("Incineroar", "Intimidate")), idle(mon("Sudowoodo", "Rattled")), idle(lax(8))),
    checks: "rattled onAfterBoost (gen 8+); gen 7 has none.",
    outcomes: true,
  })),
  // ---- Other Starts gained mid-turn (F1 §3.4.5) ----
  ...perGame("A1-STR-1", ["sv"], () => ({
    title: "Role Play copies Flamigo's Costar: Smeargle copies its ally's +2 Atk −1 Def",
    slots: slots(act(mon("Smeargle", "Own Tempo", { evs: { spe: 252 } }), "Role Play", PL), idle(lax(0, { boosts: { atk: 2, def: -1 } })),
      idle(mon("Flamigo", "Costar")), act(lax(8), "Body Slam", OL)),
    checks: "costar onStart: the partner's stages, written directly.",
    outcomes: true,
  })),
  ...perGame("A1-STR-2", ["sv", "champions"], (game) => ({
    title: "Role Play copies Curious Medicine: the user's ally's stages are cleared",
    slots: slots(act(game === "sv" ? mon("Smeargle", "Own Tempo", { evs: { spe: 252 } }) : mon("Alakazam", "Magic Guard", { evs: { spe: 32 } }), "Role Play", PL),
      idle(lax(k(game, 0), { boosts: { atk: 2, def: -1 } })), idle(mon("Slowking-Galar", "Curious Medicine")), act(lax(k(game, 1)), body(game), OR)),
    checks: "curiousmedicine onStart: clearBoosts on the partner.",
    outcomes: true,
  })),
  ...perGame("A1-STR-3", ["sv", "champions"], (game) => ({
    title: "Role Play copies Hospitality: the user's ally (at 100 HP) is healed a quarter",
    slots: slots(act(game === "sv" ? mon("Smeargle", "Own Tempo", { evs: { spe: 252 } }) : mon("Alakazam", "Magic Guard", { evs: { spe: 32 } }), "Role Play", PL),
      idle(lax(k(game, 0), { hp: 100 })), idle(mon("Sinistcha", "Hospitality")), idle(lax(k(game, 1)))),
    checks: "hospitality onStart: heal(baseMaxhp / 4).",
    outcomes: true,
  })),
  ...perGame("A1-STR-4", ["sv", "champions"], (game) => ({
    title: "Role Play copies Supersweet Syrup: both foes' evasion −1 (once a battle: the fact)",
    slots: slots(act(carried(game === "sv" ? mon("Smeargle", "Own Tempo", { evs: { spe: 252 } }) : mon("Alakazam", "Magic Guard", { evs: { spe: 32 } }), { stages: { evasion: -1 } }), "Role Play", PL),
      idle(carried(lax(k(game, 0)), { stages: { evasion: -1 } })), idle(mon("Hydrapple", "Supersweet Syrup")), idle(lax(k(game, 1)))),
    checks: "supersweetsyrup onStart.",
    outcomes: true,
  })),
  ...perGame("A1-STR-5", ["sv", "swsh"], (game) => ({
    title: "Role Play copies Zacian's Intrepid Sword: +1 Atk",
    slots: slots(act(game === "sv" ? mon("Smeargle", "Own Tempo", { evs: { spe: 252 } }) : mon("Absol", "Pressure", { evs: { spe: 252 } }), "Role Play", PL),
      idle(lax(0)), idle(mon("Zacian", "Intrepid Sword", { boosts: { atk: 1 }, appBoosts: { atk: 0 } })), idle(lax(8))),
    checks: "intrepidsword onStart (SV: once a battle, the fact; SwSh: every time).",
    outcomes: true,
  })),
  ...perGame("A1-STR-6", ["sv"], () => ({
    title: "Role Play copies Wind Rider with Tailwind on the user's side: +1 Atk",
    field: { own: { tailwind: true } },
    slots: slots(act(mon("Smeargle", "Own Tempo", { evs: { spe: 252 } }), "Role Play", PL), idle(lax(0)), idle(mon("Brambleghast", "Wind Rider")), idle(lax(8))),
    checks: "windrider onStart.",
    outcomes: true,
  })),
  ...perGame("A1-STR-7", ["swsh", "champions"], (game) => ({
    title: "Role Play copies Screen Cleaner: Reflect on the foes' side ends; then a physical hit",
    field: { opponent: { reflect: true } },
    slots: slots(act(game === "swsh" ? mon("Absol", "Pressure", { evs: { spe: 252 } }) : mon("Alakazam", "Magic Guard", { evs: { spe: 32 } }), "Role Play", PL),
      act(lax(k(game, 1)), body(game), PR), idle(mon("Mr. Rime", "Screen Cleaner")), idle(lax(k(game, 0)))),
    checks: "screencleaner onStart.",
    outcomes: true,
  })),
  ...perGame("A1-STR-8", ["sv", "champions"], (game) => ({
    title: "Role Play copies Drought in rain: the sun; then a Fire move",
    field: { weather: "Rain" },
    slots: slots(act(game === "sv" ? mon("Smeargle", "Own Tempo", { evs: { spe: 252 } }) : mon("Alakazam", "Magic Guard", { evs: { spe: 32 } }), "Role Play", PL),
      act(mon("Arcanine", "Flash Fire"), "Flamethrower", PR), idle(mon("Torkoal", "Drought")), idle(lax(k(game, 0)))),
    checks: "drought onStart: setWeather sunnyday over the rain.",
    outcomes: true,
  })),
  ...perGame("A1-STR-9", ["sv", "champions"], (game) => ({
    title: "Role Play copies Electric Surge on Psychic Terrain: Electric Terrain; then Thunderbolt",
    field: { terrain: "Psychic" },
    slots: slots(act(game === "sv" ? mon("Smeargle", "Own Tempo", { evs: { spe: 252 } }) : mon("Alakazam", "Magic Guard", { evs: { spe: 32 } }), "Role Play", PL),
      act(mon("Jolteon", "Volt Absorb"), "Thunderbolt", PR), idle(mon("Pincurchin", "Electric Surge")), idle(lax(k(game, 0)))),
    checks: "electricsurge onStart: setTerrain.",
    outcomes: true,
  })),
  ...perGame("A1-STR-10", ["sv"], () => ({
    title: "Role Play copies Cloud Nine in rain: the later Water move is not boosted",
    field: { weather: "Rain" },
    slots: slots(act(mon("Smeargle", "Own Tempo", { evs: { spe: 252 } }), "Role Play", PL), act(mon("Vaporeon", "Water Absorb"), "Water Pulse", PR),
      idle(mon("Altaria", "Cloud Nine")), idle(lax(0))),
    checks: "cloudnine: the effective weather.",
    outcomes: true,
  })),
  ...perGame("A1-END-1", ["sv", "usum"], (game) => ({
    title: "Simple Beam ends a foe's Unnerve: the user's ally eats its Sitrus at the Update",
    slots: slots(act(mon("Smeargle", "Own Tempo", { evs: { spe: 252 } }), "Simple Beam", PL), idle(lax(k(game, 0), { item: "Sitrus Berry", hp: 90 })),
      idle(mon("Houndoom", "Unnerve")), idle(lax(k(game, 1)))),
    checks: "SA16: unnerve onEnd; the Berry due at the Update.",
    outcomes: true,
  })),
  ...perGame("A1-GAS-2", ["sv", "usum"], (game) => ({
    title: "Gastro Acid on Cloud Nine in rain: the later Water Pulse is boosted",
    field: { weather: "Rain" },
    slots: slots(act(mon("Smeargle", "Own Tempo", { evs: { spe: 252 } }), "Gastro Acid", PL), act(mon("Vaporeon", "Water Absorb"), "Water Pulse", PR),
      idle(mon("Altaria", "Cloud Nine")), idle(lax(k(game, 0)))),
    checks: "SA17.",
    outcomes: true,
  })),
  ...perGame("A1-SKS-2", ["sv", "usum"], (game) => ({
    title: "Skill Swap gives Prankster to a foe with a status move: SV moves it next, USUM keeps its turn-start priority",
    slots: slots(act(mon("Meowstic", "Prankster", { evs: { spe: 252 } }), "Skill Swap", PL), act(lax(k(game, 4)), body(game), PR),
      act(mon("Hypno", "Insomnia"), "Hypnosis", OR), act(lax(k(game, 5)), body(game), OR)),
    checks: "SA14: SV re-reads the priority after each action; USUM's is frozen.",
    outcomes: true,
  })),
  ...perGame("A1-RPL-2", ["sv", "champions"], (game) => ({
    title: "Role Play copies Speed Boost: +1 Spe at the end of turn",
    slots: slots(act(game === "sv" ? mon("Smeargle", "Own Tempo", { evs: { spe: 252 } }) : mon("Alakazam", "Magic Guard", { evs: { spe: 32 } }), "Role Play", PL),
      idle(lax(k(game, 0))), idle(mon("Blaziken", "Speed Boost")), idle(lax(k(game, 1)))),
    checks: "K9b: the copied Speed Boost acts at the end of turn.",
    outcomes: true,
  })),
  ...perGame("A1-TRF-3", ["sv"], () => ({
    title: "Transform into a −2 Atk target with White Herb held: the herb restores it at AfterMove",
    slots: slots(act(mon("Ditto", "Limber", { item: "White Herb", evs: { spe: 252 } }), "Transform", PL), idle(lax(0)),
      idle(lax(16, { boosts: { atk: -2, spe: 1 } })), act(lax(8), "Body Slam", OL)),
    checks: "transformInto copies −2 Atk; White Herb at AfterMove.",
    outcomes: true,
  })),
  // ---- Failures and blocks (F1 §4.4; SA14e) ----
  ...perGame("A1-SKS-5", ["sv"], () => ({
    title: "Skill Swap into an Ability Shield holder: blocked; Earthquake after hits the Levitate-less? No: Bronzong keeps Levitate",
    slots: slots(act(mon("Smeargle", "Own Tempo", { evs: { spe: 252 } }), "Skill Swap", PL), idle(lax(0)),
      idle(mon("Bronzong", "Levitate", { item: "Ability Shield" })), act(mon("Garchomp", "Rough Skin"), "Earthquake")),
    checks: "SA14e: SetAbility on the target: -block.",
    outcomes: true,
  })),
  ...perGame("A1-ENT-2", ["sv"], (game) => ({
    title: "Entrainment into an Ability Shield holder: blocked (Levitate kept); Earthquake after",
    slots: slots(act(game === "sv" ? mon("Smeargle", "Own Tempo", { evs: { spe: 252 } }) : mon("Lopunny", "Klutz", { evs: { spe: 32 } }), "Entrainment", PL), idle(lax(k(game, 0))),
      idle(mon(game === "sv" ? "Bronzong" : "Rotom-Wash", "Levitate", { item: "Ability Shield" })), act(mon("Garchomp", "Rough Skin"), "Earthquake")),
    checks: "setAbility's SetAbility event: Ability Shield.",
    outcomes: true,
  })),
  ...perGame("A1-GAS-3", ["sv"], (game) => ({
    title: "Gastro Acid into an Ability Shield holder (blocked); the other Gastro Acid target after?",
    slots: slots(act(game === "sv" ? mon("Smeargle", "Own Tempo", { evs: { spe: 252 } }) : mon("Swalot", "Liquid Ooze", { evs: { spe: 32 } }), "Gastro Acid", PL), idle(lax(k(game, 0))),
      idle(mon(game === "sv" ? "Bronzong" : "Rotom-Wash", "Levitate", { item: "Ability Shield" })), act(mon("Garchomp", "Rough Skin"), "Earthquake")),
    checks: "gastroacid onTryHit: Ability Shield blocks.",
    outcomes: true,
  })),
  ...perGame("A1-GAS-4", ["sv", "usum"], (game) => ({
    title: "Skill Swap with a foe whose Levitate a Gastro Acid suppressed (earlier turn): the user gets an active Levitate; Earthquake after",
    slots: slots(act(mon("Smeargle", "Own Tempo", { evs: { spe: 252 } }), "Skill Swap", PL), idle(lax(k(game, 0))),
      idle(carried(mon("Bronzong", "Levitate"), { gastroAcid: true })), act(mon("Garchomp", "Rough Skin"), "Earthquake")),
    checks: "skillSwap swaps the abilities (getAbility: the real one); the gastroacid volatile stays on Bronzong (its new Own Tempo suppressed).",
    outcomes: true,
  })),
  ...perGame("A1-TRF-4", ["sv", "usum"], (game) => ({
    title: "Transform into a Gastro Acid'd Gyarados (Intimidate, earlier turn): Ditto's copied Intimidate is active and starts",
    slots: slots(act(mon("Ditto", "Limber", { evs: { spe: 252 } }), "Transform", PL), idle(lax(k(game, 0))),
      idle(carried(mon("Gyarados", "Intimidate"), { gastroAcid: true })), act(lax(k(game, 1)), body(game), OL)),
    checks: "transformInto copies pokemon.ability (the real one); Ditto has no gastroacid volatile.",
    outcomes: true,
  })),
  ...perGame("A1-WSD-2", ["sv", "usum"], (game) => ({
    title: "Worry Seed into Insomnia: immune; Simple Beam into Simple: fails",
    slots: slots(act(mon("Smeargle", "Own Tempo", { evs: { spe: 252 } }), "Worry Seed", PL), act(mon("Smeargle", "Technician", { evs: { spe: 248 } }), "Simple Beam", PR),
      idle(mon("Hypno", "Insomnia")), idle(mon("Numel", "Simple"))),
    checks: "worryseed onTryImmunity; simplebeam onTryHit.",
    outcomes: true,
  })),
  ...perGame("A1-RPL-3", ["sv", "usum"], (game) => ({
    title: "Role Play into the same ability fails; Role Play of a failroleplay ability (Imposter? Trace) fails",
    slots: slots(act(mon("Smeargle", "Own Tempo", { evs: { spe: 252 } }), "Role Play", PL), act(mon("Smeargle", "Technician", { evs: { spe: 248 } }), "Role Play", PR),
      idle(mon("Smeargle", "Own Tempo")), idle(mon(game === "sv" ? "Zoroark-Hisui" : "Zoroark", "Illusion"))),
    checks: "roleplay onTryHit.",
    outcomes: true,
  })),
  ...perGame("A1-ACU-4", ["sv", "champions"], (game) => ({
    title: "Acupressure on an ally behind a Substitute: blocked",
    slots: slots(act(mon(game === "sv" ? "Smeargle" : "Medicham", game === "sv" ? "Own Tempo" : "Pure Power", { evs: { spe: fast(game) } }), "Acupressure", OR), idle(lax(k(game, 0), { substitute: 50 })),
      idle(lax(k(game, 1))), idle(lax(k(game, 2)))),
    checks: "acupressure has no bypasssub.",
    outcomes: true,
  })),
  ...perGame("A1-PSY-2", ["sv", "usum"], (game) => ({
    title: "Psych Up into a Substitute with evasion +2 (earlier turns) and +1 Spe; then the foe's partner's Body Slam into the copier",
    slots: slots(act(mon("Smeargle", "Own Tempo", { evs: { spe: 252 } }), "Psych Up", PL), idle(lax(k(game, 0))),
      idle(carried(lax(k(game, 2), { substitute: 50, boosts: { spe: 1, def: 2 } }), { stages: { evasion: 2 } })), act(lax(k(game, 1)), body(game), OL)),
    checks: "SA03b: bypasssub; all seven copied.",
    outcomes: true,
  })),
  ...perGame("A1-SWP-3", ["sv", "champions"], (game) => ({
    title: "Power Swap with a +2 Atk foe, then that foe's Body Slam reads its swapped Attack",
    slots: slots(act(mon(game === "sv" ? "Smeargle" : "Medicham", game === "sv" ? "Own Tempo" : "Pure Power", { evs: { spe: fast(game) }, boosts: { spa: -1 } }), "Power Swap", PL), idle(lax(k(game, 0))),
      act(lax(k(game, 2), { boosts: { atk: 2 } }), body(game), OL), idle(lax(k(game, 1)))),
    checks: "powerswap: Atk and SpA stages swapped.",
    outcomes: true,
  })),
  ...perGame("A1-SPL-3", ["sv", "usum"], (game) => ({
    title: "Power Split, then the target's Body Slam reads its averaged stored Attack",
    slots: slots(act(mon("Smeargle", "Own Tempo", { evs: { spe: 252 } }), "Power Split", PL), idle(lax(k(game, 0))),
      act(lax(k(game, 2), { evs: { atk: 252 } }), body(game), OL), idle(lax(k(game, 1)))),
    checks: "SA06b: floor((a + b) / 2) for Atk and SpA.",
    outcomes: true,
  })),
  ...perGame("A1-TRK-3", ["usum"], () => ({
    title: "Shuckle's Power Trick (Atk 15 ↔ Def 250), then its Body Slam? It has no attack: a foe hits it",
    slots: slots(act(mon("Shuckle", "Sturdy", { evs: { spe: 4 } }), "Power Trick"), idle(lax(8)), act(lax(16), "Body Slam", OL), idle(lax(0))),
    checks: "the swapped Def is its old Atk.",
    outcomes: true,
  })),
  // ---- Trace gained mid-turn (SA14b's path; a Trace that copied nothing as it entered) ----
  ...perGame("A1-TRC-1", ["sv"], () => ({
    title: "Smeargle (Receiver) Skill Swaps the foe Gardevoir, whose Trace found only Receivers as it entered: Smeargle's Trace copies Thick Fat",
    slots: slots(act(mon("Smeargle", "Receiver", { evs: { spe: 252 }, appBuild: { abilityChanged: true } }), "Skill Swap", PL), idle(mon("Passimian", "Receiver")),
      idle(mon("Gardevoir", "Trace")), act(mon("Arcanine", "Flash Fire"), "Flamethrower", OL)),
    checks: "trace onStart: seek; the Update copies the one copyable foe (Snorlax? no: Arcanine's Flash Fire); the later Flamethrower into Smeargle is absorbed.",
    outcomes: true,
  })),
  // ---- The stored tests whose Skill Swap was L (doubles-start-rows SR44, doubles-turn-guards): now exact ----
  ...perGame("A1-SR44", ["sv"], () => ({
    title: "SR44: Gengar Skill Swaps Snorlax (Cursed Body for Thick Fat); Magnezone's Thunderbolt at Snorlax goes to the Lightning Rod Raichu",
    slots: slots(act(mon("Magnezone", "Magnet Pull", { evs: { spe: 4 } }), "Thunderbolt", PR), act(mon("Gengar", "Cursed Body"), "Skill Swap", PR),
      idle(mon("Raichu", "Lightning Rod")), idle(lax(4))),
    checks: "Skill Swap first (Gengar faster), then the redirection: Raichu +1 SpA, no damage.",
    outcomes: true,
  })),
  ...perGame("A1-GRD-1", ["champions"], () => ({
    title: "doubles-turn-guards: Gengar Skill Swaps Blastoise, then Charizard's Flamethrower into Blastoise",
    slots: slots(act(mon("Gengar", "Cursed Body"), "Skill Swap", PR), act(mon("Charizard", "Blaze"), "Flamethrower", PR), idle(mon("Venusaur", "Overgrow")), idle(mon("Blastoise", "Torrent"))),
    checks: "Blastoise gets Cursed Body (a later Disable chance on Charizard, which has no later move), Gengar Torrent; the Flamethrower damage is the plain one.",
    outcomes: true,
  })),
];
void PR;

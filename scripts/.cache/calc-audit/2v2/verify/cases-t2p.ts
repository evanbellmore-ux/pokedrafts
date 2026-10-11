// status2 wave 1b (Track V2): the T2P- cases of tier2-presence.md §2–§6 (ADDENDUM2 §7.2's cases-t2p.ts; T2P-UNB is Step 1's,
// in cases-status2-step1.ts). Owners (§8.5): PR (Commander, Poison Puppeteer, Dancer, Spotlight, Round, Beak Blast, Shell Trap,
// Beat Up, Fusion, the Counter family, Flame Burst, the Pledges, the rows), CL (Nature Power, Copycat, Mirror Move, Me First,
// Instruct), ST (Trace, two acting on one, Download, Custap), FC (field change, activations), N (the redirect ties, merged
// in 1a) and H (Sky Drop, merged in 1a). Probes: tier2-presence-probes-1…5.ts (TPn·…). The probes' mons are p1a, p1b, p2a,
// p2b: here own-left, own-right, opponent-right, opponent-left. Showdown names; level 50, 31 IVs, Serious nature, 0 EVs
// unless set (Champions: Stat Points). Wired into cases-se.ts through cases-wave1b.ts.
import type { Case, CaseMon, Game } from "./case-types";
import { OL, OR, PL, PR, act, carried, idle, mon, slots } from "./case-kit";
import { L, evs, fastEvs, slowest } from "./case-kit2";

const cases: Case[] = [];
const add = (id: string, games: Game[], make: (game: Game) => Omit<Case, "id" | "game">) => {
  for (const game of games) cases.push({ id: `${id}-${game}`, game, ...make(game) });
};
const chomp = (game: Game, extra: Partial<CaseMon> = {}) => mon("Garchomp", "Rough Skin", extra);
const fastChomp = (game: Game, extra: Partial<CaseMon> = {}) => chomp(game, { evs: fastEvs(game), ...extra });

// ================================ PR: Commander (SV; T2P §2.1, TP1·C1–C7, C27) ================================
const tatsu = (extra: Partial<CaseMon> = {}) => mon("Tatsugiri", "Commander", { evs: { spe: 252 }, ...extra });
/** Dondozo with Commander's +2 to all five from the lead (the stages are after entry effects). */
const dozo = (extra: Partial<CaseMon> = {}) => mon("Dondozo", "Unaware", { boosts: { atk: 2, def: 2, spa: 2, spd: 2, spe: 2 }, ...extra });
add("T2P-CMD-01", ["sv"], () => ({
  title: "Commander at the lead: a foe's Dragon Claw at Tatsugiri misses; the other foe's Earthquake misses Tatsugiri and hits the rest; Tatsugiri has no action (TP1·C1)",
  slots: slots(idle(tatsu()), act(dozo(), "Wave Crash", PL), act(chomp("sv"), "Earthquake"), act(fastChomp("sv"), "Dragon Claw", OL)),
  checks: "battle-actions.ts:625 commanding misses before the Invulnerability event; the spread modifier stays 0.75; side.ts auto-passes Tatsugiri.",
}));
add("T2P-CMD-01b", ["sv"], () => ({
  title: "The same with a move chosen for the commanding Tatsugiri (Dragon Pulse): it takes no action",
  slots: slots(act(tatsu(), "Dragon Pulse", PR), act(dozo(), "Wave Crash", PL), act(chomp("sv"), "Earthquake"), act(fastChomp("sv"), "Dragon Claw", OL)),
  checks: "onBeforeTurn cancels any action of a commanding Tatsugiri (the oracle's choice passes it).",
}));
add("T2P-CMD-02", ["sv"], () => ({
  title: "Dondozo (1 HP) knocked out first: at the next Update Tatsugiri stops commanding and the later Dragon Claw hits it (TP1·C2)",
  slots: slots(idle(tatsu()), act(dozo({ hp: 1 }), "Wave Crash", PL), act(chomp("sv"), "Dragon Claw", OL), act(fastChomp("sv"), "Dragon Claw", OR)),
  checks: "commanding's onUpdate ends with Dondozo fainted; Tatsugiri still has no action this turn.",
}));
add("T2P-CMD-03", ["sv"], () => ({
  title: "Sand and poison reach a commanding Tatsugiri at the end of turn; a foe's Icy Wind misses it, Dondozo −1 Spe (TP1·C3, C7)",
  field: { weather: "Sand" },
  slots: slots(idle(tatsu({ status: "psn" })), idle(dozo()), idle(L("sv", 1)), act(mon("Glalie", "Inner Focus", { evs: { spe: 252 } }), "Icy Wind")),
  checks: "The residuals reach it (no invulnerability at the end of turn); Icy Wind's spread drop misses Tatsugiri.",
  outcomes: true,
}));
add("T2P-CMD-04", ["sv"], () => ({
  title: "Order Up with Tatsugiri-Droopy commanding: Dondozo +1 Def after its hit (TP1·C4)",
  slots: slots(idle(tatsu({ species: "Tatsugiri-Droopy" })), act(dozo(), "Order Up", PR), idle(L("sv", 2)), idle(L("sv", 1))),
  checks: "moves.ts orderup onAfterMoveSecondarySelf: Droopy +1 Def (Curly Atk, Stretchy Spe).",
  outcomes: true,
}));
add("T2P-CMD-04b", ["sv"], () => ({
  title: "Order Up with Tatsugiri-Stretchy commanding: Dondozo +1 Spe (TP1·C4)",
  slots: slots(idle(tatsu({ species: "Tatsugiri-Stretchy" })), act(dozo(), "Order Up", PR), idle(L("sv", 2)), idle(L("sv", 1))),
  checks: "Order Up's stat by Tatsugiri's form: Stretchy +1 Spe.",
  outcomes: true,
}));
add("T2P-CMD-05", ["sv"], () => ({
  title: "Arcanine's Roar into the commanded Dondozo fails; Gengar's Perish Song misses the commanding Tatsugiri (TP1·C5)",
  slots: slots(idle(tatsu()), idle(dozo()), act(mon("Gengar", "Cursed Body"), "Perish Song"), act(mon("Arcanine", "Intimidate", { evs: { spe: 252 } }), "Roar", OR)),
  checks: "commanded onDragOut false; Perish Song through onInvulnerability misses Tatsugiri. (Arcanine's lead Intimidate is in Tatsugiri's and Dondozo's stages: Dondozo +1 Atk net.)",
  outcomes: true,
}));
add("T2P-CMD-05b", ["sv"], () => ({
  title: "Garchomp's Dragon Tail into the commanded Dondozo: damage, no drag (TP1·C5)",
  slots: slots(idle(tatsu()), idle(dozo()), idle(L("sv", 1)), act(fastChomp("sv"), "Dragon Tail", OR)),
  checks: "battle-actions.ts forceSwitch skips a commanded Pokémon.",
  outcomes: true,
}));
add("T2P-CMD-06", ["sv"], () => ({
  title: "Neutralizing Gas Weezing-Galar at the lead: Commander never activates, Tatsugiri moves (TP1·C6)",
  slots: slots(act(tatsu(), "Dragon Pulse", PR), idle(mon("Dondozo", "Unaware")), idle(mon("Weezing-Galar", "Neutralizing Gas")), idle(L("sv", 1))),
  checks: "The gas (switch-in priority 2) is out first at the lead: no Commander, no +2.",
}));
add("T2P-CMD-07", ["sv"], () => ({
  title: "Commander, E2: commanding and commanded in the outcomes, Dondozo's stages; a foe's Dragon Claw at Dondozo",
  slots: slots(idle(tatsu()), idle(dozo()), idle(L("sv", 1)), act(fastChomp("sv"), "Dragon Claw", OR)),
  checks: "E2 volatiles commanding (Tatsugiri) and commanded (Dondozo).",
  outcomes: true,
}));

// ================================ PR: Poison Puppeteer (SV; T2P §2.2, TP1·P1–P6) ================================
const pech = () => mon("Pecharunt", "Poison Puppeteer", { evs: { spe: 252 } });
add("T2P-PUP-01", ["sv"], () => ({
  title: "Pecharunt's Toxic into a foe that moves later: confused too; its Dragon Claw meets the confusion check (TP1·P1)",
  slots: slots(act(pech(), "Toxic", PR), idle(L("sv", 1)), idle(L("sv", 2)), act(chomp("sv"), "Dragon Claw", OL)),
  checks: "abilities.ts poisonpuppeteer onAnyAfterSetStatus: a fresh confusion on the target; the 1/3 self-hit branches.",
  outcomes: true,
}));
add("T2P-PUP-02", ["sv"], () => ({
  title: "Pecharunt's Poison Gas into Own Tempo Slowbro and a Lum Berry Garchomp: Slowbro poisoned, not confused; Garchomp's Lum cures both at the Update (TP1·P2)",
  slots: slots(act(pech(), "Poison Gas"), idle(L("sv", 1)), idle(chomp("sv", { item: "Lum Berry" })), idle(mon("Slowbro", "Own Tempo"))),
  checks: "Own Tempo stops the confusion; Lum cures poison and confusion.",
  outcomes: true,
}));
add("T2P-PUP-03", ["sv"], () => ({
  title: "Pecharunt's Toxic into a Persim Berry Garchomp; its ally Glimmora's Toxic into the other foe: no confusion from Glimmora's (TP1·P3)",
  slots: slots(act(pech(), "Toxic", PR), act(mon("Glimmora", "Toxic Debris"), "Toxic", PL), idle(L("sv", 2)), idle(chomp("sv", { item: "Persim Berry" }))),
  checks: "The source must be the holder; Persim cures the confusion at the Update.",
  outcomes: true,
}));
add("T2P-PUP-04", ["sv"], () => ({
  title: "Pecharunt's Toxic into an already confused Garchomp: badly poisoned, the confusion stays as it was (TP1·P4)",
  slots: slots(act(pech(), "Toxic", PR), idle(L("sv", 1)), idle(L("sv", 2)), idle(carried(chomp("sv"), { confusion: { attempts: 0 } }))),
  checks: "addVolatile confusion fails on a confused Pokémon (no restart).",
  outcomes: true,
}));
add("T2P-PUP-05", ["sv"], () => ({
  title: "Pecharunt's Toxic into its own ally: badly poisoned and confused (target !== source only) (TP1·P5)",
  slots: slots(act(pech(), "Toxic", OR), idle(L("sv", 1)), idle(L("sv", 2)), idle(L("sv", 3))),
  checks: "Poison Puppeteer reads any target but the holder.",
  outcomes: true,
}));

// ================================ PR: Dancer (SV, USUM; T2P §2.3, TP1·D1–D9, C42) ================================
const orico = (game: Game, n = 0, extra: Partial<CaseMon> = {}) => mon("Oricorio", "Dancer", { evs: { spe: n * 8 }, ...extra });
add("T2P-DAN-01", ["sv", "usum"], (game) => ({
  title: "A foe's Swords Dance: Oricorio copies it at once (+2 Atk) (TP1·D1)",
  slots: slots(idle(orico(game)), idle(L(game, 1)), act(fastChomp(game), "Swords Dance"), idle(L(game, 2))),
  checks: "battle-actions.ts:317-345: the copy after the dance's AfterMove (externalMove: no PP, no lastMove).",
  outcomes: true,
}));
add("T2P-DAN-03", ["sv"], () => ({
  title: "Two Dancers copy a foe's Swords Dance: the slower stored Speed first (TP1·D2)",
  slots: slots(idle(orico("sv", 10)), idle(mon("Oricorio-Pom-Pom", "Dancer", { evs: { spe: 8 } })), act(fastChomp("sv"), "Swords Dance"), idle(L("sv", 2))),
  checks: "dancers.sort by storedStats.spe ascending.",
  outcomes: true,
}));
add("T2P-DAN-04", ["sv"], () => ({
  title: "Its ally's Fiery Dance into foe A: the Dancer copies it at foe A; a foe's Fiery Dance into the Dancer's ally: the Dancer copies it at that foe (TP1·D3)",
  slots: slots(idle(orico("sv")), act(mon("Volcarona", "Flame Body", { evs: { spe: 252 } }), "Fiery Dance", PR),
    act(mon("Volcarona", "Flame Body", { evs: { spe: 200 } }), "Fiery Dance", OR), idle(L("sv", 1))),
  checks: "The copy's target: the dance's last target unless it is the Dancer's ally and the user is, else the user.",
}));
add("T2P-DAN-05", ["sv"], () => ({
  title: "A paralysed Dancer: its copy of Swords Dance meets full paralysis (1/4) (TP1·D4)",
  slots: slots(idle(orico("sv", 0, { status: "par" })), idle(L("sv", 1)), act(fastChomp("sv"), "Swords Dance"), idle(L("sv", 2))),
  checks: "The copy runs BeforeMove: par 1/4.",
  outcomes: true,
}));
add("T2P-DAN-06", ["usum"], () => ({
  title: "An asleep Dancer: its copy does not happen and its sleep counter goes down (twice with its own No move) (TP1·D6)",
  slots: slots(idle(orico("usum", 0, { status: "slp" })), idle(L("usum", 1)), act(fastChomp("usum"), "Swords Dance"), idle(L("usum", 2))),
  checks: "BeforeMove's sleep check on the copy (time--) and on its own action.",
  outcomes: true,
}));
add("T2P-DAN-07", ["sv"], () => ({
  title: "A foe's Swords Dance at +6 fails: no copy; Lilligant's Petal Dance is copied (no lock on the Dancer) (TP1·D5)",
  slots: slots(act(orico("sv"), "Air Slash", PR), idle(L("sv", 1)), act(fastChomp("sv", { boosts: { atk: 6 } }), "Swords Dance"), act(mon("Lilligant", "Own Tempo"), "Petal Dance")),
  checks: "moveDidSomething false for the failed dance; Petal Dance's copy at a random target, no lockedmove.",
}));
add("T2P-DAN-08", ["usum"], () => ({
  title: "Spinda's Teeter Dance copied by Oricorio: every adjacent Pokémon confused twice over (TP1·D7)",
  slots: slots(idle(orico("usum")), idle(L("usum", 1)), act(mon("Spinda", "Own Tempo", { evs: { spe: 252 } }), "Teeter Dance"), idle(L("usum", 2))),
  checks: "The copy confuses the Pokémon not yet confused; the later No moves' confusion checks.",
  outcomes: true,
}));
add("T2P-DAN-09", ["sv"], () => ({
  title: "A Dancer that already moved copies again; a Dancer under Taunt cannot copy Swords Dance (TP1·D8)",
  slots: slots(act(orico("sv", 30), "Air Slash", PR), idle(carried(mon("Oricorio-Pom-Pom", "Dancer", { evs: { spe: 8 } }), { taunt: 2 })), act(chomp("sv"), "Swords Dance"), idle(L("sv", 2))),
  checks: "Taunt stops the copy at BeforeMove; the faster Oricorio copies after its own move.",
  outcomes: true,
}));
add("T2P-DAN-10", ["sv"], () => ({
  title: "Two Dancers at one stored Speed copy a foe's Quiver Dance: the newer ability state first (entryOrder)",
  entryOrder: { "own-left": 1, "own-right": 2, "opponent-right": 3, "opponent-left": 4 },
  slots: slots(idle(orico("sv")), idle(mon("Oricorio-Pom-Pom", "Dancer")), act(mon("Volcarona", "Flame Body", { evs: { spe: 252 } }), "Quiver Dance"), idle(L("sv", 2))),
  checks: "dancers.sort: equal stored Speed, b.abilityState.effectOrder − a's: Oricorio-Pom-Pom (rank 2) before Oricorio (C42).",
  outcomes: true,
}));
// ADDENDUM2 §9's cross-family checklist: a Dancer's copy into a hidden target.
add("T2P-DAN-11", ["sv"], () => ({
  title: "Its ally Lilligant's Petal Dance (a random foe) copied by Oricorio: the copy's random target may be the Corviknight flying this turn (missed)",
  slots: slots(idle(mon("Oricorio", "Dancer")), act(mon("Lilligant", "Own Tempo"), "Petal Dance"), idle(L("sv", 0)), act(mon("Corviknight", "Pressure", { evs: { spe: 252 } }), "Fly", OL)),
  checks: "A random-target dance copied: the copy picks its own random target (getRandomTarget); a Fly user misses it (H's hidden state).",
}));
add("T2P-DAN-10b", ["sv"], () => ({
  title: "The same with the entry order unknown: the reason (C42)",
  notEstimated: "Dancer needs whether Oricorio or Oricorio-Pom-Pom came in first.",
  slots: slots(idle(orico("sv")), idle(mon("Oricorio-Pom-Pom", "Dancer")), act(mon("Volcarona", "Flame Body", { evs: { spe: 252 } }), "Quiver Dance"), idle(L("sv", 2))),
  checks: "REASONS.needsEntryOrder(\"Dancer\", a, b).",
}));

// ================================ PR: Spotlight (USUM; T2P §3.1, TP1·S1–S4) ================================
const spot = () => mon("Clefable", "Magic Guard", { evs: { spe: 252 } });
add("T2P-SPL-01", ["usum"], () => ({
  title: "Spotlight on foe A: the user's ally's Dragon Claw at foe B goes to foe A (TP1·S1)",
  slots: slots(act(spot(), "Spotlight", PR), act(chomp("usum"), "Dragon Claw", PL), idle(L("usum", 2)), idle(L("usum", 1))),
  checks: "spotlight condition onFoeRedirectTarget priority 2.",
}));
add("T2P-SPL-02", ["usum"], () => ({
  title: "Spotlight on its own ally: the foes' Dragon Claws at the user go to the ally (TP1·S2)",
  slots: slots(act(spot(), "Spotlight", OR), idle(L("usum", 1)), act(chomp("usum"), "Dragon Claw", OL), act(chomp("usum", { evs: { spe: 4 } }), "Dragon Claw", OL)),
  checks: "The ally is the centre for its foes' moves.",
}));
add("T2P-SPL-02b", ["usum"], () => ({
  title: "Spotlight on foe A and foe B's Follow Me: Spotlight (2) wins over Follow Me (1) for the ally's Dragon Claw (TP1·S3)",
  slots: slots(act(spot(), "Spotlight", PL), act(chomp("usum"), "Dragon Claw", PR), idle(L("usum", 1)), act(mon("Clefable", "Magic Guard"), "Follow Me")),
  checks: "CENTRES priority: Spotlight 2, Follow Me 1.",
}));
add("T2P-SPL-03", ["usum"], () => ({
  title: "Spotlight into Magic Bounce Espeon: reflected onto the user; a foe's Dragon Claw at the user's ally goes to the user (TP1·S4)",
  slots: slots(act(spot(), "Spotlight", PR), idle(L("usum", 1)), act(chomp("usum"), "Crunch", OR), idle(mon("Espeon", "Magic Bounce"))),
  checks: "Magic Bounce reflects the reflectable Spotlight: the user is the centre.",
}));

// ================================ PR: Round (all four; T2P §3.2, TP1·R1–R5, TP5·E4) ================================
add("T2P-RND-01", ["sv"], () => ({
  title: "Two Rounds (the ally slowest) with a foe in between: the second moves right after the first at 120 (TP1·R1)",
  slots: slots(act(mon("Altaria", "Natural Cure", { evs: { spe: 252 } }), "Round", PR), act(mon("Jigglypuff", "Competitive"), "Round", PR), idle(L("sv", 2)), act(chomp("sv", slowest("sv")), "Dragon Claw", OL)),
  checks: "moves.ts round onTry: prioritizeAction of the next queued Round; basePowerCallback 120 with sourceEffect Round. (SV Snorlax has no Round: Jigglypuff.)",
}));
add("T2P-RND-02", ["champions"], () => ({
  title: "A foe's Round after the user's: pulled too (any queued Round) (TP1·R2)",
  slots: slots(act(mon("Altaria", "Natural Cure", { evs: { spe: 32 } }), "Round", PR), idle(L("champions", 1)), act(L("champions", 0), "Round", OL), act(chomp("champions", { evs: { spe: 20 } }), "Dragon Claw", OL)),
  checks: "Round pulls the first queued Round of either side.",
}));
add("T2P-RND-03", ["sv"], () => ({
  title: "Three Rounds: each pulls the next (TP1·R3)",
  slots: slots(act(mon("Altaria", "Natural Cure", { evs: { spe: 252 } }), "Round", PR), act(mon("Skeledirge", "Unaware"), "Round", PR), act(mon("Jigglypuff", "Competitive"), "Round", OL), act(chomp("sv", slowest("sv")), "Dragon Claw", OL)),
  checks: "The pulled Round's onTry pulls the next one.",
}));
add("T2P-RND-04", ["swsh"], () => ({
  title: "The first Round user fully paralysed: no pull; the second Round at its own place (TP1·R5)",
  slots: slots(act(mon("Altaria", "Natural Cure", { evs: { spe: 252 }, status: "par" }), "Round", PR), act(L("swsh", 0), "Round", PR), idle(L("swsh", 2)), act(chomp("swsh", { evs: { spe: 100 } }), "Dragon Claw", OR)),
  checks: "A Round stopped at BeforeMove never reaches onTry.",
}));
add("T2P-RND-05", ["usum"], () => ({
  title: "Generation 7: two Rounds with a foe in between: the pulled Round moves next (the frozen order)",
  slots: slots(act(mon("Altaria", "Natural Cure", { evs: { spe: 252 } }), "Round", PR), act(L("usum", 0), "Round", PR), idle(L("usum", 2)), act(chomp("usum", { evs: { spe: 100 } }), "Dragon Claw", OL)),
  checks: "prioritizeAction moves the action to the front in gen 7 too.",
}));
add("T2P-RND-06", ["sv"], () => ({
  title: "The first queued Round is a fainted Pokémon's (knocked out before): it is pulled and does nothing; the living Round is not (TP5·E4)",
  slots: slots(act(fastChomp("sv"), "Dragon Claw", PL), act(mon("Altaria", "Natural Cure", { evs: { spe: 100 } }), "Round", PR),
    act(mon("Azelf", "Levitate", { hp: 1 }), "Round", OL), act(mon("Jigglypuff", "Competitive"), "Round", OR)),
  checks: "Round pulls the first queued Round, a fainted user's included.",
}));

// ================================ PR: Beak Blast, Shell Trap (T2P §3.3, §3.4, TP1·K1–K7) ================================
add("T2P-BKB-01", ["sv"], () => ({
  title: "Beak Blast's heat: a foe's contact Dragon Claw into Toucannon burns the attacker; the other foe's Earth Power does not (TP1·K1)",
  slots: slots(act(mon("Toucannon", "Keen Eye"), "Beak Blast", PR), idle(L("sv", 1)), act(chomp("sv", { evs: { spe: 200 } }), "Dragon Pulse", OL), act(fastChomp("sv"), "Dragon Claw", OL)),
  checks: "moves.ts beakblast priorityChargeCallback at the turn's start; onHit contact → trySetStatus brn.",
  outcomes: true,
}));
add("T2P-BKB-02", ["champions"], () => ({
  title: "Toucannon fully paralysed before its Beak Blast: the heat stays to the end of turn; a later Dragon Tail (contact) is burned (TP1·K2)",
  canSwitch: { own: false },
  slots: slots(act(mon("Toucannon", "Keen Eye", { evs: { spe: 32 }, status: "par" }), "Beak Blast", PR), idle(L("champions", 1)), idle(L("champions", 2)), act(chomp("champions", { evs: { spe: 4 } }), "Dragon Tail", OL)),
  checks: "beakblast volatile ends at its own AfterMove or the end of turn; a stopped Beak Blast keeps it. (No bench on Toucannon's side: Dragon Tail cannot drag.)",
  outcomes: true,
}));
add("T2P-BKB-03", ["usum"], () => ({
  title: "A Synchronize Umbreon's contact Foul Play into a heating Toucannon: burned, and Synchronize burns Toucannon back",
  slots: slots(act(mon("Toucannon", "Keen Eye"), "Beak Blast", PR), idle(L("usum", 1)), act(mon("Umbreon", "Synchronize", { evs: { spe: 252 } }), "Foul Play", OL), idle(L("usum", 2))),
  checks: "trySetStatus brn with the holder as source; Synchronize passes it.",
  outcomes: true,
}));
add("T2P-BKB-04", ["sv"], () => ({
  title: "Dual Wingbeat into a heating Toucannon: the burn lands between the hits: the reason (TP1·K3)",
  notEstimated: "Dual Wingbeat into Toucannon's Beak Blast is not modelled in 2v2.",
  slots: slots(act(mon("Toucannon", "Keen Eye"), "Beak Blast", PR), idle(L("sv", 1)), act(mon("Braviary", "Keen Eye", { evs: { spe: 252 } }), "Dual Wingbeat", OL), idle(L("sv", 2))),
  checks: "REASONS.intoBeakBlast (§2.4 kept).",
}));
add("T2P-STP-01", ["usum"], () => ({
  title: "Shell Trap hit by a foe's physical Dragon Claw: Turtonator moves next, before the slower foe (TP1·K4)",
  slots: slots(act(mon("Turtonator", "Shell Armor"), "Shell Trap"), idle(L("usum", 1)), act(chomp("usum"), "Dragon Claw", OL), act(fastChomp("usum"), "Dragon Claw", OL)),
  checks: "shelltrap onHit (physical, a foe): gotHit and prioritizeAction.",
}));
add("T2P-STP-02", ["swsh"], () => ({
  title: "Shell Trap hit twice by two foes: it moves after the first hit (TP1·K7)",
  slots: slots(act(mon("Turtonator", "Shell Armor"), "Shell Trap"), idle(L("swsh", 1)), act(chomp("swsh", { evs: { spe: 200 } }), "Dragon Claw", OL), act(fastChomp("swsh"), "Dragon Claw", OL)),
  checks: "The first physical hit prioritises it; the second foe moves after.",
}));
add("T2P-STP-03", ["usum"], () => ({
  title: "Shell Trap not hit physically (a foe's Earth Power, its ally's Tackle): it fails (TP1·K5)",
  slots: slots(act(mon("Turtonator", "Shell Armor"), "Shell Trap"), act(L("usum", 12), "Tackle", OL), idle(L("usum", 2)), act(fastChomp("usum"), "Earth Power", OL)),
  checks: "gotHit needs a physical hit from a foe; Shell Trap's onTryMove fails.",
}));
add("T2P-STP-04", ["swsh"], () => ({
  title: "A physical hit into Turtonator's Substitute: Shell Trap fails (TP1·K6)",
  slots: slots(act(mon("Turtonator", "Shell Armor", { substitute: 60 }), "Shell Trap"), idle(L("swsh", 1)), idle(L("swsh", 2)), act(fastChomp("swsh"), "Dragon Claw", OL)),
  checks: "The Substitute takes the hit: no Hit event on the Pokémon, no gotHit.",
}));

// ================================ PR: Beat Up (all four; T2P §3.5, TP2·BU1–BU3) ================================
add("T2P-BTU-01", ["sv"], () => ({
  title: "Beat Up: the user, its partner Kingambit and the bench Snorlax, one hit each (TP2·BU1)",
  slots: slots(act(mon("Houndoom", "Flash Fire", { evs: { spe: 252 } }), "Beat Up", PR, { party: ["kingambit", "snorlax"] }), idle(mon("Kingambit", "Defiant")), idle(L("sv", 2)), idle(L("sv", 1))),
  checks: "moves.ts beatup: one hit per side.pokemon member alive with no status (the user always), 5 + floor(base Atk / 10).",
}));
add("T2P-BTU-02", ["champions"], () => ({
  title: "Beat Up into its own Justified ally Arcanine: +1 Attack per hit (TP2·BU3)",
  slots: slots(act(mon("Houndoom", "Flash Fire", { evs: { spe: 32 } }), "Beat Up", OR, { party: ["arcanine", "snorlax"] }), idle(mon("Arcanine", "Justified")), idle(L("champions", 2)), idle(L("champions", 1))),
  checks: "Justified per Dark hit: three hits, +3 Attack.",
  outcomes: true,
}));
add("T2P-BTU-03", ["swsh"], () => ({
  title: "Beat Up after a faster foe's Toxic badly poisoned the partner: one hit fewer (TP2·BU2)",
  slots: slots(act(mon("Thievul", "Stakeout", slowest("swsh")), "Beat Up", PR, { party: ["grimmsnarl", "snorlax"] }), idle(mon("Grimmsnarl", "Prankster")), idle(L("swsh", 2)), act(mon("Toxapex", "Regenerator", { nature: "Jolly", evs: { spe: 252 } }), "Toxic", OR)),
  checks: "The party is read at the use: the poisoned partner is left out. (SwSh has no Houndoom: Thievul.)",
}));
add("T2P-BTU-04", ["usum"], () => ({
  title: "USUM Beat Up: the user, its partner and the bench Snorlax",
  slots: slots(act(mon("Houndoom", "Flash Fire", { evs: { spe: 252 } }), "Beat Up", PR, { party: ["absol", "snorlax"] }), idle(mon("Absol", "Justified")), idle(L("usum", 2)), idle(L("usum", 1))),
  checks: "moves.ts beatup (gen 7: the same).",
}));

// ================================ PR: Fusion Bolt / Flare (SV, SwSh, USUM; T2P §3.6, TP1·F1–F6, TP3·FU5) ================================
const reshi = (game: Game) => mon("Reshiram", "Turboblaze", { evs: fastEvs(game) });
const zek = () => mon("Zekrom", "Teravolt");
add("T2P-FUS-01", ["sv"], () => ({
  title: "Fusion Flare then Fusion Bolt: the Bolt at 2x power (TP1·F1)",
  slots: slots(act(reshi("sv"), "Fusion Flare", PR), act(zek(), "Fusion Bolt", PR), idle(L("sv", 2)), idle(L("sv", 1))),
  checks: "moves.ts fusionbolt onBasePower: lastSuccessfulMoveThisTurn fusionflare.",
}));
add("T2P-FUS-02", ["sv"], () => ({
  title: "Fusion Flare, a foe's Splash in between, then Fusion Bolt: no boost (TP1·F2)",
  slots: slots(act(reshi("sv"), "Fusion Flare", PR), act(zek(), "Fusion Bolt", PR), idle(chomp("sv")), idle(L("sv", 2))),
  checks: "Splash reached useMove: lastSuccessfulMoveThisTurn splash.",
}));
add("T2P-FUS-03", ["swsh"], () => ({
  title: "Fusion Flare into a Protect, then Fusion Bolt: no boost (TP1·F4)",
  slots: slots(act(reshi("swsh"), "Fusion Flare", PL), act(zek(), "Fusion Bolt", PR), act(L("swsh", 31, { evs: { spe: 252 } }), "Protect"), idle(L("swsh", 2))),
  checks: "A blocked Flare did nothing: lastSuccessfulMoveThisTurn null.",
}));
add("T2P-FUS-04", ["usum"], () => ({
  title: "Fusion Flare, a paralysed Ninjask in between (fully paralysed 1/4: boost kept), then Fusion Bolt (TP3·FU5)",
  slots: slots(act(reshi("usum"), "Fusion Flare", PR), act(zek(), "Fusion Bolt", PR), act(mon("Ninjask", "Infiltrator", { evs: { spe: 252 }, nature: "Jolly", status: "par" }), "Swords Dance"), idle(L("usum", 2))),
  checks: "A runMove stopped at BeforeMove leaves lastSuccessfulMoveThisTurn; else Swords Dance resets it.",
}));
add("T2P-FUS-05", ["sv"], () => ({
  title: "Fusion Flare knocks out its target, then Fusion Bolt into the other foe: 2x (TP1·F6)",
  slots: slots(act(reshi("sv"), "Fusion Flare", PR), act(zek(), "Fusion Bolt", PL), idle(L("sv", 2)), idle(L("sv", 1, { hp: 1 }))),
  checks: "A knockout did something.",
}));
add("T2P-FUS-06", ["swsh"], () => ({
  title: "Fusion Flare, a foe's failed Swords Dance (at +6) in between, then Fusion Bolt: no boost (TP1·F3b)",
  slots: slots(act(reshi("swsh"), "Fusion Flare", PR), act(zek(), "Fusion Bolt", PR), act(chomp("swsh", { boosts: { atk: 6 } }), "Swords Dance"), idle(L("swsh", 2))),
  checks: "A failed move reached useMove: lastSuccessfulMoveThisTurn null.",
}));

// ================================ PR: the Counter family (T2P §3.7, TP2·C1–C13, TP3·FU4, TP5·E1–E3) ================================
add("T2P-CTR-01", ["sv"], () => ({
  title: "Counter: twice the physical hit's damage, at the attacker, every roll (TP2·C1)",
  slots: slots(act(mon("Annihilape", "Inner Focus"), "Counter"), idle(L("sv", 1)), act(fastChomp("sv"), "Dragon Claw", OL), idle(L("sv", 2))),
  checks: "moves.ts counter: damageCallback 2 × the last physical damage from a foe; its own redirect to that slot. (No Wobbuffet in SV: Annihilape.)",
}));
add("T2P-CTR-02", ["champions"], () => ({
  title: "Mirror Coat after a foe's special Earth Power: twice it, at the attacker (TP2·C5)",
  slots: slots(act(mon("Farigiraf", "Sap Sipper"), "Mirror Coat"), idle(L("champions", 1)), act(fastChomp("champions"), "Earth Power", OL), idle(L("champions", 2))),
  checks: "moves.ts mirrorcoat: the special counterpart.",
}));
add("T2P-CTR-03", ["sv"], () => ({
  title: "Counter after a two-hit Dual Wingbeat: twice the last hit only (TP2·C2)",
  slots: slots(act(mon("Annihilape", "Inner Focus"), "Counter"), idle(L("sv", 1)), act(mon("Braviary", "Keen Eye", { evs: { spe: 252 } }), "Dual Wingbeat", OL), idle(L("sv", 2))),
  checks: "The counter volatile's onDamagingHit records each hit: the last one's damage.",
}));
add("T2P-CTR-04", ["sv"], () => ({
  title: "Counter after two physical hits from two foes: twice the later attacker's, at it (TP2·C3)",
  slots: slots(act(mon("Annihilape", "Inner Focus"), "Counter"), idle(L("sv", 1)), act(fastChomp("sv"), "Dragon Claw", OL), act(chomp("sv", { evs: { spe: 100 } }), "Dragon Claw", OL)),
  checks: "The later hit overwrites the record.",
}));
add("T2P-CTR-05", ["champions"], () => ({
  title: "Counter with Follow Me on the attacker's side: the Follow Me user takes it (TP2·C4)",
  slots: slots(act(mon("Annihilape", "Inner Focus"), "Counter"), idle(L("champions", 1)), act(mon("Clefable", "Magic Guard"), "Follow Me"), act(fastChomp("champions"), "Dragon Claw", OL)),
  checks: "Follow Me's redirect (priority 1) before Counter's own (−1).",
}));
add("T2P-CTR-06", ["sv"], () => ({
  title: "Metal Burst: floor(1.5x) the last damage from a foe, every roll (TP3·FU4)",
  slots: slots(act(mon("Bastiodon", "Sturdy", { evs: { hp: 252, spd: 252 } }), "Metal Burst"), idle(L("sv", 1)), act(fastChomp("sv"), "Dragon Pulse", OL), idle(L("sv", 2))),
  checks: "moves.ts metalburst damageCallback: (lastDamagedBy.damage * 1.5) || 1, floored.",
}));
add("T2P-CTR-07", ["champions"], () => ({
  title: "Comeuppance after a special hit: 1.5x at the attacker (TP2·C8)",
  slots: slots(act(mon("Mabosstiff", "Stakeout"), "Comeuppance"), idle(L("champions", 1)), act(fastChomp("champions"), "Earth Power", OL), idle(L("champions", 2))),
  checks: "moves.ts comeuppance: as Metal Burst, a contact move.",
}));
add("T2P-CTR-08", ["usum"], () => ({
  title: "Counter into a Ghost-type attacker (Shadow Claw): immune; Mirror Coat into a Dark-type attacker (Dark Pulse): immune (TP2·C10)",
  slots: slots(act(mon("Wobbuffet", "Shadow Tag"), "Counter"), act(mon("Wobbuffet", "Shadow Tag", { evs: { spe: 8 } }), "Mirror Coat"),
    act(mon("Hydreigon", "Levitate", { evs: { spe: 200 } }), "Dark Pulse", OR), act(mon("Gengar", "Cursed Body", { evs: { spe: 252 } }), "Shadow Claw", OL)),
  checks: "Counter (Fighting) into a Ghost, Mirror Coat (Psychic) into a Dark type: the type immunity.",
}));
add("T2P-CTR-09", ["sv"], () => ({
  title: "Counter after Garchomp's hit, then its ally's Ally Switch: Counter goes to the slot Garchomp hit from (TP2·C12)",
  slots: slots(act(mon("Annihilape", "Inner Focus"), "Counter"), idle(L("sv", 1)), act(mon("Cresselia", "Levitate", { evs: { spe: 100 } }), "Ally Switch"), act(fastChomp("sv"), "Dragon Claw", OL)),
  checks: "The record is a slot (counter's onRedirectTarget getAtSlot): the Pokémon standing there now.",
  outcomes: true,
}));
add("T2P-CTR-10", ["usum"], () => ({
  title: "Kangaskhan-Mega (Parental Bond, Mega Evolved this turn) Counter: two hits of twice the damage (TP5·E3)",
  notEstimated: "Counter with Parental Bond is not modelled in 2v2.",
  slots: slots(act(mon("Kangaskhan", "Parental Bond", { item: "Kangaskhanite", choice: "mega", appSpecies: "kangaskhanmega", evs: { hp: 252, def: 252 } }), "Counter"), idle(L("usum", 1)),
    idle(L("usum", 2)), act(fastChomp("usum"), "Dragon Claw", OL)),
  checks: "Parental Bond: the second strike of a fixed-damage move deals the full amount again.",
}));
add("T2P-CTR-11", ["sv"], () => ({
  title: "Counter after its physical attacker was knocked out by the Counter user's ally: no target (TP5·E1)",
  slots: slots(act(mon("Annihilape", "Inner Focus"), "Counter"), act(L("sv", 10), "Body Slam", PR), idle(L("sv", 2)), act(fastChomp("sv", { hp: 1 }), "Dragon Claw", OL)),
  checks: "The recorded slot's Pokémon fainted: Counter fails (no target).",
}));
add("T2P-CTR-12", ["swsh"], () => ({
  title: "Metal Burst after a hit into its Substitute: no damage taken to return: it fails (TP2·C11)",
  slots: slots(act(mon("Aggron", "Sturdy", { substitute: 70 }), "Metal Burst"), idle(L("swsh", 1)), act(fastChomp("swsh"), "Earth Power", OL), idle(L("swsh", 2))),
  checks: "A hit into a Substitute is not recorded in attackedBy as damage the Pokémon took.",
}));

// ================================ PR: Flame Burst (USUM; T2P §3.8, TP1·B1–B5) ================================
const zard = () => mon("Charizard", "Blaze", { evs: { spe: 252 } });
add("T2P-FLB-01", ["usum"], () => ({
  title: "Flame Burst into foe A: its partner (Sitrus, 110 HP) loses 1/16 at the hit and eats its Sitrus at the Update (TP1·B1)",
  slots: slots(act(zard(), "Flame Burst", PR), idle(L("usum", 1)), idle(L("usum", 3, { item: "Sitrus Berry", hp: 110 })), idle(L("usum", 2))),
  checks: "moves.ts flameburst onHit: each adjacent ally of the target loses baseMaxhp / 16.",
}));
add("T2P-FLB-02", ["usum"], () => ({
  title: "Flame Burst into foe A's Substitute: its Magic Guard partner Clefable loses nothing (TP1·B2)",
  slots: slots(act(zard(), "Flame Burst", PR), idle(L("usum", 1)), idle(mon("Clefable", "Magic Guard")), idle(L("usum", 2, { substitute: 60 }))),
  checks: "onAfterSubDamage splashes; Magic Guard stops it.",
}));
add("T2P-FLB-02b", ["usum"], () => ({
  title: "Flame Burst into foe A's Substitute: its partner still loses 1/16 (TP1·B2b)",
  slots: slots(act(zard(), "Flame Burst", PR), idle(L("usum", 1)), idle(L("usum", 3)), idle(L("usum", 2, { substitute: 60 }))),
  checks: "onAfterSubDamage: the splash through a Substitute.",
}));
add("T2P-FLB-03", ["usum"], () => ({
  title: "Flame Burst into its own ally: the splash hits the user (TP1·B4)",
  slots: slots(act(zard(), "Flame Burst", OR), idle(L("usum", 1)), idle(L("usum", 2)), idle(L("usum", 3))),
  checks: "The target's adjacent ally is the user.",
}));

// ================================ CL: Nature Power, Copycat, Mirror Move, Me First, Instruct (T2P §3.9–§3.13) ================================
add("T2P-NAT-01", ["swsh"], () => ({
  title: "Nature Power on Electric Terrain: Thunderbolt at foe B, redirected by foe A's Lightning Rod (TP2·N1, N2)",
  field: { terrain: "Electric" },
  slots: slots(act(mon("Bellossom", "Chlorophyll", { evs: { spe: 252 } }), "Nature Power", PL), idle(L("swsh", 1)), idle(L("swsh", 3)), idle(mon("Raichu", "Lightning Rod"))),
  checks: "moves.ts naturepower onTryHit: useMove(thunderbolt) at the target; the called move's redirection.",
}));
add("T2P-NAT-02", ["usum"], () => ({
  title: "Nature Power on Psychic Terrain: Psychic at the chosen foe (TP2·N1)",
  field: { terrain: "Psychic" },
  slots: slots(act(mon("Bellossom", "Chlorophyll", { evs: { spe: 252 } }), "Nature Power", PL), idle(L("usum", 1)), idle(L("usum", 3)), idle(L("usum", 2))),
  checks: "Psychic Terrain: Psychic (boosted by the terrain for a grounded user).",
}));
add("T2P-NAT-03", ["usum"], () => ({
  title: "Nature Power with no terrain: Tri Attack at the chosen foe (TP2·N1)",
  slots: slots(act(mon("Bellossom", "Chlorophyll", { evs: { spe: 252 } }), "Nature Power", PL), idle(L("usum", 1)), idle(L("usum", 3)), idle(L("usum", 2))),
  checks: "No terrain: Tri Attack (its 20% status fails under the harness rule).",
}));
add("T2P-NAT-03b", ["usum"], () => ({
  title: "A Prankster Whimsicott's Nature Power into a Dark-type Umbreon: it fails (TP2·N3)",
  slots: slots(act(mon("Whimsicott", "Prankster"), "Nature Power", PL), idle(L("usum", 1)), idle(mon("Umbreon", "Synchronize")), idle(L("usum", 3))),
  checks: "Nature Power's own Prankster check against a Dark type comes first.",
}));
add("T2P-CPY-01", ["sv"], () => ({
  title: "Copycat after a foe's Dragon Claw: Dragon Claw at a random foe, 1/2 each (TP2·CC1)",
  slots: slots(act(mon("Clefable", "Magic Guard"), "Copycat"), idle(L("sv", 1)), idle(L("sv", 2)), act(fastChomp("sv"), "Dragon Claw", OR)),
  checks: "moves.ts copycat: this.lastMove; getRandomTarget for the called move.",
}));
add("T2P-CPY-02", ["champions"], () => ({
  title: "Copycat moving first: the battle's last move before this turn (Body Slam) at a random foe (TP3·FU2, battleLastMove)",
  battleLastMove: "Body Slam",
  slots: slots(act(mon("Clefable", "Magic Guard", { evs: { spe: 32 } }), "Copycat"), idle(L("champions", 1)), idle(L("champions", 2)), idle(L("champions", 3))),
  checks: "battle.lastMove survives the turn: Copycat calls it.",
}));
add("T2P-CPY-02b", ["sv"], () => ({
  title: "Copycat moving first with the battle's last move unknown: the reason",
  notEstimated: "Copycat needs the last move used before this turn.",
  slots: slots(act(mon("Clefable", "Magic Guard", { evs: { spe: 252 } }), "Copycat"), idle(L("sv", 1)), idle(L("sv", 2)), act(L("sv", 3), "Body Slam", OL)),
  checks: "REASONS.needsLastMoveUsed.",
}));
add("T2P-CPY-03", ["sv"], () => ({
  title: "Copycat after a foe's Protect: Protect cannot be copied, Copycat fails (TP2·CC3)",
  slots: slots(act(mon("Clefable", "Magic Guard"), "Copycat"), idle(L("sv", 1)), idle(L("sv", 2)), act(L("sv", 31), "Protect")),
  checks: "failcopycat moves: Copycat fails.",
}));
add("T2P-CPY-04", ["swsh"], () => ({
  title: "Copycat after a Dragon Claw blocked by its ally's Protect: Dragon Claw copied (TP2·CC4)",
  slots: slots(act(mon("Clefable", "Magic Guard"), "Copycat"), act(L("swsh", 25), "Protect"), idle(L("swsh", 2)), act(fastChomp("swsh"), "Dragon Claw", OR)),
  checks: "lastMove is the used move even when blocked.",
}));
add("T2P-CPY-05", ["usum"], () => ({
  title: "Copycat after a fully paralysed Pokémon (cant): the move before it (TP2·CC5)",
  slots: slots(act(mon("Clefable", "Magic Guard"), "Copycat"), idle(L("usum", 1)), act(L("usum", 31, { status: "par" }), "Body Slam", OL), act(fastChomp("usum"), "Dragon Claw", OR)),
  checks: "A move stopped at BeforeMove does not become lastMove.",
}));
add("T2P-MIR-01", ["usum"], () => ({
  title: "Mirror Move after the target's Dragon Claw this turn: Dragon Claw at the target (TP2·MM1)",
  slots: slots(act(mon("Fearow", "Keen Eye"), "Mirror Move", PR), idle(L("usum", 1)), idle(L("usum", 2)), act(fastChomp("usum"), "Dragon Claw", OR)),
  checks: "moves.ts mirrormove: the target's lastMove with the mirror flag, at the target.",
}));
add("T2P-MIR-02", ["usum"], () => ({
  title: "Mirror Move before the target moves: its last move from an earlier turn (Dragon Claw, the input) (TP2·MM2)",
  slots: slots(act(mon("Fearow", "Keen Eye", { evs: { spe: 252 } }), "Mirror Move", PR), idle(L("usum", 1)), idle(L("usum", 2)), act(chomp("usum", { lastMove: "Dragon Claw" }), "Swords Dance")),
  checks: "pokemon.lastMove from the earlier turn.",
}));
add("T2P-MEF-01", ["usum"], () => ({
  title: "Me First before the target's Dragon Claw: Dragon Claw at 1.5x into it (TP2·MF1)",
  slots: slots(act(mon("Absol", "Justified", { evs: { spe: 252 } }), "Me First", PR), idle(L("usum", 1)), idle(L("usum", 2)), act(chomp("usum"), "Dragon Claw", OL)),
  checks: "moves.ts mefirst: the target's queued damaging move, onBasePower 1.5x.",
}));
add("T2P-MEF-02", ["usum"], () => ({
  title: "Me First into a status move fails; Me First into a spread Rock Slide copies it as spread (TP2·MF2)",
  slots: slots(act(mon("Absol", "Justified", { evs: { spe: 252 } }), "Me First", PR), act(mon("Absol", "Justified", { evs: { spe: 248 } }), "Me First", PL),
    act(mon("Garchomp", "Rough Skin", { evs: { spe: 4 } }), "Rock Slide"), act(chomp("usum"), "Swords Dance")),
  checks: "Me First fails for a status move; a spread move stays spread.",
}));
add("T2P-INS-01", ["sv"], () => ({
  title: "Instruct on an ally that moved this turn: its Dragon Claw again at once, the same target (TP2·I1)",
  slots: slots(act(mon("Oranguru", "Inner Focus"), "Instruct", OR), act(fastChomp("sv"), "Dragon Claw", PR), idle(L("sv", 2)), idle(L("sv", 1))),
  checks: "moves.ts instruct: prioritizeAction of the target's lastMove at lastMoveTargetLoc.",
}));
add("T2P-INS-02", ["champions"], () => ({
  title: "Instruct on a slower ally that has not moved: its Earthquake from an earlier turn again, then its own Body Slam (TP3·FU3)",
  slots: slots(act(mon("Oranguru", "Inner Focus", { evs: { spe: 32 } }), "Instruct", OR), act(L("champions", 0, { lastMove: "Earthquake", lastMoveTarget: null }), "Body Slam", PR), idle(L("champions", 2)), idle(L("champions", 1))),
  checks: "The instructed move first; the target keeps its own action after it.",
}));
add("T2P-INS-03", ["swsh"], () => ({
  title: "Instruct on a foe that used Protect: Protect again fails (consecutive); Instruct on a foe with no last move: fails (TP2·I3)",
  slots: slots(act(mon("Oranguru", "Inner Focus"), "Instruct", PR), act(mon("Oranguru", "Inner Focus", { evs: { spe: 4 } }), "Instruct", PL),
    act(L("swsh", 2), "Protect"), idle(L("swsh", 1, { lastMove: null }))),
  checks: "The instructed Protect rolls the stall counter (1/3); no lastMove: Instruct fails.",
}));
add("T2P-INS-04", ["champions"], () => ({
  title: "Instruct on an ally whose Dragon Claw knocked out its target: the instructed Dragon Claw is retargeted (TP2·I4)",
  slots: slots(act(mon("Oranguru", "Inner Focus"), "Instruct", OR), act(fastChomp("champions"), "Dragon Claw", PR), idle(L("champions", 2)), idle(L("champions", 1, { hp: 1 }))),
  checks: "A fainted target location retargets to the other foe.",
}));
add("T2P-INS-05", ["usum"], () => ({
  title: "Instruct on a slower ally that has not moved: its Dragon Claw from an earlier turn at the foe it aimed at (lastMoveTarget given)",
  slots: slots(act(mon("Oranguru", "Inner Focus", { evs: { spe: 252 } }), "Instruct", OR), act(chomp("usum", { lastMove: "Dragon Claw", lastMoveTarget: PL }), "Dragon Claw", PR),
    idle(L("usum", 2)), idle(L("usum", 1))),
  checks: "lastMoveTargetLoc from the earlier turn; then its own Dragon Claw.",
}));
// ADDENDUM2 §9's cross-family checklist: Instruct on a Pokémon with a carried Encore.
add("T2P-INS-07", ["sv"], () => ({
  title: "Instruct on an ally encored into Dragon Claw (2 turns left) that has used it this turn: its Dragon Claw again",
  slots: slots(act(mon("Oranguru", "Inner Focus"), "Instruct", OR), act(carried(fastChomp("sv", { lastMove: "Dragon Claw" }), { encore: { move: "Dragon Claw", turns: 2 } }), "Dragon Claw", PR), idle(L("sv", 2)), idle(L("sv", 1))),
  checks: "Encore limits the choice only; the instructed move is its last move.",
  outcomes: true,
}));
add("T2P-INS-06", ["sv"], () => ({
  title: "Instruct on a slower ally whose single-target last move's target is unknown: the reason",
  notEstimated: "Instruct needs the target of Garchomp's last move.",
  slots: slots(act(mon("Oranguru", "Inner Focus", { evs: { spe: 252 } }), "Instruct", OR), act(chomp("sv", { lastMove: "Dragon Claw", nature: "Brave", ivs: { spe: 0 } }), "Dragon Claw", PR),
    idle(L("sv", 2)), idle(L("sv", 1))),
  checks: "REASONS.needsLastTarget. (Integration 1b: Garchomp Brave with 0 Speed IVs, 96, so Oranguru, 112, instructs it before its move.)",
}));

// ================================ H: Sky Drop (USUM; T2P §3.16, C21; merged in 1a) ================================
add("T2P-SKD-01", ["usum"], () => ({
  title: "Sky Drop lifts a slower foe: its own Dragon Claw is lost; its partner's Dragon Claw at the user misses (TP4·SD1)",
  slots: slots(act(mon("Hawlucha", "Limber", { evs: { spe: 252 } }), "Sky Drop", PR), idle(L("usum", 1)), act(mon("Raikou", "Pressure"), "Crunch", OL), act(chomp("usum"), "Dragon Claw", OL)),
  checks: "skydrop: both semi-invulnerable; the lifted target's BeforeMove returns null.",
  outcomes: true,
}));
add("T2P-SKD-02", ["usum"], () => ({
  title: "Sky Drop into a heavy Snorlax (460 kg): it fails (TP4·SD2)",
  slots: slots(act(mon("Hawlucha", "Limber", { evs: { spe: 252 } }), "Sky Drop", PR), idle(L("usum", 1)), idle(L("usum", 2)), idle(L("usum", 3))),
  checks: "skydrop onTryHit: weight ≥ 200 kg fails.",
}));

// ================================ PR (+E2): the Pledges (SV, SwSh, USUM; T2P §3.17, TP2·PL1–PL6, TP3·FU1, TP5·E5) ================================
add("T2P-PLG-01", ["sv"], () => ({
  title: "Fire Pledge (fast) and its slow ally's Grass Pledge with a foe in between: the first waits, the second at once, Fire 150, the sea of fire on the foes (TP2·PL1)",
  slots: slots(act(mon("Charizard", "Blaze", { evs: { spe: 252 } }), "Fire Pledge", PR), act(mon("Venusaur", "Overgrow"), "Grass Pledge", PL),
    idle(L("sv", 31, { evs: { spe: 252 } })), idle(L("sv", 2))),
  checks: "firepledge onPrepareHit: the ally's Grass Pledge prioritised; 150, forced STAB, Fire; firepledge side condition 1/8 at 5.1.",
  outcomes: true,
}));
add("T2P-PLG-02", ["swsh"], () => ({
  title: "Water Pledge and Fire Pledge: Water 150, a rainbow on the user's side (TP2·PL2)",
  slots: slots(act(mon("Blastoise", "Torrent", { evs: { spe: 252 } }), "Water Pledge", PR), act(mon("Charizard", "Blaze"), "Fire Pledge", PR), idle(L("swsh", 2)), idle(L("swsh", 1))),
  checks: "waterpledge side condition on the user's side (the rainbow).",
  outcomes: true,
}));
add("T2P-PLG-03", ["usum"], () => ({
  title: "Generation 7: Grass Pledge and Water Pledge: Grass 150, a swamp on the foes; the frozen order does not re-sort (TP2·PL3)",
  slots: slots(act(mon("Venusaur", "Overgrow", { evs: { spe: 252 } }), "Grass Pledge", PR), act(mon("Blastoise", "Torrent"), "Water Pledge", PR), act(chomp("usum"), "Dragon Claw", PR), idle(L("usum", 2))),
  checks: "grasspledge side condition (Speed x0.25); gen 7 keeps the turn's order.",
  outcomes: true,
}));
add("T2P-PLG-04", ["sv"], () => ({
  title: "Grass Pledge and Water Pledge: the swamp re-sorts the foes (a 60-EV Garchomp now slower than its Snorlax ally?) (TP3·FU1)",
  slots: slots(act(mon("Venusaur", "Overgrow", { evs: { spe: 252 } }), "Grass Pledge", PR), act(mon("Blastoise", "Torrent"), "Water Pledge", PR), act(chomp("sv", { evs: { spe: 60 } }), "Dragon Claw", PR), idle(L("sv", 2))),
  checks: "Gen 8+: the queue's speeds read the swamp after it starts.",
  outcomes: true,
}));
add("T2P-PLG-05", ["sv"], () => ({
  title: "The same Pledge twice (two Fire Pledges): no combination (TP2·PL4)",
  slots: slots(act(mon("Charizard", "Blaze", { evs: { spe: 252 } }), "Fire Pledge", PR), act(mon("Cinderace", "Blaze"), "Fire Pledge", PL), idle(L("sv", 2)), idle(L("sv", 1))),
  checks: "The partner's Pledge must be a different one.",
}));
add("T2P-PLG-06", ["swsh"], () => ({
  title: "A combined Grass Pledge into a Protect: no side condition (TP2·PL6, TP5·E5)",
  slots: slots(act(mon("Charizard", "Blaze", { evs: { spe: 252 } }), "Fire Pledge", PR), act(mon("Venusaur", "Overgrow"), "Grass Pledge", PR), idle(L("swsh", 2)), act(L("swsh", 1), "Protect")),
  checks: "The side condition needs the hit.",
  outcomes: true,
}));
add("T2P-PLG-07", ["usum"], () => ({
  title: "The first Pledge user is asleep: no combination; the ally's Grass Pledge alone",
  slots: slots(act(mon("Charizard", "Blaze", { evs: { spe: 252 }, status: "slp" }), "Fire Pledge", PR), act(mon("Venusaur", "Overgrow"), "Grass Pledge", PR), idle(L("usum", 2)), idle(L("usum", 1))),
  checks: "The wait is at PrepareHit, after BeforeMove: an asleep user never reaches it.",
}));

// ================================ N: redirect ties (T2P §3.18, IN-C3, C37; merged in 1a) ================================
const rod = (species = "Raichu") => mon(species, "Lightning Rod");
add("T2P-RDT-01", ["sv"], () => ({
  title: "Two Lightning Rods at one Speed, both foes of Jolteon: the one that came in first takes its Thunderbolt (entryOrder) (TP3·RT1)",
  entryOrder: { "own-left": 1, "own-right": 2, "opponent-right": 4, "opponent-left": 3 },
  slots: slots(act(mon("Jolteon", "Volt Absorb", { evs: { spe: 252 } }), "Thunderbolt", PR), idle(L("sv", 1)), idle(rod()), idle(rod())),
  checks: "compareRedirectOrder: equal priority and Speed, the older abilityState.effectOrder first.",
}));
add("T2P-RDT-02", ["champions"], () => ({
  title: "Two Follow Me users at one Speed: the one that came in first takes the move aimed at the other (TP4·RT4b)",
  entryOrder: { "own-left": 1, "own-right": 2, "opponent-right": 3, "opponent-left": 4 },
  slots: slots(act(chomp("champions"), "Dragon Claw", PL), idle(L("champions", 1)), act(mon("Clefable", "Magic Guard"), "Follow Me"), act(mon("Clefable", "Magic Guard"), "Follow Me")),
  checks: "Two centres tie the same way.",
}));
add("T2P-RDT-03", ["usum"], () => ({
  title: "Two Storm Drain Gastrodon at one Speed: the one that came in first takes a Surf... a Scald aimed at the other",
  entryOrder: { "own-left": 1, "own-right": 2, "opponent-right": 4, "opponent-left": 3 },
  slots: slots(act(mon("Blastoise", "Torrent", { evs: { spe: 252 } }), "Scald", PR), idle(L("usum", 1)), idle(mon("Gastrodon", "Storm Drain")), idle(mon("Gastrodon", "Storm Drain"))),
  checks: "Storm Drain's redirect tie by effectOrder.",
}));
add("T2P-RDT-04", ["swsh"], () => ({
  title: "The attacker's ally Lightning Rod came in again later: the foe's Rod (now first) takes the Thunderbolt (TP4·RT5)",
  entryOrder: { "own-left": 1, "own-right": 4, "opponent-right": 2, "opponent-left": 3 },
  slots: slots(act(mon("Jolteon", "Volt Absorb", { evs: { spe: 252 } }), "Thunderbolt", PR), idle(rod()), idle(L("swsh", 2)), idle(rod())),
  checks: "A newer ability state loses the tie.",
}));
add("T2P-RDT-05", ["sv"], () => ({
  title: "Lightning Rod Raichu and Manectric at one Speed with the entry order unknown: the reason",
  notEstimated: "Lightning Rod needs whether Raichu or Pikachu came in first.",
  slots: slots(act(mon("Jolteon", "Volt Absorb", { evs: { spe: 252 } }), "Thunderbolt", PL), idle(L("sv", 1)), idle(rod()), idle(mon("Pikachu", "Lightning Rod", { evs: { spe: 156 } }))),
  checks: "REASONS.needsEntryOrder (Raichu 130 = Pikachu 130).",
}));

// ================================ ST: Trace, two acting on one, Download, Custap (T2P §4, TP3·TR, TP3·DL, TP2·CU) ================================
add("T2P-TRC-01", ["sv"], () => ({
  title: "Trace at the lead with two different foe abilities (Rough Skin, Levitate): 1/2 each; Gardevoir's Psychic then",
  startRandom: true, keepStartBoosts: true,
  slots: slots(act(mon("Gardevoir", "Trace", { evs: { spe: 252 } }), "Psychic", PL), idle(L("sv", 1)), idle(chomp("sv")), idle(mon("Hydreigon", "Levitate"))),
  checks: "abilities.ts trace onUpdate: sample over the adjacent foes (1/2); the start variants (E2 ability).",
  outcomes: true,
}));
add("T2P-TRC-02", ["usum"], () => ({
  title: "USUM: Porygon2's Trace at the lead between Rough Skin and Levitate, 1/2 each; a foe's Earthquake then",
  startRandom: true, keepStartBoosts: true,
  slots: slots(idle(mon("Porygon2", "Trace")), idle(L("usum", 1)), act(chomp("usum"), "Earthquake"), idle(mon("Hydreigon", "Levitate"))),
  checks: "A traced Levitate: Earthquake misses Porygon2 in that variant.",
  outcomes: true,
}));
add("T2P-TRC-03", ["sv"], () => ({
  title: "Trace at the lead between Intimidate Incineroar and Defiant Kingambit: copying Intimidate drops both foes and raises Kingambit +2 (TP3·TR3)",
  startRandom: true, keepStartBoosts: true,
  slots: slots(idle(mon("Gardevoir", "Trace", { nature: "Brave", ivs: { spe: 0 }, appBoosts: { atk: -1 } })), idle(L("sv", 1, { appBoosts: { atk: -1 } })),
    act(mon("Kingambit", "Defiant"), "Iron Head", OR), idle(mon("Incineroar", "Intimidate"))),
  checks: "The traced Intimidate's Start in a variant; the input's stages are before it (Incineroar's own Intimidate in them). Integration 1b (ST's ask): Gardevoir Brave with 0 Speed IVs (76) is slower than Incineroar (80), so Incineroar's lead Intimidate comes before the Trace.",
  outcomes: true,
}));
add("T2P-TRC-03b", ["sv"], () => ({
  title: "Trace at the lead faster than Intimidate Incineroar, with Defiant Kingambit: the copied Defiant meets the later Intimidate (T2P §4.1's kept reason)",
  notEstimated: "Trace copies a random foe's ability.",
  startRandom: true, keepStartBoosts: true,
  slots: slots(idle(mon("Gardevoir", "Trace", { appBoosts: { atk: -1 } })), idle(L("sv", 1, { appBoosts: { atk: -1 } })),
    act(mon("Kingambit", "Defiant"), "Iron Head", OR), idle(mon("Incineroar", "Intimidate"))),
  checks: "Gardevoir (100) before Incineroar (80): in the Defiant start Incineroar's lead Intimidate meets the copied Defiant (-1 then +2), which no input stage can also give (W1B-ST.md).",
}));
add("T2P-TRC-04", ["swsh"], () => ({
  title: "Trace copied Intimidate as it came in (given, its drops stored in the stages): not applied again",
  slots: slots(idle(mon("Gardevoir", "Trace", { boosts: { atk: -2 }, appBuild: { tracedAbility: "intimidate", copiedIntimidateStored: "incineroar,arcanine" } })), idle(L("swsh", 1, { boosts: { atk: -2 } })),
    act(mon("Incineroar", "Intimidate", { boosts: { atk: -1 } }), "Flare Blitz", OR), idle(mon("Arcanine", "Intimidate", { boosts: { atk: -1 } }))),
  checks: "Both foes hold Intimidate (Trace copies Intimidate either way); copiedIntimidateStored keeps the settle from applying it twice.",
  outcomes: true,
}));
add("T2P-TRC-05", ["champions"], () => ({
  title: "Champions: Trace at the lead between Rough Skin and Levitate: 1/2 each",
  startRandom: true, keepStartBoosts: true,
  slots: slots(act(mon("Gardevoir", "Trace", { evs: { spe: 32 } }), "Psychic", PL), idle(L("champions", 1)), idle(chomp("champions")), idle(mon("Hydreigon", "Levitate"))),
  checks: "The start variants in Champions.",
  outcomes: true,
}));
for (const [suffix, at] of [["", "right"], ["b", "left"]] as const) {
  add(`T2P-TWO-01${suffix}`, ["sv"], () => ({
    title: `Eiscue (Sitrus, 70 of 150 HP) in snow beside a Cloud Nine Golduck, the Unnerve Tyranitar at the opponent's ${at}: the Sitrus waits; a foe's Body Slam meets Ice Face`,
    field: { weather: "Snow" },
    slots: slots(idle(mon("Eiscue", "Ice Face", { item: "Sitrus Berry", hp: 70 })), idle(mon("Golduck", "Cloud Nine")),
      at === "right" ? act(L("sv", 3), "Body Slam", OL) : idle(mon("Tyranitar", "Unnerve")), at === "right" ? idle(mon("Tyranitar", "Unnerve")) : act(L("sv", 3), "Body Slam", OL)),
    checks: "Unnerve from any foe (onFoeTryEatItem) and Cloud Nine from any Pokémon at the turn's first Update (SettleReads: not only the foe across).",
  }));
}
add("T2P-TWO-02", ["usum"], () => ({
  title: "Castform (Sitrus, 70 HP) in rain with Cloud Nine and Unnerve on different foes: no Rainy form, the Sitrus waits; its Weather Ball",
  field: { weather: "Rain" },
  slots: slots(act(mon("Castform", "Forecast", { item: "Sitrus Berry", hp: 70 }), "Weather Ball", PL), idle(L("usum", 1)),
    idle(mon("Golduck", "Cloud Nine")), idle(mon("Tyranitar", "Unnerve"))),
  checks: "SettleReads: weatherNegated from Golduck, unnerved from Tyranitar.",
}));
add("T2P-DWN-01", ["sv"], () => ({
  title: "Download at the lead, slower than Dauntless Shield Zamazenta: it reads the +1 Def (TP3·DL1)",
  slots: slots(act(mon("Porygon-Z", "Download", { evs: { spe: 252 }, boosts: { spa: 1 }, appBoosts: {} }), "Tri Attack", PR), idle(L("sv", 1)),
    idle(L("sv", 2)), idle(mon("Zamazenta", "Dauntless Shield", { boosts: { def: 1 } }))),
  checks: "Download's Start after Zamazenta's (faster): Defense with the stage counted: Sp. Atk.",
}));
add("T2P-DWN-02", ["sv"], () => ({
  title: "A Choice Scarf Porygon-Z's Download, faster than Dauntless Shield: it reads Zamazenta before its +1 Def (TP4·DL4)",
  slots: slots(act(mon("Porygon-Z", "Download", { item: "Choice Scarf", nature: "Timid", evs: { spe: 252 }, boosts: { atk: 1 }, appBoosts: {} }), "Tri Attack", PR), idle(L("sv", 1)),
    idle(L("sv", 2, { evs: { def: 252, spe: 16 } })), idle(mon("Zamazenta", "Dauntless Shield", { boosts: { def: 1 } }))),
  checks: "Download first: the unboosted Defense (the Snorlax at 252 Def EVs makes it count).",
}));
add("T2P-DWN-03", ["swsh"], () => ({
  title: "Download and Dauntless Shield at one Speed at the lead: the two orders, 1/2 each (two start variants)",
  startRandom: true, keepStartBoosts: true,
  slots: slots(act(mon("Porygon-Z", "Download", { nature: "Timid", evs: { spe: 156 }, appBoosts: {} }), "Tri Attack", PR), idle(L("swsh", 1)),
    idle(L("swsh", 2, { evs: { def: 252, spe: 16 } })), idle(mon("Zamazenta", "Dauntless Shield", { ivs: { spe: 0 }, appBoosts: { def: 1 } }))),
  checks: "A Speed tie at the lead (143 each): the SwitchIn handlers' shuffle (the start variants): +1 Atk before the shield, +1 Sp. Atk after it.",
}));
add("T2P-DWN-04", ["usum"], () => ({
  title: "USUM: Download at the lead never counts an Electric Seed foe's +1 Def (the Seed comes after, priority −1)",
  field: { terrain: "Electric" },
  slots: slots(act(mon("Porygon-Z", "Download", { evs: { spe: 252 }, boosts: { atk: 1 }, appBoosts: {} }), "Tri Attack", PR), idle(L("usum", 1)),
    idle(L("usum", 2)), idle(L("usum", 3, { item: "Electric Seed", evs: { def: 100, spe: 24 }, boosts: { def: 1 }, lastItem: "Electric Seed", appBuild: { itemId: "" } }))),
  checks: "The Seed's +1 Def after Download's read.",
}));
add("T2P-CUS-01", ["sv", "swsh"], (game) => ({
  title: "A Quick Draw Slowbro-Galar at 40 HP with a Custap Berry and an attack: 30% Quick Draw (the Berry kept), else the Custap eaten (TP2·CU1)",
  slots: slots(act(mon("Slowbro-Galar", "Quick Draw", { item: "Custap Berry", hp: 40 }), "Shell Side Arm", PR), idle(L(game, 1)),
    idle(L(game, 31, { evs: { spe: 252 } })), idle(L(game, 2))),
  checks: "FractionalPriority: Quick Draw (−1) before Custap (−2), which eats only while it is at most 0.",
  outcomes: true,
}));
add("T2P-CUS-03", ["sv"], () => ({
  title: "A Mycelium Might Toedscruel at 20 HP with a Custap Berry and a status move (Spore): not eaten (TP2·CU2)",
  slots: slots(act(mon("Toedscruel", "Mycelium Might", { item: "Custap Berry", hp: 20 }), "Spore", PR), idle(L("sv", 1)),
    idle(L("sv", 31, { evs: { spe: 252 } })), idle(L("sv", 2))),
  checks: "custapberry onFractionalPriority returns early for a Mycelium Might status move.",
  outcomes: true,
}));
add("T2P-CUS-04", ["sv"], () => ({
  title: "A Mycelium Might Toedscruel at 20 HP with a Custap Berry and an attack (Earth Power): eaten (TP2·CU2b)",
  slots: slots(act(mon("Toedscruel", "Mycelium Might", { item: "Custap Berry", hp: 20 }), "Earth Power", PR), idle(L("sv", 1)),
    idle(L("sv", 31, { evs: { spe: 252 } })), idle(L("sv", 2))),
  checks: "With an attack the Custap is eaten (the holder moves first in its bracket).",
  outcomes: true,
}));

// ================================ FC: field change and activations (T2P §5.2, §5.3, TP3·FC, TP4·FC, TP3·AC) ================================
add("T2P-FLD-01", ["sv"], () => ({
  title: "Sunny Day: a Protosynthesis Great Tusk ally activates (its best stat) before its Headlong Rush (TP3·FC1)",
  slots: slots(act(mon("Torkoal", "Shell Armor", { evs: { spe: 252 } }), "Sunny Day"), act(mon("Great Tusk", "Protosynthesis"), "Headlong Rush", PR), idle(L("sv", 2)), idle(L("sv", 1))),
  checks: "WeatherChange: Protosynthesis starts with getBestStat (Attack).",
  outcomes: true,
}));
add("T2P-FLD-02", ["sv"], () => ({
  title: "Electric Terrain: a Quark Drive Iron Hands foe activates; then Ice Spinner (ally) ends the terrain after its hit: Quark Drive ends (TP3·FC2)",
  slots: slots(act(mon("Pincurchin", "Lightning Rod", { evs: { spe: 252 } }), "Electric Terrain"), act(mon("Cetitan", "Thick Fat"), "Ice Spinner", PR),
    idle(L("sv", 2)), idle(mon("Iron Hands", "Quark Drive"))),
  checks: "TerrainChange on every holder; Ice Spinner's terrain end after its hit.",
  outcomes: true,
}));
add("T2P-FLD-02b", ["sv"], () => ({
  title: "Electric Terrain from before the turn: Ice Spinner ends it; Iron Hands's Quark Drive ends (TP4·FC2b)",
  field: { terrain: "Electric" },
  slots: slots(act(mon("Cetitan", "Thick Fat", { evs: { spe: 252 } }), "Ice Spinner", PR), idle(L("sv", 1)), idle(L("sv", 2)), act(mon("Iron Hands", "Quark Drive"), "Drain Punch", OL)),
  checks: "Quark Drive from the terrain ends with it: its later Drain Punch unboosted.",
  outcomes: true,
}));
add("T2P-FLD-02c", ["sv"], () => ({
  title: "The same with Booster Energy: the Energy is used and the boost kept (TP4·FC2b)",
  field: { terrain: "Electric" },
  slots: slots(act(mon("Cetitan", "Thick Fat", { evs: { spe: 252 } }), "Ice Spinner", PR), idle(L("sv", 1)), idle(mon("Pincurchin", "Electric Surge")), act(mon("Iron Hands", "Quark Drive", { item: "Booster Energy" }), "Drain Punch", OL)),
  checks: "boosterenergy onUpdate after the field ends. (Pincurchin's Electric Surge at the lead, before the Energy's switch-in priority −2: it is still held as the turn starts.)",
  outcomes: true,
}));
add("T2P-FLD-03", ["sv"], () => ({
  title: "Drought sun with 1 turn left ends at the end of turn: Protosynthesis Great Tusk with Booster Energy keeps the boost, the Energy used (TP4·FC3b)",
  field: { weather: "Sun" }, weatherTurns: 1,
  slots: slots(idle(mon("Torkoal", "Drought")), idle(mon("Great Tusk", "Protosynthesis", { item: "Booster Energy" })), idle(L("sv", 1)), idle(L("sv", 2))),
  checks: "The sun's end at 1: Booster Energy at the next Update.",
  outcomes: true,
}));
add("T2P-FLD-03b", ["sv"], () => ({
  title: "The same without Booster Energy: the boost ends with the sun (TP4·FC3c)",
  field: { weather: "Sun" }, weatherTurns: 1,
  slots: slots(idle(mon("Torkoal", "Drought")), idle(mon("Great Tusk", "Protosynthesis")), idle(L("sv", 1)), idle(L("sv", 2))),
  checks: "Protosynthesis ends.",
  outcomes: true,
}));
add("T2P-FLD-04", ["sv"], () => ({
  title: "Grassy Terrain mid-turn: a Grassy Seed ally and an Unburden Hawlucha foe use their Seeds (+1 Def; Unburden) (TP3·FC4)",
  slots: slots(act(mon("Rillaboom", "Overgrow", { evs: { spe: 252 } }), "Grassy Terrain"), idle(L("sv", 1, { item: "Grassy Seed" })),
    idle(L("sv", 2)), idle(mon("Hawlucha", "Unburden", { item: "Grassy Seed" }))),
  checks: "The Seeds' onTerrainChange use them; Unburden doubles Hawlucha's Speed.",
  outcomes: true,
}));
add("T2P-FLD-05", ["sv"], () => ({
  title: "Snowscape mid-turn: Eiscue-Noice gets its Ice Face back (TP3·FC5)",
  slots: slots(act(mon("Abomasnow", "Soundproof", { evs: { spe: 252 } }), "Snowscape"), idle(L("sv", 1)), idle(L("sv", 2)), idle(mon("Eiscue-Noice", "Ice Face"))),
  checks: "abilities.ts iceface onWeatherChange: the Noice form back to Ice in snow.",
  outcomes: true,
}));
add("T2P-FLD-06", ["champions"], () => ({
  title: "Mimicry: Grassy Terrain mid-turn makes Stunfisk-Galar Grass type (TP3·FC6)",
  slots: slots(act(mon("Rillaboom", "Overgrow", { evs: { spe: 32 } }), "Grassy Terrain"), idle(L("champions", 1)), idle(L("champions", 3)), idle(mon("Stunfisk-Galar", "Mimicry"))),
  checks: "abilities.ts mimicry onTerrainChange: setType(Grass).",
  outcomes: true,
}));
add("T2P-FLD-07", ["champions"], () => ({
  title: "Forecast: Rain Dance mid-turn: Castform-Rainy (TP3·FC7)",
  slots: slots(act(mon("Pelipper", "Keen Eye", { evs: { spe: 32 } }), "Rain Dance"), idle(L("champions", 1)), idle(L("champions", 2)), idle(mon("Castform", "Forecast"))),
  checks: "abilities.ts forecast onWeatherChange: formeChange castformrainy.",
  outcomes: true,
}));
add("T2P-FLD-08", ["swsh"], () => ({
  title: "Flower Gift: Sunny Day mid-turn: Cherrim-Sunshine; its slower ally's physical attack at 1.5x after",
  slots: slots(act(mon("Torkoal", "White Smoke", { evs: { spe: 252 } }), "Sunny Day"), idle(L("swsh", 1)), act(L("swsh", 0), "Body Slam", OL), idle(mon("Cherrim", "Flower Gift"))),
  checks: "abilities.ts flowergift onWeatherChange: Cherrim-Sunshine; onAllyModifyAtk 1.5x.",
  outcomes: true,
}));
add("T2P-FLD-09", ["sv"], () => ({
  title: "A Cloud Nine Golduck fainting under sun: Protosynthesis Great Tusk activates then (TP4·FC12)",
  field: { weather: "Sun" },
  slots: slots(act(fastChomp("sv"), "Dragon Claw", PR), idle(mon("Great Tusk", "Protosynthesis")), idle(L("sv", 2)), idle(mon("Golduck", "Cloud Nine", { hp: 1 }))),
  checks: "Cloud Nine's End (faint) is a weather change: Protosynthesis starts.",
  outcomes: true,
}));
add("T2P-FLD-10", ["swsh"], () => ({
  title: "Dynamaxed Charizard's Max Flare sets the sun: its Flower Gift ally Cherrim becomes Cherrim-Sunshine",
  slots: slots(act(mon("Charizard", "Blaze", { evs: { spe: 252 }, choice: "dynamax" }), "Flamethrower", PR), idle(mon("Cherrim", "Flower Gift")), idle(L("swsh", 2)), idle(L("swsh", 1))),
  checks: "Max Flare's sun is a weather change: Flower Gift.",
  outcomes: true,
}));
add("T2P-FLD-11", ["usum"], () => ({
  title: "USUM Forecast: Rain Dance mid-turn: Castform-Rainy; its later Weather Ball (Water 100)",
  slots: slots(act(mon("Pelipper", "Keen Eye", { evs: { spe: 252 } }), "Rain Dance"), idle(L("usum", 1)), idle(L("usum", 2)), act(mon("Castform", "Forecast"), "Weather Ball", OL)),
  checks: "Forecast's form change, then Weather Ball in rain.",
  outcomes: true,
}));
add("T2P-ACT-01", ["sv"], () => ({
  title: "Tailwind with a Wind Power ally: Kilowattrel is charged; its later Thunderbolt at 2x (TP3·AC1)",
  slots: slots(act(mon("Talonflame", "Flame Body", { evs: { spe: 252 } }), "Tailwind"), act(mon("Kilowattrel", "Wind Power"), "Thunderbolt", PR), idle(L("sv", 2)), idle(L("sv", 1))),
  checks: "abilities.ts windpower onSideConditionStart tailwind: the charge volatile.",
}));
add("T2P-ACT-02", ["sv"], () => ({
  title: "Tailwind with a Wind Rider ally (+1 Atk); a foe's Wind Rider is not raised (TP3·AC2)",
  slots: slots(act(mon("Talonflame", "Flame Body", { evs: { spe: 252 } }), "Tailwind"), idle(mon("Brambleghast", "Wind Rider")), idle(L("sv", 2)), idle(mon("Brambleghast", "Wind Rider", { evs: { spe: 8 } }))),
  checks: "windrider onSideConditionStart: its own side only.",
  outcomes: true,
}));
add("T2P-ACT-03", ["sv"], () => ({
  title: "Trick Room with a Room Service Hawlucha foe: −1 Spe, the item used (Unburden) (TP3·AC3)",
  slots: slots(act(mon("Hatterene", "Magic Bounce"), "Trick Room"), idle(L("sv", 1)), idle(L("sv", 2)), idle(mon("Hawlucha", "Unburden", { item: "Room Service" }))),
  checks: "items.ts roomservice onAnyPseudoWeatherChange with Trick Room up.",
  outcomes: true,
}));
add("T2P-ACT-04", ["swsh"], () => ({
  title: "SwSh: Trick Room with a Room Service Snorlax foe: −1 Spe, the item used",
  slots: slots(act(mon("Hatterene", "Magic Bounce"), "Trick Room"), idle(L("swsh", 1)), idle(L("swsh", 2)), idle(L("swsh", 3, { item: "Room Service" }))),
  checks: "Room Service in SwSh.",
  outcomes: true,
}));
add("T2P-ACT-05", ["sv"], () => ({
  title: "Room Service on a Clear Body Metagross: the self drop is not blocked (TP3·AC6)",
  slots: slots(act(mon("Hatterene", "Magic Bounce"), "Trick Room"), idle(L("sv", 1)), idle(L("sv", 2)), idle(mon("Metagross", "Clear Body", { item: "Room Service" }))),
  checks: "The item's boost has the holder as its source: Clear Body ignores its own.",
  outcomes: true,
}));

// ================================ PR: the rows (T2P §6.1, TP3·RW, TP4·RW8–RW10) ================================
add("T2P-ROW-01", ["sv"], () => ({
  title: "Present into a Snorlax at 150: 40/80/120 power at 4/3/1 tenths, a quarter's heal at 2 tenths (TP3·RW1)",
  slots: slots(act(mon("Delibird", "Hustle", { evs: { spe: 252 } }), "Present", PR), idle(L("sv", 1)), idle(L("sv", 3)), idle(L("sv", 2, { hp: 150 }))),
  checks: "moves.ts present onModifyMove: random(10). (Hustle's accuracy: every move hits.)",
}));
add("T2P-ROW-02", ["swsh"], () => ({
  title: "Present into a Snorlax at 150 behind a Substitute: the heal passes it (infiltrates), the damage hits the Substitute (TP4·RW9)",
  slots: slots(act(mon("Delibird", "Hustle", { evs: { spe: 252 } }), "Present", PR), idle(L("swsh", 1)), idle(L("swsh", 3)), idle(L("swsh", 2, { hp: 150, substitute: 60 }))),
  checks: "move.infiltrates for the heal branch.",
}));
add("T2P-ROW-03", ["usum"], () => ({
  title: "Magnitude: 4–10 at 5/10/20/30/20/10/5 % (TP3·RW2)",
  slots: slots(act(mon("Dugtrio", "Arena Trap", { evs: { spe: 252 } }), "Magnitude"), idle(L("usum", 1)), idle(L("usum", 3)), idle(L("usum", 2))),
  checks: "moves.ts magnitude onModifyMove: random(100) by band (the harness enumerates the bands).",
}));
add("T2P-ROW-04", ["sv"], () => ({
  title: "Echoed Voice the turn after another's (multiplier 1 after last turn): 80 (TP3·RW4, echoedVoice 1)",
  echoedVoice: 1,
  slots: slots(act(mon("Jigglypuff", "Competitive", { evs: { spe: 252 } }), "Echoed Voice", PR), idle(L("sv", 1)), idle(L("sv", 3)), idle(L("sv", 2))),
  checks: "echoedvoice onFieldRestart: multiplier 2 this turn.",
}));
add("T2P-ROW-05", ["swsh"], () => ({
  title: "Two Echoed Voices this turn with none last turn (echoedVoice 0): both 40 (TP3·RW3)",
  echoedVoice: 0,
  slots: slots(act(mon("Jigglypuff", "Competitive", { evs: { spe: 252 } }), "Echoed Voice", PR), idle(L("swsh", 1)), idle(L("swsh", 3)), act(mon("Jigglypuff", "Competitive"), "Echoed Voice", OL)),
  checks: "The pseudo-weather starts at multiplier 1; the second use this turn does not restart it.",
}));
add("T2P-ROW-06", ["sv"], () => ({
  title: "Retaliate the turn after an ally fainted (faintedLastTurn): 140 (TP3·RW5)",
  faintedLastTurn: { own: true },
  slots: slots(act(mon("Arcanine", "Justified", { evs: { spe: 252 } }), "Retaliate", PR), idle(L("sv", 1)), idle(L("sv", 3)), idle(L("sv", 2))),
  checks: "moves.ts retaliate onBasePower: side.faintedLastTurn. (SV has no Herdier: Arcanine.)",
}));
add("T2P-ROW-07", ["usum"], () => ({
  title: "Pursuit with no switch this turn: 40 power (TP3·RW6)",
  slots: slots(act(mon("Tyranitar", "Sand Stream"), "Pursuit", PR), idle(L("usum", 1)), idle(L("usum", 3)), idle(L("usum", 2))),
  checks: "No switching target: 40. (Sand from the lead.)",
  field: { weather: "Sand" },
}));
add("T2P-ROW-08", ["swsh"], () => ({
  title: "Fury Cutter after one use in a row (furyCutter 1): 80",
  slots: slots(act(carried(mon("Scizor", "Technician", { evs: { spe: 252 } }), { furyCutter: 1 }), "Fury Cutter", PR), idle(L("swsh", 1)), idle(L("swsh", 3)), idle(L("swsh", 2))),
  checks: "moves.ts furycutter onRestart: the multiplier doubles to 2 (Technician no longer applies above 60).",
}));
add("T2P-ROW-08b", ["swsh"], () => ({
  title: "Fury Cutter after three uses in a row (furyCutter 3): the 160 cap",
  slots: slots(act(carried(mon("Scizor", "Technician", { evs: { spe: 252 } }), { furyCutter: 3 }), "Fury Cutter", PR), idle(L("swsh", 1)), idle(L("swsh", 3)), idle(L("swsh", 2))),
  checks: "The multiplier stays 4: 160.",
}));
add("T2P-ROW-09", ["usum"], () => ({
  title: "Rollout on its third hit (rollout 2) after Defense Curl: 30 x 4 x 2 = 240",
  slots: slots(act(carried(mon("Golem", "Sturdy", { evs: { spe: 252 } }), { rollout: 2, defenseCurl: true }), "Rollout", PR), idle(L("usum", 1)), idle(L("usum", 3)), idle(L("usum", 2))),
  checks: "moves.ts rollout basePowerCallback: 2^contactHitCount, x2 with defensecurl.",
}));
add("T2P-ROW-10", ["usum"], () => ({
  title: "Trump Card with 1 PP left before its use: 200 (0 after it)",
  slots: slots(act(carried(mon("Espeon", "Synchronize"), { ppLeft: { "Trump Card": 1 } }), "Trump Card", PR), idle(L("usum", 1)), idle(L("usum", 3)), idle(L("usum", 2))),
  checks: "moves.ts trumpcard: the slot's PP after the deduction.",
}));
add("T2P-ROW-10b", ["usum"], () => ({
  title: "Trump Card with 3 PP left: 60 (2 after)",
  slots: slots(act(carried(mon("Espeon", "Synchronize"), { ppLeft: { "Trump Card": 3 } }), "Trump Card", PR), idle(L("usum", 1)), idle(L("usum", 3)), idle(L("usum", 2))),
  checks: "PP 2 after the use: 60.",
}));
void PL; void evs; void slowest;

/** Wave 1b's T2P- cases. */
export const T2P_CASES: Case[] = cases;

// status2 SAT- cases (stats-abilities-transform.md §13.1; SPEC2 §7.2: Track A1's moves, wave 1a): the stat-stage,
// stored-stat, ability and Transform moves in a turn, against pinned Showdown c23d2e94. Each row runs in the games §13.1
// names, with Pokémon and moves from that game's app catalog (v1/pick.mjs); where a probe's Pokémon is missing (Shuckle in
// SV, Jolteon's moves) a stand-in with the same point is used and the checks say so. A row a game cannot build at all is left
// out with its fact (the deviations in build/W1A-V1.md). Probes: stats-abilities-transform-probes.ts (SAnn), census K-probes.
// Showdown names; level 50, 31 IVs, Serious nature, 0 EVs unless set (Champions: Stat Points). Wired into cases-se.ts.
import type { Case, CaseMon, Game } from "./case-types";
import { OL, OR, PL, PR, act, carried, idle, lax, mon, slots } from "./case-kit";

const k = (game: Game, n: number) => (game === "champions" ? n : n * 8);
const top = (game: Game) => (game === "champions" ? 32 : 252);
const cases: Case[] = [];
const add = (id: string, game: Game, c: Omit<Case, "id" | "game">) => cases.push({ id: `${id}-${game}`, game, ...c });
const lapras = (extra: Partial<CaseMon> = {}) => mon("Lapras", "Shell Armor", extra); // base Speed 60: 80
const smeargle = (extra: Partial<CaseMon> = {}) => mon("Smeargle", "Own Tempo", extra); // 75: 95

// ---- Acupressure (SA01, SA02, SA02b, K19) ----
for (const game of ["sv", "usum"] as Game[]) {
  const user = game === "sv" ? mon("Tsareena", "Leaf Guard") : mon("Medicham", "Pure Power");
  add("SAT-ACU-1", game, {
    title: "Acupressure on the ally Snorlax: one stat +2, 1/7 each; the Speed world re-sorts the rest of the turn from generation 8 (SA01)", outcomes: true,
    slots: slots(act(user, "Acupressure", OR), act(lax(0), "Body Slam", PL), act(lapras(), "Body Slam", OR), idle(lax(8))),
    checks: "moves.ts acupressure samples the stats below +6; with +2 Speed Snorlax (100) moves before Lapras (80) in SV (sim/battle.ts:2919-2926), not in USUM.",
  });
}
for (const game of ["sv", "champions"] as Game[]) {
  const user = game === "sv" ? mon("Barraskewda", "Propeller Tail") : mon("Medicham", "Pure Power", { nature: "Jolly", evs: { spe: 32 } });
  add("SAT-ACU-2", game, {
    title: "Acupressure on the ally Espathra, then its Stored Power into Snorlax (SA02): accuracy and evasion count", outcomes: true,
    slots: slots(act(user, "Acupressure", OR), act(mon("Espathra", "Opportunist"), "Stored Power", PL), idle(lax(k(game, 2))), idle(lax(k(game, 1)))),
    checks: "Stored Power counts positive stages including accuracy and evasion (sim/pokemon.ts positiveBoosts): 20 → 60 power on any pick.",
  });
}
for (const game of ["sv", "swsh"] as Game[]) {
  add("SAT-ACU-3", game, {
    title: "Contrary Malamar at +6 Atk uses Acupressure on itself: six stats, −2 each (SA02b)", outcomes: true,
    slots: slots(act(mon("Malamar", "Contrary", { boosts: { atk: 6 } }), "Acupressure", OL), idle(lax(0)), idle(lax(16)), idle(lax(8))),
    checks: "Acupressure picks among the stats below +6 before Contrary inverts the +2: six picks of −2.",
  });
}
for (const game of ["sv", "champions"] as Game[]) {
  const user = game === "sv" ? mon("Tsareena", "Leaf Guard") : mon("Tsareena", "Leaf Guard");
  add("SAT-ACU-4", game, {
    title: "Acupressure on the ally behind a Substitute (K19)", outcomes: true,
    slots: slots(act(user, "Acupressure", OR), idle(lax(0, { substitute: 50 })), idle(lax(k(game, 2))), idle(lax(k(game, 1)))),
    checks: "K19: Acupressure on an ally with a Substitute.",
  });
  // SAT-ACU-4b (the ally fainted: Acupressure falls on its user) is not built: the app input cannot aim a move at an
  // empty slot (doubles-targets.ts lists the present slots only), so that turn is an input issue there by design.
}

// ---- Psych Up (SA03, SA03b) ----
add("SAT-PSY-1", "sv", {
  title: "Alcremie (White Herb) Psych Up on a protecting Kingambit (+2 Atk, −2 Def, +1 evasion); Espathra (Opportunist) beside it: no copy (SA03)", outcomes: true,
  slots: slots(act(mon("Alcremie", "Sweet Veil", { item: "White Herb", evs: { spe: 252 } }), "Psych Up", PR), idle(lax(0)),
    idle(mon("Espathra", "Opportunist")), act(carried(mon("Kingambit", "Defiant", { boosts: { atk: 2, def: -2 } }), { stages: { evasion: 1 } }), "Protect")),
  checks: "Psych Up has no protect flag: it copies every stage directly (no boost event: no Opportunist copy); White Herb restores the copied Def drop at AfterMove.",
});
add("SAT-PSY-1", "champions", {
  title: "Champions: the same Psych Up with no White Herb", outcomes: true,
  slots: slots(act(mon("Alcremie", "Sweet Veil", { evs: { spe: 32 } }), "Psych Up", PR), idle(lax(0)),
    idle(mon("Espathra", "Opportunist")), act(carried(mon("Kingambit", "Defiant", { boosts: { atk: 2, def: -2 } }), { stages: { evasion: 1 } }), "Protect")),
  checks: "The copied −2 Def stays (no White Herb).",
});
for (const game of ["sv", "usum"] as Game[]) {
  const target = game === "sv" ? mon("Kingambit", "Defiant", { boosts: { def: 2 }, substitute: 40 }) : mon("Bisharp", "Defiant", { boosts: { def: 2 }, substitute: 40 });
  add("SAT-PSY-2", game, {
    title: "Psych Up into a Substitute holder at +2 Def; then a foe's Body Slam into the user reads the copied +2 Def (SA03b)", outcomes: true,
    slots: slots(act(smeargle({ evs: { spe: 252 } }), "Psych Up", PR), idle(lax(0)), act(lax(8), "Body Slam", OL), idle(target)),
    checks: "Psych Up bypasses a Substitute; the copied Def +2 is read by the later hit.",
  });
}

// ---- The swaps (SA04, SA04b, SA04c, SA04d) ----
for (const game of ["sv", "usum"] as Game[]) {
  const gambit = (extra: Partial<CaseMon>) => (game === "sv" ? mon("Kingambit", "Defiant", extra) : mon("Bisharp", "Defiant", extra));
  add("SAT-SWP-1", game, {
    title: "Smeargle's Heart Swap into a protecting Kingambit (+2 Atk): blocked (SA04)", outcomes: true,
    slots: slots(act(smeargle({ evs: { spe: 252 } }), "Heart Swap", PR), idle(lax(0)), idle(lax(16)), act(gambit({ boosts: { atk: 2 } }), "Protect")),
    checks: "Heart Swap has the protect flag (SV, USUM): blocked.",
  });
}
add("SAT-SWP-1b", "sv", {
  title: "Smeargle (White Herb) Heart Swaps with Kingambit (−2 Atk, +2 Sp. Atk, +1 accuracy); Espathra (Opportunist) beside Kingambit: no copy (SA04b)", outcomes: true,
  slots: slots(act(smeargle({ item: "White Herb", evs: { spe: 252 } }), "Heart Swap", PR), idle(lax(0)), idle(mon("Espathra", "Opportunist")),
    idle(carried(mon("Kingambit", "Defiant", { boosts: { atk: -2, spa: 2 } }), { stages: { accuracy: 1 } }))),
  checks: "A direct swap of all seven stages; White Herb restores the user's received drop; no Opportunist copy of the received rise.",
});
for (const game of ["champions", "sv"] as Game[]) {
  add("SAT-SWP-2", game, {
    title: "Farigiraf's Guard Swap with Snorlax (+2 Def, +1 Sp. Def); then Lapras's Body Slam into Snorlax (SA04d)", outcomes: true,
    slots: slots(act(mon("Farigiraf", "Armor Tail", { evs: { spe: top(game) } }), "Guard Swap", PR), act(game === "champions" ? lax(k(game, 3)) : lapras(), "Body Slam", PR), idle(lax(k(game, 2))), idle(lax(k(game, 1), { boosts: { def: 2, spd: 1 } }))),
    checks: "Guard Swap swaps Def and Sp. Def stages: Snorlax at 0 when Body Slam hits; Farigiraf +2 / +1.",
  });
}
add("SAT-SWP-3", "sv", {
  title: "Espeon (+2 Atk) Power Swaps with Snorlax; then Snorlax's Body Slam reads its swapped +2 Atk", outcomes: true,
  slots: slots(act(mon("Espeon", "Synchronize", { boosts: { atk: 2 } }), "Power Swap", PR), idle(lax(0)), idle(lax(16)), act(lax(8), "Body Slam", OL)),
  checks: "Power Swap swaps Atk and Sp. Atk stages; the target's later attack reads +2.",
});
add("SAT-SWP-3", "swsh", {
  title: "SwSh: Alakazam (+2 Atk) Power Swaps with Snorlax; then Snorlax's Body Slam reads its swapped +2 Atk", outcomes: true,
  slots: slots(act(mon("Alakazam", "Inner Focus", { boosts: { atk: 2 } }), "Power Swap", PR), idle(lax(0)), idle(lax(16)), act(lax(8), "Body Slam", OL)),
  checks: "The same in SwSh.",
});
add("SAT-SWP-4", "sv", {
  title: "Smeargle (Eject Pack) Heart Swaps with Kingambit (−2 Atk): the received drop sets off no Eject Pack (SA04c)", outcomes: true,
  slots: slots(act(smeargle({ item: "Eject Pack", evs: { spe: 252 } }), "Heart Swap", PR), idle(lax(0)), idle(lax(16)), idle(mon("Kingambit", "Defiant", { boosts: { atk: -2 } }))),
  checks: "A direct stage write: no Eject Pack switch.",
});
for (const game of ["sv", "usum"] as Game[]) {
  add("SAT-SPD-1", game, {
    title: "Smeargle (95) Speed Swaps with a faster Garchomp (122); Garchomp's Dragon Claw then waits for a slower Lapras in SV (K10)", outcomes: true,
    slots: slots(act(smeargle({ evs: { spe: 252 } }), "Speed Swap", PR), act(lapras({ evs: { spe: 120 } }), "Body Slam", PL), idle(lax(0)), act(mon("Garchomp", "Rough Skin", { nature: "Brave" }), "Dragon Claw", OR)),
    checks: "Speed Swap swaps stored Speed (storedStats.spe); gen 8+ re-sorts the queue (Garchomp now slower than Lapras), USUM keeps the order.",
  });
}

// ---- The splits (SA06, SA06b, K12) ----
for (const game of ["sv", "champions"] as Game[]) {
  const user = game === "sv" ? mon("Indeedee-F", "Own Tempo") : mon("Indeedee-F", "Own Tempo");
  for (const [suffix, room] of [["", false], ["b", true]] as const) {
    add(`SAT-SPL-1${suffix}`, game, {
      title: `Indeedee's Guard Split with Snorlax; then Lapras's Body Slam into Snorlax${room ? " under Wonder Room" : ""} (K12, SA06)`, outcomes: true,
      ...(room ? { field: { wonderRoom: true } } : {}),
      slots: slots(act(user, "Guard Split", PR), act(game === "champions" ? lax(k(game, 3)) : lapras(), "Body Slam", PR), idle(lax(k(game, 2))), idle(lax(k(game, 1)))),
      checks: "Guard Split averages stored Def and Sp. Def; Wonder Room then swaps which one Body Slam reads (SA06's order).",
    });
  }
}
for (const game of ["sv", "swsh"] as Game[]) {
  add("SAT-SPL-2", game, {
    title: "Hypno's Power Split with Snorlax; then Umbreon's Foul Play into Snorlax reads the averaged Attack (SA06b)", outcomes: true,
    slots: slots(act(game === "sv" ? mon("Hypno", "Insomnia") : mon("Claydol", "Levitate"), "Power Split", PR), act(mon("Umbreon", "Synchronize"), "Foul Play", PR), idle(lax(16)), idle(lax(8))),
    checks: "Foul Play uses the target's (split) Attack.",
  });
}
for (const [suffix, split] of [["", true], ["b", false]] as const) {
  add(`SAT-SPL-3${suffix}`, "usum", {
    title: `USUM: Chandelure ${split ? "Power Splits with" : "idles beside"} the foe Nihilego (Beast Boost); Nihilego's Sludge Bomb then knocks out a Snorlax at 1 HP`,
    outcomes: true,
    slots: slots(split ? act(mon("Chandelure", "Flash Fire"), "Power Split", PR) : idle(mon("Chandelure", "Flash Fire")), idle(lax(0, { hp: 1 })),
      idle(lax(16)), act(mon("Nihilego", "Beast Boost", { nature: "Brave", ivs: { spe: 0 } }), "Sludge Bomb", OR)),
    checks: split ? "The split Sp. Atk (156) beats Sp. Def (151): Beast Boost raises Sp. Atk (the first best stat)." : "The control: Sp. Def (151) is Nihilego's best: +1 Sp. Def.",
  });
}

// ---- Power Trick (K11, SA07) ----
for (const game of ["sv", "champions"] as Game[]) {
  add("SAT-TRK-1", game, {
    title: "Forretress's Power Trick; then a foe's Body Slam into it reads its swapped Defense (K11)", outcomes: true,
    slots: slots(act(mon("Forretress", "Sturdy"), "Power Trick"), idle(lax(0)), act(lax(k(game, 2)), "Body Slam", OL), idle(lax(k(game, 1)))),
    checks: "Power Trick swaps stored Atk and Def: the hit reads the old Attack as Defense.",
  });
  add("SAT-TRK-1b", game, {
    title: "Forretress with Power Trick from an earlier turn uses it again: it toggles off (SA07)", outcomes: true,
    slots: slots(act(carried(mon("Forretress", "Sturdy"), { powerTrick: true }), "Power Trick"), idle(lax(0)), act(lax(k(game, 2)), "Body Slam", OL), idle(lax(k(game, 1)))),
    checks: "powertrick onRestart: removes the volatile, swapping back.",
  });
}

// ---- Topsy-Turvy (SA08, K14) ----
for (const game of ["sv", "usum"] as Game[]) {
  const target = (game === "sv" ? mon("Kingambit", "Defiant", { item: "White Herb", boosts: { atk: 2, def: -2 } }) : mon("Bisharp", "Defiant", { item: "White Herb", boosts: { atk: 2, def: -2 } }));
  add("SAT-TOP-1", game, {
    title: "Malamar's Topsy-Turvy on a White Herb Kingambit (+2 Atk, −2 Def): White Herb restores the new drop; Defiant does not react (SA08, K14)", outcomes: true,
    slots: slots(act(mon("Malamar", "Contrary", { evs: { spe: 252 } }), "Topsy-Turvy", PR), idle(lax(0)), idle(lax(16)), idle(target)),
    checks: "Topsy-Turvy inverts directly (no boost event): no Defiant; White Herb at AfterMove restores the −2 Atk.",
  });
}

// ---- Stockpile, Swallow, Spit Up (SA09, SA09b, C1, C17) ----
for (const game of ["sv", "champions"] as Game[]) {
  const user = (extra: Partial<CaseMon>) => (game === "sv" ? mon("Swalot", "Liquid Ooze", extra) : mon("Swalot", "Liquid Ooze", extra));
  add("SAT-STK-1", game, {
    title: "Swalot with 2 layers (+2/+2, counts −2/−2) Stockpiles a third", outcomes: true,
    slots: slots(act(carried(user({ boosts: { def: 2, spd: 2 } }), { stockpile: { layers: 2, def: -2, spd: -2 } }), "Stockpile"), idle(lax(0)), idle(lax(k(game, 2))), idle(lax(k(game, 1)))),
    checks: "stockpile onRestart: layers 3, +1/+1 (counts −3/−3).",
  });
  add("SAT-STK-1b", game, {
    title: "Swalot with 3 layers Stockpiles again: it fails", outcomes: true,
    slots: slots(act(carried(user({ boosts: { def: 3, spd: 3 } }), { stockpile: { layers: 3, def: -3, spd: -3 } }), "Stockpile"), idle(lax(0)), idle(lax(k(game, 2))), idle(lax(k(game, 1)))),
    checks: "onRestart returns false at 3 layers.",
  });
}
for (const game of ["sv", "usum"] as Game[]) {
  for (const layers of [1, 2, 3] as const) {
    add(`SAT-STK-2${"abc"[layers - 1]}`, game, {
      title: `Swalot at 60 HP with ${layers} Stockpile layer${layers > 1 ? "s" : ""} uses Swallow`, outcomes: true,
      slots: slots(act(carried(mon("Swalot", "Liquid Ooze", { hp: 60, boosts: { def: layers, spd: layers } }), { stockpile: { layers, def: -layers, spd: -layers } }), "Swallow"), idle(lax(0)), idle(lax(16)), idle(lax(8))),
      checks: "swallow heals 1/4, 1/2, all for 1, 2, 3 layers; the End lowers by the counts.",
    });
  }
  add("SAT-STK-2d", game, {
    title: "Swalot at +6 Def with one layer (its Def count 0, Sp. Def −1) uses Swallow at 60 HP (SA09b)", outcomes: true,
    slots: slots(act(carried(mon("Swalot", "Liquid Ooze", { hp: 60, boosts: { def: 6, spd: 1 } }), { stockpile: { layers: 1, def: 0, spd: -1 } }), "Swallow"), idle(lax(0)), idle(lax(16)), idle(lax(8))),
    checks: "SA09b: the End lowers only Sp. Def (its Def count is 0).",
  });
  add("SAT-STK-2e", game, {
    title: "Swalot at full HP with one layer uses Swallow: no heal, the Stockpile still ends", outcomes: true,
    slots: slots(act(carried(mon("Swalot", "Liquid Ooze", { boosts: { def: 1, spd: 1 } }), { stockpile: { layers: 1, def: -1, spd: -1 } }), "Swallow"), idle(lax(0)), idle(lax(16)), idle(lax(8))),
    checks: "swallow onTry at full HP: the heal fails; its End still runs (oracle decides).",
  });
}
add("SAT-STK-2f", "usum", {
  title: "USUM: Absol (1 layer of its own, 100 HP) Snatches Swalot's Swallow (2 layers, 100 HP): it heals by its own layer and loses its Stockpile (C1)", outcomes: true,
  slots: slots(act(carried(mon("Absol", "Pressure", { evs: { spe: 252 }, hp: 100, boosts: { def: 1, spd: 1 } }), { stockpile: { layers: 1, def: -1, spd: -1 } }), "Snatch"), idle(lax(0)),
    idle(lax(8)), act(carried(mon("Swalot", "Sticky Hold", { hp: 100, boosts: { def: 2, spd: 2 } }), { stockpile: { layers: 2, def: -2, spd: -2 } }), "Swallow")),
  checks: "C1: the snatched Swallow heals 1/4 (Absol's one layer) and ends Absol's Stockpile; Swalot keeps its two.",
});
for (const game of ["sv", "swsh"] as Game[]) {
  const user = (extra: Partial<CaseMon>) => (game === "sv" ? mon("Swalot", "Liquid Ooze", extra) : mon("Cradily", "Suction Cups", extra));
  add("SAT-STK-3", game, {
    title: "Spit Up with 3 layers into Snorlax, then the drops (SA09)", outcomes: true,
    slots: slots(act(carried(user({ boosts: { def: 3, spd: 3 } }), { stockpile: { layers: 3, def: -3, spd: -3 } }), "Spit Up", PL), idle(lax(0)), idle(lax(16)), idle(lax(8))),
    checks: "300 power; the End lowers Def and Sp. Def by 3.",
  });
  add("SAT-STK-3b", game, {
    title: "Spit Up with no Stockpile: it fails", outcomes: true,
    slots: slots(act(user({}), "Spit Up", PL), idle(lax(0)), idle(lax(16)), idle(lax(8))),
    checks: "spitup onTry: no stockpile volatile, fails.",
  });
}

// ---- Stuff Cheeks (K29, SA10, SA10b) ----
for (const game of ["sv", "champions"] as Game[]) {
  const user = (extra: Partial<CaseMon>) => (game === "sv" ? mon("Greedent", "Cheek Pouch", extra) : mon("Swalot", "Gluttony", extra));
  add("SAT-CHK-1", game, {
    title: "Stuff Cheeks with a Sitrus Berry at 100 HP (K29)", outcomes: true,
    slots: slots(act(user({ item: "Sitrus Berry", hp: 100 }), "Stuff Cheeks"), idle(lax(0)), idle(lax(k(game, 2))), idle(lax(k(game, 1)))),
    checks: "The forced eat (Sitrus) then +2 Def.",
  });
  add("SAT-CHK-1b", game, {
    title: "Stuff Cheeks at +6 Def with a Sitrus Berry (SA10)", outcomes: true,
    slots: slots(act(user({ item: "Sitrus Berry", hp: 100, boosts: { def: 6 } }), "Stuff Cheeks"), idle(lax(0)), idle(lax(k(game, 2))), idle(lax(k(game, 1)))),
    checks: "SA10: at +6 Def the move still eats the Berry (oracle decides the boost line).",
  });
  add("SAT-CHK-1c", game, {
    title: "Stuff Cheeks with a Sitrus Berry under a foe's Unnerve (SA10b)", outcomes: true,
    slots: slots(act(user({ item: "Sitrus Berry", hp: 100 }), "Stuff Cheeks"), idle(lax(0)), idle(mon("Tyranitar", "Unnerve")), idle(lax(k(game, 1)))),
    checks: "SA10b: Unnerve stops the eat: Stuff Cheeks fails.",
  });
}

// ---- Tidy Up (K24) ----
for (const game of ["sv", "champions"] as Game[]) {
  add("SAT-TID-1", game, {
    title: "Maushold's Tidy Up removes a foe's carried Substitute; then its ally's Body Slam lands on the foe (K24)", outcomes: true,
    slots: slots(act(mon("Maushold", "Technician", { evs: { spe: top(game) } }), "Tidy Up"), act(lax(0), "Body Slam", PR), idle(lax(k(game, 2))), idle(lax(k(game, 1), { substitute: 50 }))),
    checks: "tidyup removes every Substitute: the Body Slam hits the Pokémon.",
  });
}

// ---- No Retreat (SA12) ----
for (const game of ["sv", "swsh"] as Game[]) {
  add("SAT-NRT-1", game, {
    title: "Falinks's No Retreat: +1 to all five, trapped (SA12)", outcomes: true,
    slots: slots(act(mon("Falinks", "Battle Armor"), "No Retreat"), idle(lax(0)), idle(lax(16)), idle(lax(8))),
    checks: "noretreat: boosts and the noretreat volatile.",
  });
  add("SAT-NRT-1b", game, {
    title: "Falinks with No Retreat from an earlier turn uses it again: it fails (SA12)", outcomes: true,
    slots: slots(act(carried(mon("Falinks", "Battle Armor", { boosts: { atk: 1, def: 1, spa: 1, spd: 1, spe: 1 } }), { noRetreat: true }), "No Retreat"), idle(lax(0)), idle(lax(16)), idle(lax(8))),
    checks: "noretreat onTry: fails with the volatile.",
  });
  add("SAT-NRT-2", game, {
    title: "A faster foe's Block on Falinks earlier this turn, then Falinks's No Retreat: the boosts, no volatile", outcomes: true,
    slots: slots(act(mon("Falinks", "Battle Armor"), "No Retreat"), idle(lax(0)), act(game === "sv" ? mon("Bronzong", "Levitate", { evs: { spe: 252 } }) : mon("Aegislash", "Stance Change", { evs: { spe: 252 } }), "Block", OL), idle(lax(8))),
    checks: "No Retreat on a trapped user: boosts, but no noretreat volatile (onTry passes only without trapped? the oracle decides).",
  });
}

// ---- Autotomize, Minimize (K18, SA13) ----
for (const game of ["swsh", "usum"] as Game[]) {
  add("SAT-AUT-1", game, {
    title: "Aggron's Autotomize (−100 kg); then a foe's Low Kick into it (K18)", outcomes: true,
    slots: slots(act(mon("Aggron", "Sturdy", { evs: { spe: 252 } }), "Autotomize"), idle(lax(0)), act(mon("Audino", "Healer"), "Low Kick", OL), idle(lax(8))),
    checks: "weighthg −1000: Low Kick's power from the new weight.",
  });
}
for (const game of ["sv", "champions"] as Game[]) {
  add("SAT-MIN-1", game, {
    title: "Chandelure Minimizes behind Reflect; then a foe's Body Slam into it ×2 (SA13)", outcomes: true,
    field: { own: { reflect: true } },
    slots: slots(act(mon("Chandelure", "Flash Fire", { evs: { spe: top(game) } }), "Minimize"), idle(lax(0)), act(lax(k(game, 2)), "Body Slam", OL), idle(lax(k(game, 1)))),
    checks: "SA13: Minimize ×2 (onSourceModifyDamage) chained with Reflect; Body Slam never misses a Minimized target.",
  });
}
for (const game of ["sv", "usum"] as Game[]) {
  for (const [suffix, move, user] of [["", "Stomp", game === "sv" ? mon("Camerupt", "Solid Rock") : mon("Camerupt", "Solid Rock")], ["b", "Heavy Slam", game === "sv" ? mon("Appletun", "Thick Fat") : mon("Aggron", "Sturdy")]] as [string, string, CaseMon][]) {
    add(`SAT-MIN-2${suffix}`, game, {
      title: `${move} into a Pokémon Minimized on an earlier turn`, outcomes: true,
      slots: slots(act(user, move, PR), idle(lax(40)), idle(lax(16)), idle(carried(lax(8, { appBuild: {} }), { minimize: true, stages: { evasion: 2 } }))),
      checks: "minimize condition: Stomp and Heavy Slam ×2 into it (gen 7+), and never miss.",
    });
  }
}

// ---- Geomancy (K21) ----
for (const game of ["swsh", "usum"] as Game[]) {
  add("SAT-GEO-1", game, {
    title: "Xerneas's Geomancy with Power Herb: released at once (K21)", outcomes: true,
    slots: slots(act(mon("Xerneas", "Fairy Aura", { item: "Power Herb" }), "Geomancy"), idle(lax(0)), idle(lax(16)), idle(lax(8))),
    checks: "Power Herb skips the charge: +2 Sp. Atk, Sp. Def, Speed; the Herb is used.",
  });
  add("SAT-GEO-1b", game, {
    title: "Xerneas's Geomancy without Power Herb: the charge turn", outcomes: true,
    slots: slots(act(mon("Xerneas", "Fairy Aura"), "Geomancy"), idle(lax(0)), idle(lax(16)), idle(lax(8))),
    checks: "The charge: twoturnmove + geomancy, no boost this turn.",
  });
  add("SAT-GEO-1c", game, {
    title: "Xerneas's Geomancy charged last turn released", outcomes: true,
    slots: slots(act(carried(mon("Xerneas", "Fairy Aura"), { charging: "geomancy" }), "Geomancy"), idle(lax(0)), idle(lax(16)), idle(lax(8))),
    checks: "The release (C38).",
  });
}

// ---- Gear Up, Magnetic Flux (Plus / Minus) ----
for (const game of ["swsh", "usum"] as Game[]) {
  add("SAT-PLM-1", game, {
    title: "Klinklang's Gear Up with a Plus ally (Klinklang itself Plus)", outcomes: true,
    slots: slots(act(mon("Klinklang", "Plus"), "Gear Up"), idle(mon("Klinklang", "Minus", { evs: { spe: 8 } })), idle(lax(16)), idle(lax(8))),
    checks: "gearup raises Atk and Sp. Atk of every Plus / Minus holder on the side.",
  });
}
for (const game of ["sv", "champions"] as Game[]) {
  add("SAT-PLM-1b", game, {
    title: "Ampharos's Magnetic Flux with a Plus ally", outcomes: true,
    slots: slots(act(mon("Ampharos", "Plus"), "Magnetic Flux"), idle(game === "sv" ? mon("Magnezone", "Sturdy") : mon("Toxtricity-Low-Key", "Minus")), idle(lax(k(game, 2))), idle(lax(k(game, 1)))),
    checks: "magneticflux raises Def and Sp. Def of Plus / Minus holders.",
  });
}

// ---- Flower Shield, Rototiller (K22, K23) ----
for (const game of ["swsh", "usum"] as Game[]) {
  add("SAT-FLS-1", game, {
    title: "Comfey's Flower Shield: every Grass type on both sides +1 Def (K22)", outcomes: true,
    slots: slots(act(mon("Comfey", "Natural Cure"), "Flower Shield"), idle(mon("Venusaur", "Overgrow")), idle(lax(16)), idle(mon("Tangrowth", "Chlorophyll"))),
    checks: "flowershield: field-wide, Grass types only.",
  });
}
add("SAT-ROT-1", "usum", {
  title: "USUM: Diggersby's Rototiller: grounded Grass types +1 Atk and Sp. Atk (K23)", outcomes: true,
  slots: slots(act(mon("Diggersby", "Huge Power"), "Rototiller"), idle(mon("Venusaur", "Overgrow")), idle(lax(16)), idle(mon("Tangrowth", "Chlorophyll"))),
  checks: "rototiller: grounded Grass types on both sides.",
});
add("SAT-ROT-1b", "usum", {
  title: "USUM: Rototiller with a second Grass-type target (a Flying Grass type is not raised)", outcomes: true,
  slots: slots(act(mon("Diggersby", "Huge Power"), "Rototiller"), idle(mon("Venusaur", "Overgrow")), idle(lax(16)), idle(mon("Tropius", "Chlorophyll"))),
  checks: "rototiller skips an ungrounded Grass type.",
});

// ---- Skill Swap (K5, SA14, SA14b, SA14c, SA14e, SA14f, Q2, SA21) ----
for (const game of ["sv", "usum"] as Game[]) {
  add("SAT-SKS-1", game, {
    title: "Skill Swap with a Levitate Bronzong: the user floats, then a foe's Earthquake misses it (K5)", outcomes: true,
    slots: slots(act(mon("Hypno", "Insomnia", { evs: { spe: 252 } }), "Skill Swap", PR), idle(lax(0)), act(mon("Garchomp", "Rough Skin", { nature: "Brave" }), "Earthquake"), idle(mon("Bronzong", "Levitate"))),
    checks: "Skill Swap moves Levitate: Hypno is immune to Earthquake, Bronzong is not (Insomnia).",
  });
  add("SAT-SKS-2", game, {
    title: "Meowstic (Prankster) Skill Swaps with Snorlax; Snorlax's Yawn then gets Prankster's priority (SA14)", outcomes: true,
    slots: slots(act(mon("Meowstic", "Prankster"), "Skill Swap", PR), idle(lapras()), idle(lax(0)), act(lax(8), "Yawn", OR)),
    checks: "The order is decided at the start (priority read when the action is queued) or re-read (gen 8+): the oracle decides.",
  });
}
for (const game of ["sv", "champions"] as Game[]) {
  add("SAT-SKS-3", game, {
    title: "Skill Swap with the ally Gardevoir (Trace, its trace done): the user gets Trace, which copies a random foe's ability (Intimidate or Thick Fat), 1/2 each (SA14b)", outcomes: true,
    slots: slots(act(mon("Espeon", "Synchronize", { evs: { spe: top(game) } }), "Skill Swap", OR), idle(mon("Gardevoir", "Synchronize", { appBuild: {} })), idle(mon("Gyarados", "Intimidate")), idle(lax(k(game, 1)))),
    checks: "SA14b: Trace's Start on the new holder samples the foes: Intimidate (its drop) or Thick Fat.",
  });
}
for (const game of ["sv", "swsh"] as Game[]) {
  add("SAT-SKS-4", game, {
    title: "Skill Swap takes the ally Arcanine's active Flash Fire; its Flamethrower then has no boost (SA14c)", outcomes: true,
    slots: slots(act(mon("Espeon", "Synchronize", { evs: { spe: 252 } }), "Skill Swap", OR), act(mon("Arcanine", "Flash Fire", { appBuild: { abilityActive: true } }), "Flamethrower", PL), idle(lax(0)), idle(lax(8))),
    checks: "SA14c: the flashfire volatile ends with the ability (its End).",
  });
}
add("SAT-SKS-5", "sv", {
  title: "Skill Swap into a Snorlax holding Ability Shield: it fails (SA14e)", outcomes: true,
  slots: slots(act(mon("Espeon", "Synchronize", { evs: { spe: 252 } }), "Skill Swap", PR), idle(lax(0)), idle(lax(16)), idle(lax(8, { item: "Ability Shield" }))),
  checks: "abilityshield onSetAbility: Skill Swap fails.",
});
for (const game of ["sv", "usum"] as Game[]) {
  add("SAT-SKS-6", game, {
    title: "Hypno (Insomnia) Skill Swaps with its sleeping ally Snorlax: Snorlax wakes and uses Body Slam (SA14f)", outcomes: true,
    slots: slots(act(mon("Hypno", "Insomnia", { evs: { spe: 252 } }), "Skill Swap", OR), act(lax(0, { status: "slp" }), "Body Slam", PL), idle(lax(16)), idle(lax(8))),
    checks: "Insomnia's Start (Update) cures the sleep before Snorlax's BeforeMove.",
  });
}
for (const game of ["sv", "champions"] as Game[]) {
  add("SAT-SKS-7", game, {
    title: "An Intimidate Pokémon Skill Swaps with a foe: the foe's new Intimidate drops the user's side (Q2)", outcomes: true,
    slots: slots(act(mon("Wyrdeer", "Intimidate", { evs: { spe: top(game) } }), "Skill Swap", PR), idle(lax(0)), idle(lax(k(game, 2))), idle(lax(k(game, 1)))),
    checks: "Skill Swap with Intimidate: the target's Start (Intimidate) lowers both of the user's side; the user gains Thick Fat.",
  });
}
for (const game of ["sv", "usum"] as Game[]) {
  add("SAT-SKS-8", game, {
    title: "Skill Swap with the ally Porygon2 gives the user Download, facing a Snorlax at +6 Def (SA21)", outcomes: true,
    slots: slots(act(mon("Espeon", "Synchronize", { evs: { spe: 252 } }), "Skill Swap", OR), idle(mon("Porygon2", "Download", { boosts: { atk: 1 }, appBoosts: {} })), idle(lax(16, { boosts: { def: 6 } })), idle(lax(8))),
    checks: "Download's Start on the new holder compares the foes' Def and Sp. Def (Wonder Room aside).",
  });
}

// ---- Role Play (SA15, K9b) ----
for (const game of ["sv", "usum"] as Game[]) {
  add("SAT-RPL-1", game, {
    title: "Role Play copies a protecting Gyarados's Intimidate (through Protect): its drop on the foes (SA15)", outcomes: true,
    slots: slots(act(game === "sv" ? mon("Hypno", "Insomnia", { evs: { spe: 252 } }) : mon("Alakazam", "Inner Focus"), "Role Play", PR), idle(lax(0)), idle(lax(16)), act(mon("Gyarados", "Intimidate"), "Protect")),
    checks: "Role Play has no protect flag: the user takes Intimidate, whose Start lowers both foes.",
  });
}
for (const game of ["sv", "champions"] as Game[]) {
  add("SAT-RPL-2", game, {
    title: "Role Play copies the ally Espathra's Speed Boost: the end of turn raises the user's Speed (K9b)", outcomes: true,
    slots: slots(act(mon("Delphox", "Blaze", { evs: { spe: top(game) } }), "Role Play", OR), idle(mon("Espathra", "Speed Boost")), idle(lax(k(game, 2))), idle(lax(k(game, 1)))),
    checks: "Speed Boost at residual 28.2 (activeTurns): both Delphox and Espathra +1 Speed.",
  });
}

// ---- Entrainment (SA27, K6): no Intimidate holder learns Entrainment in SV or USUM (v1/pick.mjs), so the Intimidate comes
// from a Skill Swap of the Intimidate holder (its Start acts the same way: abilities.ts intimidate onStart). ----
for (const game of ["sv", "usum"] as Game[]) {
  const swapper = game === "sv" ? mon("Wyrdeer", "Intimidate", { evs: { spe: 252 } }) : mon("Stantler", "Intimidate", { evs: { spe: 252 } });
  for (const [suffix, ally] of [["", mon("Lucario", "Inner Focus")], ["b", mon("Sudowoodo", "Rattled")], ...(game === "sv" ? [["c", mon("Mabosstiff", "Guard Dog")]] : [])] as [string, CaseMon][]) {
    add(`SAT-ENT-1${suffix}`, game, {
      title: `A foe given Intimidate mid-turn (Skill Swap) lowers the swapper's ally ${ally.species} (${ally.ability}) (SA27, K6)`, outcomes: true,
      slots: slots(act(swapper, "Skill Swap", PR), idle(ally), idle(lax(16)), idle(lax(8))),
      checks: "SA27: Intimidate's gen-gated reactions: Inner Focus blocks (gen 8+), Rattled +1 Speed (gen 8+), Guard Dog +1 Atk.",
    });
  }
}

// ---- Simple Beam (K8, SA16) ----
// Champions: no Pokémon there has Simple, so the app's data has no Simple (doubles-abilities.ts changeAbility: A1's reason);
// pinned Showdown's Champions mod still runs it (results/ keeps that oracle).
const noSimple = (game: Game) => (game === "champions" ? { notEstimated: "Simple Beam giving Simple is not modelled in 2v2." } : {});
for (const game of ["sv", "champions"] as Game[]) {
  add("SAT-SBM-1", game, {
    ...noSimple(game),
    title: "Simple Beam on the ally, which then uses Swords Dance: +4 (K8)", outcomes: true,
    slots: slots(act(game === "sv" ? mon("Grumpig", "Thick Fat", { evs: { spe: 252 } }) : mon("Sirfetch’d", "Steadfast", { evs: { spe: 32 } }), "Simple Beam", OR), act(mon("Garchomp", "Rough Skin", { nature: "Brave" }), "Swords Dance"), idle(lax(k(game, 2))), idle(lax(k(game, 1)))),
    checks: "simplebeam then Swords Dance: +2 doubled by Simple.",
  });
  add("SAT-SBM-1b", game, {
    ...noSimple(game),
    title: "Simple Beam into an Unnerve Tyranitar: Unnerve ends, so the user's Sitrus at 60 HP is eaten (SA16)", outcomes: true,
    slots: slots(act(game === "sv" ? mon("Grumpig", "Thick Fat", { evs: { spe: 252 }, item: "Sitrus Berry", hp: 60 }) : mon("Sirfetch’d", "Steadfast", { evs: { spe: 32 }, item: "Sitrus Berry", hp: 60 }), "Simple Beam", PR), idle(lax(0)), idle(lax(k(game, 2))), idle(mon("Tyranitar", "Unnerve"))),
    checks: "SA16: Unnerve's End: the Berry's Update eats it (+1/4).",
  });
}

// ---- Worry Seed (Q2b, K9c) ----
for (const game of ["sv", "usum"] as Game[]) {
  add("SAT-WSD-1", game, {
    title: "Worry Seed on a sleeping foe: it wakes (Insomnia); then Breloom's Spore into it fails (Q2b, K9c)", outcomes: true,
    slots: slots(act(mon("Comfey", "Natural Cure", { evs: { spe: 252 } }), "Worry Seed", PR), act(mon("Breloom", "Technician"), "Spore", PR), idle(lax(0)), idle(lax(8, { status: "slp" }))),
    checks: "Insomnia's Start cures the sleep; Spore then fails on an Insomnia holder.",
  });
}

// ---- Gastro Acid (K7, SA17) ----
for (const game of ["sv", "usum"] as Game[]) {
  add("SAT-GAS-1", game, {
    title: "Gastro Acid on a Levitate Bronzong, then its foe's Earthquake hits it (K7)", outcomes: true,
    slots: slots(act(game === "sv" ? mon("Arbok", "Shed Skin", { evs: { spe: 252 } }) : mon("Arbok", "Shed Skin", { evs: { spe: 252 } }), "Gastro Acid", PR), act(mon("Garchomp", "Rough Skin", { nature: "Brave" }), "Earthquake"), idle(lax(0)), idle(mon("Bronzong", "Levitate"))),
    checks: "Gastro Acid suppresses Levitate: Earthquake hits Bronzong.",
  });
  add("SAT-GAS-1b", game, {
    title: "Gastro Acid on Golduck (Cloud Nine) in rain: the rain counts again for Lapras's later Water Pulse (SA17)", outcomes: true,
    field: { weather: "Rain" },
    slots: slots(act(mon("Arbok", "Shed Skin", { evs: { spe: 252 } }), "Gastro Acid", PR), act(lapras(), "Water Pulse", PL), idle(lax(0)), idle(mon("Golduck", "Cloud Nine"))),
    checks: "Cloud Nine's End: the weather's effects return mid-turn.",
  });
}

// ---- Doodle (K9) ----
add("SAT-DDL-1", "sv", {
  title: "Grafaiai's Doodle on a foe Gyarados: Grafaiai and its ally get Intimidate (K9)", outcomes: true,
  slots: slots(act(mon("Grafaiai", "Prankster"), "Doodle", PR), idle(lax(0)), idle(lax(16)), idle(mon("Gyarados", "Intimidate"))),
  checks: "Doodle copies the target's ability onto the user and its ally: both Intimidates start (each lowers the foes).",
});

// ---- Transform (K13, SA19, SA19b, SA19c, SA19d, SA19e) ----
for (const game of ["sv", "champions"] as Game[]) {
  add("SAT-TRF-1", game, {
    title: "Ditto Transforms into Snorlax (+2 Def); then a foe's Body Slam into Ditto reads +2 Def and Snorlax's weight (K13, SA19c)", outcomes: true,
    slots: slots(act(mon("Ditto", "Limber", { evs: { spe: top(game) } }), "Transform", PR), idle(lax(0)), act(lax(k(game, 2)), "Body Slam", OL), idle(lax(k(game, 1), { boosts: { def: 2 }, moves: ["Body Slam"] }))),
    checks: "transformInto copies the stages and the weight (weighthg 4600).",
  });
}
for (const game of ["sv", "usum"] as Game[]) {
  add("SAT-TRF-2", game, {
    title: "Ditto Transforms into Gyarados (Intimidate): it copies Intimidate (no Start) and the types; a foe's High Horsepower into Ditto (SA19)", outcomes: true,
    slots: slots(act(mon("Ditto", "Limber", { evs: { spe: 252 } }), "Transform", PR), idle(lax(0)), act(game === "sv" ? lax(16) : lax(16), "High Horsepower", OL), idle(mon("Gyarados", "Intimidate", { moves: ["Waterfall"] }))),
    checks: "SA19: the copied ability does not start (setAbility isTransform); Water/Flying: High Horsepower immune.",
  });
}
for (const game of ["sv", "swsh"] as Game[]) {
  add("SAT-TRF-3", game, {
    title: "Ditto's Transform into a Snorlax behind a Substitute fails (SA19b)", outcomes: true,
    slots: slots(act(mon("Ditto", "Limber", { evs: { spe: 252 } }), "Transform", PR), idle(lax(0)), idle(lax(16)), idle(lax(8, { substitute: 50, moves: ["Body Slam"] }))),
    checks: "transformInto fails on a Substitute.",
  });
  add("SAT-TRF-3b", game, {
    title: "A level 100 Ditto Transforms into a level 50 Snorlax: the stats are Snorlax's, the HP its own (SA19d)", outcomes: true,
    slots: slots(act(mon("Ditto", "Limber", { level: 100, evs: { spe: 252 } }), "Transform", PR), idle(lax(0)), idle(lax(16)), idle(lax(8, { moves: ["Body Slam"] }))),
    checks: "Transform copies the stored stats (not HP, not level).",
  });
}
add("SAT-TRF-4", "sv", {
  title: "Snorlax Terastallizes (Ghost) this turn; Ditto then Transforms into it; a foe's Low Kick into Ditto (SA19e)", outcomes: true,
  slots: slots(act(mon("Ditto", "Limber"), "Transform", PR), idle(lax(0)), act(mon("Beartic", "Swift Swim", { nature: "Brave", ivs: { spe: 0 } }), "Low Kick", OL), { ...lax(8, { teraType: "Ghost", choice: "terastallize", moves: ["Body Slam"] }), action: { move: null } }),
  checks: "SA19e: a Terastallized target: the copied types (the oracle decides Ghost vs Normal for Low Kick).",
});

// ---- Imposter at the start (Q8) ----
for (const game of ["sv", "swsh"] as Game[]) {
  add("SAT-IMP-1", game, {
    title: "Ditto (Imposter) transformed into the foe across as it came in; a foe's Body Slam into it", outcomes: true,
    slots: slots(idle(mon("Ditto", "Imposter", { appBuild: { abilityActive: true } })), idle(lax(0)), act(lax(16), "Body Slam", OL), idle(mon("Garchomp", "Rough Skin", { moves: ["Dragon Claw"] }))),
    checks: "Q8: transformed into the foe across (Garchomp) at the lead; the Body Slam hits a Garchomp.",
  });
}

/** SPEC2's SAT- cases. */
export const SAT_CASES: Case[] = cases;
void OL; void PL;

// status2 wave 1b (Track V2): the critic's cases of ADDENDUM2 §7.2 gated at integration 1b (PR): CQ-ECV-01 (CQ02), CQ-BID-01…04
// (CQ10a–d, C41), CQ-PUR-01/02 (C30), CQ-CMD-01 (C27). Probes: critic2-probes-1.ts. Showdown names; level 50, 31 IVs,
// Serious nature, 0 EVs unless set. Wired into cases-se.ts through cases-wave1b.ts.
import type { Case, Game } from "./case-types";
import { OL, OR, PL, PR, act, carried, idle, mon, slots } from "./case-kit";
import { L, fastEvs } from "./case-kit2";

const cases: Case[] = [];
const add = (id: string, games: Game[], make: (game: Game) => Omit<Case, "id" | "game">) => {
  for (const game of games) cases.push({ id: `${id}-${game}`, game, ...make(game) });
};

add("CQ-ECV-01", ["sv", "swsh"], (game) => ({
  title: "Echoed Voice used last turn (echoedVoice 1); two Echoed Voices this turn: both 80 (CQ02 turn 2)",
  echoedVoice: 1,
  slots: slots(act(mon("Jigglypuff", "Competitive", { evs: fastEvs(game) }), "Echoed Voice", PR), act(mon("Blissey", "Natural Cure"), "Echoed Voice", PR), idle(L(game, 1)), idle(L(game, 2))),
  checks: "C25: the restart sets duration 2 and the multiplier 2 once; the second use this turn keeps it.",
}));
// ---- Bide from earlier turns (C41, CQ10) ----
const bider = (stored: number, source: "opponent-right" | "opponent-left", release = true) => carried(L("usum", 1), { bide: { stored, source, release } });
add("CQ-BID-01", ["usum"], () => ({
  title: "A Bide releases (50 stored from the foe Snorlax): 100 to it (CQ10a)",
  slots: slots(act(bider(50, PR), "Bide"), idle(L("usum", 2)), idle(L("usum", 4)), idle(L("usum", 3))),
  checks: "bide onBeforeMove at duration 1: tryMoveHit for 2 × totalDamage at lastDamageSource.",
}));
add("CQ-BID-02", ["usum"], () => ({
  title: "A Bide releases at a Gengar that stored it: Normal into Ghost: immune (CQ10b)",
  slots: slots(act(bider(50, PR), "Bide"), idle(L("usum", 2)), idle(L("usum", 4)), idle(mon("Gengar", "Cursed Body"))),
  checks: "The release's move data has no ignoreImmunity: -immune.",
}));
add("CQ-BID-03", ["usum"], () => ({
  title: "A Bide releases into its source's Protect: Protect does not block it (CQ10c)",
  slots: slots(act(bider(50, PR), "Bide"), idle(L("usum", 2)), idle(L("usum", 4)), act(L("usum", 3), "Protect")),
  checks: "tryMoveHit skips the protect step: 100 through Protect.",
}));
add("CQ-BID-04", ["usum"], () => ({
  title: "A faster foe's Quick Attack into the Bider before its release adds to the store and becomes the target (168?) (CQ10d)",
  slots: slots(act(bider(50, PR), "Bide"), idle(L("usum", 2)), idle(L("usum", 4)), act(mon("Absol", "Justified", { evs: { spe: 252 } }), "Quick Attack", OL)),
  checks: "bide onDamage: totalDamage += damage, lastDamageSource the Quick Attack user (both priority 1: the faster first).",
}));
add("CQ-BID-05", ["usum"], () => ({
  title: "A Bide that stores this turn (not its release): nothing happens; a foe's Body Slam into it is stored",
  slots: slots(act(bider(30, PR, false), "Bide"), idle(L("usum", 2)), idle(L("usum", 4)), act(L("usum", 3), "Body Slam", OL)),
  checks: "bide at duration 2: '-activate' and nothing more; onDamage stores the Body Slam.",
}));
// ---- Pursuit (C30) ----
add("CQ-PUR-01", ["usum"], () => ({
  title: "Pursuit facing a foe that switched in this turn: the reason (it would have hit the leaving Pokémon) (C30)",
  notEstimated: "Pursuit with a Pokémon that switched in this turn is not modelled in 2v2.",
  slots: slots(act(mon("Houndoom", "Flash Fire"), "Pursuit", PR), idle(L("usum", 1)), idle(L("usum", 3)), { ...L("usum", 2), action: { move: null, switchIn: true } }),
  checks: "REASONS.combo(\"Pursuit\", \"a Pokémon that switched in this turn\").",
}));
add("CQ-PUR-02", ["usum"], () => ({
  title: "Pursuit with no switch this turn: 40 power into a Snorlax (C30 control)",
  slots: slots(act(mon("Houndoom", "Flash Fire"), "Pursuit", PR), idle(L("usum", 1)), idle(L("usum", 3)), idle(L("usum", 2))),
  checks: "No switching target: 40.",
}));
// ---- Commander and the invulnerability order (C27) ----
const tatsu = () => mon("Tatsugiri", "Commander", { evs: { spe: 252 } });
const dozo = () => mon("Dondozo", "Unaware", { boosts: { atk: 2, def: 2, spa: 2, spd: 2, spe: 2 } });
add("CQ-CMD-01", ["sv"], () => ({
  title: "A No Guard Golurk's Dynamic Punch at the commanding Tatsugiri: still missed (commanding before the Invulnerability event) (C27)",
  slots: slots(idle(tatsu()), idle(dozo()), idle(L("sv", 1)), act(mon("Golurk", "No Guard"), "Dynamic Punch", OL)),
  checks: "battle-actions.ts:621-633: commanding misses before No Guard's Invulnerability answer.",
}));
void OR; void PL;

/** Wave 1b's CQ- cases. */
export const CQ_1B_CASES: Case[] = cases;

# Integration 1b (ADDENDUM2 §2.4): the REASONS keys whose last site went in wave 1b and the sets whose members 1b modelled.
from patchlib import rep, read
A = "doubles-actions.ts"
rep(A, """/** Moves the 2v2 turn does not model at all (SPEC §2.2 presence rows): `{Move} is not modelled in 2v2.` Flame Burst's splash damage (status-eot C17). */
export const PRESENCE_MOVES: ReadonlySet<string> = new Set([
  "spotlight", "round", "beakblast", "shelltrap", "beatup", "fusionbolt", "fusionflare", "counter", "mirrorcoat", "metalburst", "comeuppance", "flameburst",
]);

""", "", "PRESENCE_MOVES")
text, _ = read(A)
start = text.index("/**\n * G-Max moves' effects beyond MAX_MOVE_EFFECTS")
end = text.index("};\n", text.index("export const GMAX_EFFECTS", start)) + 3
rep(A, text[start:end], "", "GMAX_EFFECTS")
rep(A, """/** G-Max moves whose status is random (data/moves.ts gmaxbefuddle, gmaxstunshock). */
export const RANDOM_STATUS_MAX_MOVES: ReadonlySet<string> = new Set(["G-Max Befuddle", "G-Max Stun Shock"]);
""", "", "RANDOM_STATUS_MAX_MOVES")
rep(A, """  // Neutralizing Gas from the turn's start (calculate.ts settleDoublesStart's DoublesGas); its end is guarded (doubles-turn.ts gasEnds).
  "neutralizinggas",
]);

/** Third-party handlers guarded wherever the Pokémon is in the turn (presence): `{Ability or item} is not modelled in 2v2.` and the SPEC's own texts. */
export const PRESENCE_THIRD_PARTY: ReadonlySet<string> = new Set([
  "poisonpuppeteer", "imposter",
]);

/** Abilities a knockout reacts with that the turn does not follow (onSourceAfterFaint, onAllyFaint): guarded when one happens with a later action. */
export const FAINT_REACTIONS: ReadonlySet<string> = new Set(["receiver", "powerofalchemy"]);

/**
 * Third-party handlers guarded when they act (events): Flower Veil and Pastel Veil keeping a foe's drop or status of a
 * damaging move off their side (veilGuard; a status move's are modelled, doubles-status.ts canStatus and applyBoosts),
 * Aftermath and Innards Out as their holder is knocked out, Dancer on a dance move, Commander with Dondozo on its side,
 * Room Service as Trick Room starts, the faint reactions the turn does not follow, and Pickup at the end of the turn
 * (doubles-eot.ts).
 */
export const EVENT_THIRD_PARTY: ReadonlySet<string> = new Set([
  "flowerveil", "pastelveil", "aftermath", "innardsout", "dancer", "commander", "roomservice", ...FAINT_REACTIONS, "battlebond",
  "symbiosis", "mirrorherb", "opportunist", "cottondown", "ejectpack", "ejectbutton", "redcard", "emergencyexit", "wimpout", "pickup",
]);

/** Every third-party handler the engine does not follow: guarded, by presence or as an event. */
export const GUARDED_THIRD_PARTY: ReadonlySet<string> = new Set([...PRESENCE_THIRD_PARTY, ...EVENT_THIRD_PARTY]);""",
 """  // Neutralizing Gas from the turn's start (calculate.ts settleDoublesStart's DoublesGas); its end is guarded (doubles-turn.ts gasEnds).
  "neutralizinggas",
  // status2 wave 1b (ADDENDUM2 §2.4): K's reactions (doubles-reactions.ts: Flower Veil and Pastel Veil against a damaging
  // move's added effect, Aftermath, Innards Out, Cotton Down, Battle Bond, Receiver and Power of Alchemy at a faint), PR's
  // presence (doubles-presence.ts: Dancer, Commander, Poison Puppeteer), ST's start (doubles-start.ts: Imposter, a start copy's
  // Opportunist and Mirror Herb, which D models in the turn), FC's Room Service as a pseudo-weather starts
  // (doubles-fieldchange.ts), and Pickup at the end of the turn (doubles-eot.ts, with item history).
  "flowerveil", "pastelveil", "aftermath", "innardsout", "cottondown", "battlebond", "receiver", "powerofalchemy",
  "dancer", "commander", "poisonpuppeteer", "imposter", "opportunist", "mirrorherb", "roomservice", "pickup",
]);

/**
 * Third-party handlers guarded when they act (events): the switch family as its holder would leave with a later action
 * (Eject Pack, Eject Button, Red Card, Emergency Exit, Wimp Out: doubles-switch.ts, wave 2), and Symbiosis passing its item
 * on but after a Fling (doubles-guards.ts symbiosisPass; its other guards: symbiosisAfterAction, symbiosisReceived,
 * symbiosisEndOfTurn).
 */
export const EVENT_THIRD_PARTY: ReadonlySet<string> = new Set([
  "symbiosis", "ejectpack", "ejectbutton", "redcard", "emergencyexit", "wimpout",
]);

/** Every third-party handler the engine does not follow: guarded as an event (status2 integration 1b: no presence one is left). */
export const GUARDED_THIRD_PARTY: ReadonlySet<string> = new Set([...EVENT_THIRD_PARTY]);""", "third party")
rep(A, """  /** Pain Split. */
  withDynamax: (move: string) => `${move} with a Dynamaxed Pokémon is not modelled in 2v2.`,
  /** An intact Disguise or Ice Face against a confusion self-hit. */
  /** Berserk or Anger Shell""", """  /** Berserk or Anger Shell""", "withDynamax")
rep(A, """  /** A target's Starf, Ganlon or Apicot Berry (or Lansat with Cheek Pouch) eaten at the Update between two hits of one move. */
  berryBetweenHits: (item: string, move: string) => `${item} between the hits of ${move} is not modelled in 2v2.`,
  /** Sparkling Aria's burn cure when its user faints in the move with a Life Orb (the faint's timing decides it). */
  landing: (move: string) => `${move} landing is not modelled in 2v2.`,
  formChange: (ability: string, name: string) => `${ability} changing ${name}'s form is not modelled in 2v2.`,
  overTime: (move: string) => `${move}'s damage over time is not modelled in 2v2.`,""", """  /** A form change at the end of turn the turn does not follow (Power Construct, where its maximum HP changes: E2), or a hidden one (H). */
  formChange: (ability: string, name: string) => `${ability} changing ${name}'s form is not modelled in 2v2.`,""", "berry/landing/overTime")
rep(A, """  maxGuard: "Max Guard is not modelled.",
""", "", "maxGuard")
rep(A, """  activates: (move: string, name: string) => `${move} would activate ${name}.`,
  randomStatus: (move: string) => `${move}'s random status is not modelled in 2v2.`,
  pledges: (move: string, other: string) => `${move} with ${other} is not modelled in 2v2.`,
""", "", "activates/randomStatus/pledges")
rep(A, """  /** A3, SV: a Protosynthesis or Quark Drive holder of Booster Energy whose field is down when Magic Room ends (FC takes it over in 1b). */
  boosterAfterRoom: "Booster Energy after Magic Room ends is not modelled in 2v2.",
""", "", "boosterAfterRoom")
P = "doubles-presence.ts"
rep(P, 'import { ABSORBING, DANCE_MOVES, PLEDGE_MOVES, PRESENCE_MOVES, PRESENCE_THIRD_PARTY, REASONS, REDIRECT_ABILITIES } from "./doubles-actions";',
 'import { ABSORBING, DANCE_MOVES, PLEDGE_MOVES, REASONS, REDIRECT_ABILITIES } from "./doubles-actions";', "presence import")
rep(P, """/** A presence third party on the field (PRESENCE_THIRD_PARTY): Poison Puppeteer is modelled (afterSetStatus); Imposter is the settle's. */
export function thirdPartyGuard(kernel: TurnKernel, w: World, slot: DoublesSlotId) {
  const build = w.mons[slot]!.build;
  for (const id of [build.abilityId, build.itemId]) {
    if (!id || !PRESENCE_THIRD_PARTY.has(id) || id === "imposter" || id === "poisonpuppeteer") continue;
    const name = kernel.runtime.abilitiesById.get(id)?.name ?? kernel.itemName(id);
    kernel.notEstimated(REASONS.notIn2v2(name));
  }
}""", """/**
 * A presence third party on the field: none is left (status2 integration 1b emptied PRESENCE_THIRD_PARTY: Poison Puppeteer is
 * modelled, afterSetStatus; Imposter is the settle's, doubles-start.ts). Kept as the hook presenceGuards names.
 */
export function thirdPartyGuard(kernel: TurnKernel, w: World, slot: DoublesSlotId) {
  void kernel; void w; void slot;
}""", "thirdPartyGuard")
rep(P, """/** The presence moves not modelled yet: Spotlight (the status pipeline's centre), the Counter family (a fixed hit of the damage taken). */
const KEPT_MOVES: ReadonlySet<string> = new Set([]);

/** The presence moves (PRESENCE_MOVES): the kept ones are not estimated, with their name. */
export function movesGuard(kernel: TurnKernel, w: World, slot: DoublesSlotId, move: ChampionsMove) {
  void w; void slot;
  if (PRESENCE_MOVES.has(move.id) && KEPT_MOVES.has(move.id)) kernel.notEstimated(REASONS.notIn2v2(move.name));
}""", """/**
 * The presence moves (Spotlight, Round, Beak Blast, Shell Trap, Beat Up, Fusion Bolt and Flare, the Counter family, Flame
 * Burst): every one is modelled (status2 integration 1b emptied PRESENCE_MOVES). Kept as the hook presenceGuards names.
 */
export function movesGuard(kernel: TurnKernel, w: World, slot: DoublesSlotId, move: ChampionsMove) {
  void kernel; void w; void slot; void move;
}""", "movesGuard")
S = "tests/source/doubles-status-moves.test.ts"
rep(S, 'import { GMAX_EFFECTS, HP_STATUS_MOVES, MODELLED_STATUS_MOVES, NO_EFFECT_MOVES } from "../../app/lib/battle/doubles-actions";',
 'import { HP_STATUS_MOVES, MODELLED_STATUS_MOVES, NO_EFFECT_MOVES } from "../../app/lib/battle/doubles-actions";', "source import")
rep(S, """  it("has G-Max Tartness lower each foe's evasion (doubles-actions.ts GMAX_EFFECTS)", () => {
    const tartness = facts.sword_shield.moves.gmaxtartness as DexMove & { self?: { onHit?: unknown } };
    expect(String(tartness.self?.onHit)).toMatch(/for \\(const pokemon of source\\.foes\\(\\)\\)[\\s\\S]*this\\.boost\\(\\{ evasion: -1 \\}, pokemon\\)/);
    expect(GMAX_EFFECTS["G-Max Tartness"]).toEqual({ foeStages: { evasion: -1 } });
  });""", """  it("has G-Max Tartness lower each foe's evasion (doubles-max.ts maxEffects)", () => {
    const tartness = facts.sword_shield.moves.gmaxtartness as DexMove & { self?: { onHit?: unknown } };
    expect(String(tartness.self?.onHit)).toMatch(/for \\(const pokemon of source\\.foes\\(\\)\\)[\\s\\S]*this\\.boost\\(\\{ evasion: -1 \\}, pokemon\\)/);
    const max = readFileSync(new URL("../../app/lib/battle/doubles-max.ts", import.meta.url), "utf8");
    expect(max).toContain('const stages = id === "gmaxfoamburst" ? { spe: -2 } : { evasion: -1 };');
  });""", "Tartness test")
T = "tests/source/doubles-third-party.test.ts"
rep(T, """    // Flower Veil and Pastel Veil are modelled against status moves (doubles-status.ts canStatus, applyBoosts) and stay
    // guarded against a damaging move's added effect (doubles-turn.ts veilGuard); Pickup acts at the end of turn (E2).
    for (const id of ["flowerveil", "pastelveil", "pickup"]) expect(GUARDED_THIRD_PARTY.has(id), id).toBe(true);""",
 """    // Flower Veil and Pastel Veil are modelled against status moves (doubles-status.ts canStatus, applyBoosts) and, since
    // status2 wave 1b, against a damaging move's added effect (doubles-reactions.ts veil); Pickup acts at the end of turn
    // (doubles-eot.ts). The switch family stays guarded until wave 2's replacement (doubles-switch.ts).
    for (const id of ["flowerveil", "pastelveil", "pickup"]) expect(MODELLED_THIRD_PARTY.has(id), id).toBe(true);
    for (const id of ["ejectpack", "ejectbutton", "redcard", "emergencyexit", "wimpout"]) expect(GUARDED_THIRD_PARTY.has(id), id).toBe(true);""", "third-party test")

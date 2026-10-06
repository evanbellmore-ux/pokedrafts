// SPEC 10.6 value weights (tunable; the shape stays), plus addendum A1.5's Mega terms. ai/value.ts re-exports them.

export const DEFAULT_WEIGHTS = {
  alive: 0.35, win: 10,
  worthBase: 0.6, worthOffense: 0.8, worthBulk: 0.3, worthMin: 0.5, worthMax: 1.7, unknownWorth: 1,
  speed: 0.6, speedDecay: 0.7, speedHorizon: 3, benchSpeedShare: 0.5,
  field: 0.15,
  burnPhysical: 0.25, burnSpecial: 0.05, paralysis: 0.15, sleepPerTurn: 0.2, freeze: 0.3, poison: 0.08, toxic: 0.12,
  confusion: 0.08, taunt: 0.05, encore: 0.12, yawn: 0.15, leechSeed: 0.06, perishSong: 0.4, substitute: 0.1,
  offenseStage: 0.3, defenseStage: 0.2, stageDecay: 0.7,
  focusSash: 0.12, berry: 0.04, protectStreak: 0.03, hazard: 0.04,
  /**
   * A Choice item's holder still in its slot after using a status or protecting move is locked into it (PS/data/conditions.ts:324-363):
   * × worth × u for its side (scripts/.cache/training/review-ai/choice-scan.mjs: Choice Scarf users repeating Will-O-Wisp).
   */
  choiceLock: 0.3,
  /**
   * SPEC 10.6 megaAvailable (0.1 there), lowered for A1.5: with Mega Evolution decided every turn it is the flexibility of
   * choosing which of two or more holders Mega Evolves (ai/value.ts megaTerms), beside the option value below; a flat 0.1
   * outweighed most turns' own Mega effects (provider-probe: a +0.1 gain Mega lost to keeping it by 0.12 on a neutral turn).
   */
  megaAvailable: 0.03,
  /**
   * A1.5 lasting value: × the Mega form's matchup gain over the base form against the other side's known and believed
   * remaining team (ai/mega.ts), for a Pokémon that Mega Evolved this turn and is still standing.
   */
  megaLasting: 0.35,
  /** A1.5 option value of keeping it: × the best gain among the side's living Mega-capable members × their chance to still use it. */
  megaOption: 0.2,
  /** A1.5: Mega Evolution shows the stone, the form, its types and ability. */
  megaReveal: 0.02,
  /** A1.5 matchup parts (ai/mega.ts): the Speed relation's share, and a weather or terrain ability's field effect. */
  megaSpeed: 0.15, megaField: 0.1,
} as const;
export type Weights = { -readonly [K in keyof typeof DEFAULT_WEIGHTS]: number };

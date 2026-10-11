// Shared case shape for the 2v2 validation harness (sim-dfs.ts runs it in pinned Showdown c23d2e94, app-turn.ts in the app).
// Run everything from the repo root: npx --no-install tsx scripts/.cache/calc-audit/2v2/verify/<file>.ts

export type Game = "sv" | "swsh" | "usum" | "champions";
export type SlotId = "own-left" | "own-right" | "opponent-left" | "opponent-right";
export const SLOTS: readonly SlotId[] = ["own-left", "own-right", "opponent-left", "opponent-right"];
export type Stat = "hp" | "atk" | "def" | "spa" | "spd" | "spe";
export type Boostable = "atk" | "def" | "spa" | "spd" | "spe";

/** One Pokémon. Names are Showdown names; the app ids are their toID (or `appSpecies`). */
export type CaseMon = {
  species: string;
  /** The app's species id when it differs from toID(species): a Mega form chosen before the turn (Showdown Mega Evolves on the turn). */
  appSpecies?: string;
  ability: string;
  item?: string;
  nature?: string;
  /** Native games: EVs. Champions: Stat Points (pinned data/mods/champions/scripts.ts statModify). */
  evs?: Partial<Record<Stat, number>>;
  ivs?: Partial<Record<Stat, number>>;
  level?: number;
  gender?: "M" | "F" | "";
  /** Current HP before the turn (after entry effects). */
  hp?: number;
  status?: "par" | "brn" | "psn" | "tox" | "slp" | "frz";
  /** Stat stages before the turn, after entry effects (Intimidate included: sim-dfs checks Showdown agrees). */
  boosts?: Partial<Record<Boostable, number>>;
  teraType?: string;
  /** The turn's mechanic: Showdown's choice suffix; the app's build mechanic, Mega form or Z context. */
  choice?: "mega" | "terastallize" | "dynamax" | "zmove";
  /** It used Charge on an earlier turn (Showdown: the charge volatile). */
  charged?: boolean;
  /** The app's other build fields this case needs (abilityActive, tracedAbility, configuration...). */
  appBuild?: Record<string, unknown>;
  /** An empty slot: the app input is null; Showdown faints it before the turn (probe 1c). */
  absent?: boolean;
};

/** A slot's action: move null is "No move" (Showdown: Splash, SPEC C13). target: the slot it aims at when the move takes one. */
export type CaseAction = {
  move: string | null;
  target?: SlotId;
  /** The app's MoveContext for this move (hits, useZ, fainted, timesHit, doubled...). */
  context?: Record<string, unknown>;
};

export type CaseSide = { tailwind?: boolean; reflect?: boolean; lightScreen?: boolean; auroraVeil?: boolean };
export type CaseField = {
  weather?: "" | "Sun" | "Rain" | "Sand" | "Snow" | "Hail" | "Harsh Sunshine" | "Heavy Rain" | "Strong Winds";
  terrain?: "" | "Electric" | "Grassy" | "Misty" | "Psychic";
  trickRoom?: boolean; gravity?: boolean; wonderRoom?: boolean; magicRoom?: boolean;
  /** Every damaging hit is critical (the field toggle). */
  critical?: boolean;
  own?: CaseSide; opponent?: CaseSide;
};

export type Case = {
  id: string;
  title: string;
  game: Game;
  /** Showdown format id; default the game's doubles custom game. A real VGC id keeps the 13-bit speed wrap (SPEC §8.1). */
  format?: string;
  slots: Record<SlotId, CaseMon & { action: CaseAction }>;
  field?: CaseField;
  /**
   * "exhaustive": every path of the "all" walk is enumerated (default). "modes": only the lowest and highest walks are exact,
   * and the "all" walk is a Monte Carlo of the decision RNG (SPEC §8.1: 10k runs, KO chance within ±1.5%).
   */
  oracle?: "exhaustive" | "modes";
  /** The app's expected not-estimated reason (V35/V36 rows): no Showdown run, the reason text is checked instead. */
  notEstimated?: string;
  /** What the case checks, for reports. */
  checks: string;
};

export const GAME_RUNTIME: Record<Game, "scarlet_violet" | "sword_shield" | "ultra_sun_ultra_moon" | "champions"> = {
  sv: "scarlet_violet", swsh: "sword_shield", usum: "ultra_sun_ultra_moon", champions: "champions",
};
export const DOUBLES_FORMAT: Record<Game, string> = {
  sv: "gen9doublescustomgame", swsh: "gen8doublescustomgame", usum: "gen7doublescustomgame", champions: "gen9championsdoublescustomgame",
};
export function toID(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** Per slot, the harness's view of one walk. */
export type SlotResult = {
  species: string; start: number; maximum: number;
  /** [hp, probability] ascending by HP. */
  dist: [number, number][];
  koChance: number; average: number; min: number; max: number;
  /** The most likely HP; ties go to the higher HP (tieUp, SPEC §4.8 low) or the lower HP (tieDown, high). */
  modeTieUp: number; modeTieDown: number;
};
export type HitResult = {
  /** P(the slot entered the move's hit steps: after redirection, retargeting and move-level failures). */
  reached: number;
  /** P(the slot entered the hit loop: not blocked by Protect, Wide Guard, Telepathy, absorption or a type immunity). */
  landed: number;
  /** P(this move's action took the slot from alive to fainted, with the slot reached). */
  ko: number;
  /** Damage over the getDamage calls it met (sum per action, uncapped), over paths with positive mass. */
  dmgMin: number | null; dmgMax: number | null;
  /** P(a multi-hit move's hits stopped before its planned last hit because this slot fainted: move.lastHit false). */
  truncated?: number;
};
export type StepResult = {
  moveId: string;
  /** P(its action was picked) = 1. */
  picked: number;
  /** P(it had fainted when its action was picked). */
  faintedAtPick: number;
  /** P(a |move| line from it: it used its move). */
  moved: number;
  /** |cant| reasons ("par", "flinch", "ability: Armor Tail"...) with their mass. */
  cant: Record<string, number>;
  /** 1-based position among the actions of slots with a move (No move excluded), every pick counted. */
  orderAll: Record<string, number>;
  /** The same, counting only picks where it moved. */
  orderMoved: Record<string, number>;
  hits: Partial<Record<SlotId, HitResult>>;
  /** Log lines from it with their mass, compacted (|-fail|, |-activate|, [notarget], [from] lines on it). */
  lines: Record<string, number>;
};
export type WalkResult = {
  mode: "all" | "lowest" | "highest";
  exact: boolean;
  runs: number; classes: number; ms: number;
  /** Decision counts by kind over the walk. */
  decisions: Record<string, number>;
  slots: Record<SlotId, SlotResult>;
  steps: Partial<Record<SlotId, StepResult>>;
  /** Monte Carlo only: sample size. */
  samples?: number;
};
export type OracleResult = {
  id: string; title: string; game: Game; format: string; checks: string;
  walks: { all: WalkResult; lowest: WalkResult; highest: WalkResult };
  /** low = modeTieUp of the lowest walk, high = modeTieDown of the highest walk (SPEC §4.8). */
  expected: Record<SlotId, { start: number; maximum: number; low: number; high: number; average: number; min: number; max: number; koChance: number; dist: [number, number][] }>;
  warnings: string[];
};

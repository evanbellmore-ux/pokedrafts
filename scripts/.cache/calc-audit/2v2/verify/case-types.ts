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
  /** status2 Step 1 #9: the status is set with no SetStatus events (a curing Berry such as Lum waits for the turn's first Update, as after a Trick). */
  silentStatus?: true;
  /** Stat stages before the turn, after entry effects (Intimidate included: sim-dfs checks Showdown agrees). */
  boosts?: Partial<Record<Boostable, number>>;
  teraType?: string;
  /** The turn's mechanic: Showdown's choice suffix; the app's build mechanic, Mega form or Z context. */
  choice?: "mega" | "terastallize" | "dynamax" | "zmove";
  /** It used Charge on an earlier turn (Showdown: the charge volatile). */
  charged?: boolean;
  /** Showdown: the set can Gigantamax (with choice "dynamax"); the app: appBuild { mechanic: "gigantamax" }. */
  gigantamax?: boolean;
  /** The app's other build fields this case needs (abilityActive, tracedAbility, configuration...). */
  appBuild?: Record<string, unknown>;
  /** An empty slot: the app input is null; Showdown faints it before the turn (probe 1c). */
  absent?: boolean;
  /** State from earlier turns (status-eot SPEC §3.1 DoublesCarried, the public counts): sim-dfs.ts prepare() applies it. */
  carried?: CaseCarried;
  /** Its Substitute from an earlier turn: the HP it has left (ADDENDUM §3.1 carried.substitute; any positive value). */
  substitute?: number;
  /** Every move it has besides its action's (Imprison reads its user's; the oracle's moveSlots get them). */
  moves?: string[];
  /** The move it used last before this turn (pinned pokemon.lastMove); null: none since it came in; absent: unknown. */
  lastMove?: string | null;
  /**
   * status2 Step 1 #11 (ADDENDUM2 C19, §7.1): what happened to it earlier this turn before the first move
   * (DoublesPokemonInput.earlierThisTurn). sim-dfs.ts prepare() clears pinned statsRaisedThisTurn, statsLoweredThisTurn,
   * usedItemThisTurn and hurtThisTurn on every active Pokémon after the setup and sets these; in a case with a switch-in the
   * switch's own entry effects set the oracle's flags, and these are the app input's only.
   */
  earlierThisTurn?: { statsRaised?: true; statsLowered?: true; usedItem?: true };
  /** status2 Step 1 #14: in a case with a switch-in, the app input's stages after the switch's entry effects (default: boosts). */
  appBoosts?: Partial<Record<Boostable, number>>;
  // ---- status2 wave 1a (SPEC2 §7.1, ADDENDUM2 §7.1; Track V1) ----
  /**
   * Its types from an earlier turn (Soak, Reflect Type, Conversion, a used Protean): the app's build.types (SPEC2 §3.2);
   * Showdown setType(types, true) after the setup. Absent: the species' (or Tera) types.
   */
  types?: string[];
  /** Forest's Curse or Trick-or-Treat from an earlier turn (build.addedType; Showdown pokemon.addedType). */
  addedType?: "Grass" | "Ghost";
  /** The item it last used or ate before this turn (DoublesPokemonInput.lastItem; Showdown pokemon.lastItem); null: none; absent: unknown. */
  lastItem?: string | null;
  /**
   * Fake Out and First Impression (DoublesPokemonInput.firstTurn): false, not its first turn since it came in. Showdown:
   * activeMoveActions 1 and activeTurns 1 before the turn (so this turn's move is its second action: PS/data/moves.ts
   * fakeout onTry `source.activeMoveActions > 1`).
   */
  firstTurn?: boolean;
  /** status2 wave 1b: the target its lastMove was aimed at (Instruct: lastMoveTargetLoc); null: none chosen. Absent: unknown. */
  lastMoveTarget?: SlotId | null;
  /** status2 wave 1b: its Showdown move slots are exactly its action and `moves` (no Splash slot: Sleep Talk's pick reads every slot). */
  exactMoves?: true;
};

/**
 * status2 wave 2 (Track R-V): a bench member (Case.bench.{side}.members; DoublesBenchPokemon). Its HP, status, item and form
 * as it is on the bench; `carried` only its sleep and freeze counters and onceUsed (DoublesBenchPokemon.carried); `moves`
 * its move slots exactly (Assist's pool; the oracle's set has no Splash slot then; the app input's `moves`), absent: Splash
 * only in the oracle and unknown in the app. The id is the app input's (never `slot:…`) and its Showdown set name.
 */
export type CaseBenchMon = CaseMon & { id: string };

/** status-eot SPEC §3.1 DoublesCarried plus ADDENDUM §3.1, slots for positions and Pokémon. */
export type CaseCarried = {
  sleep?: { attempts: number; rest: boolean };
  freeze?: { attempts: number };
  confusion?: { attempts: number; axeKick?: true };
  toxic?: number;
  leechSeed?: SlotId;
  /** `move`: the trapping move (default Fire Spin), on the oracle's line and in the app's carried.trap.move. */
  trap?: { source: SlotId; bindingBand: boolean; move?: string };
  saltCure?: true;
  aquaRing?: true;
  ingrain?: true;
  curse?: true;
  syrupBomb?: SlotId;
  yawn?: true;
  perish?: 1 | 2 | 3;
  wish?: number;
  /**
   * A Future Sight / Doom Desire landing on this slot at this end of turn. A bare id: its user not given (the app's
   * needsLandingUser; the oracle has none to land). status2 wave 1b (ADDENDUM2 C33, T2E §4.1.9): `source`, a Pokémon of this
   * turn (the slot it started in); `bench`, its user not in battle (the oracle's bench Pokémon of `benchSide`, on the bench at
   * 0 HP when `fainted`, Terastallized earlier when `terastallized`; the app's `build`).
   */
  futureMove?: string
    | { move: "futuresight" | "doomdesire"; source: SlotId }
    | { move: "futuresight" | "doomdesire"; bench: CaseMon; benchSide: SideKey; fainted?: true; terastallized?: string }
    // status2 wave 2 (Track R-V): its user is the bench member with this id on `benchSide` (Case.bench.{side}.members): the
    // oracle's source is that Pokémon (which a drag can bring in), the app's `build` its build (DoublesCarried.futureMove).
    | { move: "futuresight" | "doomdesire"; benchId: string; benchSide: SideKey };
  /** Cud Chew re-eats this Berry at this end of turn (abilityState.berry, counter 1); true: a Berry, not known which (C33). */
  cudChew?: true | string;
  /** 1: not used last turn, no assumption (ADDENDUM2 C23): no volatile in the oracle. */
  allySwitch?: 1 | 3 | 9 | 27 | 81 | 243 | 729;
  /** status2: accuracy and evasion stages from earlier turns (DoublesCarried.stages; the oracle's boosts.accuracy, boosts.evasion). */
  stages?: { accuracy?: number; evasion?: number };
  // ---- status2 wave 1a (SPEC2 §3.1, ADDENDUM2 §3.1; the same names and shapes as DoublesCarried, slots for Pokémon) ----
  /**
   * Stockpile from earlier turns (the stockpile volatile: layers, then effectState.def / spd). The case's boosts already hold
   * the stages. Counts absent: the oracle uses −layers each (the app's assumption), the app gets none.
   */
  stockpile?: { layers: 1 | 2 | 3; def?: number; spd?: number };
  powerTrick?: true;
  powerShift?: true;
  noRetreat?: true;
  minimize?: true;
  gastroAcid?: true;
  /** A two-turn move it charged last turn, as a move id (fly, dig, solarbeam, geomancy…): twoturnmove with the move's volatile, duration 1. */
  charging?: string;
  trapped?: true;
  tarShot?: true;
  foresight?: true;
  miracleEye?: true;
  /** Turns left before this end of turn's countdown (the volatile's duration). */
  telekinesis?: 1 | 2;
  healBlock?: 1 | 2 | 3 | 4;
  embargo?: 1 | 2 | 3 | 4;
  nightmare?: true;
  /** The Pokémon that set it (the volatile's source). */
  octolock?: SlotId;
  attract?: SlotId;
  /** An Opportunist (or Mirror Herb) copy pending from last turn's final Update (abilityState.boosts / itemState.boosts). */
  copy?: Partial<Record<Boostable | "accuracy" | "evasion", number>>;
  /** Berserk or Anger Shell's Berry locked (abilityState.checkedBerserk / checkedAngerShell false). */
  berryLocked?: true;
  /** Glaive Rush last turn (the glaiverush volatile, duration 1). */
  glaiveRush?: true;
  /** Ripen ate a resist Berry outside a hit (abilityState.berryWeaken). */
  berryWeaken?: true;
  /** Lock-On or Mind Reader from last turn at the Pokémon of that slot (the lockon volatile, duration 1, its source that Pokémon). */
  lockOn?: SlotId;
  /** The stall counter (the stall volatile's counter, duration 1); 1: no volatile. */
  stall?: 1 | 3 | 9 | 27 | 81 | 243 | 729;
  /** A recharge move last turn (the mustrecharge volatile); its action is No move (Showdown: Recharge). */
  mustRecharge?: true;
  destinyBond?: true;
  /** Laser Focus last turn (the laserfocus volatile, duration 1). */
  laserFocus?: true;
  /** Turns left (the volatile's duration): Taunt, Encore (move id), Disable (move id). */
  taunt?: 1 | 2 | 3;
  encore?: { move: string; turns: 1 | 2 | 3 };
  disable?: { move: string; turns: 1 | 2 | 3 | 4 };
  /** Generation 9's once-a-battle effects already had (bondTriggered, swordBoost, shieldBoost, syrupTriggered). */
  onceUsed?: ("battlebond" | "intrepidsword" | "dauntlessshield" | "supersweetsyrup")[];
  // ---- status2 wave 1b (ADDENDUM2 §3.1: CL's and PR's fields; Track V2) ----
  /** An Uproar from an earlier turn: its turns left as this turn starts (the uproar volatile's duration; its action is Uproar). */
  uproar?: 1 | 2;
  /** Fury Cutter's uses in a row before this turn (the furycutter volatile's multiplier 2^n, at most 4: 160). */
  furyCutter?: 0 | 1 | 2 | 3 | 4;
  /** Rollout / Ice Ball: the lock's hits so far (the rollout / iceball volatile's hitCount; 0: none). */
  rollout?: 0 | 1 | 2 | 3 | 4;
  /** Defense Curl used since it came in (the defensecurl volatile). */
  defenseCurl?: true;
  /** PP left before this turn's use, by move name (Trump Card; Instruct's fact): the oracle's moveSlot pp. */
  ppLeft?: Record<string, number>;
  /** USUM: a Bide from earlier turns: the damage stored, the Pokémon that last damaged it, and whether this turn releases it. */
  bide?: { stored: number; source: SlotId | null; release: boolean };
};
export type SideKey = "own" | "opponent";

/** A slot's action: move null is "No move" (Showdown: Splash, SPEC C13). target: the slot it aims at when the move takes one. */
export type CaseAction = {
  move: string | null;
  target?: SlotId;
  /** The app's MoveContext for this move (hits, useZ, fainted, timesHit, doubled...). */
  context?: Record<string, unknown>;
  /**
   * status2 Step 1 #14 (T2E §4.7.5): the Pokémon switches in this turn: the oracle has it on the bench behind a Splash
   * Snorlax placeholder that switches to it before the moves (its move must be null); the app input has it with switchedIn.
   */
  switchIn?: true;
};

export type CaseSide = {
  tailwind?: boolean; reflect?: boolean; lightScreen?: boolean; auroraVeil?: boolean;
  /**
   * status2 Step 1 #7 (S1-RSP): hazards on the side before the turn (stealthrock, spikes, toxicspikes, stickyweb; one layer).
   * The app input has none (it reports DoublesOutcome.sides.hazardsFrom); the compare reads a side's pre-turn hazard as
   * standing where its outcome's hazardsFrom is not null.
   */
  hazards?: string[];
  /**
   * status2 wave 2 (Track R-V): Spikes and Toxic Spikes layers of `hazards` (default 1; each further layer is one more
   * addSideCondition, the condition's onSideRestart). From wave 2 `hazards` reach the app input too (DoublesTurnInput.hazards:
   * stealthrock, spikes, toxicspikes, stickyweb, and SwSh's gmaxsteelsurge).
   */
  layers?: { spikes?: 1 | 2 | 3; toxicSpikes?: 1 | 2 };
  /** status2 (SPEC2 §3.2 SideConditions): Safeguard, Mist and Lucky Chant up on the side from an earlier turn (addSideCondition, duration left 3). */
  safeguard?: boolean; mist?: boolean; luckyChant?: boolean;
  /** status2 wave 1b (SwSh, C28): G-Max damage over time on the side from an earlier turn (the side condition, duration 3 left). */
  gmaxResidual?: ("gmaxvinelash" | "gmaxwildfire" | "gmaxcannonade" | "gmaxvolcalith")[];
};
export type CaseField = {
  weather?: "" | "Sun" | "Rain" | "Sand" | "Snow" | "Hail" | "Harsh Sunshine" | "Heavy Rain" | "Strong Winds";
  terrain?: "" | "Electric" | "Grassy" | "Misty" | "Psychic";
  trickRoom?: boolean; gravity?: boolean; wonderRoom?: boolean; magicRoom?: boolean;
  /** status2 (USUM): Mud Sport and Water Sport up from an earlier turn (addPseudoWeather with a source). */
  mudSport?: boolean; waterSport?: boolean;
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
  /**
   * status-eot: the moves are estimated (the oracle runs them) and the app's end of turn is not estimated with this reason
   * (SPEC §2.3): the after-the-moves values are compared, then the reason.
   */
  endNotEstimated?: string;
  /** Turns the weather has left before this turn's countdown (SPEC §3.1 weatherTurns; Showdown weatherState.duration). */
  weatherTurns?: number;
  /** Whether each side has a Pokémon left to switch in (SPEC §3.1). false: the oracle's team has no bench Pokémon on that side. */
  canSwitch?: Partial<Record<SideKey, boolean>>;
  /** Also run calculateDoublesOutcomes (E2) and compare its mixtures (items, Substitutes, positions, volatiles). */
  outcomes?: boolean;
  // ---- status2 wave 1a (ADDENDUM2 §3.1, §7.1) ----
  /**
   * DoublesTurnInput.entryOrder: when each Pokémon's ability state began, smaller first. The oracle re-makes the active
   * Pokémon's abilityState.effectOrder in rank order (unranked ones after, in the leads' order p1a, p1b, p2a, p2b); absent:
   * the leads' own order, and the app gets none.
   */
  entryOrder?: Partial<Record<SlotId, number>>;
  /** DoublesTurnInput.fieldTurns: the pseudo-weather's / terrain's duration before this turn's countdown (1: it ends at this end of turn). */
  fieldTurns?: Partial<Record<"terrain" | "gravity" | "magicRoom", number>>;
  /**
   * The oracle's bench Pokémon per side (the Snorlax that keeps the turn going): a status set directly, an ability (Aromatherapy, Heal Bell). The app input has no bench.
   * status2 wave 2 (Track R-V, SPEC2 §4.8, guards.md §5.4): `members` is the side's whole bench instead (DoublesTurnInput.bench,
   * in order; [] is a side with none: canSwitch false), each a CaseMon under the id the app input keeps; status and ability
   * are then not given. The oracle answers that side's switch requests with them (Case.replacement), and a random drag
   * picks among them.
   */
  bench?: Partial<Record<SideKey, { status?: "par" | "brn" | "psn" | "tox" | "slp" | "frz"; ability?: string; members?: CaseBenchMon[] }>>;
  /**
   * status2 wave 2 (Track R-V): DoublesTurnInput.replacement, the bench id that comes in for the Pokémon that started the turn
   * in that slot when its player picks (U-turn, Eject Button, Emergency Exit…). Absent: the first bench member (case order)
   * not in play then, as the app's default (the turn fact "Assumes {Newcomer} comes in for {Name}.").
   */
  replacement?: Partial<Record<SlotId, string>>;
  // ---- status2 wave 1b (ADDENDUM2 §3.1; Track V2) ----
  /** DoublesTurnInput.battleLastMove: the last move used in the battle before this turn (Showdown battle.lastMove); null: none. */
  battleLastMove?: string | null;
  /** DoublesTurnInput.faintedLastTurn: a Pokémon of the side fainted last turn (Showdown side.faintedLastTurn: the bench Snorlax). */
  faintedLastTurn?: Partial<Record<SideKey, boolean>>;
  /** DoublesTurnInput.echoedVoice: the echoedvoice pseudo-weather's multiplier after last turn (duration 1 left); 0: none. */
  echoedVoice?: 0 | 1 | 2 | 3 | 4 | 5;
  /**
   * The battle's start is random (Trace with two candidates, a Speed tie at the lead with Download): prepare() enumerates
   * every start path (the start's sample, shuffle and random calls) as weighted sub-cases, as the hidden counters are.
   */
  startRandom?: true;
  /** status2 wave 1b: the stages as Showdown's start leaves them stand (a start variant's Trace or Download); the app input's are `appBoosts`. */
  keepStartBoosts?: true;
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
  // status-eot additions (mass by value). Absent in results written before status-eot.
  /** Status id ("" none) → mass. */
  status?: Record<string, number>;
  /** Volatile id → mass of the paths where it stands (noise volatiles left out: stall, the one-turn markers). */
  volatiles?: Record<string, number>;
  /** "atk:2" → mass, non-zero stages only. */
  boosts?: Record<string, number>;
  /** Item id ("" none) → mass (ADDENDUM §7.1 SlotResult.item). */
  item?: Record<string, number>;
  /** Its Substitute's HP with mass, ascending; only paths where one stands (ADDENDUM SlotResult.sub). */
  sub?: [number, number][];
  /** pokemon.timesAttacked → mass (ADDENDUM K1). */
  timesAttacked?: Record<string, number>;
  /** The perish count (volatile duration) → mass. */
  perish?: Record<string, number>;
  /** Asleep: statusState.time (the hidden counter) → mass. */
  sleepTime?: Record<string, number>;
  /** Badly poisoned: statusState.stage → mass. */
  toxicStage?: Record<string, number>;
  /** Paths where it stands at the other position of its side (Ally Switch). */
  swapped?: number;
  /** After the turn: mass of the paths where its switchFlag is set (Emergency Exit, Wimp Out, Eject Pack). */
  switchFlag?: number;
  // status2 wave 1a additions (SPEC2 §7.1). Absent in results written before them.
  /** getTypes() joined by "/" (added type included) → mass. */
  types?: Record<string, number>;
  /** pokemon.ability → mass. */
  ability?: Record<string, number>;
  /** pokemon.species.id → mass (the form after the turn; `species` above is the case's name). */
  forme?: Record<string, number>;
  /** storedStats as "atk/def/spa/spd/spe" → mass. */
  stored?: Record<string, number>;
  /** weighthg → mass. */
  weight?: Record<string, number>;
  /** The stockpile volatile "layers:def:spd" → mass (paths where it stands). */
  stockpile?: Record<string, number>;
  /** pokemon.lastItem ("" none) → mass. */
  lastItem?: Record<string, number>;
  /** A volatile's duration ("healblock:2") → mass, for the counted volatiles (healblock, embargo, telekinesis, taunt, encore, disable, uproar). */
  durations?: Record<string, number>;
  /** An Opportunist / Mirror Herb copy pending ("atk:1,spe:1") → mass (paths with one). */
  pendingCopy?: Record<string, number>;
  /** Berserk / Anger Shell's lock (checkedBerserk / checkedAngerShell false) → mass. */
  berryLocked?: number;
  // status2 wave 1b additions (ADDENDUM2 §3.1 DoublesOutcomeMon, §7.1). Absent in results written before them.
  /** The two-turn move it charges (the twoturnmove volatile's move) → mass, paths where it stands. */
  charging?: Record<string, number>;
  /** Cud Chew's Berry still due ("sitrusberry:1": abilityState.berry and counter) → mass, paths with one. */
  cudChew?: Record<string, number>;
  /** Generation 9's once-a-battle flags had ("battlebond,intrepidsword") → mass, paths with one. */
  onceUsed?: Record<string, number>;
  /** G-Max Chi Strike layers (the gmaxchistrike volatile's layers) → mass, paths with it. */
  chiStrike?: Record<string, number>;
};
/** One residual on one Pokémon over the walk (SPEC §7 step 1: the residual log by effect). */
export type ResidualResult = {
  slot: SlotId;
  /** status2 wave 2: the newcomer it acted on (its bench id; DoublesResidual.id), absent for the slot's starting Pokémon. */
  id?: string;
  /** The [from] of its lines as Showdown writes them ("Sandstorm", "item: Leftovers", "brn", "tox", "Leech Seed", "move: Fire Spin", "ability: Healer"...). */
  effect: string;
  /** The other Pokémon of the line ([of], or the seeded for Leech Seed's silent heal). */
  other?: SlotId;
  /** P(it acted on this Pokémon). */
  chance: number;
  /** The HP change summed per path (negative = damage); null when it changed no HP. */
  min: number | null; max: number | null;
  /** P(its damage took the Pokémon to 0). */
  koChance: number;
  /** Non-HP lines of it on this Pokémon ("curestatus:psn", "status:slp", "boost:spe:1", "perish:2", "enditem:sitrusberry"...) with mass. */
  facts: Record<string, number>;
  /** Mean index of its first line among the residual's lines, for the order. */
  index: number;
};
/** The residual phase of one walk (status-eot SPEC §7). */
export type AfterTurn = {
  runs: number; classes: number; ms: number; decisions: Record<string, number>;
  /** HP and state per slot after the whole turn (the final Update and Emergency Exit included). */
  slots: Record<SlotId, SlotResult>;
  residuals: ResidualResult[];
  /** Mass of the paths that had no residual: a switch request after the last action (U-turn, Eject Button, Emergency Exit...). */
  noResidual: number;
  /** "weather:sunnyday" / "terrain:" → mass after the turn. */
  field: Record<string, number>;
  /** status2: the pseudo-weathers after the turn with their durations ("magicroom:4", "terrain:electricterrain:3") → mass. */
  pseudo?: Record<string, number>;
  /** status2: the side conditions after the turn with their durations ("own|reflect:4") → mass. */
  sides?: Record<string, number>;
  /** status2: per side, mass of the paths where the bench Pokémon has no status after the turn (Case.bench with a status). */
  benchCured?: Partial<Record<SideKey, number>>;
  // status2 wave 2 (Track R-V; DoublesEndOfTurn.replaced and hpEntered): a case with a bench. The switches after the residual
  // (Emergency Exit, Wimp Out, Eject Pack at order 29) are answered as mid-turn ones and the turn ends before the next one
  // starts, so `slots` (identity: the starting Pokémon, its HP as it left where it left) and `entered` are after them.
  /** The switch-outs after the residual only. */
  replaced?: Partial<Record<SlotId, ReplacedResult>>;
  /** Every newcomer of the turn after the whole turn, by slot and bench id. */
  entered?: Partial<Record<SlotId, Record<string, EnteredResult>>>;
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
  /** ADDENDUM §7.1: its Substitute took this move's hits: mass, the HP it lost (min/max over those paths), and P(it broke). */
  sub?: { mass: number; takenMin: number; takenMax: number; breaks: number };
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
  // status-eot additions. Absent in results written before status-eot.
  /** Per Pokémon (by the slot it started in), the action's lines on it as stable keys with mass (SPEC §7 step 4). */
  effects?: Partial<Record<SlotId, Record<string, number>>>;
  /** Per Pokémon, its HP change over the action (after − before) over the paths with mass. */
  change?: Partial<Record<SlotId, { min: number; max: number }>>;
  /** Side and field lines of the action (sidestart:stealthrock, fieldstart:..., weather:...), keyed by side or "field". */
  sides?: Partial<Record<SideKey | "field", Record<string, number>>>;
  /** Per Pokémon, the HP its own lines changed (no item, ability or confusion line) over the paths where it moved: a status move's change. */
  moveChange?: Partial<Record<SlotId, { min: number; max: number; mass: number }>>;
  /** Its confusion self-hit: P(it hurt itself) and the raw damage (getConfusionDamage), uncapped. */
  selfHit?: { mass: number; min: number; max: number };
  // status2 wave 2 (Track R-V): the Pokémon that came in for a slot (DoublesHit.id), apart from the slot's starting Pokémon.
  /** Per slot and bench id, its hits from this action (as `hits`). */
  hitsEntered?: Partial<Record<SlotId, Record<string, HitResult>>>;
  /** Per slot and bench id, the action's lines on it (as `effects`). */
  effectsEntered?: Partial<Record<SlotId, Record<string, Record<string, number>>>>;
};
/**
 * status2 wave 2 (Track R-V): one slot's switch-outs (DoublesReplaced): each Pokémon that left it, in leaving order (its id:
 * `slot:<slot>` for the slot's starting Pokémon, else its bench id), its HP as it left (after its switch-out effects:
 * Regenerator) as [hp, probability] conditional on leaving, and the mass of the paths where it left; each Pokémon that came
 * in for it with the mass of the paths where it did (a random drag: one per bench Pokémon).
 */
export type ReplacedResult = {
  left: { id: string; hp: [number, number][]; chance: number }[];
  /** `chosen`: the mass of those paths where its player picked it (a switch request), not a random drag. */
  entered: { id: string; chance: number; chosen?: number }[];
};
/** status2 wave 2: a newcomer's state (as SlotResult, `dist` conditional on its having come in; `start` its HP on the bench before the turn) and the mass of the paths where it came in. */
export type EnteredResult = SlotResult & { id: string; chance: number };
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
  // status-eot additions.
  /** ADDENDUM §7.1: P(each side's two Pokémon stand swapped after the moves); absent when 0. */
  swapped?: Partial<Record<SideKey, number>>;
  /** The residual phase (status-eot SPEC §7). */
  afterTurn?: AfterTurn;
  /** Side conditions standing after the moves (id → mass): hazards, Safeguard, screens, Tailwind. */
  sideConditions?: Partial<Record<SideKey, Record<string, number>>>;
  /** A No-move Pokémon's action (Splash): the lines it produced on each Pokémon with mass (SPEC C5: a confusion self-hit). */
  noMove?: Partial<Record<SlotId, Partial<Record<SlotId, Record<string, number>>>>>;
  /**
   * status2 wave 1b (T2P §2.3, §3.13; DoublesStep.copied): a Pokémon's second use of a move this turn, apart from its own
   * action's step: a Dancer's copy (inside the dance's action) or an instructed move (its own queue action), keyed
   * "<Dancer|Instruct>:<slot>:<move id>"; `picked` is the mass of the paths where it happened.
   */
  /** status2 wave 2 gap fix: `id`, a copy by a bench Pokémon that came in for `slot` (DoublesStep.id). */
  copies?: Record<string, StepResult & { slot: SlotId; copied: "Dancer" | "Instruct"; source?: SlotId; id?: string }>;
  // status2 wave 2 (Track R-V; DoublesTurnResult.replaced and hpEntered): only a case with a bench (Case.bench.{side}.members).
  /** Each slot whose Pokémon left during the moves (mid-turn switches, drags), as it stands after the moves. */
  replaced?: Partial<Record<SlotId, ReplacedResult>>;
  /** Each newcomer after the moves, by slot and bench id. */
  entered?: Partial<Record<SlotId, Record<string, EnteredResult>>>;
};
export type Expected = { start: number; maximum: number; low: number; high: number; average: number; min: number; max: number; koChance: number; dist: [number, number][] };
export type OracleResult = {
  id: string; title: string; game: Game; format: string; checks: string;
  walks: { all: WalkResult; lowest: WalkResult; highest: WalkResult };
  /** low = modeTieUp of the lowest walk, high = modeTieDown of the highest walk (SPEC §4.8). */
  expected: Record<SlotId, Expected>;
  warnings: string[];
  /** status-eot: the same after the whole turn (null for a slot whose walk had paths with no residual). */
  afterTurn?: Record<SlotId, Expected> | null;
  /** status-eot: the all walk's residuals. */
  residuals?: ResidualResult[];
  /** status-eot SPEC §7 step 3: the hidden-counter sub-cases mixed into the walks, with their prior weights. */
  hidden?: { label: string; weight: number }[];
  // status2 wave 2 (Track R-V): a case with a bench. Expected as `expected` (low from the lowest walk, high from the highest),
  // each newcomer's and leaver's conditional on its having come in or left, with that mass.
  /** After the moves: each slot's leavers (DoublesTurnResult.replaced[slot].left, hp) and newcomers (entered). */
  expectedReplaced?: Partial<Record<SlotId, { left: (Expected & { id: string; chance: number })[]; entered: { id: string; chance: number }[] }>>;
  /** After the moves: each newcomer's HP (DoublesTurnResult.hpEntered[slot][id]). */
  expectedEntered?: Partial<Record<SlotId, Record<string, Expected & { chance: number }>>>;
  /** After the whole turn (as afterTurn: null when a path had no residual): the switches after the residual (DoublesEndOfTurn.replaced). */
  afterTurnReplaced?: Partial<Record<SlotId, { left: (Expected & { id: string; chance: number })[]; entered: { id: string; chance: number }[] }>> | null;
  /** After the whole turn: each newcomer's HP (DoublesEndOfTurn.hpEntered[slot][id]). */
  afterTurnEntered?: Partial<Record<SlotId, Record<string, Expected & { chance: number }>>> | null;
};

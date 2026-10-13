import type { BattleRuntime } from "@/app/lib/battle/runtime";
import {
  allyOf, DOUBLES_SLOTS, doublesBenchNames, doublesNames, slotSide,
  type DoublesAction, type DoublesBenchPokemon, type DoublesCarried, type DoublesHazards, type DoublesPokemonInput, type DoublesSideId, type DoublesSlotId, type DoublesTurnInput,
} from "@/app/lib/battle/doubles-types";
import { buildTypes, getBuildGender, isMaxActive } from "@/app/lib/battle/mechanics";
import { getBuildStats, STATUSES, validateConditions } from "@/app/lib/battle/model";
import { TERA_TYPES } from "@/app/lib/battle/profiles";
import { RECHARGE_MOVES } from "@/app/lib/battle/stat-moves";
import type { BattleBuild, BattleConditions, BuildIssue, SideConditions } from "@/app/lib/battle/types";
import type { CalculatorState, DoublesMatchup } from "./doubles-prep";
import type { RosterChoice, RosterSource } from "./roster-prep";

// The 2v2 calculator's inputs from earlier turns (status2 IN §5, ADDENDUM2 §5.2): Track NU's file. Step 0c moved today's
// state-from-earlier-turns logic here verbatim from doubles-prep.ts (which re-exports it), with the `history` and
// `turnEarlier` state (IN §5.4) and its two input call sites (doublesSlotInput, getDoublesTurnInput). Track NU adds every
// earlier-turn control of ADDENDUM2 §5.2 below: what each Pokémon, side and the field show (earlierSlotControls,
// earlierSideControls, earlierFieldControls), what each writes, the reset rules and the mapping into the turn's input. Data
// only from the catalogs and small move tables (no engine import, so the page's first bundle stays as it was);
// tests/unit/calculator-doubles-inputs.test.ts checks each table against the engine's.

/**
 * In 2v2, current HP 0 is a Pokémon that fainted before the turn with no replacement left (pinned Showdown keeps it in
 * side.active with fainted set, and getAllActive, adjacency and targeting skip it). 1v1 still asks for 1 or more.
 */
export function isFaintedBuild(build: BattleBuild): boolean {
  return build.currentHP === 0;
}

/** No state from earlier turns (DoublesMatchup.carried's value for a slot with none). */
export const NO_CARRIED: DoublesCarried = {};

/** The controls of a Pokémon's state from earlier turns that apply to its build (EarlierTurnFields CarriedControl). */
export type CarriedOptions = {
  /** Asleep: the most turns it can have lost to sleep (sleepTurnsMax); null otherwise. */
  sleep: { max: number } | null;
  /** Champions, Frozen: the most turns it can have lost to freeze (its third turn frozen always thaws it); null otherwise. */
  freeze: { max: number } | null;
  /** Badly poisoned: its bad poison turns so far (0–15). */
  toxic: boolean;
  /** Confused from an earlier turn, with its turns so far (0–4). */
  confusion: boolean;
  /** A Substitute from an earlier turn, at most a quarter of its maximum HP; null when that is below 1. */
  substitute: { max: number } | null;
};

/** No controls: a Pokémon that has fainted takes no part in the turn (its state is kept for when its HP comes back). */
export const NO_CARRIED_OPTIONS: CarriedOptions = { sleep: null, freeze: null, toxic: false, confusion: false, substitute: null };

/**
 * Review 2 (R6-5): a Pokémon that switched in this turn (Switched in) has no confusion, Substitute or bad poison turns from
 * earlier turns (a switch clears its volatiles, and bad poison's stage restarts as it comes in: switchDoublesIn); its sleep
 * and freeze counters stay.
 */
export function switchedInOptions(options: CarriedOptions, doubles: Pick<DoublesMatchup, "history">, slot: DoublesSlotId): CarriedOptions {
  return historyOf(doubles, slot).switchedIn ? { ...options, toxic: false, confusion: false, substitute: null } : options;
}

/**
 * The most turns a sleeping Pokémon can have lost to sleep while it still sleeps: a sleep lasts 2–4 turns (Champions 2–3,
 * PS/data/mods/champions/conditions.ts), Rest's 3 (status-eot SPEC §4.2), and Early Bird counts each turn twice, so its
 * counter must still be above 0 (doubles-turn.ts carriedIssues).
 */
export function sleepTurnsMax(build: BattleBuild, runtime: BattleRuntime, rest: boolean): number {
  const longest = rest || runtime.profile.id === "champions" ? 3 : 4;
  return Math.floor((longest - 1) / (build.abilityId === "earlybird" ? 2 : 1));
}

/**
 * The statuses an ability cures on its own holder at every Update (pinned Showdown data/abilities.ts onUpdate of immunity,
 * pastelveil, insomnia, vitalspirit, limber, magmaarmor, waterveil, waterbubble, thermalexchange). The turn's first Update
 * runs after its beforeTurn action, before any Mega Evolution or move (sim/battle.ts runAction, generation 5 on), so such
 * a status never stands into a move and has no turns of its own to count. Own Tempo ends confusion there the same way.
 */
const START_CURES: Readonly<Record<string, readonly BattleBuild["status"][]>> = {
  immunity: ["psn", "tox"], pastelveil: ["psn", "tox"], insomnia: ["slp"], vitalspirit: ["slp"], limber: ["par"], magmaarmor: ["frz"],
  waterveil: ["brn"], waterbubble: ["brn"], thermalexchange: ["brn"],
};

/**
 * The slot's own ability is in effect as the turn starts: no other Pokémon that has not fainted has Neutralizing Gas, or
 * an Ability Shield keeps it outside Magic Room (calculate.ts settleDoublesStart; pinned Showdown sim/pokemon.ts
 * ignoringAbility). For START_CURES and Own Tempo, none of which Neutralizing Gas spares.
 */
export function carriedAbilityOn(doubles: Pick<DoublesMatchup, "slots" | "field">, slot: DoublesSlotId): boolean {
  if (doubles.slots[slot].build.itemId === "abilityshield" && !doubles.field.magicRoom) return true;
  return !DOUBLES_SLOTS.some((other) => other !== slot && !isFaintedBuild(doubles.slots[other].build) && doubles.slots[other].build.abilityId === "neutralizinggas");
}

/**
 * The state-from-earlier-turns controls the slot's build can use (status-eot SPEC §5, ADDENDUM §5). `abilityOn`
 * (carriedAbilityOn): its ability is in effect as the turn starts, so a status it cures (START_CURES) and, with Own
 * Tempo, confusion are gone before any move and offer no counts.
 */
export function carriedOptions(build: BattleBuild, runtime: BattleRuntime, rest: boolean, abilityOn = true): CarriedOptions {
  const quarter = substituteMax(build, runtime) ?? 0;
  // status2 Step 1 #4 (F4 F3): a Trace holder's copied ability (types.ts tracedAbility) is the one the turn's first Update cures with.
  const ability = build.abilityId === "trace" && build.tracedAbility ? build.tracedAbility : build.abilityId;
  const status = abilityOn && START_CURES[ability]?.includes(build.status) ? "" : build.status;
  return {
    sleep: status === "slp" ? { max: sleepTurnsMax(build, runtime, rest) } : null,
    freeze: status === "frz" && runtime.profile.id === "champions" ? { max: 2 } : null,
    toxic: status === "tox",
    confusion: !(abilityOn && ability === "owntempo"),
    substitute: quarter >= 1 ? { max: quarter } : null,
  };
}

/**
 * The most HP a Substitute of its own can have: a quarter of its maximum HP (PS/data/moves.ts substitute: floor(maxhp / 4)),
 * the stored maximum, as a Dynamaxed Pokémon made it before Dynamaxing. Null while the build's stats are not valid.
 */
function substituteMax(build: BattleBuild, runtime: BattleRuntime): number | null {
  const stats = getBuildStats(build, runtime);
  return stats ? Math.floor(stats.hp / 4) : null;
}

const clamp = (value: number, least: number, most: number) => Math.min(most, Math.max(least, Math.trunc(value)));

/**
 * The slot's carried state for its build: what no longer applies is dropped (turns lost to sleep without Asleep, to freeze
 * outside Champions or without Frozen, bad poison turns without Badly poisoned, a status or confusion its own ability ends
 * as the turn starts while `abilityOn`, a Substitute it cannot have), each count is bounded to what the build allows
 * (CarriedOptions), and a count at 0 is left out (the turn's assumption). The same object when nothing changes.
 */
export function reconcileCarried(carried: DoublesCarried, build: BattleBuild, runtime: BattleRuntime, abilityOn = true): DoublesCarried {
  const options = carriedOptions(build, runtime, !!carried.sleep?.rest, abilityOn);
  const next: DoublesCarried = { ...carried };
  const set = <K extends keyof DoublesCarried>(key: K, value: DoublesCarried[K] | undefined) => {
    if (value === undefined) delete next[key];
    else next[key] = value;
  };
  if (carried.sleep) {
    const attempts = options.sleep ? clamp(carried.sleep.attempts, 0, options.sleep.max) : 0;
    set("sleep", !options.sleep || (!attempts && !carried.sleep.rest) ? undefined : attempts === carried.sleep.attempts ? carried.sleep : { attempts, rest: carried.sleep.rest });
  }
  if (carried.freeze) {
    const attempts = options.freeze ? clamp(carried.freeze.attempts, 0, options.freeze.max) : 0;
    set("freeze", !attempts ? undefined : attempts === carried.freeze.attempts ? carried.freeze : { attempts });
  }
  if (carried.confusion) {
    const attempts = clamp(carried.confusion.attempts, 0, 4);
    if (!options.confusion) set("confusion", undefined);
    else if (attempts !== carried.confusion.attempts) set("confusion", { ...carried.confusion, attempts });
  }
  if (carried.toxic !== undefined) set("toxic", options.toxic ? clamp(carried.toxic, 0, 15) || undefined : undefined);
  // A build being edited (its stats not valid yet) keeps its Substitute as it is.
  if (carried.substitute !== undefined) {
    const most = substituteMax(build, runtime);
    if (most !== null) set("substitute", most >= 1 ? clamp(carried.substitute, 1, most) : undefined);
  }
  boundEarlierCarried(carried, build, runtime, set);
  const keys = Object.keys(next) as (keyof DoublesCarried)[];
  const same = keys.length === Object.keys(carried).length && keys.every((key) => next[key] === carried[key]);
  return same ? carried : keys.length ? next : NO_CARRIED;
}

/** The turn's input issue fields (doubles-turn.ts carriedIssues) of the calculator's state-from-earlier-turns controls. */
const CARRIED_ISSUE_FIELDS: Readonly<Record<string, keyof CarriedOptions>> = {
  "carried.sleep": "sleep", "carried.freeze": "freeze", "carried.confusion": "confusion", "carried.toxic": "toxic", "carried.substitute": "substitute",
};

/**
 * The turn's input issues of one Pokémon (DoublesIssues.pokemon[slot]) that its state-from-earlier-turns controls show,
 * by control: "Garchomp: it cannot have lost 3 turns to sleep."
 */
export function carriedIssueTexts(issues: readonly BuildIssue[] | undefined, name: string): Partial<Record<keyof CarriedOptions, string>> {
  const out: Partial<Record<keyof CarriedOptions, string>> = {};
  for (const issue of issues ?? []) {
    const key = CARRIED_ISSUE_FIELDS[issue.field];
    if (key) out[key] = out[key] ? `${out[key]} ${name}: ${issue.message}` : `${name}: ${issue.message}`;
  }
  return out;
}


// ---------- status2 Track NU: the earlier-turn controls (ADDENDUM2 §5.2, IN §5) ----------

/**
 * One Pokémon's answers about earlier turns that are not carried state (IN §5.4, ADDENDUM2 §5.2): the move it used last
 * (null: none since it came in), the target of that move (Instruct), the item it used or ate last (null: none), and its
 * types and added type from earlier turns; and what happened to it earlier in this turn (ADDENDUM2 C19, T2E §4.7). Absent:
 * not given. DoublesMatchup.history; cleared with `carried` when the slot gets another Pokémon (clearSlotEarlier).
 */
export type DoublesSlotHistory = {
  lastMove?: string | null;
  lastMoveTarget?: DoublesSlotId | null;
  lastItem?: string | null;
  types?: string[];
  addedType?: "Grass" | "Ghost";
  /** The species `types` and `addedType` were given for: another species or form drops both (setSpecies: reconcileEarlier). */
  typesOf?: string;
  /** Fake Out and First Impression: not its first turn since it came in (DoublesPokemonInput.firstTurn false). */
  firstTurn?: false;
  /** Its stats rose, fell or it used an item earlier this turn, before the first move (DoublesPokemonInput.earlierThisTurn). */
  earlierThisTurn?: { statsRaised?: true; statsLowered?: true; usedItem?: true };
  /** It switched in this turn: its action is No move (DoublesPokemonInput.switchedIn; the move select's Switched in). */
  switchedIn?: true;
  /** Whose Wish lands on it (carried.wish is half that Pokémon's maximum HP, kept in step with its build). */
  wishFrom?: DoublesSlotId;
  /**
   * status2 R-U: the bench Pokémon (its DoublesBenchEntry key) whose Future Sight or Doom Desire lands on it (carried.futureMove's
   * build form, kept in step with that Pokémon's build on the bench; it goes when that Pokémon leaves the bench).
   */
  futureFrom?: string;
};

/** No history answers (DoublesMatchup.history's value for a slot with none). */
export const NO_HISTORY: DoublesSlotHistory = {};

/**
 * The answers about earlier turns for the field and the sides (IN §5.4): the weather, terrain, Gravity or Magic Room ends
 * at this end of turn; the entry order's ranks (the chosen Pokémon 0, the other candidates 1); the battle's last move (null:
 * none); Echoed Voice's multiplier after last turn; a side's Pokémon fainted last turn; a side with no Pokémon left to switch
 * in. Absent: not given. DoublesMatchup.turnEarlier.
 */
export type DoublesTurnEarlier = {
  weatherEnds?: true;
  terrainEnds?: true;
  gravityEnds?: true;
  magicRoomEnds?: true;
  entered?: Partial<Record<DoublesSlotId, number>>;
  battleLastMove?: string | null;
  echoedVoice?: number;
  faintedLastTurn?: Partial<Record<DoublesSideId, boolean>>;
  noneLeft?: Partial<Record<DoublesSideId, true>>;
};

/** No field or side answers (DoublesMatchup.turnEarlier's value with none). */
export const NO_TURN_EARLIER: DoublesTurnEarlier = {};

/**
 * status2 R-U (IN §5.7, ADDENDUM2 §5.3): one Pokémon on a side's bench, from the roster its side's Pokémon come from. Its
 * build is its roster entry's as prepared when it was added (the shared cache's session build, else the imported set or the
 * default build: roster-prep selectRosterPokemon, followed when the cache changes: doubles-prep followShared), with the
 * row's HP and status.
 */
export type DoublesBenchEntry = {
  /** Its roster entry's source key: its id in the turn's input (DoublesBenchPokemon.id). */
  key: string;
  source: RosterSource;
  /** Its build as prepared, before the row's HP and status (benchBuild). */
  base: BattleBuild;
  /** Its quick moves in move-slot order (DoublesBenchPokemon.moves: Assist's party). */
  moves: readonly string[];
  /** The row's HP (1 to its maximum) and status; absent: the prepared build's. */
  hp?: number;
  status?: BattleBuild["status"];
  /** Its sleep and freeze counters and generation 9's once-a-battle effects on the bench (DoublesBenchPokemon.carried). */
  carried?: NonNullable<DoublesBenchPokemon["carried"]>;
};

/**
 * status2 R-U: the Bench, the Replacement picks and the Hazards (DoublesMatchup.bench; the turn's input through withBench).
 * NO_BENCH until a control sets one, so every turn without them is today's input.
 */
export type DoublesBench = {
  /** Each side's bench in its roster's order, at most four (the turn's `bench`). */
  own: readonly DoublesBenchEntry[];
  opponent: readonly DoublesBenchEntry[];
  /** The bench Pokémon (its key) picked to come in for a Pokémon that can switch out by its player's choice (the turn's `replacement`); absent: the turn's default, the first bench Pokémon not in play then. */
  picks: Partial<Record<DoublesSlotId, string>>;
  /** The hazards on each side as the turn starts (the turn's `hazards`). */
  hazards: Partial<Record<DoublesSideId, DoublesHazards>>;
};

/** No bench, picks or hazards (DoublesMatchup.bench's value with none). */
export const NO_BENCH: DoublesBench = { own: [], opponent: [], picks: {}, hazards: {} };

/** The matchup's bench (NO_BENCH for a matchup made before it had one). */
export const benchOf = (doubles: Pick<DoublesMatchup, "bench">): DoublesBench => doubles.bench ?? NO_BENCH;

/**
 * The bench Pokémon's build in the turn: its prepared build with the row's HP and status. A Dynamax the session's build kept
 * from a slot is dropped (a Pokémon on the bench is not Dynamaxed: PS/data/conditions.ts dynamax onBeforeSwitchOut);
 * Terastallization stays.
 */
export function benchBuild(entry: DoublesBenchEntry): BattleBuild {
  const { mechanic, ...rest } = entry.base;
  const base = mechanic === "dynamax" || mechanic === "gigantamax" ? rest : entry.base;
  if (entry.hp === undefined && entry.status === undefined) return base;
  return { ...base, ...(entry.hp !== undefined ? { currentHP: entry.hp } : {}), ...(entry.status !== undefined ? { status: entry.status } : {}) };
}

/** One bench Pokémon as the turn's input holds it (DoublesTurnInput.bench). */
function benchPokemon(entry: DoublesBenchEntry): DoublesBenchPokemon {
  const moves = [...new Set(entry.moves)];
  return {
    id: entry.key, build: benchBuild(entry),
    ...(entry.carried && Object.keys(entry.carried).length ? { carried: entry.carried } : {}),
    ...(moves.length ? { moves } : {}),
  };
}

/** The non-empty sides of the bench as the turn's input holds them. */
function inputBench(bench: DoublesBench): Partial<Record<DoublesSideId, DoublesBenchPokemon[]>> {
  return Object.fromEntries((["own", "opponent"] as const).filter((side) => bench[side].length).map((side) => [side, bench[side].map(benchPokemon)]));
}

/**
 * The bench Pokémon's names by key, as the turn's text names them (doubles-types turnBenchNames of the turn's input: after the
 * slots of the Pokémon that have not fainted, each side's bench in order); empty without a bench.
 */
export function benchNamesOf(doubles: Pick<DoublesMatchup, "slots" | "runtime" | "bench">): Record<string, string> {
  const bench = benchOf(doubles);
  if (!bench.own.length && !bench.opponent.length) return {};
  const pokemon = Object.fromEntries(DOUBLES_SLOTS.map((slot) => [slot, isFaintedBuild(doubles.slots[slot].build) ? null : { build: doubles.slots[slot].build }])) as Record<DoublesSlotId, { build: BattleBuild } | null>;
  return doublesBenchNames(pokemon, inputBench(bench), doubles.runtime);
}

/**
 * The move and item tables the controls read (pinned Showdown c23d2e94 data/moves.ts, data/items.ts, data/abilities.ts),
 * kept here so the calculator's first bundle imports no engine module; the inputs test checks each against the engine's
 * (doubles-actions CHARGE_TURN_MOVES, SEMI_INVULNERABLE_MOVES, PROTECT_MOVES; hit-loop HEALING_BERRIES).
 */
export const EARLIER_TABLES = {
  /** The two-turn moves a charge from last turn releases (CHARGE_TURN_MOVES, SEMI_INVULNERABLE_MOVES, Geomancy; never Sky Drop: C21). */
  twoTurn: new Set(["solarbeam", "solarblade", "meteorbeam", "electroshot", "skyattack", "skullbash", "razorwind", "freezeshock", "iceburn", "fly", "dig", "dive", "bounce", "phantomforce", "shadowforce", "geomancy"]),
  /** The protecting moves whose use rolls the stall counter (PROTECT_MOVES, Endure; Max Guard is a Dynamaxed status move). */
  protecting: new Set(["protect", "detect", "kingsshield", "spikyshield", "banefulbunker", "obstruct", "silktrap", "burningbulwark", "endure"]),
  /** The healing Berries Berserk and Anger Shell keep until their HP check (data/abilities.ts berserk onTryEatItem). */
  healingBerries: new Set(["sitrusberry", "oranberry", "berryjuice", "figyberry", "wikiberry", "magoberry", "aguavberry", "iapapaberry", "enigmaberry"]),
  /** The partial trapping moves (the partiallytrapped volatile; G-Max Centiferno and Sandblast are Max Moves, never learnt). */
  trapping: new Set(["bind", "clamp", "firespin", "infestation", "magmastorm", "sandtomb", "snaptrap", "thundercage", "whirlpool", "wrap"]),
  /** Moves that read accuracy and evasion stages (IN §2): the user's, the target's, or every Pokémon's (Haze). */
  stageReaders: new Set(["storedpower", "powertrip", "punishment", "acupressure", "psychup", "heartswap", "topsyturvy", "spectralthief", "haze"]),
  /** Moves that read their target's last move (Disable, Encore, Instruct, Mirror Move). */
  lastMoveReaders: new Set(["disable", "encore", "instruct", "mirrormove", "conversion2"]),
  /** Stockpile and the moves that use it up. */
  stockpile: new Set(["stockpile", "swallow", "spitup"]),
  /** The dex targets of a move aimed at one chosen Pokémon (Instruct's last move target). */
  singleTargets: new Set(["normal", "any", "adjacentFoe", "adjacentAlly", "adjacentAllyOrSelf"]),
  /** The type-setting moves its own use reads (Reflect Type, Conversion, Conversion 2, Camouflage, Burn Up, Double Shock). */
  ownTypeMoves: ["reflecttype", "conversion", "conversion2", "camouflage", "burnup", "doubleshock"],
  /** The G-Max side conditions that deal damage over time (SwSh: SideConditions.gmaxResidual). */
  gmaxResidual: ["gmaxvinelash", "gmaxwildfire", "gmaxcannonade", "gmaxvolcalith"] as const,
  // ---- status2 R-U (IN §5.7; F4 §5.4's triggers; the engine's doubles-actions SWITCH_MOVES and DRAG_MOVES with Roar and Whirlwind) ----
  /** The moves after which their user's player picks its replacement (data/moves.ts selfSwitch; Teleport only from generation 8). */
  chosenSwitch: new Set(["uturn", "voltswitch", "flipturn", "partingshot", "teleport", "batonpass", "shedtail", "chillyreception"]),
  /** The items and abilities that switch their holder out by its player's choice (Eject Button, Eject Pack, Emergency Exit, Wimp Out). */
  switchItems: new Set(["ejectbutton", "ejectpack"]),
  switchAbilities: new Set(["emergencyexit", "wimpout"]),
  /** The moves that drag a random bench Pokémon in for their target (data/moves.ts forceSwitch, Roar and Whirlwind's dragIn). */
  drag: new Set(["roar", "whirlwind", "dragontail", "circlethrow"]),
  /** The moves that read their user's own side's bench: Healing Wish and Lunar Dance (a Pokémon left to come in), Assist (the bench's moves), Beat Up (the bench's Pokémon). */
  benchReaders: new Set(["healingwish", "lunardance", "assist", "beatup"]),
  /** Generation 9's once-a-battle entry abilities (pokemon.swordBoost, shieldBoost, syrupTriggered): a bench Pokémon may have had one already. */
  onceEntry: ["intrepidsword", "dauntlessshield", "supersweetsyrup"] as const,
  /** The hazards (DoublesHazards), with their moves and data attributes; G-Max Steelsurge is Sword/Shield's. */
  hazards: [
    { flag: "stealthRock", move: "stealthrock", attr: "stealth-rock", most: 1 },
    { flag: "spikes", move: "spikes", attr: "spikes", most: 3 },
    { flag: "toxicSpikes", move: "toxicspikes", attr: "toxic-spikes", most: 2 },
    { flag: "stickyWeb", move: "stickyweb", attr: "sticky-web", most: 1 },
    { flag: "steelsurge", move: "gmaxsteelsurge", attr: "steelsurge", most: 1 },
  ] as const,
} as const;

const STRONG_WEATHER: ReadonlySet<string> = new Set(["Harsh Sunshine", "Heavy Rain", "Strong Winds"]);
/** The chart's types a type control offers (never Stellar; "???" as Burn Up and Double Shock leave). */
const TYPE_CHOICES: readonly string[] = [...TERA_TYPES.filter((type) => type !== "Stellar"), "???"];

/** A state change of the 2v2 matchup a control makes, read against the latest state (applyDoublesEarlier). */
export type EarlierChange = (doubles: DoublesMatchup) => DoublesMatchup;
export type EarlierChoice = { value: string; label: string };
type EarlierBase = {
  /** The control's key (stable; the input issues and tests use it). */
  key: string;
  /** Its visible label; the Pokémon's name or the side follows for screen readers (Whose). */
  label: string;
  /** Its data attribute and the attribute's value (the slot, the side, or "" for the field). */
  attr: string;
  attrValue: string;
  /** The turn's input issue about it ("Garchomp: …"). */
  issue?: string;
  /** It counts among the summary's toggles now (ADDENDUM2 §5.2 Summary toggles, IN §5.5). */
  toggle: boolean;
};
export type EarlierCheck = EarlierBase & { kind: "check"; checked: boolean; inputValue?: string; set: (checked: boolean) => EarlierChange };
export type EarlierSelect = EarlierBase & { kind: "select"; value: string; choices: readonly EarlierChoice[]; set: (value: string) => EarlierChange };
export type EarlierNumber = EarlierBase & { kind: "number"; value: number | null; min: number; max?: number; set: (value: number | null) => EarlierChange };
export type EarlierControl = EarlierCheck | EarlierSelect | EarlierNumber;

const historyOf = (doubles: Pick<DoublesMatchup, "history">, slot: DoublesSlotId): DoublesSlotHistory => doubles.history?.[slot] ?? NO_HISTORY;
const earlierOf = (doubles: Pick<DoublesMatchup, "turnEarlier">): DoublesTurnEarlier => doubles.turnEarlier ?? NO_TURN_EARLIER;
const SIDE_KEY: Record<DoublesSideId, "attackerSide" | "defenderSide"> = { own: "attackerSide", opponent: "defenderSide" };

/** What the controls read of the four Pokémon. */
type View = {
  doubles: DoublesMatchup;
  runtime: BattleRuntime;
  names: Record<DoublesSlotId, string>;
  present: (slot: DoublesSlotId) => boolean;
  build: (slot: DoublesSlotId) => BattleBuild;
  /** The move it uses this turn: none once it switched in. */
  action: (slot: DoublesSlotId) => string | null;
  learns: (slot: DoublesSlotId, moveId: string) => boolean;
  /** Its types as the turn starts (a Tera type; its earlier-turn types and added type: buildTypes). */
  types: (slot: DoublesSlotId) => string[];
  quickMoves: (slot: DoublesSlotId) => string[];
  moveName: (id: string) => string;
};

function viewOf(doubles: DoublesMatchup): View {
  const { runtime, slots } = doubles;
  const learnsets = new Map<DoublesSlotId, ReadonlySet<string>>();
  const learnset = (slot: DoublesSlotId) => {
    let known = learnsets.get(slot);
    if (!known) learnsets.set(slot, known = new Set(runtime.speciesById.get(slots[slot].build.speciesId)?.moves ?? []));
    return known;
  };
  return {
    doubles, runtime,
    names: doublesNames(slots, runtime),
    present: (slot) => !isFaintedBuild(slots[slot].build),
    build: (slot) => slots[slot].build,
    action: (slot) => historyOf(doubles, slot).switchedIn ? null : doubles.actions[slot].moveId,
    learns: (slot, moveId) => runtime.movesById.has(moveId) && learnset(slot).has(moveId),
    types: (slot) => turnTypes(slots[slot].build, historyOf(doubles, slot), runtime),
    quickMoves: (slot) => slots[slot].moves.flatMap((move) => move.moveId ? [move.moveId] : []),
    moveName: (id) => runtime.movesById.get(id)?.name ?? id,
  };
}

/** A Tera type other than Stellar replaces its types (sim/pokemon.ts getTypes), so the type controls do not apply. */
function teraTyped(build: BattleBuild): boolean {
  return build.mechanic === "tera" && !!build.configuration?.teraType && build.configuration.teraType !== "Stellar";
}
/** Arceus and Silvally keep their own types (validateBuild: "{Species} keeps its own types."). */
function typeLocked(build: BattleBuild): boolean {
  return build.speciesId.startsWith("arceus") || build.speciesId.startsWith("silvally");
}
/** The earlier-turn types the turn uses: given for this species, not under a Tera type, not on Arceus or Silvally. */
function historyTypes(build: BattleBuild, history: DoublesSlotHistory): Pick<BattleBuild, "types" | "addedType"> {
  if (typeLocked(build) || (history.typesOf !== undefined && history.typesOf !== build.speciesId)) return {};
  return {
    ...(history.types && !teraTyped(build) ? { types: [...history.types] } : {}),
    ...(history.addedType && build.mechanic !== "tera" ? { addedType: history.addedType } : {}),
  };
}
function turnTypes(build: BattleBuild, history: DoublesSlotHistory, runtime: BattleRuntime): string[] {
  return buildTypes({ ...build, ...historyTypes(build, history) }, runtime);
}

/** A copy of `value` without its undefined keys; the same object when it has none. */
function withoutUndefined<T extends object>(value: T): T {
  const keys = Object.keys(value) as (keyof T)[];
  if (keys.every((key) => value[key] !== undefined)) return value;
  const next = { ...value };
  for (const key of keys) if (next[key] === undefined) delete next[key];
  return next;
}
const sameValue = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

/** The slot's carried state with `patch` (a key at undefined is removed), bounded to its build (reconcileCarried). */
function changeCarried(slot: DoublesSlotId, patch: Partial<DoublesCarried> | ((carried: DoublesCarried) => Partial<DoublesCarried>)): EarlierChange {
  return (doubles) => {
    const current = doubles.carried[slot];
    const next = withoutUndefined({ ...current, ...(typeof patch === "function" ? patch(current) : patch) });
    const bounded = reconcileCarried(next, doubles.slots[slot].build, doubles.runtime, carriedAbilityOn(doubles, slot));
    if (sameValue(bounded, current)) return doubles;
    return { ...doubles, carried: { ...doubles.carried, [slot]: Object.keys(bounded).length ? bounded : NO_CARRIED } };
  };
}
function changeHistory(slot: DoublesSlotId, patch: Partial<DoublesSlotHistory> | ((history: DoublesSlotHistory) => Partial<DoublesSlotHistory>)): EarlierChange {
  return (doubles) => {
    const current = historyOf(doubles, slot);
    const next = withoutUndefined({ ...current, ...(typeof patch === "function" ? patch(current) : patch) });
    if (sameValue(next, current)) return doubles;
    return { ...doubles, history: { ...doubles.history, [slot]: Object.keys(next).length ? next : NO_HISTORY } };
  };
}
function changeEarlier(patch: Partial<DoublesTurnEarlier> | ((earlier: DoublesTurnEarlier) => Partial<DoublesTurnEarlier>)): EarlierChange {
  return (doubles) => {
    const current = earlierOf(doubles);
    const next = withoutUndefined({ ...current, ...(typeof patch === "function" ? patch(current) : patch) });
    if (sameValue(next, current)) return doubles;
    return { ...doubles, turnEarlier: Object.keys(next).length ? next : NO_TURN_EARLIER };
  };
}
function changeField(patch: (field: BattleConditions) => BattleConditions): EarlierChange {
  return (doubles) => {
    const field = patch(doubles.field);
    return sameValue(field, doubles.field) ? doubles : { ...doubles, field };
  };
}
const both = (...changes: EarlierChange[]): EarlierChange => (doubles) => changes.reduce((current, change) => change(current), doubles);

/** A per-side record with `side` set (or removed at undefined); undefined when it is left empty. */
function sideRecord<T>(record: Partial<Record<DoublesSideId, T>> | undefined, side: DoublesSideId, value: T | undefined): Partial<Record<DoublesSideId, T>> | undefined {
  const next = { ...record, [side]: value };
  if (value === undefined) delete next[side];
  return Object.keys(next).length ? next : undefined;
}

/** The control's issue key for each input issue field (doubles-turn.ts carriedIssues and status2Issues, model.ts validateBuild). */
const EARLIER_ISSUE_KEYS: Readonly<Record<string, string>> = {
  "carried.charging": "chargedLast", "carried.destinyBond": "destinyBond", "carried.minimize": "minimized", "carried.glaiveRush": "glaiveRush",
  "carried.laserFocus": "laserFocus", "carried.mustRecharge": "recharge", firstTurn: "notFirstTurn", earlierThisTurn: "itemEarlier",
  "carried.tarShot": "tarShot", "carried.foresight": "foresight", "carried.miracleEye": "miracleEye", "carried.nightmare": "nightmare",
  "carried.healBlock": "healBlock", "carried.berryLocked": "berryLocked", "carried.powerTrick": "powerTrick", "carried.powerShift": "powerShift",
  "carried.noRetreat": "noRetreat", "carried.onceUsed": "battleBond", "carried.defenseCurl": "defenseCurl", "carried.stockpile": "stockpile",
  types: "type", addedType: "addedType", "carried.attract": "attract", "carried.mentalHerb": "attract", "carried.embargo": "embargo",
  "carried.telekinesis": "telekinesis", "carried.octolock": "octolock", "carried.stages": "accuracy", "carried.lockOn": "lockOn",
  lastMove: "lastMove", lastItem: "lastItem", "carried.cudChew": "cudChew", "carried.stall": "stall", "carried.allySwitch": "allySwitch",
  "carried.uproar": "uproar", "carried.furyCutter": "furyCutter", "carried.rollout": "rollout", "carried.ppLeft": "ppLeft", "carried.bide": "bideStored",
  "carried.futureMove": "futureMove", "carried.leechSeed": "leechSeed", "carried.perish": "perish", "carried.trap": "trap",
  "carried.syrupBomb": "syrupBomb", "carried.wish": "wish", replacement: "replacement",
  // The field's and the sides' (issues.field; validateConditions and the turn-level inputs).
  entryOrder: "enteredFirst", battleLastMove: "battleLastMove", echoedVoice: "echoedVoice", "fieldTurns.terrain": "terrainEnds",
  "fieldTurns.gravity": "gravityEnds", "fieldTurns.magicRoom": "magicRoomEnds", mudSport: "mudSport", waterSport: "waterSport",
};

/** The input issues of one Pokémon (or of the field) by earlier-turn control key, as "{name}: …" (or as given, `name` null). */
export function earlierIssueTexts(issues: readonly BuildIssue[] | undefined, name: string | null): Partial<Record<string, string>> {
  const out: Partial<Record<string, string>> = {};
  for (const issue of issues ?? []) {
    const side = /^(attackerSide|defenderSide)\.(safeguard|mist|luckyChant|gmaxResidual)$/.exec(issue.field);
    const key = side ? `${side[1]}.${side[2]}` : EARLIER_ISSUE_KEYS[issue.field];
    if (!key) continue;
    const text = name ? `${name}: ${issue.message}` : issue.message;
    out[key] = out[key] ? `${out[key]} ${text}` : text;
  }
  return out;
}

const counts = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, index) => from + index);
const signed = (stage: number) => stage > 0 ? `+${stage}` : stage < 0 ? `−${-stage}` : "0";
/** The stall and Ally Switch counters: n in a row before this turn is 3^n (0: 1, no assumption; C23). */
const inARow = (counter: number | undefined) => counter === undefined ? "" : String(Math.round(Math.log(counter) / Math.log(3)));

/**
 * One Pokémon's earlier-turn controls beyond today's (ADDENDUM2 §5.2's per-Pokémon tables, IN §5.2), in the table's order:
 * the checkboxes, then the selects. Each is shown when this turn can read it or while it is set; a Pokémon that has fainted
 * shows none. `issues`: the turn's input issues of this Pokémon (DoublesIssues.pokemon[slot]).
 */
export function earlierSlotControls(doubles: DoublesMatchup, slot: DoublesSlotId, issues?: readonly BuildIssue[]): EarlierControl[] {
  const view = viewOf(doubles);
  if (!view.present(slot)) return [];
  const { runtime, names, learns, moveName } = view;
  const game = runtime.profile.id;
  const combatant = doubles.slots[slot];
  const build = combatant.build;
  const carried = doubles.carried[slot];
  const history = historyOf(doubles, slot);
  const action = view.action(slot);
  const move = action ? runtime.movesById.get(action) : undefined;
  const species = runtime.speciesById.get(build.speciesId);
  const others = DOUBLES_SLOTS.filter((other) => other !== slot && view.present(other));
  // Foes first, then the ally (C32: an ally may be a seeder, trapper or Syrup Bomb source).
  const sources = [...others.filter((other) => slotSide(other) !== slotSide(slot)), ...others.filter((other) => slotSide(other) === slotSide(slot))];
  const foes = sources.filter((other) => slotSide(other) !== slotSide(slot));
  // Review 2, round 2 (R6-r2-3): a Pokémon that switched in this turn was on the bench at last turn's end, so it is the source of
  // no Attract, Octolock, Lock-On, partial trap or Syrup Bomb (they end as their source leaves: data/moves.ts attract, syrupbomb
  // onUpdate; data/conditions.ts partiallytrapped onResidual).
  const stayed = (other: DoublesSlotId) => !historyOf(doubles, other).switchedIn;
  const texts = earlierIssueTexts(issues, names[slot]);
  const out: EarlierControl[] = [];
  const attr = (name: string) => `data-doubles-${name}`;
  const check = (key: string, name: string, show: boolean, label: string, checked: boolean, set: (on: boolean) => EarlierChange, toggle = true) => {
    if (show || checked) out.push({ kind: "check", key, label, attr: attr(name), attrValue: slot, checked, issue: texts[key], toggle: toggle && checked, set });
  };
  const select = (key: string, name: string, show: boolean, label: string, value: string, choices: EarlierChoice[], set: (value: string) => EarlierChange, isSet: boolean, toggle: boolean) => {
    if (!show && !isSet) return;
    // A value set earlier stays visible among the choices (never hidden), a Pokémon by its name.
    const listed = choices.some((choice) => choice.value === value) ? choices
      : [...choices, { value, label: DOUBLES_SLOTS.includes(value as DoublesSlotId) ? names[value as DoublesSlotId] : value }];
    out.push({ kind: "select", key, label, attr: attr(name), attrValue: slot, value, choices: listed, issue: texts[key], toggle: toggle && isSet, set });
  };
  const named = (each: DoublesSlotId) => ({ value: each, label: names[each] });
  const flag = (on: boolean) => on ? true as const : undefined;
  const numberOr = (value: string) => value === "" ? undefined : Number(value);

  // ---- checkboxes ----
  const twoTurn = !!action && EARLIER_TABLES.twoTurn.has(action) && !combatant.contexts[action]?.useZ && !isMaxActive(build);
  check("chargedLast", "charged-last", twoTurn, `${moveName(carried.charging ?? action ?? "")} charged last turn`, carried.charging !== undefined,
    (on) => changeCarried(slot, { charging: on && action ? action : undefined }));
  check("destinyBond", "destiny-bond", learns(slot, "destinybond"), "Destiny Bond from last turn", !!carried.destinyBond, (on) => changeCarried(slot, { destinyBond: flag(on) }));
  check("minimized", "minimized", learns(slot, "minimize"), "Minimized", !!carried.minimize, (on) => changeCarried(slot, { minimize: flag(on) }));
  check("glaiveRush", "glaive-rush", learns(slot, "glaiverush"), "Glaive Rush last turn", !!carried.glaiveRush, (on) => changeCarried(slot, { glaiveRush: flag(on) }));
  check("laserFocus", "laser-focus", (game === "sword_shield" || game === "ultra_sun_ultra_moon") && learns(slot, "laserfocus") && !!move && move.category !== "Status",
    "Laser Focus last turn", !!carried.laserFocus, (on) => changeCarried(slot, { laserFocus: flag(on) }));
  check("recharge", "recharge", action === null && !history.switchedIn && [...RECHARGE_MOVES].some((id) => learns(slot, id)), "Recharging", !!carried.mustRecharge,
    (on) => changeCarried(slot, { mustRecharge: flag(on) }));
  check("notFirstTurn", "not-first-turn", action === "fakeout" || action === "firstimpression", "Not its first turn", history.firstTurn === false,
    (on) => changeHistory(slot, { firstTurn: on ? false : undefined }));
  const raisedBy = others.some((other) => {
    const used = view.action(other);
    return (used === "burningjealousy" && slotSide(other) !== slotSide(slot)) || used === "alluringvoice";
  });
  const earlier = (patch: Partial<NonNullable<DoublesSlotHistory["earlierThisTurn"]>>) => changeHistory(slot, (current) => {
    const next = withoutUndefined({ ...current.earlierThisTurn, ...patch });
    return { earlierThisTurn: Object.keys(next).length ? next : undefined };
  });
  check("raisedEarlier", "raised-earlier", raisedBy, "Stats rose earlier this turn", !!history.earlierThisTurn?.statsRaised, (on) => earlier({ statsRaised: flag(on) }));
  const pickupBy = others.some((other) => view.build(other).abilityId === "pickup" && !view.build(other).itemId);
  check("itemEarlier", "item-earlier", pickupBy && !build.itemId && typeof history.lastItem === "string", "Used an item earlier this turn",
    !!history.earlierThisTurn?.usedItem, (on) => earlier({ usedItem: flag(on) }));
  check("tarShot", "tar-shot", others.some((other) => learns(other, "tarshot")), "Tar Shot", !!carried.tarShot, (on) => changeCarried(slot, { tarShot: flag(on) }));
  const types = view.types(slot);
  // Foresight and Miracle Eye cannot both be on it (doubles-turn.ts status2Issues): ticking one clears the other.
  check("foresight", "foresight", types.includes("Ghost") && others.some((other) => learns(other, "foresight") || learns(other, "odorsleuth")), "Foresight",
    !!carried.foresight, (on) => changeCarried(slot, on ? { foresight: true, miracleEye: undefined } : { foresight: undefined }));
  check("miracleEye", "miracle-eye", types.includes("Dark") && others.some((other) => learns(other, "miracleeye")), "Miracle Eye",
    !!carried.miracleEye, (on) => changeCarried(slot, on ? { miracleEye: true, foresight: undefined } : { miracleEye: undefined }));
  check("nightmare", "nightmare", (build.status === "slp" || build.abilityId === "comatose") && foes.some((other) => learns(other, "nightmare")), "Nightmare",
    !!carried.nightmare, (on) => changeCarried(slot, { nightmare: flag(on) }));
  // Scarlet/Violet and Champions: Psychic Noise's Heal Block has 1 turn left on the next turn (IN-P15). USUM: a select below.
  const usumHealBlock = runtime.movesById.has("healblock");
  check("healBlock", "heal-block", !usumHealBlock && foes.some((other) => learns(other, "psychicnoise")), "Heal Block", !usumHealBlock && carried.healBlock !== undefined,
    (on) => changeCarried(slot, { healBlock: on ? 1 : undefined }));
  check("berryLocked", "berry-locked", (build.abilityId === "berserk" || build.abilityId === "angershell") && EARLIER_TABLES.healingBerries.has(build.itemId),
    "Berry locked", !!carried.berryLocked, (on) => changeCarried(slot, { berryLocked: flag(on) }));
  check("powerTrick", "power-trick", learns(slot, "powertrick"), "Power Trick", !!carried.powerTrick, (on) => changeCarried(slot, { powerTrick: flag(on) }));
  check("powerShift", "power-shift", learns(slot, "powershift"), "Power Shift", !!carried.powerShift, (on) => changeCarried(slot, { powerShift: flag(on) }));
  check("noRetreat", "no-retreat", action === "noretreat", "No Retreat", !!carried.noRetreat, (on) => changeCarried(slot, { noRetreat: flag(on) }));
  // Battle Bond counts once a battle in Scarlet/Violet only (C22).
  check("battleBond", "battle-bond", game === "scarlet_violet" && build.abilityId === "battlebond", "Battle Bond used", !!carried.onceUsed?.includes("battlebond"),
    (on) => changeCarried(slot, (current) => {
      const rest = (current.onceUsed ?? []).filter((id) => id !== "battlebond");
      const next = on ? [...rest, "battlebond" as const] : rest;
      return { onceUsed: next.length ? next : undefined };
    }));
  check("defenseCurl", "defense-curl", action === "rollout" || action === "iceball", "Defense Curl", !!carried.defenseCurl, (on) => changeCarried(slot, { defenseCurl: flag(on) }));
  check("bideRelease", "bide-release", game === "ultra_sun_ultra_moon" && action === "bide" && !!carried.bide, "Bide releases this turn", !!carried.bide?.release,
    (on) => changeCarried(slot, (current) => current.bide ? { bide: { ...current.bide, release: on } } : {}));
  check("drowsy", "drowsy", !build.status && others.some((other) => learns(other, "yawn")), "Drowsy", !!carried.yawn, (on) => changeCarried(slot, { yawn: flag(on) }));
  check("saltCure", "salt-cure", foes.some((other) => learns(other, "saltcure")), "Salt Cure", !!carried.saltCure, (on) => changeCarried(slot, { saltCure: flag(on) }));
  check("aquaRing", "aqua-ring", learns(slot, "aquaring"), "Aqua Ring", !!carried.aquaRing, (on) => changeCarried(slot, { aquaRing: flag(on) }));
  check("ingrain", "ingrain", learns(slot, "ingrain"), "Ingrain", !!carried.ingrain, (on) => changeCarried(slot, { ingrain: flag(on) }));
  check("curse", "curse", others.some((other) => view.types(other).includes("Ghost") && learns(other, "curse")), "Cursed", !!carried.curse,
    (on) => changeCarried(slot, { curse: flag(on) }));

  // ---- selects ----
  const stockpiling = (id: string | null) => !!id && EARLIER_TABLES.stockpile.has(id);
  const layers = carried.stockpile?.layers ?? 0;
  select("stockpile", "stockpile", stockpiling(action) || (action === "snatch" && others.some((other) => stockpiling(view.action(other)))), "Stockpile", String(layers),
    counts(0, 3).map((count) => ({ value: String(count), label: String(count) })),
    (value) => changeCarried(slot, { stockpile: Number(value) ? { layers: Number(value) as 1 | 2 | 3 } : undefined }), layers > 0, true);

  // Type, Second type (IN §5.2): its species' types by default; a used Protean or Libero starts at Unknown (typeUnknown).
  const own = species?.types ?? [];
  const given = historyTypes(build, history).types;
  const proteanUsed = (build.abilityId === "protean" || build.abilityId === "libero") && !build.abilityActive;
  const typeReader = ["protean", "libero", "colorchange"].includes(build.abilityId) || EARLIER_TABLES.ownTypeMoves.some((id) => learns(slot, id))
    || others.some((other) => learns(other, "soak") || learns(other, "magicpowder"));
  if (!teraTyped(build) && !typeLocked(build) && (typeReader || given !== undefined)) {
    const unknown = proteanUsed && given === undefined;
    const current = given ?? own;
    const setTypes = (first: string, second: string): EarlierChange => {
      if (!first) return changeHistory(slot, { types: undefined, typesOf: undefined });
      const next = [...new Set([first, second].filter(Boolean))];
      const same = next.length === own.length && next.every((type, index) => type === own[index]);
      return changeHistory(slot, (currentHistory) => same && !proteanUsed
        ? { types: undefined, typesOf: currentHistory.addedType ? build.speciesId : undefined }
        : { types: next, typesOf: build.speciesId });
    };
    const changed = given !== undefined && !(given.length === own.length && given.every((type, index) => type === own[index]));
    const choices = TYPE_CHOICES.map((type) => ({ value: type, label: type }));
    out.push({ kind: "select", key: "type", label: "Type", attr: attr("type"), attrValue: slot, value: unknown ? "" : current[0] ?? "",
      choices: unknown ? [{ value: "", label: "Unknown" }, ...choices] : choices, issue: texts.type, toggle: changed,
      set: (value) => setTypes(value, unknown ? own[1] ?? "" : current[1] ?? "") });
    out.push({ kind: "select", key: "type2", label: "Second type", attr: attr("type2"), attrValue: slot, value: current[1] ?? "",
      choices: [{ value: "", label: "None" }, ...choices], toggle: false,
      set: (value) => setTypes(current[0] ?? own[0] ?? "", value) });
  }
  // Added type: Forest's Curse (Grass) or Trick-or-Treat (Ghost) from a Pokémon of the turn; none on a Terastallized Pokémon.
  const forest = others.some((other) => learns(other, "forestscurse"));
  const trick = others.some((other) => learns(other, "trickortreat"));
  const added = history.addedType ?? "";
  if (build.mechanic !== "tera" && !typeLocked(build)) {
    select("addedType", "added-type", forest || trick, "Added type", added, [
      { value: "", label: "None" }, ...(forest || added === "Grass" ? [{ value: "Grass", label: "Grass" }] : []), ...(trick || added === "Ghost" ? [{ value: "Ghost", label: "Ghost" }] : []),
    ], (value) => changeHistory(slot, (current) => ({
      addedType: value === "Grass" || value === "Ghost" ? value : undefined,
      typesOf: value || current.types ? build.speciesId : undefined,
    })), !!added, true);
  }
  // Infatuated by: another Pokémon of the opposite gender (or a gender not set) that learns Attract or has Cute Charm.
  const gender = (each: DoublesSlotId) => getBuildGender(view.build(each), runtime);
  const opposite = (other: DoublesSlotId) => {
    const mine = gender(slot), theirs = gender(other);
    if (mine === "N" || theirs === "N") return false;
    return !mine || !theirs || mine !== theirs;
  };
  const attractors = others.filter((other) => stayed(other) && (learns(other, "attract") || view.build(other).abilityId === "cutecharm") && opposite(other));
  select("attract", "attract", attractors.length > 0, "Infatuated by", carried.attract ?? "",
    [{ value: "", label: "None" }, ...uniqueSlots([...attractors, ...(carried.attract ? [carried.attract] : [])]).map(named)],
    (value) => changeCarried(slot, { attract: (value || undefined) as DoublesSlotId | undefined }), !!carried.attract, true);
  // USUM: Heal Block, Embargo and Telekinesis turns left (1: it ends at this end of turn).
  const turnsLeft = (key: "healBlock" | "embargo" | "telekinesis", name: string, moveId: string, label: string, most: number) => {
    const value = carried[key];
    select(key, name, runtime.movesById.has(moveId) && others.some((other) => learns(other, moveId)), label, value === undefined ? "" : String(value),
      [{ value: "", label: "None" }, ...counts(1, most).map((count) => ({ value: String(count), label: String(count) }))],
      (next) => changeCarried(slot, { [key]: numberOr(next) } as Partial<DoublesCarried>), value !== undefined && (key !== "healBlock" || usumHealBlock), true);
  };
  if (usumHealBlock) turnsLeft("healBlock", "heal-block-turns", "healblock", "Heal Block turns left", 4);
  turnsLeft("embargo", "embargo", "embargo", "Embargo turns left", 4);
  turnsLeft("telekinesis", "telekinesis", "telekinesis", "Telekinesis turns left", 2);
  const octolockers = foes.filter((other) => stayed(other) && learns(other, "octolock"));
  select("octolock", "octolock", octolockers.length > 0, "Octolock by", carried.octolock ?? "",
    [{ value: "", label: "None" }, ...uniqueSlots([...octolockers, ...(carried.octolock ? [carried.octolock] : [])]).map(named)],
    (value) => changeCarried(slot, { octolock: (value || undefined) as DoublesSlotId | undefined }), !!carried.octolock, true);
  // Accuracy and evasion stages: its move or a move into it this turn reads them (IN §5.2).
  const readsStages = (!!action && EARLIER_TABLES.stageReaders.has(action)) || others.some((other) => {
    const used = view.action(other);
    const target = doubles.actions[other].target;
    return !!used && EARLIER_TABLES.stageReaders.has(used) && (target === slot || target === null);
  });
  for (const [stat, name, label] of [["accuracy", "accuracy", "Accuracy stage"], ["evasion", "evasion", "Evasion stage"]] as const) {
    const stage = carried.stages?.[stat] ?? 0;
    select(stat, name, readsStages, label, String(stage), counts(-6, 6).map((count) => ({ value: String(count), label: signed(count) })),
      (value) => changeCarried(slot, (current) => {
        const next = withoutUndefined({ ...current.stages, [stat]: Number(value) || undefined });
        return { stages: Object.keys(next).length ? next : undefined };
      }), stage !== 0, true);
  }
  const lockers = learns(slot, "lockon") || learns(slot, "mindreader");
  select("lockOn", "lock-on", lockers, "Locked on to", carried.lockOn ?? "",
    [{ value: "", label: "None" }, ...uniqueSlots([...foes.filter(stayed), ...(carried.lockOn ? [carried.lockOn] : [])]).map(named)],
    (value) => changeCarried(slot, { lockOn: (value || undefined) as DoublesSlotId | undefined }), !!carried.lockOn, true);
  // Last move (Q3: Unknown by default): Disable, Encore, Instruct, Mirror Move or Conversion 2 of the turn can reach it (pinned
  // conversion2 onHit reads its target's lastMoveUsed: data/moves.ts; a fainted target's retarget or a Spotlight can bring it here).
  const lastValue = history.lastMove === undefined ? "" : history.lastMove === null ? "none" : history.lastMove;
  const lastChoices = uniqueStrings([...view.quickMoves(slot), ...(action ? [action] : []), ...(typeof history.lastMove === "string" ? [history.lastMove] : [])]);
  select("lastMove", "last-move", others.some((other) => EARLIER_TABLES.lastMoveReaders.has(view.action(other) ?? "")), "Last move", lastValue,
    [{ value: "", label: "Unknown" }, { value: "none", label: "None since it came in" }, ...lastChoices.map((id) => ({ value: id, label: moveName(id) }))],
    (value) => changeHistory(slot, (current) => {
      const next = value === "" ? undefined : value === "none" ? null : value;
      return { lastMove: next, lastMoveTarget: next === current.lastMove ? current.lastMoveTarget : undefined };
    }), history.lastMove !== undefined, false);
  // Last move's target (Instruct): its last move is a single-target move.
  const lastTarget = typeof history.lastMove === "string" ? runtime.movesById.get(history.lastMove)?.target : undefined;
  const targetChoices = [...sources, ...(lastTarget === "adjacentAllyOrSelf" ? [slot] : [])];
  const targetValue = history.lastMoveTarget ?? "";
  select("lastTarget", "last-target", others.some((other) => view.action(other) === "instruct") && !!lastTarget && EARLIER_TABLES.singleTargets.has(lastTarget),
    "Last move's target", targetValue, [{ value: "", label: "Unknown" }, ...uniqueSlots([...targetChoices, ...(history.lastMoveTarget ? [history.lastMoveTarget] : [])]).map(named)],
    (value) => changeHistory(slot, { lastMoveTarget: (value || undefined) as DoublesSlotId | undefined }), history.lastMoveTarget !== undefined, false);
  // Item used earlier (Q4: Unknown by default): Recycle, Harvest, a Pickup holder or a G-Max Replenish user on its side.
  const replenish = DOUBLES_SLOTS.some((other) => view.present(other) && slotSide(other) === slotSide(slot) && view.build(other).mechanic === "gigantamax"
    && runtime.speciesById.get(view.build(other).speciesId)?.canGigantamax === "gmaxreplenish"
    && (() => { const used = view.action(other); const known = used ? runtime.movesById.get(used) : undefined; return known?.type === "Normal" && known.category !== "Status"; })());
  const recycle = action === "recycle";
  const itemValue = history.lastItem === undefined ? "" : history.lastItem === null ? "none" : history.lastItem;
  const berriesOnly = !recycle && !pickupBy;
  const { berries, others: otherItems } = itemsOf(runtime);
  const itemChoices = [...berries, ...(berriesOnly ? [] : otherItems)];
  select("lastItem", "last-item", !build.itemId && (recycle || build.abilityId === "harvest" || pickupBy || replenish), "Item used earlier", itemValue,
    [{ value: "", label: "Unknown" }, { value: "none", label: "None" }, ...itemChoices.map((item) => ({ value: item.id, label: item.name })),
      ...(typeof history.lastItem === "string" && !itemChoices.some((item) => item.id === history.lastItem) ? [{ value: history.lastItem, label: runtime.itemsById.get(history.lastItem)?.name ?? history.lastItem }] : [])],
    (value) => changeHistory(slot, (current) => {
      const next = value === "" ? undefined : value === "none" ? null : value;
      const used = typeof next === "string" ? current.earlierThisTurn : withoutUndefined({ ...current.earlierThisTurn, usedItem: undefined });
      return { lastItem: next, earlierThisTurn: used && Object.keys(used).length ? used : undefined };
    }), history.lastItem !== undefined, false);
  // Berry eaten last turn (Cud Chew; C29: None by default, the end of turn's fact).
  const cudValue = carried.cudChew === undefined ? "" : carried.cudChew === true ? "unknown" : carried.cudChew;
  select("cudChew", "cud-chew", build.abilityId === "cudchew", "Berry eaten last turn", cudValue,
    [{ value: "", label: "None" }, ...(carried.cudChew === true ? [{ value: "unknown", label: "Unknown" }] : []), ...berries.map((item) => ({ value: item.id, label: item.name }))],
    (value) => changeCarried(slot, { cudChew: value === "" ? undefined : value === "unknown" ? true : value }), carried.cudChew !== undefined, false);
  // The stall and Ally Switch counters (C23): — is the turn's fact; n in a row is 3^n (0: 1).
  const rowChoices = [{ value: "", label: "—" }, ...counts(0, 6).map((count) => ({ value: String(count), label: String(count) }))];
  const counter = (value: string) => value === "" ? undefined : Math.min(729, 3 ** Number(value)) as 1 | 3 | 9 | 27 | 81 | 243 | 729;
  const protecting = !!action && (EARLIER_TABLES.protecting.has(action) || (isMaxActive(build) && move?.category === "Status")) || calledProtect(doubles, slot);
  select("stall", "stall", protecting, "Protecting moves in a row", inARow(carried.stall), rowChoices,
    (value) => changeCarried(slot, { stall: counter(value) }), carried.stall !== undefined, false);
  select("allySwitch", "ally-switch", (game === "scarlet_violet" || game === "champions") && action === "allyswitch", "Ally Switch in a row", inARow(carried.allySwitch), rowChoices,
    (value) => changeCarried(slot, { allySwitch: counter(value) }), carried.allySwitch !== undefined, false);
  select("uproar", "uproar", action === "uproar", "Uproar turns left", carried.uproar === undefined ? "" : String(carried.uproar),
    [{ value: "", label: "—" }, { value: "1", label: "1" }, { value: "2", label: "2" }],
    (value) => changeCarried(slot, { uproar: numberOr(value) as 1 | 2 | undefined }), carried.uproar !== undefined, false);
  const fromZero = [{ value: "", label: "Unknown" }, ...counts(0, 4).map((count) => ({ value: String(count), label: String(count) }))];
  select("furyCutter", "fury-cutter", action === "furycutter", "Fury Cutter uses in a row", carried.furyCutter === undefined ? "" : String(carried.furyCutter), fromZero,
    (value) => changeCarried(slot, { furyCutter: numberOr(value) as 0 | 1 | 2 | 3 | 4 | undefined }), carried.furyCutter !== undefined, false);
  select("rollout", "rollout", action === "rollout" || action === "iceball", `${moveName(action === "iceball" ? "iceball" : "rollout")} hits so far`,
    carried.rollout === undefined ? "" : String(carried.rollout), fromZero,
    (value) => changeCarried(slot, { rollout: numberOr(value) as 0 | 1 | 2 | 3 | 4 | undefined }), carried.rollout !== undefined, false);
  const pp = carried.ppLeft?.trumpcard;
  select("ppLeft", "pp-left", runtime.movesById.has("trumpcard") && action === "trumpcard", "PP left", pp === undefined ? "" : String(pp),
    [{ value: "", label: "Unknown" }, ...counts(1, 8).map((count) => ({ value: String(count), label: String(count) }))],
    (value) => changeCarried(slot, (current) => {
      const next = withoutUndefined({ ...current.ppLeft, trumpcard: numberOr(value) });
      return { ppLeft: Object.keys(next).length ? next as Record<string, number> : undefined };
    }), pp !== undefined, false);
  // Bide (USUM, C41): — is a first use (the turn's fact); the damage stored, and the Pokémon that last damaged it.
  if ((game === "ultra_sun_ultra_moon" && action === "bide") || carried.bide) {
    out.push({ kind: "number", key: "bideStored", label: "Bide stored", attr: attr("bide-stored"), attrValue: slot, value: carried.bide?.stored ?? null, min: 0,
      issue: texts.bideStored, toggle: !!carried.bide,
      set: (stored) => changeCarried(slot, (current) => ({ bide: stored === null ? undefined : { stored, source: current.bide?.source ?? null, release: current.bide?.release ?? false } })) });
  }
  if (carried.bide) {
    const source = carried.bide.source;
    select("bideFrom", "bide-from", true, "Bide from", source ?? "", [{ value: "", label: "None" }, ...uniqueSlots([...sources, ...(source ? [source] : [])]).map(named)],
      (value) => changeCarried(slot, (current) => current.bide ? { bide: { ...current.bide, source: (value || null) as DoublesSlotId | null } } : {}), false, false);
  }
  // Lands this turn: Future Sight or Doom Desire from a Pokémon of the turn other than it (its user as it is now: IN-P10), or
  // (status2 R-U, ADDENDUM2 §5.3) from a bench Pokémon of either side: its build as it is on the bench (`build`: not in battle).
  const future = carried.futureMove;
  const bench = benchOf(doubles);
  const benchNames = benchNamesOf(doubles);
  const benched = (["own", "opponent"] as const).flatMap((side) => bench[side].map((entry, index) => ({ side, entry, index })));
  const futureBench = new Map<string, DoublesBenchEntry>();
  const benchLearns = (entry: DoublesBenchEntry, id: string) => runtime.movesById.has(id) && !!runtime.speciesById.get(entry.base.speciesId)?.moves.includes(id);
  const benchValue = (id: string, side: DoublesSideId, index: number) => `bench:${id}:${side}:${index}`;
  const fromBench = history.futureFrom !== undefined && future && typeof future === "object" && "build" in future ? benched.find((each) => each.entry.key === history.futureFrom) : undefined;
  const futureValue = future === undefined ? "" : typeof future === "string" ? `bare:${future}` : "source" in future ? `${future.move}:${future.source}`
    : fromBench ? benchValue(future.move, fromBench.side, fromBench.index) : `build:${future.move}`;
  const futureChoices = [
    ...sources.flatMap((other) => (["futuresight", "doomdesire"] as const).filter((id) => learns(other, id))
      .map((id) => ({ value: `${id}:${other}`, label: `${moveName(id)} from ${names[other]}` }))),
    ...benched.flatMap(({ side, entry, index }) => (["futuresight", "doomdesire"] as const).filter((id) => benchLearns(entry, id)).map((id) => {
      futureBench.set(benchValue(id, side, index), entry);
      return { value: benchValue(id, side, index), label: `${moveName(id)} from ${benchNames[entry.key]}` };
    })),
  ];
  const futureSet = future === undefined ? [] : typeof future === "string" ? [{ value: futureValue, label: moveName(future) }]
    : "source" in future ? [{ value: futureValue, label: `${moveName(future.move)} from ${names[future.source]}` }]
    : fromBench ? [{ value: futureValue, label: `${moveName(future.move)} from ${benchNames[fromBench.entry.key]}` }] : [{ value: futureValue, label: moveName(future.move) }];
  select("futureMove", "future-move", futureChoices.length > 0, "Lands this turn", futureValue,
    [{ value: "", label: "None" }, ...futureChoices, ...futureSet.filter((entry) => !futureChoices.some((choice) => choice.value === entry.value))],
    (value) => {
      if (!value) return both(changeCarried(slot, { futureMove: undefined }), changeHistory(slot, { futureFrom: undefined }));
      const entry = futureBench.get(value);
      const [id, from] = entry ? [value.split(":")[1], null] : value.split(":");
      if (id !== "futuresight" && id !== "doomdesire") return (doubles) => doubles;
      if (entry) return both(changeCarried(slot, { futureMove: { move: id, build: benchBuild(entry) } }), changeHistory(slot, { futureFrom: entry.key }));
      if (!DOUBLES_SLOTS.includes(from as DoublesSlotId)) return (doubles) => doubles;
      return both(changeCarried(slot, { futureMove: { move: id, source: from as DoublesSlotId } }), changeHistory(slot, { futureFrom: undefined }));
    }, future !== undefined, true);
  // The status-eot fields (IN §0 item 4, with C32's ally sources).
  select("leechSeed", "leech-seed", !types.includes("Grass") && others.some((other) => learns(other, "leechseed")), "Leech Seed", carried.leechSeed ?? "",
    [{ value: "", label: "None" }, ...uniqueSlots([...sources, ...(carried.leechSeed ? [carried.leechSeed] : [])]).map((each) => ({ value: each, label: `Heals ${names[each]}` }))],
    (value) => changeCarried(slot, { leechSeed: (value || undefined) as DoublesSlotId | undefined }), !!carried.leechSeed, true);
  select("perish", "perish", DOUBLES_SLOTS.some((each) => view.present(each) && (learns(each, "perishsong") || view.build(each).abilityId === "perishbody")), "Perish count",
    carried.perish === undefined ? "" : String(carried.perish), [{ value: "", label: "None" }, ...[3, 2, 1].map((count) => ({ value: String(count), label: String(count) }))],
    (value) => changeCarried(slot, { perish: numberOr(value) as 1 | 2 | 3 | undefined }), carried.perish !== undefined, true);
  const trappers = sources.filter((other) => stayed(other) && [...EARLIER_TABLES.trapping].some((id) => learns(other, id)));
  select("trap", "trap", trappers.length > 0, "Trapped by", carried.trap?.source ?? "",
    [{ value: "", label: "None" }, ...uniqueSlots([...trappers, ...(carried.trap ? [carried.trap.source] : [])]).map(named)],
    (value) => (doubles) => changeCarried(slot, { trap: value ? trapFrom(doubles, value as DoublesSlotId) : undefined })(doubles), !!carried.trap, true);
  const syrup = sources.filter((other) => stayed(other) && learns(other, "syrupbomb"));
  select("syrupBomb", "syrup-bomb", syrup.length > 0, "Syrup Bomb from", carried.syrupBomb ?? "",
    [{ value: "", label: "None" }, ...uniqueSlots([...syrup, ...(carried.syrupBomb ? [carried.syrupBomb] : [])]).map(named)],
    (value) => changeCarried(slot, { syrupBomb: (value || undefined) as DoublesSlotId | undefined }), !!carried.syrupBomb, true);
  // Wish lands: from it or its ally (half that Pokémon's maximum HP, PS/data/moves.ts wish).
  const wishers = [slot, allyOf(slot)].filter((each) => view.present(each) && learns(each, "wish"));
  const wish = carried.wish;
  const wishSlot = wish === undefined ? undefined
    : history.wishFrom && wishHP(doubles, history.wishFrom) === wish ? history.wishFrom : wishers.find((each) => wishHP(doubles, each) === wish);
  const wishValue = wish === undefined ? "" : wishSlot ?? `hp:${wish}`;
  select("wish", "wish", wishers.length > 0, "Wish lands", wishValue,
    [{ value: "", label: "None" }, ...wishers.map((each) => ({ value: each, label: `From ${names[each]}` })),
      ...(wish !== undefined && !wishSlot ? [{ value: `hp:${wish}`, label: `+${wish} HP` }] : wishSlot && !wishers.includes(wishSlot) ? [{ value: wishSlot, label: `From ${names[wishSlot]}` }] : [])],
    (value) => {
      if (!value) return both(changeCarried(slot, { wish: undefined }), changeHistory(slot, { wishFrom: undefined }));
      if (value.startsWith("hp:")) return (doubles) => doubles;
      const from = value as DoublesSlotId;
      return (doubles) => {
        const hp = wishHP(doubles, from);
        return hp === null ? doubles : both(changeCarried(slot, { wish: hp }), changeHistory(slot, { wishFrom: from }))(doubles);
      };
    }, wish !== undefined, true);
  // status2 R-U (IN §5.7): Replacement, for a Pokémon that can switch out by its player's choice while its side has a bench. Its
  // default is the turn's (the first bench Pokémon not in play then, with the turn fact "Assumes {Newcomer} comes in for {Name}.").
  const ownBench = bench[slotSide(slot)];
  const pick = bench.picks[slot];
  if (ownBench.length || pick !== undefined) {
    select("replacement", "replacement", ownBench.length > 0 && choosesSwitch(view, slot), "Replacement", pick ?? "",
      [{ value: "", label: "Next on the bench" }, ...ownBench.map((entry) => ({ value: entry.key, label: benchNames[entry.key] ?? entry.source.name }))],
      (value) => setBenchPick(slot, value || undefined), pick !== undefined, false);
  }
  // Review 2 (R6-5): a Pokémon that switched in this turn carries nothing a switch clears (switchDoublesIn): only its
  // history's controls, the once-a-battle flags, the PP, the slot's Wish and Future Sight, Replacement and its accuracy and
  // evasion stages stay (SWITCHED_IN_CONTROLS).
  return history.switchedIn ? out.filter((control) => SWITCHED_IN_CONTROLS.has(control.key)) : out;
}

/**
 * The slot controls a Pokémon that switched in this turn keeps (earlierSlotControls): what happened earlier this turn, its last
 * item, Battle Bond, PP, Wish, Lands this turn, Replacement, and its accuracy and evasion stages (an entry before the moves can
 * change them: Supersweet Syrup). Not its Last move or types: a switch clears them (PS/sim/pokemon.ts clearVolatile: lastMove
 * null, setSpecies(baseSpecies)).
 */
const SWITCHED_IN_CONTROLS: ReadonlySet<string> = new Set(["raisedEarlier", "itemEarlier", "lastItem", "battleBond", "ppLeft", "futureMove", "wish",
  "replacement", "accuracy", "evasion"]);

// ---------- status2 Track R-U: the Bench, the Replacement and the Hazards (IN §5.7, ADDENDUM2 §5.3) ----------

/** The two slots of `side`. */
const sideSlots = (side: DoublesSideId) => DOUBLES_SLOTS.filter((slot) => slotSide(slot) === side);

/**
 * The Pokémon can switch out by its player's choice this turn (the Replacement's reader; F4 §5.4's chosen triggers): it holds
 * an Eject Button or Eject Pack, has Emergency Exit or Wimp Out, or its action is a switching move (Teleport from generation 8
 * on; not as a Max Move, nor a damaging one as a Z-Move, which do not switch).
 */
function choosesSwitch(view: View, slot: DoublesSlotId): boolean {
  if (!view.present(slot)) return false;
  const build = view.build(slot);
  if (EARLIER_TABLES.switchItems.has(build.itemId) || EARLIER_TABLES.switchAbilities.has(build.abilityId)) return true;
  if (isMaxActive(build)) return false;
  // Review 2 (R6-7): a switching move a calling move or an Instruct may use (calledMoves).
  const switching = (id: string) => EARLIER_TABLES.chosenSwitch.has(id) && !(id === "teleport" && view.runtime.profile.id === "ultra_sun_ultra_moon");
  if (calledMoves(view, slot).some(switching)) return true;
  const action = view.action(slot);
  if (!action || !switching(action)) return false;
  return !(view.doubles.slots[slot].contexts[action]?.useZ && view.runtime.movesById.get(action)?.category !== "Status");
}

/**
 * The moves `slot` may use this turn other than its action (status2 gap fix): Sleep Talk one of its prepared moves; Copycat
 * and Mirror Move one used before it (any Pokémon's action this turn, the battle's last move from before the turn, a
 * Pokémon's last move). Review 2 (R6-7): its last move, when an Instruct of the turn can reach it (instructReaches; PS/data/moves.ts
 * instruct re-runs lastMove); Me First (Ultra Sun/Ultra Moon) its target's move, every foe's with none
 * given (mefirst onTryHit uses the target's queued move).
 */
function calledMoves(view: View, slot: DoublesSlotId): string[] {
  const action = view.action(slot);
  const last = historyOf(view.doubles, slot).lastMove;
  const instructed = typeof last === "string" && instructReaches(view.doubles, slot) ? [last] : [];
  if (action === "sleeptalk") return [...instructed, ...view.doubles.slots[slot].moves.flatMap((each) => (each.moveId ? [each.moveId] : []))];
  if (action === "mefirst") {
    const target = view.doubles.actions[slot].target;
    const foes = target ? [target] : DOUBLES_SLOTS.filter((other) => slotSide(other) !== slotSide(slot));
    return [...instructed, ...foes.flatMap((other) => (view.present(other) && view.action(other) ? [view.action(other)!] : []))];
  }
  if (action !== "copycat" && action !== "mirrormove") return instructed;
  const before = view.doubles.turnEarlier.battleLastMove;
  return [...instructed, ...[...DOUBLES_SLOTS.flatMap((other) => [view.present(other) ? view.action(other) : null, historyOf(view.doubles, other).lastMove]), before]
    .filter((each): each is string => typeof each === "string")];
}

/**
 * A Pokémon of `side` can come in this turn (the Bench's and the Hazards' reader; IN §5.7): one of its Pokémon can switch out by
 * its player's choice (choosesSwitch, or a move Sleep Talk, Copycat or Mirror Move may call) or uses Healing Wish, Lunar Dance,
 * Assist or Beat Up; a Pokémon's Roar, Whirlwind, Dragon Tail or Circle Throw (or one a calling move may call) is aimed at one
 * of its Pokémon (a foe's, when none is chosen), or its own Roar or Whirlwind at a Pokémon whose Magic Bounce or Magic Coat
 * sends it back; a foe holds a Red Card, or an ally of a Pokémon whose damaging move hits its ally does.
 */
function benchRead(view: View, side: DoublesSideId): boolean {
  if (sideSlots(side).some((slot) => choosesSwitch(view, slot) || (view.present(slot) && EARLIER_TABLES.benchReaders.has(view.action(slot) ?? "")))) return true;
  if (sideSlots(side).some((slot) => view.present(slot) && calledMoves(view, slot).some((moveId) => EARLIER_TABLES.chosenSwitch.has(moveId)))) return true;
  return DOUBLES_SLOTS.some((other) => {
    if (!view.present(other)) return false;
    const action = view.action(other);
    if (action && EARLIER_TABLES.drag.has(action)) {
      const target = view.doubles.actions[other].target;
      if (target ? slotSide(target) === side : slotSide(other) !== side) return true;
      // Roar and Whirlwind (reflectable) sent back by Magic Bounce or Magic Coat drag their own user's side.
      const aimed = target ? [target] : DOUBLES_SLOTS.filter((each) => slotSide(each) !== slotSide(other));
      const bounces = (each: DoublesSlotId) => view.present(each) && (view.build(each).abilityId === "magicbounce" || view.action(each) === "magiccoat");
      if (slotSide(other) === side && (action === "roar" || action === "whirlwind") && aimed.some(bounces)) return true;
    }
    // A move a calling move may use: its drag aimed at a foe (the calling move's own target is not the called one's).
    if (slotSide(other) !== side && calledMoves(view, other).some((moveId) => EARLIER_TABLES.drag.has(moveId))) return true;
    if (slotSide(other) !== side && view.build(other).itemId === "redcard") return true;
    // An ally's Red Card against a Pokémon of `side` whose damaging move hits its ally (Earthquake, Surf, Discharge...).
    if (slotSide(other) === side && view.build(other).itemId === "redcard") {
      return sideSlots(side).some((slot) => {
        const move = slot !== other && view.present(slot) ? view.runtime.movesById.get(view.action(slot) ?? "") : undefined;
        return !!move && move.target === "allAdjacent" && move.category !== "Status";
      });
    }
    return false;
  });
}

const isEmptyBench = (bench: DoublesBench) => !bench.own.length && !bench.opponent.length && !Object.keys(bench.picks).length && !Object.keys(bench.hazards).length;

/**
 * The bench after a change, kept consistent (the bench's reset rules): a pick goes once its Pokémon is no longer on its side's
 * bench; a Future Sight or Doom Desire from a bench Pokémon goes with that Pokémon and otherwise follows its build. The same
 * matchup when nothing changes.
 */
function tidyBench(doubles: DoublesMatchup): DoublesMatchup {
  let next = doubles;
  const bench = benchOf(next);
  const find = (key: string) => bench.own.find((entry) => entry.key === key) ?? bench.opponent.find((entry) => entry.key === key);
  const kept = Object.entries(bench.picks).filter(([slot, key]) => bench[slotSide(slot as DoublesSlotId)].some((entry) => entry.key === key));
  if (kept.length !== Object.keys(bench.picks).length) {
    const tidied = { ...bench, picks: Object.fromEntries(kept) };
    next = { ...next, bench: isEmptyBench(tidied) ? NO_BENCH : tidied };
  }
  for (const slot of DOUBLES_SLOTS) {
    const from = historyOf(next, slot).futureFrom;
    if (from === undefined) continue;
    const future = next.carried[slot].futureMove;
    const entry = find(from);
    const landing = future && typeof future === "object" && "build" in future ? future : null;
    if (!entry || !landing) {
      next = changeHistory(slot, { futureFrom: undefined })(next);
      if (landing) next = changeCarried(slot, { futureMove: undefined })(next);
      continue;
    }
    const build = benchBuild(entry);
    if (!sameValue(landing.build, build)) next = changeCarried(slot, { futureMove: { move: landing.move, build } })(next);
  }
  return next;
}

/** A change of the bench (`patch` of the current one), then tidyBench; the same matchup when it leaves the bench as it was. */
function changeBench(patch: (bench: DoublesBench) => DoublesBench): EarlierChange {
  return (doubles) => {
    const current = benchOf(doubles);
    const next = patch(current);
    if (next === current || sameValue(next, current)) return doubles;
    return tidyBench({ ...doubles, bench: isEmptyBench(next) ? NO_BENCH : next });
  };
}

/**
 * A bench Pokémon's state for its build (as reconcileCarried does for a slot's): turns lost to sleep only while Asleep (at most
 * sleepTurnsMax), to freeze only in Champions while Frozen (at most 2), once-a-battle effects only generation 9's entry
 * abilities it has; the row's HP within 1 to its maximum.
 */
function boundBenchEntry(entry: DoublesBenchEntry, runtime: BattleRuntime): DoublesBenchEntry {
  const build = benchBuild(entry);
  const carried = entry.carried ?? {};
  const champions = runtime.profile.id === "champions";
  const sleep = carried.sleep && build.status === "slp" ? { attempts: clamp(carried.sleep.attempts, 0, sleepTurnsMax(build, runtime, carried.sleep.rest)), rest: carried.sleep.rest } : undefined;
  const freeze = carried.freeze && champions && build.status === "frz" ? { attempts: clamp(carried.freeze.attempts, 0, 2) } : undefined;
  const onceUsed = carried.onceUsed?.filter((id) => onceEntryOf(build, runtime) === id);
  const next = withoutUndefined({
    sleep: sleep && (sleep.attempts || sleep.rest) ? sleep : undefined,
    freeze: freeze?.attempts ? freeze : undefined,
    onceUsed: onceUsed?.length ? onceUsed : undefined,
  });
  const max = getBuildStats(build, runtime)?.hp;
  const hp = entry.hp === undefined || max === undefined ? entry.hp : clamp(entry.hp, 1, max);
  const bounded: DoublesBenchEntry = withoutUndefined({ ...entry, hp, carried: Object.keys(next).length ? next : undefined });
  return sameValue(bounded, entry) ? entry : bounded;
}

/** The once-a-battle entry ability (generation 9: Scarlet/Violet, Champions) the build has, else null. */
function onceEntryOf(build: BattleBuild, runtime: BattleRuntime): (typeof EARLIER_TABLES.onceEntry)[number] | null {
  if (runtime.profile.id !== "scarlet_violet" && runtime.profile.id !== "champions") return null;
  return EARLIER_TABLES.onceEntry.find((id) => id === build.abilityId) ?? null;
}

/**
 * Adds a prepared bench Pokémon to `side` (doubles-prep addDoublesBench prepares it): at its place in its roster's order
 * (`order`: the side's roster keys), unless the bench holds four, it is on the bench already or it is in play on its side. A
 * Pokémon on the bench ends No Pokémon left to switch in for its side.
 */
export function addBenchEntry(side: DoublesSideId, entry: DoublesBenchEntry, order: readonly string[]): EarlierChange {
  return (doubles) => {
    const bench = benchOf(doubles);
    const list = bench[side];
    if (list.length >= 4 || list.some((each) => each.key === entry.key) || sideSlots(side).some((slot) => doubles.slots[slot].source?.key === entry.key)) return doubles;
    const rank = (key: string) => { const at = order.indexOf(key); return at < 0 ? order.length : at; };
    const sorted = [...list, boundBenchEntry(entry, doubles.runtime)].sort((a, b) => rank(a.key) - rank(b.key));
    const added = changeBench((current) => ({ ...current, [side]: sorted }))(doubles);
    return changeEarlier((current) => ({ noneLeft: sideRecord(current.noneLeft, side, undefined) }))(added);
  };
}

/**
 * The bench with each Pokémon mapped (`map` returns it, a changed one, or null to remove it), then tidyBench: doubles-prep's
 * roster and session-edit follow-ups. The same matchup when none changes.
 */
export function mapBenchEntries(doubles: DoublesMatchup, map: (entry: DoublesBenchEntry, side: DoublesSideId) => DoublesBenchEntry | null): DoublesMatchup {
  const bench = benchOf(doubles);
  let changed = false;
  const mapped = (side: DoublesSideId) => {
    let sideChanged = false;
    const list = bench[side].flatMap((entry) => {
      const next = map(entry, side);
      if (next !== entry) sideChanged = true;
      return next ? [next === entry ? entry : boundBenchEntry(next, doubles.runtime)] : [];
    });
    changed ||= sideChanged;
    return sideChanged ? list : bench[side];
  };
  const own = mapped("own"), opponent = mapped("opponent");
  if (!changed) return doubles;
  const next = { ...bench, own, opponent };
  return tidyBench({ ...doubles, bench: isEmptyBench(next) ? NO_BENCH : next });
}

/** Removes the bench Pokémon `key` from `side` (its Replacement picks and a Future Sight from it go: tidyBench). */
export function removeBenchEntry(side: DoublesSideId, key: string): EarlierChange {
  return changeBench((bench) => ({ ...bench, [side]: bench[side].filter((entry) => entry.key !== key) }));
}

/** The bench Pokémon `key`'s row with `patch` (HP, status, its state on the bench), bounded to its build (boundBenchEntry). */
export function setBenchEntry(side: DoublesSideId, key: string, patch: Partial<Pick<DoublesBenchEntry, "hp" | "status" | "carried">>): EarlierChange {
  return (doubles) => changeBench((bench) => ({
    ...bench,
    [side]: bench[side].map((entry) => entry.key === key ? boundBenchEntry(withoutUndefined({ ...entry, ...patch }), doubles.runtime) : entry),
  }))(doubles);
}

/** The slot's Replacement pick (a bench key of its side; undefined: the turn's default). */
export function setBenchPick(slot: DoublesSlotId, key: string | undefined): EarlierChange {
  return changeBench((bench) => {
    const picks = { ...bench.picks, [slot]: key };
    if (key === undefined) delete picks[slot];
    return { ...bench, picks };
  });
}

/** The side's hazards with `patch` (a flag at undefined, or a layer count at 0, is removed). */
export function setBenchHazards(side: DoublesSideId, patch: Partial<DoublesHazards>): EarlierChange {
  return changeBench((bench) => {
    const next = withoutUndefined({ ...bench.hazards[side], ...patch });
    for (const key of Object.keys(next) as (keyof DoublesHazards)[]) if (!next[key]) delete next[key];
    return { ...bench, hazards: sideRecord(bench.hazards, side, Object.keys(next).length ? next : undefined) ?? {} };
  });
}

/**
 * The side's Hazards (IN §5.7): Stealth Rock, Spikes (0–3 layers), Toxic Spikes (0–2), Sticky Web and, in Sword/Shield, G-Max
 * Steelsurge, each where the game has its move; shown while a Pokémon of the side can come in this turn (benchRead) and its bench
 * is set, or while set. Each set hazard counts among the summary's toggles. `issues`: the turn's field issues.
 */
export function hazardControls(doubles: DoublesMatchup, side: DoublesSideId, issues?: readonly BuildIssue[]): EarlierControl[] {
  const view = viewOf(doubles);
  const { runtime, moveName } = view;
  const bench = benchOf(doubles);
  const hazards = bench.hazards[side] ?? {};
  const shown = bench[side].length > 0 && benchRead(view, side);
  const texts: Partial<Record<string, string>> = {};
  for (const issue of issues ?? []) {
    const match = /^hazards\.(own|opponent)\.(\w+)$/.exec(issue.field);
    if (match && match[1] === side) texts[match[2]] = texts[match[2]] ? `${texts[match[2]]} ${issue.message}` : issue.message;
  }
  const out: EarlierControl[] = [];
  for (const { flag, move, attr, most } of EARLIER_TABLES.hazards) {
    const value = hazards[flag];
    const exists = runtime.movesById.has(move) && (flag !== "steelsurge" || runtime.profile.id === "sword_shield");
    if (!(shown && exists) && value === undefined) continue;
    const base = { key: `hazard.${flag}`, label: moveName(move), attr: `data-doubles-hazard-${attr}`, attrValue: side, issue: texts[flag], toggle: value !== undefined };
    if (most === 1) {
      out.push({ ...base, kind: "check", checked: value !== undefined, set: (on) => setBenchHazards(side, { [flag]: on ? true : undefined } as Partial<DoublesHazards>) });
    } else {
      const layers = typeof value === "number" ? value : 0;
      out.push({ ...base, kind: "select", value: String(layers), choices: counts(0, Math.max(most, layers)).map((count) => ({ value: String(count), label: String(count) })),
        set: (next) => setBenchHazards(side, { [flag]: Number(next) || undefined } as Partial<DoublesHazards>) });
    }
  }
  return out;
}

/** One bench Pokémon's row (BenchFields): its name, its controls (HP, Status, then its sleep, freeze and once-a-battle state), its issue, Remove. */
export type BenchRow = { key: string; name: string; controls: EarlierControl[]; issue?: string; remove: EarlierChange };

/** One side's Bench (BenchFields; IN §5.7). */
export type BenchView = {
  /** The Bench shows: its roster has Pokémon beyond the two in play and one of its Pokémon can come in this turn (benchRead), or it is set. */
  shown: boolean;
  /** Add to bench: the roster entries of the side not in play and not benched, by name, in roster order (offered while it holds fewer than four). */
  add: EarlierChoice[];
  /** It holds four (A bench holds at most four Pokémon.). */
  full: boolean;
  rows: BenchRow[];
  /** The turn's issue about the whole bench ("A bench holds at most four Pokémon."). */
  issue?: string;
};

/**
 * One side's Bench (IN §5.7, ADDENDUM2 §5.3): `roster`, the side's roster panel's choices (the team its Pokémon come from);
 * `issues`, the turn's field issues (`bench.{side}` and `bench.{side}.{index}`, the index of the turn's bench, which is the
 * rows' order). Each row: HP (1 to its maximum), Status, and while they apply Turns lost to sleep with Rest sleep (Asleep),
 * Turns lost to freeze (Champions, Frozen) and `{Ability} used` (generation 9's Intrepid Sword, Dauntless Shield, Supersweet
 * Syrup), each label with the bench Pokémon's name for screen readers.
 */
export function benchSideView(doubles: DoublesMatchup, side: DoublesSideId, roster: readonly RosterChoice[] = [], issues?: readonly BuildIssue[]): BenchView {
  const view = viewOf(doubles);
  const { runtime } = view;
  const bench = benchOf(doubles);
  const entries = bench[side];
  const names = benchNamesOf(doubles);
  const inPlay = new Set(sideSlots(side).flatMap((slot) => doubles.slots[slot].source ? [doubles.slots[slot].source!.key] : []));
  const benched = new Set(entries.map((entry) => entry.key));
  const available = roster.filter((choice) => !!choice.source && !inPlay.has(choice.source.key) && !benched.has(choice.source.key));
  const full = entries.length >= 4;
  const texts: Partial<Record<string, string>> = {};
  for (const issue of issues ?? []) {
    const match = /^bench\.(own|opponent)(?:\.(\d+))?$/.exec(issue.field);
    if (!match || match[1] !== side) continue;
    const key = match[2] ?? "";
    texts[key] = texts[key] ? `${texts[key]} ${issue.message}` : issue.message;
  }
  const rows = entries.map((entry, index): BenchRow => {
    const build = benchBuild(entry);
    const name = names[entry.key] ?? entry.source.name;
    const max = getBuildStats(build, runtime)?.hp;
    const attrValue = `${side}-${index}`;
    const set = (patch: Partial<Pick<DoublesBenchEntry, "hp" | "status" | "carried">>) => setBenchEntry(side, entry.key, patch);
    const carried = entry.carried ?? {};
    const controls: EarlierControl[] = [
      { kind: "number", key: `bench-${index}.hp`, label: "HP", attr: "data-doubles-bench-hp", attrValue, value: build.currentHP ?? max ?? null, min: 1, max, issue: texts[String(index)], toggle: false,
        set: (hp) => hp === null ? (current) => current : set({ hp }) },
      { kind: "select", key: `bench-${index}.status`, label: "Status", attr: "data-doubles-bench-status", attrValue, value: build.status, toggle: false,
        choices: STATUSES.map((status) => ({ value: status.value, label: status.label })), set: (status) => set({ status: status as BattleBuild["status"] }) },
    ];
    if (build.status === "slp") {
      const sleep = carried.sleep ?? { attempts: 0, rest: false };
      controls.push({ kind: "select", key: `bench-${index}.sleep`, label: "Turns lost to sleep", attr: "data-doubles-bench-sleep", attrValue, value: String(sleep.attempts), toggle: false,
        choices: counts(0, Math.max(sleepTurnsMax(build, runtime, sleep.rest), sleep.attempts)).map((count) => ({ value: String(count), label: String(count) })),
        set: (value) => set({ carried: { ...carried, sleep: { attempts: Number(value), rest: sleep.rest } } }) });
      controls.push({ kind: "check", key: `bench-${index}.rest`, label: "Rest sleep", attr: "data-doubles-bench-rest", attrValue, checked: sleep.rest, toggle: false,
        set: (on) => set({ carried: { ...carried, sleep: { attempts: sleep.attempts, rest: on } } }) });
    }
    if (build.status === "frz" && runtime.profile.id === "champions") {
      const attempts = carried.freeze?.attempts ?? 0;
      controls.push({ kind: "select", key: `bench-${index}.freeze`, label: "Turns lost to freeze", attr: "data-doubles-bench-freeze", attrValue, value: String(attempts), toggle: false,
        choices: counts(0, Math.max(2, attempts)).map((count) => ({ value: String(count), label: String(count) })),
        set: (value) => set({ carried: { ...carried, freeze: { attempts: Number(value) } } }) });
    }
    const once = onceEntryOf(build, runtime);
    if (once) {
      controls.push({ kind: "check", key: `bench-${index}.once`, label: `${runtime.abilitiesById.get(once)?.name ?? once} used`, attr: "data-doubles-bench-once", attrValue,
        checked: !!carried.onceUsed?.includes(once), toggle: false, set: (on) => set({ carried: { ...carried, onceUsed: on ? [once] : undefined } }) });
    }
    return { key: entry.key, name, controls, issue: texts[String(index)], remove: removeBenchEntry(side, entry.key) };
  });
  return {
    shown: entries.length > 0 || (available.length > 0 && benchRead(view, side)),
    add: available.map((choice) => ({ value: choice.source!.key, label: choice.name })),
    full, rows, issue: texts[""],
  };
}

/**
 * The turn input with the Bench, the Replacement picks and the Hazards (doubles-prep getDoublesTurnInput's call; IN §5.7): each
 * side's bench where it holds a Pokémon (so its `canSwitch` is the bench's: a side with none keeps today's, with No Pokémon left
 * to switch in its `false`), each pick of a Pokémon on its side's bench, and each side's hazards. The same input when none is set.
 */
export function withBench(input: DoublesTurnInput, bench: DoublesBench | undefined): DoublesTurnInput {
  if (!bench || bench === NO_BENCH || isEmptyBench(bench)) return input;
  const benches = inputBench(bench);
  const picks = Object.entries(bench.picks).filter(([slot, key]) => (benches[slotSide(slot as DoublesSlotId)] ?? []).some((entry) => entry.id === key));
  const hazards = Object.entries(bench.hazards).filter(([, value]) => value && Object.keys(value).length);
  if (!Object.keys(benches).length && !hazards.length) return input;
  return {
    ...input,
    ...(Object.keys(benches).length ? { bench: { ...input.bench, ...benches } } : {}),
    ...(picks.length ? { replacement: { ...input.replacement, ...Object.fromEntries(picks) } } : {}),
    ...(hazards.length ? { hazards: { ...input.hazards, ...Object.fromEntries(hazards) } } : {}),
  };
}

const sortedItems = new WeakMap<BattleRuntime, { berries: BattleRuntime["catalog"]["items"]; others: BattleRuntime["catalog"]["items"] }>();
/** The game's items by name, its Berries apart (Item used earlier, Berry eaten last turn). */
function itemsOf(runtime: BattleRuntime) {
  let found = sortedItems.get(runtime);
  if (!found) {
    const items = [...runtime.catalog.items].sort((a, b) => a.name.localeCompare(b.name));
    sortedItems.set(runtime, found = { berries: items.filter((item) => item.id.endsWith("berry")), others: items.filter((item) => !item.id.endsWith("berry")) });
  }
  return found;
}

const uniqueSlots = (slots: readonly DoublesSlotId[]) => DOUBLES_SLOTS.filter((slot) => slots.includes(slot)).sort((a, b) => slots.indexOf(a) - slots.indexOf(b));
const uniqueStrings = (values: readonly string[]) => [...new Set(values)];

/** Half the Pokémon's maximum HP, truncated (a Wish it used); null while its build's stats are not valid. */
function wishHP(doubles: DoublesMatchup, from: DoublesSlotId): number | null {
  const stats = getBuildStats(doubles.slots[from].build, doubles.runtime);
  return stats ? Math.floor(stats.hp / 2) : null;
}

/** A partial trap from `source`: Binding Band from its item, the move when its quick moves hold exactly one trapping move. */
function trapFrom(doubles: DoublesMatchup, source: DoublesSlotId): NonNullable<DoublesCarried["trap"]> {
  const moves = doubles.slots[source].moves.flatMap((entry) => entry.moveId && EARLIER_TABLES.trapping.has(entry.moveId) ? [entry.moveId] : []);
  const unique = [...new Set(moves)];
  return { source, bindingBand: doubles.slots[source].build.itemId === "bindingband", ...(unique.length === 1 ? { move: unique[0] } : {}) };
}

/**
 * The entry order's candidates (ADDENDUM2 §5.2 Entered first; C37): both Pokémon of a side using Follow Me or Rage Powder
 * (an attacker's two foes), two or more Lightning Rod, Storm Drain or Dancer holders, and a Download holder with each foe
 * whose Dauntless Shield can raise its Defense first (T2P §4.3). In slot order; empty without one.
 */
function entryCandidates(view: View): DoublesSlotId[] {
  const present = DOUBLES_SLOTS.filter(view.present);
  const found = new Set<DoublesSlotId>();
  for (const side of ["own", "opponent"] as const) {
    const pair = present.filter((slot) => slotSide(slot) === side);
    if (pair.length === 2 && pair.every((slot) => view.action(slot) === "followme" || view.action(slot) === "ragepowder")) pair.forEach((slot) => found.add(slot));
  }
  for (const ability of ["lightningrod", "stormdrain", "dancer"]) {
    const holders = present.filter((slot) => view.build(slot).abilityId === ability);
    if (holders.length >= 2) holders.forEach((slot) => found.add(slot));
  }
  for (const holder of present.filter((slot) => view.build(slot).abilityId === "download")) {
    const boosted = present.filter((foe) => slotSide(foe) !== slotSide(holder) && view.build(foe).abilityId === "dauntlessshield");
    if (boosted.length) [holder, ...boosted].forEach((slot) => found.add(slot));
  }
  return DOUBLES_SLOTS.filter((slot) => found.has(slot));
}

/**
 * The field's earlier-turn controls (ADDENDUM2 §5.2 Field and sides): "weather" (Weather ends this turn, Terrain ends this
 * turn: under the Weather and Terrain selects) or "shared" (Mud Sport and Water Sport in USUM, Gravity ends this turn and
 * Magic Room ends this turn while on; then Entered first, Last move in the battle and Echoed Voice turns in a row when the
 * turn reads them). `issues`: the turn's field issues (DoublesIssues.field).
 */
export function earlierFieldControls(doubles: DoublesMatchup, part: "weather" | "shared", issues?: readonly BuildIssue[]): EarlierControl[] {
  const view = viewOf(doubles);
  const { runtime, names, moveName } = view;
  const { field } = doubles;
  const earlier = earlierOf(doubles);
  const texts = earlierIssueTexts([...(issues ?? []), ...validateConditions({ ...field, gameType: "Doubles" }, runtime)], null);
  const out: EarlierControl[] = [];
  const check = (key: string, name: string, show: boolean, label: string, checked: boolean, set: (on: boolean) => EarlierChange, toggle: boolean) => {
    if (show) out.push({ kind: "check", key, label, attr: `data-doubles-${name}`, attrValue: "", checked, issue: texts[key], toggle: toggle && checked, set });
  };
  if (part === "weather") {
    check("weatherEnds", "weather-ends", !!field.weather && !STRONG_WEATHER.has(field.weather), "Weather ends this turn", !!earlier.weatherEnds,
      (on) => changeEarlier({ weatherEnds: on ? true : undefined }), false);
    check("terrainEnds", "terrain-ends", !!field.terrain, "Terrain ends this turn", !!earlier.terrainEnds, (on) => changeEarlier({ terrainEnds: on ? true : undefined }), false);
    return out;
  }
  check("mudSport", "mud-sport", runtime.movesById.has("mudsport") || !!field.mudSport, "Mud Sport", !!field.mudSport,
    (on) => changeField((current) => withoutUndefined({ ...current, mudSport: on ? true : undefined })), true);
  check("waterSport", "water-sport", runtime.movesById.has("watersport") || !!field.waterSport, "Water Sport", !!field.waterSport,
    (on) => changeField((current) => withoutUndefined({ ...current, waterSport: on ? true : undefined })), true);
  check("gravityEnds", "gravity-ends", field.gravity, "Gravity ends this turn", !!earlier.gravityEnds, (on) => changeEarlier({ gravityEnds: on ? true : undefined }), false);
  check("magicRoomEnds", "magic-room-ends", field.magicRoom, "Magic Room ends this turn", !!earlier.magicRoomEnds, (on) => changeEarlier({ magicRoomEnds: on ? true : undefined }), false);
  const select = (key: string, name: string, show: boolean, label: string, value: string, choices: EarlierChoice[], set: (value: string) => EarlierChange, isSet: boolean) => {
    if (!show && !isSet) return;
    const listed = choices.some((choice) => choice.value === value) ? choices : [...choices, { value, label: value }];
    out.push({ kind: "select", key, label, attr: `data-doubles-${name}`, attrValue: "", value, choices: listed, issue: texts[key], toggle: false, set });
  };
  // Entered first (C37): the chosen Pokémon rank 0, the other candidates rank 1 (not ordered among themselves).
  const candidates = entryCandidates(view);
  const first = DOUBLES_SLOTS.find((slot) => earlier.entered?.[slot] === 0);
  select("enteredFirst", "entered-first", candidates.length >= 2, "Entered first", first ?? "",
    [{ value: "", label: "Unknown" }, ...uniqueSlots([...candidates, ...(first ? [first] : [])]).map((slot) => ({ value: slot, label: names[slot] }))],
    (value) => changeEarlier({
      entered: value ? Object.fromEntries(uniqueSlots([...candidates, value as DoublesSlotId]).map((slot) => [slot, slot === value ? 0 : 1])) as Partial<Record<DoublesSlotId, number>> : undefined,
    }), earlier.entered !== undefined);
  // Last move in the battle (Copycat; IN-C2): Unknown by default; the four Pokémon's quick moves, once each.
  const present = DOUBLES_SLOTS.filter(view.present);
  const battleValue = earlier.battleLastMove === undefined ? "" : earlier.battleLastMove === null ? "none" : earlier.battleLastMove;
  const battleMoves = uniqueStrings([...present.flatMap((slot) => view.quickMoves(slot)), ...(typeof earlier.battleLastMove === "string" ? [earlier.battleLastMove] : [])]);
  select("battleLastMove", "battle-last-move", present.some((slot) => view.action(slot) === "copycat"), "Last move in the battle", battleValue,
    [{ value: "", label: "Unknown" }, { value: "none", label: "None" }, ...battleMoves.map((id) => ({ value: id, label: moveName(id) }))],
    (value) => changeEarlier({ battleLastMove: value === "" ? undefined : value === "none" ? null : value }), earlier.battleLastMove !== undefined);
  // Echoed Voice turns in a row (C25): the multiplier after last turn is min(n, 5).
  select("echoedVoice", "echoed-voice", present.some((slot) => view.action(slot) === "echoedvoice"), "Echoed Voice turns in a row",
    earlier.echoedVoice === undefined ? "" : String(Math.min(5, earlier.echoedVoice)),
    [{ value: "", label: "Unknown" }, ...counts(0, 5).map((count) => ({ value: String(count), label: count === 5 ? "5 or more" : String(count) }))],
    (value) => changeEarlier({ echoedVoice: value === "" ? undefined : Math.min(5, Number(value)) }), earlier.echoedVoice !== undefined);
  return out;
}

/**
 * One side's earlier-turn controls (ADDENDUM2 §5.2 Field and sides), shown in its fieldset before its Pokémon: Safeguard,
 * Mist and Lucky Chant where the game has them, the four G-Max side conditions (SwSh), No Pokémon left to switch in, then
 * Lost a Pokémon last turn when a Pokémon of the side uses Retaliate. `issues`: the turn's field issues.
 */
export function earlierSideControls(doubles: DoublesMatchup, side: DoublesSideId, issues?: readonly BuildIssue[]): EarlierControl[] {
  const view = viewOf(doubles);
  const { runtime, moveName } = view;
  const key = SIDE_KEY[side];
  const conditions: SideConditions = doubles.field[key];
  const earlier = earlierOf(doubles);
  const texts = earlierIssueTexts([...(issues ?? []), ...validateConditions({ ...doubles.field, gameType: "Doubles" }, runtime)], null);
  const out: EarlierControl[] = [];
  const setSide = (patch: Partial<SideConditions>): EarlierChange => changeField((field) => ({ ...field, [key]: withoutUndefined({ ...field[key], ...patch }) }));
  const check = (name: string, attr: string, show: boolean, label: string, checked: boolean, set: (on: boolean) => EarlierChange, extra: Partial<EarlierCheck> = {}) => {
    if (show || checked) out.push({ kind: "check", key: `${key}.${name}`, label, attr, attrValue: side, checked, issue: texts[`${key}.${name}`], toggle: checked, set, ...extra });
  };
  check("safeguard", "data-doubles-side-safeguard", runtime.movesById.has("safeguard"), "Safeguard", !!conditions.safeguard, (on) => setSide({ safeguard: on ? true : undefined }));
  check("mist", "data-doubles-side-mist", runtime.movesById.has("mist"), "Mist", !!conditions.mist, (on) => setSide({ mist: on ? true : undefined }));
  check("luckyChant", "data-doubles-side-lucky-chant", runtime.movesById.has("luckychant"), "Lucky Chant", !!conditions.luckyChant, (on) => setSide({ luckyChant: on ? true : undefined }));
  for (const id of EARLIER_TABLES.gmaxResidual) {
    const up = !!conditions.gmaxResidual?.includes(id);
    check(`gmaxResidual.${id}`, "data-doubles-side-gmax", runtime.profile.id === "sword_shield" && runtime.movesById.has(id), moveName(id), up, (on) => changeField((field) => {
      const rest = (field[key].gmaxResidual ?? []).filter((each) => each !== id);
      const next = on ? EARLIER_TABLES.gmaxResidual.filter((each) => each === id || rest.includes(each)) : rest;
      return { ...field, [key]: withoutUndefined({ ...field[key], gmaxResidual: next.length ? [...next] : undefined }) };
    }), { inputValue: id, issue: texts[`${key}.gmaxResidual`] });
  }
  // status2 R-U (IN §5.7): the side's Bench replaces it once it holds a Pokémon (an empty bench with it ticked: canSwitch false).
  if (!benchOf(doubles)[side].length) {
    out.push({ kind: "check", key: "noBench", label: "No Pokémon left to switch in", attr: "data-doubles-no-bench", attrValue: side, checked: !!earlier.noneLeft?.[side],
      toggle: !!earlier.noneLeft?.[side], set: (on) => changeEarlier((current) => ({ noneLeft: sideRecord(current.noneLeft, side, on ? true : undefined) })) });
  }
  const fainted = earlier.faintedLastTurn?.[side];
  if (DOUBLES_SLOTS.some((slot) => slotSide(slot) === side && view.present(slot) && view.action(slot) === "retaliate") || fainted !== undefined) {
    out.push({ kind: "select", key: "faintedLast", label: "Lost a Pokémon last turn", attr: "data-doubles-fainted-last", attrValue: side,
      value: fainted === undefined ? "" : fainted ? "yes" : "no", choices: [{ value: "", label: "Unknown" }, { value: "yes", label: "Yes" }, { value: "no", label: "No" }], toggle: false,
      set: (value) => changeEarlier((current) => ({ faintedLastTurn: sideRecord(current.faintedLastTurn, side, value === "" ? undefined : value === "yes") })) });
  }
  return out;
}

/**
 * The summary's count of the earlier-turn toggles set beyond today's (ADDENDUM2 §5.2 Summary toggles, IN §5.5): each new
 * checkbox ticked (a Pokémon's, a side's, Mud Sport and Water Sport), each per-Pokémon select that puts a condition on it,
 * a changed Type pair once, a non-zero stage, Bide stored and Switched in; history answers do not count. A fainted
 * Pokémon counts none. describeDoublesConditions adds it to today's count.
 */
export function earlierTurnToggles(doubles: DoublesMatchup): number {
  const view = viewOf(doubles);
  let total = 0;
  for (const slot of DOUBLES_SLOTS) {
    if (!view.present(slot)) continue;
    total += earlierSlotControls(doubles, slot).filter((control) => control.toggle).length;
    if (historyOf(doubles, slot).switchedIn) total += 1;
  }
  for (const side of ["own", "opponent"] as const) {
    total += earlierSideControls(doubles, side).filter((control) => control.toggle).length;
    // status2 R-U (IN §5.5): each hazard set.
    total += hazardControls(doubles, side).filter((control) => control.toggle).length;
  }
  for (const part of ["weather", "shared"] as const) total += earlierFieldControls(doubles, part).filter((control) => control.toggle).length;
  return total;
}

// ---------- The mapping into the turn's input (IN §5.4) ----------

/**
 * One slot's turn input with its history answers (doubles-prep doublesSlotInput's call): IN §5.4 puts lastMove, lastItem
 * and lastMoveTarget on the slot input, firstTurn, earlierThisTurn and switchedIn (its action then No move) too, and types
 * and addedType on a copy of its build only (IN-C6: the Combatant's build and the shared cache never get them), and only
 * for the species they were given for, not under a Tera type (addedType: not Terastallized), not on Arceus or Silvally.
 * The same entry when it has no answers.
 */
export function withSlotHistory(entry: DoublesPokemonInput, history: DoublesSlotHistory): DoublesPokemonInput {
  if (!history || history === NO_HISTORY || !Object.keys(history).length) return entry;
  const next: DoublesPokemonInput = { ...entry };
  if (history.lastMove !== undefined) next.lastMove = history.lastMove;
  if (history.lastMoveTarget !== undefined) next.lastMoveTarget = history.lastMoveTarget;
  if (history.lastItem !== undefined) next.lastItem = history.lastItem;
  const types = history.switchedIn ? {} : historyTypes(entry.build, history);
  if (types.types || types.addedType) next.build = { ...entry.build, ...types };
  if (history.firstTurn === false) next.firstTurn = false;
  if (history.earlierThisTurn && Object.keys(history.earlierThisTurn).length) next.earlierThisTurn = { ...history.earlierThisTurn };
  if (history.switchedIn) {
    next.switchedIn = true;
    next.action = { moveId: null, target: null };
    // It has used no move since it came in (PS/sim/pokemon.ts clearVolatile: lastMove null).
    next.lastMove = null;
    delete next.lastMoveTarget;
  }
  return Object.keys(next).length === Object.keys(entry).length && (Object.keys(next) as (keyof DoublesPokemonInput)[]).every((key) => next[key] === entry[key]) ? entry : next;
}

/**
 * The turn input with the field's and the sides' answers (doubles-prep getDoublesTurnInput's call; IN §5.4): weatherTurns 1
 * (a weather but the strong three), fieldTurns 1 for the terrain, Gravity and Magic Room (each only while up), entryOrder,
 * battleLastMove, echoedVoice, faintedLastTurn, and canSwitch false for a side with no Pokémon left. The same input when
 * none is given.
 */
export function withTurnEarlier(input: DoublesTurnInput, earlier: DoublesTurnEarlier): DoublesTurnInput {
  if (!earlier || earlier === NO_TURN_EARLIER || !Object.keys(earlier).length) return input;
  const { field } = input;
  const next: DoublesTurnInput = { ...input };
  if (earlier.weatherEnds && field.weather && !STRONG_WEATHER.has(field.weather)) next.weatherTurns = 1;
  const fieldTurns = withoutUndefined({
    terrain: earlier.terrainEnds && field.terrain ? 1 : undefined,
    gravity: earlier.gravityEnds && field.gravity ? 1 : undefined,
    magicRoom: earlier.magicRoomEnds && field.magicRoom ? 1 : undefined,
  });
  if (Object.keys(fieldTurns).length) next.fieldTurns = { ...input.fieldTurns, ...fieldTurns };
  const entered = Object.fromEntries(Object.entries(earlier.entered ?? {}).filter(([slot]) => !!input.pokemon[slot as DoublesSlotId]));
  if (Object.keys(entered).length) next.entryOrder = entered;
  if (earlier.battleLastMove !== undefined) next.battleLastMove = earlier.battleLastMove;
  if (earlier.echoedVoice !== undefined) next.echoedVoice = Math.min(5, earlier.echoedVoice) as 0 | 1 | 2 | 3 | 4 | 5;
  if (earlier.faintedLastTurn && Object.keys(earlier.faintedLastTurn).length) next.faintedLastTurn = { ...earlier.faintedLastTurn };
  const noneLeft = (["own", "opponent"] as const).filter((side) => earlier.noneLeft?.[side]);
  if (noneLeft.length) next.canSwitch = { ...input.canSwitch, ...Object.fromEntries(noneLeft.map((side) => [side, false])) };
  const keys = Object.keys(next) as (keyof DoublesTurnInput)[];
  return keys.length === Object.keys(input).length && keys.every((key) => next[key] === input[key]) ? input : next;
}

// ---------- The state and reset rules (IN §5.4, ADDENDUM2 §5.2); doubles-prep calls them ----------

/** CalculatorState with a control's change (the 2v2 Field conditions' EarlierTurnContext); the same state when nothing changes. */
export function applyDoublesEarlier(state: CalculatorState, change: EarlierChange): CalculatorState {
  const doubles = change(state.doubles);
  return doubles === state.doubles ? state : { ...state, doubles };
}

/**
 * Another Pokémon in `slot` (doubles-prep onSlot's anotherPokemon): its carried state and history answers clear, the entry
 * order drops it (all of it when it was the one entered first), and the other Pokémon's states that name it as their
 * source end with it (Attract, Octolock, Lock-On, a partial trap, Syrup Bomb, a Future Sight user, a Bide's source; each
 * needs its source in battle, PS/data/conditions.ts and moves.ts), and a Wish from it keeps its HP (a slot condition). The
 * same matchup when nothing changes.
 */
export function clearSlotEarlier(doubles: DoublesMatchup, slot: DoublesSlotId): DoublesMatchup {
  let next = doubles;
  if (Object.keys(next.carried[slot]).length) next = { ...next, carried: { ...next.carried, [slot]: NO_CARRIED } };
  if (Object.keys(historyOf(next, slot)).length) next = { ...next, history: { ...next.history, [slot]: NO_HISTORY } };
  // status2 R-U (IN §5.4): its Replacement was the old Pokémon's.
  if (benchOf(next).picks[slot] !== undefined) next = setBenchPick(slot, undefined)(next);
  const entered = earlierOf(next).entered;
  if (entered && entered[slot] !== undefined) {
    const rest = Object.fromEntries(Object.entries(entered).filter(([each]) => each !== slot));
    next = changeEarlier({ entered: entered[slot] === 0 || !Object.keys(rest).length ? undefined : rest })(next);
  }
  for (const other of DOUBLES_SLOTS) {
    if (other === slot) continue;
    const carried = next.carried[other];
    const future = carried.futureMove;
    const patch: Partial<DoublesCarried> = withoutUndefined({
      attract: carried.attract === slot ? undefined : carried.attract,
      octolock: carried.octolock === slot ? undefined : carried.octolock,
      lockOn: carried.lockOn === slot ? undefined : carried.lockOn,
      trap: carried.trap?.source === slot ? undefined : carried.trap,
      syrupBomb: carried.syrupBomb === slot ? undefined : carried.syrupBomb,
      futureMove: future && typeof future === "object" && "source" in future && future.source === slot ? undefined : future,
      bide: carried.bide?.source === slot ? { ...carried.bide, source: null } : carried.bide,
    });
    const keys = ["attract", "octolock", "lockOn", "trap", "syrupBomb", "futureMove", "bide"] as const;
    if (keys.some((key) => patch[key] !== carried[key])) {
      const updated = withoutUndefined({ ...carried, ...Object.fromEntries(keys.map((key) => [key, patch[key]])) }) as DoublesCarried;
      next = { ...next, carried: { ...next.carried, [other]: Object.keys(updated).length ? updated : NO_CARRIED } };
    }
    if (historyOf(next, other).wishFrom === slot) next = changeHistory(other, { wishFrom: undefined })(next);
  }
  return next;
}

/**
 * The history answers and carried sources for the current builds (doubles-prep, after a build change; IN §5.4): another
 * species or form drops the types and added type (setSpecies), a Terastallized Pokémon drops its added type, Arceus and
 * Silvally drop both; a partial trap follows its source's Binding Band and trapping move, a Wish its user's maximum HP.
 * reconcileCarried bounds the rest. The same matchup when nothing changes.
 */
export function reconcileEarlier(doubles: DoublesMatchup): DoublesMatchup {
  let next = doubles;
  for (const slot of DOUBLES_SLOTS) {
    const build = next.slots[slot].build;
    const history = historyOf(next, slot);
    if (history.types || history.addedType || history.typesOf) {
      const other = (history.typesOf !== undefined && history.typesOf !== build.speciesId) || typeLocked(build);
      next = changeHistory(slot, {
        types: other ? undefined : history.types,
        addedType: other || build.mechanic === "tera" ? undefined : history.addedType,
        typesOf: other ? undefined : history.typesOf,
      })(next);
    }
    const carried = next.carried[slot];
    if (carried.trap && next.slots[carried.trap.source]) {
      const fresh = trapFrom(next, carried.trap.source);
      if (fresh.bindingBand !== carried.trap.bindingBand || fresh.move !== carried.trap.move) {
        next = { ...next, carried: { ...next.carried, [slot]: { ...carried, trap: fresh } } };
      }
    }
    const from = historyOf(next, slot).wishFrom;
    const hp = from ? wishHP(next, from) : null;
    if (from && hp !== null && next.carried[slot].wish !== undefined && next.carried[slot].wish !== hp) {
      next = { ...next, carried: { ...next.carried, [slot]: { ...next.carried[slot], wish: hp } } };
    }
  }
  return next;
}

/**
 * Review 2 (R6-3; round 2, R6-r2-2): whether `slot` may use a protecting move or Endure this turn other than as its own action,
 * so its stall roll reads last turn's counter (the engine's doubles-turn.ts calledStall): its Last move is one and an Instruct
 * of the turn can reach it (instructReaches), or its Sleep Talk with one among its moves.
 */
function calledProtect(doubles: DoublesMatchup, slot: DoublesSlotId): boolean {
  const last = historyOf(doubles, slot).lastMove;
  const action = doubles.actions[slot].moveId;
  if (action === "sleeptalk" && doubles.slots[slot].moves.some((each) => !!each.moveId && EARLIER_TABLES.protecting.has(each.moveId))) return true;
  return typeof last === "string" && EARLIER_TABLES.protecting.has(last) && instructReaches(doubles, slot);
}

/**
 * The Pokémon `other`'s move is aimed at in the turn's input (doubles-prep doublesTurnInput): its target, or, where that one has
 * fainted, the first living foe (pinned getMoveTargets retargets a fainted foe's move: sim/pokemon.ts getRandomTarget).
 */
export function aimedAt(actions: Record<DoublesSlotId, DoublesAction>, fainted: Record<DoublesSlotId, boolean>, other: DoublesSlotId): DoublesSlotId | null {
  const target = actions[other].target;
  if (target === null || !fainted[target]) return target;
  return DOUBLES_SLOTS.find((each) => slotSide(each) !== slotSide(other) && !fainted[each]) ?? null;
}

/**
 * Review 2, round 2 (R6-r2-2, -4): whether an Instruct of the turn can reach `slot` (the engine's doubles-turn.ts
 * instructCanReach): another Pokémon's Instruct aimed at it (aimedAt: a fainted target's retarget too) or with no target; a
 * foe's Instruct while a Spotlight of the turn is aimed at it (Ultra Sun/Ultra Moon); a foe's called Instruct, at a random foe
 * of its caller: its Sleep Talk with Instruct among its quick moves, its Copycat when Instruct is the battle's last move or a
 * Pokémon's action or Last move, its Assist with Instruct among its ally's quick moves or its side's bench's moves.
 */
export function instructReaches(doubles: DoublesMatchup, slot: DoublesSlotId): boolean {
  const fainted = Object.fromEntries(DOUBLES_SLOTS.map((each) => [each, isFaintedBuild(doubles.slots[each].build)])) as Record<DoublesSlotId, boolean>;
  const quick = (each: DoublesSlotId) => doubles.slots[each].moves.flatMap((prepared) => (prepared.moveId ? [prepared.moveId] : []));
  const foes = (a: DoublesSlotId, b: DoublesSlotId) => slotSide(a) !== slotSide(b);
  const spotlit = DOUBLES_SLOTS.some((each) => !fainted[each] && doubles.actions[each].moveId === "spotlight" && aimedAt(doubles.actions, fainted, each) === slot);
  return DOUBLES_SLOTS.some((other) => {
    if (other === slot || fainted[other]) return false;
    const moveId = doubles.actions[other].moveId;
    if (moveId === "instruct") {
      const target = aimedAt(doubles.actions, fainted, other);
      return target === slot || target === null || (spotlit && foes(other, slot));
    }
    if (!foes(other, slot)) return false;
    if (moveId === "sleeptalk") return quick(other).includes("instruct");
    if (moveId === "copycat") {
      return doubles.turnEarlier?.battleLastMove === "instruct"
        || DOUBLES_SLOTS.some((each) => (!fainted[each] && doubles.actions[each].moveId === "instruct") || historyOf(doubles, each).lastMove === "instruct");
    }
    if (moveId === "assist") return quick(allyOf(other)).includes("instruct") || benchOf(doubles)[slotSide(other)].some((entry) => entry.moves.includes("instruct"));
    return false;
  });
}

/**
 * The slot's action changed (doubles-prep, after chooseDoublesMove and every transition that changes the action; ADDENDUM2
 * §5.2 State and reset rules): the action-bound states its new action does not read go (a charged move, the stall and Ally
 * Switch counters, Uproar, Bide, Fury Cutter, Rollout, PP left, Not its first turn, Recharging), and Switched in ends. The
 * same matchup when nothing changes.
 */
export function afterDoublesAction(doubles: DoublesMatchup, slot: DoublesSlotId): DoublesMatchup {
  const action = doubles.actions[slot].moveId;
  const build = doubles.slots[slot].build;
  const carried = doubles.carried[slot];
  const protecting = !!action && (EARLIER_TABLES.protecting.has(action) || (isMaxActive(build) && doubles.runtime.movesById.get(action)?.category === "Status"))
    || calledProtect(doubles, slot);
  const next = changeCarried(slot, {
    charging: carried.charging === action ? carried.charging : undefined,
    stall: protecting ? carried.stall : undefined,
    allySwitch: action === "allyswitch" ? carried.allySwitch : undefined,
    uproar: action === "uproar" ? carried.uproar : undefined,
    bide: action === "bide" ? carried.bide : undefined,
    furyCutter: action === "furycutter" ? carried.furyCutter : undefined,
    rollout: action === "rollout" || action === "iceball" ? carried.rollout : undefined,
    ppLeft: action === "trumpcard" ? carried.ppLeft : undefined,
    mustRecharge: action === null ? carried.mustRecharge : undefined,
  })(doubles);
  return changeHistory(slot, (history) => ({
    firstTurn: action === "fakeout" || action === "firstimpression" ? history.firstTurn : undefined,
    switchedIn: undefined,
  }))(next);
}

/** The field changed (doubles-prep setDoublesField; IN §5.4): each "… ends this turn" answer goes when its effect is off (or the weather is a strong one). */
export function afterDoublesField(doubles: DoublesMatchup): DoublesMatchup {
  const { field } = doubles;
  const earlier = earlierOf(doubles);
  return changeEarlier({
    weatherEnds: earlier.weatherEnds && field.weather && !STRONG_WEATHER.has(field.weather) ? true : undefined,
    terrainEnds: earlier.terrainEnds && field.terrain ? true : undefined,
    gravityEnds: earlier.gravityEnds && field.gravity ? true : undefined,
    magicRoomEnds: earlier.magicRoomEnds && field.magicRoom ? true : undefined,
  })(doubles);
}

/**
 * The states from earlier turns a switch keeps (review 2, R6-5): its status's sleep and freeze counters, the slot's Wish and
 * Future Sight, its PP and the once-a-battle flags. A switch clears every volatile and the ability's and item's states
 * (PS/sim/battle-actions.ts switchIn: oldActive.clearVolatile, PS/sim/pokemon.ts clearVolatile), and bad poison's stage
 * restarts as it comes in (PS/data/conditions.ts tox onSwitchIn). The accuracy and evasion stages stay, as its other stages
 * do: an entry before the moves can set them (Supersweet Syrup).
 */
const KEPT_BY_SWITCH: ReadonlySet<string> = new Set(["sleep", "freeze", "wish", "futureMove", "onceUsed", "ppLeft", "stages"]);

/**
 * Switched in (the move select's option after No move; ADDENDUM2 §5.2): it switched in this turn before the moves, so its
 * action is No move and its action-bound states go (as afterDoublesAction), Recharging included, and so does every state a
 * switch clears (KEPT_BY_SWITCH keeps the rest). Off: No move stays.
 */
export function switchDoublesIn(doubles: DoublesMatchup, slot: DoublesSlotId, on: boolean): DoublesMatchup {
  if (!on) return changeHistory(slot, { switchedIn: undefined })(doubles);
  const action = doubles.actions[slot];
  const idle = action.moveId === null && action.target === null ? doubles : { ...doubles, actions: { ...doubles.actions, [slot]: { moveId: null, target: null } } };
  const cleared = changeCarried(slot, (current) => Object.fromEntries(Object.keys(current).filter((key) => !KEPT_BY_SWITCH.has(key)).map((key) => [key, undefined])))(afterDoublesAction(idle, slot));
  // Its last move and its types from before go too (clearVolatile: lastMove null, setSpecies(baseSpecies)); withSlotHistory
  // passes none for its last move. Review 2, round 2 (R6-r2-3): the states the others carry from it as their source go too.
  return changeHistory(slot, { switchedIn: true, lastMove: undefined, lastMoveTarget: undefined, types: undefined, addedType: undefined, typesOf: undefined })(dropSourced(cleared, slot));
}

/**
 * The states the other Pokémon carry with `slot` as their source that end as their source leaves (Attract, Octolock, Lock-On,
 * a partial trap, Syrup Bomb: data/moves.ts attract and syrupbomb onUpdate, octolock onResidual, lockon's source; data/
 * conditions.ts partiallytrapped onResidual). A landing, Bide, Leech Seed and a Wish are slot-based or outlive their user.
 */
function dropSourced(doubles: DoublesMatchup, slot: DoublesSlotId): DoublesMatchup {
  let next = doubles;
  for (const other of DOUBLES_SLOTS) {
    if (other === slot) continue;
    const carried = next.carried[other];
    const keys = (["attract", "octolock", "lockOn", "syrupBomb"] as const).filter((key) => carried[key] === slot);
    const trap = carried.trap?.source === slot;
    if (!keys.length && !trap) continue;
    const updated = withoutUndefined({ ...carried, ...Object.fromEntries(keys.map((key) => [key, undefined])), ...(trap ? { trap: undefined } : {}) }) as DoublesCarried;
    next = { ...next, carried: { ...next.carried, [other]: Object.keys(updated).length ? updated : NO_CARRIED } };
  }
  return next;
}

/** switchDoublesIn for the Pokémon with Combatant key `key` (the card's move select). */
export function setDoublesSwitchedIn(state: CalculatorState, key: number, on: boolean): CalculatorState {
  const slot = DOUBLES_SLOTS.find((each) => state.doubles.slots[each].key === key);
  return slot ? applyDoublesEarlier(state, (doubles) => switchDoublesIn(doubles, slot, on)) : state;
}

/**
 * reconcileCarried's part for the earlier-turn controls' carried fields (IN §5.4): Nightmare without the Asleep status or
 * Comatose, a Berry lock without Berserk or Anger Shell and a healing Berry, a Cud Chew Berry without Cud Chew, Laser
 * Focus outside SwSh and USUM go; Heal Block, Embargo and Telekinesis turns are bounded to the game's (USUM 1–4, 1–4, 1–2;
 * Heal Block 1 elsewhere, none in SwSh), Stockpile to 1–3 layers with its counts in −layers..0, the stages to −6..+6 (0
 * left out).
 */
function boundEarlierCarried(carried: DoublesCarried, build: BattleBuild, runtime: BattleRuntime, set: <K extends keyof DoublesCarried>(key: K, value: DoublesCarried[K] | undefined) => void) {
  const game = runtime.profile.id;
  const usum = game === "ultra_sun_ultra_moon";
  if (carried.nightmare && build.status !== "slp" && build.abilityId !== "comatose") set("nightmare", undefined);
  if (carried.berryLocked && !((build.abilityId === "berserk" || build.abilityId === "angershell") && EARLIER_TABLES.healingBerries.has(build.itemId))) set("berryLocked", undefined);
  if (typeof carried.cudChew === "string" && build.abilityId !== "cudchew") set("cudChew", undefined);
  if (carried.laserFocus && game !== "sword_shield" && !usum) set("laserFocus", undefined);
  const bound = (key: "healBlock" | "embargo" | "telekinesis", most: number) => {
    const value = carried[key];
    if (value === undefined) return;
    const next = most ? clamp(value, 1, most) : undefined;
    if (next !== value) set(key, next as never);
  };
  bound("healBlock", usum ? 4 : game === "sword_shield" ? 0 : 1);
  bound("embargo", usum ? 4 : 0);
  bound("telekinesis", usum ? 2 : 0);
  if (carried.stockpile) {
    const layers = clamp(carried.stockpile.layers, 0, 3);
    const count = (value: number | undefined) => value === undefined ? undefined : clamp(value, -layers, 0);
    const next = layers ? withoutUndefined({ layers: layers as 1 | 2 | 3, def: count(carried.stockpile.def), spd: count(carried.stockpile.spd) }) : undefined;
    if (!sameValue(next, carried.stockpile)) set("stockpile", next);
  }
  if (carried.stages) {
    const stage = (value: number | undefined) => value === undefined ? undefined : clamp(value, -6, 6) || undefined;
    const next = withoutUndefined({ accuracy: stage(carried.stages.accuracy), evasion: stage(carried.stages.evasion) });
    if (!sameValue(next, carried.stages)) set("stages", Object.keys(next).length ? next : undefined);
  }
}

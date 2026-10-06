import { Generations, toID } from "@smogon/calc";
import type { Field, Move, Pokemon, Result } from "@smogon/calc";
import type { ItemName } from "@smogon/calc/dist/data/interface";
import { getBerryResistType } from "@smogon/calc/dist/items";
import { calculateChampions } from "@smogon/calc/dist/mechanics/champions";
import { calculateSMSSSV } from "@smogon/calc/dist/mechanics/gen789";
import { getMoveEffectiveness } from "@smogon/calc/dist/mechanics/util";
import type { BattleRuntime } from "./runtime";
import type { AfterUse, BattleBuild, BattleConditions, BattleGame, BattleStatus, ChampionsMove, CombatStat, MoveContext, MoveDamageResult, UsesToKO } from "./types";
import { CHARGE_MOVES, MAX_MOVE_EFFECTS, NOT_TWICE_MOVES, RECHARGE_MOVES, STATUS_MOVES, statMove, type Stages as StageChanges } from "./stat-moves";
import {
  berryArithmetic, berryUnnerved, CANT_SUPPRESS, eatBerry, FAIL_SKILL_SWAP, gulpingTarget, HEALING_BERRIES, hitsCanFaint, hitStep, KLUTZ_IGNORED_ITEMS, PINCH_HEAL_BERRIES,
  PINCH_STAT_BERRIES, PINCH_TYPES, startHits, stolenEat, UNNERVES, walkHits,
  type Berry, type HitLoopInput, type HitState, type HitWalk, type StolenEat, type TurnUnnerve,
} from "./hit-loop";
import { hitCountRule, type HitChance } from "./hit-count";
import { NATURES } from "./model";

/**
 * Uses to KO (types.ts UsesToKO): how many uses of a row's move, one a turn by an attacker that uses it
 * every turn into a target that does nothing, knock the target out from its current HP. Each use rolls
 * its own damage, so the count is an exact search over the states the uses can reach: the target's HP on
 * every roll sequence, with what the uses change (stat stages, items used up or taken, abilities, forms,
 * statuses, the attacker's HP where the damage reads it or it could faint, Metronome's count, Dynamax
 * turns, the field) and the end of every turn in pinned Showdown's residual order. A sequence on which
 * the attacker faints with the target still in never knocks it out; one that knocks it out first counts
 * even when that use's recoil or Life Orb then faints the attacker (pinned Showdown hitStepMoveHitLoop:
 * the target faints before recoil, Life Orb after it). `guaranteed` is the first use after which every
 * sequence has knocked the target out (none when one faints the attacker first), `fewest` the first
 * after which one can, `fasterChance` the chance of one use fewer and `chance`, with no guarantee, the
 * chance within the uses counted.
 * - Closed form: when nothing the damage reads changes, and the end of each turn only heals the target by
 *   less than any use deals or only damages it by a fixed amount, the uses are independent sums. The
 *   lowest and highest damage give the counts, and a convolution truncated at the HP the uses must take
 *   the chance (@smogon/calc's exact 2-4 use chances are this). The attacker's HP keeps it only when it
 *   falls the same way on every sequence (the uses stop where it faints) or a bound shows it stands.
 * - Otherwise the search walks the uses over states, each with a distribution over the target's HP. States
 *   that differ only in that HP share one damage calculation unless the damage reads it, and a state whose
 *   damage inputs equal an earlier one's reuses its calculation. A new one reruns only the engine call when
 *   nothing else in calculateMove can differ, or the whole calculateMove otherwise. States are interned and
 *   their transitions memoised, so a use from a state already met costs only the HP arithmetic.
 * - Past a budget of states and calculations the count falls back to the lowest and the highest roll on
 *   every use, with a note.
 * - The first use's outcome (types.ts AfterUse, UsesSearch.firstUse) is the same walk of one use's hits from the
 *   first state, with no end of turn: the target's HP over every sequence, or nothing where it is not exact.
 */

/** The most uses counted when the catalog has no PP for the move: 64 is the most PP any move has with PP Ups. */
export const USES_CAP = 64;
/**
 * Test-only hook for the self-check: when on, every new state reruns the whole calculation, with no shared
 * damage, no engine-only rerun and no closed form. The app never turns it on.
 */
export const USES_REFERENCE = { on: false };
/** Target-HP states (summed over hits and uses) and damage calculations beyond the row's own that one exact count may use. */
const STATE_BUDGET = 60_000;
const RUN_BUDGET = 24;
/** The rerun budget of one doubles-turn search (createTurnSearch), shared by its turn's steps. */
const TURN_RUN_BUDGET = 48;
/** How far one roll path is walked past the limit to find `needed` before its state settles. */
const PATH_CAP = 128;

/**
 * The move's PP with three PP Ups (pinned Showdown calculatePP: base x 8/5, and Champions (base / 5 + 1)
 * x 4 from a base PP its mod caps at 20). noPPBoosts moves keep their base PP, and so does Trump Card in
 * the main games (pokemon.ts gives it no PP Ups). Null when the catalog has no PP for the move.
 */
export function maxUsesPP(move: ChampionsMove, game: BattleGame): number | null {
  if (move.pp === undefined) return null;
  if (move.noPPBoosts) return move.pp;
  if (game === "champions") return (Math.floor(move.pp / 5) + 1) * 4;
  return move.id === "trumpcard" ? move.pp : Math.floor(move.pp * 8 / 5);
}

/** What a calculation used: its engine result, and the engine call's inputs when nothing changed the damage after it. */
export type CalcTrace = {
  result?: Result; fixedHP?: boolean; engine?: { attacker: Pokemon; defender: Pokemon; move: Move; conditions: BattleConditions };
  /** The priority the move is used with, for the turn order. */
  priority?: number;
};
/** A later use's builds and field, and Metronome's count of the attacker's earlier consecutive uses. */
export type RerunInput = { attacker: BattleBuild; defender: BattleBuild; conditions: BattleConditions; context: MoveContext | undefined; consecutive: number };
export type Rerun = (input: RerunInput) => { row: MoveDamageResult; trace: CalcTrace };
export type UsesHelpers = {
  /** The other battler's Neutralizing Gas suppresses this build's ability. */
  gassed: (build: BattleBuild, other: BattleBuild, conditions: BattleConditions) => boolean;
  klutz: (build: BattleBuild, other: BattleBuild) => boolean;
  /** Shields Down / Schooling form at the build's current HP at the end of a turn, or null when it keeps its form. */
  hpForm: (build: BattleBuild) => string | null;
  /** A Paradox species (its Booster Energy cannot be taken). */
  paradox: (speciesId: string) => boolean;
  /** The first hit (0-based) whose user is burned by Spicy Spray, or null. */
  spicySpray: (result: Result, attacker: BattleBuild, conditions: BattleConditions) => number | null;
  makeField: (conditions: BattleConditions) => Field;
};

type Stages = Record<CombatStat, number>;
type Side = {
  /** Engine HP (Dynamax HP while Dynamaxed); maxHP likewise; baseMaxHP without Dynamax. */
  hp: number; maxHP: number; baseMaxHP: number;
  itemId: string; boosts: Stages; abilityId: string; speciesId: string; status: BattleStatus;
  mechanic: BattleBuild["mechanic"]; dynamaxTurns: number | null;
  /** Bad poison's counter (Showdown's tox stage, at most 15), an active Slow Start's turns left, and Salt Cure. */
  toxic: number; slowStart: number | null; saltCure: boolean;
  /** Smack Down or Thousand Arrows grounded it (pinned Showdown smackdown volatile). */
  smackedDown: boolean;
  /** Its Unburden has activated (pinned Showdown unburden volatile: an item used up or taken); it doubles Speed while it holds nothing. */
  unburden: boolean;
  /** It has the focusenergy volatile from a Lansat Berry (+2 critical-hit ratio; BattleBuild.settledFocusEnergy). */
  focusEnergy: boolean;
};
/**
 * Everything a use reads, with no use number in it, so that a state met again is the same state: `first`
 * until the first use is done (Stellar), and whether the attacker has fainted (the exact search drops that
 * state; a roll path follows it on at 1 HP, to say when it fainted). Metronome's counter follows pinned
 * Showdown's item condition: `consecutive` is its numConsecutive (capped at the 5 that counts), `streak` whether the
 * attacker's last move was this one (1) and succeeded last turn (2), and `charged` whether this use's
 * charge turn has passed (a charge turn skips the item's TryMove handler, and the attack turn then counts
 * on from any earlier use of the move).
 */
type State = {
  att: Side; def: Side; conditions: BattleConditions; fieldKey: string;
  first: boolean; attackerFainted: boolean;
  consecutive: number; streak: 0 | 1 | 2; charged: boolean;
  /** The turns left of a weather and a terrain a use set (pinned Showdown duration); null for the field as set, which lasts. */
  weatherTurns: number | null; terrainTurns: number | null;
};
/** A hit's distinct rolls and their shares, the lowest and highest, and those alone for the roll paths (made once). */
type HitRolls = { values: number[]; weights: number[]; min: number; max: number; lowest?: number[]; highest?: number[] };
/** The one share of a roll path's single roll. */
const ONE = [1];
/**
 * One case of a use, with its chance: Fickle Beam's doubled power or a Shell Side Arm tie's physical hit is a
 * second case, and each count of a random hit count is one (`random`: the cases of one count after another,
 * each the first hits of the next, ascending).
 */
type UseCase = { chance: number; hits: HitRolls[]; contact: boolean; physical: boolean; min: number; max: number; at?: number; random?: true };
/**
 * A calculation and what a use from it reads: its cases, whether it is super effective (Enigma Berry, Weakness
 * Policy), the resist Berry and the Gem its damage used ("" if none), and the status it gives (its own move's
 * only once Dynamax ends) and whether that is a secondary (Sheer Force, Shield Dust and Covert Cloak stop it).
 * `paths`: the case each roll path takes (casesFor), made once.
 */
type Run = {
  row: MoveDamageResult; trace: CalcTrace; cases: UseCase[]; superEffective: boolean;
  resistBerry: string; gem: string; status: BattleStatus | null; statusSecondary: boolean;
  paths?: { lowest?: UseCase[]; highest?: UseCase[] };
};
type Mode = "all" | "lowest" | "highest";
/**
 * A count: ko[n - 1] is the chance the target is out within n uses (where it is needed), `chance` the
 * chance within the limit, and `fell` the first use on which a sequence faints the attacker with the target
 * still in (then nothing is guaranteed). fallback: the budget ran out or a reachable state could not be calculated.
 */
type Count = { guaranteed: number | null; fewest: number | null; ko: number[]; chance: number; fell: number | null; fallback: boolean; endOfTurn?: boolean };
/**
 * One roll path: the uses to KO (null past its cap), the use after which the attacker faints, the use it
 * faints on with the target still in, why it stopped, and whether an end of turn knocked the target out.
 */
type Walked = { uses: number | null; faints?: number; fallsFirst?: number; stop?: string; endOfTurn?: boolean; resume?: Resume };
/** Where a roll path that reached its cap stands, to walk on from (path's `from`). */
type Resume = { groups: Group[]; use: number; previous: Node | null; faints?: number; fallsFirst?: number };
/**
 * The most uses a row's move can have (a Dynamaxed attacker's base move once Dynamax ends, Perish Body), the
 * reason when no count is guaranteed within them, and whether the last of them faints the user.
 */
type UsesCap = { uses: number; reason: string; faints?: true };
/** A calculation whose engine call can be rerun for other states: its state, engine inputs and row. */
type Anchor = { state: State; engine: NonNullable<CalcTrace["engine"]>; row: MoveDamageResult };
type Knock = (mass: number) => void;
/** One side's end-of-turn HP changes (UPDATE where berries are checked) and their names. */
type Residuals = { ops: number[]; names: string[]; orders: number[] };
/** An interned state: its key, and its memoised calculations, berries, end-of-turn plan and transitions. */
type Node = {
  /** Its id, and while the attacker's HP is followed the id of its key but that HP (the same for states that differ only in it). */
  id: number; restId: number; state: State; key: string;
  runs: Map<number, Run>; hits: Map<number | string, Node>; turns: Map<number, Node>;
  rest?: string;

  /** Cheek Pouch's heal after a use's hits, by the outcome key of `hits` (none when absent). */
  heals?: Map<number | string, number>;
  /** The hits of a case from its state (hitsWalk), from the attacker's HP [0] or an HP no loss reaches [1]. */
  walks?: Map<UseCase, [HitWalk?, HitWalk?]>;
  /** The attacker's hit modes from its state when they change within a use (midKey). */
  mid?: string;
  /** What it shares with the nodes of its state but the attacker's HP. */
  shared: Shared;
};
/**
 * What the nodes of one state but the attacker's HP share, made once: the residuals (the attacker's on a
 * charge turn that leaves it semi-invulnerable too), the target's end-of-turn plan, the berry it can eat at a
 * hit's Update (after a hit without and with contact), and after a use whose dealt damage changes only the
 * attacker's followed HP, the state it leaves but that HP, its key but that HP, the nodes by HP, and Cheek
 * Pouch's heal.
 */
type Shared = {
  residuals?: { att: Residuals; def: Residuals }; charging?: Residuals; plan?: TurnPlan;
  hitBerries?: [Berry | null | undefined, Berry | null | undefined];
  variants?: Map<string, { base: State; rest: number; byHP: Map<number, Node>; heal: number; direct: boolean }>;
  /** Likewise after an end of turn (afterTurnNode). */
  turnVariants?: Map<number, { base: State; rest: number; byHP: Map<number, Node> }>;
};
type Group = { node: Node; dist: Dist; landed?: number };
/** One walk of the first use (UsesSearch.firstUse): the HP left, the mass knocked out and whether any was, and the HP regained by source. */
type OneUseWalk = { dist: Dist; out: number; seen: boolean; heals: Map<string, [number, number]> };
/** The target's end of turn from one state: its HP steps, the berry checked at each Update, its form line, Dynamax ending. */
type TurnPlan = { ops: number[]; orders: number[]; berry: Berry | null; ended: Berry | null; formLow: ((hp: number) => boolean) | null; dynamaxEnds: boolean };

const SINGLE_USE: Record<string, string> = {
  explosion: "The user faints", selfdestruct: "The user faints", mistyexplosion: "The user faints", finalgambit: "The user faints",
  fakeout: "Works only on its first turn out", firstimpression: "Works only on its first turn out",
  naturalgift: "Natural Gift uses up its Berry", fling: "Fling throws its item away",
};
const SELF_COST_MOVES = new Set(["steelbeam", "mindblown", "chloroblast"]);
const TRAPPING_MOVES = new Set(["bind", "clamp", "firespin", "infestation", "magmastorm", "sandtomb", "snaptrap", "thundercage", "whirlpool", "wrap", "gmaxsandblast", "gmaxcentiferno"]);
const GMAX_RESIDUAL_MOVES = new Set(["gmaxcannonade", "gmaxvinelash", "gmaxvolcalith", "gmaxwildfire"]);
const RANDOM_STATUS_MOVES = new Set(["gmaxbefuddle", "gmaxstunshock"]);
/** Moves that lock the user in for 2 or 3 turns (pinned Showdown lockedmove): runMove takes PP only at the start of a lock. */
const LOCK_IN_MOVES = new Set(["outrage", "petaldance", "ragingfury", "thrash"]);
const SUCCESS_MOVES = new Set(["suckerpunch", "thunderclap", "upperhand", "shelltrap"]);
/** The statuses each move's damage reads ("any" status for Hex and Infernal Parade). */
const STATUS_READS: Record<string, readonly BattleStatus[] | "any"> = {
  hex: "any", infernalparade: "any", dreameater: ["slp"], wakeupslap: ["slp"], smellingsalts: ["par"], venoshock: ["psn", "tox"], barbbarrage: ["psn", "tox"],
};
/** Charge moves whose user is semi-invulnerable on its charge turn: no Grassy Terrain heal then (pinned Showdown isSemiInvulnerable), and Dig and Dive are immune to sand and hail. */
const SEMI_INVULNERABLE_MOVES = new Set(["bounce", "dig", "dive", "fly", "phantomforce", "shadowforce", "skydrop"]);
/** The largest double below 1: a chance that is not certain is never reported as 1. */
const BELOW_ONE = 1 - Number.EPSILON / 2;
const BERRY_STEALERS = new Set(["bugbite", "pluck", "incinerate"]);
/** Why a count or a turn is not estimated when a Starf Berry is eaten: it raises a stat chosen at random (data/items.ts starfberry this.sample). */
export const STARF_REASON = "Starf Berry raises a random stat";
/** Target Berries that hit back once (pinned Showdown jabocaberry and rowapberry onDamagingHit): the category each answers. */
const RETALIATION_BERRIES: Record<string, "Physical" | "Special"> = { jabocaberry: "Physical", rowapberry: "Special" };
/** An attacker HP no loss in one use reaches: a walk of the hits from it neither faints nor heals (what the hits do but that HP). */
const UNTRACKED = 2 ** 40;
const ITEM_MOVES = new Set(["knockoff", "poltergeist", "acrobatics", "covet", "thief", "bugbite", "pluck", "incinerate"]);
/** Held items whose loss changes no damage (what they do that does is carried as stages, HP or residuals). */
const NEUTRAL_ITEMS = new Set([...HEALING_BERRIES, ...Object.keys(PINCH_STAT_BERRIES), "lumberry", "rawstberry", "cheriberry", "pechaberry", "aspearberry", "chestoberry", "persimberry",
  "keeberry", "marangaberry", "luminousmoss", "absorbbulb", "cellbattery", "snowball", "weaknesspolicy", "throatspray", "focussash", "focusband",
  "leftovers", "blacksludge", "rockyhelmet", "ejectbutton", "redcard", "shellbell", "custapberry", "micleberry", "lansatberry", "jabocaberry", "rowapberry",
  "stickybarb", "powerherb", "safetygoggles", "mirrorherb", "whiteherb", "mentalherb", "covertcloak", "clearamulet", "electricseed", "grassyseed", "mistyseed", "psychicseed"]);
const HP_FORM_ABILITIES = new Set(["shieldsdown", "schooling", "zenmode"]);
const SPEED_MOVES = new Set(["electroball", "gyroball", "boltbeak", "fishiousrend"]);
/** Moves whose category the engine sets from the stats (gen789.js / champions.js: Photon Geyser, Tera Blast and Tera Starstorm Terastallized, Shell Side Arm). */
const VARIABLE_CATEGORY_MOVES = new Set(["photongeyser", "lightthatburnsthesky", "terablast", "terastarstorm", "shellsidearm"]);
/** Special moves that hit the target's Defense (overrideDefensiveStat). */
const DEFENSE_SPECIAL_MOVES = new Set(["psyshock", "psystrike", "secretsword"]);
const STAGE_COUNT_MOVES = new Set(["storedpower", "powertrip", "punishment"]);
/** Abilities the battle settles from the weather or terrain on entry (calculate.ts settleAbilities / settleItems). */
const FIELD_SETTLED_ABILITIES = new Set(["forecast", "mimicry", "protosynthesis", "quarkdrive", "flowergift", "iceface"]);
/** Abilities that block a foe's drops (pinned Showdown onTryBoost; Clear Amulet is the item, Mirror Armor turns them back); tests/source checks them. */
export const STAT_GUARDS: Record<string, CombatStat[] | "all"> = { clearbody: "all", whitesmoke: "all", fullmetalbody: "all", hypercutter: ["atk"], bigpecks: ["def"] };
/** Of the abilities boost() reads, the ones Mold Breaker cannot ignore (pinned Showdown flags.breakable unset). */
export const UNBREAKABLE = new Set(["fullmetalbody"]);
const MOLD_BREAKERS = new Set(["moldbreaker", "teravolt", "turboblaze"]);
/** The target abilities that replace a contact attacker's own (pinned Showdown onDamagingHit setAbility). */
const ABILITY_REPLACERS = new Set(["mummy", "lingeringaroma", "wanderingspirit"]);
/** Terrain Seeds: the terrain that uses each up and the stat it raises (pinned Showdown data/items.ts). */
const SEEDS: Record<string, { terrain: BattleConditions["terrain"]; stat: CombatStat }> = {
  grassyseed: { terrain: "Grassy", stat: "def" }, electricseed: { terrain: "Electric", stat: "def" }, psychicseed: { terrain: "Psychic", stat: "spd" }, mistyseed: { terrain: "Misty", stat: "spd" },
};
/**
 * Abilities whose entry rise the engine adds on every calculation (gen789.js checkDauntlessShield,
 * checkIntrepidSword, checkEmbody, checkWindRider), and the stat: a later use's calculation has the rise in
 * its stages already, so the engine's own is switched off for it.
 */
export const ENTRY_ABILITIES: Record<string, CombatStat> = {
  dauntlessshield: "def", intrepidsword: "atk", windrider: "atk",
  embodyaspectcornerstone: "def", embodyaspecthearthflame: "atk", embodyaspectteal: "spe", embodyaspectwellspring: "spd",
};
/** Mega Stones keyed by the form that Mega Evolves, not its family (pinned Showdown onTakeItem on baseSpecies.name). */
const FORM_KEYED_MEGA_STONES = new Set(["floettite", "magearnite", "meowsticite", "tatsugirinite"]);
/**
 * Items whose onTakeItem keeps them with a family (pinned Showdown data/items.ts and the gen8 mod): the family,
 * whether the handler also reads the taker (plates, memories, drives, the Origin items, Rusted Sword and
 * Shield), which Thief and Covet check for every item, and the games it holds in when not all.
 */
export const OWNED_ITEMS: Record<string, [family: string, taker: boolean, games?: BattleGame[]]> = {
  griseousorb: ["giratina", true, ["sword_shield", "ultra_sun_ultra_moon"]],
  ...Object.fromEntries(["draco", "dread", "earth", "fist", "flame", "icicle", "insect", "iron", "meadow", "mind", "pixie", "sky", "splash", "spooky", "stone", "toxic", "zap"].map((name) => [`${name}plate`, ["arceus", true]])),
  ...Object.fromEntries(["bug", "dark", "dragon", "electric", "fairy", "fighting", "fire", "flying", "ghost", "grass", "ground", "ice", "poison", "psychic", "rock", "steel", "water"].map((name) => [`${name}memory`, ["silvally", true]])),
  ...Object.fromEntries(["burn", "chill", "douse", "shock"].map((name) => [`${name}drive`, ["genesect", true]])),
  adamantcrystal: ["dialga", true], lustrousglobe: ["palkia", true], griseouscore: ["giratina", true], rustedsword: ["zacian", true], rustedshield: ["zamazenta", true],
  redorb: ["groudon", false], blueorb: ["kyogre", false], cornerstonemask: ["ogerpon", false], hearthflamemask: ["ogerpon", false], wellspringmask: ["ogerpon", false], zygardite: ["zygarde", false],
};
/** Target abilities a hit triggers (pinned Showdown onDamagingHit boosts) and the stages they change. */
export const HIT_ABILITIES: Record<string, { stages: Partial<Stages>; when: (type: string, physical: boolean, contact: boolean) => boolean; attacker?: boolean }> = {
  stamina: { stages: { def: 1 }, when: () => true },
  weakarmor: { stages: { def: -1, spe: 2 }, when: (_type, physical) => physical },
  watercompaction: { stages: { def: 2 }, when: (type) => type === "Water" },
  steamengine: { stages: { spe: 6 }, when: (type) => type === "Fire" || type === "Water" },
  rattled: { stages: { spe: 1 }, when: (type) => type === "Bug" || type === "Dark" || type === "Ghost" },
  justified: { stages: { atk: 1 }, when: (type) => type === "Dark" },
  thermalexchange: { stages: { atk: 1 }, when: (type) => type === "Fire" },
  cottondown: { stages: { spe: -1 }, when: () => true, attacker: true },
  gooey: { stages: { spe: -1 }, when: (_type, _physical, contact) => contact, attacker: true },
  tanglinghair: { stages: { spe: -1 }, when: (_type, _physical, contact) => contact, attacker: true },
};
/** Target items a hit uses (once) and the stages they change; Kee and Maranga Berry act after the whole move. */
export const HIT_ITEMS: Record<string, { stages: Partial<Stages>; when: (type: string, physical: boolean, superEffective: boolean) => boolean; berry?: boolean }> = {
  keeberry: { stages: { def: 1 }, when: (_type, physical) => physical, berry: true },
  marangaberry: { stages: { spd: 1 }, when: (_type, physical) => !physical, berry: true },
  luminousmoss: { stages: { spd: 1 }, when: (type) => type === "Water" },
  absorbbulb: { stages: { spa: 1 }, when: (type) => type === "Water" },
  cellbattery: { stages: { atk: 1 }, when: (type) => type === "Electric" },
  snowball: { stages: { atk: 1 }, when: (type) => type === "Ice" },
  weaknesspolicy: { stages: { atk: 2, spa: 2 }, when: (_type, _physical, superEffective) => superEffective },
};
/** Cures a berry gives at once, before the status can act (pinned Showdown onUpdate). */
const STATUS_CURES: Record<string, readonly BattleStatus[]> = {
  lumberry: ["brn", "par", "psn", "tox", "slp", "frz"], rawstberry: ["brn"], cheriberry: ["par"], pechaberry: ["psn", "tox"],
};
/** Held items a use or an end of turn can use up or move on, which Poltergeist (the target's) and Acrobatics (the attacker's) read. */
const CONSUMED = new Set([...HEALING_BERRIES, ...Object.keys(PINCH_STAT_BERRIES), ...Object.keys(STATUS_CURES), ...Object.keys(HIT_ITEMS), "focussash", "airballoon", "whiteherb",
  "mirrorherb", "powerherb", "throatspray", "stickybarb", "ejectbutton", "redcard", "electricseed", "grassyseed", "mistyseed", "psychicseed"]);
const STRONG_WEATHERS = ["Harsh Sunshine", "Heavy Rain", "Strong Winds"];
const STATS: CombatStat[] = ["atk", "def", "spa", "spd", "spe"];
const STAT_LABELS: Record<CombatStat, string> = { atk: "Attack", def: "Defense", spa: "Sp. Atk", spd: "Sp. Def", spe: "Speed" };
const STATUS_NAMES: Record<string, string> = { brn: "burn", par: "paralysis", psn: "poison", tox: "bad poison", slp: "sleep", frz: "freeze" };
/** The stat each Nature lowers (model.ts NATURES), for a Figy-family Berry's confusion. */
const NATURE_MINUS: Record<string, CombatStat | null> = Object.fromEntries(NATURES.map((nature) => [nature.name, nature.minus]));
/** A confused attacker's note (calculate.ts adds it for one confused before the move): the count follows the move being used. */
export const CONFUSED_NOTE = "Assumes the confused attacker does not hit itself.";
const clamp = (stage: number) => Math.max(-6, Math.min(6, stage));
const listNames = (names: string[]) => names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
const maxActive = (side: Side) => side.mechanic === "dynamax" || side.mechanic === "gigantamax";

// Event bits of one use's outcome, for the state it leaves: Focus Sash used, an HP or a stat berry eaten,
// any damage dealt, Anger Shell's line crossed (each time it is), a survival effect that saved the target
// this use; at the end of a turn, a berry eaten and the low side of a form's HP line.
const SASH_USED = 1, BERRY_EATEN = 2, DAMAGED = 4, ANGER_SHELL = 8, SAVED = 16, FORM_LOW = 32;
/** A doubles-turn hit knocked the target out (turnStep): its node keeps the attacker's state after that hit. */
const KNOCKED = 64;
/** In a residual plan, where berries are checked (pinned Showdown's Update after the weather and after the residuals). */
const UPDATE = 0;

/**
 * The doubles turn's environment for one pair (doubles-turn.ts): `turn` switches the search to one use within a turn
 * (createTurnSearch), `unnerved` whether the target's foes' Unnerve or As One stops its Berries, `unnerve` the turn's
 * Unnerve and As One for both Pokémon's Berries (hit-loop.ts TurnUnnerve: whether the two are foes, and another
 * Pokémon's), and `fieldSettled` the abilities and items of the other two Pokémon that a weather or terrain change
 * would change.
 */
export type UsesEnv = { turn?: true; unnerved?: boolean; unnerve?: TurnUnnerve; fieldSettled?: readonly string[] };

/** Facts about the two settled Pokémon that hold for every row of a matchup. */
export type UsesMatchup = ReturnType<typeof prepareUses>;
export function prepareUses(attacker: BattleBuild, defender: BattleBuild, conditions: BattleConditions, runtime: BattleRuntime, helpers: UsesHelpers, env?: UsesEnv) {
  const attAbility = helpers.gassed(attacker, defender, conditions) ? "" : attacker.abilityId;
  const defAbility = helpers.gassed(defender, attacker, conditions) ? "" : defender.abilityId;
  const attItemOn = !conditions.magicRoom && !helpers.klutz(attacker, defender);
  const defItemOn = !conditions.magicRoom && !helpers.klutz(defender, attacker);
  const dynamax = [attacker, defender].some((build) => build.mechanic === "dynamax" || build.mechanic === "gigantamax");
  const notes: string[] = [];
  const { attackerSide: own, defenderSide: foe } = conditions;
  // The field effects with a timer; each row's note leaves out one its own move ends (timedNote).
  const timed = [conditions.weather && "the weather", conditions.terrain && "the terrain", (foe.reflect || foe.lightScreen || foe.auroraVeil) && "the screens",
    (own.tailwind || foe.tailwind) && "Tailwind", conditions.trickRoom && "Trick Room", conditions.gravity && "Gravity",
    conditions.magicRoom && "Magic Room", conditions.wonderRoom && "Wonder Room"].filter(Boolean) as string[];
  if (own.helpingHand) notes.push("Assumes Helping Hand on every use.");
  if (dynamax) notes.push("Assumes Dynamax started this turn.");
  if ([attacker, defender].some((build) => build.status === "tox")) notes.push("Assumes bad poison started this turn.");
  if (attAbility === "slowstart" && attacker.abilityActive) notes.push("Assumes Slow Start started this turn.");
  if (attacker.status === "par") notes.push("Assumes the paralysed attacker is never fully paralysed.");
  return {
    attacker, defender, conditions, runtime, helpers, gen: Generations.get(runtime.profile.generation),
    attAbility, defAbility, attItemOn, defItemOn, dynamax, notes, timed,
    unnerved: env?.unnerve ? berryUnnerved(env.unnerve, "target", attAbility) : env?.unnerved ?? UNNERVES.has(attAbility), unnerve: env?.unnerve,
    turn: !!env?.turn, fieldSettled: env?.fieldSettled ?? [],
    hpForms: [attacker, defender].some((build) => HP_FORM_ABILITIES.has(build.abilityId)),
    attackerItem: attItemOn ? attacker.itemId : "", defenderItem: defItemOn ? defender.itemId : "",
    /** Cloud Nine or Air Lock on either Pokémon stops every weather residual (pinned Showdown suppressingWeather). */
    weatherSuppressed: [attAbility, defAbility].some((ability) => ability === "cloudnine" || ability === "airlock"),
    /** What every row's first state shares: its residuals and their sentences, by what they read. */
    shared: new Map<string, { residuals: { att: Residuals; def: Residuals }; texts?: string[] }>(),
  };
}

/** toID, memoised: the names it meets repeat across rows and uses. */
const IDS = new Map<string, ReturnType<typeof toID>>();
function id(name: string): ReturnType<typeof toID> {
  let found = IDS.get(name);
  if (found === undefined) IDS.set(name, found = toID(name));
  return found;
}

export type UsesRow = { move: ChampionsMove; row: MoveDamageResult; trace: CalcTrace; context: MoveContext | undefined; rerun: Rerun };

/** A row's count when its search throws (calculate.ts gives the same when the matchup cannot be prepared). */
export const UNCOUNTED = "The uses could not be counted";

/**
 * Uses to KO and the first use's outcome (types.ts AfterUse) for one row, from one search: the count first, then
 * the first use's walk (UsesSearch.firstUse), which reuses the calculations the count made. A count that throws
 * leaves the outcome to a fresh search, and an outcome that throws leaves the count.
 */
export function estimateUses(m: UsesMatchup, input: UsesRow): { usesToKO: UsesToKO; afterUse: AfterUse | null } {
  let search: UsesSearch | undefined;
  const searchOf = () => search ??= new UsesSearch(m, input, input.trace.result!);
  let usesToKO: UsesToKO;
  try {
    usesToKO = countUses(m, input, searchOf);
  } catch {
    usesToKO = { kind: "not-estimated", reason: UNCOUNTED };
    search = undefined;
  }
  let afterUse: AfterUse | null = null;
  try {
    afterUse = firstUseOutcome(m, input, searchOf);
  } catch {
    afterUse = null;
  }
  return { usesToKO, afterUse };
}

/**
 * The first use's outcome: none without an engine result or a hit count, or with a Focus Band (pinned Showdown
 * focusband onDamage: a 10% chance on each hit that would knock out, which the walk does not branch on). The
 * reasons Uses to KO is not estimated otherwise concern the uses after the first or the ends of turns. A row
 * without damage (an immune target), whatever its hit count, is noDamageUse.
 */
function firstUseOutcome(m: UsesMatchup, { row, trace }: UsesRow, searchOf: () => UsesSearch): AfterUse | null {
  const result = trace.result;
  if (!result || row.min === null || row.max === null) return null;
  if (row.max === 0 && !(row.alternate && row.alternate.max > 0)) return noDamageUse(m, result);
  if (row.hits === null) return null;
  if (result.defender.hasItem("Focus Band")) return null;
  return searchOf().firstUse();
}

/** The target abilities that take a move of their type and heal (noDamageUse). */
const ABSORB_HEALS: Record<string, string> = { waterabsorb: "Water", voltabsorb: "Electric", dryskin: "Water", eartheater: "Ground" };

/**
 * A use without damage leaves the target's HP as it is, but for an ability that takes the move's type and heals a
 * quarter of the target's base maximum HP (pinned Showdown data/abilities.ts waterabsorb, voltabsorb, dryskin and
 * eartheater onTryHit: battle.heal(target.baseMaxhp / 4), rounded down, once a move), which hitStepTryHitEvent
 * runs before the type immunity check and after Protect; the attacker's Mold Breaker passes the ability.
 */
function noDamageUse(m: UsesMatchup, result: Result): AfterUse {
  const start = result.defender.curHP(), maxHP = result.defender.maxHP();
  const absorbs = ABSORB_HEALS[m.defAbility] === result.move.type && !m.conditions.defenderSide.protect
    && !(MOLD_BREAKERS.has(m.attAbility) && !(m.defender.itemId === "abilityshield" && !m.conditions.magicRoom));
  const heal = absorbs ? Math.max(0, Math.min(maxHP - start, Math.max(1, Math.floor(result.defender.maxHP(true) / 4)))) : 0;
  const left = start + heal;
  const heals = heal ? [`${m.runtime.abilitiesById.get(m.defAbility)?.name ?? m.defAbility}: +${heal} HP.`] : [];
  const path = () => ({ dealt: 0, heals: [...heals] });
  return { start, low: left, high: left, average: left, min: left, max: left, koChance: 0, heals, paths: { low: path(), high: path() } };
}

function countUses(m: UsesMatchup, input: UsesRow, searchOf: () => UsesSearch): UsesToKO {
  const { move, row, trace } = input;
  const { attacker, conditions } = m;
  if (row.max === 0 && !(row.alternate && row.alternate.max > 0)) return { kind: "no-damage" };
  const result = trace.result;
  if (!result || row.min === null || row.max === null || row.hits === null) return { kind: "not-estimated", reason: "No damage result to repeat" };
  if (conditions.defenderSide.protect) return { kind: "not-estimated", reason: "The target may not protect again" };
  if (result.defender.hasItem("Focus Band")) return { kind: "not-estimated", reason: "Focus Band: 10% to survive each KO hit" };
  const engineId = id(result.move.name);
  // A Dynamaxed attacker's row is its Max Move while Dynamax lasts, and the row's own move after it.
  const maxed = !!result.move.isMax;
  const unmodelled = unmodelledReason(m, move, result, engineId);
  if (unmodelled) return { kind: "not-estimated", reason: unmodelled };
  const search = searchOf();
  // The attacker's Power Construct acts at the end of a turn it ends at half HP or less.
  if (m.attAbility === "powerconstruct" && attacker.speciesId.startsWith("zygarde") && attacker.speciesId !== "zygardecomplete" && !attacker.transformedFrom && search.attackerCanHalve()) {
    return { kind: "not-estimated", reason: "Power Construct changes its form" };
  }
  // False Swipe and Hold Back leave 1 HP, and Endeavor stops at the user's HP: only the target's end of turn can then knock it out.
  const spares = row.leavesOneHP ? `${row.effectiveName ?? move.name} leaves at least 1 HP` : move.id === "endeavor" && !maxed ? "Can't lower HP below the user's" : null;
  if (spares && !search.endOfTurnDamage()) return { kind: "never", reason: spares };
  // One use at most: the user faints, the move fails after its first turn out, a Z-Move, or the move cannot work again.
  const once = result.move.isZ ? "Z-Moves are once per battle" : maxed ? null : onceReason(m, move);
  if (once) {
    const counted = search.exactCount(1);
    if (counted.fallback) return { kind: "not-estimated", reason: "Too many cases to count" };
    // Certain only when no sequence is left after the use (its float sum can round to 1 without it).
    const koChance = counted.guaranteed === 1 ? 1 : uncertain(counted.ko[0] ?? 0, counted.fewest === 1);
    return { kind: "single-use", reason: once, koChance };
  }
  const caps = [maxed ? dynamaxCap(m, move) : null, search.perishCap()].filter((cap): cap is UsesCap => cap !== null);
  return search.usesToKO(caps.length ? caps.reduce((a, b) => b.uses < a.uses ? b : a) : null);
}

/** Why the row's own move works once at most: the user faints, it fails after its first turn out, or it cannot work again. */
function onceReason(m: UsesMatchup, move: ChampionsMove): string | undefined {
  if ((move.id === "burnup" || move.id === "doubleshock") && m.attacker.mechanic !== "tera") return `${move.name} removes its ${move.id === "burnup" ? "Fire" : "Electric"} type`;
  if (move.id === "steelroller" && m.conditions.terrain) return "Steel Roller ends the terrain";
  return SINGLE_USE[move.id];
}

/**
 * A Dynamaxed attacker repeats its Max Move for Dynamax's 3 turns (2 uses with Truant's loafing, pinned
 * Showdown truant onBeforeMove), then uses the row's own move: one that works once adds one use and the
 * cap ends there; one that fails then (Fake Out), lands later (Future Sight) or traps at random ends it
 * with the Max uses. Null: the row's own move repeats.
 */
function dynamaxCap(m: UsesMatchup, move: ChampionsMove): UsesCap | null {
  const maxUses = m.attAbility === "truant" ? 2 : 3;
  if (SINGLE_USE[move.id] === "The user faints") return { uses: maxUses + 1, reason: "The user faints after Dynamax ends", faints: true };
  if (move.id === "fakeout" || move.id === "firstimpression") return { uses: maxUses, reason: "Fails after Dynamax ends" };
  if (move.id === "futuresight" || move.id === "doomdesire") return { uses: maxUses, reason: "Lands two turns later, one at a time" };
  if (TRAPPING_MOVES.has(move.id)) return { uses: maxUses, reason: "Its trap lasts 4 or 5 turns at random" };
  if (move.id === "steelroller" && !m.conditions.terrain) return { uses: maxUses, reason: "Steel Roller fails without a terrain" };
  const once = onceReason(m, move);
  return once ? { uses: maxUses + 1, reason: once } : null;
}

/** A chance that is not certain: below 1 however its float sum rounds, and above 0 when some sequence does it. */
function uncertain(chance: number, possible: boolean): number {
  return Math.min(BELOW_ONE, chance > 0 || !possible ? chance : Number.MIN_VALUE);
}

/** Effects that change later uses in ways the state does not carry, as the short reason for not estimating. */
function unmodelledReason(m: UsesMatchup, move: ChampionsMove, result: Result, engineId: string): string | null {
  const { attacker, defender, attAbility, defAbility } = m;
  // A Max Move from them repeats; dynamaxCap stops the uses before the row's own move would land or trap.
  const maxed = !!result.move.isMax;
  if (!maxed && (move.id === "futuresight" || move.id === "doomdesire")) return "Lands two turns later, one at a time";
  if ((TRAPPING_MOVES.has(move.id) && !maxed) || TRAPPING_MOVES.has(engineId)) return "Its trap lasts 4 or 5 turns at random";
  if (GMAX_RESIDUAL_MOVES.has(engineId)) return `${result.move.name} damages it each turn`;
  if (RANDOM_STATUS_MOVES.has(engineId)) return "It inflicts a random status";
  // Pinned Showdown battle.ts getTarget picks a random foe for these on every use, the locked turns included.
  if (move.target === "randomNormal" && !maxed && m.conditions.gameType === "Doubles" && m.conditions.multipleTargets) return "Hits a random foe each turn";
  if (move.id === "relicsong" && attacker.speciesId.startsWith("meloetta")) return "Relic Song changes Meloetta's form";
  if (move.id === "aurawheel" && attAbility === "hungerswitch") return "Hunger Switch flips Aura Wheel's type";
  if (move.id === "spectralthief" && STATS.some((stat) => (defender.boosts[stat] ?? 0) > 0)) return "Spectral Thief steals its boosts";
  if (move.id === "coreenforcer" && defAbility) return "Core Enforcer can suppress its ability";
  // Pinned Showdown powerconstruct onResidual: a Zygarde at half HP or less becomes Zygarde-Complete (which has no other form).
  if (defAbility === "powerconstruct" && defender.speciesId !== "zygardecomplete") return "Power Construct changes its form";
  if (defAbility === "colorchange") return "Color Change changes the target's type";
  if (attAbility === "moody" || defAbility === "moody") return "Moody changes stats at random";
  const berry = m.defItemOn && (HEALING_BERRIES.has(defender.itemId) || !!PINCH_STAT_BERRIES[defender.itemId]);
  // A Jaboca or Rowap Berry is eaten as it hits back (the category it answers), and Harvest may regrow it.
  const retaliates = m.defItemOn && RETALIATION_BERRIES[defender.itemId] === (result.move.category === "Special" ? "Special" : "Physical");
  if (defAbility === "harvest" && (berry || retaliates)) return "Harvest may regrow its Berry";
  if (defAbility === "cudchew" && berry) return "Cud Chew eats its Berry twice";
  if (m.defenderItem === "starfberry") return STARF_REASON;
  if (attacker.status === "slp") return "Sleep wears off at random";
  if (attacker.status === "frz") return "Freeze thaws at random";
  // A sleeping or frozen target wakes or thaws at random: that matters when the damage reads the status, or Bad Dreams damages it while it sleeps.
  const reads = STATUS_READS[move.id];
  const read = (status: BattleStatus) => reads === "any" || !!reads?.includes(status) || defAbility === "marvelscale";
  if ((defender.status === "slp" || defender.status === "frz") && read(defender.status) && !(move.id === "wakeupslap" && defender.status === "slp")) {
    return defender.status === "slp" ? "Sleep wears off at random" : "Freeze thaws at random";
  }
  if (defender.status === "slp" && attAbility === "baddreams" && defAbility !== "comatose") return "Sleep wears off at random";
  // Pinned Showdown shedskin onResidual: a 1 in 3 chance each turn to cure the holder's status.
  if (attAbility === "shedskin" && attacker.status) return "Shed Skin may cure its status";
  const inflicted = !defender.status && (STATUS_MOVES[engineId] ?? (maxed ? undefined : STATUS_MOVES[move.id]))?.status;
  const orb = m.defItemOn && !defender.status && (defender.itemId === "flameorb" || defender.itemId === "toxicorb");
  if (defAbility === "shedskin" && ((defender.status && (["brn", "psn", "tox"].includes(defender.status) || read(defender.status))) || (inflicted && inflicted !== "par") || orb)) {
    return "Shed Skin may cure its status";
  }
  if (move.id === "psychicnoise" && (["leftovers", "blacksludge"].includes(m.defenderItem) || HEALING_BERRIES.has(m.defenderItem)
    || m.conditions.terrain === "Grassy" || ["raindish", "dryskin", "icebody", "poisonheal"].includes(defAbility))) return "Psychic Noise blocks healing at times";
  return null;
}

/** Two reusable sum buffers (a row's search is synchronous), grown as needed and kept zeroed outside what a call writes. */
const SUMS: Float64Array[] = [new Float64Array(64), new Float64Array(64)];
function sumBuffers(size: number): [Float64Array, Float64Array] {
  if (SUMS[0].length < size) for (let index = 0; index < 2; index++) SUMS[index] = new Float64Array(Math.max(size, SUMS[index].length * 2));
  return [SUMS[0], SUMS[1]];
}

/**
 * P(the sum of n independent uses, each one of `values` with `weights`, reaches `target`): a convolution
 * truncated at the target. Each use adds into sums from the lowest to the highest, a value at a time.
 */
function sumReaches(values: number[], weights: number[], target: number, n: number): number {
  if (target <= 0) return 1;
  let [current, next] = sumBuffers(target + 1);
  let low = Infinity, high = 0;
  for (const value of values) { if (value < low) low = value; if (value > high) high = value; }
  current[0] = 1;
  // The sums below the target that can hold mass, in each buffer.
  let lo = 0, hi = 0, staleLo = 1, staleHi = 0;
  for (let use = 0; use < n; use++) {
    for (let sum = staleLo; sum <= staleHi; sum++) next[sum] = 0;
    next[target] = current[target];
    for (let sum = lo; sum <= hi; sum++) {
      const mass = current[sum];
      if (!mass) continue;
      for (let index = 0; index < values.length; index++) {
        const reached = sum + values[index];
        if (reached >= target) next[target] += mass * weights[index];
        else next[reached] += mass * weights[index];
      }
    }
    [current, next] = [next, current];
    staleLo = lo; staleHi = hi;
    lo += low; hi = Math.min(target - 1, hi + high);
    if (lo > hi) break;
  }
  const reached = current[target];
  for (let sum = lo; sum <= hi; sum++) current[sum] = 0;
  for (let sum = staleLo; sum <= staleHi; sum++) next[sum] = 0;
  current[target] = 0; next[target] = 0;
  return reached;
}

/**
 * Mass over the target's HP for one state of everything else: dense by HP in `p`, with the `size` HPs
 * reached listed in `hp`. An entry is kept even if its mass underflowed. Distributions are pooled, since a
 * row's search is synchronous: every phase releases the ones it has consumed.
 */
class Dist {
  p = new Float64Array(0);
  seen = new Uint8Array(0);
  hp = new Int32Array(0);
  size = 0;
  reset(max: number) {
    if (this.p.length <= max) { this.p = new Float64Array(max + 1); this.seen = new Uint8Array(max + 1); this.hp = new Int32Array(max + 1); }
    this.size = 0;
  }
  add(hp: number, mass: number) {
    if (!this.seen[hp]) { this.seen[hp] = 1; this.hp[this.size++] = hp; this.p[hp] = mass; } else this.p[hp] += mass;
  }
  release() {
    for (let index = 0; index < this.size; index++) { const at = this.hp[index]; this.seen[at] = 0; this.p[at] = 0; }
    this.size = 0;
    POOL.push(this);
  }
}
const POOL: Dist[] = [];
function borrow(max: number): Dist {
  const dist = POOL.pop() ?? new Dist();
  dist.reset(max);
  return dist;
}
function pointDist(hp: number, max: number): Dist {
  const dist = borrow(max);
  dist.add(hp, 1);
  return dist;
}
function release(groups: Group[]) {
  for (const group of groups) group.dist.release();
}
function massOf(dist: Dist): number {
  let mass = 0;
  for (let index = 0; index < dist.size; index++) mass += dist.p[dist.hp[index]];
  return mass;
}

/** Collects masses into groups by state, adding equal states. */
class Collector {
  private readonly byNode = new Map<number | string, Group>();
  constructor(private readonly size: number) {}
  /** The distribution collecting a node's mass (a doubles turn's step keeps the hits that landed apart: `landed`). */
  to(node: Node, landed?: number): Dist {
    const key = landed === undefined ? node.id : `${node.id}|${landed}`;
    let group = this.byNode.get(key);
    if (!group) this.byNode.set(key, group = { node, dist: borrow(this.size), ...(landed === undefined ? {} : { landed }) });
    return group.dist;
  }
  groups(): Group[] {
    return [...this.byNode.values()];
  }
}

/** What hits() hands emit() for one group of cases: the node and run, and the walk or the draining steps of the attacker. */
type HitGroup = {
  node: Node; code: number; run: Run; mode: Mode; out: Collector; maxHP: number;
  angry: boolean; holds: boolean; berry: Berry | null; walk: HitWalk | null; steps: DrainSteps | null;
  /** A one-hit draining case: the attacker after its hit, by the damage it dealt (the layer key's `dealt`). */
  drained: DrainSteps | null;
};

/**
 * The attacker and target after `landed` hits of a group's layer (`at`, its draining state, and `dealt`, the
 * damage its hits dealt), and with `taken` after one more hit that dealt that: a draining case's own state, a
 * one-hit draining case's from the damage dealt, else the walk's.
 */
function hitEnd(group: HitGroup, at: number, landed: number, dealt: number, taken?: number): HitState {
  if (group.steps) return group.steps.states[taken === undefined ? at : group.steps.to(at, taken)];
  if (group.drained) return group.drained.states[group.drained.to(0, dealt)];
  return hitsAfter(group.walk!, landed);
}

/** Whether a use's hits change nothing (no damage back, no draining, no ability replaced, no Berry taken or eaten): its walk is its first state throughout. */
function quietHits(loop: HitLoopInput): boolean {
  return !hitsCanFaint(loop) && !loop.drain && !loop.takesBerry && !(loop.contact && ABILITY_REPLACERS.has(loop.targetAbility))
    && !HEALING_BERRIES.has(loop.attackerItem) && !PINCH_STAT_BERRIES[loop.attackerItem];
}

/**
 * A case's hits but for draining as the fixed losses they are (hit-loop.ts hitStep: Rough Skin, Iron Barbs, Rocky
 * Helmet, a Jaboca or Rowap Berry), for an attacker without an HP berry: the HP each hit takes and the state the
 * hits leave but that HP, from a walk from an HP no loss reaches. From an HP the losses reach the walk stops
 * where it faints, which leaves the same HP: none.
 */
type FixedHits = { losses: number[]; end: HitState };
function fixedHits(loop: HitLoopInput, hits: number): FixedHits {
  const walk = walkHits({ ...loop, hp: UNTRACKED }, hits);
  const losses: number[] = [];
  for (let hit = 0; hit < hits; hit++) losses.push(walk.before[hit].hp - (hit + 1 < hits ? walk.before[hit + 1].hp : walk.after.hp));
  return { losses, end: walk.after };
}

/** The walk of hits that change nothing (quietHits). */
function quietWalk(loop: HitLoopInput, hits: number): HitWalk {
  const start = startHits(loop);
  return { before: Array.from({ length: hits }, () => start), after: start, faint: null };
}

/**
 * A draining case's attacker through its hits (hits()): pinned Showdown spreadDamage heals by each hit's damage,
 * so each layer of the convolution has its own state (`states`, interned), and `to` is the state one hit that
 * dealt `taken` leaves (a fainted attacker takes and heals nothing more).
 */
class DrainSteps {
  readonly states: HitState[];
  private readonly stepped = new Map<number, number>();
  private readonly interned = new Map<string, number>();
  constructor(private readonly loop: HitLoopInput) { this.states = [startHits(loop)]; }
  to(at: number, taken: number): number {
    const key = at * 4096 + taken;
    let next = this.stepped.get(key);
    if (next !== undefined) return next;
    const from = this.states[at];
    const outcome = from.hp <= 0 ? from : hitStep(this.loop, from, taken).state;
    const id = JSON.stringify(outcome);
    next = this.interned.get(id);
    if (next === undefined) { this.interned.set(id, next = this.states.length); this.states.push(outcome); }
    this.stepped.set(key, next);
    return next;
  }
}

/** The share of a random hit count's mass that deals each hit: the chances of its cases (from `start` to `stop`) with more hits. */
function reachOf(cases: UseCase[], start: number, stop: number): number[] {
  const reach: number[] = [];
  for (let hit = 0; hit < cases[stop - 1].hits.length; hit++) {
    let share = 0;
    for (let at = start; at < stop; at++) if (cases[at].hits.length > hit) share += cases[at].chance;
    reach.push(share);
  }
  return reach;
}

/** The hit (1-based) on which a walk's target eats its Jaboca or Rowap Berry, or 0. */
function retaliationEaten(walk: HitWalk): number {
  for (let hit = 0; hit < walk.before.length; hit++) {
    if (RETALIATION_BERRIES[walk.before[hit].targetItem] && !hitsAfter(walk, hit + 1).targetItem) return hit + 1;
  }
  return 0;
}

/** The attacker and target after the first `landed` hits of a walk (its last state once the attacker fainted). */
function hitsAfter(walk: HitWalk, landed: number): HitState {
  return landed < walk.before.length ? walk.before[landed] : walk.after;
}

/** One row's search: its runs (memoised calculations), interned states with memoised transitions, and budget. */
export class UsesSearch {
  readonly m: UsesMatchup;
  readonly input: UsesRow;
  readonly result: Result;
  readonly sources: string[];
  readonly initial: State;
  readonly size: number;
  private readonly runs = new Map<string, Run>();
  /** Calculations whose engine inputs an engine-only rerun can reuse, by what such a rerun cannot change (anchorKey). */
  private readonly anchors = new Map<string, Anchor>();
  private readonly nodes = new Map<string, Node>();
  /** The states but the HPs met, by their key, as short ids. */
  private readonly restIds = new Map<string, number>();
  /** What the nodes of one state but the attacker's HP share (roll paths and a followed search meet many), by its id and mode. */
  private readonly shared: Shared[] = [];
  private readonly first: Run;
  /** The first node of the exact search and of the roll paths. */
  private readonly starts: (Node | undefined)[] = [];
  private readonly hpModes: { att: HPModes; def: HPModes };
  private readonly relevance: { att: CombatStat[]; def: CombatStat[] };
  /** The damage reads the attacker's HP (Endeavor's too), so the exact search follows it from the start. */
  private readonly trackAttacker: boolean;
  /** The attacker's HP is part of the exact search's states (the damage reads it, or it could faint before the target is out), not only of the roll paths. */
  private follow: boolean;
  /** The damage reads the target's HP (or every HP gets its own calculation, in the self-check). */
  private readonly readsHP: boolean;
  /** An Air Balloon changes no damage: its holder is airborne only for a Ground move and for the terrain, and there is neither. */
  private readonly balloonNeutral: boolean;
  private readonly sturdy: boolean;
  /**
   * A later hit of a use can deal other damage than the first (calculate.ts reruns it): Blaze and its kin at a
   * third of the attacker's HP, Defeatist at half, or a pinch berry's stage for the attacking stat, as the
   * target's damage back lowers that HP between hits.
   */
  private readonly midMoves: boolean;
  /** The attacking stat a pinch berry raises for midMoves (calculate.ts: Body Press's Defense). */
  private readonly offense: CombatStat;
  private download?: CombatStat | null;
  private initialResiduals?: { att: Residuals; def: Residuals };
  /** The matchup's entry for the first state (residualsAt). */
  private sharedFirst?: { residuals: { att: Residuals; def: Residuals }; texts?: string[] };
  private reruns = 0;
  private states = 0;
  /** The exact search ran out of budget, or a reachable state could not be calculated. */
  private exceeded = false;
  /** Why a roll path stopped. */
  private stop: string | null = null;
  /** The field states a use or an end of turn made, by their JSON (the field as set is ""). */
  private readonly fieldIds = new Map<string, string>();
  /** Cheek Pouch's heal for a Berry the last afterHit's use ate outside the hits' HP berries (Kee or Maranga, a status Berry). */
  private hitHeal = 0;
  /** A full-HP Focus Sash or Sturdy kept the target in on a first use it would otherwise have ended. */
  private survivalSaved = false;
  /** On a roll path, the attacker fainted on the use that knocked the target out. */
  private koFaint = false;
  /** An end of turn knocked the target out on some sequence of the count or path being walked. */
  private turnKO = false;
  /**
   * While firstUse walks one use: the target's HP where the hits leave it (emit adds there instead of to the
   * next states), and the HP each source made it regain: on the walk over every sequence the least and the most,
   * on a roll path (`sum`, its one sequence) the total.
   */
  private oneUse: { dist: Dist; heals: Map<string, [number, number]>; sum: boolean } | null = null;
  /** A build holds first-turn-only state (firstTurnOnly), so the first use's calculations are not shared with later ones. */
  private readonly firstTurn: boolean;
  /** One use within a doubles turn (UsesEnv.turn, createTurnSearch): no end of turn, stages kept, every outcome a node. */
  private readonly turnMode: boolean;
  /** While a turn's step runs (turnStep): the knocked-out outcomes, the HP the target regains by source, and the first calculation that failed. */
  private knockedOut: Collector | null = null;
  private turnHeals: Map<string, [number, number]> | null = null;
  /** A doubles turn's step: the least and the most HP the followed attacker regained from each source (its HP Berry, Shell Bell). */
  private turnAttackerHeals: Map<string, [number, number]> | null = null;
  /** A doubles turn's step that follows the attacker: the least and the most HP the target's Berry it ate with Bug Bite or Pluck healed, by the Berry. */
  private turnAttackerAte: Map<string, [number, number]> | null = null;
  private turnRows: Map<MoveDamageResult, number> | null = null;
  private turnFailure: string | null = null;
  constructor(m: UsesMatchup, input: UsesRow, result: Result) {
    this.m = m;
    this.input = input;
    this.result = result;
    this.turnMode = m.turn;
    this.firstTurn = firstTurnOnly(m.attacker) || firstTurnOnly(m.defender);
    const { attacker, defender } = m;
    this.hpModes = hpSensitivity(m, input.move, result);
    this.relevance = relevantStats(input.move, attacker, result, m.conditions);
    const side = (build: BattleBuild, pokemon: Pokemon, who: "att" | "def"): Side => {
      const entry = this.entryStages(build, who);
      return {
        hp: pokemon.curHP(), maxHP: pokemon.maxHP(), baseMaxHP: pokemon.maxHP(true),
        itemId: entry.seed ? "" : build.itemId, boosts: stagesOf(build.boosts, entry.stages),
        abilityId: build.abilityId, speciesId: build.speciesId, status: build.status, mechanic: build.mechanic,
        dynamaxTurns: build.mechanic === "dynamax" || build.mechanic === "gigantamax" ? 3 : null,
        toxic: 0, slowStart: null, saltCure: false, smackedDown: false,
        unburden: (who === "att" ? m.attAbility : m.defAbility) === "unburden" && build.abilityActive,
        focusEnergy: !!build.settledFocusEnergy,
      };
    };
    this.initial = {
      att: side(attacker, result.attacker, "att"), def: side(defender, result.defender, "def"), conditions: m.conditions, fieldKey: "",
      first: true, attackerFainted: false, consecutive: 0, streak: 0, charged: false, weatherTurns: null, terrainTurns: null,
    };
    if (m.attAbility === "slowstart" && attacker.abilityActive) this.initial.att.slowStart = 5;
    this.size = this.initial.def.maxHP;
    const att = this.hpModes.att;
    this.trackAttacker = att.exact || att.full || att.half || att.third || HP_FORM_ABILITIES.has(attacker.abilityId) || input.move.id === "endeavor";
    this.follow = this.trackAttacker;
    const def = this.hpModes.def;
    this.readsHP = USES_REFERENCE.on || def.exact || def.full || def.half || def.third;
    this.balloonNeutral = !m.conditions.terrain && result.move.type !== "Ground";
    this.sources = this.turnMode ? [] : changeSources(m, input, result, this.hpModes, this.relevance, this.residualsAt(this.initial).att.ops.length > 0, this.initial,
      this.gorgingParalyses(this.initial));
    this.sturdy = result.defender.hasAbility("Sturdy");
    this.first = this.prepare({ row: input.row, trace: input.trace }, this.initial);
    this.offense = result.move.category === "Special" ? "spa" : input.move.id === "bodypress" ? "def" : "atk";
    // A Max Move hits once, and the row's own move after Dynamax as often as it does.
    this.midMoves = (this.first.cases.some((useCase) => useCase.hits.length > 1) || (this.ownAfterMax()?.hits ?? 0) > 1)
      && (PINCH_TYPES[m.attAbility] === result.move.type || m.attAbility === "defeatist" || PINCH_STAT_BERRIES[m.attackerItem] === this.offense
        || (m.attAbility === "guts" && this.gorgingParalyses(this.initial)));
    // The first calculation's engine inputs still hold a used Seed, which an engine-only rerun drops.
    const held = { ...this.initial, att: { ...this.initial.att, itemId: attacker.itemId }, def: { ...this.initial.def, itemId: defender.itemId } };
    if (input.trace.engine) this.anchors.set(this.anchorKey(this.initial), { state: held, engine: input.trace.engine, row: input.row });
  }

  /**
   * The stages the engine adds on every calculation for entry effects it models (gen789.js / champions.js
   * checkSeedBoost, checkDauntlessShield, checkEmbody, checkIntrepidSword, checkWindRider; Champions runs only
   * the Seeds), which pinned Showdown applied once: a terrain Seed used on entry (`seed`: gone from then on;
   * Contrary and Simple apply, as boost() does), Dauntless Shield and Intrepid Sword (Sword/Shield, or while
   * active), Embody Aspect (Scarlet/Violet), Wind Rider in its side's Tailwind. The state holds them in its
   * stages, and later calculations switch the engine's own off (engineRun, settledEntry in calculateMove).
   */
  private entryStages(build: BattleBuild, who: "att" | "def"): { stages: Partial<Stages>; seed: boolean } {
    const { m } = this;
    // The doubles turn's builds already hold them (calculate.ts settleDoublesStart folds them in).
    if (m.turn) return { stages: {}, seed: false };
    return entryStagesOf(build, who === "att" ? m.attAbility : m.defAbility, who === "att" ? m.attItemOn : m.defItemOn,
      m.conditions.terrain, (who === "att" ? m.conditions.attackerSide : m.conditions.defenderSide).tailwind, m.runtime);
  }

  /**
   * The count for the row: an exact search, or the roll paths past the budget, mapped onto UsesToKO. With
   * `cap`, the row's move can be used that many times at most, and past them nothing is estimated.
   */
  usesToKO(cap: UsesCap | null = null): UsesToKO {
    const { m, input, result } = this;
    const { move } = input;
    const counts = this.hitCountTexts();
    const notes = [...m.notes, ...counts.notes, ...this.assumptions()];
    const carried: string[] = [...counts.carried];
    // Limits: the move's PP (5 for a move Transform copied, pinned Showdown transformInto; halved by the
    // target's Pressure) and a Leppa Berry's refill once it runs out; a lock-in takes PP only at its start
    // (pinned Showdown runMove); then the attacker's HP for Steel Beam and its kin.
    const pp = move.pp === undefined ? null : m.attacker.transformedFrom ? Math.min(5, move.pp) : maxUsesPP(move, m.runtime.profile.id);
    const pressure = pp !== null && m.defAbility === "pressure";
    const leppa = pp !== null && m.attackerItem === "leppaberry" && !UNNERVES.has(m.defAbility) ? Math.min(m.attAbility === "ripen" ? 20 : 10, pp) : 0;
    const turns = (points: number) => pressure ? Math.ceil(points / 2) : points;
    const perPP = result.move.isMax ? 1 : LOCK_IN_MOVES.has(move.id) ? 2 : move.id === "uproar" ? 3 : 1;
    // Bug Bite and Pluck eat the target's Berry (stolenEat): a Leppa Berry gives back PP the uses took (leppaUses).
    const stolen = this.firstStolen();
    const regained = pp === null ? 0 : this.leppaUses(pressure);
    let limit = pp === null ? USES_CAP : (turns(pp) + turns(leppa)) * perPP + regained;
    let limitReason: "pp" | "pressure" | "self-cost" | "cap" = pp === null || perPP > 1 ? "cap" : pressure ? "pressure" : "pp";
    if (leppa) carried.push(`The attacker's Leppa Berry restores ${leppa} PP.`);
    if (perPP > 1) notes.push(`${move.name}: ${perPP} uses per PP.`);
    if (cap && cap.uses < limit) { limit = cap.uses; limitReason = "cap"; }
    const losesHP = this.attackerLosesHP();
    if (stolen) {
      const texts = this.stolenTexts(stolen, losesHP || this.trackAttacker, regained);
      carried.push(...texts.carried);
      notes.push(...texts.notes);
    } else if (regained) carried.push(`After Dynamax ends, ${move.name} eats the target's ${this.itemName("leppaberry")}: the PP of ${regained} uses comes back.`);
    // The attacker's own berry acts where its HP is followed: the roll paths, and the exact search once a bound
    // without the heal fails; from the start when eating it changes the damage (Acrobatics, a pinch berry's
    // stage). The closed form leaves it out.
    const own = losesHP ? this.attackerBerry(this.initial) : null;
    const stage = PINCH_STAT_BERRIES[this.initial.att.itemId];
    if (own && (move.id === "acrobatics" || (stage && this.relevance.att.includes(stage)))) this.follow = true;
    const plain = own ? null : this.closedTerms();
    const walk = (mode: "lowest" | "highest") => plain ? this.closedPath(plain, mode, limit) : this.path(mode, limit);
    // Damage that reads the target's exact HP (Crush Grip, Wring Out, Hard Press) needs a calculation for
    // every HP reached: past two uses that is beyond the budget, so the roll paths count it.
    const exact = this.hpModes.def.exact && !USES_REFERENCE.on;
    let lowest = losesHP || exact ? walk("lowest") : null;
    let highest = losesHP ? walk("highest") : null;
    if (SELF_COST_MOVES.has(move.id) && m.attAbility !== "magicguard" && lowest?.faints !== undefined && lowest.faints < limit) {
      limit = lowest.faints; limitReason = "self-cost";
    }
    // The closed form, unless the attacker could faint before the target is out in a way it cannot count:
    // then the exact search follows the attacker's HP.
    const closed = plain ? this.closedForm(plain, limit, losesHP) : null;
    if (plain && !closed) {
      this.follow = true;
      // The roll paths as the search walks them: a contact hit's damage can stop a use's hits.
      lowest = this.path("lowest", limit);
      highest = this.path("highest", limit);
    }
    const counted: Count = closed ?? this.beyondReach(limit, lowest, highest)
      ?? (exact && (lowest!.uses ?? Infinity) > 2 ? { guaranteed: null, fewest: null, ko: [], chance: 0, fell: null, fallback: true } : this.exactCount(limit, losesHP, lowest));
    let guaranteed: number | null, fewest: number | null, fasterChance: number | undefined, chance: number | undefined, fell: number | null, endOfTurn: boolean;
    if (counted.fallback) {
      const low = lowest ??= this.path("lowest", limit), high = highest ??= this.path("highest", limit);
      const stop = low.stop ?? high.stop;
      if (stop) return { kind: "not-estimated", reason: stop };
      // A path on which the attacker faints with the target still in does not knock it out.
      const fellOn = (walked: Walked) => walked.fallsFirst !== undefined && walked.fallsFirst <= limit ? walked.fallsFirst : Infinity;
      const ko = (walked: Walked) => fellOn(walked) === Infinity && walked.uses !== null && walked.uses <= limit ? walked.uses : null;
      const first = Math.min(fellOn(low), fellOn(high));
      fell = first === Infinity ? null : first;
      guaranteed = fell === null ? ko(low) : null;
      fewest = ko(high) ?? ko(low);
      endOfTurn = [low, high].some((walked) => walked.endOfTurn && ko(walked) !== null);
      notes.push("Too many roll sequences: lowest and highest rolls only, no chance.");
    } else {
      guaranteed = counted.guaranteed;
      fewest = counted.fewest;
      fell = counted.fell;
      endOfTurn = !!counted.endOfTurn;
      // Neither is ever certain: guaranteed is the first use after which no sequence is left.
      if (guaranteed !== null && guaranteed >= 2 && fewest !== null && fewest < guaranteed) fasterChance = uncertain(counted.ko[guaranteed - 2] ?? 0, true);
      if (guaranteed === null && fewest !== null) chance = uncertain(counted.chance, true);
    }
    if (cap && limit === cap.uses && guaranteed === null) return { kind: "not-estimated", reason: cap.reason };
    // Steel Beam's family faints the attacker on its last use by design: that is the limit, not a faint first.
    const faintsFirst = guaranteed === null && fell !== null && !(limitReason === "self-cost" && fell >= limit);
    let needed: number | undefined;
    if (guaranteed === null) {
      // The lowest roll path already walked gives it when it knocks out within the uses it walked.
      // On from where the lowest roll path walked to the limit stopped, when it did.
      const walked = closed ? closed.needed : lowest && lowest.uses !== null ? lowest.uses : this.path("lowest", PATH_CAP, true, lowest?.resume).uses;
      if (walked !== null && walked > limit) needed = walked;
    }
    // Explosion's family once Dynamax ends faints the user on the use that knocks out.
    const lastFaints = cap?.faints && limit === cap.uses ? cap.uses : undefined;
    const lowFaint = lowest?.faints ?? (guaranteed === lastFaints ? lastFaints : undefined), highFaint = highest?.faints ?? (fewest === lastFaints ? lastFaints : undefined);
    const faints = {
      ...(lowFaint !== undefined && lowFaint <= (guaranteed ?? limit) ? { lowest: lowFaint } : {}),
      ...(highFaint !== undefined && highFaint <= (fewest ?? limit) ? { highest: highFaint } : {}),
    };
    // A Lansat Berry eaten on the first use gives focusenergy (+2 critical-hit ratio): where that makes every hit critical
    // (calculate.ts certainCrit), the later uses' calculations are.
    if (stolen?.eat.focusEnergy && !this.initial.att.focusEnergy && !this.first.trace.result!.move.isCrit
      && [...this.runs.values()].some((run) => run.trace.result?.move.isCrit)) {
      carried.push(`${input.row.effectiveName ?? move.name} eats the target's ${this.itemName(stolen.item)} on the first use: every later hit is critical.`);
    }
    const turnsText = this.turnsText();
    const timed = this.timedNote();
    // Focus Sash or Sturdy stopped a KO only when no sequence is out within the first use (its end of turn can finish the 1 HP left).
    const survival = this.survivalSaved && (fewest === null || fewest >= 2) && (input.row.survival === "Focus Sash" || input.row.survival === "Sturdy") ? input.row.survival : undefined;
    return {
      kind: "uses", guaranteed, fewest, ...(fasterChance !== undefined ? { fasterChance } : {}),
      ...(chance !== undefined ? { chance } : {}), ...(faintsFirst ? { faintsFirst: true as const } : {}), ...(endOfTurn ? { endOfTurn: true as const } : {}),
      limit, limitReason, ...(needed !== undefined ? { needed } : {}),
      // In the closed form the first use changes nothing an end of turn reads, so its sentences are the first state's.
      carried: [...this.sources, ...carried, ...this.berryTexts(losesHP), ...(closed ? this.sharedFirst!.texts ??= texts(this.residualsAt(this.initial)) : this.residualTexts())],
      notes: [...(timed ? [timed] : []), ...notes],
      ...(survival ? { survival } : {}),
      ...(Object.keys(faints).length ? { attackerFaints: faints } : {}), ...(turnsText ? { turns: turnsText } : {}),
    };
  }

  /**
   * The target's Berry Bug Bite or Pluck takes on the first use and what the attacker gets eating it (stolen), or null: no
   * Berry, or one the target's Sticky Hold keeps (it lets go only as its holder faints, which ends the count).
   */
  private firstStolen(): { item: string; eat: StolenEat } | null {
    const { initial, m } = this;
    if (this.ability(initial, "def") === "stickyhold" && !moldBreaks(m, initial)) return null;
    return this.stolen(initial);
  }

  /**
   * The first use's eaten Berry (firstStolen) as what the count carries, where it follows it: the HP it gives the attacker
   * (`hp`: the count follows that HP) at the first use's HP, the stages the damage reads (and the target's Opportunist
   * copying one), the status it cures, the PP a Leppa Berry gives back (`leppa`); and, as a note, the confusion a
   * Figy-family Berry gives an attacker whose Nature lowers its stat (not through Own Tempo or Misty Terrain under a
   * grounded attacker: data/conditions.ts confusion, data/moves.ts mistyterrain onTryAddVolatile), as for its own.
   */
  private stolenTexts(stolen: { item: string; eat: StolenEat }, hp: boolean, leppa: number): { carried: string[]; notes: string[] } {
    const { initial, m, input } = this;
    const { eat } = stolen;
    const eats = `${input.row.effectiveName ?? input.move.name} eats the target's ${this.itemName(stolen.item)} on the first use`;
    const carried: string[] = [], notes: string[] = [];
    if (hp) {
      const loop = this.loopInput(initial, this.first, this.first.cases[0]);
      const took = hitStep(loop, startHits(loop), 0).state.stolen;
      const gained = (took?.heal ?? 0) + (took?.pouch ?? 0);
      if (gained > 0) carried.push(`${eats}: the attacker regains ${gained} HP${took!.pouch ? " (Cheek Pouch included)" : ""}.`);
    }
    const ability = this.ability(initial, "att");
    const copier = this.ability(initial, "def") === "opportunist";
    // The rise boost() makes from the first use's stage: Contrary, Simple, the ±6 cap.
    const changes = (Object.entries(eat.stages) as [CombatStat, number][]).filter(([stat]) => this.relevance.att.includes(stat) || (copier && this.relevance.def.includes(stat)))
      .map(([stat, amount]) => [stat, clamp(initial.att.boosts[stat] + amount * (ability === "contrary" ? -1 : 1) * (ability === "simple" ? 2 : 1)) - initial.att.boosts[stat]] as const)
      .filter(([, by]) => by !== 0).map(([stat, by]) => `${by > 0 ? "+" : ""}${by} ${STAT_LABELS[stat]}`);
    if (changes.length) carried.push(`${eats}: ${listNames(changes)}${copier ? ", which the target's Opportunist copies" : ""}.`);
    const status = initial.att.status;
    if (status && eat.cures.includes(status)) carried.push(`${eats}: it cures the attacker's ${STATUS_NAMES[status]}.`);
    if (leppa) carried.push(`${eats}: the PP that use took comes back.`);
    const nature = m.attacker.nature;
    const dislikes = !!eat.confuses && NATURE_MINUS[nature] === eat.confuses;
    if (dislikes && ability !== "owntempo" && !(initial.conditions.terrain === "Misty" && this.grounded(initial, "att"))) notes.push(CONFUSED_NOTE);
    return { carried, notes };
  }

  /**
   * The uses a target's Leppa Berry gives back when Bug Bite or Pluck makes the attacker eat it (data/items.ts leppaberry
   * onEat: up to 10 PP, 20 with Ripen, to the first move with none left, else the first one short of its maximum, which is
   * this one): the PP its uses took by then, on the first use, or on the first of the row's own move once a Dynamaxed
   * attacker's Max Moves end (dynamaxCap: 3, 2 with Truant). None through Sticky Hold, or with the attacker's items ignored.
   */
  private leppaUses(pressure: boolean): number {
    const { initial, m, result } = this;
    const moveId = this.input.move.id;
    if ((moveId !== "bugbite" && moveId !== "pluck") || result.move.isZ || initial.def.itemId !== "leppaberry") return 0;
    if (this.ability(initial, "def") === "stickyhold" && !moldBreaks(m, initial)) return 0;
    const eat = stolenEat("leppaberry", { baseMaxHP: initial.att.baseMaxHP, ability: this.ability(initial, "att"), ignoresItem: this.ignoresOwnItems(initial) }, m.runtime.profile.generation);
    if (!eat.leppa) return 0;
    const at = result.move.isMax ? (m.attAbility === "truant" ? 2 : 3) + 1 : 1;
    const perUse = pressure ? 2 : 1;
    return Math.floor(Math.min(eat.leppa, at * perUse) / perUse);
  }

  /** An item's name. */
  private itemName(item: string): string {
    return this.m.runtime.itemsById.get(item)?.name ?? item;
  }

  /**
   * Whether a doubles turn's step follows the attacker's HP: the damage reads it, or the use can change it (draining and
   * Shell Bell heal it, and so can the target's Berry Bug Bite or Pluck makes it eat, with Cheek Pouch's heal).
   */
  needsAttackerHP(): boolean {
    if (this.trackAttacker) return true;
    const engineMove = this.result.move as Move & { drain?: unknown };
    if (engineMove.drain || (this.m.attItemOn && this.m.attacker.itemId === "shellbell")) return true;
    const stolen = this.stolen(this.initial);
    if (stolen && (stolen.eat.heal > 0 || stolen.eat.pouch > 0)) return true;
    return this.attackerLosesHP();
  }

  /** A fixed-HP row with the damage it deals at one HP (turnStep's rows met), one per damage. */
  private readonly fixedRows = new Map<MoveDamageResult, Map<number, MoveDamageResult>>();
  private fixedRow(row: MoveDamageResult, damage: number): MoveDamageResult {
    let byDamage = this.fixedRows.get(row);
    if (!byDamage) this.fixedRows.set(row, byDamage = new Map());
    let known = byDamage.get(damage);
    if (!known) byDamage.set(damage, known = { ...row, min: damage, max: damage, rolls: damage });
    return known;
  }

  /** Whether the damage reads the attacker's HP (Eruption, Blaze at a third, Gale Wings at full...): a spread move's steps then take it per class. */
  readsAttackerHP(): boolean {
    return this.trackAttacker;
  }

  /** The part of the attacker's HP range the damage reads (hpKey), for a spread move's steps. */
  attackerHPClass(hp: number): string {
    return hpKey(this.hpModes.att, hp, this.initial.att.maxHP);
  }

  /** createTurnSearch: whether the turn's steps follow the attacker's HP (fixed for the search, as its nodes are keyed by it). */
  followAttacker(follow: boolean) {
    this.follow = follow;
  }

  /**
   * One use of the row's move within a doubles turn (doubles-turn.ts), its hits as hits() walks them in `mode` from
   * the first state with each entry's attacker HP (followed when `follow`) and its distribution over the target's HP.
   * Every outcome is a node: the state the use leaves, the hits that landed, the target's HP distribution, and the
   * knocked-out mass apart at 0 HP with the attacker's state after the hit that knocked out. No end of turn. A state
   * that cannot be calculated or a budget passed gives the reason instead.
   */
  turnStep(entries: TurnStepEntry[], mode: Mode, follow: boolean): TurnStepResult {
    if (follow !== this.follow) throw new Error("A turn search follows the attacker's HP or not for all its steps.");
    this.states = 0; this.exceeded = false; this.stop = null; this.turnFailure = null;
    release([this.start(mode)]);
    const groups: Group[] = [];
    for (const entry of entries) {
      const state = follow && entry.attackerHP !== this.initial.att.hp ? { ...this.initial, att: { ...this.initial.att, hp: entry.attackerHP } } : this.initial;
      const node = this.node(state, mode);
      const dist = borrow(this.size);
      for (const [hp, mass] of entry.target) dist.add(hp, mass);
      groups.push({ node, dist });
    }
    const knocked = new Collector(this.size);
    const heals = new Map<string, [number, number]>();
    const attackerHeals = new Map<string, [number, number]>(), attackerAte = new Map<string, [number, number]>();
    const rows = new Map<MoveDamageResult, number>();
    this.knockedOut = knocked; this.turnHeals = heals; this.turnRows = rows; this.turnAttackerHeals = follow ? attackerHeals : null; this.turnAttackerAte = follow ? attackerAte : null;
    let out: Group[];
    try {
      out = this.hits(groups, mode, () => {});
    } finally {
      this.knockedOut = null; this.turnHeals = null; this.turnRows = null; this.turnAttackerHeals = null; this.turnAttackerAte = null;
    }
    const outcomes: TurnStepOutcome[] = [];
    for (const [list, ko] of [[out, false], [knocked.groups(), true]] as const) {
      for (const group of list) {
        const dist = new Map<number, number>();
        for (let index = 0; index < group.dist.size; index++) { const hp = group.dist.hp[index]; dist.set(hp, group.dist.p[hp]); }
        group.dist.release();
        const state = group.node.state;
        outcomes.push({ attacker: state.att, attackerFainted: state.attackerFainted, target: state.def, knocked: ko, conditions: state.conditions, landed: group.landed ?? 0, dist });
      }
    }
    if (this.exceeded || this.stop) return { failed: this.turnFailure ?? this.stop ?? TURN_TOO_MANY };
    return { outcomes, heals, attackerHeals, attackerAte, rows };
  }

  /**
   * The HP the target's DamagingHit handlers take from the attacker in one hit of the row's first case, from the first
   * state (hit-loop.ts hitStep at an HP no loss reaches): Rough Skin, Iron Barbs, Rocky Helmet, a Jaboca or Rowap Berry,
   * Gulp Missile. A doubles turn's spread move adds each target's (doubles-turn.ts spreadStep).
   */
  retaliation(): number {
    const loop = this.loopInput(this.initial, this.first, this.first.cases[0], UNTRACKED);
    return UNTRACKED - walkHits(loop, 1).after.hp;
  }

  /**
   * The target's HP after one use (types.ts AfterUse), from its HP when the move starts: the use's hits as hits()
   * walks them (every roll of every hit, each count of a random hit count with its chance, no hit once the target
   * faints, Focus Sash and Sturdy at full HP on the first hit, the HP berries it eats at each hit's Update, Cheek
   * Pouch), with the attacker's HP followed so that its faint stops the hits (pinned Showdown hitStepMoveHitLoop)
   * and the target keeps the HP they left; no charge turn and no end of turn. The walk over every sequence gives
   * the average, the extremes and the KO chance, the roll paths' cases (every hit at its lowest roll with the
   * fewest hits, at its highest with the most) low and high. Null when a state could not be calculated or the
   * budget ran out, or when a Berry can act during the use in a way the hits do not follow (berryBetweenHits).
   */
  firstUse(): AfterUse | null {
    if (this.berryBetweenHits()) return null;
    const { states, exceeded, stop } = this;
    const walks: OneUseWalk[] = [];
    let low: number, high: number;
    let average = 0, min = 0, max = 0;
    try {
      const all = this.walkOneUse("all");
      if (!all) return null;
      walks.push(all);
      const { dist } = all;
      min = all.seen || !dist.size ? 0 : Infinity;
      for (let index = 0; index < dist.size; index++) {
        const hp = dist.hp[index];
        average += hp * dist.p[hp];
        if (hp < min) min = hp;
        if (hp > max) max = hp;
      }
      // One case of one hit with no HP regained leaves less HP for a higher roll (Focus Sash, Sturdy and False
      // Swipe's 1 HP included): its lowest roll leaves the most, its highest the least. Otherwise the roll paths.
      const cases = this.first.cases;
      if (cases.length === 1 && cases[0].hits.length === 1 && !all.heals.size) [low, high] = [max, min];
      else {
        const paths: number[] = [];
        for (const mode of ["lowest", "highest"] as const) {
          const walked = this.walkOneUse(mode);
          if (!walked) return null;
          walks.push(walked);
          // A roll path's one sequence: the HP it leaves, or 0 once the target is out.
          paths.push(walked.dist.size ? walked.dist.hp[0] : 0);
        }
        [low, high] = paths;
      }
    } finally {
      this.oneUse = null;
      this.states = states; this.exceeded = exceeded; this.stop = stop;
    }
    const [all, lowest, highest] = walks;
    const facts = (heals: Map<string, [number, number]>) => [...heals].map(([source, [least, most]]) => `${source}: +${least === most ? least : `${least}–${most}`} HP.`);
    const heals = facts(all.heals);
    const start = this.initial.def.hp;
    // A roll path's damage dealt: the HP it took off, the HP it regained added back.
    const path = (left: number, walked: OneUseWalk | undefined) => {
      const regained = walked ? [...walked.heals.values()].reduce((sum, [amount]) => sum + amount, 0) : 0;
      return { dealt: start - left + regained, heals: walked ? facts(walked.heals) : [] };
    };
    // Certain only when no sequence leaves the target in (the float sum of the mass knocked out can round to 1 without it).
    const koChance = all.dist.size ? uncertain(all.out, all.seen) : 1;
    const outcome: AfterUse = { start, low, high, average, min, max, koChance, heals, paths: { low: path(low, lowest), high: path(high, highest) } };
    for (const walked of walks) walked.dist.release();
    return outcome;
  }

  /**
   * One use's hits from the first state in `mode` (firstUse), into one distribution: the HP left, the mass knocked
   * out and whether any was, and the HP regained by source (on a roll path, its one sequence's).
   */
  private walkOneUse(mode: Mode): OneUseWalk | null {
    const dist = borrow(this.size);
    const heals = new Map<string, [number, number]>();
    this.oneUse = { dist, heals, sum: mode !== "all" };
    this.states = 0; this.exceeded = false; this.stop = null;
    let out = 0, seen = false;
    release(this.hits([this.start(mode)], mode, (mass) => { out += mass; seen = true; }));
    this.oneUse = null;
    if (this.exceeded || this.stop) return null;
    return { dist, out, seen, heals };
  }

  /**
   * Whether a target Berry acts during the first use in a way its hits do not follow. A use's hits keep the
   * rolls it started with, but pinned Showdown eats a stat Berry at a hit's Update (data/items.ts onUpdate,
   * battle-actions.ts hitStepMoveHitLoop eachEvent('Update')) and the next hit reads the stage it gave; and the
   * hits eat no Starf or Lansat Berry, whose eating Cheek Pouch heals on (data/abilities.ts cheekpouch onEatItem).
   * True when the target can eat one (its item works, the attacker's Unnerve or As One does not stop it, unless
   * a contact replacer can replace that) and the highest rolls reach its line: a stat Berry whose stat this row's
   * damage reads (Ganlon on a physical hit, Apicot on a special one, any for a Starf Berry's random stat) before
   * the last hit, a Starf or Lansat Berry with Cheek Pouch after any hit.
   */
  private berryBetweenHits(): boolean {
    const { initial, m } = this;
    const item = initial.def.itemId;
    if (!item || !m.defItemOn) return false;
    const stat = PINCH_STAT_BERRIES[item], random = item === "starfberry";
    const reads = random ? STATS.some((each) => this.relevance.def.includes(each) && initial.def.boosts[each] < 6) : !!stat && this.relevance.def.includes(stat);
    const pouch = (random || item === "lansatberry") && this.ability(initial, "def") === "cheekpouch";
    if (!reads && !pouch) return false;
    if (this.targetUnnerved(initial, true)) return false;
    // The line berryArithmetic gives every pinch Berry: a quarter, half with Gluttony.
    const line = this.berryFor(initial, "def", item).line;
    // No hit lands after the one the attacker faints on (MoveDamageResult.attackerFaintsOnHit, set only when that hit is certain).
    const last = this.input.row.attackerFaintsOnHit?.hit ?? Infinity;
    for (const { hits } of this.first.cases) {
      const landed = Math.min(hits.length, last);
      const upTo = pouch ? landed : landed - 1;
      let dealt = 0;
      for (let hit = 0; hit < upTo; hit++) dealt += hits[hit].max;
      if (upTo > 0 && initial.def.hp - dealt <= line) return true;
    }
    return false;
  }

  /** Cheek Pouch's heal after the first use's hits for a Berry eaten outside them (afterHit's hitHeal: Kee, Maranga, a status Berry), its state dropped. */
  private oneUseHeal(node: Node, run: Run, useCase: UseCase, mask: number, dealt: number, mode: Mode, landed: number, end: HitState): number {
    if (!this.m.defItemOn || this.ability(node.state, "def") !== "cheekpouch") return 0;
    const { stop, exceeded } = this;
    this.afterHit(node.state, run, useCase, mask, dealt, mode, landed, end);
    // A field change only matters to a later use.
    this.stop = stop; this.exceeded = exceeded;
    return this.hitHeal;
  }

  /** On a walk of the first use: `amount` HP the target regained from `source`. */
  private noteHeal(source: string, amount: number) {
    // A doubles turn's step notes the least and the most of each source (turnStep).
    const use = this.oneUse ?? (this.turnHeals ? { heals: this.turnHeals, sum: false } : null);
    if (!use || amount <= 0) return;
    const known = use.heals.get(source);
    if (!known) use.heals.set(source, [amount, amount]);
    else if (use.sum) { known[0] += amount; known[1] += amount; }
    else { if (amount < known[0]) known[0] = amount; if (amount > known[1]) known[1] = amount; }
  }

  /** noteHeal for the target's HP berry `item` eaten at `hp`: eatBerry's two parts, the berry's heal, then Cheek Pouch's. */
  private noteBerry(item: string, berry: Berry, hp: number) {
    if (!this.oneUse && !this.turnHeals) return;
    const healed = berry.heal ? Math.min(berry.max, hp + berry.heal) : hp;
    this.noteHeal(this.m.runtime.itemsById.get(item)?.name ?? item, healed - hp);
    if (berry.pouch) this.noteHeal("Cheek Pouch", Math.min(berry.max, healed + berry.pouch) - healed);
  }

  /**
   * The count when no sequence can knock the target out within the limit, from the two roll paths alone: on a
   * row whose sequences all meet the same states but for the HP (monotone()), the highest roll path has the
   * lowest target HP after every use, so when it is still in, every sequence is; and when the attacker's HP
   * hangs on no roll (no recoil, draining or Shell Bell), a path out only after its attacker fainted shows
   * every sequence's attacker faints first. The attacker then faints with the target in on its first faint,
   * which is soonest on the highest roll path with recoil and on the lowest with draining or Shell Bell (the
   * other sees it as soon or later). Null: the exact count is needed.
   */
  private beyondReach(limit: number, lowest: Walked | null, highest: Walked | null): Count | null {
    if (!lowest || !highest || lowest.stop || highest.stop || !this.unreached(highest, limit)) return null;
    // An HP berry only heals: without it (it changes no damage) the highest roll path is still the lowest HP.
    if (!this.monotone(true) || (!this.monotone() && this.reachedBare(limit))) return null;
    const first = Math.min(...[lowest.fallsFirst, highest.fallsFirst].filter((use): use is number => use !== undefined && use <= limit));
    return { guaranteed: null, fewest: null, ko: [], chance: 0, fell: first === Infinity ? null : first, fallback: false, endOfTurn: false };
  }

  /**
   * Whether every roll sequence meets the same states but for the two HPs, and each use and end of turn moves
   * an HP the same way for more damage: no HP berry (its line), Focus Sash or Sturdy at full HP, Anger Shell, HP
   * form or damage that reads an HP; no second case (Fickle Beam, a Shell Side Arm tie: their contact can
   * differ), no contact damage between hits (it can stop later hits), no recoil with Shell Bell. Heals capped
   * at the maximum, a fixed damage, Dynamax ending and the end of turn keep HP in order.
   */
  private monotone(berry = false): boolean {
    const { initial, m, first } = this;
    if (this.readsHP || this.trackAttacker || m.hpForms || this.attackerBerry(initial)) return false;
    // `berry`: but for the target's HP berry where its loss changes no damage nor its holder's Speed, nor gives the attacker a berry.
    const held = this.berryOf(initial, true);
    if (held && !(berry && HEALING_BERRIES.has(held) && !ITEM_MOVES.has(this.input.move.id) && this.ability(initial, "att") !== "magician"
      && !(this.relevance.att.includes("spe") && this.ability(initial, "def") === "unburden"))) return false;
    if (initial.def.hp >= initial.def.maxHP && (this.sturdy || (m.defItemOn && initial.def.itemId === "focussash"))) return false;
    if (this.ability(initial, "def") === "angershell" || first.cases.length > 1 || ["ficklebeam", "shellsidearm"].includes(this.input.move.id)) return false;
    if (first.cases[0].hits.length > 1 && first.cases[0].contact) return false;
    const afterMax = this.ownAfterMax();
    if (afterMax && afterMax.hits > 1 && afterMax.contact) return false;
    // Gulp Missile hits back once and changes the target's form.
    if (this.gulping(initial)) return false;
    const own = m.gen.moves.get(id(this.input.move.name)) as { recoil?: unknown } | undefined;
    return !((own?.recoil || (this.result.move as Move & { recoil?: unknown }).recoil) && m.attacker.itemId === "shellbell");
  }

  /** Whether the highest roll path, from the first state without the target's HP berry, can show a knockout within `limit` uses (or stops). */
  private reachedBare(limit: number): boolean {
    const bare = { ...this.initial, def: { ...this.initial.def, itemId: "" } };
    const { stop, exceeded } = this;
    const walked = this.path("highest", limit, false, undefined, bare);
    this.stop = stop; this.exceeded = exceeded;
    return !!walked.stop || !this.unreached(walked, limit);
  }

  /**
   * Whether the highest roll path shows no sequence knocks the target out within `limit` uses: it is still in
   * after them, or out only after its attacker fainted when that HP hangs on no roll, so every sequence's
   * attacker faints on that use.
   */
  private unreached(walked: Walked, limit: number): boolean {
    if (walked.uses === null || walked.uses > limit) return true;
    if (walked.fallsFirst === undefined) return false;
    const own = this.m.gen.moves.get(id(this.input.move.name)) as { recoil?: unknown; drain?: unknown } | undefined;
    const engineMove = this.result.move as Move & { recoil?: unknown; drain?: unknown };
    return !own?.recoil && !own?.drain && !engineMove.recoil && !engineMove.drain && this.m.attacker.itemId !== "shellbell" && this.m.defender.itemId !== "shellbell";
  }

  /** "Assumes the weather and the terrain last through every use.", without a field effect the row's own move ends. */
  private timedNote(): string | null {
    const { move } = this.input;
    const maxEffect = MAX_MOVE_EFFECTS[this.result.move.name];
    const own = !this.result.move.isMax;
    const breaks = (own && ["brickbreak", "psychicfangs", "ragingbull"].includes(move.id)) || !!maxEffect?.clearsScreens;
    const ends = (own && ["icespinner", "steelroller"].includes(move.id)) || !!maxEffect?.clearsTerrain;
    const timed = this.m.timed.filter((entry) => !(entry === "the screens" && breaks) && !(entry === "the terrain" && ends));
    if (!timed.length) return null;
    return `Assumes ${listNames(timed)} ${timed.length === 1 && timed[0] !== "the screens" ? "lasts" : "last"} through every use.`;
  }

  /** What the count assumes or leaves out for this row. */
  private assumptions(): string[] {
    const { move, row } = this.input;
    const { conditions } = this.m;
    const notes: string[] = [];
    if (row.alternate) notes.push(`Each use has its own ${Math.round(row.alternate.chance * 100)}% chance of ${row.alternate.label}.`);
    // The Gorging form's Gulp Missile paralyses the attacker in the first use.
    if (this.gorgingParalyses(this.initial)) notes.push("Assumes the paralysed attacker is never fully paralysed.");
    if (SUCCESS_MOVES.has(move.id)) notes.push(`Assumes ${move.name} succeeds on every use.`);
    if (LOCK_IN_MOVES.has(move.id)) notes.push(`Leaves out the confusion after ${move.name}'s lock-in.`);
    if (this.charges(this.initial, true) && this.m.attackerItem === "powerherb") notes.push("Power Herb skips the first charge turn.");
    // Doubles: the spread reduction, a dart for each foe and Friend Guard hold while the target's partner
    // stays in, and a partner's Pressure would take a PP more (pinned Showdown useMoveInner pressureTargets).
    if (conditions.gameType === "Doubles" && conditions.multipleTargets) {
      const spread = !this.result.move.isMax && !this.result.move.isZ && ["allAdjacentFoes", "allAdjacent"].includes(move.target);
      if (spread || move.id === "dragondarts" || conditions.defenderSide.friendGuard) notes.push("Assumes the target's partner stays in for every use.");
      if (spread && move.pp !== undefined) notes.push("Assumes the target's partner has no Pressure.");
    }
    return notes;
  }

  /**
   * The row's hit count over the uses as sentences: what the count follows (`carried`) and a count it assumes
   * for every use (`notes`, a fixed or chosen count). Each use rolls its own random count (pinned Showdown
   * hitStepMoveHitLoop) with the chances the attacker has then, so a first use that takes its Loaded Dice
   * (Pickpocket) or replaces its Skill Link (Mummy, Lingering Aroma, Wandering Spirit) changes the count of the
   * uses after it. A Z-Move or Max Move made from a multi-hit move hits once; a Dynamaxed attacker's own move
   * hits again once Dynamax ends.
   */
  private hitCountTexts(): { carried: string[]; notes: string[] } {
    const { move, row, context } = this.input;
    const { cases } = this.first, maxed = !!this.result.move.isMax;
    const range = (counts: HitChance[]) => `${counts[0].hits}–${counts[counts.length - 1].hits}`;
    if (maxed) {
      const later = this.randomCounts(this.initial, false);
      return { carried: later ? [`After Dynamax ends, each use has its own hit count (${range(later)}).`] : [], notes: [] };
    }
    // The count the engine dealt (a row cut short where the attacker faints shows fewer).
    const first: HitChance[] | number = cases[0].random ? cases.map((useCase) => ({ hits: useCase.hits.length, chance: useCase.chance })) : cases[0].hits.length;
    if (this.result.move.isZ || row.hits === null || (typeof first === "number" && (first < 2 || (!Array.isArray(move.multihit) && context?.hits === undefined)))) {
      return { carried: [], notes: [] };
    }
    // The uses after the first, from the state it leaves.
    const { stop, exceeded } = this;
    const later = this.useHits(this.afterHit(this.initial, this.first, cases[0], DAMAGED, 0, "all"));
    this.stop = stop; this.exceeded = exceeded;
    const same = typeof first === "number" ? first === later
      : typeof later !== "number" && later.length === first.length && later.every((entry, index) => entry.hits === first[index].hits && Math.abs(entry.chance - first[index].chance) < 1e-12);
    if (same) return typeof first === "number" ? { carried: [], notes: [`Assumes ${first} hits on every use.`] } : { carried: [`Each use has its own hit count (${range(first)}).`], notes: [] };
    const hitsText = (hits: number) => `${hits} hit${hits === 1 ? "" : "s"}`;
    const text = typeof first === "number"
      ? `The first use has ${hitsText(first)}, then each use has ${typeof later === "number" ? hitsText(later) : `its own hit count (${range(later)})`}.`
      : `The first use has its own hit count (${range(first)}), then each use has ${typeof later === "number" ? hitsText(later) : `its own (${range(later)})`}.`;
    return { carried: [text], notes: [] };
  }

  /** The hits of a use from `state`: each count with its chance for a random count (randomCounts), else the count. */
  private useHits(state: State): HitChance[] | number {
    const random = this.randomCounts(state, false);
    if (random) return random;
    const { move, context } = this.input;
    if (context?.hits !== undefined) return context.hits;
    const rule = hitCountRule(move, { abilityId: state.att.abilityId, itemId: state.att.itemId, speciesId: state.att.speciesId, transformedFrom: this.m.attacker.transformedFrom },
      this.m.runtime, { magicRoom: state.conditions.magicRoom, opponentAbilityId: state.def.abilityId });
    return rule.kind === "fixed" ? rule.hits : rule.defaultHits ?? rule.max;
  }

  /**
   * Each count of a use's random hit count with its chance (hit-count.ts hitCountRule for the attacker as the
   * state has it: an item taken or an ability replaced changes it), when no count is chosen; null otherwise or
   * for a Z-Move or Max Move (`engine`: the calculation's), which hits once. Each use rolls its own count
   * (pinned Showdown hitStepMoveHitLoop).
   */
  private randomCounts(state: State, engine: Result["move"] | false): HitChance[] | null {
    const { multihit } = this.input.move;
    if ((engine && (engine.isMax || engine.isZ)) || this.input.context?.hits !== undefined || (!Array.isArray(multihit) && multihit !== 10)) return null;
    const { m } = this;
    const rule = hitCountRule(this.input.move, { abilityId: state.att.abilityId, itemId: state.att.itemId, speciesId: state.att.speciesId, transformedFrom: m.attacker.transformedFrom },
      m.runtime, { magicRoom: state.conditions.magicRoom, opponentAbilityId: state.def.abilityId });
    return rule.kind === "choose" && rule.defaultHits === null && rule.chances && rule.chances.length > 1 ? rule.chances : null;
  }

  /** Turns that are not uses, from the first use's state. */
  private turnsText(): string | undefined {
    if (this.charges(this.initial, true)) return "Charges for a turn before each use";
    if (!this.afterTurns(this.initial)) return undefined;
    const id = this.input.move.id, own = !maxActive(this.initial.att);
    return own && RECHARGE_MOVES.has(id) ? "Recharges after each use" : own && NOT_TWICE_MOVES.has(id) ? "Can't be used twice in a row" : "Truant: one use every other turn";
  }

  /** Whether the attacker can lose HP over the uses (so the roll paths say when it faints, and the count checks it stands). */
  private attackerLosesHP(): boolean {
    const { m, input, result } = this;
    // A Max Move's row makes contact with its own move once Dynamax ends.
    const contact = this.first.cases.some((useCase) => useCase.contact) || !!this.ownAfterMax()?.contact;
    // Mummy, Lingering Aroma and Wandering Spirit replace Magic Guard on contact.
    const guarded = m.attAbility === "magicguard" && !(contact && ["mummy", "lingeringaroma", "wanderingspirit"].includes(m.defAbility));
    if (SELF_COST_MOVES.has(input.move.id)) return !guarded;
    if (guarded) return false;
    if ((result.move as Move & { recoil?: unknown }).recoil || m.attackerItem === "lifeorb") return true;
    // A Max Move's row uses its own move once Dynamax ends, with that move's recoil.
    if (result.move.isMax && (m.gen.moves.get(toID(input.move.name)) as { recoil?: unknown } | undefined)?.recoil) return true;
    if (contact && (m.defenderItem === "rockyhelmet" || ["roughskin", "ironbarbs"].includes(m.defAbility))) return true;
    // Wandering Spirit hands the target the attacker's own Rough Skin or Iron Barbs; a Jaboca or Rowap Berry hits back
    // once (not past the attacker's Unnerve); Liquid Ooze turns draining into damage (hit-loop.ts hitStep).
    if (contact && m.defAbility === "wanderingspirit" && ["roughskin", "ironbarbs"].includes(m.attAbility)) return true;
    const answered = this.first.cases.some((useCase) => RETALIATION_BERRIES[m.defenderItem] === (useCase.physical ? "Physical" : "Special"));
    if (answered && !berryUnnerved(m.unnerve, "target", m.attAbility)) return true;
    // The Gulping or Gorging form's Gulp Missile hits back on the first damaging hit (hit-loop.ts hitStep).
    if (this.gulping(this.initial)) return true;
    const drains = (engineMove: unknown) => !!(engineMove as { drain?: unknown } | undefined)?.drain;
    if (m.defAbility === "liquidooze" && (drains(result.move) || (result.move.isMax && drains(m.gen.moves.get(toID(input.move.name)))))) return true;
    if (result.defender.hasAbility("Spicy Spray") || m.defAbility === "synchronize" || m.defenderItem === "stickybarb") return true;
    // An item taken from the target that hurts its new holder: by an attacker that holds nothing, or whose item goes (a Gem's next use takes).
    const itemless = !m.attacker.itemId || CONSUMED.has(m.attacker.itemId) || m.attacker.itemId.endsWith("gem");
    const takes = (input.move.id === "covet" || input.move.id === "thief" || m.attAbility === "magician") && itemless;
    if (takes && ["lifeorb", "blacksludge", "stickybarb", "flameorb", "toxicorb"].includes(m.defender.itemId)) return true;
    // The target's Pickpocket takes the attacker's Rocky Helmet on a contact hit (once its own item is gone), which then hurts each contact hit.
    if (contact && m.defAbility === "pickpocket" && m.attacker.itemId === "rockyhelmet" && m.defItemOn && m.attAbility !== "stickyhold") return true;
    if (m.attackerItem === "flameorb" || m.attackerItem === "toxicorb" || this.residualsAt(this.initial).att.ops.some((op) => op < 0)) return true;
    // Weather a use sets (the target's Sand Spit, a Max Move's) that damages the attacker.
    const sets = this.weatherSet();
    return !!sets && this.residuals({ ...this.initial, conditions: { ...this.initial.conditions, weather: sets } }, "att").ops.some((op) => op < 0);
  }

  /** The weather a use sets: the target's Sand Spit on a hit, or the Max Move's (pinned Showdown: not over a strong weather). */
  private weatherSet(): BattleConditions["weather"] | null {
    const sets = (this.m.defAbility === "sandspit" ? "Sand" : MAX_MOVE_EFFECTS[this.result.move.name]?.weather) as BattleConditions["weather"] | undefined;
    return sets && !STRONG_WEATHERS.includes(this.m.conditions.weather) && sets !== this.m.conditions.weather ? sets : null;
  }

  /** Whether the attacker can end a turn at half HP or less (its Power Construct then acts). */
  attackerCanHalve(): boolean {
    return this.initial.att.hp * 2 <= this.initial.att.maxHP || this.attackerLosesHP();
  }

  /**
   * Whether the target can lose HP at the end of a turn over the uses: a residual it has, or one a use or an
   * end of turn gives it (the move's status or Salt Cure, its own Flame Orb or Toxic Orb, weather a use
   * sets). Without it False Swipe, Hold Back and Endeavor never knock out.
   */
  endOfTurnDamage(): boolean {
    const { initial, m } = this;
    if (this.residualsAt(initial).def.ops.some((op) => op < 0)) return true;
    const status = this.statusAfterUse(initial, this.first);
    if (status && ["brn", "psn", "tox"].includes(status) && this.canStatus(initial, "def", status, true)) return true;
    if (this.saltCures(initial, this.first)) return true;
    const orb = m.defItemOn && !initial.def.status ? initial.def.itemId === "flameorb" ? "brn" : initial.def.itemId === "toxicorb" ? "tox" : null : null;
    if (orb && this.canStatus(initial, "def", orb, false)) return true;
    const sets = this.weatherSet();
    return !!sets && this.residuals({ ...initial, conditions: { ...initial.conditions, weather: sets } }, "def").ops.some((op) => op < 0);
  }

  /**
   * Perish Body (pinned Showdown onDamagingHit): a contact hit gives both Perish Song, and both faint at the
   * end of the fourth turn. Three uses are counted; past them nothing is estimated.
   */
  perishCap(): UsesCap | null {
    const contact = this.first.cases.some((useCase) => useCase.contact) || !!this.ownAfterMax()?.contact;
    return this.m.defAbility === "perishbody" && contact ? { uses: 3, reason: "Perish Body: both faint after 4 turns" } : null;
  }

  /**
   * The HP berries the count includes, as sentences: the target's (a stat berry the damage reads is a
   * source), and the attacker's when it can lose HP.
   */
  private berryTexts(losesHP: boolean): string[] {
    const texts: string[] = [];
    const name = (item: string) => this.m.runtime.itemsById.get(item)?.name ?? item;
    const when = (item: string, ability: string) => item === "enigmaberry" ? "after a super-effective hit"
      : PINCH_HEAL_BERRIES.has(item) || PINCH_STAT_BERRIES[item] ? `at ${ability === "gluttony" ? "half" : "a quarter of"} its HP or less` : "at half its HP or less";
    // With the attacker's Unnerve, the target's Mummy and its kin may replace it on a contact hit.
    const item = this.berryOf(this.initial, this.first.cases.some((useCase) => useCase.contact));
    if (item && !PINCH_STAT_BERRIES[item] && !this.takenInHit(this.initial, item)) texts.push(`The target's ${name(item)} heals it once, ${when(item, this.m.defAbility)}.`);
    const own = losesHP && this.attackerBerry(this.initial) ? this.initial.att.itemId : null;
    if (own) texts.push(`The attacker's ${name(own)} ${PINCH_STAT_BERRIES[own] ? `raises its ${STAT_LABELS[PINCH_STAT_BERRIES[own]]}` : "heals it"} once, ${when(own, this.m.attAbility)}.`);
    return texts;
  }

  /** The end-of-turn effects the count includes, as sentences, from the state the first use leaves (an item it took, a terrain it ended, a status it gave). */
  private residualTexts(): string[] {
    const { stop, exceeded } = this;
    const after = this.afterHit(this.initial, this.first, this.first.cases[0], DAMAGED, 0, "all");
    this.stop = stop; this.exceeded = exceeded;
    return texts(this.residualsAt(after));
  }

  /** The first state's residuals, shared by every row of the matchup whose first state reads the same. */
  private residualsAt(state: State): { att: Residuals; def: Residuals } {
    if (state !== this.initial) return { att: this.residuals(state, "att"), def: this.residuals(state, "def") };
    if (this.initialResiduals) return this.initialResiduals;
    // The rest it reads comes from the builds and the field, the same for every row.
    const key = `${state.att.baseMaxHP},${state.att.itemId}|${state.def.baseMaxHP},${state.def.itemId}`;
    let shared = this.m.shared.get(key);
    if (!shared) this.m.shared.set(key, shared = { residuals: { att: this.residuals(state, "att"), def: this.residuals(state, "def") } });
    this.sharedFirst = shared;
    return this.initialResiduals = shared.residuals;
  }

  /**
   * Whether the closed form applies: nothing changes the damage, no berry, Focus Sash or Sturdy acts, each
   * use is one turn, and the target's end of turn only heals it (by less than any use deals, so no cap binds
   * and its HP only falls) or only damages it by a fixed amount. Null when it does not; else the heal or
   * damage per turn and the lowest and highest damage of a use.
   */
  private closedTerms(): Terms | null {
    const { initial } = this;
    if (USES_REFERENCE.on || this.sources.length) return null;
    if (initial.def.hp >= initial.def.maxHP && (this.sturdy || this.result.defender.hasItem("Focus Sash"))) return null;
    // Bug Bite and Pluck take a Sticky Hold holder's Berry on the use that knocks it out (data/abilities.ts stickyhold
    // onTakeItem `!pokemon.hp`), and the attacker eats it before that turn ends: its heal or cure changes whether the
    // attacker faints then, which the roll paths follow (koEnd, koTurnEnd) and the closed form does not.
    const stolen = this.ability(initial, "def") === "stickyhold" ? this.stolen(initial) : null;
    if (stolen && (stolen.eat.heal || stolen.eat.pouch || (initial.att.status && stolen.eat.cures.includes(initial.att.status)))) return null;
    return this.terms(initial, this.first, this.residualsAt(initial).def.ops);
  }

  /**
   * The closed-form terms for a state whose uses all deal `run`'s damage: none when the damage follows the
   * HP (Super Fang, Endeavor, False Swipe's 1 HP), when a berry, a status or Salt Cure from the move, a
   * charge turn (Power Herb's skip is used up), a turn that is not a use, a status Hydration cures, or an
   * item that changes the end of turn can still act, or when the end of turn mixes healing and damage,
   * escalates (bad poison) or heals at least the lowest damage of a use. Sash and Sturdy are the caller's.
   */
  private terms(state: State, run: Run, ops: number[]): Terms | null {
    if (run.trace.fixedHP || run.row.leavesOneHP || this.berryOf(state, true) || this.statusAfterUse(state, run) || this.saltCures(state, run) || this.charges(state, true) || this.afterTurns(state)) return null;
    if (this.hydrated(state, "att") || this.hydrated(state, "def")) return null;
    // Items that change the target's end of turn after a use: Sticky Barb moving on contact, an Air Balloon popping
    // (only Grassy Terrain's heal reads it there), an Orb's status.
    const item = this.m.defItemOn ? state.def.itemId : "";
    if (item === "stickybarb" || item === "flameorb" || item === "toxicorb" || (item === "airballoon" && !this.neutral(item))) return null;
    // Cheek Pouch heals as any Berry is eaten (Kee, Maranga, a status or resist Berry too).
    if (item.endsWith("berry") && this.ability(state, "def") === "cheekpouch") return null;
    const changes = ops.filter((op) => op !== UPDATE);
    if (state.def.status === "tox" && state.def.toxic < 15 && changes.some((op) => op < 0)) return null;
    const heal = changes.every((op) => op > 0) ? changes.reduce((sum, op) => sum + op, 0) : 0;
    const chip = changes.every((op) => op < 0) ? -changes.reduce((sum, op) => sum + op, 0) : 0;
    const lowest = Math.min(...run.cases.map((useCase) => useCase.min)), highest = Math.max(...run.cases.map((useCase) => useCase.max));
    if (changes.length && !heal && !chip) return null;
    if (heal && lowest < heal) return null;
    return { heal, chip, lowest, highest };
  }

  /**
   * A roll path in the closed form, as arithmetic: the same damage every use, the target's fixed end of
   * turn, and the attacker's HP after each use and its own end of turn (to say when it faints).
   */
  private closedPath(terms: Terms, mode: "lowest" | "highest", cap: number): Walked {
    const { initial } = this;
    const useCase = this.casesFor(this.first, mode)[0];
    const damage = mode === "lowest" ? terms.lowest : terms.highest;
    const from = { ...initial, att: { ...initial.att }, def: { ...initial.def } };
    let left = initial.def.hp, faints: number | undefined, fallsFirst: number | undefined;
    const fall = (use: number) => { faints ??= use; if (left > 0) fallsFirst ??= use; };
    let loop = this.loopInput(from, this.first, useCase), quiet = quietHits(loop), fixed = quiet || loop.drain ? null : fixedHits(loop, useCase.hits.length);
    for (let use = 1; use <= cap && damage > 0; use++) {
      // The hits from the attacker's HP, each its lowest or highest roll (hit-loop.ts): none lands once either is out.
      loop.hp = from.att.hp;
      let hit = startHits(loop), dealt = 0;
      if (quiet) { dealt = Math.min(damage, left); left -= damage; }
      else if (fixed) {
        let hp = from.att.hp;
        for (let at = 0; at < useCase.hits.length && left > 0 && hp > 0; at++) {
          const roll = mode === "lowest" ? useCase.hits[at].min : useCase.hits[at].max;
          dealt += Math.min(roll, left); left -= roll;
          hp = Math.max(0, hp - fixed.losses[at]);
        }
        hit = { ...fixed.end, hp };
      } else {
        for (const rolls of useCase.hits) {
          if (left <= 0 || hit.hp <= 0) break;
          const roll = mode === "lowest" ? rolls.min : rolls.max;
          const taken = Math.min(roll, left);
          left -= roll; dealt += taken;
          hit = hitStep(loop, hit, taken).state;
        }
      }
      let hp = this.attackerHPAfter(from, this.result, dealt, hit);
      // A Jaboca or Rowap Berry is eaten once, and Gulp Missile acts once (the closed form has no other change
      // the hits make: changeSources).
      if ((loop.targetItem && !hit.targetItem) || (loop.targetGulping && !hit.gulping)) {
        if (loop.targetItem && !hit.targetItem) from.def.itemId = "";
        if (loop.targetGulping && !hit.gulping) from.def.speciesId = "cramorant";
        loop = this.loopInput(from, this.first, useCase); quiet = quietHits(loop); fixed = quiet || loop.drain ? null : fixedHits(loop, useCase.hits.length);
      }
      if (hp <= 0) { fall(use); hp = 1; }
      // The turn ends for the attacker even when the target is out (the target's own end of turn first).
      if (left > 0) left = terms.heal ? Math.min(initial.def.maxHP, left + terms.heal) : left - terms.chip;
      hp = this.closedTurn(hp, use);
      if (hp <= 0) { fall(use); hp = 1; }
      from.att.hp = hp;
      if (left <= 0) return { uses: use, faints, fallsFirst };
    }
    return { uses: null, faints, fallsFirst };
  }

  /** The attacker's HP after its own end of turn `turn` in the closed form (its bad poison grows each turn); at most 0 once it faints. */
  private closedTurn(hp: number, turn: number): number {
    return this.closedFall(hp, turn).hp;
  }

  /** closedTurn, with the residual order at which the attacker faints (Infinity if it stands). */
  private closedFall(hp: number, turn: number): { hp: number; order: number } {
    const { initial } = this;
    const state = initial.att.status === "tox" ? { ...initial, att: { ...initial.att, toxic: Math.min(15, initial.att.toxic + turn - 1) } } : initial;
    const max = initial.att.maxHP;
    const { ops, orders } = this.residualsAt(state).att;
    for (let step = 0; step < ops.length; step++) {
      const op = ops[step];
      if (op === UPDATE) continue;
      hp = op > 0 ? (hp < max ? Math.min(max, hp + op) : hp) : hp + op;
      if (hp <= 0) return { hp, order: orders[step] };
    }
    return { hp, order: Infinity };
  }

  /**
   * Where the attacker faints over `uses` uses of the closed form, or null if it stands: the use, and
   * whether before the use's last hit lands ("early": the hit's contact damage), after its hits ("hit":
   * recoil, Life Orb, Steel Beam's family, the last hit's contact damage) or at its own end of turn ("turn").
   * `worst` bounds every roll sequence: the highest damage's recoil and the lowest's draining and Shell Bell
   * (a use that does not knock out deals its whole roll). Without it, nothing the attacker loses or gains
   * may hang on the rolls (steadyAttacker).
   */
  private attackerFalls(uses: number, terms: Terms, worst: boolean): { use: number; phase: "early" | "hit" | "turn"; order: number } | null {
    const { initial, result } = this;
    const cases = this.first.cases;
    const state = { ...initial, att: { ...initial.att } };
    // Each case's hits as fixed losses where nothing in them drains (hit-loop.ts).
    const plans = cases.map((useCase) => {
      const loop = this.loopInput(state, this.first, useCase);
      return { useCase, fixed: loop.drain ? null : fixedHits(loop, useCase.hits.length) };
    });
    for (let use = 1; use <= uses; use++) {
      // The lowest HP any case leaves (the most hits, a Jaboca or Rowap Berry on every use): pinned Showdown
      // hitStepMoveHitLoop lands no more hits once the user has fainted, which the closed form cannot count.
      let hp = Infinity;
      for (const { useCase, fixed } of plans) {
        let end: HitState;
        if (fixed) {
          let left = state.att.hp, faint = 0;
          for (let at = 0; at < useCase.hits.length && left > 0; at++) if ((left = Math.max(0, left - fixed.losses[at])) === 0) faint = at + 1;
          if (faint && faint < useCase.hits.length) return { use, phase: "early", order: 0 };
          end = { ...fixed.end, hp: left };
        } else {
          const walk = this.boundWalk(state, this.first, useCase, state.att.hp);
          if (walk.faint && walk.faint.hit < useCase.hits.length) return { use, phase: "early", order: 0 };
          end = walk.after;
        }
        hp = Math.min(hp, this.attackerHPAfter(state, result, terms.highest, end, worst ? terms.lowest : terms.highest));
      }
      if (hp <= 0) return { use, phase: "hit", order: 0 };
      const fall = this.closedFall(hp, use);
      if (fall.hp <= 0) return { use, phase: "turn", order: fall.order };
      state.att.hp = fall.hp;
    }
    return null;
  }

  /**
   * In the closed form, the attacker loses and gains the same HP on every roll sequence: no recoil, draining or
   * Shell Bell, every case alike for contact, hits and category, and hits that change nothing but its HP (no
   * Jaboca or Rowap Berry eaten, no ability replaced), so every use from one HP takes the same.
   */
  private steadyAttacker(): boolean {
    const engineMove = this.result.move as Move & { recoil?: unknown; drain?: unknown };
    const ability = this.m.attAbility;
    if (engineMove.recoil && ability !== "rockhead" && ability !== "magicguard") return false;
    if (engineMove.drain || this.m.attackerItem === "shellbell") return false;
    const cases = this.first.cases;
    if (!cases.every((entry) => entry.contact === cases[0].contact && entry.hits.length === cases[0].hits.length && entry.physical === cases[0].physical)) return false;
    const loop = this.loopInput(this.initial, this.first, cases[0], UNTRACKED);
    const end = walkHits(loop, cases[0].hits.length).after;
    return end.attackerAbility === loop.attackerAbility && end.targetAbility === loop.targetAbility && end.targetItem === loop.targetItem
      && end.gulping === loop.targetGulping;
  }

  /**
   * The closed form's counts: with S_n the sum of n independent uses, h the heal and c the damage per turn,
   * the target is out within n uses exactly when S_n reaches HP + (n - 1)h or HP - nc. `needed` is the
   * lowest-roll count however far it goes. An attacker that loses HP must stand until the target is out:
   * when it falls the same way on every sequence the uses stop on the use it faints (by that use's hits
   * alone, HP - (n - 1)c, when it faints before its end of turn), and otherwise a bound over every sequence
   * must show it stands. Null: neither holds, so the exact search follows its HP.
   */
  private closedForm(terms: Terms, limit: number, losesHP: boolean): Count & { needed: number | null } | null {
    const { initial, first } = this;
    const { heal, chip, lowest, highest } = terms;
    const hp = initial.def.hp;
    const uses = (damage: number) => usesFrom(hp, damage, terms);
    const needed = uses(lowest);
    // The last use counted, and the damage the target's end of turn still deals after it: none when the
    // attacker faints in that use, and only the residuals before its own when it faints at its end of turn.
    let last = limit, lastChip = chip, fell: number | null = null;
    if (losesHP) {
      // Every sequence is out by `span` uses, or the limit stops it: the attacker must stand until then.
      const span = needed !== null && needed < limit ? needed : limit;
      const steady = this.steadyAttacker();
      const fall = this.attackerFalls(span, terms, !steady);
      const residuals = this.residualsAt(initial).def;
      const before = !fall ? chip : fall.phase !== "turn" ? 0 : residuals.ops.reduce((sum, op, step) => op < 0 && residuals.orders[step] <= fall.order ? sum - op : sum, 0);
      if (!steady) {
        // A bound: the worst sequence's attacker may fall only after the target is out on every sequence
        // (a fall on the last use counted, with the target still in, is a faint first too).
        if (fall && (fall.use < span || fall.phase === "early" || before < chip || needed === null || needed > limit)) return null;
      } else if (fall?.phase === "early") return null;
      else if (fall) { last = fell = fall.use; lastChip = before; }
    }
    // The HP the sum of n uses must reach for the target to be out within them.
    const reach = (n: number) => heal ? hp + (n - 1) * heal : hp - (n - 1) * chip - (n === last ? lastChip : chip);
    const within = (damage: number) => {
      const count = uses(damage);
      return count !== null && (count < last || (count === last && damage * count >= reach(count))) ? count : null;
    };
    const guaranteed = within(lowest), fewest = within(highest);
    const faster = guaranteed !== null ? guaranteed - 1 : 0;
    const ko: number[] = [];
    let chance = guaranteed !== null ? 1 : 0;
    const { values, weights } = perUseDamage(first.cases);
    if (faster >= 1 && fewest !== null && fewest <= faster) ko[faster - 1] = sumReaches(values, weights, reach(faster), faster);
    else if (guaranteed === null && fewest !== null) chance = sumReaches(values, weights, reach(last), last);
    const endOfTurn = fewest !== null && turnKnocks([hp], values, chip, guaranteed ?? last, last, lastChip);
    return { guaranteed, fewest, ko, chance, fell: guaranteed === null ? fell : null, needed, fallback: false, endOfTurn };
  }

  /**
   * The exact count, following the attacker's HP when it could faint before the target is out: a first
   * count without it stands when a bound over the states it reached shows the attacker cannot faint within
   * the uses that count needs; otherwise the count runs again with the attacker's HP in every state. The
   * lowest roll path, when walked, can show first that the bound fails: no sequence needs fewer uses than
   * it, and the states it reached are some of the count's.
   */
  exactCount(limit: number, losesHP = this.attackerLosesHP(), lowest?: Walked | null): Count {
    if (losesHP && !this.follow && USES_REFERENCE.on) this.follow = true;
    if (losesHP && !this.follow && lowest && !lowest.stop) {
      const beyond = lowest.uses === null || lowest.uses > limit;
      if (!this.attackerStands(beyond ? limit : lowest.uses!, beyond)) this.follow = true;
    }
    if (!losesHP || this.follow) return this.count(limit);
    const counted = this.count(limit);
    if (counted.fallback || this.attackerStands(counted.guaranteed ?? limit, counted.guaranteed === null)) return counted;
    // The states with the attacker's HP are new ones; the calculations carry over.
    this.follow = true;
    this.starts[0] = undefined;
    this.states = 0;
    return this.count(limit);
  }

  /**
   * Whether no sequence of the exact search can faint the attacker before the target is out within `uses`
   * uses. Over every state the search reached, its largest loss in a use (the largest damage's recoil, Life
   * Orb, contact damage, Steel Beam's family) and in each of its turns, and its smallest healing from the
   * damage dealt (draining, Shell Bell, from the smallest damage: a use that does not knock out deals its
   * whole roll), give a lower bound on its HP: it must stay above 0 through the first uses - 1 uses and the
   * last one up to its last hit (the whole last use and its end of turn when the target's own end of turn
   * could finish it, or when `whole`: some sequence is still in after the last use counted).
   */
  private attackerStands(uses: number, whole: boolean): boolean {
    const { initial, m } = this;
    // Dynamax ending scales a Dynamaxed attacker's HP back down, which the bound does not follow.
    if (initial.att.maxHP !== initial.att.baseMaxHP) return false;
    // Every calculation met (a Dynamaxed attacker's Max Move and its own move after Dynamax ends).
    const runs = [this.first, ...this.runs.values()];
    let dealt = 0, least = Infinity, hits = 1;
    for (const run of runs) {
      for (const useCase of run.cases) { dealt = Math.max(dealt, useCase.max); least = Math.min(least, useCase.min); hits = Math.max(hits, useCase.hits.length); }
    }
    const fixed = runs.some((run) => run.trace.fixedHP);
    dealt = fixed ? initial.def.maxHP : Math.min(dealt, initial.def.maxHP);
    let full = 0, early = 0, turn = 0, before = 0, chipped = false, bell = true, ooze = false;
    const lost = (ops: number[]) => ops.reduce((sum, op) => op < 0 ? sum - op : sum, 0);
    // The calculations that lose the attacker HP differently after the hits (recoil, Sheer Force on Life Orb, Steel Beam as a Max Move).
    const losing = new Map<string, Result>();
    for (const run of runs) {
      const result = run.trace.result!, engineMove = result.move as Move & { recoil?: [number, number] };
      losing.set(`${engineMove.recoil}|${!!engineMove.secondaries && result.attacker.hasAbility("Sheer Force")}|${!!engineMove.isMax}`, result);
    }
    const walked = new Map<string, { full: number; early: number }>();
    for (const node of this.nodes.values()) {
      const state = node.state;
      // The most a use's hits take (hit-loop.ts, every calculation's every case) and before its last hit lands.
      const taken = this.hitLosses(state, runs, walked);
      for (const result of losing.values()) full = Math.max(full, taken.full + this.afterHitsLoss(state, result, dealt));
      early = Math.max(early, taken.early);
      if (this.ability(state, "def") === "liquidooze") ooze = true;
      // Its own end of turn, with bad poison at its worst; a charge turn or a recharge is a second one.
      const residuals = this.residualsOf(node);
      const own = state.att.status === "tox" ? lost(this.residuals({ ...state, att: { ...state.att, toxic: 15 } }, "att").ops) : lost(residuals.att.ops);
      const charges = this.charges(state);
      turn = Math.max(turn, own * (1 + (charges ? 1 : 0) + (this.afterTurns(state) ? 1 : 0)));
      if (charges) before = Math.max(before, own);
      if (!chipped && residuals.def.ops.some((op) => op < 0)) chipped = true;
      if (!(m.attItemOn && state.att.itemId === "shellbell")) bell = false;
    }
    // Draining heals before a single hit's losses (the least any calculation drains; with more hits a later hit's
    // heal comes after the hit that can faint it, and into Liquid Ooze it is a loss, in hitLosses); Shell Bell
    // after them, if the attacker still stands.
    const drains = runs.map((run) => (run.trace.result!.move as Move & { drain?: [number, number] }).drain);
    const drain = drains.every(Boolean) && hits === 1 && !ooze ? drains.reduce((a, b) => a![0] / a![1] <= b![0] / b![1] ? a : b) : undefined;
    const known = !fixed && least !== Infinity;
    const drained = known && drain ? Math.round(least * drain[0] / drain[1]) : 0, rung = known && bell ? Math.max(1, Math.floor(least / 8)) : 0;
    const max = initial.att.maxHP;
    let hp = initial.att.hp - before;
    for (let use = 1; use <= uses && hp > 0; use++) {
      if (use === uses && !chipped && !whole) return hp - early > 0;
      hp = Math.min(max, hp + drained) - full;
      if (hp > 0) hp = Math.min(max, hp + rung) - turn;
    }
    return hp > 0;
  }

  /**
   * The most one use's hits take from the attacker in `state` over every calculation's cases, and before the
   * use's last hit lands (hit-loop.ts): from an HP no loss reaches (so no draining heal and no berry), each hit
   * dealing its highest roll (Liquid Ooze's most). Memoised in `walked` by what the hits read.
   */
  private hitLosses(state: State, runs: Run[], walked: Map<string, { full: number; early: number }>): { full: number; early: number } {
    let full = 0, early = 0;
    const { att, def } = state;
    const side = `${att.maxHP},${att.baseMaxHP}|${att.abilityId}|${att.itemId}|${def.abilityId}|${def.itemId}|${state.conditions.magicRoom}|${def.mechanic}|${def.speciesId}`;
    for (let index = 0; index < runs.length; index++) {
      const run = runs[index];
      for (let at = 0; at < run.cases.length; at++) {
        const useCase = run.cases[at];
        const key = `${index}|${at}|${side}`;
        let entry = walked.get(key);
        if (!entry) {
          const loop = this.loopInput(state, run, useCase, UNTRACKED);
          const walk = walkHits(loop, useCase.hits.length, (hit) => useCase.hits[hit - 1].max);
          walked.set(key, entry = { full: UNTRACKED - walk.after.hp, early: UNTRACKED - walk.before[walk.before.length - 1].hp });
        }
        if (entry.full > full) full = entry.full;
        if (entry.early > early) early = entry.early;
      }
    }
    return { full, early };
  }

  /**
   * A case's hits from `state` (hit-loop.ts walkHits), memoised on its node: from the attacker's HP where the
   * state follows it, else from an HP no loss reaches (for what the hits do but that HP). Draining reads each
   * hit's damage, so a followed one is walked hit by hit in hits() instead.
   */
  private hitsWalk(node: Node, run: Run, useCase: UseCase, followed: boolean): HitWalk {
    const walks = node.walks ??= new Map();
    let entry = walks.get(useCase);
    if (!entry) walks.set(useCase, entry = [undefined, undefined]);
    const at = followed ? 0 : 1;
    if (entry[at]) return entry[at];
    const loop = this.loopInput(node.state, run, useCase, followed ? node.state.att.hp : UNTRACKED);
    return entry[at] = quietHits(loop) ? quietWalk(loop, useCase.hits.length) : walkHits(loop, useCase.hits.length);
  }

  /**
   * A bound's walk of a case's hits from the attacker's HP `hp`: each hit deals its lowest roll for the least
   * draining, or its highest into Liquid Ooze (a use that does not knock out deals every roll in full).
   */
  private boundWalk(state: State, run: Run, useCase: UseCase, hp: number): HitWalk {
    const loop = this.loopInput(state, run, useCase, hp);
    if (quietHits(loop)) return quietWalk(loop, useCase.hits.length);
    const ooze = loop.targetAbility === "liquidooze";
    return walkHits(loop, useCase.hits.length, (hit) => ooze ? useCase.hits[hit - 1].max : useCase.hits[hit - 1].min);
  }

  /**
   * What a use of `useCase` from `state` reads in its hits (hit-loop.ts HitLoopInput), from the attacker's HP
   * `hp`: the abilities in effect, the items that work, an Ability Shield and a Dynamaxed target (Wandering
   * Spirit), the case's contact and category, and the move's draining and Berry taking.
   */
  private loopInput(state: State, run: Run, useCase: UseCase, hp = state.att.hp): HitLoopInput {
    const { m } = this;
    const engineMove = run.trace.result!.move as Move & { drain?: [number, number] };
    const room = state.conditions.magicRoom;
    const targetAbility = this.ability(state, "def");
    const takesBerry = !engineMove.isMax && !engineMove.isZ && BERRY_STEALERS.has(this.input.move.id);
    const held = state.def.itemId;
    return {
      ...(takesBerry ? { targetBerry: held.endsWith("berry") && !(run.resistBerry && run.resistBerry === held) ? held : "" } : {}),
      ...(takesBerry && this.input.move.id !== "incinerate" ? { eats: { ignoresItem: this.ignoresOwnItems(state) } } : {}),
      hp, maxHP: state.att.maxHP, baseMaxHP: state.att.baseMaxHP,
      attackerAbility: this.ability(state, "att"), attackerItem: m.attItemOn ? state.att.itemId : "",
      // Bug Bite and Pluck take a Berry through Sticky Hold when Mold Breaker ignores it; nothing else the hits read is breakable.
      targetAbility: targetAbility === "stickyhold" && moldBreaks(m, state) ? "" : targetAbility,
      targetItem: m.defItemOn ? state.def.itemId : "",
      attackerShielded: state.att.itemId === "abilityshield" && !room, targetShielded: state.def.itemId === "abilityshield" && !room,
      ...(m.unnerve ? { unnerve: m.unnerve } : {}),
      targetDynamaxed: maxActive(state.def), contact: useCase.contact, category: useCase.physical ? "Physical" : "Special",
      drain: engineMove.drain ?? null, takesBerry,
      targetGulping: this.gulping(state),
      generation: m.runtime.profile.generation,
    };
  }

  /**
   * Whether the attacker ignores its own items (pinned Showdown sim/pokemon.ts ignoringItem, which singleEvent reads for an
   * item's handlers): under Magic Room, or with its Klutz in effect unless the item it holds has ignoreKlutz. Embargo is
   * not modelled.
   */
  private ignoresOwnItems(state: State): boolean {
    return state.conditions.magicRoom || (this.ability(state, "att") === "klutz" && !KLUTZ_IGNORED_ITEMS.has(state.att.itemId));
  }

  /**
   * What the use from `state` takes and eats when it is Bug Bite or Pluck (not as a Z-Move or Max Move): the target's held
   * Berry, unless the use's damage ate it (a resist Berry), and what eating it gives the attacker (hit-loop.ts stolenEat).
   * Null for another move, or no Berry. Sticky Hold keeps it unless the use knocks its holder out (hit-loop.ts hitStep).
   */
  private stolen(state: State, run: Run = this.first): { item: string; eat: StolenEat } | null {
    const moveId = this.input.move.id;
    const engineMove = run.trace.result!.move;
    if ((moveId !== "bugbite" && moveId !== "pluck") || engineMove.isMax || engineMove.isZ) return null;
    const item = state.def.itemId;
    if (!item.endsWith("berry") || (run.resistBerry && run.resistBerry === item)) return null;
    const eat = stolenEat(item, { baseMaxHP: state.att.baseMaxHP, ability: this.ability(state, "att"), ignoresItem: this.ignoresOwnItems(state) }, this.m.runtime.profile.generation);
    return { item, eat };
  }

  /** The target is Cramorant in its Gulping or Gorging form with its own Gulp Missile (hit-loop.ts gulpingTarget). */
  private gulping(state: State): boolean {
    return gulpingTarget({ speciesId: state.def.speciesId, abilityId: this.ability(state, "def"), transformed: !!this.m.defender.transformedFrom });
  }

  /**
   * Whether the Gorging form's Gulp Missile paralyses the attacker in the hit that spends it (pinned Showdown
   * data/abilities.ts gulpmissile trySetStatus; canStatus), and the paralysis stays: no Lum or Cheri Berry
   * cures it at that hit's Update.
   */
  private gorgingParalyses(state: State): boolean {
    if (!this.gulping(state) || state.def.speciesId !== "cramorantgorging" || !this.canStatus(state, "att", "par", true)) return false;
    return !(this.m.attItemOn && STATUS_CURES[state.att.itemId]?.includes("par") && !berryUnnerved(this.m.unnerve, "attacker", this.ability(state, "def")));
  }

  /**
   * The row's own move once Dynamax ends, for a Max Move's row (a Max Move never makes contact: pinned
   * Showdown getActiveMaxMove builds it without the base move's flags): whether it makes contact (its flag,
   * after Long Reach, Protective Pads and a Punching Glove on a punch) and its most hits (or the chosen count).
   * Null for a row that is not a Max Move.
   */
  private ownAfterMax(): { contact: boolean; hits: number } | null {
    if (!this.result.move.isMax) return null;
    const { m, input } = this;
    const flags = (m.gen.moves.get(id(input.move.name)) as { flags?: { contact?: number; punch?: number } } | undefined)?.flags ?? {};
    const contact = !!flags.contact && m.attAbility !== "longreach" && m.attackerItem !== "protectivepads" && !(m.attackerItem === "punchingglove" && !!flags.punch);
    const { multihit } = input.move;
    return { contact, hits: input.context?.hits ?? (Array.isArray(multihit) ? multihit[1] : multihit ?? 1) };
  }

  /**
   * The attacker's modes for each hit of a use from `state` when they change within it (calculate.ts reruns
   * those hits: Blaze and its kin at a third of its HP, Defeatist at half, a pinch berry's attacking stage,
   * Guts once the Gorging form's Gulp Missile paralyses it), as the target's damage back lowers its HP between
   * hits; "" when every hit is the first hit's (midMoves). Once Dynamax ends a Max Move's row uses its own move.
   */
  private midKey(state: State): string {
    if (!this.midMoves) return "";
    const run = this.first;
    let useCase = run.cases.reduce((a, b) => b.hits.length > a.hits.length ? b : a);
    const own = this.ownAfterMax();
    if (own && !maxActive(state.att)) useCase = { ...useCase, contact: own.contact, hits: Array.from({ length: own.hits }, () => useCase.hits[0]) };
    const loop = this.loopInput(state, run, useCase);
    // calculate.ts walks the hits only when something takes the attacker's HP, and not for draining.
    if (!hitsCanFaint(loop) || loop.drain) return "";
    const { type } = this.result.move, maxHP = state.att.maxHP, offense = this.offense;
    const paralyses = this.gorgingParalyses(state);
    const modes = walkHits(loop, useCase.hits.length).before.map((hit, index) =>
      `${PINCH_TYPES[hit.attackerAbility] === type && hit.hp <= maxHP / 3 ? 1 : 0}${hit.attackerAbility === "defeatist" && hit.hp <= maxHP / 2 ? 1 : 0}${hit.stages[offense] ?? 0}`
      + `${paralyses && index > 0 && !hit.gulping && hit.attackerAbility === "guts" ? 1 : 0}`);
    return modes.every((mode) => mode === modes[0]) ? "" : modes.join(",");
  }

  /** A node's midKey, made once. */
  private midKeyOf(node: Node): string {
    return node.mid ??= this.midKey(node.state);
  }

  /**
   * The exact search up to `limit` uses. A state in which the attacker has fainted with the target still in
   * is dropped (that sequence never knocks it out, and nothing is guaranteed); guaranteed is the first use
   * after which no state is left, if none was dropped, and fewest the first with a KO.
   */
  count(limit: number): Count {
    const ko: number[] = [];
    let guaranteed: number | null = null, fewest: number | null = null, out = 0, seen = false, fell: number | null = null, use = 0;
    const knock: Knock = (mass) => { out += mass; seen = true; };
    const faint: Knock = () => { fell ??= Math.max(1, use); };
    this.turnKO = false;
    let groups = this.charging([this.start("all")], "all", knock, faint);
    let previous = "";
    for (use = 1; use <= limit; use++) {
      groups = this.use(groups, "all", knock, undefined, faint);
      if (this.exceeded) return { guaranteed: null, fewest: null, ko, chance: 0, fell: null, fallback: true };
      ko[use - 1] = Math.min(1, out);
      if (seen) fewest ??= use;
      if (!groups.length) {
        if (fell === null) { guaranteed = use; ko[use - 1] = 1; }
        break;
      }
      // The same states as after the last use, with nothing pending: the rest is the closed form from here.
      // While the attacker's HP is followed: the same states but that HP, when it falls the same way on every sequence.
      const ids = groups.map((group) => this.follow ? group.node.restId : group.node.id).sort((a, b) => a - b).join();
      const settled = ids === previous && use < limit ? this.settled(groups) : null;
      const fall = settled && this.follow ? this.settledFall(groups, settled.run, limit - use) : null;
      if (settled && fall !== undefined) return this.finish(settled, groups, use, out, ko, fewest, limit, fell, fall);
      previous = ids;
    }
    release(groups);
    return { guaranteed, fewest, ko, chance: guaranteed !== null ? 1 : Math.min(1, out), fell, fallback: false, endOfTurn: this.turnKO };
  }

  /** The shared closed-form terms of states that will not change again, or null. */
  private settled(groups: Group[]): { terms: Terms; run: Run } | null {
    if (USES_REFERENCE.on) return null;
    let found: { terms: Terms; run: Run } | null = null;
    for (const { node, dist } of groups) {
      const state = node.state;
      if (this.pending(state)) return null;
      let code = -1, high = 0;
      for (let index = 0; index < dist.size; index++) {
        const hp = dist.hp[index];
        const at = this.hpCode(hp, state.def.maxHP);
        if (code !== -1 && at !== code) return null;
        code = at;
        if (hp > high) high = hp;
      }
      if (high >= state.def.maxHP && (this.sturdy || (state.def.itemId === "focussash" && this.m.defItemOn))) return null;
      const run = node.runs.get(code);
      if (!run) return null;
      const terms = this.terms(state, run, this.planOf(node).ops);
      if (!terms) return null;
      if (found && (found.run !== run || found.terms.heal !== terms.heal || found.terms.chip !== terms.chip)) return null;
      found = { terms, run };
    }
    return found;
  }

  /**
   * Where a followed attacker faints over the next `steps` uses from settled states, the same on every
   * sequence (one HP in every state, the same losses, and none hanging on the rolls): the use from here and
   * the target's end-of-turn damage still dealt on it (none when the use itself faints it; the residuals
   * before its own when its end of turn does). Null: it stands. Undefined: not so (the search goes on).
   */
  private settledFall(groups: Group[], run: Run, steps: number): { use: number; lastChip: number } | null | undefined {
    const result = run.trace.result!;
    const engineMove = result.move as Move & { recoil?: unknown; drain?: unknown };
    const useCase = run.cases[0], hits = useCase.hits.length;
    if (run.cases.some((entry) => entry.contact !== useCase.contact || entry.hits.length !== hits || entry.physical !== useCase.physical)) return undefined;
    const same = (a: number[], b: number[]) => a.length === b.length && a.every((value, index) => value === b[index]);
    let found: { hp: number; hits: string; loss: number; ops: number[]; orders: number[]; target: TurnPlan; state: State } | null = null;
    for (const { node } of groups) {
      const state = node.state, ability = this.ability(state, "att");
      if ((engineMove.recoil && ability !== "rockhead" && ability !== "magicguard") || engineMove.drain || (this.m.attItemOn && state.att.itemId === "shellbell")) return undefined;
      // Its own HP berry can still heal it.
      if (this.attackerBerry(state)) return undefined;
      const { ops, orders } = this.residualsOf(node).att;
      const entry = { hp: state.att.hp, hits: loopKey(this.loopInput(state, run, useCase)), loss: this.afterHitsLoss(state, result, 0), ops, orders, target: this.planOf(node), state };
      if (found && (found.hp !== entry.hp || found.hits !== entry.hits || found.loss !== entry.loss || !same(found.ops, ops) || !same(found.orders, orders)
        || !same(found.target.ops, entry.target.ops) || !same(found.target.orders, entry.target.orders))) return undefined;
      found = entry;
    }
    const { loss, ops, orders, target, state } = found!;
    const max = state.att.maxHP;
    let hp = found!.hp;
    for (let use = 1; use <= steps; use++) {
      // The use's hits from its HP (hit-loop.ts): a faint before the last hit lands changes the damage, and hits
      // that change more than its HP (a Jaboca or Rowap Berry eaten) change the uses after.
      const loop = this.loopInput(state, run, useCase, hp);
      const walk = walkHits(loop, hits);
      if ((walk.faint && walk.faint.hit < hits) || walk.after.targetItem !== loop.targetItem || walk.after.attackerAbility !== loop.attackerAbility
        || walk.after.targetAbility !== loop.targetAbility || walk.after.gulping !== loop.targetGulping) return undefined;
      hp = walk.after.hp - loss;
      if (hp <= 0) return { use, lastChip: 0 };
      for (let step = 0; step < ops.length; step++) {
        const op = ops[step];
        if (op === UPDATE) continue;
        hp = op > 0 ? (hp < max ? Math.min(max, hp + op) : hp) : hp + op;
        if (hp <= 0) return { use, lastChip: target.ops.reduce((sum, value, index) => value < 0 && target.orders[index] <= orders[step] ? sum - value : sum, 0) };
      }
    }
    return null;
  }

  /**
   * The count from settled states after `done` uses, with `out` already out: the lowest and highest
   * damage every use from the highest and lowest HP left give guaranteed and fewest, and the uses evolved
   * from this distribution give the chance of one use fewer, or with no guarantee the chance within the
   * limit. A followed attacker that faints on a later use (`fall`, the same on every sequence) stops the
   * uses there, as in the closed form.
   */
  private finish(settled: { terms: Terms; run: Run }, groups: Group[], done: number, out: number, ko: number[], fewest: number | null, limit: number,
    fell: number | null = null, fall: { use: number; lastChip: number } | null = null): Count {
    const { terms, run } = settled;
    let low = Infinity, high = 0;
    const dist = borrow(this.size);
    for (const group of groups) {
      for (let index = 0; index < group.dist.size; index++) {
        const hp = group.dist.hp[index];
        dist.add(hp, group.dist.p[hp]);
        if (hp < low) low = hp;
        if (hp > high) high = hp;
      }
    }
    release(groups);
    // The uses that still count, and the target's end-of-turn damage on the last of them.
    const falls = fall !== null && fall.use <= limit - done;
    const steps = falls ? fall.use : limit - done, lastChip = falls ? fall.lastChip : terms.chip;
    const reach = (hp: number, n: number) => terms.heal ? hp + (n - 1) * terms.heal : hp - (n - 1) * terms.chip - (n === steps ? lastChip : terms.chip);
    const within = (hp: number, damage: number) => {
      const count = usesFrom(hp, damage, terms);
      return count !== null && (count < steps || (count === steps && damage * count >= reach(hp, count))) ? done + count : null;
    };
    const guaranteed = fell === null ? within(high, terms.lowest) : null;
    fewest ??= within(low, terms.highest);
    if (guaranteed === null && falls) fell ??= done + fall.use;
    const faster = guaranteed !== null ? guaranteed - 1 : 0;
    let chance = guaranteed !== null ? 1 : Math.min(1, out);
    const { values, weights } = perUseDamage(run.cases);
    const left = Array.from(dist.hp.subarray(0, dist.size));
    if (faster > done && fewest !== null && fewest <= faster) ko[faster - 1] = Math.min(1, out + evolve(dist, values, weights, terms, faster - done));
    else if (guaranteed === null && fewest !== null) chance = Math.min(1, out + evolve(dist, values, weights, terms, steps, lastChip));
    else dist.release();
    if (guaranteed !== null) ko[guaranteed - 1] = 1;
    const endOfTurn = this.turnKO || turnKnocks(left, values, terms.chip, (guaranteed ?? done + steps) - done, steps, lastChip);
    return { guaranteed, fewest, ko, chance, fell, fallback: false, endOfTurn };
  }

  /**
   * One roll path: the uses to KO (null past `cap`), the use after which the attacker faints, the use it
   * faints on with the target still in (the path follows it on at 1 HP), and why it stopped. With `tail`, a
   * state that stops changing is finished by arithmetic.
   */
  path(mode: "lowest" | "highest", cap: number, tail = false, from?: Resume, start?: State): Walked {
    const counting = this.turnKO;
    this.turnKO = false;
    const walked = this.walk(mode, cap, tail, from, start);
    if (this.turnKO && walked.uses !== null) walked.endOfTurn = true;
    this.turnKO = counting;
    return walked;
  }

  /** walk() from the start (or `start`, a first state with the first use's damage), or `from` where an earlier walk of the same path reached its cap. */
  private walk(mode: "lowest" | "highest", cap: number, tail: boolean, from?: Resume, start?: State): Walked {
    let out = false;
    const knock: Knock = () => { out = true; };
    this.koFaint = false;
    let groups = from ? from.groups : this.charging([start ? this.startAt(start, mode) : this.start(mode)], mode, knock);
    if (out) return { uses: 1 };
    let faints = from?.faints, fallsFirst = from ? from.fallsFirst : groups[0]?.node.state.attackerFainted ? 1 : undefined;
    let previous: Node | null = from ? from.previous : null;
    for (let use = from ? from.use + 1 : 1; use <= cap; use++) {
      groups = this.use(groups, mode, knock, (hit) => {
        // Fainted by the use itself with the target in: a knockout at the end of the turn comes after it.
        if (hit[0]?.node.state.attackerFainted) fallsFirst ??= use;
      });
      if (this.stop) { release(groups); return { uses: null, stop: this.stop, faints, fallsFirst }; }
      const after = groups[0];
      if (after?.node.state.attackerFainted) fallsFirst ??= use;
      if (after?.node.state.attackerFainted || (out && this.koFaint)) faints ??= use;
      if (out || !after) { release(groups); return { uses: out ? use : null, faints, fallsFirst }; }
      if (tail && after.node === previous && !this.pending(after.node.state)) {
        const rest = this.tail(after, mode);
        release(groups);
        return { uses: rest === null ? null : use + rest, faints, fallsFirst };
      }
      previous = after.node;
    }
    // The groups stay borrowed for a walk on from here (released by it, or left to the collector).
    return { uses: null, faints, fallsFirst, resume: { groups, use: cap, previous, faints, fallsFirst } };
  }

  /** The uses left from a settled path state, when each use takes the same HP, or null. */
  private tail(group: Group, mode: "lowest" | "highest"): number | null {
    const { node } = group;
    const hp = group.dist.hp[0];
    const run = node.runs.get(this.hpCode(hp, node.state.def.maxHP));
    const terms = run && !(hp >= node.state.def.maxHP && (this.sturdy || node.state.def.itemId === "focussash")) ? this.terms(node.state, run, this.planOf(node).ops) : null;
    if (terms && run!.cases.length === 1) return usesFrom(hp, mode === "lowest" ? terms.lowest : terms.highest, terms);
    const step = (from: number) => {
      let out = false;
      const next = this.use([{ node: group.node, dist: pointDist(from, this.size) }], mode, () => { out = true; });
      const left = out || !next.length ? 0 : next[0].dist.hp[0];
      release(next);
      return left;
    };
    const once = step(hp);
    if (once === 0) return 1;
    const drop = hp - once, twice = step(once);
    if (twice === 0) return 2;
    if (drop <= 0 || twice !== once - drop) return null;
    // The highest HP a use still knocks out from, then the uses down to it.
    let low = 1, high = hp;
    while (low < high) { const mid = Math.ceil((low + high) / 2); if (step(mid) === 0) low = mid; else high = mid - 1; }
    if (step(low) !== 0) return null;
    return 1 + Math.ceil((hp - low) / drop);
  }

  /** Whether a later use could still change although this one did not. */
  private pending(state: State): boolean {
    const { att, def } = state;
    if (this.berryOf(state, true) || (this.follow && this.attackerBerry(state))) return true;
    // Anger Shell acts again each time the target falls past half HP.
    if (this.ability(state, "def") === "angershell") return true;
    if (this.m.hpForms || def.dynamaxTurns !== null || att.dynamaxTurns !== null || att.slowStart !== null || state.weatherTurns !== null || state.terrainTurns !== null) return true;
    if ((def.status === "tox" && def.toxic < 15) || (att.status === "tox" && att.toxic < 15)) return true;
    if (this.hpModes.def.exact || this.hpModes.att.exact || this.hpModes.def.half || this.trackAttacker) return true;
    return this.metronome(state) < 5 && this.m.attItemOn && att.itemId === "metronome";
  }

  /** A group at a first state other than the row's whose damage is the first use's. */
  private startAt(state: State, mode: Mode): Group {
    const node = this.node(state, mode);
    const code = this.hpCode(state.def.hp, state.def.maxHP);
    if (!node.runs.has(code)) node.runs.set(code, this.first);
    return { node, dist: pointDist(state.def.hp, this.size) };
  }

  private start(mode: Mode): Group {
    let node = this.starts[mode === "all" ? 0 : 1];
    if (!node) {
      node = this.starts[mode === "all" ? 0 : 1] = this.node(this.initial, mode);
      const code = this.hpCode(this.initial.def.hp, this.initial.def.maxHP);
      node.runs.set(code, this.first);
      this.runs.set(`${code}|${this.damageRest(node)}`, this.first);
    }
    return { node, dist: pointDist(this.initial.def.hp, this.size) };
  }

  /**
   * The interned node for a state. A state reached from `from` with the same key fields is `from` itself
   * (no key to build), and one with the same damage inputs shares its calculations.
   */
  private node(state: State, mode: Mode, from?: Node, restIndex?: number): Node {
    if (from && this.sameKey(state, from.state, mode)) return from;
    const rest = restIndex ?? this.restIndex(state);
    // The attacker's HP where the key reads it (a roll path's nodes apart from the exact search's).
    const attHP = mode !== "all" ? `P${state.att.hp * 2 + (state.attackerFainted ? 1 : 0)}` : this.follow ? state.att.hp * 2 + (state.attackerFainted ? 1 : 0) : "";
    const key = `${attHP}:${rest}`;
    let node = this.nodes.get(key);
    if (!node) {
      const shares = !!from && this.sameDamage(state, from.state);
      // By the key but the attacker's HP: a roll path's nodes apart from the exact search's.
      const slot = rest * 2 + (mode === "all" ? 0 : 1);
      const shared = this.shared[slot] ??= {};
      // Only a followed search settles by the states but the attacker's HP.
      const restId = this.follow ? rest : -1;
      this.nodes.set(key, node = { id: this.nodes.size, restId, state, key, shared, runs: shares ? from.runs : new Map(), hits: new Map(), turns: new Map(), ...(shares ? { rest: from.rest } : {}) });
    }
    return node;
  }

  /** A short id for a state's key but the two HPs (restKey). */
  private restIndex(state: State): number {
    const rest = this.restKey(state);
    let index = this.restIds.get(rest);
    if (index === undefined) this.restIds.set(rest, index = this.restIds.size);
    return index;
  }

  /** The fields a node key reads are equal. */
  private sameKey(a: State, b: State, mode: Mode): boolean {
    if ((mode !== "all" || this.follow) && (a.att.hp !== b.att.hp || a.attackerFainted !== b.attackerFainted)) return false;
    if (a.att.itemId === "metronome" && this.m.attItemOn && (a.consecutive !== b.consecutive || a.streak !== b.streak || a.charged !== b.charged)) return false;
    return sameSide(a.att, b.att) && sameSide(a.def, b.def) && a.fieldKey === b.fieldKey && a.first === b.first
      && a.weatherTurns === b.weatherTurns && a.terrainTurns === b.terrainTurns;
  }

  /** Whether holding an item or not changes no damage (NEUTRAL_ITEMS; an Air Balloon where nothing reads it). */
  private neutral(item: string): boolean {
    return NEUTRAL_ITEMS.has(item) || (item === "airballoon" && this.balloonNeutral);
  }

  /** The fields damageRest reads are equal (so are, then, the calculations for each part of the target's HP). */
  private sameDamage(a: State, b: State): boolean {
    if (USES_REFERENCE.on) return false;
    const att = this.hpModes.att;
    if (att.exact ? a.att.hp !== b.att.hp : (att.full || att.half || att.third) && hpKey(att, a.att.hp, a.att.maxHP) !== hpKey(att, b.att.hp, b.att.maxHP)) return false;
    const item = (x: string, y: string) => x === y || (!ITEM_MOVES.has(this.input.move.id) && (!x || this.neutral(x)) && (!y || this.neutral(y)));
    for (const stat of this.relevance.att) if (a.att.boosts[stat] !== b.att.boosts[stat]) return false;
    for (const stat of this.relevance.def) if (a.def.boosts[stat] !== b.def.boosts[stat]) return false;
    if (this.relevance.att.includes("spe") && (unburdened(a.att) !== unburdened(b.att) || unburdened(a.def) !== unburdened(b.def))) return false;
    return item(a.def.itemId, b.def.itemId) && item(a.att.itemId, b.att.itemId) && a.def.abilityId === b.def.abilityId && a.att.abilityId === b.att.abilityId
      && a.def.speciesId === b.def.speciesId && a.att.speciesId === b.att.speciesId && a.def.mechanic === b.def.mechanic && a.att.mechanic === b.att.mechanic
      && a.att.status === b.att.status && a.def.status === b.def.status && (a.att.slowStart !== null) === (b.att.slowStart !== null) && a.att.focusEnergy === b.att.focusEnergy && a.fieldKey === b.fieldKey
      && a.def.maxHP === b.def.maxHP && this.metronome(a) === this.metronome(b) && (a.first === b.first || (!this.input.context?.stellarFirstUse && !this.firstTurn))
      && (!this.midMoves || this.midKey(a) === this.midKey(b));
  }

  /** The charge turn before the next use, with its end of turn. */
  private charging(groups: Group[], mode: Mode, knock: Knock, faint?: Knock): Group[] {
    return groups.length && this.charges(groups[0].node.state) ? this.standing(this.endOfTurn(groups, mode, knock, 2), faint) : groups;
  }

  /**
   * One use: the hits and the state they leave, then the end of the turn, a recharge or loafing turn with its
   * own end of turn, and the next use's charge turn. A KO in any of them is this use's. With `faint` (the
   * exact search), the states in which the attacker has fainted with the target still in leave after each.
   */
  private use(groups: Group[], mode: Mode, knock: Knock, afterHits?: (groups: Group[]) => void, faint?: Knock): Group[] {
    let current = this.standing(this.hits(groups, mode, knock, faint), faint);
    afterHits?.(current);
    current = this.standing(this.endOfTurn(current, mode, knock, 0), faint);
    if (current.length && this.afterTurns(current[0].node.state)) current = this.standing(this.endOfTurn(current, mode, knock, 1), faint);
    return this.charging(current, mode, knock, faint);
  }

  /**
   * The groups in which the attacker still stands: the rest leave, their mass to `faint`. The target's own
   * end of turn comes before the attacker's, so a target out at the end of the turn the attacker faints in
   * is out first; one the attacker's use fainted it in (recoil, Life Orb) comes after.
   */
  private standing(groups: Group[], faint: Knock | undefined): Group[] {
    if (!faint) return groups;
    let kept: Group[] | null = null;
    for (let index = 0; index < groups.length; index++) {
      const group = groups[index];
      if (!group.node.state.attackerFainted) { kept?.push(group); continue; }
      kept ??= groups.slice(0, index);
      faint(massOf(group.dist));
      group.dist.release();
    }
    return kept ?? groups;
  }

  /** The part of the target's HP range a use's damage reads: 0 to 7 for the full, half and third lines, else 8 + HP. */
  private hpCode(hp: number, maxHP: number): number {
    const modes = this.hpModes.def;
    if (!this.readsHP) return 0;
    if (USES_REFERENCE.on || modes.exact) return 8 + hp;
    return (modes.full && hp >= maxHP ? 1 : 0) | (modes.half && hp * 2 <= maxHP ? 2 : 0) | (modes.third && hp * 3 <= maxHP ? 4 : 0);
  }

  /**
   * One use's hits from every state of each group, as a convolution hit by hit. An attacker that faints
   * to a contact hit's damage lands no more hits (pinned Showdown hitStepMoveHitLoop): in the exact search
   * (`faint`, the attacker's HP followed) the mass still in leaves to `faint`, and a roll path goes on to
   * the state the hits that landed leave.
   */
  private hits(groups: Group[], mode: Mode, knock: Knock, faint?: Knock): Group[] {
    const out = new Collector(this.size);
    for (const group of groups) {
      const { node, dist } = group;
      const state = node.state;
      // The damage for each part of the HP range it reads: a single part unless the damage reads the target's HP.
      const parts = new Map<number, { run: Run; dist: Dist }>();
      if (!this.readsHP) {
        const run = this.runAt(node, 0, dist.hp[0], mode);
        if (!run) return [];
        parts.set(0, { run, dist });
      } else {
        if (mode === "all" && this.hpModes.def.exact && !USES_REFERENCE.on) {
          let unknown = 0;
          for (let index = 0; index < dist.size; index++) if (!node.runs.has(this.hpCode(dist.hp[index], state.def.maxHP))) unknown++;
          if (this.reruns + unknown > (this.turnMode ? TURN_RUN_BUDGET : RUN_BUDGET)) { this.exceeded = true; return []; }
        }
        for (let index = 0; index < dist.size; index++) {
          const hp = dist.hp[index];
          const code = this.hpCode(hp, state.def.maxHP);
          let part = parts.get(code);
          if (!part) {
            const run = this.runAt(node, code, hp, mode);
            if (!run) return [];
            parts.set(code, part = { run, dist: borrow(this.size) });
          }
          part.dist.add(hp, dist.p[hp]);
        }
        dist.release();
      }
      const sashHeld = state.def.itemId === "focussash" && this.m.defItemOn && this.result.defender.hasItem("Focus Sash");
      const angerShell = this.ability(state, "def") === "angershell";
      const maxHP = state.def.maxHP;
      for (const [code, part] of parts) {
        const { run, dist: from } = part;
        const cases = this.casesFor(run, mode);
        const engineMove = run.trace.result!.move;
        // Super Fang's family and Endeavor follow the HP (per calculation: a Max Move's row is its own move once Dynamax ends); False Swipe and Hold Back leave 1 HP.
        const fixed = !!run.trace.fixedHP, endeavor = fixed && this.input.move.id === "endeavor", spares = !!run.row.leavesOneHP;
        // A doubles turn's step reports the calculations it meets: a fixed-HP move's is its damage at each HP.
        if (this.turnRows) {
          if (!fixed) this.turnRows.set(run.row, (this.turnRows.get(run.row) ?? 0) + massOf(from));
          else {
            for (let index = 0; index < from.size; index++) {
              const hp = from.hp[index];
              const damage = endeavor ? endeavorDamage(hp, state) : Math.max(1, Math.floor(Math.ceil(hp * state.def.baseMaxHP / maxHP) / 2));
              const row = this.fixedRow(run.row, damage);
              this.turnRows.set(row, (this.turnRows.get(row) ?? 0) + from.p[hp]);
            }
          }
        }
        // Anger Shell (pinned Showdown): not after a Sheer Force move (no AfterMoveSecondary), and after one hit
        // it holds an HP berry until its own check, on the HP before the berry.
        const sheerForce = this.ability(state, "att") === "sheerforce" && !!engineMove.secondaries;
        const angry = angerShell && !sheerForce;
        const tracksDealt = this.tracksDealt(state, mode, run);
        // Cheek Pouch heals as a resist Berry is eaten, before the damage.
        const before = run.resistBerry && run.resistBerry === state.def.itemId && this.ability(state, "def") === "cheekpouch" && this.m.defItemOn ? Math.max(1, Math.floor(state.def.baseMaxHP / 3)) : 0;
        if (before) for (let index = 0; index < from.size; index++) this.noteHeal("Cheek Pouch", Math.min(maxHP, from.hp[index] + before) - from.hp[index]);
        // The attacker's HP through the hits where the state follows it (the first use's walk follows it too); only
        // its first faint stops hits (a roll path follows it on past that faint as if it stood).
        const walking = this.oneUse !== null;
        const followed = mode !== "all" || this.follow || walking;
        // A doubles turn's step stops the hits once a followed attacker faints, as the first use's walk does.
        const tracked = (!!faint && this.follow) || ((mode !== "all" || walking || (this.turnMode && this.follow)) && !state.attackerFainted);
        for (let start = 0; start < cases.length;) {
          // The counts of a random hit count share their hits (each case is the first hits of the next): one
          // convolution carries their mass together, `reach[hit]` the share of it that deals that hit.
          let stop = start + 1;
          while (stop < cases.length && cases[start].random && cases[stop].random) stop++;
          const longest = cases[stop - 1];
          const reach = stop - start === 1 ? null : reachOf(cases, start, stop);
          const berry = this.hitBerry(node, longest.contact);
          const holds = angry && longest.hits.length === 1 && berry !== null && HEALING_BERRIES.has(state.def.itemId);
          const scale = reach ? 1 : longest.chance;
          let layer = new Map<number, Dist>([[0, before ? scaled(from, scale, this.size, before, maxHP) : scale === 1 ? from : scaled(from, scale, this.size)]]);
          // The attacker through the hits (hit-loop.ts): pinned Showdown hitStepMoveHitLoop lands no more hits once it
          // has fainted. One walk serves every roll, unless draining (each hit's heal reads its damage) gives each
          // layer its own state (a layer key's `at`, DrainSteps).
          const loop = this.loopInput(state, run, longest, followed ? state.att.hp : UNTRACKED);
          const drains = followed && !!loop.drain;
          const steps = drains && longest.hits.length > 1 ? new DrainSteps(loop) : null;
          const walk = steps ? null : this.hitsWalk(node, run, longest, followed);
          const lands = tracked && walk?.faint ? walk.faint.hit : Infinity;
          const group: HitGroup = { node, code, run, mode, out, maxHP, angry, holds, berry, walk, steps, drained: drains && !steps ? new DrainSteps(loop) : null };
          // Cheek Pouch heals the target as it eats its Jaboca or Rowap Berry in a hit's DamagingHit, before the next hit.
          const pouch = this.m.defItemOn && !loop.takesBerry && RETALIATION_BERRIES[loop.targetItem] && this.ability(state, "def") === "cheekpouch"
            ? Math.max(1, Math.floor(state.def.baseMaxHP / 3)) : 0;
          const eatenOn = pouch && walk ? retaliationEaten(walk) : 0;
          // The attacker after a hit that knocks the target out: as the hits leave it, but a Sticky Hold whose holder has
          // fainted lets Bug Bite and its kin take its Berry (hit-loop.ts hitStep `knocked`).
          const letsGo = loop.takesBerry && loop.targetAbility === "stickyhold";
          const koEnd = (at: number, hit: number, dealt: number, taken: number): HitState => {
            if (!letsGo) return hitEnd(group, at, hit + 1, dealt, taken);
            const before = steps ? steps.states[at] : group.drained ? group.drained.states[0] : hitsAfter(walk!, hit);
            return hitStep(loop, before, taken, true).state;
          };
          let done = start, landed = 0;
          for (let hit = 0; hit < longest.hits.length; hit++) {
            // The attacker fainted on an earlier hit: in the exact search the mass still in leaves to `faint`, and a
            // roll path goes on to the state the hits that landed leave.
            if (hit >= lands) {
              if (faint) {
                for (const layerDist of layer.values()) { faint(massOf(layerDist) * (reach ? reach[hit] : 1)); if (layerDist !== from) layerDist.release(); }
                layer = new Map();
              }
              break;
            }
            if (steps && tracked) {
              let cut = false;
              // The first use's walk over every sequence: the layers whose attacker has fainted end with the hits
              // that landed, for every case still to come, and the others go on.
              let ended: Map<number, Dist> | null = null;
              for (const [layerKey, layerDist] of layer) {
                if (steps.states[Math.floor(layerKey / 1048576)].hp > 0) continue;
                cut = true;
                if ((walking || this.turnMode) && mode === "all") { (ended ??= new Map()).set(layerKey, layerDist); layer.delete(layerKey); continue; }
                if (!faint) break;
                faint(massOf(layerDist) * (reach ? reach[hit] : 1));
                if (layerDist !== from) layerDist.release();
                layer.delete(layerKey);
              }
              if (ended) {
                for (let at = done; at < stop; at++) this.emit(group, ended, cases[at], at, landed, reach ? cases[at].chance : 1);
                for (const layerDist of ended.values()) if (layerDist !== from) layerDist.release();
              } else if (cut && !faint) break;
            }
            const hitRolls = longest.hits[hit];
            const values = mode === "all" ? hitRolls.values : mode === "lowest" ? hitRolls.lowest ??= [hitRolls.min] : hitRolls.highest ??= [hitRolls.max];
            const weights = mode === "all" ? hitRolls.weights : ONE;
            const next = new Map<number, Dist>();
            let lastKey = -1, target: Dist | null = null;
            let lost = 0, gone = false;
            for (const [layerKey, layerDist] of layer) {
              const mask = layerKey % 256, rest = (layerKey - mask) / 256, dealt = rest % 4096, at = (rest - dealt) / 4096;
              const sash = sashHeld && !(mask & SASH_USED);
              const eats = berry !== null && !holds && !(mask & BERRY_EATEN) && (!berry.enigma || run.superEffective);
              this.states += layerDist.size;
              for (let index = 0; index < layerDist.size; index++) {
                const hp = layerDist.hp[index], mass = layerDist.p[hp];
                for (let roll = 0, count = fixed ? 1 : values.length; roll < count; roll++) {
                  // Super Fang, Nature's Madness, Ruination: half the target's HP scaled back from Dynamax, at least 1.
                  let damage = endeavor ? endeavorDamage(hp, state) : fixed ? Math.max(1, Math.floor(Math.ceil(hp * state.def.baseMaxHP / maxHP) / 2)) : values[roll];
                  // False Swipe and Hold Back (pinned Showdown onDamage, before Sturdy and Focus Sash) leave 1 HP.
                  if (spares && damage >= hp) damage = hp - 1;
                  let bits = damage > 0 ? mask | DAMAGED : mask;
                  // Focus Sash and Sturdy at full HP (pinned Showdown onDamage): the hit leaves 1 HP, and Sash is used up.
                  if (damage >= hp && hp >= maxHP && damage > 0 && (this.sturdy || sash)) {
                    damage = hp - 1;
                    bits |= SAVED | (this.sturdy ? 0 : SASH_USED);
                  }
                  const weight = fixed ? mass : mass * weights[roll];
                  const taken = damage < hp ? damage : hp;
                  let left = hp - taken;
                  if (left <= 0) {
                    lost += weight; gone = true;
                    // On a roll path, whether the attacker also faints on the use that knocks out, or at the end of that turn.
                    if (mode !== "all") {
                      const after = this.attackerAfterUse(state, run.trace.result!, dealt + taken, koEnd(at, hit, dealt + taken, taken));
                      if (after.hp <= 0 || this.koTurnEnd(node, run, after.hp, !!after.berry) <= 0) this.koFaint = true;
                    }
                    // A doubles turn's step keeps the knocked-out mass as a node at 0 HP: the attacker's state after the
                    // hit that knocked out (recoil, Life Orb, its own drops and Berries) still matters to the turn.
                    if (this.knockedOut) {
                      const running = done < stop ? done : stop - 1;
                      const useCase = cases[running];
                      const after = this.afterHitNode(node, code, run, useCase.at ?? running, useCase, bits | DAMAGED | KNOCKED, tracksDealt ? dealt + taken : 0, mode,
                        hit + 1, koEnd(at, hit, dealt + taken, taken), steps ? steps.to(at, taken) + 1 : 0);
                      this.knockedOut.to(after, hit + 1).add(0, weight * (reach ? reach[hit] : 1));
                    }
                    continue;
                  }
                  const stepped = steps ? steps.to(at, taken) : 0;
                  if (pouch && (steps ? !!steps.states[at].targetItem && !steps.states[stepped].targetItem : eatenOn === hit + 1)) {
                    if (walking || this.turnHeals) this.noteHeal("Cheek Pouch", Math.min(maxHP, left + pouch) - left);
                    left = Math.min(maxHP, left + pouch);
                  }
                  if (eats && (berry!.enigma || left <= berry!.line)) {
                    if (walking || this.turnHeals) this.noteBerry(state.def.itemId, berry!, left);
                    left = eatBerry(berry!, left);
                    bits |= BERRY_EATEN;
                  }
                  const key = bits + 256 * ((tracksDealt ? dealt + taken : 0) + 4096 * stepped);
                  if (key !== lastKey) {
                    target = next.get(key) ?? null;
                    if (!target) next.set(key, target = borrow(this.size));
                    lastKey = key;
                  }
                  target!.add(left, weight);
                }
              }
            }
            if (gone) knock(lost * (reach ? reach[hit] : 1));
            for (const layerDist of layer.values()) if (layerDist !== from) layerDist.release();
            layer = next;
            landed = hit + 1;
            for (; done < stop && cases[done].hits.length === landed; done++) this.emit(group, layer, cases[done], done, landed, reach ? cases[done].chance : 1);
          }
          if (mode === "all" && this.states > STATE_BUDGET) { this.exceeded = true; return []; }
          // The cases the attacker's faint cut short, on a roll path: the hits that landed.
          for (; done < stop; done++) this.emit(group, layer, cases[done], done, landed, reach ? cases[done].chance : 1);
          for (const layerDist of layer.values()) if (layerDist !== from) layerDist.release();
          start = stop;
        }
        from.release();
      }
    }
    return out.groups();
  }

  /**
   * The states each outcome of `useCase` (at `caseIndex` in the run's cases) leaves after `landed` hits, from the
   * layers of a group's convolution, their mass scaled by `factor` (the case's share of a random hit count), with
   * Anger Shell and the berry it held, and Cheek Pouch's heal for a Berry the rest of the use eats.
   */
  private emit(group: HitGroup, layer: Map<number, Dist>, useCase: UseCase, caseIndex: number, landed: number, factor: number) {
    const { node, code, run, mode, out, maxHP, angry, holds, berry, steps } = group;
    const state = node.state;
    for (const [layerKey, layerDist] of layer) {
      const mask = layerKey % 256, rest = (layerKey - mask) / 256, dealt = rest % 4096, at = (rest - dealt) / 4096;
      if (mask & SAVED && state.first) this.survivalSaved = true;
      const end = hitEnd(group, at, landed, dealt);
      const targets = new Map<number, { dist: Dist; heal: number }>();
      for (let entry = 0; entry < layerDist.size; entry++) {
        let hp = layerDist.hp[entry];
        const mass = layerDist.p[hp] * factor;
        let bits = mask & ~SAVED;
        // Anger Shell: the target fell to half HP or less with this use's damage (pinned Showdown onAfterMoveSecondary), each time it does.
        if (angry && hp * 2 <= maxHP && (hp + dealt) * 2 > maxHP) bits |= ANGER_SHELL;
        // The berry Anger Shell held, at the Update after it (Enigma Berry acts only in the hit, so not at all).
        if (holds && !(bits & BERRY_EATEN) && !berry!.enigma && hp <= berry!.line) {
          this.noteBerry(state.def.itemId, berry!, hp);
          hp = eatBerry(berry!, hp);
          bits |= BERRY_EATEN;
        }
        let next = targets.get(bits);
        if (!next) {
          // The first use's walk keeps only the HP: its outcomes go to one distribution, with Cheek Pouch's heal.
          if (this.oneUse) targets.set(bits, next = { dist: this.oneUse.dist, heal: this.oneUseHeal(node, run, useCase, bits, dealt, mode, landed, end) });
          else {
            const after = this.afterHitNode(node, code, run, useCase.at ?? caseIndex, useCase, bits, dealt, mode, landed, end, steps ? at + 1 : 0);
            targets.set(bits, next = { dist: out.to(after, this.turnMode ? landed : undefined), heal: this.hitHeal });
          }
        }
        const healed = next.heal ? Math.min(maxHP, hp + next.heal) : hp;
        if (healed > hp) this.noteHeal("Cheek Pouch", healed - hp);
        next.dist.add(healed, mass);
      }
    }
  }

  /**
   * The node a use's outcome leaves, memoised: the case's `landed` hits, which left the attacker as `end`
   * (hit-loop.ts; `endKey` tells apart the ends a draining case's layers reach, else 0). `hitHeal` is left as
   * afterHit gives it for that outcome.
   */
  private afterHitNode(node: Node, code: number, run: Run, caseIndex: number, useCase: UseCase, mask: number, dealt: number, mode: Mode,
    landed: number, end: HitState, endKey: number): Node {
    // A doubles turn's step keeps apart the hits that landed and the knocked-out target (KNOCKED is past the mask's 64).
    const key: number | string = this.turnMode ? `${code},${caseIndex},${mask},${dealt},${endKey},${landed}` : (((code * 16 + caseIndex) * 64 + mask) * 4096 + dealt) * 65536 + endKey;
    let next = node.hits.get(key);
    if (next) { this.hitHeal = node.heals?.get(key) ?? 0; return next; }
    // The attacker's HP berry can hang on the dealt damage (recoil), so its state is made for each.
    if (!(mask & DAMAGED) || (mode === "all" && !this.follow) || this.attackerBerry(node.state)) {
      node.hits.set(key, next = this.node(this.afterHit(node.state, run, useCase, mask, dealt, mode, landed, end), mode, node));
      if (this.hitHeal) (node.heals ??= new Map()).set(key, this.hitHeal);
      return next;
    }
    // The dealt damage changes only the attacker's HP (recoil, draining, Shell Bell): the rest of the state is made
    // once for the hits that landed and what they changed but that HP (an ability replaced, a Berry eaten).
    const variants = node.shared.variants ??= new Map();
    const baseKey = `${code},${caseIndex},${mask},${landed}|${end.attackerAbility}|${end.targetAbility}|${end.targetItem}|${end.gulping}`;
    let entry = variants.get(baseKey);
    if (!entry) {
      const base = this.afterHit(node.state, run, useCase, mask, dealt, mode, landed, end);
      const gains = !node.state.att.itemId && (this.input.move.id === "thief" || this.input.move.id === "covet" || this.ability(node.state, "att") === "magician");
      variants.set(baseKey, entry = { base, rest: this.restIndex(base), byHP: new Map(), heal: this.hitHeal, direct: gains });
    }
    this.hitHeal = entry.heal;
    if (entry.heal) (node.heals ??= new Map()).set(key, entry.heal);
    // A berry the use can give the attacker (Thief, Covet, Magician) can hang on the dealt damage too.
    if (entry.direct) {
      node.hits.set(key, next = this.node(this.afterHit(node.state, run, useCase, mask, dealt, mode, landed, end), mode, node));
      return next;
    }
    const after = this.attackerHPAfter(node.state, run.trace.result!, dealt, end, dealt, this.afterMove(node.state, entry.base), entry.base);
    const fainted = node.state.attackerFainted || after <= 0, hp = after <= 0 ? 1 : after;
    next = entry.byHP.get(hp * 2 + (fainted ? 1 : 0));
    if (!next) {
      const state = { ...entry.base, att: { ...entry.base.att, hp }, attackerFainted: fainted };
      entry.byHP.set(hp * 2 + (fainted ? 1 : 0), next = this.node(state, mode, node, entry.rest));
    }
    node.hits.set(key, next);
    return next;
  }

  /** Whether the use's dealt damage matters to the state: Anger Shell's line, or recoil, draining or Shell Bell on a followed attacker HP. */
  private tracksDealt(state: State, mode: Mode, run: Run): boolean {
    const engineMove = run.trace.result!.move as Move & { recoil?: unknown; drain?: unknown };
    if (this.ability(state, "def") === "angershell" && !(this.ability(state, "att") === "sheerforce" && engineMove.secondaries)) return true;
    if (mode === "all" && !this.follow) return false;
    return !!engineMove.recoil || !!engineMove.drain || (this.m.attItemOn && state.att.itemId === "shellbell");
  }

  /** The use's cases for a roll path: the weakest or the strongest case alone (`at`: its place in the run's, which keys its transitions). */
  private casesFor(run: Run, mode: Mode): UseCase[] {
    if (mode === "all" || run.cases.length === 1) return run.cases;
    const paths = run.paths ??= {};
    const known = paths[mode];
    if (known) return known;
    // A random hit count's fewest hits at their lowest rolls, and its most at their highest.
    const pick = mode === "lowest" ? run.cases.reduce((a, b) => b.min < a.min ? b : a) : run.cases.reduce((a, b) => b.max > a.max ? b : a);
    return paths[mode] = [{ ...pick, chance: 1, at: run.cases.indexOf(pick) }];
  }

  /** The end of one turn (0: a use's, 1: a recharge, loaf or other move's, 2: a charge turn's) for every state. */
  private endOfTurn(groups: Group[], mode: Mode, knock: Knock, turn: 0 | 1 | 2): Group[] {
    const out = new Collector(this.size);
    const passed: Group[] = [];
    for (const group of groups) {
      const { node, dist } = group;
      const state = node.state;
      const plan = this.planOf(node);
      const { ops, orders, berry, ended, formLow, dynamaxEnds } = plan;
      if (!ops.length && !berry && !formLow && !dynamaxEnds) {
        // Nothing acts on the target's HP: the distribution passes through to the next state.
        const next = this.afterTurnNode(node, 0, mode, turn);
        const same = passed.find((entry) => entry.node === next);
        if (same) { for (let index = 0; index < dist.size; index++) same.dist.add(dist.hp[index], dist.p[dist.hp[index]]); dist.release(); }
        else passed.push({ node: next, dist });
        continue;
      }
      const max = state.def.maxHP;
      const nexts: (Dist | undefined)[] = [];
      let lost = 0, gone = false;
      // The exact search's attacker fainting to its own end of turn: the target's later residuals come after it.
      const falls = mode === "all" && this.follow ? this.fallOrder(node, turn) : Infinity;
      for (let index = 0; index < dist.size; index++) {
        let left = dist.hp[index], bits = 0;
        for (let step = 0; step < ops.length && left > 0 && orders[step] <= falls; step++) {
          const op = ops[step];
          if (op === UPDATE) {
            if (berry && !(bits & BERRY_EATEN) && left <= berry.line) { left = eatBerry(berry, left); bits |= BERRY_EATEN; }
          } else if (op > 0) {
            if (left < max) left = Math.min(max, left + op);
          } else {
            left += op;
          }
        }
        if (left <= 0) {
          lost += dist.p[dist.hp[index]]; gone = true;
          if (mode !== "all" && this.endsTurn(node, state.att.hp, turn) <= 0) this.koFaint = true;
          continue;
        }
        if (formLow?.(left)) bits |= FORM_LOW;
        // Dynamax ends last (onResidualPriority -100): pinned Showdown sets hp = ceil(hp x baseMaxhp / maxhp).
        if (dynamaxEnds) left = Math.ceil(left * state.def.baseMaxHP / max);
        // The Update after the residuals.
        const final = dynamaxEnds ? ended : berry;
        if (final && !(bits & BERRY_EATEN) && left <= final.line) { left = eatBerry(final, left); bits |= BERRY_EATEN; }
        let next = nexts[bits];
        if (!next) {
          const after = this.afterTurnNode(node, bits, mode, turn);
          next = nexts[bits] = out.to(after);
        }
        next.add(left, dist.p[dist.hp[index]]);
      }
      if (gone) { knock(lost); this.turnKO = true; }
      dist.release();
    }
    if (!passed.length) return out.groups();
    const merged = out.groups();
    for (const group of passed) {
      const same = merged.find((entry) => entry.node === group.node);
      if (same) { for (let index = 0; index < group.dist.size; index++) same.dist.add(group.dist.hp[index], group.dist.p[group.dist.hp[index]]); group.dist.release(); }
      else merged.push(group);
    }
    return merged;
  }

  private turnPlan(node: Node): TurnPlan {
    const { state } = node;
    const dynamaxEnds = state.def.dynamaxTurns === 1;
    const { ops, orders } = this.residualsOf(node).def;
    return {
      ops, orders, berry: this.berry(state, false), formLow: this.formLine(state.def), dynamaxEnds,
      ended: dynamaxEnds ? this.berry({ ...state, def: { ...state.def, maxHP: state.def.baseMaxHP } }, false) : null,
    };
  }

  /**
   * The residual order at which the attacker's own end of turn faints it, from a node's state, or Infinity.
   * A target residual of the same order counts first: the weather's damage is one handler for both (pinned
   * Showdown fieldEvent runs faintMessages after each handler). Two other residuals of one order go by
   * Speed, which the count leaves out.
   */
  private fallOrder(node: Node, turn: 0 | 1 | 2): number {
    return this.attackerTurn(node.state, this.attackerResiduals(node, turn), node.state.att.hp).order;
  }

  /** The attacker's HP `hp` after its own end of turn from a node's state (`ate`: the use ate its HP berry). */
  private endsTurn(node: Node, hp: number, turn: 0 | 1 | 2, ate = false): number {
    return this.attackerTurn(node.state, this.attackerResiduals(node, turn), hp, ate).hp;
  }

  /**
   * endsTurn for the turn of a use that knocks the target out: the target's Berry Bug Bite or Pluck took in that hit
   * (through Sticky Hold too, its holder having fainted) cured the attacker's status before the end of turn, so its
   * burn or poison does not hurt it then (pinned Showdown data/moves.ts bugbite onHit: the Eat runs in the hit).
   */
  private koTurnEnd(node: Node, run: Run, hp: number, ate: boolean): number {
    const { state } = node;
    const stolen = state.att.status && state.def.itemId.endsWith("berry") ? this.stolen(state, run) : null;
    if (!stolen || !stolen.eat.cures.includes(state.att.status)) return this.endsTurn(node, hp, 0, ate);
    const cured = cloneState(state);
    cured.att.status = ""; cured.att.toxic = 0;
    return this.attackerTurn(cured, this.residuals(cured, "att"), hp, ate).hp;
  }

  /**
   * The attacker's own end of turn from `hp`: its residuals in order, with its HP berry eaten at an Update
   * (unless `ate`), the HP it ends with (at most 0 once it faints), the residual order it faints at
   * (Infinity if it stands), and whether it ate the berry.
   */
  private attackerTurn(state: State, residuals: Residuals, hp: number, ate = false): { hp: number; order: number; ate: boolean } {
    const { ops, orders } = residuals;
    const max = state.att.maxHP;
    let berry = ate ? null : this.attackerBerry(state), eaten = false;
    for (let step = 0; step < ops.length && hp > 0; step++) {
      const op = ops[step];
      if (op === UPDATE) {
        if (berry && hp <= berry.line) { hp = eatBerry(berry, hp); berry = null; eaten = true; }
        continue;
      }
      hp = op > 0 ? (hp < max ? Math.min(max, hp + op) : hp) : hp + op;
      if (hp <= 0) return { hp, order: orders[step], ate: eaten };
    }
    return { hp, order: Infinity, ate: eaten };
  }

  /** A node's residuals, computed once. */
  private residualsOf(node: Node): { att: Residuals; def: Residuals } {
    return node.shared.residuals ??= node.state === this.initial ? this.residualsAt(this.initial) : { att: this.residuals(node.state, "att"), def: this.residuals(node.state, "def") };
  }

  /** A node's end-of-turn plan for the target, made once for its state but the attacker's HP. */
  private planOf(node: Node): TurnPlan {
    return node.shared.plan ??= this.turnPlan(node);
  }

  /** The attacker's residuals at the end of a turn: on a charge turn its move can leave it semi-invulnerable. */
  private attackerResiduals(node: Node, turn: 0 | 1 | 2): Residuals {
    if (turn === 2 && SEMI_INVULNERABLE_MOVES.has(this.input.move.id)) return node.shared.charging ??= this.residuals(node.state, "att", true);
    return this.residualsOf(node).att;
  }

  /** The state after the end of a turn: berries eaten, statuses Hydration cures, the attacker's own residuals, counters, forms, Dynamax. */
  private afterTurn(node: Node, bits: number, mode: Mode, turn: 0 | 1 | 2): State {
    const prev = node.state;
    const state = cloneState(prev);
    const { m } = this;
    const { att, def } = state;
    if (bits & BERRY_EATEN) this.eaten(state, def.itemId);
    const followed = mode !== "all" || this.follow;
    if (followed) {
      const turned = this.attackerTurn(prev, this.attackerResiduals(node, turn), att.hp);
      if (turned.ate) this.attackerAte(state, att.itemId);
      if (turned.hp <= 0) { state.attackerFainted = true; att.hp = 1; } else att.hp = turned.hp;
    }
    // Order 5.3: Hydration cures a status in the rain, before poison and burn act (residuals() leaves them out).
    for (const who of ["att", "def"] as const) if (this.hydrated(prev, who)) { state[who].status = ""; state[who].toxic = 0; }
    if (def.status === "tox") def.toxic = Math.min(15, def.toxic + 1);
    if (att.status === "tox") att.toxic = Math.min(15, att.toxic + 1);
    // Order 28: Speed Boost (lead Pokémon, so from the first turn), Slow Start's counter, Flame Orb and Toxic Orb.
    if (this.ability(state, "att") === "speedboost") boost(m, state, "att", { spe: 1 }, false);
    if (this.ability(state, "def") === "speedboost") boost(m, state, "def", { spe: 1 }, false);
    if (att.slowStart !== null) att.slowStart = att.slowStart > 1 ? att.slowStart - 1 : null;
    for (const who of ["att", "def"] as const) {
      const side = state[who];
      const orb = (who === "att" ? m.attItemOn : m.defItemOn) && !side.status ? side.itemId === "flameorb" ? "brn" : side.itemId === "toxicorb" ? "tox" : null : null;
      if (orb && this.canStatus(state, who, orb, false)) { side.status = orb; side.toxic = 0; }
    }
    // Order 29: forms that follow HP: the target's from this turn's HP line, the attacker's from its followed HP.
    if (HP_FORM_ABILITIES.has(def.abilityId)) def.speciesId = this.formFor(def, m.defender, !!(bits & FORM_LOW)) ?? def.speciesId;
    if (followed && HP_FORM_ABILITIES.has(att.abilityId)) att.speciesId = this.formFor(att, m.attacker, this.formLine(att)?.(att.hp) ?? false) ?? att.speciesId;
    for (const side of [def, att]) {
      if (side.dynamaxTurns !== null && --side.dynamaxTurns === 0) {
        if (side === att) att.hp = Math.ceil(att.hp * att.baseMaxHP / att.maxHP);
        side.maxHP = side.baseMaxHP; side.mechanic = undefined; side.dynamaxTurns = null;
      }
    }
    // Metronome's counter: a recharge or another move between uses resets it; a Truant loaf keeps the move as
    // the last one but failed; a charge turn leaves it for the attack turn.
    if (turn === 1) {
      if (this.ability(state, "att") === "truant" && !RECHARGE_MOVES.has(this.input.move.id) && !NOT_TWICE_MOVES.has(this.input.move.id)) state.streak = 1;
      else { state.consecutive = 0; state.streak = 0; }
    }
    if (turn === 2) state.charged = true;
    // The weather and terrain a use set (pinned Showdown fieldEvent Residual: the weather's duration ticks
    // before its residuals, which residuals() leaves out on its last turn, the terrain's after its heal).
    let conditions = state.conditions;
    if (state.weatherTurns !== null && --state.weatherTurns === 0) { conditions = { ...conditions, weather: "" }; state.weatherTurns = null; }
    if (state.terrainTurns !== null && --state.terrainTurns === 0) { conditions = { ...conditions, terrain: "" }; state.terrainTurns = null; }
    this.itemsLost(prev, state);
    if (conditions === prev.conditions) return this.normalized(state);
    const stale = this.staleField();
    if (stale) { this.stop ??= stale; this.exceeded = true; }
    return this.normalized({ ...state, conditions, fieldKey: this.fieldKey(conditions) });
  }

  /**
   * Why a weather or terrain change cannot be followed, or null: the two Pokémon's abilities the battle settles from
   * the field (FIELD_SETTLED_ABILITIES), and in a doubles turn the other two Pokémon's (UsesEnv.fieldSettled).
   */
  private staleField(): string | null {
    const { m } = this;
    const own = [m.attacker, m.defender].filter((build) => FIELD_SETTLED_ABILITIES.has(build.abilityId));
    if (!m.turn) return own.length ? "A field change would change an ability" : null;
    const names = [...own.map((build) => m.runtime.abilitiesById.get(build.abilityId)?.name ?? build.abilityId), ...m.fieldSettled];
    return names.length ? `A weather or terrain change this turn would change ${names[0]}.` : null;
  }

  /** A field state's key: "" for the field as set, else a short id for its JSON. */
  private fieldKey(conditions: BattleConditions): string {
    const json = JSON.stringify(conditions);
    if (!this.fieldIds.size) this.fieldIds.set(JSON.stringify(this.m.conditions), "");
    let id = this.fieldIds.get(json);
    if (id === undefined) this.fieldIds.set(json, id = `F${this.fieldIds.size}`);
    return id;
  }

  /**
   * The node an end of turn leaves (afterTurn), memoised. With the attacker's HP followed and no berry or
   * form reading it, that HP is the only thing the end of turn changes differently for the nodes of one state
   * but that HP: the rest is made once for them, and the HP from its residuals and Dynamax ending.
   */
  private afterTurnNode(node: Node, bits: number, mode: Mode, turn: 0 | 1 | 2): Node {
    const key = bits * 4 + turn;
    let next = node.turns.get(key);
    if (next) return next;
    const prev = node.state;
    if (!(mode !== "all" || this.follow) || this.attackerBerry(prev) || HP_FORM_ABILITIES.has(prev.att.abilityId)) {
      node.turns.set(key, next = this.node(this.afterTurn(node, bits, mode, turn), mode, node));
      return next;
    }
    const variants = node.shared.turnVariants ??= new Map();
    let entry = variants.get(key);
    if (!entry) {
      const base = this.afterTurn(node, bits, mode, turn);
      variants.set(key, entry = { base, rest: this.restIndex(base), byHP: new Map() });
    }
    const turned = this.attackerTurn(prev, this.attackerResiduals(node, turn), prev.att.hp);
    const fainted = prev.attackerFainted || turned.hp <= 0;
    let hp = turned.hp <= 0 ? 1 : turned.hp;
    if (prev.att.dynamaxTurns === 1) hp = Math.ceil(hp * prev.att.baseMaxHP / prev.att.maxHP);
    next = entry.byHP.get(hp * 2 + (fainted ? 1 : 0));
    if (!next) {
      const state = { ...entry.base, att: { ...entry.base.att, hp }, attackerFainted: fainted };
      entry.byHP.set(hp * 2 + (fainted ? 1 : 0), next = this.node(state, mode, node, entry.rest));
    }
    node.turns.set(key, next);
    return next;
  }

  /** How long a weather (or "terrain") a side's use or ability sets lasts: 5 turns, 8 with its Heat, Damp, Smooth or Icy Rock or Terrain Extender. */
  private fieldTurns(state: State, who: "att" | "def", kind: string): number {
    const item = { Sun: "heatrock", Rain: "damprock", Sand: "smoothrock", Hail: "icyrock", Snow: "icyrock", terrain: "terrainextender" }[kind];
    return (who === "att" ? this.m.attItemOn : this.m.defItemOn) && !!item && state[who].itemId === item ? 8 : 5;
  }

  /**
   * The state with the stat stages no later use reads set to 0, so that states differing only in them are
   * one (Icy Wind's Speed drops, Close Combat's defenses). Stages stay when a White Herb could react to a
   * drop, or the target's Opportunist or Mirror Herb copies the attacker's rises.
   */
  private normalized(state: State): State {
    // A doubles turn keeps every stage: the turn's other moves read them.
    if (USES_REFERENCE.on || this.turnMode) return state;
    for (const who of ["att", "def"] as const) {
      const side = state[who];
      if (side.itemId === "whiteherb" || (who === "att" && (this.ability(state, "def") === "opportunist" || state.def.itemId === "mirrorherb"))) continue;
      for (const stat of STATS) if (side.boosts[stat] && !this.relevance[who].includes(stat)) side.boosts[stat] = 0;
    }
    return state;
  }

  /**
   * The state a use leaves, in pinned Showdown's order (spreadMoveHit, hitStepMoveHitLoop, runMove): items
   * spent before the damage, the move's onHit and the target's Hit handlers, the move's own effects and
   * secondaries, DamagingHit, AfterHit, AfterMoveSecondary and AfterMoveSecondarySelf (both skipped after a
   * Sheer Force move), AfterMove; then the attacker's HP and the field. A Cheek Pouch heal outside the hits'
   * berries is left in `hitHeal`. `landed`: the hits that landed (fewer once the attacker faints); `end`: the
   * attacker and target as those hits left them (hit-loop.ts), walked here when not given.
   */
  private afterHit(prev: State, run: Run, useCase: UseCase, mask: number, dealt: number, mode: Mode, landed = useCase.hits.length, end?: HitState): State {
    const state = cloneState(prev);
    const { m, input } = this;
    const { attacker, runtime, helpers } = m;
    const result = run.trace.result!;
    let conditions = state.conditions;
    const field = () => conditions === prev.conditions ? (conditions = { ...conditions, attackerSide: { ...conditions.attackerSide }, defenderSide: { ...conditions.defenderSide } }) : conditions;
    const att = state.att, def = state.def;
    const attAbility = this.ability(state, "att"), defAbility = this.ability(state, "def");
    const engineMove = result.move;
    const moveId = input.move.id;
    // The row's own move, not the Max Move it is while Dynamax lasts: only it has its own effects.
    const own = !engineMove.isMax;
    // Sheer Force removes the move's secondaries (onModifyMove).
    const sheerForce = attAbility === "sheerforce" && !!engineMove.secondaries;
    const { contact, physical } = useCase;
    const type = engineMove.type;
    const damaged = !!(mask & DAMAGED);
    const followed = mode !== "all" || this.follow;
    const loop = damaged ? this.loopInput(prev, run, useCase, followed ? prev.att.hp : UNTRACKED) : null;
    if (loop) end ??= walkHits(loop, landed).after;
    const broken = moldBreaks(m, prev);
    const stickyHold = defAbility === "stickyhold" && !broken;
    const shielded = (defAbility === "shielddust" && !broken) || (def.itemId === "covertcloak" && m.defItemOn);
    const pouch = this.ability(prev, "def") === "cheekpouch" && m.defItemOn ? Math.max(1, Math.floor(def.baseMaxHP / 3)) : 0;
    this.hitHeal = 0;
    if (mask & SASH_USED) def.itemId = "";
    if (mask & BERRY_EATEN) this.eaten(state, def.itemId, true);

    // 1. Before the damage: a resist Berry eaten, a Gem spent (its volatile stops this use's Thief, Covet and
    //    Magician), Power Herb used by the charge turn it skips (pinned Showdown onChargeMove useItem).
    if (run.resistBerry && run.resistBerry === def.itemId) def.itemId = "";
    const gem = !!run.gem && run.gem === att.itemId;
    if (gem) att.itemId = "";
    if (m.attItemOn && att.itemId === "powerherb" && this.charges(prev, true)) att.itemId = "";

    // 2. The move's onHit: Bug Bite and Pluck take a Berry and their user eats it, Incinerate burns a Berry or a Gem; not
    //    through Sticky Hold unless the hit knocked its holder out (data/abilities.ts stickyhold onTakeItem `!pokemon.hp`).
    //    Then the target's Hit handlers: its Sticky Barb moves to an item-less attacker it hits with contact
    //    (Enigma Berry is the hits' BERRY_EATEN).
    const knocked = !!(mask & KNOCKED);
    if (own && !engineMove.isZ && BERRY_STEALERS.has(moveId) && damaged && def.itemId.endsWith("berry") && (!stickyHold || knocked)) {
      // Bug Bite and Pluck (data/moves.ts bugbite, pluck onHit): the user eats it (hit-loop.ts stolenEat; its HP is the hits').
      const stolen = this.stolen(prev, run);
      if (stolen) this.ateStolen(state, stolen.eat);
      def.itemId = "";
    }
    if (own && !engineMove.isZ && moveId === "incinerate" && damaged && def.itemId.endsWith("gem")) def.itemId = "";
    if (def.itemId === "stickybarb" && m.defItemOn && contact && damaged && !att.itemId) { att.itemId = "stickybarb"; def.itemId = ""; }

    // 3. The move's own effects and secondaries: stat stages, Clear Smog, a Max Move's, statuses (a status
    //    Berry cures at once; Synchronize passes burn or poison back), Smelling Salts and Wake-Up Slap curing
    //    theirs, Salt Cure, Spicy Spray's burn.
    const table = own ? statMove(moveId, runtime.profile.id) : undefined;
    if (table) {
      if (table.self) boost(m, state, "att", table.self, false);
      if (table.preHit) boost(m, state, "att", table.preHit, false);
      if (table.userSecondary && !sheerForce) for (let i = 0; i < Math.max(1, landed); i++) boost(m, state, "att", table.userSecondary, false);
      if (table.target && !sheerForce && !shielded && damaged) boost(m, state, "def", table.target, true, true);
    }
    if (moveId === "terablast" && result.attacker.teraType === "Stellar") boost(m, state, "att", { atk: -1, spa: -1 }, false);
    if (own && moveId === "clearsmog" && damaged) def.boosts = { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
    const maxEffect = MAX_MOVE_EFFECTS[engineMove.name];
    if (maxEffect && damaged) {
      if (maxEffect.user) boost(m, state, "att", maxEffect.user, false);
      if (maxEffect.foe) boost(m, state, "def", maxEffect.foe, true, true);
      if (maxEffect.weather && !STRONG_WEATHERS.includes(conditions.weather) && conditions.weather !== maxEffect.weather) {
        field().weather = maxEffect.weather as BattleConditions["weather"];
        state.weatherTurns = this.fieldTurns(state, "att", maxEffect.weather);
      }
      if (maxEffect.terrain && conditions.terrain !== maxEffect.terrain) { field().terrain = maxEffect.terrain as BattleConditions["terrain"]; state.terrainTurns = this.fieldTurns(state, "att", "terrain"); }
      if (maxEffect.clearsTerrain && conditions.terrain) { field().terrain = ""; state.terrainTurns = null; }
      if (maxEffect.clearsScreens && (conditions.defenderSide.reflect || conditions.defenderSide.lightScreen || conditions.defenderSide.auroraVeil)) Object.assign(field().defenderSide, { reflect: false, lightScreen: false, auroraVeil: false });
      // G-Max Sweetness cures the user's status in its self.onHit, before the end of the turn.
      if (maxEffect.curesUserStatus && att.status) { att.status = ""; att.toxic = 0; }
    }
    const status = damaged ? this.statusLands(prev, run, sheerForce, shielded) : null;
    if (status) {
      if (this.curesAtOnce(prev, status)) { def.itemId = ""; this.hitHeal += pouch; } else {
        def.status = status; def.toxic = 0;
        if (defAbility === "synchronize" && status !== "par" && this.canStatus(state, "att", status, false)) { att.status = status; att.toxic = 0; }
      }
    }
    if (own && ((moveId === "smellingsalts" && def.status === "par") || (moveId === "wakeupslap" && def.status === "slp")) && damaged) def.status = "";
    if (this.saltCures(prev, run) && damaged && !sheerForce && !shielded) def.saltCure = true;
    if (!att.status && result.defender.hasAbility("Spicy Spray") && helpers.spicySpray(result, { ...attacker, status: att.status }, conditions) !== null) {
      if (att.itemId === "lumberry" || att.itemId === "rawstberry") { if (landed >= 2) att.status = "brn"; att.itemId = ""; }
      else att.status = "brn";
    }

    // 4. DamagingHit: Air Balloon pops; the target's abilities a hit sets off (Thermal Exchange is breakable;
    //    Champions keeps gen9's Weak Armor, Speed +2), Seed Sower and Sand Spit, Mummy, Lingering Aroma and
    //    Wandering Spirit (not past the attacker's Ability Shield), and the items a hit uses up.
    if (def.itemId === "airballoon" && damaged) def.itemId = "";
    const hit = HIT_ABILITIES[defAbility];
    if (hit && hit.when(type, physical, contact) && !(defAbility === "thermalexchange" && broken)) {
      for (let i = 0; i < landed; i++) boost(m, state, hit.attacker ? "att" : "def", hit.stages, !!hit.attacker, true);
    }
    if (damaged && defAbility === "seedsower" && conditions.terrain !== "Grassy") { field().terrain = "Grassy"; state.terrainTurns = this.fieldTurns(state, "def", "terrain"); }
    if (damaged && defAbility === "sandspit" && !STRONG_WEATHERS.includes(conditions.weather) && conditions.weather !== "Sand") { field().weather = "Sand"; state.weatherTurns = this.fieldTurns(state, "def", "Sand"); }
    // The hits' Mummy, Lingering Aroma and Wandering Spirit, and a Jaboca or Rowap Berry eaten as it hits back
    // (its Cheek Pouch heal is the hit's, in hits()), as hit-loop.ts hitStep leaves them.
    if (loop && end) {
      if (end.attackerAbility !== loop.attackerAbility) att.abilityId = end.attackerAbility;
      if (end.targetAbility !== loop.targetAbility) def.abilityId = end.targetAbility;
      if (RETALIATION_BERRIES[def.itemId] && loop.targetItem === def.itemId && !end.targetItem) def.itemId = "";
      // Gulp Missile, as the hits spent it (pinned Showdown data/abilities.ts gulpmissile): the Gulping form lowers
      // the attacker's Defense by 1 (a foe's drop: boost()), the Gorging form paralyses it (a Lum or Cheri Berry
      // cures that at once), and the target changes back to Cramorant.
      if (loop.targetGulping && !end.gulping) {
        if (def.speciesId === "cramorantgulping") boost(m, state, "att", { def: -1 }, true, true);
        else if (this.canStatus(state, "att", "par", true)) {
          if (m.attItemOn && STATUS_CURES[att.itemId]?.includes("par") && !berryUnnerved(m.unnerve, "attacker", this.ability(state, "def"))) att.itemId = "";
          else { att.status = "par"; att.toxic = 0; }
        }
        def.speciesId = "cramorant";
      }
    }
    const used = HIT_ITEMS[def.itemId];
    if (used && !used.berry && m.defItemOn && damaged && used.when(type, physical, run.superEffective) && !(def.itemId === "weaknesspolicy" && run.trace.fixedHP)) {
      boost(m, state, "def", used.stages, false, true);
      def.itemId = "";
    }

    // 5. AfterHit: Knock Off, Thief and Covet (an item-less attacker; not on the use that spends a Gem), never through Sticky Hold.
    if (own && moveId === "knockoff" && damaged && def.itemId && !stickyHold && knockOffBoosted(result)) def.itemId = "";
    if (own && (moveId === "covet" || moveId === "thief") && damaged && def.itemId && !att.itemId && !gem && (!stickyHold || def.itemId === "stickybarb")
      && takeable(m, def.itemId, this.baseSpecies(state, "def"), this.baseSpecies(state, "att"), true)) { att.itemId = def.itemId; def.itemId = ""; }

    // 6. AfterMoveSecondary, skipped after a Sheer Force move (the attacker's ability as the hits left it):
    //    Kee and Maranga Berry (Unnerve, now, stops them; Cheek Pouch heals), Pickpocket, Anger Shell.
    const secondaries = !(this.ability(state, "att") === "sheerforce" && !!engineMove.secondaries);
    const berry = HIT_ITEMS[def.itemId];
    if (secondaries && berry?.berry && m.defItemOn && damaged && !this.targetUnnerved(state) && berry.when(type, physical, run.superEffective)) {
      const ripen = defAbility === "ripen" ? 2 : 1;
      boost(m, state, "def", Object.fromEntries(Object.entries(berry.stages).map(([stat, amount]) => [stat, amount! * ripen])), false, true);
      def.itemId = "";
      this.hitHeal += pouch;
    }
    // A knocked-out target has fainted before AfterMoveSecondary (pinned Showdown hitStepMoveHitLoop runs faintMessages
    // first): its handlers are skipped and takeItem fails on it.
    if (secondaries && !knocked && this.ability(state, "def") === "pickpocket" && contact && damaged && !def.itemId && att.itemId && this.ability(state, "att") !== "stickyhold"
      && takeable(m, att.itemId, this.baseSpecies(state, "att"), this.baseSpecies(state, "def"), false)) { def.itemId = att.itemId; att.itemId = ""; }
    if (mask & ANGER_SHELL) boost(m, state, "def", { atk: 1, spa: 1, spe: 1, def: -1, spd: -1 }, false, true);

    // 7. AfterMoveSecondarySelf (skipped likewise): Throat Spray, then Magician (an item-less attacker; not on the use that spends a Gem).
    if (secondaries && m.attItemOn && att.itemId === "throatspray" && engineMove.flags?.sound) { boost(m, state, "att", { spa: 1 }, false); att.itemId = ""; }
    if (secondaries && !knocked && this.ability(state, "att") === "magician" && damaged && def.itemId && !att.itemId && !gem && (!stickyHold || def.itemId === "stickybarb")
      && takeable(m, def.itemId, this.baseSpecies(state, "def"), this.baseSpecies(state, "att"), false)) { att.itemId = def.itemId; def.itemId = ""; }

    // 8. AfterMove: White Herb restores lowered stages; after the first use, the rise a side's Opportunist or Mirror
    //    Herb stored from the other's Berry eaten before the move (calculate.ts pendingCopy; pinned Showdown
    //    onAnyAfterMove), through boost() but not copied back, the herb used up. One its holder no longer has (taken,
    //    already used, its ability replaced) is not followed.
    for (const [side, on] of [[att, m.attItemOn], [def, m.defItemOn]] as const) {
      if (on && side.itemId === "whiteherb" && STATS.some((stat) => side.boosts[stat] < 0)) {
        for (const stat of STATS) if (side.boosts[stat] < 0) side.boosts[stat] = 0;
        side.itemId = "";
      }
    }
    if (prev.first && !this.turnMode) {
      for (const [who, build] of [["att", m.attacker], ["def", m.defender]] as const) {
        const copy = build.pendingCopy;
        if (!copy) continue;
        const kept = copy.by.every((by) => by === "Mirror Herb" ? state[who].itemId === "mirrorherb" : this.ability(state, who) === "opportunist");
        if (!kept) { this.stop ??= "A copied rise cannot be followed"; this.exceeded = true; continue; }
        for (let time = 0; time < copy.by.length; time++) boost(m, state, who, copy.stages, false, false, false, true);
        if (copy.by.includes("Mirror Herb")) state[who].itemId = "";
      }
    }

    // 9. The attacker's HP, when followed, with its HP berry.
    if (loop && end && followed) {
      const after = this.attackerAfterUse(prev, result, dealt, end, dealt, this.afterMove(prev, state), state);
      if (after.berry && att.itemId === after.berry) this.attackerAte(state, after.berry);
      att.hp = after.hp;
      if (att.hp <= 0) { state.attackerFainted = true; att.hp = 1; }
    }
    // 10. Field: Charge is used up; Ice Spinner and Steel Roller end the terrain; Smack Down and Thousand Arrows
    //     ground the target; a terrain a use set uses up a Seed held for it (onTerrainChange).
    if (type === "Electric" && conditions.attackerSide.charge) field().attackerSide.charge = false;
    if (own && (moveId === "icespinner" || moveId === "steelroller") && damaged && conditions.terrain) { field().terrain = ""; state.terrainTurns = null; }
    if (own && (moveId === "smackdown" || moveId === "thousandarrows") && damaged && !this.grounded({ ...state, conditions }, "def")) def.smackedDown = true;
    if (conditions.terrain && conditions.terrain !== prev.conditions.terrain) this.useSeeds(state, conditions.terrain, true);
    this.itemsLost(prev, state);
    state.first = false;
    state.consecutive = this.metronomeCount(prev);
    state.streak = 2;
    state.charged = false;
    if (conditions === prev.conditions) return this.normalized(state);
    const stale = conditions.weather !== prev.conditions.weather || conditions.terrain !== prev.conditions.terrain ? this.staleField() : null;
    if (stale) { this.stop ??= stale; this.exceeded = true; }
    return this.normalized({ ...state, conditions, fieldKey: this.fieldKey(conditions) });
  }

  /**
   * The status a use's hit gives the target (Inferno, Mortal Spin, G-Max Malodor...): a secondary one not
   * after Sheer Force nor through Shield Dust or Covert Cloak; null when none lands.
   */
  private statusLands(prev: State, run: Run, sheerForce: boolean, shielded: boolean): BattleStatus | null {
    const status = this.statusAfterUse(prev, run);
    if (!status || (run.statusSecondary && (sheerForce || shielded))) return null;
    return this.canStatus(prev, "def", status, true) ? status : null;
  }

  /** Whether the target's status Berry cures `status` as it lands (pinned Showdown onAfterSetStatus / onUpdate; the attacker's Unnerve stops it). */
  private curesAtOnce(prev: State, status: BattleStatus): boolean {
    return !!STATUS_CURES[prev.def.itemId]?.includes(status) && this.m.defItemOn && !this.targetUnnerved(prev);
  }

  /** The target's Mummy, Lingering Aroma or Wandering Spirit replaces the attacker's ability on a contact hit (replacesAbility). */
  private replacesAbility(state: State): boolean {
    return replacesAbility(this.ability(state, "att"), this.ability(state, "def"), state.att.itemId === "abilityshield" && !state.conditions.magicRoom,
      state.def.itemId === "abilityshield" && !state.conditions.magicRoom, maxActive(state.def));
  }

  /** A side's own species for what reads it (a transformed attacker keeps its own). */
  private baseSpecies(state: State, who: "att" | "def"): string {
    return (who === "att" ? this.m.attacker : this.m.defender).transformedFrom?.speciesId ?? state[who].speciesId;
  }

  /** A terrain that starts uses up a Seed held for it (pinned Showdown onTerrainChange useItem; Contrary and Simple apply). */
  private useSeeds(state: State, terrain: BattleConditions["terrain"], inMove: boolean) {
    for (const who of ["att", "def"] as const) {
      const seed = SEEDS[state[who].itemId];
      if (!seed || seed.terrain !== terrain || !(who === "att" ? this.m.attItemOn : this.m.defItemOn)) continue;
      boost(this.m, state, who, { [seed.stat]: 1 }, false, inMove);
      state[who].itemId = "";
    }
  }

  /** Unburden after a use or a turn (pinned Showdown onAfterUseItem / onTakeItem): it activates as its holder's item goes, and ends with the ability. */
  private itemsLost(prev: State, state: State) {
    for (const who of ["att", "def"] as const) {
      const side = state[who];
      if (this.ability(state, who) !== "unburden") side.unburden = false;
      else if (prev[who].itemId && !side.itemId) side.unburden = true;
    }
  }

  /** attackerAfterUse's HP alone. */
  private attackerHPAfter(prev: State, result: Result, dealt: number, end: HitState, healed = dealt, after = prev, final = after): number {
    return this.attackerAfterUse(prev, result, dealt, end, healed, after, final).hp;
  }

  /**
   * The attacker's HP after a use from `prev` that dealt `dealt`, in pinned Showdown's order: its hits as `end`
   * leaves it (hit-loop.ts: draining with each hit, the target's Rough Skin, Iron Barbs, Rocky Helmet, Jaboca or
   * Rowap Berry and Liquid Ooze, its own HP berry at each hit's Update, no hit after it faints); then recoil
   * (applyRecoilDamage), Life Orb or Shell Bell (onAfterMoveSecondarySelf) and Steel Beam's family, with the
   * ability and item the use left it (`after`, afterMove). Its HP berry is eaten at the Updates after the hits
   * too (`berry`: the one it ate): its own, until the target's Pickpocket takes it after the hits; one Thief or
   * Covet took in the hit, from that hit's Update on; one Magician took (in `final`, the state the use leaves),
   * at the last Update only. All of them act on a use that knocks out too. At most 0 once it faints (nothing
   * heals it then). `healed` is the damage Shell Bell heals from, when a bound takes a lower one than recoil's.
   */
  private attackerAfterUse(prev: State, result: Result, dealt: number, end: HitState, healed = dealt, after = prev, final = after): { hp: number; berry: string | null } {
    const { m } = this;
    const att = prev.att;
    const own = this.attackerBerry(prev);
    let eaten: string | null = own && !end.attackerItem ? att.itemId : null;
    let hp = end.hp;
    // The target's Berry it ate in a hit (Bug Bite, Pluck): its heal and Cheek Pouch's, which the hits already hold.
    if (end.stolen && this.turnAttackerAte) {
      if (end.stolen.heal) noteRange(this.turnAttackerAte, end.stolen.item, end.stolen.heal);
      if (end.stolen.pouch) this.noteAttackerHeal("Cheek Pouch", end.stolen.pouch);
    }
    if (hp <= 0) return { hp, berry: eaten };
    let berry = eaten ? null : own ?? (!att.itemId && after.att.itemId ? this.attackerBerry(after) : null);
    // Each Update eats the berry at or under its line (none once eaten).
    const update = () => {
      if (berry && hp > 0 && hp <= berry.line) {
        eaten = own ? att.itemId : after.att.itemId;
        this.noteAttackerBerry(eaten, berry, hp);
        hp = eatBerry(berry, hp); berry = null;
      }
    };
    // The last hit's Update, for a berry Thief or Covet took in it.
    update();
    const { recoil, rest } = this.afterHitsLosses(after, result, dealt);
    hp -= recoil;
    update();
    // AfterMoveSecondary: the target's Pickpocket takes an uneaten berry.
    if (own && after.att.itemId !== att.itemId) berry = null;
    if (hp > 0) hp -= rest;
    if (hp > 0 && m.attItemOn && after.att.itemId === "shellbell" && !this.sheerForced(after, result)) {
      const bell = Math.min(att.maxHP, hp + Math.max(1, Math.floor(healed / 8)));
      this.noteAttackerHeal(m.runtime.itemsById.get("shellbell")?.name ?? "Shell Bell", bell - hp);
      hp = bell;
    }
    // The Update after the move, with what Magician took.
    if (!eaten && !att.itemId && !after.att.itemId && final.att.itemId) berry = this.attackerBerry(final);
    if (!eaten && berry && hp > 0 && hp <= berry.line) { this.noteAttackerBerry(final.att.itemId, berry, hp); hp = eatBerry(berry, hp); eaten = final.att.itemId; }
    return { hp, berry: eaten };
  }

  /** On a doubles turn's step that follows the attacker: `amount` HP it regained from `source` (turnStep's attackerHeals). */
  private noteAttackerHeal(source: string, amount: number) {
    if (this.turnAttackerHeals) noteRange(this.turnAttackerHeals, source, amount);
  }

  /** noteAttackerHeal for the attacker's HP berry `item` eaten at `hp`: eatBerry's two parts, the berry's heal, then Cheek Pouch's. */
  private noteAttackerBerry(item: string, berry: Berry, hp: number) {
    if (!this.turnAttackerHeals) return;
    const healed = berry.heal ? Math.min(berry.max, hp + berry.heal) : hp;
    this.noteAttackerHeal(this.m.runtime.itemsById.get(item)?.name ?? item, healed - hp);
    if (berry.pouch) this.noteAttackerHeal("Cheek Pouch", Math.min(berry.max, healed + berry.pouch) - healed);
  }

  /**
   * The attacker as its recoil, Life Orb and Shell Bell find it after a use's hits: with the ability and item
   * the use left it (Mummy's during the hit, Thief's and Covet's onAfterHit, the target's Pickpocket
   * onAfterMoveSecondary), but without an item Magician takes in the same onAfterMoveSecondarySelf.
   */
  private afterMove(prev: State, after: State): State {
    const moveId = this.input.move.id;
    const magician = moveId !== "covet" && moveId !== "thief" && !prev.att.itemId && !!after.att.itemId && this.ability(prev, "att") === "magician";
    return magician ? { ...after, att: { ...after.att, itemId: prev.att.itemId } } : after;
  }

  /** The attacker's HP lost after a use's hits: afterHitsLosses together. */
  private afterHitsLoss(state: State, result: Result, dealt: number): number {
    const { recoil, rest } = this.afterHitsLosses(state, result, dealt);
    return recoil + rest;
  }

  /**
   * The attacker's HP lost after a use's hits: recoil on what it dealt (none with Rock Head), then Life Orb
   * (none with Sheer Force on a move it boosts) and Steel Beam's family (not as a Max Move).
   */
  private afterHitsLosses(state: State, result: Result, dealt: number): { recoil: number; rest: number } {
    const attAbility = this.ability(state, "att");
    if (attAbility === "magicguard") return { recoil: 0, rest: 0 };
    const engineMove = result.move as Move & { recoil?: [number, number] };
    const recoil = engineMove.recoil && attAbility !== "rockhead" ? Math.max(1, Math.round(dealt * engineMove.recoil[0] / engineMove.recoil[1])) : 0;
    let rest = 0;
    if (SELF_COST_MOVES.has(this.input.move.id) && !engineMove.isMax) rest += Math.max(1, Math.round(state.att.maxHP / 2));
    if (this.m.attItemOn && state.att.itemId === "lifeorb" && !this.sheerForced(state, result)) rest += Math.max(1, Math.floor(state.att.baseMaxHP / 10));
    return { recoil, rest };
  }

  /** Sheer Force skips AfterMoveSecondarySelf (Life Orb, Shell Bell) after a move it boosts, with the attacker's ability as the hits left it (`state`). */
  private sheerForced(state: State, result: Result): boolean {
    return this.ability(state, "att") === "sheerforce" && !!result.move.secondaries;
  }

  /** A side's ability in this state, after Neutralizing Gas for the one it started with. */
  private ability(state: State, who: "att" | "def"): string {
    const side = state[who], build = who === "att" ? this.m.attacker : this.m.defender;
    return side.abilityId === build.abilityId ? (who === "att" ? this.m.attAbility : this.m.defAbility) : side.abilityId;
  }

  /** A side's types: its Tera type when Terastallized (not Stellar), else its species' types. */
  private types(state: State, who: "att" | "def"): readonly string[] {
    const build = who === "att" ? this.m.attacker : this.m.defender;
    const tera = build.mechanic === "tera" && build.configuration?.teraType && build.configuration.teraType !== "Stellar" ? [build.configuration.teraType] : null;
    return tera ?? this.m.runtime.speciesById.get(state[who].speciesId)?.types ?? [];
  }

  /** The status a use from `run` gives the target (Inferno, Mortal Spin, G-Max Malodor...): its own move's only once Dynamax ends; or null. */
  private statusAfterUse(state: State, run: Run): BattleStatus | null {
    return run.status && !state.def.status ? run.status : null;
  }

  private saltCures(state: State, run: Run): boolean {
    return this.input.move.id === "saltcure" && !run.trace.result!.move.isMax && !state.def.saltCure;
  }

  /** Whether Hydration cures a side's status at the end of this turn (pinned Showdown hydration: order 5.3, in rain unless it holds Utility Umbrella). */
  private hydrated(state: State, who: "att" | "def"): boolean {
    const side = state[who];
    if (!side.status || this.ability(state, who) !== "hydration") return false;
    const weather = this.endWeather(state);
    return (weather === "Rain" || weather === "Heavy Rain") && !((who === "att" ? this.m.attItemOn : this.m.defItemOn) && side.itemId === "utilityumbrella");
  }

  /** Whether a status lands on a side (pinned Showdown setStatus and the immunities the builds can show). */
  private canStatus(state: State, who: "att" | "def", status: BattleStatus, byFoe: boolean): boolean {
    const side = state[who];
    if (side.status) return false;
    const types = this.types(state, who);
    const ability = this.ability(state, who);
    if (ability === "comatose" || ability === "purifyingsalt" || (ability === "shieldsdown" && side.speciesId === "miniormeteor")) return false;
    if (state.conditions.terrain === "Misty" && this.grounded(state, who)) return false;
    if (ability === "leafguard" && ["Sun", "Harsh Sunshine"].includes(this.weather(state.conditions))) return false;
    if (status === "brn") return !types.includes("Fire") && !["waterveil", "waterbubble", "thermalexchange"].includes(ability);
    if (status === "psn" || status === "tox") {
      const corrosion = byFoe && this.ability(state, who === "att" ? "def" : "att") === "corrosion";
      return (corrosion || (!types.includes("Poison") && !types.includes("Steel"))) && !["immunity", "pastelveil"].includes(ability);
    }
    if (status === "par") return !types.includes("Electric") && ability !== "limber";
    return true;
  }

  /** Whether a side is on the ground for Grassy Terrain and Misty Terrain (pinned Showdown isGrounded: Gravity, Iron Ball, Smack Down, types, Levitate and Eelevate, Air Balloon). */
  private grounded(state: State, who: "att" | "def"): boolean {
    const side = state[who];
    const itemOn = who === "att" ? this.m.attItemOn : this.m.defItemOn;
    if (state.conditions.gravity || (itemOn && side.itemId === "ironball") || side.smackedDown) return true;
    const ability = this.ability(state, who);
    return !this.types(state, who).includes("Flying") && ability !== "levitate" && ability !== "eelevate" && !(itemOn && side.itemId === "airballoon");
  }

  /**
   * One side's end-of-turn HP changes in pinned Showdown's residual order (fieldEvent Residual): the weather
   * (order 1: sandstorm or hail, Rain Dish, Dry Skin, Ice Body, Solar Power) and its Update, Grassy Terrain
   * (5.2), Leftovers or Black Sludge (5.4), poison or bad poison (9, or Poison Heal) and burn (10) unless
   * Hydration cured them (5.3), Salt Cure (13), the foe's Bad Dreams (28.2) and Sticky Barb (28.3), then the
   * final Update. ops are HP changes and UPDATE where berries are checked, orders each one's residual order
   * (to set one side's end of turn against the other's); names are the effects, for the row's text. Magic
   * Guard stops every residual damage. On a charge turn (`charging`) the attacker can be semi-invulnerable:
   * no Grassy Terrain heal, and underground or underwater no sand or hail (pinned Showdown dig and dive onImmunity).
   */
  residuals(state: State, who: "att" | "def", charging = false): Residuals {
    const { m } = this;
    const side = state[who];
    const itemOn = who === "att" ? m.attItemOn : m.defItemOn;
    const ability = this.ability(state, who);
    const types = this.types(state, who);
    const guard = ability === "magicguard";
    const hidden = charging && who === "att" && SEMI_INVULNERABLE_MOVES.has(this.input.move.id);
    const sheltered = hidden && (this.input.move.id === "dig" || this.input.move.id === "dive");
    const part = (divisor: number) => Math.max(1, Math.floor(side.baseMaxHP / divisor));
    const ops: number[] = [], names: string[] = [], orders: number[] = [];
    const add = (op: number, name: string, order: number) => { ops.push(op); names.push(name); orders.push(order); };
    const weather = this.endWeather(state);
    if (weather) {
      const umbrella = itemOn && side.itemId === "utilityumbrella", goggles = itemOn && side.itemId === "safetygoggles";
      const sun = (weather === "Sun" || weather === "Harsh Sunshine") && !umbrella, rain = (weather === "Rain" || weather === "Heavy Rain") && !umbrella;
      if (weather === "Sand" && !types.some((type) => ["Rock", "Ground", "Steel"].includes(type)) && !["overcoat", "sandforce", "sandrush", "sandveil"].includes(ability) && !goggles && !guard && !sheltered) add(-part(16), "Sandstorm damages", 1);
      if (weather === "Hail" && !types.includes("Ice") && !["overcoat", "icebody", "snowcloak"].includes(ability) && !goggles && !guard && !sheltered) add(-part(16), "Hail damages", 1);
      if (ability === "icebody" && (weather === "Hail" || weather === "Snow")) add(part(16), "Ice Body heals", 1);
      if (ability === "raindish" && rain) add(part(16), "Rain Dish heals", 1);
      if (ability === "dryskin" && rain) add(part(8), "Dry Skin heals", 1);
      if ((ability === "dryskin" || ability === "solarpower") && sun && !guard) add(-part(8), `${ability === "dryskin" ? "Dry Skin" : "Solar Power"} hurts`, 1);
      if (ops.length) { ops.push(UPDATE); orders.push(1); }
    }
    if (state.conditions.terrain === "Grassy" && this.grounded(state, who) && !hidden) add(part(16), "Grassy Terrain heals", 5);
    if (itemOn && side.itemId === "leftovers") add(part(16), "Leftovers heals", 5);
    if (itemOn && side.itemId === "blacksludge") {
      if (types.includes("Poison")) add(part(16), "Black Sludge heals", 5); else if (!guard) add(-part(8), "Black Sludge hurts", 5);
    }
    const cured = this.hydrated(state, who);
    if ((side.status === "psn" || side.status === "tox") && !cured) {
      if (ability === "poisonheal") add(part(8), "Poison Heal heals", 9);
      else if (!guard) add(-(side.status === "psn" ? part(8) : part(16) * Math.min(15, side.toxic + 1)), side.status === "psn" ? "poison damages" : "bad poison damages", 9);
    }
    if (side.status === "brn" && !guard && !cured) add(-(ability === "heatproof" ? Math.max(1, Math.floor(part(16) / 2)) : part(16)), "its burn damages", 10);
    if (side.saltCure && !guard) {
      const resisted = types.includes("Water") || types.includes("Steel");
      add(-part(m.runtime.profile.id === "champions" ? (resisted ? 8 : 16) : (resisted ? 4 : 8)), "Salt Cure damages", 13);
    }
    if (this.ability(state, who === "att" ? "def" : "att") === "baddreams" && (side.status === "slp" || ability === "comatose") && !guard) add(-part(8), "Bad Dreams damages", 28);
    if (itemOn && side.itemId === "stickybarb" && !guard) add(-part(8), "Sticky Barb hurts", 28);
    if (ops.length && ops[ops.length - 1] !== UPDATE) { ops.push(UPDATE); orders.push(28); }
    return { ops, names, orders };
  }

  /** The weather in effect: none under Cloud Nine or Air Lock. */
  private weather(conditions: BattleConditions): BattleConditions["weather"] {
    return this.m.weatherSuppressed ? "" : conditions.weather;
  }

  /** The weather that acts at the end of this turn: none once a use's weather runs out (its duration ticks first). */
  private endWeather(state: State): BattleConditions["weather"] {
    return state.weatherTurns === 1 ? "" : this.weather(state.conditions);
  }

  /** The HP line of a form that follows HP at the end of the turn: true on its low side. */
  private formLine(side: Side): ((hp: number) => boolean) | null {
    if (side.abilityId === "shieldsdown" || side.abilityId === "zenmode") return (hp) => hp * 2 <= side.maxHP;
    if (side.abilityId === "schooling") return (hp) => hp * 4 <= side.maxHP;
    return null;
  }

  /** The form a Shields Down, Schooling or Zen Mode Pokémon takes on its side of the HP line, or null to keep it. */
  private formFor(side: Side, base: BattleBuild, low: boolean): string | null {
    if (side.abilityId === "zenmode") {
      if (!/^darmanitan(galar)?(zen)?$/.test(side.speciesId)) return null;
      const standard = side.speciesId.replace(/zen$/, "");
      return low ? `${standard}zen` : standard;
    }
    // A representative HP on that side of the line.
    const hp = low ? Math.max(1, Math.floor(side.maxHP / (side.abilityId === "schooling" ? 4 : 2))) : side.maxHP;
    return this.m.helpers.hpForm({ ...base, speciesId: side.speciesId, currentHP: hp * side.baseMaxHP / side.maxHP, abilityActive: false });
  }

  /**
   * The target's HP berry, when it can still eat it: the attacker's Unnerve or As One stops a Berry (not Berry
   * Juice, which is used, not eaten; pinned Showdown onFoeTryEatItem), unless the target's Mummy, Lingering
   * Aroma or Wandering Spirit has replaced it (`replaced`: at the Update after a contact hit, which it acted in).
   */
  private berryOf(state: State, replaced = false): string | null {
    const item = state.def.itemId;
    if (!item || !this.m.defItemOn || !(HEALING_BERRIES.has(item) || PINCH_STAT_BERRIES[item])) return null;
    return item === "berryjuice" || !this.targetUnnerved(state, replaced) ? item : null;
  }

  /**
   * Whether the target's Berries are stopped (pinned Showdown onFoeTryEatItem): by the attacker's Unnerve or As One,
   * unless the target's Mummy, Lingering Aroma or Wandering Spirit has replaced it (`replaced`: at an Update after a
   * contact hit), or in a doubles turn by another Pokémon's (UsesEnv.unnerve).
   */
  private targetUnnerved(state: State, replaced = false): boolean {
    const unnerve = this.m.unnerve;
    if (unnerve?.target) return true;
    if (unnerve?.foes === false || !UNNERVES.has(this.ability(state, "att"))) return false;
    return !(replaced && this.replacesAbility(state));
  }

  /**
   * The target's berry as arithmetic (pinned Showdown onUpdate, after a hit or at an end of turn): Sitrus,
   * Oran and Berry Juice at half HP or less, the Figy family and the stat berries at a quarter (half with
   * Gluttony), Enigma only after a super-effective hit; Ripen doubles the heal (onTryHeal chainModify(2))
   * and Cheek Pouch heals a third more. A move that takes the berry in the hit (takenInHit) does so before
   * the Update, so after a hit there is none.
   */
  private berry(state: State, afterHit: boolean, contact = false): Berry | null {
    const item = this.berryOf(state, afterHit && contact);
    if (!item || (afterHit && this.takenInHit(state, item))) return null;
    if (item === "enigmaberry" && !afterHit) return null;
    return this.berryFor(state, "def", item);
  }

  /**
   * Whether a use takes the target's Berry before the hit's Update: Bug Bite, Pluck and Incinerate in their
   * onHit (before Enigma Berry's own, in the target's Hit), Knock Off in its AfterHit, and Thief or Covet from
   * an attacker holding nothing; not their Max Moves, nor through Sticky Hold. Nor Bug Bite's, Pluck's and
   * Incinerate's Z-Moves (Savage Spin-Out, Supersonic Skystrike, Inferno Overdrive: no onHit of theirs).
   */
  private takenInHit(state: State, item: string): boolean {
    const moveId = this.input.move.id;
    if (maxActive(state.att) || (this.ability(state, "def") === "stickyhold" && !moldBreaks(this.m, state))) return false;
    if (BERRY_STEALERS.has(moveId)) return !this.result.move.isZ;
    return item !== "enigmaberry" && (moveId === "knockoff" || ((moveId === "thief" || moveId === "covet") && !state.att.itemId));
  }

  /** The berry the target can eat at a hit's Update from a node, memoised (`contact`: Mummy and its kin may have replaced the attacker's Unnerve by then). */
  private hitBerry(node: Node, contact: boolean): Berry | null {
    const cache = node.shared.hitBerries ??= [undefined, undefined];
    const at = contact ? 1 : 0;
    return cache[at] === undefined ? (cache[at] = this.berry(node.state, true, contact)) : cache[at];
  }

  /** A side's berry `item` as arithmetic (berry(); hit-loop.ts berryArithmetic). */
  private berryFor(state: State, who: "att" | "def", item: string): Berry {
    const { maxHP, baseMaxHP } = state[who];
    return berryArithmetic(item, { maxHP, baseMaxHP, ability: this.ability(state, who) }, this.m.runtime.profile.generation);
  }

  /**
   * The attacker's own HP or pinch berry while it can eat it (pinned Showdown onUpdate, as the target's): the
   * target's Unnerve or As One stops a Berry (not Berry Juice, which is used, not eaten). Enigma Berry acts
   * only when the holder is hit.
   */
  private attackerBerry(state: State): Berry | null {
    const item = state.att.itemId;
    if (!item || !this.m.attItemOn || item === "enigmaberry" || !(HEALING_BERRIES.has(item) || PINCH_STAT_BERRIES[item])) return null;
    if (item !== "berryjuice" && berryUnnerved(this.m.unnerve, "attacker", this.ability(state, "def"))) return null;
    return this.berryFor(state, "att", item);
  }

  /** The state side of the attacker's eaten berry: gone, and a pinch berry's stage. */
  private attackerAte(state: State, item: string) {
    if (PINCH_STAT_BERRIES[item]) boost(this.m, state, "att", { [PINCH_STAT_BERRIES[item]]: this.ability(state, "att") === "ripen" ? 2 : 1 }, false);
    state.att.itemId = "";
  }

  /**
   * The state side of the target's Berry that Bug Bite or Pluck made its user eat (hit-loop.ts stolenEat; its HP is the
   * hits'): its stages through boost() (Contrary, Simple, the ±6 cap, the target's Opportunist copying a rise), the status
   * it cures, a Lansat Berry's focusenergy, and a Starf Berry's stat chosen at random, which the search does not follow.
   */
  private ateStolen(state: State, eat: StolenEat) {
    if (Object.keys(eat.stages).length) boost(this.m, state, "att", eat.stages, false);
    if (state.att.status && eat.cures.includes(state.att.status)) { state.att.status = ""; state.att.toxic = 0; }
    if (eat.focusEnergy) state.att.focusEnergy = true;
    if (eat.starf) { this.stop ??= STARF_REASON; this.exceeded = true; }
  }

  /** The state side of an eaten berry: gone, and a pinch berry's stage (`inMove`: at a hit's Update, during the attacker's move). */
  private eaten(state: State, item: string, inMove = false) {
    if (PINCH_STAT_BERRIES[item]) boost(this.m, state, "def", { [PINCH_STAT_BERRIES[item]]: this.ability(state, "def") === "ripen" ? 2 : 1 }, false, inMove);
    state.def.itemId = "";
  }

  /**
   * Whether a use from this state needs a charge turn first: sun skips Solar Beam's and Solar Blade's, and a
   * Mega Sol user's moves are always in sun (pinned Showdown effectiveWeather, before Utility Umbrella),
   * rain Electro Shot's, and Power Herb any one unless ignored; a Max Move never charges.
   */
  private charges(state: State, ignoreHerb = false): boolean {
    const id = this.input.move.id;
    if (!CHARGE_MOVES.has(id) || maxActive(state.att)) return false;
    const solar = id === "solarbeam" || id === "solarblade";
    if (solar && this.ability(state, "att") === "megasol") return false;
    const weather = this.weather(state.conditions);
    const umbrella = this.m.attItemOn && state.att.itemId === "utilityumbrella";
    if (solar && (weather === "Sun" || weather === "Harsh Sunshine") && !umbrella) return false;
    if (id === "electroshot" && (weather === "Rain" || weather === "Heavy Rain") && !umbrella) return false;
    return ignoreHerb || !(this.m.attItemOn && state.att.itemId === "powerherb");
  }

  /**
   * Whether a use is followed by a turn that is not a use: a recharge or another move between Gigaton Hammer
   * uses (not after a Max Move), or a Truant loaf (Max Moves too: pinned Showdown truant onBeforeMove).
   */
  private afterTurns(state: State): boolean {
    const id = this.input.move.id;
    return (!maxActive(state.att) && (RECHARGE_MOVES.has(id) || NOT_TWICE_MOVES.has(id))) || this.ability(state, "att") === "truant";
  }

  /**
   * Metronome's numConsecutive for the next attack (pinned Showdown metronome condition onTryMove): one more
   * after a successful use last turn, else 0; on a charged use's attack turn, one more after any earlier use
   * of the move, else 1.
   */
  private metronomeCount(state: State): number {
    if (state.charged) return state.streak ? Math.min(5, state.consecutive + 1) : 1;
    return state.streak === 2 ? Math.min(5, state.consecutive + 1) : 0;
  }

  private metronome(state: State): number {
    return state.att.itemId === "metronome" && this.m.attItemOn ? this.metronomeCount(state) : 0;
  }

  /** What one use's damage reads beyond the target's HP, for sharing calculations between states. */
  private damageRest(node: Node): string {
    if (node.rest !== undefined) return node.rest;
    const { state } = node;
    const { att, def } = state;
    if (USES_REFERENCE.on) return node.rest = `${att.hp}|${JSON.stringify(state)}`;
    const itemKey = (itemId: string) => ITEM_MOVES.has(this.input.move.id) || (itemId && !this.neutral(itemId)) ? itemId : "~";
    let rest = `${hpKey(this.hpModes.att, att.hp, att.maxHP)}|${itemKey(def.itemId)}|${itemKey(att.itemId)}|${def.abilityId}|${att.abilityId}|${def.speciesId}|${att.speciesId}`
      + `|${def.mechanic ?? ""}|${att.mechanic ?? ""}|${att.status}|${def.status}|${att.slowStart !== null}|${att.focusEnergy}|${state.fieldKey}|${this.metronome(state)}|${(!!this.input.context?.stellarFirstUse || this.firstTurn) && state.first}`;
    for (const stat of this.relevance.att) rest += `|${att.boosts[stat]}`;
    for (const stat of this.relevance.def) rest += `|${def.boosts[stat]}`;
    // Unburden's doubled Speed.
    if (this.relevance.att.includes("spe")) rest += `|${unburdened(att)},${unburdened(def)}`;
    // The attacker's modes when they change within a use.
    if (this.midMoves) rest += `|${this.midKeyOf(node)}`;
    return node.rest = rest;
  }

  /** A state's key: everything in it but the target's HP and the attacker's HP (node() puts the attacker's in front when it is followed). */
  private restKey(state: State): string {
    const { att, def } = state;
    const side = (s: Side) => `${s.maxHP}|${s.itemId}|${s.boosts.atk},${s.boosts.def},${s.boosts.spa},${s.boosts.spd},${s.boosts.spe}|${s.abilityId}|${s.speciesId}|${s.status}|${s.mechanic ?? ""}|${s.dynamaxTurns}|${s.toxic}|${s.slowStart}|${s.saltCure}|${s.smackedDown}|${s.unburden}|${s.focusEnergy}`;
    const counter = att.itemId === "metronome" && this.m.attItemOn ? `${state.consecutive},${state.streak},${state.charged}` : "";
    return `|${side(att)}|${side(def)}|${state.fieldKey}|${state.weatherTurns},${state.terrainTurns}|${state.first}|${counter}`;
  }

  /** The run for a use from a node's state in HP part `code` (at the target's HP `hp`): memoised, or a rerun within the budget. */
  private runAt(node: Node, code: number, hp: number, mode: Mode): Run | null {
    const known = node.runs.get(code);
    if (known) return known;
    const key = `${code}|${this.damageRest(node)}`;
    const shared = this.runs.get(key);
    if (shared) { node.runs.set(code, shared); return shared; }
    if (mode === "all" && ++this.reruns > (this.turnMode ? TURN_RUN_BUDGET : RUN_BUDGET) && !USES_REFERENCE.on) { this.exceeded = true; return null; }
    const { state } = node;
    const def = { ...state.def, hp };
    this.download ??= this.m.attacker.abilityId === "download" && !this.m.attacker.settledDownload && this.m.attAbility === "download"
      ? (["atk", "spa"] as const).find((stat) => this.result.attacker.boosts[stat] > clamp(this.m.attacker.boosts[stat] ?? 0)) ?? null : null;
    const anchorKey = USES_REFERENCE.on ? "" : this.anchorKey(state);
    // An engine-only rerun gives every hit the first hit's damage: a use whose later hits differ (midKey) is calculated whole.
    // A doubles turn shows the rows it meets, so each is a full calculation (no engine-only rerun).
    const anchor = this.turnMode || this.midKeyOf(node) ? undefined : this.anchors.get(anchorKey);

    const run = anchor ? this.engineRun(state, def, anchor) : this.input.rerun({
      attacker: toBuild(this.m.attacker, state.att, this.download, state.att.slowStart !== null, state.first), defender: toBuild(this.m.defender, def, null, this.m.defender.abilityActive, state.first),
      conditions: state.conditions, context: state.first ? this.input.context : { ...this.input.context, stellarFirstUse: false },
      consecutive: this.metronome(state),
    });

    if (run.row.kind !== "calculated" || run.row.max === null || !run.trace.result) {
      // A doubles turn's step reports the calculation's own reason (a hit an intact Disguise takes, a needed count...).
      if (this.turnMode) this.turnFailure ??= run.row.reason;
      if (mode === "all") this.exceeded = true;
      else this.stop ??= "A later use cannot be calculated";
      return null;
    }
    // A full calculation whose engine inputs survived it serves the later states it differs from only in what an engine-only rerun sets.
    if (!anchor && anchorKey && run.trace.engine) this.anchors.set(anchorKey, { state: { ...state, def }, engine: run.trace.engine, row: run.row });
    const prepared = this.prepare(run, state);
    this.runs.set(key, prepared);
    node.runs.set(code, prepared);
    return prepared;
  }

  /**
   * What an engine-only rerun of a calculation cannot change: what calculateMove reads before or after its
   * engine call (the field, abilities, forms, Dynamax, statuses, Slow Start, Stellar's first use, Speed for
   * a turn-order or Speed-based move, the attacker's full HP for Gale Wings). States with the same key differ
   * only in what the rerun sets (HP, stat stages, items, Metronome's count).
   */
  private anchorKey(state: State): string {
    const side = (who: "att" | "def") => {
      const { abilityId, speciesId, mechanic, status, boosts } = state[who];
      return `${abilityId},${speciesId},${mechanic},${status},${this.relevance[who].includes("spe") ? `${boosts.spe}${unburdened(state[who]) ? "U" : ""}` : ""}`;
    };
    const stellar = !state.first && !!this.input.context?.stellarFirstUse;
    return `${state.fieldKey}|${side("att")}|${side("def")}|${state.att.slowStart}|${state.att.focusEnergy}|${stellar}|${this.hpModes.att.full ? state.att.hp : ""}|${this.firstTurn && state.first}`;
  }

  /**
   * A calculation's per-hit rolls for each of its cases, for a use from `state`. The hits are every hit the
   * engine dealt (its result keeps them; the row stops at the hit the attacker faints on from the HP it was
   * calculated at, and each use walks its own in hits()), and a random hit count is a case for each count with
   * its chance (randomCounts), each the first hits of the longest.
   */
  private prepare(run: { row: MoveDamageResult; trace: CalcTrace }, state: State): Run {
    const { row, trace } = run;
    const result = trace.result!;
    const dealt = result.damage;
    const lists = (rolls: MoveDamageResult["rolls"]): number[][] => rolls === null ? [[0]]
      : typeof rolls === "number" ? Array.from({ length: Math.max(1, row.hits ?? 1) }, () => [rolls])
        : Array.isArray(rolls[0]) ? rolls as number[][] : [rolls as number[]];
    const engineMove = result.move;
    const reaches = !result.attacker.hasAbility("Long Reach") && !result.attacker.hasItem("Protective Pads");
    const contact = !!engineMove.flags?.contact && reaches && !(result.attacker.hasItem("Punching Glove") && !!engineMove.flags?.punch);
    const physical = engineMove.category === "Physical";
    const total = (hits: HitRolls[], pick: "min" | "max") => hits.reduce((sum, hit) => sum + hit[pick], 0);
    const usual = (Array.isArray(dealt) && Array.isArray(dealt[0]) ? dealt as number[][] : lists(row.rolls)).map(distinctRolls);
    const counts = this.randomCounts(state, engineMove);
    if (counts && counts[counts.length - 1].hits !== usual.length) throw new Error("The engine dealt another hit count");
    const usualChance = row.alternate ? 1 - row.alternate.chance : 1;
    const cases: UseCase[] = counts
      ? counts.map(({ hits, chance }) => {
        const part = usual.slice(0, hits);
        return { chance: usualChance * chance, hits: part, contact, physical, min: total(part, "min"), max: total(part, "max"), random: true as const };
      })
      : [{ chance: usualChance, hits: usual, contact, physical, min: total(usual, "min"), max: total(usual, "max") }];
    if (row.alternate) {
      const hits = [distinctRolls(row.alternate.rolls)];
      const alternatePhysical = row.alternate.label.includes("physical");
      cases.push({ chance: row.alternate.chance, hits, contact: alternatePhysical ? reaches : contact, physical: alternatePhysical || physical, min: total(hits, "min"), max: total(hits, "max") });
    }
    const superEffective = ["enigmaberry", "weaknesspolicy"].includes(this.m.defenderItem) && effectiveness(this.m.gen, result) > 1;
    const { defenderItem, attackerItem } = result.rawDesc;
    const entry = STATUS_MOVES[id(engineMove.name)] ?? (engineMove.isMax ? undefined : STATUS_MOVES[this.input.move.id]);
    return {
      row, trace, cases, superEffective, resistBerry: defenderItem && getBerryResistType(defenderItem) ? id(defenderItem) : "",
      gem: attackerItem?.endsWith(" Gem") ? id(attackerItem) : "", status: entry?.status ?? null, statusSecondary: !!entry?.secondary,
    };
  }

  /**
   * The damage at `state` from an engine call on `anchor`'s inputs, with the HP, stages, items and Metronome's
   * count set to the state's. It is calculate() without its clones: each call copies the inputs and sets what
   * the state changes as their constructors would. calculateMove sets only fields the constructors copy as
   * they are (an ability, an item, abilityOn, a move's hits and target, its clone's wrappers), so a copy of an
   * input is its clone.
   */
  private engineRun(state: State, def: Side, anchor: Anchor): { row: MoveDamageResult; trace: CalcTrace } {
    const { m } = this;
    const download = this.download ?? null;
    const { engine } = anchor;
    const fresh = engine;
    const set = (from: Pokemon, side: Side, start: Side, pinned: CombatStat | null, target: boolean): Pokemon => {
      const pokemon = copyPokemon(from);
      const ratio = side.maxHP / side.baseMaxHP;
      const curHP = ratio !== 1 ? (side.hp + 0.5) / ratio : side.hp;
      pokemon.originalCurHP = curHP && curHP <= pokemon.rawStats.hp ? curHP : pokemon.rawStats.hp;
      for (const stat of STATS) pokemon.boosts[stat] = clamp(side.boosts[stat] + (stat === pinned ? 1 : 0));
      // Download's and the other entry rises are in the stages (entryStages); Run Away changes no damage. A
      // target's Wind Rider still takes a wind move.
      const ability = pokemon.ability ? id(pokemon.ability) : "";
      if (pinned || (ENTRY_ABILITIES[ability] && !(target && ability === "windrider" && fresh.move.flags?.wind))) pokemon.ability = "Run Away" as never;
      // Keep the calculation's own stand-in item (Leftovers for an inert Seed) until the item changes.
      if (side.itemId !== start.itemId) pokemon.item = side.itemId ? m.runtime.itemsById.get(side.itemId)?.name as ItemName : undefined;
      if (side.status !== start.status) pokemon.status = side.status || "";
      if (ability === "unburden") pokemon.abilityOn = unburdened(side);
      return pokemon;
    };
    const attacker = set(fresh.attacker, state.att, anchor.state.att, download, false), defender = set(fresh.defender, def, anchor.state.def, null, true);
    // The calculation sets the move's own fields and its contact flag (Punching Glove, Shell Side Arm).
    const move = Object.assign(Object.create(Object.getPrototypeOf(fresh.move)), fresh.move) as Move;
    move.flags = { ...fresh.move.flags };
    // The Move constructor keeps Metronome's count off a Z-Move.
    if (!move.isZ) move.timesUsedWithMetronome = this.metronome(state);
    // makeField makes a new Field, which calculate() would only clone again.
    const result: Result = (m.gen.num === 0 ? calculateChampions : calculateSMSSSV)(m.gen, attacker, defender, move, m.helpers.makeField(state.conditions));
    const [min, max] = result.range();
    const damage = result.damage;
    const rolls = typeof damage === "number" ? damage : Array.isArray(damage[0]) ? (damage as number[][]).map((hit) => [...hit]) : [...(damage as number[])];
    // What a later use reads of a row (prepare, runAt, terms, hits).
    const row = { kind: "calculated", min, max, rolls, hits: anchor.row.hits, leavesOneHP: anchor.row.leavesOneHP } as MoveDamageResult;
    return { row, trace: { result, engine } };
  }
}

/** Notes `amount` HP regained from `source` into its least and most (none for no HP). */
function noteRange(heals: Map<string, [number, number]>, source: string, amount: number) {
  if (amount <= 0) return;
  const known = heals.get(source);
  if (!known) heals.set(source, [amount, amount]);
  else { if (amount < known[0]) known[0] = amount; if (amount > known[1]) known[1] = amount; }
}

/** A doubles turn's reason when a step passes its budget. */
export const TURN_TOO_MANY = "Too many cases to follow.";
/** One Pokémon's side of a turn's step (the search's Side): HP, item, stages, ability, form, status and their counters. */
export type TurnSide = Side;
/** One entry of a turn's step: the attacker's HP (read when followed) and the mass on each target HP (engine HP). */
export type TurnStepEntry = { attackerHP: number; target: Map<number, number> };
/** One outcome of a turn's step; attacker.hp is meaningful only when the step follows the attacker's HP. */
export type TurnStepOutcome = {
  attacker: TurnSide; attackerFainted: boolean;
  target: TurnSide; knocked: boolean;
  conditions: BattleConditions; landed: number;
  dist: Map<number, number>;
};
export type TurnStepResult = {
  outcomes: TurnStepOutcome[]; heals: Map<string, [number, number]>; rows: Map<MoveDamageResult, number>;
  /** What a followed attacker regained (its HP Berry, Shell Bell, Cheek Pouch), the least and the most from each source. */
  attackerHeals: Map<string, [number, number]>;
  /** What the target's Berry a followed attacker ate with Bug Bite or Pluck healed, the least and the most, by the Berry's id. */
  attackerAte: Map<string, [number, number]>;
} | { failed: string };
export type { Mode };

/**
 * A doubles turn's search for one row (prepareUses with UsesEnv.turn): its steps follow the attacker's HP when
 * needsAttackerHP, unless `follow` is false (a spread move's target steps, whose attacker HP the turn changes once).
 */
export function createTurnSearch(m: UsesMatchup, row: UsesRow, follow?: false): UsesSearch {
  if (!m.turn || !row.trace.result) throw new Error("A turn search needs a turn matchup and a calculated row.");
  const search = new UsesSearch(m, row, row.trace.result);
  search.followAttacker(follow ?? search.needsAttackerHP());
  return search;
}

export { uncertain, boost, toBuild as buildAt };

/**
 * The stages the engine adds on every calculation for entry effects it models (UsesSearch.entryStages), for a build
 * whose ability in effect is `ability` (after Neutralizing Gas) and whose item works (`itemOn`): a terrain Seed used
 * on entry (`seed`), Dauntless Shield and Intrepid Sword (Sword/Shield, or while active), Embody Aspect
 * (Scarlet/Violet), Wind Rider in its side's Tailwind.
 */
export function entryStagesOf(build: BattleBuild, ability: string, itemOn: boolean, terrain: BattleConditions["terrain"], tailwind: boolean, runtime: BattleRuntime): { stages: Partial<Record<CombatStat, number>>; seed: boolean } {
  const stages: Partial<Stages> = {};
  const seed = SEEDS[build.itemId];
  const used = !!seed && seed.terrain === terrain && itemOn && build.itemUsedBeforeRoom !== false;
  if (used) stages[seed.stat] = (ability === "contrary" ? -1 : 1) * (ability === "simple" ? 2 : 1);
  const game = runtime.profile.id;
  const stat = game === "champions" ? undefined : ENTRY_ABILITIES[ability];
  const on = ability === "windrider" ? tailwind : ability.startsWith("embodyaspect") ? game === "scarlet_violet" : game === "sword_shield" || build.abilityActive;
  if (stat && on) stages[stat] = (stages[stat] ?? 0) + 1;
  return { stages, seed: used };
}

/** The end-of-turn effects as sentences (a status's own name is lowercase, so only the first is capitalised). */
function texts(residuals: { att: Residuals; def: Residuals }): string[] {
  const out: string[] = [];
  for (const who of ["def", "att"] as const) {
    if (!residuals[who].names.length) continue;
    const joined = joinResiduals(residuals[who].names);
    out.push(`${joined[0].toUpperCase()}${joined.slice(1)} ${who === "def" ? "the target" : "the attacker"} at the end of each turn.`);
  }
  return out;
}

/** "Grassy Terrain heals" and "Leftovers heals" as "Grassy Terrain and Leftovers heal"; a list with different verbs stays as it is. */
function joinResiduals(names: string[]): string {
  const verbs = names.map((name) => name.slice(name.lastIndexOf(" ") + 1));
  if (names.length < 2 || verbs.some((verb) => verb !== verbs[0])) return listNames(names);
  return `${listNames(names.map((name) => name.slice(0, name.lastIndexOf(" "))))} ${verbs[0].replace(/s$/, "")}`;
}

/**
 * Whether the target's Mummy, Lingering Aroma or Wandering Spirit replaces the attacker's ability on a contact
 * hit, as hit-loop.ts hitStep does (pinned Showdown setAbility and skillSwap): not a cantsuppress ability nor
 * its own, nor past the attacker's working Ability Shield; Wandering Spirit fails with a failskillswap ability
 * on either side, the target's Ability Shield or Dynamax.
 */
function replacesAbility(own: string, replacer: string, ownShielded: boolean, replacerShielded: boolean, replacerDynamaxed: boolean): boolean {
  if (!ABILITY_REPLACERS.has(replacer) || ownShielded) return false;
  if (replacer === "wanderingspirit") return !FAIL_SKILL_SWAP.has(own) && !FAIL_SKILL_SWAP.has(replacer) && !replacerShielded && !replacerDynamaxed;
  return !CANT_SUPPRESS.has(own) && own !== replacer;
}

/** What a hit loop reads but the attacker's HP, as a key. */
function loopKey(loop: HitLoopInput): string {
  return `${loop.maxHP},${loop.baseMaxHP}|${loop.attackerAbility}|${loop.attackerItem}|${loop.targetAbility}|${loop.targetItem}|${loop.attackerShielded},${loop.targetShielded},${loop.targetDynamaxed}`
    + `|${loop.contact},${loop.category},${loop.drain},${loop.takesBerry},${loop.targetGulping}`;
}

/** The closed form's end of turn (a heal or a fixed damage per turn) and the lowest and highest damage of a use. */
type Terms = { heal: number; chip: number; lowest: number; highest: number };

/** The uses an every-use damage d needs from `hp`: hp - k d + (k - 1) h <= 0 with a heal h, or hp <= k (d + c) with a damage c. */
function usesFrom(hp: number, damage: number, { heal, chip }: Terms): number | null {
  if (damage <= 0) return null;
  if (!heal) return Math.ceil(hp / (damage + chip));
  if (hp <= damage) return 1;
  return damage > heal ? 1 + Math.ceil((hp - damage) / (damage - heal)) : null;
}

/**
 * Whether some sequence of the closed form's uses from an HP x in `hps` is out at an end of turn rather than
 * by a use's hits, within `steps` uses: after n uses the sum S_n is still below x - (n - 1)c (in after the
 * hits) but reaches x - (n - 1)c - c (out after that turn's damage c, or c' on use `last`). A sequence out
 * earlier has S_n above that window, so the sums are tracked only below the highest HP.
 */
function turnKnocks(hps: number[], values: number[], chip: number, steps: number, last = Infinity, lastChip = chip): boolean {
  if (!chip || !hps.length) return false;
  const top = Math.max(...hps), words = (top + 31) >>> 5;
  // The sums n uses can reach below the highest HP, as bits: this use's and the next's.
  let sums = new Uint32Array(words), next = new Uint32Array(words);
  sums[0] = 1;
  const reached = (from: number, to: number) => {
    for (let bit = from; bit < to;) {
      const offset = bit & 31, span = Math.min(32 - offset, to - bit);
      if (next[bit >>> 5] & (span === 32 ? -1 : ((1 << span) - 1) << offset)) return true;
      bit += span;
    }
    return false;
  };
  for (let n = 1; n <= steps; n++) {
    next.fill(0);
    for (const value of values) {
      const shift = value >>> 5, bits = value & 31;
      for (let word = 0; word + shift < words; word++) {
        const set = sums[word];
        if (!set) continue;
        next[word + shift] |= set << bits;
        if (bits && word + shift + 1 < words) next[word + shift + 1] |= set >>> (32 - bits);
      }
    }
    if (top & 31) next[words - 1] &= (1 << (top & 31)) - 1;
    if (next.every((set) => !set)) return false;
    const turn = n === last ? lastChip : chip;
    for (const hp of hps) {
      const left = hp - (n - 1) * chip;
      if (reached(Math.max(0, left - turn), Math.min(top, left))) return true;
    }
    [sums, next] = [next, sums];
  }
  return false;
}

/** Endeavor's damage from the target's HP `hp` (pinned Showdown: its HP scaled back from Dynamax minus the user's, at least 1; it fails unless the user's HP is lower). */
function endeavorDamage(hp: number, state: State): number {
  if (state.att.hp >= hp) return 0;
  const damage = Math.ceil(hp * state.def.baseMaxHP / state.def.maxHP) - state.att.hp;
  return damage === 0 ? 0 : Math.max(1, damage);
}

/**
 * The mass `dist` loses within `steps` more uses of one damage distribution and the closed form's end of
 * turn (consumes `dist`): from HP x the target is out within j uses exactly when S_j reaches x + (j - 1)h,
 * or x - (j - 1)c - c' with c' the last end of turn's damage (c unless the attacker faints first), so the
 * sum of j uses is convolved once and read at each HP.
 */
function evolve(dist: Dist, values: number[], weights: number[], { heal, chip }: Terms, steps: number, lastChip = chip): number {
  let low = Infinity, high = 0;
  for (const value of values) { if (value < low) low = value; if (value > high) high = value; }
  // sums[t - steps * low] = P(S_steps = t), over the buffers' first `length` entries.
  const spread = high - low;
  let [sums, next] = sumBuffers(steps * spread + 2);
  sums[0] = 1;
  let length = 1;
  for (let step = 1; step <= steps; step++) {
    const size = step * spread + 1;
    next.fill(0, 0, size);
    for (let at = 0; at < length; at++) {
      const mass = sums[at];
      if (!mass) continue;
      for (let roll = 0; roll < values.length; roll++) next[at + values[roll] - low] += mass * weights[roll];
    }
    [sums, next] = [next, sums];
    length = size;
  }
  // tail[i] = P(S_steps >= steps * low + i), into the other buffer.
  const tail = next;
  tail[length] = 0;
  for (let at = length - 1; at >= 0; at--) tail[at] = tail[at + 1] + sums[at];
  let gone = 0;
  for (let index = 0; index < dist.size; index++) {
    const hp = dist.hp[index];
    const needs = (heal ? hp + (steps - 1) * heal : hp - (steps - 1) * chip - lastChip) - steps * low;
    gone += dist.p[hp] * (needs <= 0 ? 1 : needs >= length + 1 ? 0 : tail[needs]);
  }
  sums.fill(0, 0, length);
  tail.fill(0, 0, length + 1);
  dist.release();
  return gone;
}

/** A hit's distinct rolls in the order they first appear, each with its share (the engine's rolls rise, so in a run). */
function distinctRolls(rolls: number[]): HitRolls {
  const values: number[] = [], counts: number[] = [];
  let min = rolls[0], max = rolls[0], last = NaN;
  for (const roll of rolls) {
    if (roll === last) { counts[counts.length - 1]++; continue; }
    const at = values.indexOf(roll);
    if (at >= 0) counts[at]++; else { values.push(roll); counts.push(1); }
    last = roll;
    if (roll < min) min = roll;
    if (roll > max) max = roll;
  }
  return { values, weights: counts.map((count) => count / rolls.length), min, max };
}

/** One use's total damage distribution: each case's hits summed, the cases weighed by their chances. */
function perUseDamage(cases: UseCase[]): { values: number[]; weights: number[] } {
  if (cases.length === 1 && cases[0].hits.length === 1) return cases[0].hits[0];
  const total = new Map<number, number>();
  for (const useCase of cases) {
    let sums = new Map([[0, useCase.chance]]);
    for (const hit of useCase.hits) {
      const next = new Map<number, number>();
      for (const [sum, mass] of sums) for (let index = 0; index < hit.values.length; index++) next.set(sum + hit.values[index], (next.get(sum + hit.values[index]) ?? 0) + mass * hit.weights[index]);
      sums = next;
    }
    for (const [sum, mass] of sums) total.set(sum, (total.get(sum) ?? 0) + mass);
  }
  return { values: [...total.keys()], weights: [...total.values()] };
}

/** A copy of `dist` with its mass scaled, and every HP healed by `heal` up to `cap`. */
function scaled(dist: Dist, factor: number, max: number, heal = 0, cap = max): Dist {
  const copy = borrow(max);
  for (let index = 0; index < dist.size; index++) {
    const hp = dist.hp[index];
    copy.add(heal ? Math.min(cap, hp + heal) : hp, dist.p[hp] * factor);
  }
  return copy;
}

/** A build's stages with the entry rises added, clamped. */
function stagesOf(boosts: BattleBuild["boosts"], entry: Partial<Stages>): Stages {
  const at = (stat: CombatStat) => clamp((boosts[stat] ?? 0) + (entry[stat] ?? 0));
  return { atk: at("atk"), def: at("def"), spa: at("spa"), spd: at("spd"), spe: at("spe") };
}

/**
 * A copy of an engine Pokémon the calculation can change (its stages, stats and raw stats), sharing the rest,
 * which it only reads; a clone of it (Parental Bond's child) copies it again rather than its source.
 */
function copyPokemon(pokemon: Pokemon): Pokemon {
  const copy = Object.assign(Object.create(Object.getPrototypeOf(pokemon)), pokemon) as Pokemon;
  copy.boosts = { ...pokemon.boosts };
  copy.stats = { ...pokemon.stats };
  copy.rawStats = { ...pokemon.rawStats };
  if (Object.prototype.hasOwnProperty.call(pokemon, "clone")) copy.clone = () => copyPokemon(copy);
  return copy;
}

const sameBoosts = (a: Stages, b: Stages) => a.atk === b.atk && a.def === b.def && a.spa === b.spa && a.spd === b.spd && a.spe === b.spe;
/** Two sides agree in everything but HP (what a node key reads of a side). */
const sameSide = (a: Side, b: Side) => a.maxHP === b.maxHP && a.itemId === b.itemId && sameBoosts(a.boosts, b.boosts) && a.abilityId === b.abilityId
  && a.speciesId === b.speciesId && a.status === b.status && a.mechanic === b.mechanic && a.dynamaxTurns === b.dynamaxTurns && a.toxic === b.toxic
  && a.slowStart === b.slowStart && a.saltCure === b.saltCure && a.smackedDown === b.smackedDown && a.unburden === b.unburden && a.focusEnergy === b.focusEnergy;

function cloneState(state: State): State {
  return { ...state, att: { ...state.att, boosts: { ...state.att.boosts } }, def: { ...state.def, boosts: { ...state.def.boosts } } };
}

/**
 * What can change this row's damage between uses, as sentences, from the first use's state (`initial`: a Seed
 * used on entry is gone and the entry rises are in its stages). Empty means the same damage every use, so each
 * sentence holds only where afterHit acts: not a secondary Sheer Force removes or Shield Dust and Covert Cloak
 * stop, nor a drop Clear Amulet or a stat guard blocks (the target's breakable abilities count for nothing
 * through Mold Breaker, unless an Ability Shield), nor an item that is taken first or cannot be taken. A
 * Dynamaxed attacker's row is its Max Move: what the row's own move does then starts once Dynamax ends.
 */
function changeSources(m: UsesMatchup, { move, row, context, trace }: UsesRow, result: Result, hp: { att: HPModes; def: HPModes },
  relevance: { att: CombatStat[]; def: CombatStat[] }, attackerResiduals: boolean, initial: State, gorgingParalyses = false): string[] {
  const { attacker, defender, conditions, runtime, attAbility, defAbility } = m;
  const sources: string[] = [];
  const add = (text: string) => sources.push(text);
  const engineMove = result.move;
  const maxed = !!engineMove.isMax;
  const own = (text: string) => add(maxed ? `After Dynamax ends, ${text.replace(/^The /, "the ")}` : text);
  const relevant = (stages: StageChanges | undefined, who: "att" | "def") => !!stages && (Object.keys(stages) as CombatStat[]).some((stat) => relevance[who].includes(stat));
  const changed = (stages: StageChanges, who: "att" | "def") => listNames((Object.keys(stages) as CombatStat[]).filter((stat) => relevance[who].includes(stat)).map((stat) => STAT_LABELS[stat]));
  const direction = (stages: StageChanges, ability: string) => Object.values(stages).some((amount) => amount! > 0) !== (ability === "contrary") ? "raises" : "lowers";
  const type = engineMove.type, physical = engineMove.category === "Physical";
  const contact = !!engineMove.flags?.contact && !result.attacker.hasAbility("Long Reach") && !result.attacker.hasItem("Protective Pads");
  const abilityName = (id: string) => runtime.abilitiesById.get(id)?.name ?? id;
  const itemName = (id: string) => runtime.itemsById.get(id)?.name ?? id;
  const name = row.effectiveName ?? move.name;
  // The held items as the first use meets them, where they work.
  const attHeld = initial.att.itemId, defHeld = initial.def.itemId;
  const attItem = m.attItemOn ? attHeld : "", defItem = m.defItemOn ? defHeld : "";
  const broken = moldBreaks(m, initial);
  const sheerForce = attAbility === "sheerforce" && !!engineMove.secondaries;
  const shielded = (defAbility === "shielddust" && !broken) || defItem === "covertcloak";
  // The target's ability as a foe's stat change meets it.
  const targetAbility = broken && !UNBREAKABLE.has(defAbility) ? "" : defAbility;
  const species = (who: "att" | "def") => (who === "att" ? attacker : defender).transformedFrom?.speciesId ?? initial[who].speciesId;
  // A foe's change of these stats changes nothing on a side: every relevant stat it lowers is blocked (Clear Amulet, a stat guard) and it raises none.
  const blocked = (stages: StageChanges, who: "att" | "def") => {
    const ability = who === "att" ? attAbility : targetAbility, guard = STAT_GUARDS[ability];
    const moved = (Object.keys(stages) as CombatStat[]).filter((stat) => relevance[who].includes(stat));
    return moved.every((stat) => (stages[stat]! < 0) !== (ability === "contrary")
      && ((who === "att" ? attItem : defItem) === "clearamulet" || guard === "all" || !!guard?.includes(stat)));
  };
  // A foe's drop on the target: none past its Clear Amulet, Mirror Armor turning it on the attacker, else on the target.
  const lands = (stages: StageChanges) => defItem === "clearamulet" ? null : targetAbility === "mirrorarmor"
    ? (relevant(stages, "att") && !blocked(stages, "att") ? "att" : null) : relevant(stages, "def") && !blocked(stages, "def") ? "def" : null;
  if (hp.def.full && result.defender.curHP() === result.defender.maxHP()) add(`${result.defender.ability} weakens only the first use.`);
  // A rise a side's Opportunist or Mirror Herb copies after the first use (afterHit, pendingCopy), where the damage reads
  // it, or the herb's loss (an item move).
  for (const [build, whose, who] of [[attacker, "attacker's", "att"], [defender, "target's", "def"]] as const) {
    const copy = build.pendingCopy;
    if (copy && (relevant(copy.stages, who) || (copy.by.includes("Mirror Herb") && ITEM_MOVES.has(move.id)))) add(`The ${whose} ${listNames(copy.by)} copies a rise after the first use.`);
  }
  // The first turn's order alone (firstTurnOnly), where the damage reads the order or Speed.
  if (relevance.att.includes("spe")) {
    for (const [build, whose] of [[attacker, "attacker's"], [defender, "target's"]] as const) {
      if (build.settledCustap) add(`The ${whose} Custap Berry moves it first on the first turn only.`);
      if (build.firstTurnSpeed) add(`The first turn's order comes from the ${whose} Speed before its ${build.firstTurnSpeed.item}.`);
    }
  }
  if (hp.def.half) add("Brine doubles once the target is at half HP or less.");
  if (hp.def.exact) add(`${name}'s power falls with the target's HP.`);
  const attHPSensitive = hp.att.exact || hp.att.full || hp.att.half || hp.att.third;
  const recoil = !!(engineMove as Move & { recoil?: unknown }).recoil || SELF_COST_MOVES.has(move.id);
  const punished = contact && ((defItem === "rockyhelmet") || ["roughskin", "ironbarbs"].includes(defAbility));
  const heals = !!(engineMove as Move & { drain?: unknown }).drain || attItem === "shellbell";
  if (attHPSensitive && ((attAbility !== "magicguard" && (recoil || punished || attItem === "lifeorb")) || heals || attackerResiduals)) {
    add(`${name}'s damage follows the attacker's HP.`);
  }
  const table = statMove(move.id, runtime.profile.id);
  if (relevant(table?.self, "att")) own(`${move.name} ${direction(table!.self!, attAbility)} the attacker's ${changed(table!.self!, "att")} after each use.`);
  const rise = table?.preHit ?? (sheerForce ? undefined : table?.userSecondary);
  if (relevant(rise, "att")) own(`${move.name} ${direction(rise!, attAbility)} the attacker's ${changed(rise!, "att")} each use.`);
  const target = table?.target && !sheerForce && !shielded ? table.target : undefined;
  const landed = target ? lands(target) : null;
  if (landed === "def") own(`${move.name} ${direction(target!, targetAbility)} the target's ${changed(target!, "def")} each use.`);
  if (landed === "att") own(`The target's Mirror Armor turns ${move.name}'s drop back on the attacker.`);
  if (move.id === "terablast" && result.attacker.teraType === "Stellar") add("Stellar Tera Blast lowers the attacker's Attack and Sp. Atk each use.");
  if (move.id === "clearsmog" && STATS.some((stat) => relevance.def.includes(stat) && initial.def.boosts[stat] !== 0)) own("Clear Smog resets the target's stat changes.");
  const maxEffect = MAX_MOVE_EFFECTS[engineMove.name];
  if (maxEffect && (relevant(maxEffect.user, "att") || (maxEffect.foe && lands(maxEffect.foe)))) add(`${engineMove.name} changes a stat each use.`);
  if (maxEffect && (maxEffect.weather || maxEffect.terrain || maxEffect.clearsScreens || maxEffect.clearsTerrain)) add(`${engineMove.name} changes the field.`);
  if (maxEffect?.curesUserStatus && attacker.status) add(`${engineMove.name} cures the attacker's status.`);
  const hit = HIT_ABILITIES[defAbility];
  if (hit && hit.when(type, physical, contact) && !(defAbility === "thermalexchange" && broken)) {
    // Gooey and its kin lower the attacker's Speed: not past its Clear Amulet or a guard of every stat; its Mirror Armor turns it on the target.
    const stopped = attItem === "clearamulet" || STAT_GUARDS[attAbility] === "all";
    const reads = attAbility === "mirrorarmor" ? relevance.def.includes("spe") : relevance.att.includes("spe") || ["defiant", "competitive"].includes(attAbility);
    if (hit.attacker ? !stopped && reads : relevant(hit.stages, "def")) add(`The target's ${abilityName(defAbility)} changes stats after each hit.`);
  }
  // Not after a Sheer Force move (pinned Showdown skips AfterMoveSecondary).
  if (defAbility === "angershell" && !sheerForce) add("The target's Anger Shell acts at half HP.");
  const replaced = contact && replacesAbility(attAbility, defAbility, attHeld === "abilityshield" && !conditions.magicRoom, defHeld === "abilityshield" && !conditions.magicRoom, maxActive(initial.def));
  if (replaced) add(`The target's ${abilityName(defAbility)} replaces the attacker's ability.`);
  // Gulp Missile acts on the first damaging hit, and the target changes back to Cramorant (hit-loop.ts hitStep,
  // afterHit): a quarter of the attacker's HP (not through Magic Guard), then the Gulping form's Defense drop or
  // the Gorging form's paralysis.
  if (gulpingTarget({ speciesId: initial.def.speciesId, abilityId: defAbility, transformed: !!defender.transformedFrom })) {
    // `gorgingParalyses`: the paralysis lands and stays (UsesSearch.gorgingParalyses).
    const effect = initial.def.speciesId === "cramorantgorging" ? (gorgingParalyses ? "paralyses the attacker" : "")
      : relevance.att.includes("def") || ["defiant", "competitive"].includes(attAbility) ? "lowers the attacker's Defense" : "";
    const parts = [attAbility !== "magicguard" ? "hits back" : "", effect].filter(Boolean);
    if (parts.length) add(`The target's Gulp Missile ${parts.join(" and ")} once.`);
  }
  if (defAbility === "seedsower" || defAbility === "sandspit") add(`The target's ${abilityName(defAbility)} changes the field.`);
  if (m.hpForms) add("Forms follow HP at the end of each turn.");
  if (m.dynamax) add("Dynamax ends after 3 turns.");
  if (result.rawDesc.defenderItem && getBerryResistType(result.rawDesc.defenderItem)) add(`The target's ${result.rawDesc.defenderItem} is eaten by the first use.`);
  const gem = !!result.rawDesc.attackerItem?.endsWith(" Gem");
  if (gem) add(`The attacker's ${result.rawDesc.attackerItem} is used up by the first use.`);
  // A Sticky Barb moves to an item-less attacker it hits with contact, before anything takes it.
  const barbMoves = defItem === "stickybarb" && contact && !attHeld;
  const stuck = defAbility === "stickyhold" && !broken && defHeld !== "stickybarb";
  // A Berry the use takes before its holder can eat it (pinned Showdown: Bug Bite, Pluck and Incinerate in onHit, Knock Off, Thief and Covet in AfterHit).
  const itemless = !attHeld || gem;
  // Bug Bite's, Pluck's and Incinerate's Z-Moves take nothing (their onHit is the base move's).
  const steals = BERRY_STEALERS.has(move.id) && !engineMove.isZ;
  const takenFirst = !maxed && !stuck && (steals || move.id === "knockoff" || ((move.id === "thief" || move.id === "covet") && !attHeld));
  // The attacker's Unnerve, unless the target's Mummy and its kin replace it in the first hit.
  const unnerved = m.unnerved && !replaced;
  const used = HIT_ITEMS[defItem];
  const superEffective = defItem === "weaknesspolicy" && !trace.fixedHP && effectiveness(m.gen, result) > 1;
  if (used && used.when(type, physical, superEffective) && relevant(used.stages, "def") && !(used.berry && (sheerForce || takenFirst || unnerved))) {
    add(`The target's ${itemName(defItem)} raises a stat once.`);
  }
  const berry = defItem && !unnerved && !takenFirst ? PINCH_STAT_BERRIES[defItem] : undefined;
  if (berry && relevance.def.includes(berry)) add(`The target's ${itemName(defItem)} raises its ${STAT_LABELS[berry]} at a quarter of its HP.`);
  if (defItem === "airballoon" && ITEM_MOVES.has(move.id)) add("The first hit pops the target's Air Balloon.");
  if (defItem === "whiteherb" && target && landed === "def" && !(targetAbility === "contrary")) add("The target's White Herb restores its stats once.");
  const selfDrops = !!table?.self && (Object.keys(table.self) as CombatStat[]).some((stat) => relevance.att.includes(stat) && (table.self![stat]! < 0) !== (attAbility === "contrary"));
  if (attItem === "whiteherb" && (selfDrops || (move.id === "terablast" && result.attacker.teraType === "Stellar"))) add("The attacker's White Herb restores its stats once.");
  if (attItem === "throatspray" && engineMove.flags?.sound && !sheerForce) add("The attacker's Throat Spray raises its Sp. Atk once.");
  if (attItem === "metronome") add("The attacker's Metronome boosts each consecutive use.");
  // An item the uses take: Knock Off one it can remove, Thief and Covet (or Magician) when the attacker holds none
  // (or spends a Gem first), Bug Bite, Pluck and Incinerate a Berry (Incinerate a Gem too); never through Sticky Hold.
  // Not an item the first use spends before AfterHit (an Air Balloon, a resist Berry, an item a hit uses up), or
  // for Magician (AfterMoveSecondarySelf) before it too (Kee and Maranga Berry).
  // A Jaboca or Rowap Berry the first hit eats as it hits back (hit-loop.ts hitStep: after Mummy and its kin, not
  // past the attacker's Magic Guard or Unnerve, nor once Bug Bite and its kin have taken it).
  const retaliationEaten = !!defItem && RETALIATION_BERRIES[defItem] === engineMove.category && (attAbility !== "magicguard" || replaced) && !unnerved
    && !(steals && !maxed && !stuck);
  if (retaliationEaten && move.id === "knockoff") add(`The target's ${itemName(defItem)} is eaten by the first use.`);
  const spentInHit = defItem === "airballoon" || !!(result.rawDesc.defenderItem && getBerryResistType(result.rawDesc.defenderItem))
    || (!!used && !used.berry && used.when(type, physical, superEffective)) || retaliationEaten;
  const spentInMove = spentInHit || (!!used?.berry && used.when(type, physical, superEffective) && !sheerForce && !unnerved && !takenFirst);
  if (defHeld && !stuck && !barbMoves) {
    if (move.id === "knockoff" && !spentInHit && (maxed ? takeable(m, defHeld, species("def"), species("def"), false) : knockOffBoosted(result))) own(`${move.name} takes the target's item.`);
    else if ((move.id === "covet" || move.id === "thief") && itemless && !spentInHit && takeable(m, defHeld, species("def"), species("att"), true)) own(`${move.name} takes the target's item.`);
    else if (attAbility === "magician" && (itemless || CONSUMED.has(attHeld)) && !spentInMove && takeable(m, defHeld, species("def"), species("att"), false)) add("The attacker's Magician takes the target's item.");
    else if (steals && (defHeld.endsWith("berry") || (move.id === "incinerate" && defHeld.endsWith("gem")))) own(`${move.name} takes the target's item.`);
  }
  // Once the target's own item is gone (used up, or taken by the use).
  const emptied = !defHeld || CONSUMED.has(defHeld) || retaliationEaten || ITEM_MOVES.has(move.id) || attAbility === "magician";
  if (defAbility === "pickpocket" && contact && attHeld && emptied && !sheerForce && attAbility !== "stickyhold" && takeable(m, attHeld, species("att"), species("def"), false)) {
    add("The target's Pickpocket takes the attacker's item.");
  }
  // Poltergeist fails once the target's item is gone, and Acrobatics doubles once the attacker's is.
  if (move.id === "poltergeist" && (CONSUMED.has(defItem) || retaliationEaten)) own("Poltergeist fails once the target's item is used up.");
  if (move.id === "acrobatics" && CONSUMED.has(attItem)) own("Acrobatics doubles once the attacker's item is used up.");
  // Unburden doubles Speed once its holder's item is gone (pinned Showdown onAfterUseItem, onTakeItem).
  if (relevance.att.includes("spe")) {
    const goes = (held: string) => CONSUMED.has(held) || held.endsWith("gem") || ITEM_MOVES.has(move.id) || attAbility === "magician" || defAbility === "pickpocket";
    if (attAbility === "unburden" && attHeld && goes(attHeld)) add("The attacker's Unburden doubles its Speed once its item is gone.");
    if (defAbility === "unburden" && defHeld && (goes(defHeld) || retaliationEaten)) add("The target's Unburden doubles its Speed once its item is gone.");
  }
  if (conditions.attackerSide.charge && type === "Electric") add("Charge is used up by the first Electric move.");
  if (["icespinner", "steelroller"].includes(move.id) && conditions.terrain) own(`${move.name} ends the terrain.`);
  // Smack Down grounds a Flying, Levitate or Eelevate target for Grassy Terrain's heal.
  const types = result.defender.teraType && result.defender.teraType !== "Stellar" ? [result.defender.teraType] : result.defender.types;
  const airborne = (types.includes("Flying") || ["levitate", "eelevate"].includes(defAbility)) && !conditions.gravity && !(defItem === "ironball");
  if ((move.id === "smackdown" || move.id === "thousandarrows") && airborne && conditions.terrain === "Grassy") own(`${move.name} grounds the target after the first use.`);
  if (result.defender.hasAbility("Spicy Spray") && !attacker.status) add("Spicy Spray burns the attacker.");
  if (context?.stellarFirstUse) add("Stellar boosts only the first use of the type.");
  if ((attAbility === "speedboost" || defAbility === "speedboost") && relevance.att.includes("spe")) add("Speed Boost raises Speed at the end of each turn.");
  if (attAbility === "slowstart" && attacker.abilityActive && physical) add("Slow Start ends after 5 turns.");
  if ((attItem === "flameorb" || attItem === "toxicorb") && !attacker.status) add(`The attacker's ${itemName(attItem)} gives it a status at the end of the first turn.`);
  // Hydration cures a status in the rain at the end of the first turn (pinned Showdown residual order 5.3).
  const rain = (conditions.weather === "Rain" || conditions.weather === "Heavy Rain") && !m.weatherSuppressed;
  for (const [who, build, ability, held] of [["attacker", attacker, attAbility, attItem], ["target", defender, defAbility, defItem]] as const) {
    if (ability === "hydration" && build.status && rain && held !== "utilityumbrella") add(`The ${who}'s Hydration cures its status at the end of the first turn.`);
  }
  if (STATUS_MOVES[move.id] && !defender.status && (move.id in STATUS_READS || defAbility === "marvelscale" || defAbility === "synchronize")) own(`${move.name} gives the target a status.`);
  if ((move.id === "smellingsalts" && defender.status === "par") || (move.id === "wakeupslap" && defender.status === "slp")) own(`${move.name} cures the target's status after the first use.`);
  return sources;
}

/**
 * The stat stages that can change this row's damage on a later use: the attacking and defending stats its
 * category reads (the engine's: a Max Move keeps its move's), Body Press's Defense and Foul Play's target
 * Attack, Psyshock's family's Defense, both of each for a move whose category follows the stats (Photon
 * Geyser, Shell Side Arm, Tera Blast...), under Wonder Room and for a Max Move (it is its own move once
 * Dynamax ends), Speed for the moves and the ability that read it, every stage for the moves that count them.
 */
function relevantStats(move: ChampionsMove, attacker: BattleBuild, result: Result, conditions: BattleConditions): { att: CombatStat[]; def: CombatStat[] } {
  if (STAGE_COUNT_MOVES.has(move.id)) return { att: STATS, def: STATS };
  const speed: CombatStat[] = SPEED_MOVES.has(move.id) || attacker.abilityId === "analytic" ? ["spe"] : [];
  if (result.move.isMax) {
    return {
      att: ["atk", "spa", ...(move.id === "bodypress" ? ["def" as const] : []), ...speed],
      def: ["def", "spd", ...(move.id === "foulplay" ? ["atk" as const] : []), ...speed],
    };
  }
  const either = VARIABLE_CATEGORY_MOVES.has(move.id) || conditions.wonderRoom;
  const physical = result.move.category === "Physical";
  const offense: CombatStat[] = either ? ["atk", "spa"] : move.id === "bodypress" ? ["def"] : move.id === "foulplay" ? [] : physical ? ["atk"] : ["spa"];
  const defense: CombatStat[] = either ? ["def", "spd"] : physical || DEFENSE_SPECIAL_MOVES.has(move.id) ? ["def"] : ["spd"];
  return { att: [...offense, ...speed], def: [...defense, ...(move.id === "foulplay" ? ["atk" as const] : []), ...speed] };
}

type HPModes = { exact: boolean; full: boolean; half: boolean; third: boolean };
/** Which HP lines can change this row's damage: the engine and the calculation read current HP only in these places. */
function hpSensitivity(m: UsesMatchup, move: ChampionsMove, result: Result): { att: HPModes; def: HPModes } {
  return {
    def: { exact: ["wringout", "crushgrip", "hardpress"].includes(move.id), full: result.defender.hasAbility("Multiscale", "Shadow Shield", "Tera Shell"), half: move.id === "brine", third: false },
    att: {
      exact: ["eruption", "waterspout", "dragonenergy", "flail", "reversal"].includes(move.id),
      full: m.attAbility === "galewings" && result.move.type === "Flying", half: m.attAbility === "defeatist",
      third: PINCH_TYPES[m.attAbility] === result.move.type,
    },
  };
}

function hpKey(modes: HPModes, hp: number, maxHP: number): string {
  if (modes.exact) return String(hp);
  return `${modes.full && hp >= maxHP ? "F" : ""}${modes.half && hp * 2 <= maxHP ? "H" : ""}${modes.third && hp * 3 <= maxHP ? "T" : ""}`;
}

/**
 * A build for a full rerun: base HP (a Dynamaxed Pokémon's engine HP is floor(base x ratio), so a fraction that rounds
 * back). What the calculation settled for the first turn alone (firstTurnOnly) stays on the first use's state.
 */
function toBuild(base: BattleBuild, side: Side, download: CombatStat | null, abilityActive: boolean, first: boolean): BattleBuild {
  const ratio = side.maxHP / side.baseMaxHP;
  const currentHP = ratio !== 1 ? (side.hp + 0.5) / ratio : side.hp;
  const boosts = { ...side.boosts };
  if (download) boosts[download] = clamp(boosts[download] + 1);
  const active = base.abilityId === "slowstart" ? abilityActive : side.abilityId === "unburden" ? unburdened(side) : base.abilityActive;
  return {
    ...base, currentHP: currentHP >= side.baseMaxHP ? null : currentHP, itemId: side.itemId, boosts, abilityId: side.abilityId,
    speciesId: side.speciesId, status: side.status, mechanic: side.mechanic, abilityActive: active,
    ...(download ? { settledDownload: download } : {}), ...(side.focusEnergy ? { settledFocusEnergy: true as const } : {}),
    ...(first ? {} : { settledCustap: undefined, firstTurnSpeed: undefined, pendingCopy: undefined }),
  };
}

/**
 * What the calculation settled for the first turn alone: a Custap Berry eaten as that turn's move was chosen (pinned
 * Showdown custapberry onFractionalPriority, once), and generation 7's order from the Speed before the item used at
 * that turn's first Update (calculate.ts settleItems firstTurnSpeed). From the next turn the order is by Speed.
 */
const firstTurnOnly = (build: BattleBuild) => !!build.settledCustap || !!build.firstTurnSpeed;

/** Unburden doubles a side's Speed: activated, and holding nothing. */
const unburdened = (side: Side) => side.unburden && !side.itemId;

function effectiveness(gen: ReturnType<typeof Generations.get>, result: Result): number {
  const { defender, move, field } = result;
  const types: string[] = defender.teraType && defender.teraType !== "Stellar" ? [defender.teraType] : [...defender.types];
  return types.reduce((product, type) => product * getMoveEffectiveness(gen, move, type as never, false, field.isGravity, false), 1);
}

/** A side's ability in a state, after Neutralizing Gas for the one it started with. */
function sideAbility(m: UsesMatchup, state: State, who: "att" | "def"): string {
  const side = state[who], build = who === "att" ? m.attacker : m.defender;
  return side.abilityId === build.abilityId ? (who === "att" ? m.attAbility : m.defAbility) : side.abilityId;
}

/**
 * The attacker's Mold Breaker, Teravolt or Turboblaze ignores the target's breakable abilities during its
 * move, unless the target holds an Ability Shield (pinned Showdown suppressingAbility; Klutz does not stop the
 * shield, Magic Room does).
 */
function moldBreaks(m: UsesMatchup, state: State): boolean {
  return MOLD_BREAKERS.has(sideAbility(m, state, "att")) && !(state.def.itemId === "abilityshield" && !state.conditions.magicRoom);
}

/**
 * Showdown's boost(): Contrary and Simple (on the target, ignored by Mold Breaker during the attacker's move:
 * `inMove`), then against a foe's drop Clear Amulet (onTryBoost priority 1), the guard abilities and Mirror
 * Armor; Defiant / Competitive after it, and the target's Opportunist or Mirror Herb copying the attacker's rise, but
 * a rise that is itself such a copy (`copied`: onFoeAfterBoost skips an effect named Opportunist or Mirror Herb).
 */
function boost(m: UsesMatchup, state: State, who: "att" | "def", changes: StageChanges, byFoe: boolean, inMove = false, reflected = false, copied = false) {
  const side = state[who];
  const ability = sideAbility(m, state, who);
  const effective = who === "def" && (byFoe || inMove) && !UNBREAKABLE.has(ability) && moldBreaks(m, state) ? "" : ability;
  let lowered = false;
  const raised: StageChanges = {};
  for (const [stat, raw] of Object.entries(changes) as [CombatStat, number][]) {
    let amount = effective === "contrary" ? -raw : raw;
    if (effective === "simple") amount *= 2;
    if (amount < 0 && byFoe) {
      if (side.itemId === "clearamulet" && (who === "att" ? m.attItemOn : m.defItemOn)) continue;
      const guard = STAT_GUARDS[effective];
      if (guard === "all" || guard?.includes(stat)) continue;
      // Mirror Armor bounces a foe's drop back as that foe's own drop from a foe (once).
      if (effective === "mirrorarmor" && !reflected) { boost(m, state, who === "att" ? "def" : "att", { [stat]: amount }, true, inMove, true); continue; }
    }
    const before = side.boosts[stat];
    side.boosts[stat] = clamp(before + amount);
    if (side.boosts[stat] < before && byFoe) lowered = true;
    if (side.boosts[stat] > before) raised[stat] = side.boosts[stat] - before;
  }
  if (lowered && (ability === "defiant" || ability === "competitive")) boost(m, state, who, { [ability === "defiant" ? "atk" : "spa"]: 2 }, false);
  // Pinned Showdown opportunist and mirrorherb onFoeAfterBoost copy a foe's rise.
  if (who === "att" && !byFoe && !copied && Object.keys(raised).length) {
    const target = state.def;
    const targetAbility = target.abilityId === m.defender.abilityId ? m.defAbility : target.abilityId;
    if (targetAbility === "opportunist") boost(m, state, "def", raised, false);
    else if (target.itemId === "mirrorherb" && m.defItemOn) { boost(m, state, "def", raised, false); target.itemId = ""; }
  }
}

/**
 * Whether `itemId` can be taken from a Pokémon of species `holder` by one of species `taker` (pinned Showdown
 * takeItem runs the item's onTakeItem with the holder, and with the taker where the handler reads it; Thief
 * and Covet run it once more for the taker): never a Z-Crystal, nor a Mega Stone from the family it Mega
 * Evolves (the form, for the form-keyed stones), nor an item its family owns (OWNED_ITEMS), nor Booster
 * Energy from a Paradox Pokémon. A transformed Pokémon keeps its own species for this.
 */
function takeable(m: UsesMatchup, itemId: string, holder: string, taker: string, thief: boolean): boolean {
  const { runtime } = m;
  const item = runtime.itemsById.get(itemId);
  if (!item) return true;
  if (item.zMoveType || item.zMove || itemId.endsWith("iumz")) return false;
  const family = (id: string) => runtime.speciesById.get(id)?.baseSpecies ?? id;
  const owns = (species: string) => {
    if (item.megaTargets.length) {
      return item.megaTargets.some((target) => FORM_KEYED_MEGA_STONES.has(itemId) ? target.baseSpeciesId === species || target.formId === species : family(target.baseSpeciesId) === family(species));
    }
    if (itemId === "boosterenergy") return m.helpers.paradox(species);
    return itemOwner(itemId, runtime.profile.id)?.[0] === family(species);
  };
  return !owns(holder) && !((thief || itemOwner(itemId, runtime.profile.id)?.[1]) && owns(taker));
}

/** The family an item belongs to in a game (OWNED_ITEMS), and whether its onTakeItem reads the taker too. */
export function itemOwner(itemId: string, game: BattleGame): [family: string, taker: boolean] | undefined {
  const entry = OWNED_ITEMS[itemId];
  return entry && (!entry[2] || entry[2].includes(game)) ? [entry[0], entry[1]] : undefined;
}

/** Whether the engine gave Knock Off its 1.5x, which it does exactly when it can remove the item (gen789 / champions resistedKnockOffDamage). */
function knockOffBoosted(result: Result) {
  const bp = result.rawDesc.moveBP;
  return bp !== undefined && Math.abs(bp - result.move.bp * 1.5) < 1e-9;
}

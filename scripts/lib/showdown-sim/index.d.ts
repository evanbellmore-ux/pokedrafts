// Public types of @pokedrafts/showdown-sim: a narrow, hand-written view of the pinned Showdown simulator c23d2e94
// (the upstream declarations are the whole server). Readers get readonly fields so app code cannot change the
// authoritative battle by accident; the belief-battle builder alone casts a battle it built itself to the Writable* and
// ClonedBattle shapes. Field lines refer to the pinned sources (sim/pokemon.ts, sim/side.ts, sim/battle.ts, sim/field.ts).

export type SideID = "p1" | "p2";
export type PRNGSeed = `${"sodium" | "gen5" | number},${string}`;
export type StatID = "hp" | "atk" | "def" | "spa" | "spd" | "spe";
export type StatIDExceptHP = Exclude<StatID, "hp">;
export type StatsTable = Record<StatID, number>;
export type BoostID = StatIDExceptHP | "accuracy" | "evasion";
export type BoostsTable = Record<BoostID, number>;

/** sim/global-types.ts PokemonSet (the fields this app sends). */
export interface PokemonSet {
  name: string; species: string; item: string; ability: string; moves: string[]; nature: string;
  gender: string; evs: StatsTable; ivs: StatsTable; level: number; teraType?: string;
}
export interface EffectState { id: string; effectOrder?: number; duration?: number; [key: string]: unknown }

// ---------- Requests (sim/side.ts:64-164) ----------
export interface MoveRequestData { move: string; id: string; pp?: number; maxpp?: number; target?: string; disabled?: string | boolean; disabledSource?: string }
export interface PokemonMoveRequestData {
  moves: MoveRequestData[]; maybeDisabled?: boolean; maybeLocked?: boolean; trapped?: boolean; maybeTrapped?: boolean;
  canMegaEvo?: boolean; canMegaEvoX?: boolean; canMegaEvoY?: boolean; canTerastallize?: string;
}
export interface PokemonSwitchRequestData {
  ident: string; details: string; condition: string; active: boolean; stats: Record<StatIDExceptHP, number>; moves: string[];
  baseAbility: string; item: string; pokeball: string; ability?: string; commanding?: boolean; reviving?: boolean;
  teraType?: string; terastallized?: string;
}
export interface SideRequestData { name: string; id: SideID; pokemon: PokemonSwitchRequestData[]; noCancel?: boolean }
export type ChoiceRequest =
  | { wait: true; side: SideRequestData; noCancel?: boolean }
  | { teamPreview: true; maxChosenTeamSize?: number; side: SideRequestData; noCancel?: boolean }
  | { forceSwitch: boolean[]; side: SideRequestData; noCancel?: boolean; update?: boolean }
  | { active: PokemonMoveRequestData[]; side: SideRequestData; noCancel?: boolean; update?: boolean };

// ---------- Dex data ----------
export interface Species {
  readonly id: string; readonly name: string; readonly exists: boolean; readonly baseSpecies: string; readonly forme: string;
  readonly types: readonly string[]; readonly baseStats: Readonly<StatsTable>;
  readonly abilities: Readonly<Record<string, string>>;
  /** "M" | "F" | "N" for a fixed gender, "" otherwise. */
  readonly gender: string;
  readonly isMega?: boolean; readonly battleOnly?: string | readonly string[]; readonly changesFrom?: string;
  readonly requiredItem?: string; readonly requiredItems?: readonly string[];
  readonly isNonstandard?: string | null; readonly weighthg: number;
}
export interface Move {
  readonly id: string; readonly name: string; readonly exists: boolean; readonly category: "Physical" | "Special" | "Status";
  readonly type: string; readonly target: string; readonly priority: number; readonly basePower: number; readonly pp: number;
  readonly accuracy: number | true; readonly flags: Readonly<Record<string, 1 | undefined>>;
  readonly isNonstandard?: string | null; readonly selfSwitch?: string | boolean; readonly stallingMove?: boolean;
}
export interface Item {
  readonly id: string; readonly name: string; readonly exists: boolean; readonly isChoice?: boolean; readonly isBerry?: boolean;
  readonly megaStone?: Readonly<Record<string, string>> | string; readonly megaEvolves?: string; readonly isNonstandard?: string | null;
}
export interface Ability { readonly id: string; readonly name: string; readonly exists: boolean; readonly isNonstandard?: string | null }
export interface Nature { readonly id: string; readonly name: string; readonly exists: boolean; readonly plus?: StatIDExceptHP; readonly minus?: StatIDExceptHP }
export interface ModdedDex {
  readonly currentMod: string;
  readonly species: { get(name: string): Species; all(): readonly Species[]; getMovePool(id: string): Set<string> };
  readonly moves: { get(name: string): Move; all(): readonly Move[] };
  readonly items: { get(name: string): Item; all(): readonly Item[] };
  readonly abilities: { get(name: string): Ability; all(): readonly Ability[] };
  readonly natures: { get(name: string): Nature; all(): readonly Nature[] };
  getActiveMove(move: string): ActiveMove;
  forFormat(format: string): ModdedDex;
}
/** A move as it is being used (sim/dex-moves.ts ActiveMove). */
export interface ActiveMove { readonly id: string; readonly name: string; readonly [key: string]: unknown }
export declare const Dex: ModdedDex;
export declare function toID(text: unknown): string;

// ---------- Battle objects (readonly for readers) ----------
export interface MoveSlot { readonly id: string; readonly move: string; readonly pp: number; readonly maxpp: number; readonly target?: string; readonly disabled: boolean | string; readonly used: boolean }
export interface Pokemon {
  readonly side: Side; readonly position: number; readonly set: PokemonSet; readonly name: string; readonly fullname: string;
  readonly details: string;
  readonly species: Species; readonly baseSpecies: Species; readonly speciesState: EffectState;
  readonly status: "" | "brn" | "par" | "psn" | "tox" | "slp" | "frz"; readonly statusState: EffectState;
  readonly volatiles: Readonly<Record<string, EffectState>>;
  readonly storedStats: Readonly<Record<StatIDExceptHP, number>>; readonly boosts: Readonly<BoostsTable>;
  readonly baseAbility: string; readonly ability: string; readonly abilityState: EffectState;
  readonly item: string; readonly itemState: EffectState; readonly lastItem: string; readonly itemKnockedOff: boolean;
  readonly trapped: boolean | "hidden"; readonly maybeTrapped: boolean; readonly illusion: Pokemon | null; readonly transformed: boolean;
  readonly maxhp: number; readonly hp: number; readonly fainted: boolean; readonly gender: "M" | "F" | "N" | "";
  readonly types: readonly string[];
  readonly moveSlots: readonly MoveSlot[]; readonly timesAttacked: number; readonly isActive: boolean; readonly isStarted: boolean;
  readonly activeTurns: number; readonly activeMoveActions: number; readonly previouslySwitchedIn: number;
  readonly moveThisTurnResult: boolean | null | undefined; readonly moveLastTurnResult: boolean | null | undefined;
  readonly newlySwitched: boolean; readonly lastMove: { readonly id: string } | null; readonly lastMoveTargetLoc?: number;
  readonly canMegaEvo: string | false | null | undefined; readonly canMegaEvoX: string | false | null | undefined; readonly canMegaEvoY: string | false | null | undefined;
  readonly switchFlag: boolean | string; readonly terastallized?: string;
  getHealth(): { side: SideID; secret: string; shared: string };
  getItem(): Item;
  getSlot(): string;
  getStat(stat: StatIDExceptHP, unboosted?: boolean, unmodified?: boolean): number;
  getTypes(excludeAdded?: boolean): string[];
  isGrounded(): boolean;
  hasType(type: string | string[]): boolean;
  getLocOf(target: Pokemon): number;
}
export interface Side {
  readonly id: SideID; readonly n: number; readonly name: string; readonly pokemon: readonly Pokemon[];
  readonly active: readonly (Pokemon | null)[]; readonly pokemonLeft: number; readonly totalFainted: number;
  readonly faintedLastTurn: Pokemon | null; readonly faintedThisTurn: Pokemon | null;
  readonly sideConditions: Readonly<Record<string, EffectState>>; readonly slotConditions: readonly Readonly<Record<string, EffectState>>[];
  readonly activeRequest: ChoiceRequest | null;
  readonly choice: { readonly error: string; readonly actions: readonly unknown[]; readonly cantUndo: boolean };
  readonly requestState: "teampreview" | "move" | "switch" | "";
  readonly foe: Side;
  isChoiceDone(): boolean;
}
export interface Field {
  readonly weather: string; readonly weatherState: EffectState; readonly terrain: string; readonly terrainState: EffectState;
  readonly pseudoWeather: Readonly<Record<string, EffectState>>;
}
export declare class PRNG {
  constructor(seed?: PRNGSeed | readonly number[] | null);
  readonly startingSeed: PRNGSeed;
  getSeed(): PRNGSeed;
  /** () → [0, 1); (n) → integer [0, n); (m, n) → integer [m, n) (sim/prng.ts:85-104). */
  random(from?: number, to?: number): number;
  randomChance(numerator: number, denominator: number): boolean;
  static generateSeed(): PRNGSeed;
}
export type SendFunction = (type: string, data: string | string[]) => void;
export interface BattleAction { readonly choice: string; readonly order: number; readonly priority?: number; readonly pokemon?: Pokemon; readonly [key: string]: unknown }
export declare class Battle {
  constructor(options: { formatid: string; seed?: PRNGSeed | readonly number[] | null; send?: SendFunction; strictChoices?: boolean });
  readonly sides: readonly [Side, Side]; readonly p1: Side; readonly p2: Side; readonly field: Field;
  readonly turn: number; readonly midTurn: boolean; readonly ended: boolean; readonly winner: string | undefined; readonly started: boolean;
  readonly requestState: "teampreview" | "move" | "switch" | ""; readonly log: readonly string[]; readonly inputLog: readonly string[];
  readonly prng: PRNG; readonly gen: number; readonly gameType: string;
  readonly dex: ModdedDex;
  setPlayer(side: SideID, options: { name?: string; team: PokemonSet[] }): void;
  choose(side: SideID, input: string): boolean;
  makeChoices(...inputs: string[]): void;
  sendUpdates(): void;
  lose(side: SideID): boolean;
  tie(): boolean;
  restart(send?: SendFunction): void;
  getAllPokemon(): Pokemon[];
  getAllActive(includeFainted?: boolean): Pokemon[];
}

// ---------- Writable views: only for battles the app built itself (belief battles, preludes, rollouts) ----------
export interface WritableMoveSlot { id: string; move: string; pp: number; maxpp: number; disabled: boolean | string; used: boolean }
export interface WritablePokemon extends Omit<Pokemon,
  "hp" | "fainted" | "status" | "statusState" | "boosts" | "volatiles" | "item" | "lastItem" | "itemState" | "itemKnockedOff" | "ability" |
  "abilityState" | "baseAbility" | "moveSlots" | "lastMove" | "lastMoveTargetLoc" | "moveThisTurnResult" | "timesAttacked" | "activeTurns" |
  "activeMoveActions" | "previouslySwitchedIn" | "isStarted" | "canMegaEvo" | "canMegaEvoX" | "canMegaEvoY" | "types" | "switchFlag" | "speciesState" | "isActive"> {
  hp: number; fainted: boolean; status: Pokemon["status"]; statusState: EffectState; boosts: BoostsTable;
  volatiles: Record<string, EffectState>; item: string; lastItem: string; itemState: EffectState; itemKnockedOff: boolean;
  ability: string; baseAbility: string; abilityState: EffectState; moveSlots: WritableMoveSlot[];
  lastMove: ActiveMove | null; lastMoveUsed: ActiveMove | null; lastMoveEncore: ActiveMove | null; lastMoveTargetLoc: number | undefined;
  moveThisTurnResult: boolean | null | undefined; timesAttacked: number; activeTurns: number; activeMoveActions: number;
  previouslySwitchedIn: number; isStarted: boolean; isActive: boolean; switchFlag: boolean | string;
  canMegaEvo: string | false | null | undefined; canMegaEvoX: string | false | null | undefined; canMegaEvoY: string | false | null | undefined;
  types: string[]; apparentType: string; addedType: string; knownType: boolean; speciesState: EffectState;
  ateBerry: boolean; usedItemThisTurn: boolean; attackedBy: unknown[]; lastDamage: number;
  formeChange(speciesId: string, source?: unknown, isPermanent?: boolean, abilitySlot?: string, message?: string): boolean;
  transformInto(target: Pokemon, effect?: unknown): boolean;
}
export interface WritableSide extends Omit<Side, "sideConditions" | "slotConditions" | "totalFainted" | "pokemonLeft" | "faintedThisTurn" | "faintedLastTurn" | "pokemon" | "active"> {
  readonly pokemon: readonly WritablePokemon[]; readonly active: readonly (WritablePokemon | null)[];
  sideConditions: Record<string, EffectState>; slotConditions: Record<string, EffectState>[];
  totalFainted: number; pokemonLeft: number; faintedThisTurn: Pokemon | null; faintedLastTurn: Pokemon | null;
  /** Records a choice without committing the turn (sim/side.ts choose); false with an error. */
  choose(input: string): boolean;
  clearChoice(): void;
}
export interface WritableField { weather: string; weatherState: EffectState; terrain: string; terrainState: EffectState; pseudoWeather: Record<string, EffectState> }
/** A battle the app built or deserialized: the belief builder, preludes, rollouts and the residual pass may write and drive it. */
export interface ClonedBattle extends Omit<Battle, "sides" | "p1" | "p2" | "field" | "turn" | "midTurn" | "prng"> {
  readonly sides: readonly [WritableSide, WritableSide]; readonly p1: WritableSide; readonly p2: WritableSide;
  field: WritableField; turn: number; midTurn: boolean; prng: PRNG;
  lastMove: ActiveMove | null; effectOrder: number;
  endTurn(): void;
  makeRequest(type?: "teampreview" | "move" | "switch"): void;
  initEffectState(state: Record<string, unknown>, effectOrder?: number): EffectState;
  runAction(action: BattleAction): void;
  fieldEvent(id: string, ...rest: unknown[]): unknown;
}
export declare const State: {
  serializeBattle(battle: Battle | ClonedBattle): object;
  deserializeBattle(state: string | object): ClonedBattle;
};
export declare class TeamValidator {
  constructor(format: string);
  /** Normalizes the sets in place; null when legal. */
  validateTeam(team: PokemonSet[] | null, options?: { removeNicknames?: boolean; skipSets?: Record<string, Record<string, boolean>> }): string[] | null;
}
export declare const Teams: { pack(team: PokemonSet[] | null): string; unpack(buffer: string): PokemonSet[] | null; export(team: PokemonSet[]): string; import(text: string): PokemonSet[] | null };
/** sim/battle.ts:33-56: a `|split|pN` line's secret half to channel N (and -1), its shared half to every other channel. */
export declare function extractChannelMessages<T extends 0 | 1 | 2 | 3 | 4 | -1>(message: string, channelIds: T[]): Record<T, string[]>;

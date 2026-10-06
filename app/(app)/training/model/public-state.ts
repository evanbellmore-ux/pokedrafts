import type { BattleStatus } from "@/app/lib/battle/types";
import type { BoostId, SideID } from "./showdown-types";

/** What one seat knows of the battle, built only from that seat's protocol channel (sim/tracker.ts). Plain JSON. */
export type ShownHP = { percent: number; color: "g" | "y" | "r" | null };       // percent 0 when fainted
export type ExactHP = { hp: number; maxhp: number };                            // the seat's own Pokémon only
/** What the log has said about a Pokémon's item. Sheets are merged later (sim/inputs.ts, sim/board.ts). */
export type ItemShown =
  | { state: "not-shown" }
  | { state: "held"; itemId: string }                                          // -item, [from] item:, -activate item:, -mega
  | { state: "gone"; itemId: string; how: "consumed" | "removed"; stint: number };
export type PublicVolatile = {
  id: string;
  /** Turn whose end of turn first counts it down (section 8.3 R2). */
  since: number;
  /** Move attempts it has lasted (confusion: -activate lines). */
  elapsed: number;
  moveId?: string; layers?: number; sourceKey?: string;
  /** Taunt and Encore: the target had already acted that turn (one more turn, PS/data/moves.ts taunt/encore onStart). */
  targetMovedFirst?: boolean;
};
export type PublicMon = {
  key: string;                    // `${side}:${TrainingMember.key}`
  side: SideID;
  position: 0 | 1 | null;
  speciesId: string;              // current form as shown (an Illusion shows the disguise)
  mega: boolean;
  hp: ShownHP;
  exact: ExactHP | null;          // own side only
  fainted: boolean;
  status: BattleStatus;
  /** Sleep / freeze: move attempts since the status began (cant lines). */
  statusElapsed: number;
  boosts: Record<BoostId, number>;
  volatiles: PublicVolatile[];
  item: ItemShown;
  ability: { abilityId: string; how: "announced" | "copied" | "changed" } | null;
  /** PP spent per move id (Pressure counted; locked continuations and releases spend none). */
  movesUsed: Record<string, number>;
  lastMove: string | null;
  lastMoveTarget: { side: SideID; position: 0 | 1 } | null;
  lastResult: boolean | null;
  /** move or cant lines since its switch-in: Fake Out and First Impression work only at 0. */
  actions: number;
  activeTurns: number; timesHit: number; switchIns: number;
  protectStreak: number;
  lock: { moveId: string; turns: number } | null;
  transformedInto: string | null;
};
export type PublicCondition = { id: string; since: number; layers: number; setterKey: string | null };
export type PublicSide = { conditions: PublicCondition[]; totalFainted: number; faintedLastTurn: string | null; megaUsed: boolean };
export type PublicField = {
  weather: (PublicCondition & { fromAbility: boolean }) | null;
  terrain: PublicCondition | null;
  rooms: PublicCondition[];        // trickroom, gravity, magicroom, wonderroom
};
export type PublicState = {
  viewer: SideID; turn: number;
  mons: Record<string, PublicMon>;
  sides: Record<SideID, PublicSide>;
  field: PublicField;
  lastMove: string | null;
  ended: boolean; winner: SideID | "tie" | null;
};

// ---------- What the belief learns from (about the viewer's opponent side), one record per resolved turn ----------
export type SpeedSnapshot = { key: string; moveId: string; speStage: number; status: BattleStatus; tailwind: boolean; quickClaw: boolean };
export type OrderObservation = { first: SpeedSnapshot; second: SpeedSnapshot; trickRoom: boolean; weather: string; terrain: string };
export type HitSnapshot = {
  key: string; speciesId: string; boosts: Record<BoostId, number>; status: BattleStatus; hp: ShownHP | ExactHP;
  /** The log had shown its item used up or removed before the hit (Life Orb knocked off, a Berry eaten). */
  itemGone?: boolean;
};
export type DamageObservation = {
  moveId: string; attacker: HitSnapshot; defender: HitSnapshot; after: ShownHP | ExactHP;
  crit: boolean; spread: boolean; helpingHand: boolean;
  censored: null | "fainted" | "focus-sash" | "sturdy";
  weather: string; terrain: string;
  defenderScreens: { reflect: boolean; lightScreen: boolean; auroraVeil: boolean };
  gravity: boolean; magicRoom: boolean; wonderRoom: boolean;
};
export type RevealObservation = { key: string; kind: "item" | "item-gone" | "ability" | "move" | "mega" | "not-choice"; id: string };
export type EntryObservation = { key: string; announced: string[] };   // abilities announced in its entry window
export type ObservedAction =
  | { kind: "move"; moveId: string; targetKey: string | null; spread: boolean }
  | { kind: "switch"; toKey: string }
  | { kind: "none"; reason: "cant" | "fainted" | "not-shown" };
export type TurnObservations = {
  turn: number;
  order: OrderObservation[];
  damage: DamageObservation[];
  reveals: RevealObservation[];
  entries: EntryObservation[];
  /** The opponent side's actives at the turn's start and what each visibly did. */
  actions: { key: string; position: 0 | 1; action: ObservedAction }[];
};

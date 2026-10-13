import type { BattleRuntime } from "./runtime";
import type { BattleBuild, BattleConditions, BuildIssue, MoveContext, MoveDamageResult, SettledHP } from "./types";

// Contract for the 2v2 tab: types and slot helpers only. No mechanics; no engine imports (safe in the initial bundle).

/** Screen positions: your two Pokémon and the opponent's two, left and right as the page shows them. */
export type DoublesSlotId = "own-left" | "own-right" | "opponent-left" | "opponent-right";
export const DOUBLES_SLOTS: readonly DoublesSlotId[] = ["own-left", "own-right", "opponent-left", "opponent-right"];
/** A slot's side; equal to roster-prep's RosterRole. */
export type DoublesSideId = "own" | "opponent";

export function slotSide(slot: DoublesSlotId): DoublesSideId {
  return slot === "own-left" || slot === "own-right" ? "own" : "opponent";
}
const ALLY: Record<DoublesSlotId, DoublesSlotId> = {
  "own-left": "own-right", "own-right": "own-left", "opponent-left": "opponent-right", "opponent-right": "opponent-left",
};
export function allyOf(slot: DoublesSlotId): DoublesSlotId {
  return ALLY[slot];
}
/** The other side's slots, screen-left first. */
export function foesOf(slot: DoublesSlotId): readonly [DoublesSlotId, DoublesSlotId] {
  return slotSide(slot) === "own" ? ["opponent-left", "opponent-right"] : ["own-left", "own-right"];
}
/**
 * Pinned Showdown side (p1 = 0) and position. The far side is mirrored, so the screen-left foe is the one across from your left
 * Pokémon (sim/pokemon.ts:745 isAdjacent; data/abilities.ts imposter copies foe.active[length - 1 - position]).
 */
export const SHOWDOWN_POSITION: Record<DoublesSlotId, { side: 0 | 1; position: 0 | 1 }> = {
  "own-left": { side: 0, position: 0 }, "own-right": { side: 0, position: 1 },
  "opponent-left": { side: 1, position: 1 }, "opponent-right": { side: 1, position: 0 },
};
/**
 * A Pokémon's name in text: its display name (`base`), its team when the other side shows the same name (`side`), and its
 * place in its side's slot order when its partner shows the same name (`number`: the left slot 1, the right slot 2; status2
 * R: a bench Pokémon after them, benchNameParts).
 */
export type NameParts = { base: string; side: "yours" | "opponent's" | null; number: number | null };

/**
 * The name parts of four slots' base names ("" = an empty slot): the side word when a slot on the other side has the same
 * name, the number when the partner has it. Every slot sharing a name gets its words, so equal names always differ.
 */
export function duplicateNameParts(base: Record<DoublesSlotId, string>): Record<DoublesSlotId, NameParts> {
  return Object.fromEntries(DOUBLES_SLOTS.map((slot): [DoublesSlotId, NameParts] => {
    const name = base[slot];
    if (!name) return [slot, { base: "", side: null, number: null }];
    const mirrored = DOUBLES_SLOTS.some((other) => slotSide(other) !== slotSide(slot) && base[other] === name);
    const twin = base[ALLY[slot]] === name;
    return [slot, {
      base: name,
      side: mirrored ? (slotSide(slot) === "own" ? "yours" : "opponent's") : null,
      number: twin ? (slot === "own-left" || slot === "opponent-left" ? 1 : 2) : null,
    }];
  })) as Record<DoublesSlotId, NameParts>;
}

/** "Garchomp", "Garchomp (yours)", "Garchomp (opponent's)", "Garchomp (1)", "Garchomp (yours, 1)"; "" for an empty base. */
export function nameText(parts: NameParts): string {
  if (!parts.base) return "";
  const words = [parts.side, parts.number].filter((word) => word !== null);
  return words.length ? `${parts.base} (${words.join(", ")})` : parts.base;
}

/** The name parts of the four slots' Pokémon by species name (duplicateNameParts); an empty slot's base is "". */
export function doublesNameParts(pokemon: Record<DoublesSlotId, { build: BattleBuild } | null>, runtime: BattleRuntime): Record<DoublesSlotId, NameParts> {
  return duplicateNameParts(Object.fromEntries(DOUBLES_SLOTS.map((slot) => {
    const entry = pokemon[slot];
    return [slot, entry ? runtime.speciesById.get(entry.build.speciesId)?.name ?? entry.build.speciesId : ""];
  })) as Record<DoublesSlotId, string>);
}

/**
 * The four slots' names for facts and labels (nameText of doublesNameParts): "Garchomp (yours)" / "Garchomp (opponent's)"
 * when both sides show the species, "Garchomp (1)" / "Garchomp (2)" when one side shows it twice; "" for an empty slot.
 * The turn reads them from its input (turnNames), so they stay fixed for the turn (after an Ally Switch too).
 */
export function doublesNames(pokemon: Record<DoublesSlotId, { build: BattleBuild } | null>, runtime: BattleRuntime): Record<DoublesSlotId, string> {
  const parts = doublesNameParts(pokemon, runtime);
  return Object.fromEntries(DOUBLES_SLOTS.map((slot) => [slot, nameText(parts[slot])])) as Record<DoublesSlotId, string>;
}

/**
 * status2 R (IN §5.7): each bench Pokémon's name parts by its id, after the four slots' (duplicateNameParts, which the bench
 * does not change). A side's bench is named in its order: the side word when a Pokémon of the other side, in play or on its
 * bench, has the same name; a number when a Pokémon of its own side before it (the two slots, then its bench in order) has
 * the same name: one more than the number of those Pokémon. So every two Pokémon of the turn named alike differ in text.
 */
export function benchNameParts(base: Record<DoublesSlotId, string>, bench: Partial<Record<DoublesSideId, readonly { id: string; base: string }[]>>): Record<string, NameParts> {
  const out: Record<string, NameParts> = {};
  const sides: DoublesSideId[] = ["own", "opponent"];
  const namesOf = (side: DoublesSideId) => [...DOUBLES_SLOTS.filter((slot) => slotSide(slot) === side).map((slot) => base[slot]), ...(bench[side] ?? []).map((each) => each.base)];
  for (const side of sides) {
    const other = namesOf(side === "own" ? "opponent" : "own");
    const own = namesOf(side);
    (bench[side] ?? []).forEach((each, index) => {
      if (!each.base) { out[each.id] = { base: "", side: null, number: null }; return; }
      // The side's Pokémon before this one: its two slots, then the bench members before it.
      const before = own.slice(0, 2 + index).filter((name) => name === each.base).length;
      out[each.id] = {
        base: each.base,
        side: other.includes(each.base) ? (side === "own" ? "yours" : "opponent's") : null,
        number: before ? before + 1 : null,
      };
    });
  }
  return out;
}

/** status2 R: the bench Pokémon's names by id (nameText of benchNameParts over the slots' and the bench's species names). */
export function doublesBenchNames(pokemon: Record<DoublesSlotId, { build: BattleBuild } | null>, bench: Partial<Record<DoublesSideId, readonly DoublesBenchPokemon[]>>,
  runtime: BattleRuntime): Record<string, string> {
  const name = (build: BattleBuild) => runtime.speciesById.get(build.speciesId)?.name ?? build.speciesId;
  const base = Object.fromEntries(DOUBLES_SLOTS.map((slot) => [slot, pokemon[slot] ? name(pokemon[slot]!.build) : ""])) as Record<DoublesSlotId, string>;
  const benchBase = Object.fromEntries(Object.entries(bench).map(([side, list]) => [side, (list ?? []).map((each) => ({ id: each.id, base: name(each.build) }))]));
  return Object.fromEntries(Object.entries(benchNameParts(base, benchBase)).map(([id, parts]) => [id, nameText(parts)]));
}

/**
 * A slot's choice. moveId null is "No move": it takes its turn at priority 0 and its own Speed and does nothing, as Splash
 * would. target: the slot it aims at when its rule is "choose"; null otherwise.
 */
export type DoublesAction = { moveId: string | null; target: DoublesSlotId | null };

/**
 * State from earlier turns a Pokémon brings into this turn. Training passes it from the public log (sim/tracker.ts counts);
 * the calculator passes only sleep, freeze, confusion, toxic and substitute. Absent fields: none of it. leechSeed and wish
 * are positions (Leech Seed's sourceSlot, Wish's slot condition); trap.source and syrupBomb are Pokémon (their
 * effectState.source). As the turn starts each position holds the Pokémon of that slot id, so the input is the same; they
 * differ only after an Ally Switch this turn.
 */
export type DoublesCarried = {
  /** With build.status "slp": BeforeMoves it has spent asleep since it fell asleep (public `|cant|…|slp` lines) and whether Rest put it to sleep. Absent: 0, not Rest (turn fact). */
  sleep?: { attempts: number; rest: boolean };
  /** With build.status "frz", Champions only: BeforeMoves it has spent frozen. Absent: 0 (turn fact). */
  freeze?: { attempts: number };
  /** Confused from an earlier turn: BeforeMoves it has spent confused (public `-activate|…|confusion` lines); Axe Kick's lasts at least 3. */
  confusion?: { attempts: number; axeKick?: true };
  /** With build.status "tox": the stage before this end of turn (end-of-turn ticks this stint), 0–15. Absent: 0 (turn fact). */
  toxic?: number;
  /** Seeded by the Pokémon at this slot (Leech Seed's sourceSlot). */
  leechSeed?: DoublesSlotId;
  /** Partially trapped by the Pokémon at `source` (Fire Spin, Whirlpool, Bind…); Binding Band: 1/6. `move`: the move that set it, for the residual's name (absent: "Partial trap"). */
  trap?: { source: DoublesSlotId; bindingBand: boolean; move?: string };
  saltCure?: true;
  aquaRing?: true;
  ingrain?: true;
  /** Ghost-type Curse on it. */
  curse?: true;
  /** Syrup Bomb from the Pokémon at this slot. */
  syrupBomb?: DoublesSlotId;
  /** Drowsy from a Yawn that landed last turn: it falls asleep at this end of turn. */
  yawn?: true;
  /** The perish count shown before this turn: this end of turn lowers it; 1 faints now. */
  perish?: 1 | 2 | 3;
  /** A Wish landing on this slot at this end of turn: the HP it restores (half the wisher's maximum HP, truncated). */
  wish?: number;
  /**
   * A Future Sight or Doom Desire landing on this slot (a position) at this end of turn (PS/data/conditions.ts:379-421).
   * A bare move id: its user not given (status2 ADDENDUM2 C33: REASONS.needsLandingUser once E2 lands; until then the end
   * of turn is not estimated). `source`: its user, a Pokémon of this turn (the slot it started in); `build`: its user not in
   * battle now, as it is now (its ability, item and stages do not count: PS/sim/pokemon.ts:858-885). A `source` equal to
   * the slot is valid: the landing does not hit its own user.
   */
  futureMove?: string
    | { move: "futuresight" | "doomdesire"; source: DoublesSlotId }
    | { move: "futuresight" | "doomdesire"; build: BattleBuild };
  /** Cud Chew re-eats this Berry at this end of turn (28.2); true: a Berry, not known which (REASONS.needsCudChewBerry once E2 lands). */
  cudChew?: true | string;
  /**
   * Its Substitute from an earlier turn: the HP it has left (pinned substitute condition hp, PS/data/moves.ts:18335):
   * at most floor(maxHP/4) of the Pokémon that made it, which for a Substitute Shed Tail passed is the Shed Tail user
   * (C13′). Absent: no Substitute.
   */
  substitute?: number;
  /**
   * Scarlet/Violet and Champions: it used Ally Switch last turn (the allyswitch volatile, duration 2, PS/data/moves.ts:333):
   * its use this turn works with 1/allySwitch, then the counter triples (at most 729). 1: not used last turn, no assumption
   * (ADDENDUM2 C23). Absent: not used last turn (a turn fact when it uses Ally Switch).
   */
  allySwitch?: 1 | 3 | 9 | 27 | 81 | 243 | 729;

  // ---- status2 A1: stats, abilities, Transform (SPEC2 §3.1, ADDENDUM2 §3.1) ----
  /**
   * Stockpile from earlier turns: 1–3 layers and the counts its End reverses (PS/data/moves.ts:17961-18008 effectState.def
   * / spd: −1 for each layer whose boost changed the stat, Contrary included; −layers..0: C17). Counts absent: −layers each
   * (the turn fact).
   */
  stockpile?: { layers: 1 | 2 | 3; def?: number; spd?: number };
  /** Power Trick (Power Shift) from an earlier turn: its stored Attack and Defense are swapped. */
  powerTrick?: true;
  powerShift?: true;
  noRetreat?: true;
  minimize?: true;
  /** Gastro Acid from an earlier turn: the build's ability (its real one) is suppressed. */
  gastroAcid?: true;
  /**
   * A two-turn move it charged last turn (the twoturnmove volatile): its action is that move, released with no charge
   * (Power Herb kept); Fly, Bounce, Dig, Dive, Phantom Force and Shadow Force hold it out of reach from the turn's start
   * until its action (T2-SI12b, IN-P03). One of the game's CHARGE_TURN_MOVES, SEMI_INVULNERABLE_MOVES or Geomancy; never
   * Sky Drop (C21, C38).
   */
  charging?: string;
  /** The trapped volatile (Block, Mean Look, Spider Web, Jaw Lock, Anchor Shot, Spirit Shackle, Thousand Waves): No Retreat then adds no volatile. */
  trapped?: true;
  /** Accuracy and evasion stages from earlier turns, −6..6. */
  stages?: { accuracy?: number; evasion?: number };

  // ---- status2 A2: types and volatiles ----
  tarShot?: true;
  /** Foresight or Odor Sleuth; Miracle Eye (never both). */
  foresight?: true;
  miracleEye?: true;
  /** Turns left before this end of turn's countdown; 1: it ends at this end of turn (Telekinesis 19, Heal Block 20, Embargo 21). */
  telekinesis?: 1 | 2;
  healBlock?: 1 | 2 | 3 | 4;
  embargo?: 1 | 2 | 3 | 4;
  nightmare?: true;
  /** The Pokémon at this slot set it: Octolock's source is a foe; Attract's any other Pokémon in the turn. */
  octolock?: DoublesSlotId;
  attract?: DoublesSlotId;

  // ---- status2 D: guards ----
  /** An Opportunist or Mirror Herb copy pending from the last turn's final Update (effectState.boosts): applied at this turn's first AfterMove. */
  copy?: Partial<Record<"atk" | "def" | "spa" | "spd" | "spe" | "accuracy" | "evasion", number>>;
  /** Berserk or Anger Shell: its healing Berry's TryEatItem fails until a reset (abilityState.checkedBerserk false). */
  berryLocked?: true;
  /** Glaive Rush last turn: the damage it takes is doubled until its own next BeforeMove (C5). */
  glaiveRush?: true;
  /** Ripen ate a resist Berry outside a hit: its next damaging hit taken is halved (abilityState.berryWeaken). */
  berryWeaken?: true;

  // ---- status2 H (ADDENDUM2 §3.1) ----
  /** Lock-On or Mind Reader from last turn at the Pokémon that started this turn in that slot (the lockon volatile). */
  lockOn?: DoublesSlotId;

  // ---- status2 N (IN §3.1, with C23) ----
  /**
   * The stall counter after its successful protecting moves in a row ending last turn (Protect, Detect, Endure, the
   * shields, Max Guard; Quick Guard and Wide Guard raise it without rolling it: CQ05); 1: none last turn (no assumption).
   * Its protecting move or Endure this turn works with 1/stall (PS/data/conditions.ts:439-462).
   */
  stall?: 1 | 3 | 9 | 27 | 81 | 243 | 729;
  /** It used a recharge move last turn (mustrecharge, BeforeMove priority 11): its action is No move. */
  mustRecharge?: true;
  /** Destiny Bond from last turn still up (it has not tried to act since: PS/data/moves.ts:3483-3526). */
  destinyBond?: true;
  /** SwSh, USUM: Laser Focus used last turn: every damaging hit it deals this turn is critical where one can be. */
  laserFocus?: true;
  /** Turns left before this end of turn's countdown (1: it ends at this end of turn): Taunt 15, Encore 16, Disable 17. */
  taunt?: 1 | 2 | 3;
  encore?: { move: string; turns: 1 | 2 | 3 };
  disable?: { move: string; turns: 1 | 2 | 3 | 4 };
  /**
   * Generation 9 (SV, Champions): the once-a-battle effects it already had (bondTriggered, swordBoost, shieldBoost,
   * syrupTriggered). Battle Bond only in SV (C22).
   */
  onceUsed?: readonly ("battlebond" | "intrepidsword" | "dauntlessshield" | "supersweetsyrup")[];

  // ---- status2 CL ----
  /** An Uproar from an earlier turn: its turns left as this turn starts (1 or 2); its action is Uproar. */
  uproar?: 1 | 2;

  // ---- status2 PR (T2P §9.1, with C41) ----
  /** Training only (an SV-format build): Tatsugiri inside its ally Dondozo. */
  commanding?: true;
  /** Fury Cutter: its uses in a row before this turn (4: the 160 cap). Rollout, Ice Ball: the lock's hits so far. */
  furyCutter?: 0 | 1 | 2 | 3 | 4;
  rollout?: 0 | 1 | 2 | 3 | 4;
  /** Defense Curl used since it came in (Rollout and Ice Ball ×2). */
  defenseCurl?: true;
  /** PP left before this turn's use, by move id (Trump Card; Instruct's fact). */
  ppLeft?: Record<string, number>;
  /**
   * USUM: a Bide from earlier turns (PS/data/moves.ts:1264-1338): the damage stored so far, the Pokémon that last damaged it,
   * and whether this turn is its release (else it stores, doing nothing at its BeforeMove).
   */
  bide?: { stored: number; source: DoublesSlotId | null; release: boolean };
};

export type DoublesPokemonInput = {
  build: BattleBuild;
  /** The slot's move contexts by move id; the turn reads its action's. turnOrder is ignored: the turn decides it. */
  contexts: Record<string, MoveContext>;
  /** It used Charge on an earlier turn: its next Electric attack doubles. */
  charged: boolean;
  action: DoublesAction;
  carried?: DoublesCarried;
  /** The move it used last before this turn (pinned pokemon.lastMove); null: none since it came in; absent: unknown. */
  lastMove?: string | null;
  /**
   * Every move it has, in move-slot order (Imprison reads its user's, Conversion the first, Sleep Talk its callable ones):
   * the calculator's quick moves plus its chosen move; Training's moveSlots. Absent: unknown.
   */
  moves?: readonly string[];
  /** The item it last used or ate (pinned pokemon.lastItem: Recycle, Harvest); null: none; absent: unknown. */
  lastItem?: string | null;
  /** The target its lastMove was aimed at (Instruct); null: none chosen (a self, side or spread move). Absent: unknown. */
  lastMoveTarget?: DoublesSlotId | null;
  /**
   * It switched in this turn before the moves (its player's switch, Training's prelude): no action (its action must be
   * No move), no BeforeMove, `moved` from the start; Payback is not doubled into it, Bolt Beak and Fishious Rend are,
   * Analytic does not wait for it, Core Enforcer and Helping Hand read it (pokemon.newlySwitched: T2E §4.7.4).
   */
  switchedIn?: true;
  /** Fake Out and First Impression: false, not its first turn since it came in (activeMoveActions > 1). Absent: its first (the existing fact). */
  firstTurn?: boolean;
  /**
   * What happened to it earlier this turn, before the first move (a switch-in's entry effects; on the battle's first turn
   * the leads'): pinned statsRaisedThisTurn, statsLoweredThisTurn, usedItemThisTurn, which nextTurn clears only from turn 2
   * and before the switches (PS/sim/battle.ts:1670-1683, 2083-2086; ADDENDUM2 C19). Absent: none.
   */
  earlierThisTurn?: { statsRaised?: true; statsLowered?: true; usedItem?: true };
};

export type DoublesTurnInput = {
  runtime: BattleRuntime;
  /**
   * The field before the turn: weather, terrain, rooms, Gravity, Critical hit. attackerSide is your side and defenderSide the
   * opponent's (Reflect, Light Screen, Aurora Veil, Tailwind). gameType is treated as "Doubles"; multipleTargets, fairyAura and
   * the side flags helpingHand, friendGuard, priorityShield, protect and charge are worked out from the four Pokémon and their
   * actions, and ignored here.
   */
  field: BattleConditions;
  /**
   * null: no Pokémon in that slot, as when its Pokémon fainted with no replacement left (the 2v2 UI passes a Pokémon at 0 HP
   * so). As pinned Showdown skips a fainted active Pokémon (sim/side.ts allies, sim/pokemon.ts isAdjacent, sim/battle.ts
   * runEvent), it takes no action, is no target (a move aimed at it goes to the other foe), a spread move counts only the
   * Pokémon in place, and its partner gets none of its effects; Last Respects counts it among its side's fainted
   * (side.totalFainted). With both foe slots empty, a move that can reach a foe has no target and no step.
   */
  pokemon: Record<DoublesSlotId, DoublesPokemonInput | null>;
  /** Turns the weather has left before this turn's countdown (1: it ends at this end of turn without acting). Absent: it lasts (turn fact when it acts). */
  weatherTurns?: number;
  /**
   * Whether each side has a Pokémon left to switch in (S moves, Healing Wish, Lunar Dance, Roar, Whirlwind). Absent: true (turn
   * fact when read). status2 R: a side's `bench`, where given, takes its place (sideCanSwitch).
   */
  canSwitch?: Partial<Record<DoublesSideId, boolean>>;
  /**
   * The names the page shows for the four slots (doublesNames over every slot's Pokémon, a fainted one's too), so the
   * turn's text names each Pokémon as its card does. Absent: doublesNames of `pokemon` (turnNames).
   */
  names?: Record<DoublesSlotId, string>;
  /**
   * Turns left before this turn's countdown of a field effect up as the turn starts (1: it ends at this end of turn: Gravity
   * 27.2, Magic Room 27.6, the terrain 27.7). Absent: it lasts (the existing facts). weatherTurns stays the weather's.
   */
  fieldTurns?: Partial<Record<"terrain" | "gravity" | "magicRoom", number>>;
  /**
   * When each Pokémon's ability state began (abilityState.effectOrder: its switch-in, or a later ability change), smaller
   * first; equal or missing ranks are not ordered against each other (C37). Absent: unknown. The leads of a battle's first
   * turn are, in order, own-left, own-right, opponent-right, opponent-left (p1a, p1b, p2a, p2b: CQ09).
   */
  entryOrder?: Partial<Record<DoublesSlotId, number>>;
  /** The last move used in the battle before this turn, by any Pokémon (battle.lastMove: Copycat); null: none. */
  battleLastMove?: string | null;
  /** Per side: a Pokémon of the side fainted last turn (side.faintedLastTurn: Retaliate). Absent: unknown. */
  faintedLastTurn?: Partial<Record<DoublesSideId, boolean>>;
  /** The echoedvoice pseudo-weather's multiplier after last turn, 1–5; 0: none last turn. Absent: unknown (C25). */
  echoedVoice?: 0 | 1 | 2 | 3 | 4 | 5;

  // ---- status2 R (SPEC2 §4.8, F4 §5.4, IN §3.1 and §5.7, ADDENDUM2 §8.7 Step 2): switch-outs with a replacement ----
  /**
   * Each side's living bench, in order (the calculator's Bench in roster order; Training's party). Where given it takes
   * canSwitch's place (sideCanSwitch: a Pokémon is left to switch in exactly when the list is not empty), and a switch-out
   * of that side is followed with its replacement (doubles-switch.ts replaceSlot). Absent: not known (a switch with a later
   * action is not estimated: REASONS.switchesOut; with none the end of turn is not).
   */
  bench?: Partial<Record<DoublesSideId, readonly DoublesBenchPokemon[]>>;
  /**
   * The bench Pokémon (its id) that comes in for the Pokémon that started the turn in this slot when its own player picks a
   * replacement mid-turn: U-turn, Volt Switch, Flip Turn, Parting Shot, Teleport, Baton Pass, Shed Tail, Chilly Reception,
   * Eject Button, Eject Pack, Emergency Exit, Wimp Out. Absent with a bench: the first bench Pokémon not in play then (the
   * turn fact `Assumes {Newcomer} comes in for {Name}.`). A random drag (Roar, Whirlwind, Dragon Tail, Circle Throw, Red
   * Card) reads none: one outcome per living bench Pokémon.
   */
  replacement?: Partial<Record<DoublesSlotId, string>>;
  /**
   * status2 R (Training, USER-DECISIONS Q9): how a side's player picks a replacement `replacement` does not give (a newcomer
   * that leaves again, or a slot with no `replacement`): "healthiest", the bench Pokémon with the highest HP share at that
   * switch (a Pokémon that left earlier this turn included; ties in team order), as Training's rollouts pick for the player;
   * a list of ids (bench ids and slots' startIds), the first one still on the bench. Such a pick states no fact; the leavers of
   * one side and request pick in their positions' order. Absent: the default (`replacement`'s doc).
   */
  replacementOrder?: Partial<Record<DoublesSideId, "healthiest" | readonly string[]>>;
  /** The hazards on each side as the turn starts (a newcomer's entry reads them; Defog, Court Change, Tidy Up, Rapid Spin and Mortal Spin move or clear them). Absent: none. */
  hazards?: Partial<Record<DoublesSideId, DoublesHazards>>;
};

/** The names the turn's text uses: the input's `names`, else doublesNames of its Pokémon ("" for an empty slot). */
export function turnNames(input: Pick<DoublesTurnInput, "pokemon" | "runtime" | "names">): Record<DoublesSlotId, string> {
  return input.names ?? doublesNames(input.pokemon, input.runtime);
}

// ---------- status2 R: the bench, the replacement and the hazards (SPEC2 §4.8, F4 §5.4, IN §3.1, ADDENDUM2 §8.7) ----------

/**
 * A Pokémon on a side's bench (not in play) under an id the caller keeps (never of the form `slot:…`, which names a slot's
 * starting Pokémon: startId): its build as it is now (its HP in currentHP, 1 to its maximum; its status, item, form) and the
 * state from earlier turns it keeps on the bench: its sleep and freeze counters (DoublesCarried's meaning) and generation 9's
 * once-a-battle effects. Bad poison is not carried: its stage restarts at 0 as it comes in (PS/data/conditions.ts tox
 * onSwitchIn). `moves`: every move it has, in move-slot order (Assist's party: PS/data/moves.ts assist reads each other party
 * member's moveSlots; ADDENDUM2 §8.7); absent: unknown.
 */
export type DoublesBenchPokemon = {
  id: string; build: BattleBuild; carried?: Pick<DoublesCarried, "sleep" | "freeze" | "onceUsed">;
  moves?: readonly string[];
};

/** The hazards on one side as the turn starts (DoublesTurnInput.hazards); each absent: not up. */
export type DoublesHazards = {
  stealthRock?: true;
  /** Spikes layers. */
  spikes?: 1 | 2 | 3;
  /** Toxic Spikes layers (2: bad poison). */
  toxicSpikes?: 1 | 2;
  stickyWeb?: true;
  /** SwSh: G-Max Steelsurge, a Steel-type Stealth Rock. */
  steelsurge?: true;
};

/**
 * A slot whose Pokémon left during the turn and what came in (DoublesTurnResult.replaced; the end of turn's for a switch
 * after the residual). The ids are startId(slot) for the slot's starting Pokémon and the bench ids for the others.
 */
export type DoublesReplaced = {
  /**
   * Each Pokémon that left the slot, in the order it left (the slot's starting Pokémon first): its HP as it left (after its
   * switch-out effects: Regenerator) over the outcomes in which it left, and that share of the turn.
   */
  left: { id: string; hp: DoublesHP; chance: number }[];
  /** Each Pokémon that came in, with the share of the turn in which it did (a random drag: one per bench Pokémon). */
  entered: { id: string; chance: number }[];
};

/** One Pokémon that left its slot during the turn, as an outcome (DoublesOutcome.benched): its state on the bench now. */
export type DoublesBenchedMon = DoublesOutcomeMon & {
  /** startId(slot) for a slot's starting Pokémon, else its bench id. */
  id: string;
  /** The slot it left, as DoublesOutcome.mons keys it (the slot it, or the Pokémon it came in for, started the turn in). */
  slot: DoublesSlotId;
};

/** The id a slot's starting Pokémon goes by in the R fields (MonState.id absent; DoublesReplaced, DoublesOutcome.benched): `slot:{slot}`. */
export function startId(slot: DoublesSlotId): string {
  return `slot:${slot}`;
}

/**
 * Whether `side` has a Pokémon left to switch in (sim/battle.ts canSwitch): its bench where given (a Pokémon is left exactly
 * when it is not empty), else the input's canSwitch; undefined when neither is given (the turn assumes one is left, a turn
 * fact). Every reader of canSwitch reads it through here, so a bench takes canSwitch's place (F4 §5.4).
 */
export function sideCanSwitch(input: Pick<DoublesTurnInput, "bench" | "canSwitch">, side: DoublesSideId): boolean | undefined {
  const bench = input.bench?.[side];
  return bench ? bench.length > 0 : input.canSwitch?.[side];
}

/** The bench Pokémon's names the turn's text uses, by id (doublesBenchNames of the input); empty without a bench. */
export function turnBenchNames(input: Pick<DoublesTurnInput, "pokemon" | "runtime" | "bench">): Record<string, string> {
  return input.bench ? doublesBenchNames(input.pokemon, input.bench, input.runtime) : {};
}

/** Which targets the move a slot would use can take, as chosen in the game (doubles-targets.ts). */
export type DoublesTargetRule =
  /** The player picks one: present slots, in the order left foe, right foe, ally, itself; none when both foe slots are empty and the move can reach a foe. */
  | { kind: "choose"; options: DoublesSlotId[] }
  /** Showdown picks: every slot listed (foes screen-left first, then the ally), or one living foe at random; none when both foe slots are empty. */
  | { kind: "auto"; hits: DoublesSlotId[]; random?: true }
  /** No Pokémon target. */
  | { kind: "none"; scope: "self" | "self-and-ally" | "own-side" | "foe-side" | "field" | "own-team" | "last-attacker" };

/** A fact and the share of the turn (0–1) in which it holds; 1 when it always does. */
export type DoublesFact = { text: string; chance: number };

/**
 * One Pokémon's HP after the turn's moves (DoublesTurnResult.hp: no end of turn) or after the whole turn
 * (DoublesEndOfTurn.hp), in the HP its bar shows (Dynamax HP while Dynamaxed).
 */
export type DoublesHP = {
  /** HP when the first move starts (after an item used as the turn starts, `settled`). */
  start: number;
  maximum: number;
  settled?: SettledHP;
  /** Its most likely HP when every damage roll of the turn is its lowest and every random hit count its fewest; ties go to the higher HP. */
  low: number;
  /** Expected HP over every outcome (exact, unrounded). */
  average: number;
  /** Its most likely HP when every damage roll is its highest and every random hit count its most; ties go to the lower HP. */
  high: number;
  /** The least and the most HP over every outcome. */
  min: number;
  max: number;
  /** Chance (0–1) it has fainted by the end of the moves (or of the turn, in DoublesEndOfTurn.hp); below 1 unless certain (uses-to-ko.ts uncertain). */
  koChance: number;
  /** HP it regains on some outcome, as facts ("Sitrus Berry: +58 HP."). */
  heals: string[];
  /** Chance (0–1) it faints before its own move; set when it has a move and the chance is above 0. */
  faintsBeforeMoving?: number;
  /** HP it lost outside any step: a No-move Pokémon's confusion self-hit ("Garchomp hurts itself in confusion: 23–28 HP."). */
  losses?: DoublesFact[];
  /** Its statuses and volatiles at this point, with chances ("Paralysed.", "Confused.", "Drowsy.", "Leech Seed.", "Perish count 3.", "Substitute: 35 HP."). Absent: none. */
  conditions?: DoublesFact[];
};

/** One Pokémon a move reaches. */
export type DoublesHit = {
  slot: DoublesSlotId;
  /** status2 R: the Pokémon it reached when that is not the slot's starting Pokémon (a newcomer: its bench id). Absent: the starting Pokémon. */
  id?: string;
  /** Share of the turn in which this move reached this slot, after redirection, retargeting and failures. */
  reached: number;
  /**
   * "blocked": a TryHit blocker stopped it (Protect, Wide Guard, Quick Guard, Telepathy, an absorbing ability; for a
   * status move also Magic Bounce, Good as Gold, Soundproof, powder blockers); "no-damage": it reached and dealt nothing
   * (immune: types, Prankster vs Dark, a move's own immunity, a Substitute against a status move); "effect": a status move
   * reached it and acted (its facts say what, failures included); "substitute": every outcome of this move met a
   * Substitute in front of this Pokémon and none reached the Pokémon itself (min, max, minPercent, maxPercent null;
   * koChance 0; row: the calculation into the Substitute).
   */
  kind: "calculated" | "blocked" | "no-damage" | "effect" | "substitute";
  /** HP a status move changed on it over every outcome (heal +, cost −, Pain Split either); absent when none. */
  change?: { min: number; max: number };
  /**
   * The hits that met its Substitute (PS/data/moves.ts:18342-18372): `chance`, the share of the turn in which they did;
   * `min`/`max`, the HP the Substitute lost over those outcomes (capped at its HP); `breaks`, the share in which it broke.
   * With kind "calculated", min/max/koChance are the hits that reached the Pokémon (no Substitute, or after it broke).
   * Absent: it never met one.
   */
  substitute?: { chance: number; min: number; max: number; breaks: number };
  /** Damage over every calculation it met (not capped at HP); null unless calculated. */
  min: number | null;
  max: number | null;
  minPercent: number | null;
  maxPercent: number | null;
  /** Share of the turn in which this hit knocked it out; a Pokémon's hit chances add up to its koChance. */
  koChance: number;
  /** The calculation it met most often (the 1v1 row: hits, hitChances, description, assumptions); absent for blocked hits. */
  row?: MoveDamageResult;
  /** Distinct calculations it met (HP-based damage, a Berry used, Multiscale broken...). */
  cases: number;
  facts: DoublesFact[];
};

/** One move of the turn. */
export type DoublesStep = {
  slot: DoublesSlotId;
  moveId: string;
  /** The move it uses, when that differs (Z-Move, Max Move, form): name and type. */
  effectiveName?: string;
  effectiveType?: string;
  /** 1-based position among the slots with a move, with chances; one entry when certain. */
  order: { position: number; chance: number }[];
  /** Share of the turn in which it uses its move. */
  moves: number;
  /** Why it does not use it ("Faints before it moves.", "Flinches (Fake Out).", "Fully paralysed."). */
  skipped: DoublesFact[];
  /** Each Pokémon it can reach, in the order Showdown hits them. */
  hits: DoublesHit[];
  /** Redirection, retargeting, Helping Hand, failures, and effects on the user (recoil, Life Orb, Rocky Helmet, drain). */
  facts: DoublesFact[];
  /** status2 (T2P §2.3, §3.13): a second step of the same Pokémon this turn, a Dancer's copy or an instructed move. */
  copied?: "Dancer" | "Instruct";
  /**
   * status2 R: the step's Pokémon when it is not the slot's starting Pokémon (a newcomer's Dancer copy: its bench id; or
   * startId(other slot) when that slot's starting Pokémon came back in here). Absent: the slot's starting Pokémon.
   */
  id?: string;
};

/** A move's damage into one Pokémon at the start of the turn, before any move (calculateDoublesMoves). */
/**
 * A damaging move's damage into a Pokémon it reaches at the start of the turn. `fact`: where the move goes then, when
 * that is not its chosen target ("Lightning Rod: Raichu takes Thunderbolt."), or the Pokémon that takes it once a move
 * of this turn has been used ("Follow Me: Clefairy takes Dragon Claw if Follow Me comes first.").
 */
export type DoublesStartRow = { slot: DoublesSlotId; target: DoublesSlotId; row: MoveDamageResult; fact?: string };
export type DoublesIssues = {
  pokemon: Partial<Record<DoublesSlotId, BuildIssue[]>>;
  field: BuildIssue[];
  actions: { slot: DoublesSlotId; message: string }[];
};
export type DoublesStart = Record<DoublesSlotId, { hp: number; maximum: number; settled?: SettledHP } | null>;

/** One residual on one Pokémon, aggregated over the turn's worlds. */
export type DoublesResidual = {
  slot: DoublesSlotId;
  /** status2 R: the Pokémon it acted on when that is not the slot's starting Pokémon (a newcomer: its bench id). Absent: the starting Pokémon. */
  id?: string;
  /** "Sandstorm", "Leftovers", "Burn", "Bad poison", "Leech Seed", "Fire Spin", "Bad Dreams", "Healer", "Sitrus Berry"... */
  effect: string;
  /** The other Pokémon of a two-Pokémon residual: Leech Seed's seeder or seeded, the Bad Dreams or Healer holder. */
  other?: DoublesSlotId;
  /**
   * status2 R: the Pokémon at `other` when that is not the slot's starting Pokémon (a newcomer at a seeder's or a Healer's
   * place: its bench id; or startId(other slot) when that slot's starting Pokémon came back in here); null where it differs
   * between the turn's outcomes (no one Pokémon to name). Absent: `other`'s starting Pokémon.
   */
  otherId?: string | null;
  /** Share of the turn in which it acted on this Pokémon. */
  chance: number;
  /** HP change where it acted (negative = damage); null when it changes no HP. */
  min: number | null;
  max: number | null;
  /** Hits' and residuals' KO chances add up to endOfTurn.hp[slot].koChance. */
  koChance: number;
  /** "Cures its poison.", "Falls asleep.", "Speed +1.", "Perish count 2.", "Switches out after the turn." */
  facts: DoublesFact[];
};
/** The end of the turn (SPEC §2.3): ready with every Pokémon's HP after the residuals, or not estimated with a fact reason (the moves stay estimated). */
export type DoublesEndOfTurn =
  | {
    status: "ready"; hp: Record<DoublesSlotId, DoublesHP | null>; residuals: DoublesResidual[]; facts: string[];
    /** status2 R: the newcomers' HP after the whole turn, by slot and bench id (DoublesTurnResult.hpEntered's after the end of turn). */
    hpEntered?: Partial<Record<DoublesSlotId, Record<string, DoublesHP>>>;
    /** status2 R: the switch-outs after the residual (Eject Pack at order 29, Emergency Exit and Wimp Out), with their replacements. */
    replaced?: Partial<Record<DoublesSlotId, DoublesReplaced>>;
  }
  | { status: "not-estimated"; reason: string };

export type DoublesTurnResult =
  | { status: "issues"; issues: DoublesIssues }
  | { status: "not-estimated"; reason: string; start: DoublesStart | null; startRows: DoublesStartRow[]; facts: string[] }
  | {
    status: "ready";
    start: DoublesStart;
    /**
     * Slots with a move only, by mean position (slot order on ties). Empty when no slot has a move. A move with no target
     * because both foe slots are empty has no step (the fact "No target: both foes have fainted.").
     */
    steps: DoublesStep[];
    /** After the moves (no end of turn). */
    hp: Record<DoublesSlotId, DoublesHP | null>;
    startRows: DoublesStartRow[];
    /** §2.3. */
    facts: string[];
    /** Ally Switch: the chance each side's two Pokémon stand swapped after the moves; absent when 0. Slots stay the Pokémon as they started. */
    swapped?: Partial<Record<DoublesSideId, number>>;
    /** The end of the turn after the moves: HP after the whole turn, or why it is not estimated. */
    endOfTurn: DoublesEndOfTurn;
    /**
     * status2 R: each slot whose Pokémon left during the moves with a replacement (a bench given): who left at what HP and who
     * came in. Absent: none. hp[slot] stays the slot's starting Pokémon's (where it left, its HP as it left).
     */
    replaced?: Partial<Record<DoublesSlotId, DoublesReplaced>>;
    /** status2 R: each newcomer's HP after the moves, by slot and bench id (its card below the leaver's line). Absent: none. */
    hpEntered?: Partial<Record<DoublesSlotId, Record<string, DoublesHP>>>;
  };

// ---------- The turn as finished worlds (calculateDoublesOutcomes; Training AI, SPEC E2) ----------

/** One Pokémon in one outcome: at the end of the moves, or after the turn when the result's endOfTurn is "applied". */
export type DoublesOutcomeMon = {
  /** HP distribution (chances sum to 1) from the world's marginal (doubles-world.ts marginal), ascending by HP. */
  hp: { hp: number; chance: number }[];
  /**
   * The world's MonState.build: stages, status, item, ability, form (currentHP unused). build.itemId is the world's item
   * after Trick, Switcheroo, Knock Off or an eaten Berry.
   */
  build: BattleBuild;
  /** A protecting move of its succeeded this turn (MonState.protect). */
  protected: boolean;
  /** Its action was picked this turn (MonState.moved). */
  moved: boolean;
  /**
   * Showdown volatile ids the next turn's value reads: confusion, taunt, encore, yawn, leechseed, perishsong, substitute,
   * curse, saltcure, aquaring, ingrain, partiallytrapped; "substitute" while one stands and "allyswitch" after a use this
   * turn that passed its PrepareHit (Scarlet/Violet, Champions). Absent: none.
   */
  volatiles?: string[];
  /** Asleep: expected remaining sleep counter (Showdown statusState.time; Early Bird counts each BeforeMove twice). */
  sleepTurns?: number;
  /** Perish count after this turn (3, 2, 1). */
  perishCount?: number;
  /** Its Substitute's HP after the turn, chances summing to 1; present exactly when volatiles has "substitute". */
  substitute?: { hp: number; chance: number }[];
  /** Scarlet/Violet, Champions: the Ally Switch counter after this turn's use (the next use works 1/counter). */
  allySwitch?: number;
  // ---- status2 (SPEC2 §3.1, ADDENDUM2 §3.1); each absent unless the turn sets it. DoublesOutcomeMon.build may now carry
  // storedStats, weighthg, types, addedType, itemSuppressed and abilityChanged. volatiles gains "stockpile", "powertrick",
  // "powershift", "noretreat", "minimize", "gastroacid", "transform", "trapped", "twoturnmove", "geomancy", "attract",
  // "octolock", "tarshot", "foresight", "miracleeye", "telekinesis", "embargo", "nightmare", "glaiverush" ("healblock"
  // exists), the hidden move's id beside "twoturnmove", "skydrop", "lockon", "uproar", "gmaxchistrike", "commanding",
  // "commanded"; "taunt", "encore", "disable" only while turns are left. ----
  /** Stockpile after the turn; present exactly when volatiles has "stockpile". */
  stockpile?: { layers: number; def: number; spd: number };
  /** Accuracy and evasion stages after the turn; absent when both are 0. */
  stages?: { accuracy?: number; evasion?: number };
  /** A transformed Pokémon's moves (its target's); present exactly when volatiles has "transform". */
  moves?: string[];
  /** An Opportunist or Mirror Herb copy still pending after the final Update (A11). */
  pendingCopy?: Partial<Record<"atk" | "def" | "spa" | "spd" | "spe" | "accuracy" | "evasion", number>>;
  /** The item it last used or ate this turn or before (item history; only when tracked). */
  lastItem?: string;
  berryLocked?: true;
  berryWeaken?: true;
  /** Turns left after this turn's countdown. */
  turnsLeft?: Partial<Record<"healblock" | "embargo" | "telekinesis" | "taunt" | "encore" | "disable" | "uproar", number>>;
  /** The two-turn move it charged this turn (its release next turn); present exactly when volatiles has "twoturnmove". */
  charging?: string;
  /** Generation 9's once-a-battle effects after the turn. */
  onceUsed?: string[];
  /** G-Max Chi Strike layers (SwSh). */
  chiStrike?: 1 | 2 | 3;
  /** The Berry Cud Chew re-eats at the next end of turn. */
  cudChew?: string;
  /**
   * status2 R: the occupant at the end when it is not the slot's starting Pokémon (a newcomer: its bench id; or startId(other
   * slot) when that slot's starting Pokémon came back in here). Absent: the starting Pokémon.
   */
  id?: string;
};
/** status2 (SPEC2 §3.1): the side conditions whose clock an outcome reports (DoublesOutcome.sides.clock). */
export type SideClockFlag = "reflect" | "lightScreen" | "auroraVeil" | "tailwind" | "safeguard" | "mist" | "luckyChant";
export type DoublesOutcome = {
  /** The world's mass; outcomes' chances sum to 1. */
  chance: number;
  mons: Partial<Record<DoublesSlotId, DoublesOutcomeMon>>;
  sides: Record<DoublesSideId, {
    reflect: boolean; lightScreen: boolean; auroraVeil: boolean; tailwind: boolean; faintedThisTurn: number;
    /** Safeguard up on the side. Absent: not up. */
    safeguard?: boolean;
    /** Hazard move ids that landed on this side this turn. Absent: none. */
    hazards?: string[];
    // ---- status2 (SPEC2 §3.1, ADDENDUM2 §3.1); each absent unless set ----
    mist?: boolean; luckyChant?: boolean;
    /** The clock each condition up on this side now runs on: absent key, this side's own pre-turn clock; "set", set this turn. */
    clock?: Partial<Record<SideClockFlag, DoublesSideId | "set">>;
    /** The pre-turn hazards this side holds now: absent its own; the other side's after an odd number of Court Changes; null once cleared. */
    hazardsFrom?: DoublesSideId | null;
    /** Aromatherapy or Heal Bell cured this side's Pokémon not in battle. */
    benchCured?: true;
    /** The Pledges' side conditions (fire: the sea of fire, grass: the swamp, water: the rainbow): turns left. */
    pledge?: Partial<Record<"fire" | "grass" | "water", number>>;
    /** SwSh: the G-Max side conditions up (move ids). */
    gmax?: string[];
  }>;
  field: Pick<BattleConditions, "weather" | "terrain" | "gravity" | "trickRoom" | "wonderRoom" | "magicRoom" | "mudSport" | "waterSport">;
  /** status2 (SPEC2 §3.1): rooms, Sports, Gravity and Trick Room up now and set during this turn (a fresh duration). Absent: none. */
  fieldSet?: Partial<Record<"magicRoom" | "wonderRoom" | "trickRoom" | "gravity" | "mudSport" | "waterSport", true>>;
  /** Within this outcome, the chance every present Pokémon of the side is at 0 HP (from the joint factors); 1 with none present. */
  allFainted: Record<DoublesSideId, number>;
  /** Ally Switch: each side's two Pokémon stand swapped after the turn, or not. mons stay keyed by the slot each started in. */
  positions: Record<DoublesSideId, "kept" | "swapped">;
  /**
   * status2 R: the Pokémon that left each side's slots during the turn and are on its bench now, with their ids and their
   * state as they left (mons[slot] is then the occupant at the end, with its id). Absent: none.
   */
  benched?: Partial<Record<DoublesSideId, DoublesBenchedMon[]>>;
};
export type DoublesOutcomesResult =
  | { status: "issues"; issues: DoublesIssues }
  | { status: "not-estimated"; reason: string }
  | {
    status: "ready"; start: DoublesStart; outcomes: DoublesOutcome[];
    /** "applied": the outcomes are after the whole turn; otherwise they are after the moves and the end of turn is not estimated (why). */
    endOfTurn: "applied" | { notEstimated: string };
  };

// One seat's public view of the battle, built only from that seat's protocol channel (SPEC §8): a pure function of
// strings. It never imports battle-host and never sees a request. Rules R1–R12 are SPEC §8.3; line formats are pinned
// Showdown's (sim/battle.ts add(), data/*.ts messages).
import type { BattleStatus } from "@/app/lib/battle/types";
import type {
  DamageObservation, EntryObservation, ExactHP, HitSnapshot, ObservedAction, OrderObservation, PublicCondition, PublicMon,
  PublicState, PublicVolatile, RevealObservation, ShownHP, SpeedSnapshot, TurnObservations,
} from "../model/public-state";
import type { BoostId, SideID } from "../model/showdown-types";

export type PublicTracker = {
  push(lines: readonly string[]): void;
  /**
   * status2 R-T: the viewer's own choice for its current request, once the battle took it (a choice string: "move 1 2, move
   * 3"), before the lines it plays. Its own Pokémon's last move then keeps the target it was chosen at (pinned
   * pokemon.lastMoveTargetLoc: the action's targetLoc), where its move line names none ("[still]": Future Sight into a slot
   * already holding one) or another (a retarget, a redirection). The viewer's own choices are its own knowledge.
   */
  chose(choice: string): void;
  state(): PublicState;
  observations(): TurnObservations[];
};

/**
 * Public counts the 2v2 end of turn and status moves read (status-eot SPEC §6, ADDENDUM §6), kept on the exported
 * PublicMon beside its fields (plain JSON; absent: none): `restSleep`, its sleep came from Rest (`-status|X|slp|[from]
 * move: Rest`: three turns); `allySwitchStreak`, consecutive turns its Ally Switch passed its PrepareHit (the next use works
 * with 1/3^streak); `itemSince`, the `actions` count when Trick or Switcheroo gave it its item (a Choice item received
 * during or after its last move locks nothing yet); `choiceMove`, the move a Choice item locks it into: its first move
 * this stint since an item last reached it (pinned data/items.ts choicescarf onModifyMove adds choicelock, whose onStart
 * keeps that move; a later move, a forced Struggle included, does not change it; a Choice item's onStart removes the
 * lock, and a lock begun by Struggle ends at the next DisableMove, so the move after it locks instead).
 *
 * status2 Step 1 #11 (ADDENDUM2 C19): `thisTurn`, what happened to it this turn as pinned Showdown's per-turn flags count it:
 * a `-boost` / `-unboost` that changed a stage (statsRaisedThisTurn, statsLoweredThisTurn: sim/battle.ts:2083-2086; a
 * "-boost … 0" line changed nothing) and an item used or eaten (usedItemThisTurn: sim/pokemon.ts eatItem's `[eat]`, useItem's
 * line with no [from] but a Gem's, Red Card's [of], Fling's `[from] move: Fling`; not a popped Air Balloon, Knock Off, a
 * theft or `[from] stealeat`). nextTurn clears them from turn 2 only (sim/battle.ts:1670-1683), before the `|turn|` line, so
 * the leads' entry lines before `|turn|1` count on turn 1.
 * status2 Step 1 #16 (T2E §4.2.3): `cudChew`, the Berry it ate this stint (`-enditem|X|Berry|[eat]`, not stolen) and the turn
 * it was eaten, until Cud Chew re-eats it (`-activate|X|ability: Cud Chew`) or it switches out: a Cud Chew holder's Berry
 * due at this turn's end (PS/data/abilities.ts cudchew: counter 2 when eaten in the moves, 1 at the residual).
 */
export type PublicCounts = {
  restSleep?: true; allySwitchStreak?: number; itemSince?: number; choiceMove?: string;
  thisTurn?: { statsRaised?: true; statsLowered?: true; usedItem?: true };
  cudChew?: { berry: string; turn: number };
  /**
   * status2 T1 (SPEC2 §6; C15): pinned pokemon.lastItem, the item it last used or ate (sim/pokemon.ts useItem and eatItem,
   * Fling's volatile: data/moves.ts fling): an `-enditem` with `[eat]` (not `[from] stealeat`), with no `[from]` but a popped
   * Air Balloon (its item set to "" directly), `[from] gem` or `[from] move: Fling`. Kept across switches (only generation 4
   * moves it); Recycle and Harvest restore it and clear it (`-item … [from] move: Recycle` / `ability: Harvest`), Pickup clears
   * its target's. Absent: none. `lastItemUnknown`: a Pickup took an item one of several Pokémon had used (its line names only
   * the picker), so whose was cleared is not public.
   */
  lastItem?: string; lastItemUnknown?: true;
  /**
   * status2 T1: the stored-stat changes of this stint since its form last changed (pinned sim/pokemon.ts setSpecies resets
   * storedStats): Power Split, Guard Split and Speed Swap (`-activate|X|move: …|[of] Y`, data/moves.ts onHit), each Power Trick
   * or Power Shift toggle (`-start` / `-end`), Transform (`-transform`, which copies its target's), in log order (`seq`). Each
   * partner's state at that moment is in `partner`, as its stats then depend on its own changes (belief-battle.ts replays them).
   */
  stored?: StoredEvent[];
  /**
   * status2 T1: what a Berserk or Anger Shell holder's checkedBerserk / checkedAngerShell can be (Champions:
   * data/mods/champions/abilities.ts onDamage sets it false for a single-hit move's damage; AfterMoveSecondary sets it true,
   * except after a Sheer Force move with secondaries, PS/sim/battle-actions.ts afterMoveSecondaryEvent): `confusion` (a
   * confusion self-hit: no AfterMoveSecondary), `move` (the last single-hit damage, from `by` with `move`: false only if `by`
   * has Sheer Force and the move secondaries), `unknown` (a move reached it since without damage, whose AfterMoveSecondary may
   * have reset it). Absent: true or never set (not locked). Kept for every Pokémon: the ability is read by the bridge.
   */
  berserk?: { kind: "confusion" } | { kind: "move"; by: string; move: string } | { kind: "unknown" };
  /**
   * status2 T1: Ripen's abilityState.berryWeaken (data/abilities.ts ripen): true after it ate a resist Berry outside a hit (an
   * `[eat]` line with no `[weaken]` line after it: Teatime, a flung Berry), until the next damage calculation into it (a
   * `-damage` line or a hit Substitute from another Pokémon's move) or another Berry. Absent: false.
   */
  ripen?: "weaken";
  /**
   * status2 T1: positive stage changes of the other side's Pokémon after this turn's residual (the final Update, `|upkeep|`
   * on), not copied yet: an Opportunist holder copies them at its next application point (data/abilities.ts opportunist
   * onFoeAfterBoost, onAnySwitchIn, onAnyAfterMega, onAnyAfterMove, residual 29). Cleared at a switch-in, a Mega Evolution,
   * a move and the next residual.
   */
  copyRises?: Partial<Record<BoostId, number>>;
  /** status2 T1: Protean or Libero changed its type this entry (`[from] ability: Protean` / `Libero`; its ability state's flag). */
  typeChanger?: true;
  /**
   * status2 T2 (ADDENDUM2 §6 entryOrder): when its ability state began, a battle-wide count (pinned initEffectState's
   * effectOrder, which orders the RedirectTarget and SwitchIn ties and Dancer's): its switch-in (`switch`, `drag`; the leads in
   * p1a, p1b, p2a, p2b order), a Mega Evolution or another permanent form change (setAbility from formeChange; not Disguise's or
   * Ice Face's), Transform, Skill Swap (its user first: PS/sim/battle.ts skillSwap), and an ability given by a move or an
   * ability (`-ability … [from]`, Mummy, Wandering Spirit). Cleared as it leaves.
   */
  entry?: number;
  /**
   * status2 T2: generation 9's once-a-battle effects it has had (pinned pokemon syrupTriggered, swordBoost, shieldBoost,
   * bondTriggered, kept across switches): `-ability|X|Supersweet Syrup` / `Intrepid Sword` / `Dauntless Shield` with no
   * [from], `-activate|X|ability: Battle Bond`.
   */
  onceUsed?: ("battlebond" | "intrepidsword" | "dauntlessshield" | "supersweetsyrup")[];
  /**
   * status2 T2: its last move's chosen target (pinned pokemon.lastMoveTargetLoc, the choice's) may not be the one its move
   * line names: a redirection (a foe's Follow Me or Rage Powder up, a Lightning Rod or Storm Drain `-activate` in the move),
   * a retarget (a Pokémon of the target's side fainted earlier that turn), an Encore that started that turn before it moved
   * (onOverrideAction), or an Ally Switch earlier that turn. lastMoveTarget is then not public.
   */
  lastTargetUnknown?: true;
};
/** status2 T1: one stored-stat change (PublicCounts.stored). `partner`: the other Pokémon's species and own changes before it. */
export type StoredEvent = {
  seq: number; move: "powersplit" | "guardsplit" | "speedswap" | "powertrick" | "powershift" | "transform";
  /** For Transform, `ability`: its target's ability then when a change had given it another (Skill Swap, Trace...); absent: its
   *  own (Transform copies it as it was: a later change of the target's is not its). */
  partner?: { key: string; speciesId: string; stored: StoredEvent[]; ability?: string };
};
/**
 * status2 T1: a Stockpile's public record: `def` and `spd` are its counts (pinned data/moves.ts stockpile effectState.def /
 * spd: −1 for each layer whose boost changed the stat, Contrary included: ADDENDUM2 C17), from each use's `-boost` /
 * `-unboost` lines (an amount of 0 changed nothing).
 */
export type StockpileVolatile = PublicVolatile & { def?: number; spd?: number };
export const countsOf = (mon: PublicMon): PublicCounts => mon as PublicMon & PublicCounts;
/**
 * A Substitute stint's public record (ADDENDUM §6): `sourceKey` the Pokémon whose `-start|X|Substitute` began it (Baton
 * Pass and Shed Tail copy it), `hits` the `-activate|X|move: Substitute|[damage]` lines since (its HP after a hit is hidden).
 */
export type SubstituteVolatile = PublicVolatile & { hits?: number };

export const toID = (text: unknown) => String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
const BOOSTS: readonly BoostId[] = ["atk", "def", "spa", "spd", "spe", "accuracy", "evasion"];
const zeroBoosts = (): Record<BoostId, number> => ({ atk: 0, def: 0, spa: 0, spd: 0, spe: 0, accuracy: 0, evasion: 0 });
/** Moves that add the stall volatile (pinned data/moves.ts addVolatile('stall')): consecutive uses succeed with 3^-k. */
export const PROTECT_FAMILY: ReadonlySet<string> = new Set([
  "protect", "detect", "endure", "kingsshield", "spikyshield", "banefulbunker", "obstruct", "silktrap", "burningbulwark", "maxguard", "wideguard", "quickguard",
]);
/** Locking moves (R7): consecutive own uses until fatigue confusion. */
const LOCKING: ReadonlySet<string> = new Set(["outrage", "petaldance", "thrash", "ragingfury"]);
/** Volatiles that last one turn and are dropped at |turn| (protection and redirection this turn). */
const SINGLE_TURN: readonly string[] = ["protect", "helpinghand", "followme", "ragepowder", "roost", "endure"];
/** A heal named for these abilities belongs to the healed Pokémon even with [of] (the attacker; pinned battle.ts:2290-2297). */
const SELF_HEAL_ABILITIES: ReadonlySet<string> = new Set(["waterabsorb", "voltabsorb", "dryskin", "eartheater"]);

type Ref = { side: SideID; position: 0 | 1 | null; name: string };
type Mon = PublicMon & PublicCounts & {
  /** Its Ally Switch passed its PrepareHit this turn (the streak goes on), or it used it and failed (the streak ends). */
  allySwitchThisTurn?: "passed" | "failed";
  thisResult: boolean | null | undefined;
  protectedThisTurn: boolean;
  /** Two-turn charge started (R5). */
  charging: string | null;
  stintMoves: string[];
  notChoiceShown: boolean;
  /** The form shown at switch-in or by a permanent change (detailschange); temporary -formechange forms end with the stint. */
  stintSpecies: string;
  /** The ability last announced as its own (before a Skill Swap, Role Play or Trace changed the current one). */
  baseShown: string | null;
};
type MoveContext = {
  user: string; moveId: string; spread: boolean; single: boolean; own: boolean;
  protecting: boolean; attacker: HitSnapshot; hit: Set<string>; crits: Set<string>; pending: Map<string, DamageObservation["censored"]>;
  damage: DamageObservation[]; multiHit: boolean;
  targetIdent: string | null;
  /** It reached a target: damage or a hit Substitute (self effects such as a lock apply only then). */
  landed: boolean;
  /** Pokémon whose item the log had shown gone before this move (a resist Berry eaten by this hit still acted on it). */
  goneBefore: Set<string>;
  /** status2 T1: Pokémon this move damaged (no [from]; its Substitute hit counts for Ripen) and those it named (its target, [spread]). */
  damaged: Set<string>; reached: Set<string>; subHit: Set<string>;
  /** status2 T1: Berserk marks that came after this move's hits while it was still open (a confusion self-hit, damage from
   *  another effect: the residual's comes before the upkeep line closes the turn's last move), applied after its own. */
  after: { key: string; mark: PublicCounts["berserk"] | null }[];
  /** status2 T1: the item Fling threw (`-enditem|user|item|[from] move: Fling`). */
  flung?: string;
  /** status2 R-T: its user's last target is the chosen one whatever this move's lines say (the viewer's choice, or an Instruct's). */
  targetKnown?: true;
};
type MoveEvent = { key: string; moveId: string; snapshot: Record<string, Omit<SpeedSnapshot, "key" | "moveId">>; trickRoom: boolean; weather: string; terrain: string };
type TurnBuilder = {
  turn: number;
  moveEvents: MoveEvent[];
  damage: DamageObservation[];
  reveals: RevealObservation[];
  entries: EntryObservation[];
  windows: Map<string, string[]>;
  starting: { key: string; position: 0 | 1 }[];
  actions: Map<string, ObservedAction>;
  movesStarted: boolean;
  quickClaw: Set<string>;
  helpingHand: Set<string>;
  acted: Set<string>;
};

function parseRef(ident: string | undefined): Ref | null {
  const match = /^(p[12])([ab]?): (.+)$/.exec(ident ?? "");
  if (!match) return null;
  return { side: match[1] as SideID, position: match[2] === "a" ? 0 : match[2] === "b" ? 1 : null, name: match[3] };
}
function tagsOf(parts: readonly string[]): Record<string, string> {
  const tags: Record<string, string> = {};
  for (const part of parts) {
    if (!part.startsWith("[")) continue;
    const end = part.indexOf("]");
    if (end > 0) tags[part.slice(1, end)] = part.slice(end + 1).trim();
  }
  return tags;
}
const effectId = (text: string | undefined) => toID((text ?? "").replace(/^(move|ability|item): /, ""));
const speciesOfDetails = (details: string | undefined) => toID((details ?? "").split(",")[0]);

/** "84/100y brn" (another side) or "150/180 brn" (own) → HP and status (R12). */
function parseHP(text: string | undefined): { fainted: boolean; current: number; max: number; color: ShownHP["color"]; status: BattleStatus | null } | null {
  if (!text) return null;
  if (text.startsWith("0 fnt")) return { fainted: true, current: 0, max: 0, color: null, status: "" };
  const [fraction, status] = text.split(" ");
  const match = /^(\d+)\/(\d+)([gyr]?)$/.exec(fraction);
  if (!match) return null;
  const known = ["brn", "par", "psn", "tox", "slp", "frz"];
  return {
    fainted: false, current: Number(match[1]), max: Number(match[2]), color: (match[3] || null) as ShownHP["color"],
    status: status === undefined ? "" : known.includes(status) ? (status as BattleStatus) : null,
  };
}
/** The shared percentage pinned Champions shows (sim/pokemon.ts:2060-2073). */
export function shownPercent(hp: number, maxhp: number): ShownHP {
  if (hp <= 0) return { percent: 0, color: null };
  const percent = Math.floor((100 * hp) / maxhp) || 1;
  const color = percent === 20 ? (hp * 5 > maxhp ? "y" : "r") : percent === 50 ? (hp * 2 > maxhp ? "g" : "y") : null;
  return { percent, color };
}

/**
 * `speciesOf`: a member's species by its key (both teams' six are public from team preview), for a Pokémon a line names
 * before any line shows its details: a situation's Pokémon that fainted before the start (sim/situation-start.ts), whose
 * battle name is its base species' ("Floette" for Floette-Eternal). Without it, the name stands for the species.
 */
export function createTracker(viewer: SideID, keys: (side: SideID, name: string) => string, speciesOf?: (side: SideID, key: string) => string): PublicTracker {
  const mons: Record<string, Mon> = {};
  const active: Record<SideID, [string | null, string | null]> = { p1: [null, null], p2: [null, null] };
  const sides: PublicState["sides"] = {
    p1: { conditions: [], totalFainted: 0, faintedLastTurn: null, megaUsed: false },
    p2: { conditions: [], totalFainted: 0, faintedLastTurn: null, megaUsed: false },
  };
  const faintedThisTurn: Record<SideID, string | null> = { p1: null, p2: null };
  const field: PublicState["field"] = { weather: null, terrain: null, rooms: [] };
  const done: TurnObservations[] = [];
  const preSwitch = new Map<string, Mon | null>();
  let turn = 0;
  let afterUpkeep = true;
  let lastMove: string | null = null;
  let ended = false;
  let winner: PublicState["winner"] = null;
  let move: MoveContext | null = null;
  let cudChewEat: string | null = null;
  let builder = newBuilder(0);
  /** status2 T1: the battle's order of stored-stat changes (StoredEvent.seq). */
  let storedSeq = 0;
  /** status2 T1: the Stockpile use whose `-boost` lines come next, and the stats seen (StockpileVolatile counts). */
  let stockpileBoost: { key: string; seen: Set<string> } | null = null;
  /** status2 T1: a switch-in (or Mega Evolution) since `|upkeep|` applied the pending copies (PublicCounts.copyRises). */
  let copyApplied = false;
  /** status2 T1: the Berry just eaten (an `[eat]`, a stolen or a flung one), whose effect lines follow; until the next action. */
  let eaten: string | null = null;
  /** status2 T1: the Pokémon a Future Sight or Doom Desire is landing on (its `-end` line), until its damage line. */
  let landing: string | null = null;
  /** status2 T2: the battle's count of ability states begun (PublicCounts.entry). */
  let entrySeq = 0;
  /** status2 T2: an Ally Switch happened this turn, and the Pokémon that fainted this turn (PublicCounts.lastTargetUnknown). */
  let swappedThisTurn = false;
  const faintedNow = new Set<string>();
  /**
   * status2 R-T: the target loc each of the viewer's own Pokémon was chosen to move at this turn (PublicTracker.chose; null:
   * a move chosen with no target), until its own move line. Cleared at |turn| and as it leaves.
   */
  const chosenTarget = new Map<string, number | null>();
  /**
   * status2 R-T: Pokémon an Instruct makes use their last move (the `-singleturn|X|move: Instruct` line), until that move's
   * line: its last target stays (pinned data/moves.ts instruct queues it at lastMoveTargetLoc, which moveUsed writes back).
   */
  const instructed = new Set<string>();

  function newBuilder(n: number): TurnBuilder {
    return { turn: n, moveEvents: [], damage: [], reveals: [], entries: [], windows: new Map(), starting: [], actions: new Map(), movesStarted: false, quickClaw: new Set(), helpingHand: new Set(), acted: new Set() };
  }
  const since = () => turn + (afterUpkeep ? 1 : 0);
  const other = (side: SideID): SideID => (side === "p1" ? "p2" : "p1");
  const watched = (key: string) => mons[key]?.side !== viewer;

  function monOf(ident: string | undefined, override?: string): Mon | null {
    const ref = parseRef(ident);
    if (!ref) return null;
    const key = override ?? `${ref.side}:${keys(ref.side, ref.name)}`;
    const speciesId = (!override && speciesOf ? toID(speciesOf(ref.side, key.slice(3))) : "") || toID(ref.name);
    mons[key] ??= {
      key, side: ref.side, position: null, speciesId, mega: false,
      hp: { percent: 100, color: null }, exact: null, fainted: false, status: "", statusElapsed: 0, boosts: zeroBoosts(), volatiles: [],
      item: { state: "not-shown" }, ability: null, movesUsed: {}, lastMove: null, lastMoveTarget: null, lastResult: null, actions: 0,
      activeTurns: 0, timesHit: 0, switchIns: 0, protectStreak: 0, lock: null, transformedInto: null,
      thisResult: undefined, protectedThisTurn: false, charging: null, stintMoves: [], notChoiceShown: false, stintSpecies: speciesId, baseShown: null,
    };
    return mons[key];
  }
  const activeMon = (ident: string | undefined): Mon | null => {
    const ref = parseRef(ident);
    if (!ref || ref.position === null) return monOf(ident);
    const key = active[ref.side][ref.position];
    return key ? mons[key] : monOf(ident);
  };

  function setHP(mon: Mon, text: string | undefined) {
    const hp = parseHP(text);
    if (!hp) return;
    if (hp.fainted) {
      mon.hp = { percent: 0, color: null };
      if (mon.exact) mon.exact = { hp: 0, maxhp: mon.exact.maxhp };
      return;
    }
    if (mon.side === viewer) {
      mon.exact = { hp: hp.current, maxhp: hp.max };
      mon.hp = shownPercent(hp.current, hp.max);
    } else {
      mon.hp = { percent: hp.current, color: hp.color };
    }
    if (hp.status !== null && hp.status !== mon.status) { mon.status = hp.status; mon.statusElapsed = 0; delete mon.restSleep; }
  }
  const hpSnapshot = (mon: Mon): ShownHP | ExactHP => (mon.side === viewer && mon.exact ? { ...mon.exact } : { ...mon.hp });
  const withGone = (snapshot: HitSnapshot, gone: boolean): HitSnapshot => {
    const { itemGone, ...rest } = snapshot;
    void itemGone;
    return gone ? { ...rest, itemGone: true } : rest;
  };
  const hitSnapshot = (mon: Mon): HitSnapshot => ({
    key: mon.key, speciesId: mon.speciesId, boosts: { ...mon.boosts }, status: mon.status, hp: hpSnapshot(mon),
    ...(mon.item.state === "gone" ? { itemGone: true } : {}),
  });

  function reveal(mon: Mon | null, kind: RevealObservation["kind"], id: string) {
    if (!mon || !watched(mon.key)) return;
    if (!builder.reveals.some((each) => each.key === mon.key && each.kind === kind && each.id === id)) builder.reveals.push({ key: mon.key, kind, id });
  }
  function holdItem(mon: Mon | null, itemId: string) {
    if (!mon || !itemId) return;
    if (mon.item.state === "gone" && mon.item.itemId === itemId) return;   // "-heal … [from] item: Sitrus Berry" after it was eaten
    mon.item = { state: "held", itemId };
    reveal(mon, "item", itemId);
  }
  function showAbility(mon: Mon | null, abilityId: string, how: NonNullable<PublicMon["ability"]>["how"] = "announced") {
    if (!mon || !abilityId) return;
    // A changed or copied ability acting is not the Pokémon's own.
    if (how === "announced" && mon.ability && mon.ability.how !== "announced" && mon.ability.abilityId === abilityId) return;
    mon.ability = { abilityId, how };
    if (how === "announced") {
      mon.baseShown ??= abilityId;
      // A Mega form's ability is the form's (pinned data/pokedex.ts), not a fact about the sent set.
      if (!mon.mega) reveal(mon, "ability", abilityId);
    }
    const window = builder.windows.get(mon.key);
    if (window && how === "announced" && !window.includes(abilityId)) window.push(abilityId);
  }
  /** R1: [from] item / ability belongs to the subject, unless [of] Y names another Pokémon. */
  function attribute(subject: Mon | null, tags: Record<string, string>, command: string) {
    const from = tags.from ?? "";
    const owner = tags.of ? activeMon(tags.of) : subject;
    // status2 T1: a Berry's effect right after it was eaten is no item anyone holds: Teatime's heal names its user with [of]
    // (its eatItem's source), a stolen (Bug Bite, Pluck) or flung Berry acts on its eater.
    if (from.startsWith("item: ") && eaten === effectId(from)) return;
    if (from.startsWith("item: ")) holdItem(owner, effectId(from));
    else if (from.startsWith("ability: ")) {
      const id = effectId(from);
      if (id === "trace") return;
      showAbility(command === "-heal" && SELF_HEAL_ABILITIES.has(id) ? subject : owner, id);
    }
  }

  function volatile(mon: Mon, id: string): PublicVolatile | undefined {
    return mon.volatiles.find((each) => each.id === id);
  }
  function addVolatile(mon: Mon, entry: PublicVolatile) {
    mon.volatiles = [...mon.volatiles.filter((each) => each.id !== entry.id), entry];
  }
  function removeVolatile(mon: Mon, id: string) {
    mon.volatiles = mon.volatiles.filter((each) => each.id !== id);
  }
  /** R6: switching out or fainting clears the stint's battle state. */
  function clearStint(mon: Mon) {
    // Switching out restores the base ability (pinned sim/pokemon.ts clearVolatile: ability = baseAbility).
    if (mon.ability && mon.ability.how !== "announced") mon.ability = mon.baseShown ? { abilityId: mon.baseShown, how: "announced" } : null;
    const trappedBy = mon.volatiles.find((v) => v.id === "trapped")?.sourceKey;
    mon.volatiles = [];
    // The source keeps "trapper" while any Pokémon it trapped stays (pinned sim/pokemon.ts removeLinkedVolatiles).
    if (trappedBy && mons[trappedBy] && !Object.values(mons).some((each) => each.volatiles.some((v) => v.id === "trapped" && v.sourceKey === trappedBy))) {
      removeVolatile(mons[trappedBy], "trapper");
    } mon.boosts = zeroBoosts(); mon.lastMove = null; mon.lastMoveTarget = null; mon.lastResult = null;
    mon.thisResult = undefined; mon.lock = null; mon.protectStreak = 0; mon.protectedThisTurn = false; mon.charging = null;
    mon.transformedInto = null; mon.speciesId = mon.stintSpecies;
    delete mon.allySwitchStreak; delete mon.allySwitchThisTurn; delete mon.itemSince; delete mon.choiceMove;
    // Cud Chew's Berry is its ability state's (reset as it leaves: pinned sim/pokemon.ts switchOut / clearVolatile).
    delete mon.cudChew;
    // status2 T1: the stored stats (setSpecies at switch-out), the ability state's lock, weakened Berry and pending copy.
    // pokemon.lastItem stays (only generation 4 moves it at a switch: PS/sim/battle-actions.ts switchIn).
    delete mon.stored; resetAbilityState(mon);
    // status2 T2: its ability state's order and its last target's record end with the stint (onceUsed is the Pokémon's).
    delete mon.entry; delete mon.lastTargetUnknown;
    // Mean Look / Block: "trapped" and the source's "trapper" are linked volatiles; either leaving ends both
    // (pinned data/moves.ts meanlook onHit addVolatile(..., 'trapper'); sim/pokemon.ts removeVolatile linkedStatus).
    for (const each of Object.values(mons)) {
      if (each.volatiles.some((v) => v.id === "trapped" && v.sourceKey === mon.key)) removeVolatile(each, "trapped");
    }
  }

  /** status2 T1: a Berserk mark now, or after the open move's own (MoveContext.after). */
  function berserkMark(mon: Mon, mark: PublicCounts["berserk"] | null) {
    if (move) { move.after.push({ key: mon.key, mark }); return; }
    if (mark) mon.berserk = mark; else delete mon.berserk;
  }
  /** status2 T1: a fresh ability state (a switch, Skill Swap, Role Play, Entrainment, Trace, a Mega Evolution's ability). */
  function resetAbilityState(mon: Mon) {
    delete mon.berserk; delete mon.ripen; delete mon.copyRises; delete mon.typeChanger;
    // status2 T2: Cud Chew's Berry is its ability state's too (a Skill Swap or Trace giving Cud Chew starts with none).
    delete mon.cudChew;
  }
  /** status2 T2: Gravity or Smack Down grounds it: a Fly or Bounce charge is cancelled, Magnet Rise and Telekinesis end. */
  function grounded(mon: Mon) {
    if (mon.charging === "fly" || mon.charging === "bounce") { mon.charging = null; removeVolatile(mon, "twoturnmove"); }
    removeVolatile(mon, "magnetrise");
    removeVolatile(mon, "telekinesis");
  }
  /** status2 T2: an ability state begun now (PublicCounts.entry), with the fresh state's marks. */
  function newEntry(mon: Mon) {
    resetAbilityState(mon);
    mon.entry = ++entrySeq;
  }
  /** status2 T2: a once-a-battle effect it has had (PublicCounts.onceUsed). */
  function onceUsed(mon: Mon, id: NonNullable<PublicCounts["onceUsed"]>[number]) {
    if (!mon.onceUsed?.includes(id)) mon.onceUsed = [...(mon.onceUsed ?? []), id];
  }
  /**
   * status2 T1: a form change (detailschange, -formechange, -mega: pinned sim/pokemon.ts formeChange → setSpecies) recomputes
   * the stored stats and sets the form's types and no added type: the stint's stored-stat changes and the public type
   * changes end (a Power Trick volatile stays, its swap undone).
   */
  function formChanged(mon: Mon) {
    delete mon.stored;
    removeVolatile(mon, "typechange");
    removeVolatile(mon, "typeadd");
  }
  const storedSnapshot = (mon: Mon, ability = false): NonNullable<StoredEvent["partner"]> => ({
    key: mon.key, speciesId: mon.speciesId, stored: structuredClone(mon.stored ?? []), ...(ability && mon.ability && mon.ability.how !== "announced" ? { ability: mon.ability.abilityId } : {}),
  });
  /** status2 T1: one stored-stat change on `mon`: a Power Trick or Power Shift toggle, or Transform into `partner`. */
  function storedEvent(mon: Mon, move: StoredEvent["move"], partner?: Mon) {
    const event: StoredEvent = { seq: ++storedSeq, move, ...(partner ? { partner: storedSnapshot(partner, move === "transform") } : {}) };
    // Transform copies its target's stored stats over its own (pinned sim/pokemon.ts transformInto).
    mon.stored = move === "transform" ? [event] : [...(mon.stored ?? []), event];
  }
  /** status2 T1: Power Split, Guard Split or Speed Swap between `a` and `b` (each partner's state before it). */
  function storedPair(a: Mon, b: Mon, move: StoredEvent["move"]) {
    const seq = ++storedSeq;
    const before = { a: storedSnapshot(a), b: storedSnapshot(b) };
    a.stored = [...(a.stored ?? []), { seq, move, partner: before.b }];
    b.stored = [...(b.stored ?? []), { seq, move, partner: before.a }];
  }

  function closeEntry(key: string) {
    const announced = builder.windows.get(key);
    if (!announced) return;
    builder.windows.delete(key);
    if (watched(key)) builder.entries.push({ key, announced: [...announced] });
  }
  const closeEntries = () => { for (const key of [...builder.windows.keys()]) closeEntry(key); };

  function actionOf(key: string, action: ObservedAction) {
    if (builder.starting.some((each) => each.key === key) && !builder.actions.has(key)) builder.actions.set(key, action);
  }

  function speedSnapshots(): MoveEvent["snapshot"] {
    const out: MoveEvent["snapshot"] = {};
    for (const side of ["p1", "p2"] as const) {
      const tailwind = sides[side].conditions.some((each) => each.id === "tailwind");
      for (const key of active[side]) {
        if (!key) continue;
        const mon = mons[key];
        out[key] = { speStage: mon.boosts.spe, status: mon.status, tailwind, quickClaw: builder.quickClaw.has(key) };
      }
    }
    return out;
  }

  function finishMove() {
    if (!move) return;
    // A locking move's lock starts or continues only when it landed (pinned data/moves.ts outrage self.volatileStatus,
    // applied by sim/battle-actions.ts selfDrops after a hit; data/conditions.ts lockedmove onAfterMove ends it otherwise).
    const user = mons[move.user];
    if (user && move.own && LOCKING.has(move.moveId) && !move.landed && user.lock?.moveId === move.moveId) user.lock = null;
    if (user && move.own && move.moveId === "wish" && user.thisResult !== false && user.position !== null) {
      // Wish heals that slot at the end of the next turn (pinned data/moves.ts wish condition): side condition "wish", layers = position + 1.
      const layers = user.position + 1;
      sides[user.side].conditions = [...sides[user.side].conditions.filter((each) => !(each.id === "wish" && each.layers === layers)),
        { id: "wish", since: turn, layers, setterKey: user.key }];
    }
    if (!move.multiHit) builder.damage.push(...move.damage);
    // status2 T1: Berserk / Anger Shell after this move: a single hit's damage leaves the lock its user's Sheer Force decides
    // (the bridge reads the move's secondaries and the user's ability), a multi-hit move's resets it; a Pokémon the move named
    // but did not damage may have had AfterMoveSecondary (unknown). Ripen: a damage calculation into it (a hit, a hit
    // Substitute) uses up the weakened Berry; a Berry flung at it and eaten (Fling's onHit, after the damage) sets it.
    for (const key of move.damaged) {
      const hit = mons[key];
      if (!hit || key === move.user) continue;
      if (move.multiHit) delete hit.berserk;
      else hit.berserk = { kind: "move", by: move.user, move: move.moveId };
    }
    for (const key of move.reached) if (mons[key]?.berserk && !move.damaged.has(key)) mons[key].berserk = { kind: "unknown" };
    for (const { key, mark } of move.after) { if (!mons[key]) continue; if (mark) mons[key].berserk = mark; else delete mons[key].berserk; }
    for (const key of [...move.damaged, ...move.subHit]) if (key !== move.user && mons[key]) delete mons[key].ripen;
    const flungAt = move.flung && move.targetIdent ? activeMon(move.targetIdent) : null;
    if (move.flung?.endsWith("berry") && flungAt && move.damaged.has(flungAt.key)) {
      if (RESIST_BERRIES.has(move.flung)) flungAt.ripen = "weaken";
      else delete flungAt.ripen;
    }
    move = null;
  }

  function closeTurn() {
    finishMove();
    closeEntries();
    const order: OrderObservation[] = [];
    const events = builder.moveEvents;
    for (let i = 0; i < events.length; i++) {
      for (let j = i + 1; j < events.length; j++) {
        const a = events[i], b = events[j];
        if (!mons[a.key] || !mons[b.key] || mons[a.key].side === mons[b.key].side) continue;
        const sa = a.snapshot[a.key], sb = a.snapshot[b.key];
        if (!sa || !sb) continue;
        order.push({ first: { key: a.key, moveId: a.moveId, ...sa }, second: { key: b.key, moveId: b.moveId, ...sb }, trickRoom: a.trickRoom, weather: a.weather, terrain: a.terrain });
      }
    }
    const actions = builder.starting.map(({ key, position }) => ({ key, position, action: builder.actions.get(key) ?? { kind: "none", reason: "not-shown" } as ObservedAction }));
    done.push({ turn: builder.turn, order, damage: builder.damage, reveals: builder.reveals, entries: builder.entries, actions });
  }

  function onTurn(n: number) {
    closeTurn();
    turn = n;
    afterUpkeep = false;
    // Pinned nextTurn resets the per-turn flags only when the new turn is not the first (status2 Step 1 #11).
    if (n !== 1) for (const mon of Object.values(mons)) delete mon.thisTurn;
    for (const side of ["p1", "p2"] as const) {
      sides[side].faintedLastTurn = faintedThisTurn[side];
      faintedThisTurn[side] = null;
      for (const key of active[side]) {
        if (!key) continue;
        const mon = mons[key];
        if (!mon.fainted) mon.activeTurns++;
        mon.lastResult = mon.thisResult ?? null;
        mon.thisResult = undefined;
        if (!mon.protectedThisTurn) mon.protectStreak = 0;
        mon.protectedThisTurn = false;
        // Ally Switch (pinned data/moves.ts allyswitch: the volatile lasts 2 turns; each use that passes PrepareHit restarts
        // it and triples its counter): a turn without a passing use ends the streak.
        if (mon.allySwitchThisTurn === "passed") mon.allySwitchStreak = (mon.allySwitchStreak ?? 0) + 1;
        else delete mon.allySwitchStreak;
        delete mon.allySwitchThisTurn;
      }
    }
    for (const mon of Object.values(mons)) mon.volatiles = mon.volatiles.filter((each) => !SINGLE_TURN.includes(each.id));
    // status2 T2: Lock-On and Mind Reader end silently after two end-of-turn countdowns (pinned data/moves.ts lockon condition
    // duration 2: used on turn t, it lasts through turn t + 1).
    for (const mon of Object.values(mons)) mon.volatiles = mon.volatiles.filter((each) => each.id !== "lockon" || n - each.since < 2);
    swappedThisTurn = false;
    faintedNow.clear();
    chosenTarget.clear();
    instructed.clear();
    // Fairy Lock ends silently after two end-of-turn countdowns (pinned data/moves.ts fairylock condition duration 2).
    field.rooms = field.rooms.filter((room) => room.id !== "fairylock" || n - room.since < 2);
    // Wish resolves at the end of the turn after it; Future Sight two turns after (data/conditions.ts futuremove endingTurn).
    for (const side of ["p1", "p2"] as const) {
      sides[side].conditions = sides[side].conditions.filter((each) => !(each.id === "wish" && n - each.since > 1)
        && !((each.id === "futuresight" || each.id === "doomdesire") && n - each.since > 2));
    }
    builder = newBuilder(n);
    const watchedSide = other(viewer);
    active[watchedSide].forEach((key, position) => { if (key && !mons[key].fainted) builder.starting.push({ key, position: position as 0 | 1 }); });
  }

  function onSwitch(parts: string[], tags: Record<string, string>, command: "switch" | "drag") {
    const ref = parseRef(parts[2]);
    if (!ref || ref.position === null) return;
    let memberKey = `${ref.side}:${keys(ref.side, ref.name)}`;
    // The same member already active beside it: an Illusion disguised as that ally; a placeholder until |replace|.
    if (active[ref.side][ref.position === 0 ? 1 : 0] === memberKey && !mons[memberKey]?.fainted) memberKey = `${ref.side}:?illusion`;
    const fresh = !mons[memberKey];
    const mon = monOf(parts[2], memberKey);
    if (!mon) return;
    const old = active[ref.side][ref.position];
    // Baton Pass passes stages and every volatile but the noCopy ones; Shed Tail passes the Substitute only
    // (pinned sim/pokemon.ts:1246-1268 copyVolatileFrom).
    const passer = old && old !== mon.key && (tags.from === "Baton Pass" || tags.from === "Shed Tail") ? structuredClone(mons[old]) : null;
    if (old && old !== mon.key) {
      const leaving = mons[old];
      if (command === "switch" && !tags.from && !builder.movesStarted && !afterUpkeep) actionOf(old, { kind: "switch", toKey: mon.key });
      chosenTarget.delete(old);
      instructed.delete(old);
      leaving.position = null;
      clearStint(leaving);
    }
    preSwitch.set(mon.key, fresh ? null : structuredClone(mon));
    active[ref.side][ref.position] = mon.key;
    mon.position = ref.position;
    mon.stintSpecies = speciesOfDetails(parts[3]);
    mon.speciesId = mon.stintSpecies;
    mon.mega = /-Mega/.test(parts[3] ?? "") || mon.mega;
    mon.actions = 0; mon.activeTurns = 0; mon.switchIns++;
    mon.fainted = false;
    mon.stintMoves = []; mon.notChoiceShown = false;
    clearStint(mon);
    mon.speciesId = mon.stintSpecies;
    // status2 T2: its switch-in's ability state (pinned battle-actions.ts switchIn initEffectState).
    mon.entry = ++entrySeq;
    if (passer) {
      if (tags.from === "Baton Pass") mon.boosts = { ...passer.boosts };
      mon.volatiles = passer.volatiles.filter((each) => (tags.from === "Shed Tail" ? each.id === "substitute" : !NO_COPY.has(each.id)));
      // status2 T1: a passed Power Trick or Power Shift swaps the newcomer's stored stats (its onCopy).
      for (const each of mon.volatiles) if (each.id === "powertrick" || each.id === "powershift") storedEvent(mon, each.id);
    }
    setHP(mon, parts[4]);
    if (mon.status === "tox") mon.statusElapsed = 0;   // the stage restarts on switch-in (tox onSwitchIn)
    builder.windows.set(mon.key, []);
  }

  function onMove(parts: string[], tags: Record<string, string>) {
    finishMove();
    const mon = activeMon(parts[2]);
    if (!mon) return;
    const moveId = toID(parts[3]);
    const own = !tags.from || tags.from === "lockedmove";   // R3
    lastMove = moveId;
    closeEntries();
    const target = activeMon(parts[4]);
    const targetRef = parseRef(parts[4]);
    move = {
      user: mon.key, moveId, spread: "spread" in tags, single: !("spread" in tags), own,
      protecting: own && PROTECT_FAMILY.has(moveId), attacker: hitSnapshot(mon), hit: new Set(), crits: new Set(), pending: new Map(),
      damage: [], multiHit: false, landed: false, targetIdent: parts[4] || null,
      goneBefore: new Set(Object.values(mons).filter((each) => each.item.state === "gone").map((each) => each.key)),
      damaged: new Set(), reached: new Set(), subHit: new Set(), after: [],
    };
    // status2 T1: the Pokémon it names (a self or side move names its user), for the Berserk lock.
    if (target) move.reached.add(target.key);
    for (const spot of (tags.spread ?? "").split(",").map((each) => each.trim()).filter(Boolean)) {
      const hit = activeMon(`${spot.slice(0, 2)}${spot.slice(2)}: x`);
      if (hit) move.reached.add(hit.key);
    }
    // Minimize adds its volatile with no message (pinned data/moves.ts minimize: volatileStatus, no onStart).
    if (moveId === "minimize") addVolatile(mon, { id: "minimize", since: since(), elapsed: 0 });
    // Opportunist copies at the end of any move (onAnyAfterMove).
    for (const each of Object.values(mons)) delete each.copyRises;
    if (!own) return;
    builder.movesStarted = builder.movesStarted || !afterUpkeep;
    if (!afterUpkeep && turn > 0) {
      builder.moveEvents.push({ key: mon.key, moveId, snapshot: speedSnapshots(), trickRoom: field.rooms.some((each) => each.id === "trickroom"), weather: field.weather?.id ?? "", terrain: field.terrain?.id ?? "" });
    }
    actionOf(mon.key, { kind: "move", moveId, targetKey: "spread" in tags || "notarget" in tags ? null : target?.key ?? null, spread: "spread" in tags });
    builder.acted.add(mon.key);
    // Any move ends Destiny Bond, Grudge and Glaive Rush's drawback; Destiny Bond again while it lasts removes it and fails
    // (pinned data/moves.ts destinybond onPrepareHit, glaiverush condition onBeforeMove).
    for (const id of SINGLE_MOVE) removeVolatile(mon, id);
    mon.actions++;
    mon.lastMove = moveId;
    if (!mon.choiceMove || mon.choiceMove === "struggle") mon.choiceMove = moveId;
    // status2 R-T: the move an Instruct made it use runs at its last target loc (pinned instruct onHit: resolveAction with
    // targetLoc lastMoveTargetLoc, then runMove's moveUsed writes the same loc back): its last target stays, unless it had none.
    const wasInstructed = instructed.delete(mon.key);
    const instructedMove = wasInstructed && (!!mon.lastMoveTarget || !!mon.lastTargetUnknown);
    // The viewer's own choice for it this turn (PublicTracker.chose): its own action's line, not a called, locked or
    // instructed one.
    const chosen = !tags.from && !wasInstructed ? chosenTarget.get(mon.key) : undefined;
    if (!tags.from && !wasInstructed) chosenTarget.delete(mon.key);
    if (!instructedMove) {
      mon.lastMoveTarget = targetRef && targetRef.position !== null && !("notarget" in tags) ? { side: targetRef.side, position: targetRef.position } : null;
      // status2 T2: whether the line's target is the chosen one (PublicCounts.lastTargetUnknown): no foe redirector up, no
      // Pokémon of that side fainted this turn (a retarget), no Encore begun this turn before it moved, no Ally Switch this turn.
      delete mon.lastTargetUnknown;
      if (targetRef && targetRef.position !== null) {
        const side = targetRef.side;
        const redirector = side !== mon.side && active[side].some((key) => !!key && mons[key].volatiles.some((each) => each.id === "followme" || each.id === "ragepowder"));
        const retarget = Object.values(mons).some((each) => each.side === side && faintedNow.has(each.key));
        const encore = volatile(mon, "encore");
        if (redirector || retarget || swappedThisTurn || (encore && encore.since === since() && !encore.targetMovedFirst)) mon.lastTargetUnknown = true;
      }
      // status2 R-T: the viewer's own Pokémon chosen at a target: that loc is its lastMoveTargetLoc (pinned runMove moveUsed's
      // targetLoc, the action's), whatever its line names: none ("[still]", sim/battle.ts attrLastMove blanks it), a retarget
      // after the chosen target fainted, a redirection.
      if (typeof chosen === "number" && chosen !== 0) {
        const position = (Math.abs(chosen) - 1) as 0 | 1;
        mon.lastMoveTarget = { side: chosen > 0 ? other(mon.side) : mon.side, position };
        delete mon.lastTargetUnknown;
        move.targetKnown = true;
      }
    } else move.targetKnown = true;
    mon.thisResult = true;
    if (!tags.from) {
      // R4: one PP per own move line without [from]; +1 per Pressure Pokémon of the other side it targets or hits.
      const aimed = new Set<string>();
      if (target && target.side !== mon.side) aimed.add(target.key);
      for (const spot of (tags.spread ?? "").split(",").map((each) => each.trim()).filter(Boolean)) {
        const hit = activeMon(`${spot.slice(0, 2)}${spot.slice(2)}: x`);
        if (hit && hit.side !== mon.side) aimed.add(hit.key);
      }
      const pressure = [...aimed].filter((key) => mons[key]?.ability?.abilityId === "pressure").length;
      mon.movesUsed[moveId] = (mon.movesUsed[moveId] ?? 0) + 1 + pressure;
    }
    // R5: a two-turn move's release (the next own line of that move without [still]) ends its charge. status2 T2: so does
    // another move (its charge was cancelled without a line of its own).
    if (mon.charging && (mon.charging !== moveId || !("still" in tags))) { mon.charging = null; removeVolatile(mon, "twoturnmove"); }
    // R7: locks count consecutive own uses.
    if (LOCKING.has(moveId)) mon.lock = mon.lock?.moveId === moveId ? { moveId, turns: mon.lock.turns + 1 } : { moveId, turns: 1 };
    else mon.lock = null;
    if (watched(mon.key)) {
      reveal(mon, "move", moveId);
      if (!mon.stintMoves.includes(moveId)) mon.stintMoves.push(moveId);
      if (mon.stintMoves.length >= 2 && !mon.notChoiceShown) { mon.notChoiceShown = true; reveal(mon, "not-choice", ""); }
    }
  }

  function onDamage(parts: string[], tags: Record<string, string>) {
    const mon = activeMon(parts[2]);
    if (!mon) return;
    const before = hpSnapshot(mon);
    setHP(mon, parts[3]);
    attribute(mon, tags, "-damage");
    // Toxic: statusElapsed counts this stint's end-of-turn ticks (the stage, pinned data/conditions.ts tox onResidual).
    if (tags.from === "psn" && mon.status === "tox") mon.statusElapsed++;
    // A confusion self-hit replaces the move: an attempt that shows no move (PS/sim/battle-actions.ts runMove counts it in
    // activeMoveActions; BeforeMove false aborts it), and it ends an Outrage-type lock.
    if (tags.from === "confusion") {
      mon.actions++; mon.thisResult = null; mon.lock = null;
      actionOf(mon.key, { kind: "none", reason: "cant" });
      builder.acted.add(mon.key);
      // status2 T1: a Move-type effect with no AfterMoveSecondary (the Berserk / Anger Shell lock).
      berserkMark(mon, { kind: "confusion" });
      return;
    }
    // status2 T1: damage from any other effect (an item, an ability, a condition, recoil) is no Move: the lock resets.
    if (tags.from) berserkMark(mon, null);
    // A Future Sight or Doom Desire landing (its -end line just before, data/conditions.ts futuremove onEnd): not the open
    // move's hit; its own AfterMoveSecondary may reset the lock, and its damage calculation uses up a weakened Berry.
    const landed = landing === mon.key;
    if (landed) {
      landing = null;
      if (mon.berserk) mon.berserk = { kind: "unknown" };
      delete mon.ripen;
    }
    if (tags.from || !move || move.user === mon.key) return;
    const attacker = mons[move.user];
    mon.timesHit++;
    move.landed = true;
    if (!landed) move.damaged.add(mon.key);
    if (!attacker || attacker.side === mon.side) return;
    const after = parts[3]?.startsWith("0 fnt") ? (mon.side === viewer && mon.exact ? { hp: 0, maxhp: mon.exact.maxhp } : { percent: 0, color: null }) : hpSnapshot(mon);
    const screens = (side: SideID) => ({
      reflect: sides[side].conditions.some((each) => each.id === "reflect"),
      lightScreen: sides[side].conditions.some((each) => each.id === "lightscreen"),
      auroraVeil: sides[side].conditions.some((each) => each.id === "auroraveil"),
    });
    const room = (id: string) => field.rooms.some((each) => each.id === id);
    move.damage.push({
      moveId: move.moveId, attacker: move.attacker, defender: withGone({ ...hitSnapshot(mon), hp: before }, move.goneBefore.has(mon.key)), after,
      crit: move.crits.has(mon.key), spread: move.spread, helpingHand: builder.helpingHand.has(attacker.key),
      censored: parts[3]?.startsWith("0 fnt") ? "fainted" : move.pending.get(mon.key) ?? null,
      weather: field.weather?.id ?? "", terrain: field.terrain?.id ?? "", defenderScreens: screens(mon.side),
      gravity: room("gravity"), magicRoom: room("magicroom"), wonderRoom: room("wonderroom"),
    });
  }

  function censor(mon: Mon | null, reason: NonNullable<DamageObservation["censored"]>) {
    if (!mon || !move) return;
    const last = move.damage.findLast((each) => each.defender.key === mon.key);
    if (last && !last.censored) last.censored = reason;
    else move.pending.set(mon.key, reason);
  }

  function onFaint(mon: Mon) {
    mon.fainted = true;
    mon.hp = { percent: 0, color: null };
    if (mon.exact) mon.exact = { hp: 0, maxhp: mon.exact.maxhp };
    mon.status = ""; mon.statusElapsed = 0; delete mon.restSleep;
    clearStint(mon);
    sides[mon.side].totalFainted++;
    faintedThisTurn[mon.side] = mon.key;
    faintedNow.add(mon.key);
    actionOf(mon.key, { kind: "none", reason: "fainted" });
  }

  function setBoost(mon: Mon, stat: string, value: number) {
    if ((BOOSTS as readonly string[]).includes(stat)) mon.boosts[stat as BoostId] = Math.max(-6, Math.min(6, value));
  }

  function condition(list: PublicCondition[], id: string, setterKey: string | null): PublicCondition[] {
    const existing = list.find((each) => each.id === id);
    if (existing) return list.map((each) => (each.id === id ? { ...each, layers: each.layers + 1 } : each));
    return [...list, { id, since: since(), layers: 1, setterKey }];
  }

  function line(text: string) {
    // The line right after Cud Chew's -activate is its re-eat's -enditem (status2 Step 1 #16).
    const reEat = cudChewEat;
    cudChewEat = null;
    // status2 T1: a Stockpile use's boost lines follow its -start line at once.
    const pile = stockpileBoost;
    stockpileBoost = null;
    const parts = text.split("|");
    const command = parts[1] ?? "";
    const tags = tagsOf(parts);
    if (command === "move" || command === "turn" || command === "upkeep" || command === "switch" || command === "drag" || command === "" || command === "cant") eaten = null;
    switch (command) {
      case "turn": onTurn(Number(parts[2])); break;
      case "upkeep": {
        finishMove(); closeEntries(); afterUpkeep = true;
        // status2 T1: residual 29 applied every copy; what rises from here (the final Update) waits for the next point.
        for (const each of Object.values(mons)) delete each.copyRises;
        copyApplied = false;
        // This residual resolved a Wish from last turn and a Future Sight or Doom Desire from two turns ago, healing or
        // hitting or not (pinned data/moves.ts wish, data/conditions.ts futuremove onResidual remove the slot condition first;
        // a fainted target gets no line): gone before a replacement request at this upkeep (EOT-5, conformance on pool E).
        for (const side of ["p1", "p2"] as const) {
          sides[side].conditions = sides[side].conditions.filter((each) => !(each.id === "wish" && turn - each.since >= 1)
            && !((each.id === "futuresight" || each.id === "doomdesire") && turn - each.since >= 2));
        }
        break;
      }
      case "switch": case "drag":
        finishMove(); onSwitch(parts, tags, command);
        // status2 T1: Opportunist copies at any switch-in (onAnySwitchIn, priority −3, after the newcomer's own entry).
        for (const each of Object.values(mons)) delete each.copyRises;
        copyApplied = true;
        break;
      case "replace": {
        // Illusion broke: the Pokémon in that position is the revealed member; its state moves there.
        const ref = parseRef(parts[2]);
        if (!ref || ref.position === null) break;
        const disguiseKey = active[ref.side][ref.position];
        const real = monOf(parts[2]);
        if (!real || !disguiseKey || disguiseKey === real.key) break;
        const disguise = mons[disguiseKey];
        const { key: realKey, side } = real;
        const species = speciesOfDetails(parts[3]);
        Object.assign(real, structuredClone(disguise), { key: realKey, side, speciesId: species, stintSpecies: species, item: real.item, ability: real.ability, movesUsed: { ...real.movesUsed, ...disguise.movesUsed } });
        const restored = preSwitch.get(disguiseKey);
        if (restored) mons[disguiseKey] = { ...restored, position: null };
        else delete mons[disguiseKey];   // the disguise's member never appeared itself
        // A placeholder beside it was the disguise's real member all along.
        const besideAt = ref.position === 0 ? 1 : 0;
        const placeholder = `${ref.side}:?illusion`;
        if (active[ref.side][besideAt] === placeholder && mons[placeholder]) {
          mons[disguiseKey] = { ...mons[placeholder], key: disguiseKey };
          delete mons[placeholder];
          active[ref.side][besideAt] = disguiseKey;
        }
        active[ref.side][ref.position] = realKey;
        if (builder.windows.has(disguiseKey)) { builder.windows.set(realKey, builder.windows.get(disguiseKey)!); builder.windows.delete(disguiseKey); }
        // This turn's records name the revealed member from now on.
        for (const event of builder.moveEvents) {
          if (event.key === disguiseKey) event.key = realKey;
          if (event.snapshot[disguiseKey]) { event.snapshot[realKey] = event.snapshot[disguiseKey]; delete event.snapshot[disguiseKey]; }
        }
        for (const entry of builder.starting) if (entry.key === disguiseKey) entry.key = realKey;
        const shown = builder.actions.get(disguiseKey);
        if (shown) { builder.actions.set(realKey, shown); builder.actions.delete(disguiseKey); }
        break;
      }
      case "swap": {
        // "|swap|POKEMON|POSITION": an active Pokémon moves to that position, the ally to its old one (Ally Switch).
        const ref = parseRef(parts[2]);
        const to = Number(parts[3]);
        if (!ref || ref.position === null || (to !== 0 && to !== 1) || to === ref.position) break;
        const row = active[ref.side];
        const [a, b] = [row[ref.position], row[to]];
        row[to] = a; row[ref.position] = b;
        if (a) mons[a].position = to;
        if (b) mons[b].position = ref.position;
        if (tags.from === "move: Ally Switch" && a) mons[a].allySwitchThisTurn = "passed";
        swappedThisTurn = true;
        break;
      }
      case "detailschange": {
        const mon = activeMon(parts[2]);
        if (mon) {
          mon.speciesId = speciesOfDetails(parts[3]); mon.stintSpecies = mon.speciesId; if (/-Mega/.test(parts[3] ?? "")) mon.mega = true; formChanged(mon);
          // status2 T2: a permanent form change sets the form's ability (a new ability state), but Disguise's and Ice Face's
          // (pinned sim/pokemon.ts formeChange).
          if (mon.speciesId !== "mimikyubusted" && mon.speciesId !== "eiscuenoice") newEntry(mon);
        }
        break;
      }
      case "-formechange": { const mon = activeMon(parts[2]); if (mon) { mon.speciesId = toID(parts[3]); attribute(mon, tags, command); formChanged(mon); } break; }
      case "-mega": {
        const mon = activeMon(parts[2]);
        if (!mon) break;
        mon.mega = true;
        sides[mon.side].megaUsed = true;
        // The Mega form's own ability replaces the shown one (pinned sim/pokemon.ts formeChange setAbility).
        mon.ability = null;
        // status2 T1: the form change and the new ability's fresh state; Opportunist copies after it (onAnyAfterMega).
        formChanged(mon); newEntry(mon);
        for (const each of Object.values(mons)) delete each.copyRises;
        copyApplied = true;
        const stone = toID(parts[4]);
        if (stone) { mon.item = { state: "held", itemId: stone }; reveal(mon, "mega", stone); reveal(mon, "item", stone); }
        break;
      }
      case "-transform": {
        const mon = activeMon(parts[2]), into = activeMon(parts[3]);
        if (mon && into) {
          mon.transformedInto = into.key;
          // status2 T1: it copies its target's stored stats as they are now, and takes a fresh ability state; its types,
          // all seven stages and the crit volatiles become its target's (pinned sim/pokemon.ts transformInto: no lines).
          storedEvent(mon, "transform", into);
          newEntry(mon);
          mon.boosts = { ...into.boosts };
          mon.volatiles = [
            ...mon.volatiles.filter((each) => !TRANSFORM_COPIED.has(each.id) && each.id !== "typechange" && each.id !== "typeadd"),
            ...structuredClone(into.volatiles.filter((each) => TRANSFORM_COPIED.has(each.id) || each.id === "typechange" || each.id === "typeadd")),
          ];
        }
        attribute(mon, tags, command);
        break;
      }
      case "move": onMove(parts, tags); break;
      case "cant": {
        finishMove();
        const mon = activeMon(parts[2]);
        if (!mon) break;
        if (tags.of) { showAbility(mon, effectId(parts[3]?.startsWith("ability: ") ? parts[3] : "")); break; }   // a blocked move (Armor Tail …), not this Pokémon's action
        mon.actions++; mon.thisResult = null; mon.lock = null;
        // status2 R-T: the action it was chosen for (or an Instruct's) did not run: no move writes its last target.
        if (!instructed.delete(mon.key)) chosenTarget.delete(mon.key);
        for (const id of SINGLE_MOVE) removeVolatile(mon, id);
        if (parts[3] === "slp" || parts[3] === "frz") mon.statusElapsed++;
        if (parts[3] === "recharge") removeVolatile(mon, "mustrecharge");
        if (mon.charging) { mon.charging = null; removeVolatile(mon, "twoturnmove"); }
        closeEntries();
        actionOf(mon.key, { kind: "none", reason: "cant" });
        builder.acted.add(mon.key);
        break;
      }
      case "-fail": {
        const mon = activeMon(parts[2]);
        if (move && mon && mon.key === move.user && move.own) mons[move.user].thisResult = false;
        // status2 T2: a protecting move that fails its stall roll deletes the counter (data/conditions.ts stall onStallMove), so a
        // second one this turn (Instruct) starts fresh; failing as the turn's last action ends the streak the same way.
        if (move && mon && mon.key === move.user && move.own && move.protecting) { mon.protectStreak = 0; mon.protectedThisTurn = false; }
        // Ally Switch's onHit failing (a fainted ally: "-fail|X|move: Ally Switch") comes after its counter passed; a plain
        // "-fail|X" is its PrepareHit's counter failing, which removes the volatile (pinned data/moves.ts allyswitch).
        if (move && mon && mon.key === move.user && move.moveId === "allyswitch") mon.allySwitchThisTurn = parts[3] === "move: Ally Switch" ? "passed" : "failed";
        attribute(mon, tags, command);
        break;
      }
      case "-miss": case "-immune": {
        const target = command === "-miss" ? activeMon(parts[3]) : activeMon(parts[2]);
        if (move && move.single && move.own && (!target || target.key !== move.user)) mons[move.user].thisResult = false;
        if (command === "-immune") attribute(activeMon(parts[2]), tags, command);
        break;
      }
      case "-crit": { const mon = activeMon(parts[2]); if (mon && move) move.crits.add(mon.key); break; }
      case "-hitcount": if (move) move.multiHit = true; break;
      case "-singleturn": {
        const mon = activeMon(parts[2]);
        if (!mon) break;
        const id = effectId(parts[3]);
        if (move?.protecting && move.user === mon.key) {
          mon.protectStreak++; mon.protectedThisTurn = true;
          addVolatile(mon, { id: id === "endure" ? "endure" : "protect", since: since(), elapsed: 0 });
        } else if (id === "helpinghand") {
          builder.helpingHand.add(mon.key);
          addVolatile(mon, { id, since: since(), elapsed: 0 });
        } else if (["followme", "ragepowder", "roost", "protect", "endure", "destinybond"].includes(id)) {
          addVolatile(mon, { id, since: since(), elapsed: 0 });
        } else if (id === "instruct") instructed.add(mon.key);
        break;
      }
      case "-singlemove": {
        // Destiny Bond, Grudge: until the user's next move (pinned data/moves.ts destinybond condition onStart "-singlemove").
        const mon = activeMon(parts[2]);
        if (mon) addVolatile(mon, { id: effectId(parts[3]), since: since(), elapsed: 0 });
        break;
      }
      case "-damage": onDamage(parts, tags); break;
      case "-heal": case "-sethp": {
        const mon = activeMon(parts[2]);
        if (!mon) break;
        setHP(mon, parts[3]);
        if (tags.from === "move: Wish" && mon.position !== null) {
          const layers = mon.position + 1;
          sides[mon.side].conditions = sides[mon.side].conditions.filter((each) => !(each.id === "wish" && each.layers === layers));
        } else if ((tags.from === "move: Healing Wish" || tags.from === "move: Lunar Dance") && mon.position !== null) {
          // status2 gap fix: the waiting Healing Wish or Lunar Dance used (removeSlotCondition after its heal).
          const id = tags.from === "move: Healing Wish" ? "healingwish" : "lunardance", layers = mon.position + 1;
          sides[mon.side].conditions = sides[mon.side].conditions.filter((each) => !(each.id === id && each.layers === layers));
        } else attribute(mon, tags, command);
        break;
      }
      case "faint": {
        const mon = activeMon(parts[2]);
        if (!mon) break;
        // status2 gap fix: Healing Wish and Lunar Dance (selfdestruct "ifHit": the user faints in its own move) leave their
        // slot condition at its position until a hurt or statused Pokémon switches in there (pinned data/moves.ts healingwish
        // onSwap; it waits otherwise): side condition id, layers = position + 1, like Wish.
        if (move && move.user === mon.key && (move.moveId === "healingwish" || move.moveId === "lunardance") && mon.position !== null) {
          const id = move.moveId, layers = mon.position + 1;
          sides[mon.side].conditions = [...sides[mon.side].conditions.filter((each) => !(each.id === id && each.layers === layers)), { id, since: turn, layers, setterKey: mon.key }];
        }
        onFaint(mon);
        break;
      }
      case "-status": {
        const mon = activeMon(parts[2]);
        if (!mon) break;
        mon.status = toID(parts[3]) as BattleStatus; mon.statusElapsed = 0;
        // Rest's sleep lasts three turns (pinned data/moves.ts rest onHit: statusState.time 3): "-status|X|slp|[from] move: Rest".
        if (mon.status === "slp" && tags.from === "move: Rest") mon.restSleep = true;
        else delete mon.restSleep;
        attribute(mon, tags, command);
        break;
      }
      case "-curestatus": {
        const mon = activeMon(parts[2]) ?? monOf(parts[2]);
        if (mon) { mon.status = ""; mon.statusElapsed = 0; delete mon.restSleep; attribute(mon, tags, command); }
        break;
      }
      case "-cureteam": { const ref = parseRef(parts[2]); if (ref) for (const mon of Object.values(mons)) if (mon.side === ref.side) { mon.status = ""; mon.statusElapsed = 0; delete mon.restSleep; } break; }
      case "-boost": case "-unboost": {
        const mon = activeMon(parts[2]);
        if (!mon) break;
        const amount = Number(parts[4]) * (command === "-boost" ? 1 : -1);
        setBoost(mon, parts[3], mon.boosts[parts[3] as BoostId] + amount);
        attribute(mon, tags, command);
        if (amount > 0) mon.thisTurn = { ...mon.thisTurn, statsRaised: true };
        else if (amount < 0) mon.thisTurn = { ...mon.thisTurn, statsLowered: true };
        // status2 T1: a Stockpile layer counts each stat its boost changed (ADDENDUM2 C17).
        const stat = parts[3];
        if (pile && pile.key === mon.key && !tags.from && (stat === "def" || stat === "spd") && !pile.seen.has(stat)) {
          pile.seen.add(stat);
          const layer = volatile(mon, "stockpile") as StockpileVolatile | undefined;
          if (layer && amount !== 0) layer[stat] = (layer[stat] ?? 0) - 1;
          stockpileBoost = pile;
        }
        // status2 T1: a rise after this turn's residual waits for the other side's Opportunist (its printed amount is the
        // capped boost table AfterBoost passes: PS/sim/battle.ts boost getCappedBoost).
        if (amount > 0 && afterUpkeep && !copyApplied && tags.from !== "ability: Opportunist" && tags.from !== "item: Mirror Herb") {
          for (const key of active[other(mon.side)]) {
            const foe = key ? mons[key] : null;
            if (foe && !foe.fainted) foe.copyRises = { ...foe.copyRises, [stat]: (foe.copyRises?.[stat as BoostId] ?? 0) + amount };
          }
        }
        break;
      }
      case "-setboost": {
        const mon = activeMon(parts[2]);
        if (!mon) break;
        const was = mon.boosts[parts[3] as BoostId];
        setBoost(mon, parts[3], Number(parts[4]));
        attribute(mon, tags, command);
        // Belly Drum's is a boost() (statsRaisedThisTurn); Anger Point's a setBoost (no flag).
        if (tags.from !== "ability: Anger Point" && mon.boosts[parts[3] as BoostId] > was) mon.thisTurn = { ...mon.thisTurn, statsRaised: true };
        break;
      }
      case "-clearboost": { const mon = activeMon(parts[2]); if (mon) mon.boosts = zeroBoosts(); break; }
      case "-clearallboost": for (const side of ["p1", "p2"] as const) for (const key of active[side]) if (key) mons[key].boosts = zeroBoosts(); break;
      case "-clearnegativeboost": case "-clearpositiveboost": {
        const mon = activeMon(parts[2]);
        if (!mon) break;
        for (const stat of BOOSTS) if (command === "-clearnegativeboost" ? mon.boosts[stat] < 0 : mon.boosts[stat] > 0) mon.boosts[stat] = 0;
        break;
      }
      case "-invertboost": { const mon = activeMon(parts[2]); if (mon) for (const stat of BOOSTS) mon.boosts[stat] = -mon.boosts[stat] || 0; break; }
      case "-copyboost": { const mon = activeMon(parts[2]), from = activeMon(parts[3]); if (mon && from) mon.boosts = { ...from.boosts }; break; }
      case "-swapboost": {
        const a = activeMon(parts[2]), b = activeMon(parts[3]);
        if (!a || !b) break;
        const stats = parts[4] && !parts[4].startsWith("[") ? parts[4].split(",").map((each) => each.trim()) as BoostId[] : [...BOOSTS];
        for (const stat of stats) { const keep = a.boosts[stat]; a.boosts[stat] = b.boosts[stat]; b.boosts[stat] = keep; }
        break;
      }
      case "-weather": {
        if (parts[2] === "none") { field.weather = null; break; }
        if ("upkeep" in tags) break;
        const setter = tags.of ? activeMon(tags.of) : move ? mons[move.user] : null;
        const fromAbility = (tags.from ?? "").startsWith("ability: ");
        attribute(null, tags, command);
        field.weather = { id: toID(parts[2]), since: since(), layers: 1, setterKey: setter?.key ?? null, fromAbility };
        break;
      }
      case "-fieldstart": {
        const id = effectId(parts[2]);
        const setter = tags.of ? activeMon(tags.of) : move ? mons[move.user] : null;
        attribute(null, tags, command);
        const entry: PublicCondition = { id, since: since(), layers: 1, setterKey: setter?.key ?? null };
        if (id.endsWith("terrain")) field.terrain = entry;
        else field.rooms = [...field.rooms.filter((each) => each.id !== id), entry];
        break;
      }
      case "-fieldactivate": {
        const id = effectId(parts[2]);
        if (id === "fairylock") field.rooms = [...field.rooms.filter((each) => each.id !== id), { id, since: since(), layers: 1, setterKey: move?.user ?? null }];
        break;
      }
      case "-endability": {
        // Gastro Acid (pinned data/moves.ts gastroacid condition onStart "-endability").
        const mon = activeMon(parts[2]);
        if (mon && !tags.from) addVolatile(mon, { id: "gastroacid", since: since(), elapsed: 0 });
        // status2 T1: the suppressed ability's End runs (Opportunist's deletes its pending copy).
        if (mon && !tags.from) delete mon.copyRises;
        break;
      }
      case "-fieldend": {
        const id = effectId(parts[2]);
        if (id.endsWith("terrain")) field.terrain = null;
        else field.rooms = field.rooms.filter((each) => each.id !== id);
        break;
      }
      case "-sidestart": {
        const side = parts[2]?.slice(0, 2) as SideID;
        if (side !== "p1" && side !== "p2") break;
        sides[side].conditions = condition(sides[side].conditions, effectId(parts[3]), move ? move.user : null);
        break;
      }
      case "-sideend": {
        const side = parts[2]?.slice(0, 2) as SideID;
        if (side === "p1" || side === "p2") sides[side].conditions = sides[side].conditions.filter((each) => each.id !== effectId(parts[3]));
        break;
      }
      case "-swapsideconditions": {
        // status2 R-T: Court Change swaps the two sides' conditions of its list, each with its own state (layers, turns left,
        // setter: pinned data/moves.ts courtchange onHitField moves the effect states), before its -activate line; the slot
        // conditions (Wish, Future Sight) stay.
        const swaps = (each: PublicCondition) => COURT_CHANGE.has(each.id);
        const p1 = sides.p1.conditions, p2 = sides.p2.conditions;
        sides.p1.conditions = [...p1.filter((each) => !swaps(each)), ...p2.filter(swaps)];
        sides.p2.conditions = [...p2.filter((each) => !swaps(each)), ...p1.filter(swaps)];
        break;
      }
      case "-start": {
        const mon = activeMon(parts[2]);
        if (!mon) break;
        let id = effectId(parts[3]);
        if (id === "typechange" || id === "typeadd") {
          // The types are public; "typechange" without types (Reflect Type) is completed by endTurn's silent display line
          // (pinned sim/battle.ts endTurn). moveId carries the types ("Psychic", "Ground/Steel").
          const types = parts[4] && !parts[4].startsWith("[") ? parts[4] : undefined;
          const existing = volatile(mon, id);
          if ("silent" in tags) { if (existing && types) existing.moveId = types; break; }
          // status2 T1: a type change (setType) also ends the added type (pinned sim/pokemon.ts setType); Reflect Type then
          // copies its target's base types and added type (data/moves.ts reflecttype onHit: its line names no types, and its
          // types are the target's as they stand: the target's own public change, else its form's, sourceKey).
          const copied = id === "typechange" && tags.from === "move: Reflect Type" && tags.of ? activeMon(tags.of) : null;
          if (id === "typechange") removeVolatile(mon, "typeadd");
          const from = copied ? volatile(copied, "typechange")?.moveId : undefined;
          // With no public change of its own the target had its form's types (a transformed one its Transform target's form).
          const form = copied && !from ? (copied.transformedInto ? copied.stored?.find((each) => each.move === "transform")?.partner?.speciesId : copied.speciesId) : undefined;
          addVolatile(mon, { id, since: since(), elapsed: 0, ...(types ?? from ? { moveId: types ?? from } : form ? { speciesId: form } : {}) });
          const added = copied ? volatile(copied, "typeadd") : undefined;
          if (added) addVolatile(mon, { ...structuredClone(added), since: since() });
          // Protean and Libero's own change uses them up for this entry (data/abilities.ts protean: abilityState.protean).
          if (tags.from === "ability: Protean" || tags.from === "ability: Libero") mon.typeChanger = true;
          attribute(mon, tags, command);
          break;
        }
        if (id === "futuresight" || id === "doomdesire") {
          // A slot condition on the target's slot (pinned data/moves.ts futuresight onTry addSlotCondition): side condition
          // "futuresight" on the target's side, layers = the slot's position + 1.
          const target = move ? activeMon(move.targetIdent ?? undefined) : null;
          if (move && target && target.position !== null) {
            const layers = target.position + 1;
            sides[target.side].conditions = [...sides[target.side].conditions.filter((each) => !(each.id === id && each.layers === layers)),
              { id, since: since(), layers, setterKey: move.user }];
          }
          break;
        }
        const ongoing = "upkeep" in tags ? volatile(mon, id) : undefined;   // Uproar's "[upkeep]" restatements keep its start
        attribute(mon, tags, command);
        // status2 T2: Smack Down (and Thousand Arrows) grounds it (data/moves.ts smackdown condition onStart / onRestart).
        if (id === "smackdown") grounded(mon);
        if (id === "confusion" && "fatigue" in tags) mon.lock = null;
        const perish = /^perish(\d)$/.exec(id);
        const fallen = /^fallen(\d)$/.exec(id);
        const stockpile = /^stockpile(\d)$/.exec(id);
        const entry: PublicVolatile = { id, since: ongoing?.since ?? since(), elapsed: 0 };
        if (perish) { id = "perishsong"; Object.assign(entry, { id, layers: Number(perish[1]), since: volatile(mon, id)?.since ?? since() }); }
        else if (stockpile) {
          // status2 T1: the counts so far carry over to the next layer; this layer's boost lines come next.
          const was = volatile(mon, "stockpile") as StockpileVolatile | undefined;
          id = "stockpile";
          Object.assign(entry, { id, layers: Number(stockpile[1]), def: was?.def ?? 0, spd: was?.spd ?? 0 } satisfies Partial<StockpileVolatile>);
          stockpileBoost = { key: mon.key, seen: new Set() };
        }
        // Supreme Overlord's count of fallen allies (pinned data/abilities.ts supremeoverlord onStart: "-start|X|fallenN|[silent]").
        else if (fallen) { id = "fallen"; Object.assign(entry, { id, layers: Number(fallen[1]) }); }
        else if (id === "encore") entry.moveId = mon.lastMove ?? undefined;
        else if (id === "disable") entry.moveId = toID(parts[4]);
        // R9; Cursed Body disables the attacker as it moves, which counts as not yet moved (data/moves.ts disable onStart).
        if (id === "taunt" || id === "encore" || id === "disable") entry.targetMovedFirst = builder.acted.has(mon.key) && !afterUpkeep && tags.from !== "ability: Cursed Body";
        if (id === "healblock" && move) entry.moveId = move.moveId;   // Psychic Noise blocks for 2 turns (data/moves.ts healblock durationCallback)
        // Axe Kick's confusion lasts at least 3 turns (pinned data/conditions.ts confusion onStart: min 3 for axekick).
        if (id === "confusion" && !("fatigue" in tags) && move?.moveId === "axekick" && move.user !== mon.key) entry.moveId = "axekick";
        // A Substitute stint: its maker and the hits it has taken (ADDENDUM §6).
        if (id === "substitute") Object.assign(entry, { sourceKey: mon.key, hits: 0 } satisfies Partial<SubstituteVolatile>);
        // Syrup Bomb's source is the move's user (its -start line names no [of]; data/moves.ts syrupbomb ends when it leaves).
        // status2 T1: Octolock names its user ([of]; data/moves.ts octolock condition onStart), which the residual reads.
        if (id === "leechseed" || id === "yawn" || id === "attract" || id === "syrupbomb" || id === "octolock") entry.sourceKey = (tags.of ? activeMon(tags.of)?.key : move?.user) ?? undefined;
        // Leech Seed heals whoever stands at the seeder's position as it seeded (data/moves.ts leechseed sourceSlot).
        if (id === "leechseed" && entry.sourceKey) { const at = mons[entry.sourceKey]?.position; if (at === 0 || at === 1) entry.sourcePosition = at; }
        addVolatile(mon, entry);
        // status2 T1: Power Trick and Power Shift swap the stored Attack and Defense as they start (data/moves.ts onStart).
        if (id === "powertrick" || id === "powershift") storedEvent(mon, id);
        break;
      }
      case "-end": {
        const mon = activeMon(parts[2]) ?? monOf(parts[2]);
        if (!mon) break;
        const id = effectId(parts[3]);
        if ((id === "futuresight" || id === "doomdesire") && mon.position !== null) {
          const layers = mon.position + 1;
          sides[mon.side].conditions = sides[mon.side].conditions.filter((each) => !(each.id === id && each.layers === layers));
          // status2 T1: its hit comes next (data/conditions.ts futuremove onEnd).
          landing = mon.key;
          break;
        }
        // status2 T1: Octolock's silent end once its user left names itself with that tag (data/moves.ts octolock onResidual).
        if ("partiallytrapped" in tags && id !== "octolock") removeVolatile(mon, "partiallytrapped");
        else removeVolatile(mon, /^stockpile/.test(id) ? "stockpile" : id);
        // status2 T1: and swap them back as they end (onEnd; a second use's onRestart ends it).
        if ((id === "powertrick" || id === "powershift") && mon.position !== null) storedEvent(mon, id);
        attribute(mon, tags, command);
        break;
      }
      case "-activate": {
        const mon = activeMon(parts[2]);
        if (!mon) break;
        const what = parts[3] ?? "";
        const id = effectId(what);
        if (id === "confusion") { const confusion = volatile(mon, "confusion"); if (confusion) confusion.elapsed++; break; }   // R10
        if (id === "substitute" && move && move.user !== mon.key) move.landed = true;
        // status2 T2: a protection broken (Feint, Phantom Force, Shadow Force, a Max Move: "-activate|X|move: Feint" or
        // "-activate|X|move: …|[broken]") deletes its stall counter from generation 6 (PS/sim/battle-actions.ts breaksProtect).
        if (id === "feint" || "broken" in tags) { mon.protectStreak = 0; mon.protectedThisTurn = false; }
        // status2 T2: Gravity grounds a Pokémon charging Fly or Bounce (its move cancelled, twoturnmove removed) and ends Magnet
        // Rise and Telekinesis (data/moves.ts gravity onFieldStart: "-activate|X|move: Gravity").
        if (id === "gravity") grounded(mon);
        if (id === "substitute" && "damage" in tags) { const sub = volatile(mon, "substitute") as SubstituteVolatile | undefined; if (sub) sub.hits = (sub.hits ?? 0) + 1; }
        // status2 T1: the hit's damage calculation ran on the Pokémon behind it (Ripen's onSourceModifyDamage).
        if (id === "substitute" && "damage" in tags && move && move.user !== mon.key) move.subHit.add(mon.key);
        if (id === "powersplit" || id === "guardsplit" || id === "speedswap") {
          // status2 T1: "-activate|source|move: Power Split|[of] target" (data/moves.ts onHit): both stored stats change.
          const target = activeMon(tags.of);
          if (target && target !== mon) storedPair(mon, target, id);
          break;
        }
        if (id === "spite" || id === "eeriespell") {
          // "-activate|target|move: Spite|Move|n": n PP of that move lost (pinned data/moves.ts spite onHit, eeriespell).
          const lost = toID(parts[4]);
          if (lost) mon.movesUsed[lost] = (mon.movesUsed[lost] ?? 0) + (Number(parts[5]) || 0);
          break;
        }
        if (id === "skillswap") {
          // "-activate|source|move: Skill Swap|targetAbility|sourceAbility|[of] target" (pinned data/moves.ts skillswap onHit);
          // between allies both abilities are blank: the shown ones swap.
          const target = activeMon(tags.of);
          // status2 T1: both abilities get a fresh ability state (pinned sim/battle.ts skillSwap). status2 T2: in that order, the
          // line's Pokémon first (Wandering Spirit's swap is the same call and line, its attacker first).
          for (const each of [mon, target]) if (each) newEntry(each);
          if (target && !parts[4] && !parts[5]) {
            const mine = mon.ability, theirs = target.ability;
            mon.ability = theirs ? { abilityId: theirs.abilityId, how: "changed" } : null;
            target.ability = mine ? { abilityId: mine.abilityId, how: "changed" } : null;
            break;
          }
          const gained = toID(parts[4]), given = toID(parts[5]);
          if (given && mon.ability?.how !== "changed" && mon.ability?.how !== "copied") showAbility(mon, given);
          if (target && gained && target.ability?.how !== "changed" && target.ability?.how !== "copied") showAbility(target, gained);
          if (gained) mon.ability = { abilityId: gained, how: "changed" };
          if (target && given) target.ability = { abilityId: given, how: "changed" };
          break;
        }
        if (id === "trapped") {
          // Mean Look, Block, Spider Web (pinned data/moves.ts meanlook onHit: "-activate|target|trapped"): trapped until the source leaves.
          addVolatile(mon, { id: "trapped", since: since(), elapsed: 0, sourceKey: move?.user });
          if (move && mons[move.user]) addVolatile(mons[move.user], { id: "trapper", since: since(), elapsed: 0 });
          break;
        }
        if (what.startsWith("item: ")) { holdItem(mon, id); if (id === "quickclaw") builder.quickClaw.add(mon.key); break; }
        if (what.startsWith("ability: ")) {
          showAbility(mon, id); if (id === "sturdy") censor(mon, "sturdy"); if (id === "cudchew") { delete mon.cudChew; cudChewEat = mon.key; }
          // status2 T2: Battle Bond's once-a-battle boost (pinned bondTriggered); a Lightning Rod or Storm Drain redirecting the
          // open move (its chosen target is not public); Mummy giving its ability (setAbility: a new ability state,
          // "-activate|holder|ability: Mummy|<changed>|[ability] Old": PS/sim/pokemon.ts setAbility).
          if (id === "battlebond") onceUsed(mon, "battlebond");
          if ((id === "lightningrod" || id === "stormdrain") && move && mons[move.user] && !move.targetKnown) mons[move.user].lastTargetUnknown = true;
          if (id === "mummy") {
            const changed = activeMon(parts[4]);
            if (changed && changed !== mon) { changed.ability = { abilityId: "mummy", how: "changed" }; newEntry(changed); }
          }
          break;
        }
        // status2 T2: Lock-On and Mind Reader (pinned data/moves.ts lockon onHit: "-activate|user|move: Lock-On|[of] target",
        // the lockon volatile on the user, its source the target, lasting two end-of-turn countdowns).
        if ((id === "lockon" || id === "mindreader") && tags.of) {
          addVolatile(mon, { id: "lockon", since: since(), elapsed: 0, sourceKey: activeMon(tags.of)?.key });
          break;
        }
        if (what.startsWith("move: ") && tags.of && PARTIAL_TRAPS.has(id)) {
          addVolatile(mon, { id: "partiallytrapped", since: since(), elapsed: 0, moveId: id, sourceKey: activeMon(tags.of)?.key });
        }
        break;
      }
      // "[premajor]" is Chilly Reception's announcement before it acts, not a charge (pinned data/moves.ts chillyreception).
      case "-prepare": { const mon = activeMon(parts[2]); if (mon && !("premajor" in tags)) { const id = toID(parts[3]); mon.charging = id; addVolatile(mon, { id: "twoturnmove", since: since(), elapsed: 0, moveId: id }); } break; }
      case "-anim": { const mon = activeMon(parts[2]); if (mon && mon.charging === toID(parts[3])) { mon.charging = null; removeVolatile(mon, "twoturnmove"); } break; }
      case "-mustrecharge": { const mon = activeMon(parts[2]); if (mon) addVolatile(mon, { id: "mustrecharge", since: since(), elapsed: 0 }); break; }
      case "-enditem": {
        const mon = activeMon(parts[2]) ?? monOf(parts[2]);
        if (!mon) break;
        // Cud Chew's re-eat (its -activate line, then this one): no eatItem (no usedItemThisTurn), no item it holds now.
        if (reEat === mon.key && "eat" in tags) break;
        const id = toID(parts[3]);
        const removed = (tags.from ?? "").startsWith("move: ") || tags.from === "stealeat";
        mon.item = { state: "gone", itemId: id, how: removed ? "removed" : "consumed", stint: mon.switchIns };
        // usedItemThisTurn (eatItem, useItem, Fling's volatile): not a popped Air Balloon (its item set to "" directly).
        const used = "eat" in tags || (!tags.from && id !== "airballoon") || tags.from === "gem" || tags.from === "move: Fling";
        if (used) mon.thisTurn = { ...mon.thisTurn, usedItem: true };
        if ("eat" in tags && tags.from !== "stealeat" && id.endsWith("berry")) mon.cudChew = { berry: id, turn };
        // status2 T1: pokemon.lastItem (eatItem, useItem, Fling: PublicCounts.lastItem); a stolen Berry sets no one's.
        if (used) { mon.lastItem = id; delete mon.lastItemUnknown; }
        // Ripen's weakened Berry: a resist Berry eaten (its eater's onEatItem), used up at once by the hit it was eaten in
        // (the Berry's own "[weaken]" line follows); any other Berry clears it. Bug Bite and Pluck: the stealer eats it.
        const eater = "eat" in tags ? mon : tags.from === "stealeat" && tags.of ? activeMon(tags.of) : null;
        if (eater && id.endsWith("berry")) { if (RESIST_BERRIES.has(id)) eater.ripen = "weaken"; else delete eater.ripen; }
        if ("weaken" in tags) delete mon.ripen;
        if (tags.from === "move: Fling" && move && move.user === mon.key) move.flung = id;
        if (id.endsWith("berry") && ("eat" in tags || tags.from === "stealeat" || tags.from === "move: Fling")) eaten = id;
        reveal(mon, "item-gone", id);
        if (id === "focussash") censor(mon, "focus-sash");
        if (tags.from && !removed) attribute(mon, tags, command);
        break;
      }
      case "-item": {
        const mon = activeMon(parts[2]);
        if (!mon) break;
        const id = toID(parts[3]);
        mon.item = { state: "held", itemId: id };
        reveal(mon, "item", id);
        // Trick and Switcheroo hand over an item (pinned data/moves.ts trick onHit "-item|X|item|[from] move: Trick").
        if (tags.from === "move: Trick" || tags.from === "move: Switcheroo") mon.itemSince = mon.actions;
        else delete mon.itemSince;
        // An item reaching it (not a Frisk reveal or a switch-in announcement) starts a new Choice lock at its next move.
        if (tags.from && tags.from !== "ability: Frisk") delete mon.choiceMove;
        if ((tags.from ?? "").startsWith("ability: ")) showAbility(tags.of ? activeMon(tags.of) : mon, effectId(tags.from));
        // status2 T1: Recycle and Harvest restore the last item and clear it (data/moves.ts recycle, data/abilities.ts harvest);
        // Pickup clears its random target's (data/abilities.ts pickup: an active Pokémon that used an item this turn), named
        // only by the item: with two such Pokémon of that item, whose is not public.
        if (tags.from === "move: Recycle" || tags.from === "ability: Harvest") { delete mon.lastItem; delete mon.lastItemUnknown; }
        if (tags.from === "ability: Pickup") {
          const from = Object.values(mons).filter((each) => each !== mon && each.position !== null && !each.fainted && each.lastItem === id && each.thisTurn?.usedItem);
          if (from.length === 1) { delete from[0].lastItem; delete from[0].lastItemUnknown; }
          else for (const each of from) each.lastItemUnknown = true;
        }
        break;
      }
      case "-ability": {
        const mon = activeMon(parts[2]);
        if (!mon) break;
        const id = toID(parts[3]);
        const from = tags.from ?? "";
        if (from === "ability: Trace") {
          // pinned data/abilities.ts trace: "-ability|X|A|[from] ability: Trace|[of] Y": X traced Y's A.
          reveal(mon, "ability", "trace");
          mon.ability = { abilityId: id, how: "copied" };
          if (tags.of) showAbility(activeMon(tags.of), id);
          newEntry(mon);   // status2 T1: setAbility's fresh ability state (status2 T2: and its order)
        } else if (from.startsWith("move: ") || from.startsWith("ability: ")) {
          mon.ability = { abilityId: id, how: "changed" };
          newEntry(mon);
        } else {
          showAbility(mon, id);
          if (id === "sturdy") censor(mon, "sturdy");
          // status2 T2: generation 9's once-a-battle Starts (pinned data/abilities.ts supersweetsyrup "-ability|X|Supersweet
          // Syrup"; intrepidsword and dauntlessshield's boost "-ability|X|Intrepid Sword|boost": sim/battle.ts boost).
          if (id === "supersweetsyrup" || id === "intrepidsword" || id === "dauntlessshield") onceUsed(mon, id);
        }
        break;
      }
      case "win": closeTurn(); ended = true; winner = parts[2] === undefined ? null : sideOfName(parts[2]); builder = newBuilder(turn); break;
      case "tie": closeTurn(); ended = true; winner = "tie"; builder = newBuilder(turn); break;
      case "player": if (parts[2] === "p1" || parts[2] === "p2") playerNames[parts[2]] = parts[3] ?? ""; break;
      default: break;
    }
  }
  const playerNames: Record<SideID, string> = { p1: "", p2: "" };
  const sideOfName = (name: string): SideID | null => (playerNames.p1 === name ? "p1" : playerNames.p2 === name ? "p2" : null);

  function exportMon(mon: Mon): PublicMon {
    const { thisResult: _r, protectedThisTurn: _p, charging: _c, stintMoves: _s, notChoiceShown: _n, stintSpecies: _f, baseShown: _b, allySwitchThisTurn: _a, ...rest } = mon;
    void _r; void _p; void _c; void _s; void _n; void _f; void _b; void _a;
    return structuredClone(rest);
  }

  return {
    push(lines) {
      for (const text of lines) if (text.startsWith("|")) line(text);
    },
    chose(choice) {
      // One part per active position of the viewer's side, in position order (sim/side.ts choose); a move part's number
      // after the move is its target loc (positive: a foe's position, negative: its own side's). Switches and passes name none.
      choice.split(",").map((part) => part.trim()).forEach((part, position) => {
        const key = active[viewer][position];
        const match = /^move\s+\S+(?:\s+(-?\d+))?/.exec(part);
        if (!key || !match) return;
        chosenTarget.set(key, match[1] !== undefined ? Number(match[1]) : null);
      });
    },
    state() {
      return {
        viewer, turn,
        mons: Object.fromEntries(Object.values(mons).map((mon) => [mon.key, exportMon(mon)])),
        sides: structuredClone(sides), field: structuredClone(field), lastMove, ended, winner,
      };
    },
    observations() {
      return structuredClone(done);
    },
  };
}

/** status2 R-T: the side conditions Court Change swaps (pinned data/moves.ts courtchange onHitField's list). */
const COURT_CHANGE: ReadonlySet<string> = new Set([
  "mist", "lightscreen", "reflect", "spikes", "safeguard", "tailwind", "toxicspikes", "stealthrock", "waterpledge", "firepledge", "grasspledge", "stickyweb",
  "auroraveil", "luckychant", "gmaxsteelsurge", "gmaxcannonade", "gmaxvinelash", "gmaxwildfire", "gmaxvolcalith",
]);
/** "-singlemove" effects: they last until the user's next move (Destiny Bond, Grudge, Glaive Rush). */
const SINGLE_MOVE: readonly string[] = ["destinybond", "grudge", "glaiverush"];
/** Volatiles Baton Pass does not pass (pinned data: noCopy). */
const NO_COPY: ReadonlySet<string> = new Set(["attract", "choicelock", "commanded", "commanding", "counter", "defensecurl", "destinybond", "disable", "dynamax", "encore", "flashfire", "foresight", "glaiverush", "imprison", "lockon", "minimize", "miracleeye", "mirrorcoat", "nightmare", "protosynthesis", "quarkdrive", "saltcure", "smackdown", "spotlight", "stockpile", "syrupbomb", "torment", "trapped", "trapper", "yawn", "protect", "helpinghand", "followme", "ragepowder", "roost", "endure", "twoturnmove", "mustrecharge"]);
/** The crit volatiles Transform copies (pinned sim/pokemon.ts transformInto volatilesToCopy). */
const TRANSFORM_COPIED: ReadonlySet<string> = new Set(["dragoncheer", "focusenergy", "gmaxchistrike", "laserfocus"]);
/** The resist Berries (Ripen's weakenBerries, pinned data/abilities.ts ripen onEatItem). */
const RESIST_BERRIES: ReadonlySet<string> = new Set([
  "babiriberry", "chartiberry", "chilanberry", "chopleberry", "cobaberry", "colburberry", "habanberry", "kasibberry", "kebiaberry",
  "occaberry", "passhoberry", "payapaberry", "rindoberry", "roseliberry", "shucaberry", "tangaberry", "wacanberry", "yacheberry",
]);
/** Partial-trapping moves (pinned data/moves.ts volatileStatus 'partiallytrapped'): their -activate starts the trap. */
const PARTIAL_TRAPS: ReadonlySet<string> = new Set(["bind", "clamp", "firespin", "infestation", "magmastorm", "sandtomb", "snaptrap", "thundercage", "whirlpool", "wrap"]);

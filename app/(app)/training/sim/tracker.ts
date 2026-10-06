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
  state(): PublicState;
  observations(): TurnObservations[];
};

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
type Mon = PublicMon & {
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

export function createTracker(viewer: SideID, keys: (side: SideID, name: string) => string): PublicTracker {
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
  let builder = newBuilder(0);

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
    mons[key] ??= {
      key, side: ref.side, position: null, speciesId: toID(ref.name), mega: false,
      hp: { percent: 100, color: null }, exact: null, fainted: false, status: "", statusElapsed: 0, boosts: zeroBoosts(), volatiles: [],
      item: { state: "not-shown" }, ability: null, movesUsed: {}, lastMove: null, lastMoveTarget: null, lastResult: null, actions: 0,
      activeTurns: 0, timesHit: 0, switchIns: 0, protectStreak: 0, lock: null, transformedInto: null,
      thisResult: undefined, protectedThisTurn: false, charging: null, stintMoves: [], notChoiceShown: false, stintSpecies: toID(ref.name), baseShown: null,
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
    if (hp.status !== null && hp.status !== mon.status) { mon.status = hp.status; mon.statusElapsed = 0; }
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
    // Mean Look / Block: "trapped" and the source's "trapper" are linked volatiles; either leaving ends both
    // (pinned data/moves.ts meanlook onHit addVolatile(..., 'trapper'); sim/pokemon.ts removeVolatile linkedStatus).
    for (const each of Object.values(mons)) {
      if (each.volatiles.some((v) => v.id === "trapped" && v.sourceKey === mon.key)) removeVolatile(each, "trapped");
    }
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
      }
    }
    for (const mon of Object.values(mons)) mon.volatiles = mon.volatiles.filter((each) => !SINGLE_TURN.includes(each.id));
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
    if (passer) {
      if (tags.from === "Baton Pass") mon.boosts = { ...passer.boosts };
      mon.volatiles = passer.volatiles.filter((each) => (tags.from === "Shed Tail" ? each.id === "substitute" : !NO_COPY.has(each.id)));
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
    };
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
    mon.lastMoveTarget = targetRef && targetRef.position !== null && !("notarget" in tags) ? { side: targetRef.side, position: targetRef.position } : null;
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
    // R5: a two-turn move's release (the next own line of that move without [still]) ends its charge.
    if (mon.charging === moveId && !("still" in tags)) { mon.charging = null; removeVolatile(mon, "twoturnmove"); }
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
      return;
    }
    if (tags.from || !move || move.user === mon.key) return;
    const attacker = mons[move.user];
    mon.timesHit++;
    move.landed = true;
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
    mon.status = ""; mon.statusElapsed = 0;
    clearStint(mon);
    sides[mon.side].totalFainted++;
    faintedThisTurn[mon.side] = mon.key;
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
    const parts = text.split("|");
    const command = parts[1] ?? "";
    const tags = tagsOf(parts);
    switch (command) {
      case "turn": onTurn(Number(parts[2])); break;
      case "upkeep": finishMove(); closeEntries(); afterUpkeep = true; break;
      case "switch": case "drag": finishMove(); onSwitch(parts, tags, command); break;
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
        break;
      }
      case "detailschange": { const mon = activeMon(parts[2]); if (mon) { mon.speciesId = speciesOfDetails(parts[3]); mon.stintSpecies = mon.speciesId; if (/-Mega/.test(parts[3] ?? "")) mon.mega = true; } break; }
      case "-formechange": { const mon = activeMon(parts[2]); if (mon) { mon.speciesId = toID(parts[3]); attribute(mon, tags, command); } break; }
      case "-mega": {
        const mon = activeMon(parts[2]);
        if (!mon) break;
        mon.mega = true;
        sides[mon.side].megaUsed = true;
        // The Mega form's own ability replaces the shown one (pinned sim/pokemon.ts formeChange setAbility).
        mon.ability = null;
        const stone = toID(parts[4]);
        if (stone) { mon.item = { state: "held", itemId: stone }; reveal(mon, "mega", stone); reveal(mon, "item", stone); }
        break;
      }
      case "-transform": { const mon = activeMon(parts[2]), into = activeMon(parts[3]); if (mon && into) mon.transformedInto = into.key; attribute(mon, tags, command); break; }
      case "move": onMove(parts, tags); break;
      case "cant": {
        finishMove();
        const mon = activeMon(parts[2]);
        if (!mon) break;
        if (tags.of) { showAbility(mon, effectId(parts[3]?.startsWith("ability: ") ? parts[3] : "")); break; }   // a blocked move (Armor Tail …), not this Pokémon's action
        mon.actions++; mon.thisResult = null; mon.lock = null;
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
        }
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
        } else attribute(mon, tags, command);
        break;
      }
      case "faint": { const mon = activeMon(parts[2]); if (mon) onFaint(mon); break; }
      case "-status": {
        const mon = activeMon(parts[2]);
        if (!mon) break;
        mon.status = toID(parts[3]) as BattleStatus; mon.statusElapsed = 0;
        attribute(mon, tags, command);
        break;
      }
      case "-curestatus": {
        const mon = activeMon(parts[2]) ?? monOf(parts[2]);
        if (mon) { mon.status = ""; mon.statusElapsed = 0; attribute(mon, tags, command); }
        break;
      }
      case "-cureteam": { const ref = parseRef(parts[2]); if (ref) for (const mon of Object.values(mons)) if (mon.side === ref.side) { mon.status = ""; mon.statusElapsed = 0; } break; }
      case "-boost": case "-unboost": {
        const mon = activeMon(parts[2]);
        if (!mon) break;
        const amount = Number(parts[4]) * (command === "-boost" ? 1 : -1);
        setBoost(mon, parts[3], mon.boosts[parts[3] as BoostId] + amount);
        attribute(mon, tags, command);
        break;
      }
      case "-setboost": { const mon = activeMon(parts[2]); if (mon) { setBoost(mon, parts[3], Number(parts[4])); attribute(mon, tags, command); } break; }
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
          addVolatile(mon, { id, since: since(), elapsed: 0, ...(types ? { moveId: types } : {}) });
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
        if (id === "confusion" && "fatigue" in tags) mon.lock = null;
        const perish = /^perish(\d)$/.exec(id);
        const fallen = /^fallen(\d)$/.exec(id);
        const stockpile = /^stockpile(\d)$/.exec(id);
        const entry: PublicVolatile = { id, since: ongoing?.since ?? since(), elapsed: 0 };
        if (perish) { id = "perishsong"; Object.assign(entry, { id, layers: Number(perish[1]), since: volatile(mon, id)?.since ?? since() }); }
        else if (stockpile) { id = "stockpile"; Object.assign(entry, { id, layers: Number(stockpile[1]) }); }
        // Supreme Overlord's count of fallen allies (pinned data/abilities.ts supremeoverlord onStart: "-start|X|fallenN|[silent]").
        else if (fallen) { id = "fallen"; Object.assign(entry, { id, layers: Number(fallen[1]) }); }
        else if (id === "encore") entry.moveId = mon.lastMove ?? undefined;
        else if (id === "disable") entry.moveId = toID(parts[4]);
        // R9; Cursed Body disables the attacker as it moves, which counts as not yet moved (data/moves.ts disable onStart).
        if (id === "taunt" || id === "encore" || id === "disable") entry.targetMovedFirst = builder.acted.has(mon.key) && !afterUpkeep && tags.from !== "ability: Cursed Body";
        if (id === "healblock" && move) entry.moveId = move.moveId;   // Psychic Noise blocks for 2 turns (data/moves.ts healblock durationCallback)
        if (id === "leechseed" || id === "yawn" || id === "attract") entry.sourceKey = (tags.of ? activeMon(tags.of)?.key : move?.user) ?? undefined;
        addVolatile(mon, entry);
        break;
      }
      case "-end": {
        const mon = activeMon(parts[2]) ?? monOf(parts[2]);
        if (!mon) break;
        const id = effectId(parts[3]);
        if ((id === "futuresight" || id === "doomdesire") && mon.position !== null) {
          const layers = mon.position + 1;
          sides[mon.side].conditions = sides[mon.side].conditions.filter((each) => !(each.id === id && each.layers === layers));
          break;
        }
        if ("partiallytrapped" in tags) removeVolatile(mon, "partiallytrapped");
        else removeVolatile(mon, /^stockpile/.test(id) ? "stockpile" : id);
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
        if (what.startsWith("ability: ")) { showAbility(mon, id); if (id === "sturdy") censor(mon, "sturdy"); break; }
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
        const id = toID(parts[3]);
        const removed = (tags.from ?? "").startsWith("move: ") || tags.from === "stealeat";
        mon.item = { state: "gone", itemId: id, how: removed ? "removed" : "consumed", stint: mon.switchIns };
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
        if ((tags.from ?? "").startsWith("ability: ")) showAbility(tags.of ? activeMon(tags.of) : mon, effectId(tags.from));
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
        } else if (from.startsWith("move: ") || from.startsWith("ability: ")) {
          mon.ability = { abilityId: id, how: "changed" };
        } else {
          showAbility(mon, id);
          if (id === "sturdy") censor(mon, "sturdy");
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
    const { thisResult: _r, protectedThisTurn: _p, charging: _c, stintMoves: _s, notChoiceShown: _n, stintSpecies: _f, baseShown: _b, ...rest } = mon;
    void _r; void _p; void _c; void _s; void _n; void _f; void _b;
    return structuredClone(rest);
  }

  return {
    push(lines) {
      for (const text of lines) if (text.startsWith("|")) line(text);
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

/** "-singlemove" effects: they last until the user's next move (Destiny Bond, Grudge, Glaive Rush). */
const SINGLE_MOVE: readonly string[] = ["destinybond", "grudge", "glaiverush"];
/** Volatiles Baton Pass does not pass (pinned data: noCopy). */
const NO_COPY: ReadonlySet<string> = new Set(["attract", "choicelock", "commanded", "commanding", "counter", "defensecurl", "destinybond", "disable", "dynamax", "encore", "flashfire", "foresight", "glaiverush", "imprison", "lockon", "minimize", "miracleeye", "mirrorcoat", "nightmare", "protosynthesis", "quarkdrive", "saltcure", "smackdown", "spotlight", "stockpile", "syrupbomb", "torment", "trapped", "trapper", "yawn", "protect", "helpinghand", "followme", "ragepowder", "roost", "endure", "twoturnmove", "mustrecharge"]);
/** Partial-trapping moves (pinned data/moves.ts volatileStatus 'partiallytrapped'): their -activate starts the trap. */
const PARTIAL_TRAPS: ReadonlySet<string> = new Set(["bind", "clamp", "firespin", "infestation", "magmastorm", "sandtomb", "snaptrap", "thundercage", "whirlpool", "wrap"]);

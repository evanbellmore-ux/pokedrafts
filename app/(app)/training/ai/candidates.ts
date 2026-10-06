// SPEC 10.4 candidates and pruning, with addendum A1.4 (status moves are first-class candidates, usage-weighted priors, at least
// one status option kept per slot that has one among its top usage moves) and A1.5 (Mega and non-Mega versions of an action
// are separate candidates; the best of each are kept, 14 joint options on the AI's Mega turns). Options come only from
// AiView.legal (the AI's request, and the player's options in belief world 0); priors are cheap scores from the start rows.
import { turnSpeed } from "@/app/lib/battle/calculate";
import { allyOf, DOUBLES_SLOTS, foesOf, slotSide, type DoublesSideId, type DoublesSlotId } from "@/app/lib/battle/doubles-types";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import { UNSEEN_MEMBER } from "../model/ai-inputs";
import type { AiView, MonKey, MonView } from "../model/ai-view";
import type { MegaPolicy, PlayerPrediction, SlotContext } from "../model/decision";
import type { SpeciesUsageLookup, TrainingUsageData } from "../model/usage";
import { jointActionKey, slotActionKey, type JointAction, type MegaMechanic, type SlotAction } from "../model/view-types";
import { effectiveAccuracy, effectiveWeather } from "./accuracy";
import { isProtectMove, typeEffectiveness } from "./battle-facts";
import { usageMoveWeights, usageSource } from "./belief/usage";
import { classifySlotAction, monInSlot, situationFeatures } from "./classify";
import { favorOf } from "./field-favor";
import type { MegaOutlook } from "./mega";
import { calcBuild, damageRow, KAPPA, SPREAD_TARGETS, threatFrom, threatInto, threatOf, type RowTable } from "./rows";
import { DEFAULT_WEIGHTS, type Weights } from "./value-weights";

export type Candidate = {
  /** jointActionKey(action). */
  id: string;
  action: JointAction;
  prior: number;
  /** Facts per slot, e.g. "Whimsicott: Moonblast into Garchomp (72–85%) · Charizard: Mega Evolution, Heat Wave". */
  label: string;
  /** A1.5: the slot whose move Mega Evolves, else null. */
  mega: DoublesSlotId | null;
  /** A1.5: the id of the same action without its Mega Evolution (its own id when it has none). */
  base: string;
  /** A1.4: it uses a status move other than a protecting one. */
  status: boolean;
};
export type Limits = { aiPerSlot: number; aiJoint: number; aiJointMega: number; playerPerSlot: number; playerJoint: number; playerJointMega: number };
/**
 * SPEC 10.4 limits; A1.5 raises the AI's kept joint options to 14 on turns it can Mega Evolve. The player keeps SPEC's 6 on
 * its own Mega turns too (Mega and non-Mega twins of its best bases): 8 put the tail decisions past SPEC 15's p95
 * (scripts/.cache/training/build/ai2/profile-match.out).
 */
export const LIMITS: Limits = { aiPerSlot: 4, aiJoint: 10, aiJointMega: 14, playerPerSlot: 3, playerJoint: 6, playerJointMega: 6 };
export type CandidateOptions = {
  usage?: TrainingUsageData | null; lookup?: SpeciesUsageLookup;
  /** A1.5: the decision's Mega outlook (ai/mega.ts); without it Mega variants carry only their damage and threat changes. */
  mega?: MegaOutlook;
  weights?: Partial<Weights>;
  limits?: Partial<Limits>;
  /** A1.5: "first-chance" keeps only the SPEC Q2 Mega variants (every move of the rule's slot Mega Evolves). Default per-turn. */
  megaPolicy?: MegaPolicy;
};

/** Status moves A1.4 always counts as a slot's "top usage" status option (setters and redirectors), beside a usage weight ≥ 0.2. */
export const KEY_STATUS_MOVES: ReadonlySet<string> = new Set([
  "tailwind", "trickroom", "followme", "ragepowder", "helpinghand", "spore", "sleeppowder", "hypnosis", "yawn", "willowisp", "thunderwave",
  "glare", "reflect", "lightscreen", "auroraveil", "partingshot", "taunt", "encore", "wideguard", "quickguard", "sunnyday", "raindance",
  "sandstorm", "snowscape", "electricterrain", "grassyterrain", "psychicterrain", "mistyterrain", "allyswitch", "afteryou", "instruct",
]);
const USAGE_STATUS_WEIGHT = 0.2;
/** Foe-targeting moves whose effect is meant for the partner when aimed at it (heal, ability swap, move order, Pollen Puff's heal). */
const ALLY_AIMED: ReadonlySet<string> = new Set(["healpulse", "floralhealing", "pollenpuff", "decorate", "skillswap", "entrainment", "instruct", "afteryou"]);
/** The prior cost of a status move or an attack aimed at the partner (an attack: at least this, else its damage share). */
const ALLY_STATUS_HARM = 0.25;
const SLEEP_MOVES = new Set(["spore", "sleeppowder", "hypnosis", "sing", "grasswhistle", "lovelykiss", "darkvoid"]);
const POWDER_MOVES = new Set(["spore", "sleeppowder", "stunspore", "poisonpowder", "ragepowder", "magicpowder", "cottonspore"]);
const SETUP_MOVES = new Set(["swordsdance", "nastyplot", "calmmind", "bulkup", "dragondance", "quiverdance", "irondefense", "amnesia", "agility",
  "shellsmash", "coil", "workup", "growth", "shiftgear", "victorydance", "noretreat", "clangoroussoul", "bellydrum", "filletaway", "rockpolish",
  "cosmicpower", "acidarmor", "cottonguard", "tidyup", "tailglow", "howl", "stockpile", "dragoncheer", "focusenergy", "coaching"]);
const RECOVERY_MOVES = new Set(["recover", "roost", "slackoff", "softboiled", "milkdrink", "synthesis", "moonlight", "morningsun", "shoreup",
  "strengthsap", "lifedew", "junglehealing", "healorder", "wish", "lunarblessing"]);
const SCREENS: Readonly<Record<string, "reflect" | "lightScreen" | "auroraVeil">> = { reflect: "reflect", lightscreen: "lightScreen", auroraveil: "auroraVeil" };
const WEATHER_MOVES: Readonly<Record<string, "Sun" | "Rain" | "Sand" | "Snow">> = { sunnyday: "Sun", raindance: "Rain", sandstorm: "Sand", snowscape: "Snow" };
const TERRAIN_MOVES: Readonly<Record<string, "Electric" | "Grassy" | "Psychic" | "Misty">> = { electricterrain: "Electric", grassyterrain: "Grassy", psychicterrain: "Psychic", mistyterrain: "Misty" };
/** Damaging moves that lower every hit foe's Speed (PS/data/moves.ts icywind, electroweb, bulldoze, rocktomb secondary spe −1). */
const SPEED_DROP_ATTACKS = new Set(["icywind", "electroweb", "bulldoze", "rocktomb"]);
/** Items that lock the holder into the move it used (isChoice: PS/data/items.ts:979, 1002, 1026; choicelock PS/data/conditions.ts:324-363). */
export const CHOICE_ITEMS: ReadonlySet<string> = new Set(["choiceband", "choicescarf", "choicespecs"]);
/** The prior of a status or protecting move that would lock a Choice item's holder into it for the turns after (× worth). */
const CHOICE_LOCK_PRIOR = 0.3;
/** The prior of a move that fails this turn (fact checks in failsNow). */
const FAILS_PRIOR = -0.15;
/** Self-healing moves that fail at full HP (PS/data/moves.ts: heal 1/2 through this.heal, which fails at full HP). */
const FULL_HP_FAILS = new Set(["recover", "roost", "slackoff", "softboiled", "milkdrink", "synthesis", "moonlight", "morningsun", "shoreup", "healorder"]);
const STATUS_INFLICTING = new Set(["thunderwave", "glare", "stunspore", "nuzzle", "willowisp", "toxic", "poisonpowder", "spore", "sleeppowder", "hypnosis", "sing", "grasswhistle", "lovelykiss", "darkvoid", "yawn"]);

/**
 * Whether a move cannot work this turn as the field and the target stand at the decision (A1.4 candidates; so its usage
 * weight neither raises its prior nor reserves it): Tailwind, a screen, the weather or terrain it sets already up
 * (PS/data/moves.ts sideCondition / sim/field.ts setWeather and setTerrain return false), a self-heal at full HP, a status
 * move into a target already statused or immune, Taunt or Encore into one already under it, Encore before the target moved,
 * Helping Hand without a partner, Fake Out and First Impression after the first turn (PS/data/moves.ts:5098).
 */
function failsNow(view: AiView, mon: MonView, slot: DoublesSlotId, moveId: string, target: MonView | null, runtime: BattleRuntime): boolean {
  const side = slotSide(slot);
  const partner = monInSlot(view, allyOf(slot));
  if ((moveId === "fakeout" || moveId === "firstimpression") && !mon.firstTurn) return true;
  if (moveId === "tailwind") return (side === "own" ? view.clock.sides.own.tailwind : view.clock.sides.opponent.tailwind) > 0;
  if (SCREENS[moveId]) return (side === "own" ? view.field.attackerSide : view.field.defenderSide)[SCREENS[moveId]];
  if (WEATHER_MOVES[moveId]) return view.field.weather === WEATHER_MOVES[moveId];
  if (TERRAIN_MOVES[moveId]) return view.field.terrain === TERRAIN_MOVES[moveId];
  if (FULL_HP_FAILS.has(moveId)) return mon.hp >= mon.maxHp;
  if (moveId === "helpinghand") return !partner || !living(partner);
  const foe = target && target.side !== mon.side ? target : null;
  if (STATUS_INFLICTING.has(moveId)) return !!foe && (!!foe.build.status || !statusLands(foe, moveId, runtime) || (moveId === "yawn" && foe.volatiles.includes("yawn")));
  if (moveId === "taunt") return !!foe && foe.volatiles.includes("taunt");
  if (moveId === "encore") return !!foe && (foe.volatiles.includes("encore") || !foe.lastMove);
  if (moveId === "substitute") return mon.volatiles.includes("substitute") || mon.hp <= mon.maxHp / 4;
  return false;
}

type Hit = { target: MonKey; worth: number; fraction: number; ko: number };
/** One slot action with its prior split into damage (per target, for focus fire) and the rest. */
type SlotOption = {
  key: string; action: SlotAction; prior: number; hits: Hit[]; other: number;
  /** It cannot work this turn (failsNow): never reserved. */
  fails?: boolean;
  damaging: boolean; protect: boolean; switch: boolean; fakeOut: boolean; helpingHand: boolean; status: boolean; topStatus: boolean;
  /** Mega mechanics the legal list allows on this action. */
  megas: MegaMechanic[];
  /** A protecting move: its prior's threat part by foe (0.6 × worth × threat / 3^streak), and the rest (−0.05 / 3^streak). */
  guard?: { byFoe: Map<MonKey, number>; rest: number };
};

const living = (mon: MonView) => !mon.fainted && mon.hp > 0;
const keyOf = (side: DoublesSideId, member: string): MonKey => `${side}:${member}`;
const combine = (hits: readonly Hit[]) => {
  const byTarget = new Map<MonKey, { worth: number; fraction: number; miss: number }>();
  for (const hit of hits) {
    const entry = byTarget.get(hit.target) ?? { worth: hit.worth, fraction: 0, miss: 1 };
    entry.fraction += hit.fraction;
    entry.miss *= 1 - Math.min(1, Math.max(0, hit.ko));
    byTarget.set(hit.target, entry);
  }
  let total = 0;
  for (const entry of byTarget.values()) total += entry.worth * ((1 - KAPPA) * Math.min(1, entry.fraction) + KAPPA * (1 - entry.miss));
  return total;
};

/** A side's Speed advantage now (SPEC 10.6 Speed, one turn, no particles): +1 when every pair favours `side`. */
function speedAdvantage(view: AiView, worth: Record<MonKey, number>, side: DoublesSideId, runtime: BattleRuntime,
  change: { tailwind?: Partial<Record<DoublesSideId, boolean>>; trickRoom?: boolean; spe?: Partial<Record<MonKey, number>>; paralysed?: MonKey | null } = {}): number {
  const mine = view.mons.filter((mon) => mon.side === side && mon.slot !== null && living(mon));
  const theirs = view.mons.filter((mon) => mon.side !== side && mon.slot !== null && living(mon));
  const trickRoom = change.trickRoom ?? view.field.trickRoom;
  const field = { ...view.field, trickRoom: false };
  const tail = (s: DoublesSideId) => change.tailwind?.[s] ?? (s === "own" ? view.field.attackerSide.tailwind : view.field.defenderSide.tailwind);
  const speed = (mon: MonView) => {
    const build = calcBuild(mon);
    const stage = change.spe?.[mon.key];
    const staged = stage !== undefined ? { ...build, boosts: { ...build.boosts, spe: Math.max(-6, Math.min(6, (build.boosts.spe ?? 0) + stage)) } } : build;
    const status = change.paralysed === mon.key && !staged.status ? { ...staged, status: "par" as const } : staged;
    return turnSpeed(status, tail(mon.side), field, runtime);
  };
  let numerator = 0, denominator = 0;
  for (const a of mine) for (const b of theirs) {
    const w = (worth[a.key] ?? 1) * (worth[b.key] ?? 1);
    numerator += w * Math.sign(speed(a) - speed(b)) * (trickRoom ? -1 : 1);
    denominator += w;
  }
  return denominator > 0 ? numerator / denominator : 0;
}

/** The prior builder for one decision (memoised per view). */
function priorContext(view: AiView, rows: RowTable, worth: Record<MonKey, number>, runtime: BattleRuntime, options: CandidateOptions) {
  const weights: Weights = { ...DEFAULT_WEIGHTS, ...options.weights };
  const byKey = new Map(view.mons.map((mon) => [mon.key, mon]));
  const threatCache = new Map<MonKey, number>();
  const threat = (key: MonKey) => {
    let value = threatCache.get(key);
    if (value === undefined) threatCache.set(key, value = threatInto(view, rows, worth, key, runtime));
    return value;
  };
  const usageWeights = new Map<string, Map<string, number>>();
  const usageWeight = (speciesId: string, moveId: string) => {
    let weights = usageWeights.get(speciesId);
    if (!weights) {
      usageWeights.set(speciesId, weights = new Map(usageMoveWeights(usageSource(speciesId, { usage: options.usage ?? null, lookup: options.lookup }, runtime)).map((entry) => [entry.id, entry.weight])));
    }
    return weights.get(moveId) ?? 0;
  };
  const offense = (mon: MonView) => {
    let best = 0;
    for (const foe of view.mons) {
      if (foe.side === mon.side || foe.slot === null || !living(foe)) continue;
      const row = rows.best(mon.key, foe.key);
      if (row) best = Math.max(best, row.fraction * effectiveAccuracy(view, mon.key, row.moveId, foe.key, runtime));
    }
    return best;
  };
  /** The damage hits of a move from `mon` in `slot` aimed at `target` (its rule's targets for spread and random moves). */
  const hitsOf = (mon: MonView, slot: DoublesSlotId, moveId: string, target: DoublesSlotId | null, megaRows?: MegaOutlook[MonKey], intoMega = false): Hit[] => {
    const move = runtime.movesById.get(moveId);
    if (!move || move.category === "Status") return [];
    const foes = foesOf(slot).map((each) => monInSlot(view, each)).filter((each): each is MonView => !!each && living(each));
    const aimed = target ? monInSlot(view, target) : null;
    let targets: { mon: MonView; share: number }[];
    if (SPREAD_TARGETS.has(move.target)) targets = foes.map((each) => ({ mon: each, share: 1 }));
    else if (move.target === "randomNormal") targets = foes.map((each) => ({ mon: each, share: 1 / Math.max(1, foes.length) }));
    else if (aimed && aimed.side !== mon.side) targets = [{ mon: aimed, share: 1 }];
    else if (!target && foes.length === 1) targets = [{ mon: foes[0], share: 1 }];
    else targets = [];
    const hits: Hit[] = targets.map(({ mon: foe, share }) => {
      // intoMega: the foe as its Mega form (its outlook's rows into it), when it can still Mega Evolve.
      const foeMega = intoMega ? options.mega?.[foe.key] : undefined;
      const row = megaRows ? megaRows.out[foe.key]?.[moveId] ?? null : foeMega ? foeMega.into[mon.key]?.[moveId] ?? null : rows.get(mon.key, foe.key, moveId);
      const acc = effectiveAccuracy(view, mon.key, moveId, foe.key, runtime);
      const protect = foe.moves.some(isProtectMove) ? 0.25 / 3 ** foe.protectStreak : 0;
      const scale = share * acc * (1 - protect);
      return { target: foe.key, worth: worth[foe.key] ?? 1, fraction: scale * (row?.fraction ?? 0), ko: scale * (row?.koChance ?? 0) };
    });
    // Earthquake and the other allAdjacent moves hit the partner too.
    const partner = monInSlot(view, allyOf(slot));
    if (move.target === "allAdjacent" && partner && living(partner)) {
      const row = rows.get(mon.key, partner.key, moveId);
      if (row) hits.push({ target: partner.key, worth: -(worth[partner.key] ?? 1), fraction: row.fraction, ko: row.koChance });
    }
    return hits;
  };
  const damagePrior = (hits: readonly Hit[]) => hits.reduce((sum, hit) => sum + hit.worth * ((1 - KAPPA) * Math.min(1, hit.fraction) + KAPPA * hit.ko), 0);
  const bestDamage = (mon: MonView, slot: DoublesSlotId) => {
    let best = 0;
    for (const moveId of mon.moves) {
      const move = runtime.movesById.get(moveId);
      if (!move || move.category === "Status") continue;
      const aims = move.target === "normal" || move.target === "any" || move.target === "adjacentFoe" ? foesOf(slot) : [null];
      for (const aim of aims) best = Math.max(best, damagePrior(hitsOf(mon, slot, moveId, aim)));
    }
    return best;
  };
  /** Speed-term swing of a change for the mover's side (SPEC 10.4: 0.2 + 0.3 × swing). */
  const speedSwing = (side: DoublesSideId, change: Parameters<typeof speedAdvantage>[4]) =>
    speedAdvantage(view, worth, side, runtime, change) - speedAdvantage(view, worth, side, runtime);

  /** SPEC 10.4 slot priors (status moves per A1.4). */
  const optionOf = (slot: DoublesSlotId, action: SlotAction, megas: MegaMechanic[]): SlotOption => {
    const side = slotSide(slot);
    const mon = monInSlot(view, slot);
    const base: SlotOption = {
      key: slotActionKey(action), action, prior: 0, hits: [], other: 0, damaging: false, protect: false, switch: false, fakeOut: false,
      helpingHand: false, status: false, topStatus: false, megas,
    };
    if (action.kind === "pass" || !mon) return base;
    if (action.kind === "switch") {
      const incoming = action.to === UNSEEN_MEMBER ? null : byKey.get(keyOf(side, action.to)) ?? null;
      const now = threat(mon.key);
      const other = incoming ? now - threat(incoming.key) + 0.5 * (offense(incoming) - offense(mon)) : 0.5 * now - 0.05;
      return { ...base, switch: true, other, prior: other };
    }
    const move = runtime.movesById.get(action.moveId);
    if (!move) return base;
    const target = action.target ? monInSlot(view, action.target) : null;
    const foeTarget = target && target.side !== mon.side ? target : null;
    const acc = foeTarget ? effectiveAccuracy(view, mon.key, move.id, foeTarget.key, runtime) : effectiveAccuracy(view, mon.key, move.id, null, runtime);
    const partner = monInSlot(view, allyOf(slot));
    // A foe-targeting move ("normal"/"any", PS/sim/battle.ts validTargetLoc: the adjacent ally is a valid target) aimed at
    // the partner: Parting Shot, Sleep Powder or an attack into it works against the side, so the slot prior counts the
    // harm and pruning keeps it only when nothing else is legal. Moves meant for the partner keep their scores.
    if (target && target.side === mon.side && target.key !== mon.key && (move.target === "normal" || move.target === "any") && !ALLY_AIMED.has(move.id)) {
      const row = rows.get(mon.key, target.key, move.id);
      const harm = (worth[target.key] ?? 1) * (move.category === "Status" ? ALLY_STATUS_HARM : Math.max(ALLY_STATUS_HARM, row?.fraction ?? 0));
      return { ...base, other: -harm, prior: -harm };
    }
    const status = move.category === "Status" && !isProtectMove(move.id);
    if (failsNow(view, mon, slot, move.id, target, runtime)) {
      return { ...base, other: FAILS_PRIOR, prior: FAILS_PRIOR, status, fails: true, protect: isProtectMove(move.id) };
    }
    // A Choice item's holder that uses a status or protecting move stays locked into it (only a switch frees it).
    const locks = move.category === "Status" && CHOICE_ITEMS.has(mon.build.itemId);
    const topStatus = status && !locks && (KEY_STATUS_MOVES.has(move.id) || usageWeight(mon.build.speciesId, move.id) >= USAGE_STATUS_WEIGHT);
    let other = locks ? -CHOICE_LOCK_PRIOR * (worth[mon.key] ?? 1) : 0;
    const hits = hitsOf(mon, slot, move.id, action.target);
    if (move.id === "fakeout" || move.id === "firstimpression") other += mon.firstTurn ? (move.id === "fakeout" && foeTarget ? 0.3 * threatFrom(view, rows, worth, foeTarget.key, runtime) : 0) : -0.1;
    if (SPEED_DROP_ATTACKS.has(move.id)) {
      const drops = Object.fromEntries(foesOf(slot).map((each) => monInSlot(view, each)).filter((each): each is MonView => !!each).map((each) => [each.key, -1]));
      other += 0.3 * speedSwing(side, { spe: drops });
    }
    let guard: SlotOption["guard"];
    if (isProtectMove(move.id)) {
      const success = 1 / 3 ** mon.protectStreak;
      const byFoe = new Map<MonKey, number>();
      for (const foe of view.mons.filter((each) => each.side !== mon.side && each.slot !== null && living(each))) {
        byFoe.set(foe.key, 0.6 * (worth[mon.key] ?? 1) * threatOf(view, rows, foe.key, mon.key, runtime) * success);
      }
      guard = { byFoe, rest: -0.05 * success };
      other += [...byFoe.values()].reduce((sum, value) => sum + value, 0) + guard.rest;
    }
    else if (move.id === "helpinghand") other += partner ? 0.3 * bestDamage(partner, allyOf(slot)) : -0.05;
    else if (move.id === "followme" || move.id === "ragepowder") other += partner ? 0.5 * threat(partner.key) : 0;
    else if (move.id === "tailwind") {
      const up = side === "own" ? view.clock.sides.own.tailwind > 0 : view.clock.sides.opponent.tailwind > 0;
      other += up ? 0.02 : 0.2 + 0.3 * speedSwing(side, { tailwind: { [side]: true } });
    } else if (move.id === "trickroom") other += 0.2 + 0.3 * speedSwing(side, { trickRoom: !view.field.trickRoom });
    else if (move.id === "thunderwave" || move.id === "glare" || move.id === "stunspore" || move.id === "nuzzle") {
      if (foeTarget && !foeTarget.build.status && statusLands(foeTarget, move.id, runtime)) {
        other += acc * (0.2 + 0.3 * speedSwing(side, { paralysed: foeTarget.key }) + weights.paralysis * (worth[foeTarget.key] ?? 1));
      }
    } else if (SLEEP_MOVES.has(move.id) || move.id === "yawn") {
      if (foeTarget && !foeTarget.build.status && statusLands(foeTarget, move.id, runtime)) other += acc * (move.id === "yawn" ? 0.25 : 0.5) * (worth[foeTarget.key] ?? 1);
    } else if (move.id === "willowisp") {
      if (foeTarget && !foeTarget.build.status && statusLands(foeTarget, move.id, runtime)) {
        const physical = foeTarget.moves.some((id) => runtime.movesById.get(id)?.category === "Physical");
        other += acc * (physical ? 0.4 : 0.1) * (worth[foeTarget.key] ?? 1);
      }
    } else if (move.id === "taunt") {
      if (foeTarget && foeTarget.moves.some((id) => runtime.movesById.get(id)?.category === "Status" && !isProtectMove(id))) other += acc * 0.25 * (worth[foeTarget.key] ?? 1);
    } else if (move.id === "encore") {
      const last = foeTarget?.lastMove ? runtime.movesById.get(foeTarget.lastMove) : null;
      if (foeTarget && last) other += acc * (last.category === "Status" ? 0.3 : 0.05) * (worth[foeTarget.key] ?? 1);
    } else if (SCREENS[move.id]) {
      const sideFlags = side === "own" ? view.field.attackerSide : view.field.defenderSide;
      const up = sideFlags[SCREENS[move.id]];
      const snow = effectiveWeather(view) === "Snow" || effectiveWeather(view) === "Hail";
      if (!up && (move.id !== "auroraveil" || snow)) {
        const own = view.mons.filter((each) => each.side === side && each.slot !== null && living(each));
        other += 0.15 + 0.2 * own.reduce((sum, each) => sum + threat(each.key), 0);
      }
    } else if (WEATHER_MOVES[move.id] || TERRAIN_MOVES[move.id]) {
      const setting = WEATHER_MOVES[move.id] ? { weather: WEATHER_MOVES[move.id] } : { terrain: TERRAIN_MOVES[move.id] };
      const sign = (each: MonView) => each.side === side ? 1 : -1;
      const swing = view.mons.filter((each) => each.slot !== null && living(each)).reduce((sum, each) => sum + sign(each) * (worth[each.key] ?? 1) * favorOf(each.moves, each.build, setting, runtime), 0);
      other += 0.1 + 0.15 * swing;
    } else if (move.id === "partingshot") other += 0.3 * threat(mon.key) + 0.15;
    else if (move.id === "wideguard" || move.id === "quickguard") {
      const own = view.mons.filter((each) => each.side === side && each.slot !== null && living(each));
      const foes = view.mons.filter((each) => each.side !== side && each.slot !== null && living(each));
      const blocked = (moveId: string) => {
        const each = runtime.movesById.get(moveId);
        return !!each && each.category !== "Status" && (move.id === "wideguard" ? SPREAD_TARGETS.has(each.target) : each.priority > 0);
      };
      let incoming = 0;
      for (const foe of foes) for (const id of foe.moves.filter(blocked)) for (const ally of own) incoming += (worth[ally.key] ?? 1) * (rows.get(foe.key, ally.key, id)?.fraction ?? 0);
      other += 0.5 * incoming;
    } else if (SETUP_MOVES.has(move.id)) other += 0.12 + 0.2 * (1 - Math.min(1, threat(mon.key) / Math.max(0.01, worth[mon.key] ?? 1)));
    else if (RECOVERY_MOVES.has(move.id)) other += 0.5 * (worth[mon.key] ?? 1) * (1 - mon.hp / Math.max(1, mon.maxHp));
    else if (status) other += 0.1;
    // A1.4: a status move's prior also counts how often the species uses it.
    if (status && !locks) other += 0.3 * usageWeight(mon.build.speciesId, move.id);
    const damaging = move.category !== "Status";
    return {
      ...base, hits, other, prior: damagePrior(hits) + other, damaging, protect: isProtectMove(move.id), fakeOut: move.id === "fakeout" && mon.firstTurn,
      helpingHand: move.id === "helpinghand", status, topStatus, ...(guard ? { guard } : {}),
    };
  };

  /** A1.5 Mega variant: this turn's damage with the Mega form's rows, the threat change into it, and lasting − keep. */
  const megaDelta = (slot: DoublesSlotId, option: SlotOption): number => {
    const mon = monInSlot(view, slot);
    if (!mon || option.action.kind !== "move") return 0;
    const entry = options.mega?.[mon.key];
    if (!entry) return 0;
    const offense = damagePrior(hitsOf(mon, slot, option.action.moveId, option.action.target, entry)) - damagePrior(option.hits);
    const foes = view.mons.filter((each) => each.side !== mon.side && each.slot !== null && living(each));
    let threatMega = 0;
    for (const foe of foes) {
      let best = 0;
      for (const moveId of foe.moves) {
        const row = entry.into[foe.key]?.[moveId];
        if (row) best = Math.max(best, effectiveAccuracy(view, foe.key, moveId, mon.key, runtime) * ((1 - KAPPA) * row.fraction + KAPPA * row.koChance));
      }
      threatMega += best;
    }
    const defense = 0.6 * (threat(mon.key) - (worth[mon.key] ?? 1) * threatMega);
    const keep = weights.megaAvailable + weights.megaOption * Math.max(0, ...Object.values(options.mega ?? {}).filter((each) => each.side === mon.side).map((each) => each.gain));
    const lasting = weights.megaLasting * entry.gain - weights.megaReveal;
    return offense + defense + lasting - keep;
  };
  /**
   * A1.5: the option's prior when the other side's Mega-capable actives are in their Mega forms (their outlook's rows into
   * them); null when the option reaches no such foe. Pruning keeps the best reply to a Mega, so the matrix weighs a Mega
   * against the moves that punish it (a Mega Gyarados taking Close Combat ×2).
   */
  const replyToMega = (slot: DoublesSlotId, option: SlotOption): number | null => {
    const mon = monInSlot(view, slot);
    if (!mon || option.action.kind !== "move" || !option.damaging) return null;
    const hits = hitsOf(mon, slot, option.action.moveId, option.action.target, undefined, true);
    if (!hits.some((hit) => options.mega?.[hit.target] && hit.worth > 0)) return null;
    return damagePrior(hits) + option.other;
  };
  return { weights, optionOf, megaDelta, replyToMega, threat, bestDamage };
}
/** The other side's actives that can still Mega Evolve (their outlook entries; PS/sim/side.ts:779-781 once per side). */
function megaFoes(view: AiView, side: DoublesSideId, mega: MegaOutlook | undefined): MonView[] {
  const foe: DoublesSideId = side === "own" ? "opponent" : "own";
  if (!mega || view.megaUsed[foe]) return [];
  return view.mons.filter((mon) => mon.side === foe && mon.slot !== null && living(mon) && mon.canMega && !!mega[mon.key]);
}
/**
 * A1.5: the best reply to the other side's Mega: per slot the option with the highest replyToMega prior (reserved in
 * pruning), and the joint of those replies (or a reply with the partner's best option) reserved in selection.
 */
function megaReplies(view: AiView, side: DoublesSideId, all: Map<DoublesSlotId, SlotOption[]>, ctx: ReturnType<typeof priorContext>, mega: MegaOutlook | undefined): Map<DoublesSlotId, string> {
  const out = new Map<DoublesSlotId, string>();
  if (!megaFoes(view, side, mega).length) return out;
  for (const [slot, list] of all) {
    let best: SlotOption | null = null, top = -Infinity;
    for (const option of list) {
      const value = ctx.replyToMega(slot, option);
      if (value !== null && value > top) { best = option; top = value; }
    }
    if (best) out.set(slot, best.key);
  }
  return out;
}
/** The reply joint's id among `bases`: the highest Σ max(prior, replyToMega) over slots, with at least one reply in it. */
function megaReplyJoint(bases: BaseJoint[], slots: readonly DoublesSlotId[], replies: Map<DoublesSlotId, string>, ctx: ReturnType<typeof priorContext>): string | null {
  if (!replies.size) return null;
  let best: BaseJoint | null = null, top = -Infinity;
  for (const base of bases) {
    if (!base.options.some((option, i) => replies.get(slots[i]) === option.key)) continue;
    const score = base.options.reduce((sum, option, i) => sum + Math.max(option.prior, ctx.replyToMega(slots[i], option) ?? -Infinity), 0);
    if (score > top) { best = base; top = score; }
  }
  return best ? jointActionKey(best.action) : null;
}

/** Status immunities a prior can see (PS/data/conditions.ts and the moves' own checks): types, powders, Electric Terrain sleep. */
function statusLands(target: MonView, moveId: string, runtime: BattleRuntime): boolean {
  const types = runtime.speciesById.get(target.build.speciesId)?.types ?? [];
  if (POWDER_MOVES.has(moveId) && (types.includes("Grass") || target.build.abilityId === "overcoat" || target.build.itemId === "safetygoggles")) return false;
  if ((moveId === "thunderwave" || moveId === "stunspore" || moveId === "nuzzle") && types.includes("Electric")) return false;
  if (moveId === "thunderwave" && typeEffectiveness("Electric", types) === 0) return false;
  if (moveId === "willowisp" && types.includes("Fire")) return false;
  if (target.build.abilityId === "goodasgold" || target.build.abilityId === "magicbounce") return false;
  return true;
}

type Variant = { action: JointAction; prior: number; mega: DoublesSlotId | null };
type BaseJoint = { action: JointAction; options: SlotOption[]; prior: number; variants: Variant[] };

/** Every legal slot action per slot of `side` (Mega variants folded into their base action). */
function slotOptions(view: AiView, side: DoublesSideId) {
  const legal = side === "opponent" ? view.legal.opponent : view.legal.own;
  const slots = DOUBLES_SLOTS.filter((slot) => slotSide(slot) === side);
  const bySlot = new Map<DoublesSlotId, Map<string, { action: SlotAction; megas: Set<MegaMechanic> }>>();
  for (const joint of legal) {
    for (const slot of slots) {
      const action = joint[slot];
      if (!action) continue;
      const base = action.kind === "move" && action.mega ? { kind: "move" as const, moveId: action.moveId, target: action.target } : action;
      const key = slotActionKey(base);
      let map = bySlot.get(slot);
      if (!map) bySlot.set(slot, map = new Map());
      const entry = map.get(key) ?? { action: base, megas: new Set<MegaMechanic>() };
      if (action.kind === "move" && action.mega) entry.megas.add(action.mega);
      map.set(key, entry);
    }
  }
  return { legalKeys: new Set(legal.map(jointActionKey)), bySlot, slots: slots.filter((slot) => bySlot.has(slot)) };
}

/**
 * Per-slot pruning: the heaviest `limit`, with reservations first: the best damaging option; Fake Out when legal (AI);
 * the best "top usage" status option (A1.4); and `extra` (the player's Protect and habit option). Protect only at ≥ 50% of
 * the slot's best prior (unless reserved); at most two switches.
 */
function pruneSlot(options: SlotOption[], limit: number, reserve: { fakeOut: boolean; protect: boolean; extra: string[] }): SlotOption[] {
  const sorted = [...options].sort((a, b) => b.prior - a.prior || (a.key < b.key ? -1 : 1));
  const best = sorted[0]?.prior ?? 0;
  const kept: SlotOption[] = [];
  const add = (option: SlotOption | undefined) => { if (option && !kept.includes(option)) kept.push(option); };
  add(sorted.find((option) => option.damaging && !option.fails));
  if (reserve.fakeOut) add(sorted.find((option) => option.fakeOut));
  add(sorted.find((option) => option.topStatus));
  if (reserve.protect) add(sorted.find((option) => option.protect && !option.fails));
  for (const key of reserve.extra) add(sorted.find((option) => option.key === key));
  const reserved = kept.length;
  for (const option of sorted) {
    if (kept.length >= Math.max(limit, reserved)) break;
    if (kept.includes(option)) continue;
    if (option.protect && option.prior < 0.5 * best) continue;
    if (option.switch && kept.filter((each) => each.switch).length >= 2) continue;
    kept.push(option);
  }
  if (!kept.length && sorted.length) kept.push(sorted[0]);
  return kept;
}

/** Joint options: the product of the slot lists, legal ones only, with focus fire and Helping Hand synergy (SPEC 10.4). */
function joints(kept: Map<DoublesSlotId, SlotOption[]>, legalKeys: Set<string>, ctx: ReturnType<typeof priorContext>): BaseJoint[] {
  const slots = [...kept.keys()];
  const lists = slots.map((slot) => kept.get(slot)!);
  const out: BaseJoint[] = [];
  const walk = (index: number, chosen: SlotOption[]) => {
    if (index === slots.length) {
      const action: JointAction = Object.fromEntries(slots.map((slot, i) => [slot, chosen[i].action]));
      if (!legalKeys.has(jointActionKey(action))) return;
      let prior = combine(chosen.flatMap((option) => option.hits)) + chosen.reduce((sum, option) => sum + option.other, 0);
      // Helping Hand: half its partner's actual damage prior instead of 0.3 × its best; nothing without a partner attack.
      chosen.forEach((option, i) => {
        if (!option.helpingHand) return;
        const partner = chosen[1 - i];
        prior -= option.other;
        prior += partner?.damaging ? 0.5 * combine(partner.hits) : -0.05;
      });
      // Both protect: each foe's attack lands on one of them, so its threat counts once (the larger), as focus fire does.
      const guards = chosen.filter((option) => option.guard);
      if (guards.length > 1) {
        const foes = new Set(guards.flatMap((option) => [...option.guard!.byFoe.keys()]));
        for (const option of guards) prior -= [...option.guard!.byFoe.values()].reduce((sum, value) => sum + value, 0);
        for (const foe of foes) prior += Math.max(...guards.map((option) => option.guard!.byFoe.get(foe) ?? 0));
      }
      const variants: Variant[] = [{ action, prior, mega: null }];
      chosen.forEach((option, i) => {
        for (const mechanic of option.megas) {
          const slot = slots[i];
          const megaAction: JointAction = { ...action, [slot]: { ...(option.action as Extract<SlotAction, { kind: "move" }>), mega: mechanic } };
          if (!legalKeys.has(jointActionKey(megaAction))) continue;
          variants.push({ action: megaAction, prior: prior + ctx.megaDelta(slot, option), mega: slot });
        }
      });
      out.push({ action, options: chosen, prior, variants });
      return;
    }
    for (const option of lists[index]) walk(index + 1, [...chosen, option]);
  };
  walk(0, []);
  return out;
}

/** The SPEC Q2 slot (first-chance policy): the Mega form with the higher base stat total, then Showdown position 0. */
function firstChanceSlot(view: AiView, side: DoublesSideId, megaSlots: DoublesSlotId[], runtime: BattleRuntime, mega?: MegaOutlook): DoublesSlotId | null {
  if (!megaSlots.length) return null;
  const total = (slot: DoublesSlotId) => {
    const mon = monInSlot(view, slot);
    const form = mon ? mega?.[mon.key]?.formId : undefined;
    const stats = form ? runtime.speciesById.get(form)?.baseStats : null;
    return stats ? stats.hp + stats.atk + stats.def + stats.spa + stats.spd + stats.spe : 0;
  };
  // Showdown position 0 is opponent-right for the AI's side and own-left for the player's (model/positions.ts).
  const position0: DoublesSlotId = side === "opponent" ? "opponent-right" : "own-left";
  return [...megaSlots].sort((a, b) => total(b) - total(a) || (a === position0 ? -1 : b === position0 ? 1 : 0))[0];
}

function variantCandidate(view: AiView, variant: Variant, base: BaseJoint, runtime: BattleRuntime): Candidate {
  const id = jointActionKey(variant.action);
  return {
    id, action: variant.action, prior: variant.prior, label: jointLabel(view, variant.action, runtime), mega: variant.mega,
    base: jointActionKey(base.action), status: base.options.some((option) => option.status),
  };
}

/**
 * Selection: non-Mega turns keep the `limit` heaviest joints; Mega turns keep base joints in order of their best variant,
 * each with its non-Mega version and its best Mega version, up to `megaLimit`. Reservations come first: the best joint with
 * Protect, with a switch (when its prior is positive), with each slot's kept "top usage" status option, and `extra` ids.
 */
function selectJoints(view: AiView, bases: BaseJoint[], limit: number, megaLimit: number, runtime: BattleRuntime, extra: string[] = []): Candidate[] {
  const megaTurn = bases.some((base) => base.variants.length > 1);
  const score = (base: BaseJoint) => Math.max(...base.variants.map((variant) => variant.prior));
  const sorted = [...bases].sort((a, b) => score(b) - score(a) || (jointActionKey(a.action) < jointActionKey(b.action) ? -1 : 1));
  const chosen: BaseJoint[] = [];
  const add = (base: BaseJoint | undefined) => { if (base && !chosen.includes(base)) chosen.push(base); };
  add(sorted[0]);
  add(sorted.find((base) => base.options.some((option) => option.protect)));
  add(sorted.find((base) => base.options.some((option) => option.switch) && base.options.find((option) => option.switch)!.prior > 0));
  const statusKeys = new Set(bases.flatMap((base) => base.options.filter((option) => option.topStatus).map((option) => option.key)));
  for (const key of statusKeys) add(sorted.find((base) => base.options.some((option) => option.key === key)));
  for (const id of extra) add(sorted.find((base) => base.variants.some((variant) => jointActionKey(variant.action) === id)));
  const size = (list: BaseJoint[]) => megaTurn ? list.reduce((sum, base) => sum + Math.min(2, base.variants.length), 0) : list.length;
  const cap = megaTurn ? megaLimit : limit;
  for (const base of sorted) {
    if (size(chosen) >= cap) break;
    if (!chosen.includes(base) && size([...chosen, base]) <= cap) chosen.push(base);
  }
  const out: Candidate[] = [];
  for (const base of chosen) {
    const plain = base.variants[0];
    const megas = base.variants.slice(1).sort((a, b) => b.prior - a.prior);
    out.push(variantCandidate(view, plain, base, runtime));
    if (megas.length) out.push(variantCandidate(view, megas[0], base, runtime));
  }
  // Reserved extras (habit picks) may name a second Mega variant; keep them too.
  for (const id of extra) {
    if (out.some((candidate) => candidate.id === id)) continue;
    const base = bases.find((each) => each.variants.some((variant) => jointActionKey(variant.action) === id));
    const variant = base?.variants.find((each) => jointActionKey(each.action) === id);
    if (base && variant) out.push(variantCandidate(view, variant, base, runtime));
  }
  return out.sort((a, b) => b.prior - a.prior || (a.id < b.id ? -1 : 1));
}

/** The kept slot lists of one side. */
function keptSlots(view: AiView, side: DoublesSideId, ctx: ReturnType<typeof priorContext>, limit: number,
  reserve: (slot: DoublesSlotId, options: SlotOption[]) => { fakeOut: boolean; protect: boolean; extra: string[] }, mega?: MegaOutlook) {
  const { legalKeys, bySlot, slots } = slotOptions(view, side);
  const kept = new Map<DoublesSlotId, SlotOption[]>();
  const all = new Map<DoublesSlotId, SlotOption[]>();
  for (const slot of slots) all.set(slot, [...bySlot.get(slot)!.values()].map(({ action, megas }) => ctx.optionOf(slot, action, [...megas].sort())));
  const replies = megaReplies(view, side, all, ctx, mega);
  for (const slot of slots) {
    const reserved = reserve(slot, all.get(slot)!);
    const reply = replies.get(slot);
    kept.set(slot, pruneSlot(all.get(slot)!, limit, { ...reserved, extra: [...reserved.extra, ...(reply ? [reply] : [])] }));
  }
  return { kept, all, legalKeys, replies, slots: [...kept.keys()] };
}

/** SPEC 10.4 + A1.4/A1.5: the AI's joint candidates (10, or 14 on its Mega turns), heaviest first. */
export function aiCandidates(view: AiView, rows: RowTable, worth: Record<MonKey, number>, runtime: BattleRuntime, options: CandidateOptions = {}): Candidate[] {
  const limits = { ...LIMITS, ...options.limits };
  const policy = options.megaPolicy ?? "per-turn";
  const ctx = priorContext(view, rows, worth, runtime, options);
  const { kept, legalKeys, replies, slots } = keptSlots(view, "opponent", ctx, limits.aiPerSlot, () => ({ fakeOut: true, protect: false, extra: [] }), options.mega);
  let bases = joints(kept, legalKeys, ctx);
  // A1.5: the best reply to the player's Mega is kept beside the AI's own options.
  const reply = megaReplyJoint(bases, slots, replies, ctx);
  const extra = reply ? [reply] : [];
  if (policy === "first-chance") {
    const megaSlots = [...new Set(bases.flatMap((base) => base.variants.map((variant) => variant.mega).filter((slot): slot is DoublesSlotId => !!slot)))];
    const ruleSlot = firstChanceSlot(view, "opponent", megaSlots, runtime, options.mega);
    bases = bases.map((base) => {
      const forced = base.variants.find((variant) => variant.mega === ruleSlot);
      return { ...base, variants: forced ? [forced] : [base.variants[0]] };
    });
    return selectJoints(view, bases, limits.aiJoint, limits.aiJoint, runtime, extra.filter((id) => bases.some((base) => base.variants.some((variant) => jointActionKey(variant.action) === id))));
  }
  return selectJoints(view, bases, limits.aiJoint, limits.aiJointMega, runtime, extra);
}

/** Habit score of a joint: the habit model's joint probability, or the product of its per-slot ones (`${slot}=${slotActionKey}`). */
function habitScore(habit: PlayerPrediction | null, action: JointAction): number {
  if (!habit) return 0;
  const joint = habit.probabilities[jointActionKey(action)];
  if (joint !== undefined) return joint;
  let product = 1, any = false;
  for (const slot of DOUBLES_SLOTS) {
    const each = action[slot];
    if (!each) continue;
    const p = habit.probabilities[jointActionKey({ [slot]: each })];
    if (p !== undefined) any = true;
    product *= p ?? 1e-3;
  }
  return any ? product : 0;
}

/**
 * SPEC 10.4 + A1.4/A1.5: the player's joint options the AI keeps (6 = the top 4 by prior + the top 2 by habit; on turns the
 * AI believes the player can Mega Evolve, the top base joints with their Mega and non-Mega versions + the top 2 by habit, 8),
 * and the SlotContext of every slot action the AI believes legal.
 */
export function playerCandidates(view: AiView, rows: RowTable, worth: Record<MonKey, number>, habit: PlayerPrediction | null, runtime: BattleRuntime,
  options: CandidateOptions = {}): { kept: Candidate[]; slots: Partial<Record<DoublesSlotId, SlotContext>> } {
  const limits = { ...LIMITS, ...options.limits };
  const ctx = priorContext(view, rows, worth, runtime, options);
  const habitTop = (slot: DoublesSlotId, list: SlotOption[]) => {
    if (!habit) return [];
    const scored = list.map((option) => ({ option, p: habit.probabilities[jointActionKey({ [slot]: option.action })] ?? -1 })).filter((entry) => entry.p >= 0);
    return scored.length ? [scored.sort((a, b) => b.p - a.p)[0].option.key] : [];
  };
  const { bySlot } = slotOptions(view, "own");
  // Fake Out is reserved for the player too: on a first turn it is the commonest Doubles action (A1.4 status-like support).
  const { kept, all, legalKeys, replies, slots: sideSlots } = keptSlots(view, "own", ctx, limits.playerPerSlot,
    (slot, list) => ({ fakeOut: true, protect: true, extra: habitTop(slot, list) }), options.mega);
  const bases = joints(kept, legalKeys, ctx);
  // A1.5: the best reply to the AI's Mega form (a Mega Gyarados taking Close Combat ×2) takes the first reserved place.
  const reply = megaReplyJoint(bases, sideSlots, replies, ctx);
  const megaTurn = bases.some((base) => base.variants.length > 1);
  const byHabit = bases.flatMap((base) => base.variants).map((variant) => ({ id: jointActionKey(variant.action), score: habitScore(habit, variant.action) }))
    .filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
  const priorCount = megaTurn ? limits.playerJointMega - 2 : limits.playerJoint - 2;
  const primary = selectJoints(view, bases, Math.max(1, priorCount), Math.max(2, priorCount), runtime);
  const extra = [...new Set([...(reply ? [reply] : []), ...byHabit.map((entry) => entry.id)])].filter((id) => !primary.some((candidate) => candidate.id === id)).slice(0, 2);
  const lookup = new Map(bases.flatMap((base) => base.variants.map((variant) => [jointActionKey(variant.action), { base, variant }] as const)));
  const keptJoints = [...primary, ...extra.map((id) => variantCandidate(view, lookup.get(id)!.variant, lookup.get(id)!.base, runtime))];
  // Habit places the habits do not fill go to the next heaviest by prior.
  const size = megaTurn ? limits.playerJointMega : limits.playerJoint;
  for (const candidate of selectJoints(view, bases, limits.playerJoint, limits.playerJointMega, runtime)) {
    if (keptJoints.length >= size) break;
    if (!keptJoints.some((each) => each.id === candidate.id)) keptJoints.push(candidate);
  }
  const slotContexts: Partial<Record<DoublesSlotId, SlotContext>> = {};
  for (const slot of sideSlots) {
    const mon = monInSlot(view, slot);
    if (!mon) continue;
    const list = all.get(slot)!;
    const legalActions = [...bySlot.get(slot)!.values()].flatMap(({ action, megas }) => [action, ...[...megas].map((mega) => ({ ...(action as Extract<SlotAction, { kind: "move" }>), mega }))]);
    const score = (s: DoublesSlotId, action: Extract<SlotAction, { kind: "move" }>) => list.find((option) => option.key === slotActionKey(withoutMegaSlot(action)))?.prior ?? 0;
    const classes: SlotContext["classes"] = {};
    for (const action of legalActions) classes[slotActionKey(action)] = classifySlotAction(view, rows, slot, action, runtime, { worth, score, legal: list.map((option) => option.action) });
    slotContexts[slot] = { speciesId: mon.build.speciesId, features: situationFeatures(view, rows, slot), classes, canMega: mon.canMega && !view.megaUsed.own };
  }
  return { kept: keptJoints.sort((a, b) => b.prior - a.prior || (a.id < b.id ? -1 : 1)), slots: slotContexts };
}
const withoutMegaSlot = (action: Extract<SlotAction, { kind: "move" }>): SlotAction => ({ kind: "move", moveId: action.moveId, target: action.target });

// ---------- Labels (facts) ----------
function slotLabel(view: AiView, slot: DoublesSlotId, action: SlotAction, runtime: BattleRuntime): string {
  const mon = monInSlot(view, slot);
  const name = mon ? runtime.speciesById.get(mon.build.speciesId)?.name ?? mon.memberKey : slot;
  if (action.kind === "pass") return `${name}: no action`;
  if (action.kind === "switch") {
    const side = slotSide(slot);
    const incoming = action.to === UNSEEN_MEMBER ? null : view.mons.find((each) => each.key === keyOf(side, action.to));
    return `${name}: switch to ${incoming ? runtime.speciesById.get(incoming.build.speciesId)?.name ?? action.to : "an unseen Pokémon"}`;
  }
  const move = runtime.movesById.get(action.moveId);
  const moveName = move?.name ?? action.moveId;
  const mega = action.mega ? "Mega Evolution, " : "";
  const target = action.target ? monInSlot(view, action.target) : null;
  const range = (foe: MonView) => {
    const row = mon ? rowFor(view, mon, foe, action.moveId, runtime) : null;
    return row ? ` (${Math.round(100 * row.min / Math.max(1, foe.maxHp))}–${Math.round(100 * row.max / Math.max(1, foe.maxHp))}%)` : "";
  };
  if (target && mon && target.side !== mon.side) return `${name}: ${mega}${moveName} into ${runtime.speciesById.get(target.build.speciesId)?.name ?? target.memberKey}${range(target)}`;
  if (target) return `${name}: ${mega}${moveName} on ${runtime.speciesById.get(target.build.speciesId)?.name ?? target.memberKey}`;
  return `${name}: ${mega}${moveName}`;
}
const rowCache = new WeakMap<AiView, Map<string, { min: number; max: number } | null>>();
/** A move's damage range for a label (rows.ts damageRow), cached per view. */
function rowFor(view: AiView, mon: MonView, foe: MonView, moveId: string, runtime: BattleRuntime) {
  let cache = rowCache.get(view);
  if (!cache) rowCache.set(view, cache = new Map());
  const key = `${mon.key}>${foe.key}>${moveId}`;
  if (!cache.has(key)) cache.set(key, damageRow(view, mon, foe, moveId, runtime));
  return cache.get(key)!;
}

export function jointLabel(view: AiView, action: JointAction, runtime: BattleRuntime): string {
  return DOUBLES_SLOTS.filter((slot) => action[slot]).map((slot) => slotLabel(view, slot, action[slot]!, runtime)).join(" · ");
}

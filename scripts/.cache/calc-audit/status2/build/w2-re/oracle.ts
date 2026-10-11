// R-E's own Showdown comparison (status2 wave 2): a probe spec run on pinned Showdown c23d2e94 (the runnable copy
// scripts/.cache/calc-audit/showdown; guards-sim.ts's exact enumeration with every damage roll, mid-turn switch requests
// answered with the spec's replacement, else the first bench Pokémon in team order) and on the app (calculateDoublesTurn,
// calculateDoublesOutcomes), each Pokémon compared by name: after the moves (min, max, mean, KO chance) and after the turn
// (the whole distribution).
// Run: npx --no-install tsx scripts/.cache/calc-audit/status2/build/w2-re/run-probes.ts [ids...]
import * as sim from "../../../showdown/sim/index.ts";
import { State } from "../../../showdown/sim/state.ts";
import { calculateDoublesOutcomes, calculateDoublesTurn } from "@/app/lib/battle/doubles-turn";
import { SHOWDOWN_POSITION, slotSide, type DoublesHazards, type DoublesSlotId, type DoublesTurnInput } from "@/app/lib/battle/doubles-types";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import { bench as benchOf, input as inputOf, show, type Mon } from "./kit";

const { Battle } = sim as any;
export type Game = "sv" | "swsh" | "usum" | "champions";
const FORMAT: Record<Game, string> = { sv: "gen9doublescustomgame", swsh: "gen8doublescustomgame", usum: "gen7doublescustomgame", champions: "gen9championsdoublescustomgame" };
const RUNTIME: Record<Game, string> = { sv: "scarlet_violet", swsh: "sword_shield", usum: "ultra_sun_ultra_moon", champions: "champions" };
const toID = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "");
const SLOTS: DoublesSlotId[] = ["own-left", "own-right", "opponent-left", "opponent-right"];

export type SMon = {
  name: string; species: string; ability: string; item?: string; move?: string | null; target?: DoublesSlotId | null; moves?: string[];
  evs?: Partial<Record<"hp" | "atk" | "def" | "spa" | "spd" | "spe", number>>; nature?: string; level?: number; hp?: number; status?: string; boosts?: Partial<Record<string, number>>;
  gender?: "M" | "F" | "";
};
export type Spec = {
  id: string; game: Game; slots: Record<DoublesSlotId, SMon>; bench?: { own?: SMon[]; opponent?: SMon[] }; replacement?: Partial<Record<DoublesSlotId, string>>;
  hazards?: { own?: DoublesHazards; opponent?: DoublesHazards }; field?: { weather?: string; terrain?: string; trickRoom?: boolean };
  /** What the comparison does not look at (a Pokémon by name). */
  skip?: string[];
  /** Leech Seed from earlier turns: the seeded Pokémon's slot and the seeder's (its sourceSlot). */
  seeds?: { target: DoublesSlotId; source: DoublesSlotId }[];
  /** A Substitute from earlier turns with its HP. */
  substitutes?: { slot: DoublesSlotId; hp: number }[];
  /** A Wish from the last turn landing at this end of turn on a position, made by the Pokémon of `source` (its HP: half its maximum). */
  wishes?: { slot: DoublesSlotId; source: DoublesSlotId }[];
};

// ---------------- Showdown ----------------

const ZERO = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const IV31 = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
/** A set's moves: an active Pokémon's action first (No move is Splash); a bench Pokémon's own list (Splash when none). */
const movesOf = (m: SMon, bench = false) => [...new Set(m.move ? [m.move, ...(m.moves ?? [])] : bench && m.moves?.length ? m.moves : ["Splash", ...(m.moves ?? [])])];
const setOf = (m: SMon, bench = false) => ({
  name: m.name, species: m.species, gender: m.gender ?? "", item: m.item ?? "", ability: m.ability, moves: movesOf(m, bench), nature: m.nature ?? "Serious",
  evs: { ...ZERO, ...m.evs }, ivs: IV31, level: m.level ?? 50, happiness: 255,
});
/** Showdown's team order: p1 = own-left, own-right, then the bench; p2 = opponent-right (p2a), opponent-left (p2b), then the bench. */
const team = (spec: Spec, side: "own" | "opponent") => side === "own" ? [spec.slots["own-left"], spec.slots["own-right"], ...(spec.bench?.own ?? [])] : [spec.slots["opponent-right"], spec.slots["opponent-left"], ...(spec.bench?.opponent ?? [])];
/** The Showdown choice of a slot's action: "move 1" (+ its target location). */
function choiceOf(spec: Spec, slot: DoublesSlotId): string {
  const m = spec.slots[slot];
  const target = m.target;
  if (!target) return "move 1";
  const at = SHOWDOWN_POSITION[target];
  const loc = slotSide(target) === slotSide(slot) ? -(at.position + 1) : at.position + 1;
  return `move 1 ${loc}`;
}

class Chooser {
  trail: number[] = []; sizes: number[] = []; weight = 1;
  constructor(readonly prefix: number[]) {}
  pick(weights: number[]): number {
    if (weights.length === 1) return 0;
    const depth = this.trail.length;
    const i = depth < this.prefix.length ? this.prefix[depth] : 0;
    this.trail.push(i); this.sizes.push(weights.length); this.weight *= weights[i];
    return i;
  }
  next(): number[] | null {
    for (let j = this.trail.length - 1; j >= 0; j--) if (this.trail[j] + 1 < this.sizes[j]) return [...this.trail.slice(0, j), this.trail[j] + 1];
    return null;
  }
}
const factorial = (k: number) => { let f = 1; for (let i = 2; i <= k; i++) f *= i; return f; };
function permute(list: unknown[], start: number, end: number, idx: number) {
  const pool = list.slice(start, end), out: unknown[] = [];
  for (let k = pool.length; k > 0; k--) { const f = factorial(k - 1); const j = Math.floor(idx / f); idx %= f; out.push(pool.splice(j, 1)[0]); }
  list.splice(start, end - start, ...out);
}
const inStack = (...names: string[]) => { const s = new Error().stack ?? ""; return names.some((n) => s.includes(n)); };
const CHANCES = new Set(["par", "quickclaw", "quickdraw", "frz", "attract", "shedskin", "healer", "harvest", "allyswitch", "stall", "focusband"]);

function install(b: any, ch: Chooser) {
  b.randomizer = function (base: number) {
    const outs = Array.from({ length: 16 }, (_, i) => this.trunc(this.trunc(base * (85 + i)) / 100));
    const values = [...new Set(outs)];
    return values[ch.pick(values.map((v) => outs.filter((o) => o === v).length / 16))];
  };
  b.random = function (m?: number, n?: number) {
    if (m === undefined) throw new Error("random() without a range");
    if (m === 100 && n === undefined) return 99;
    const [lo, hi] = n === undefined ? [0, m] : [m, n];
    if (hi - lo <= 1) return lo;
    return lo + ch.pick(Array(hi - lo).fill(1 / (hi - lo)));
  };
  b.randomChance = function (n: number, d: number) {
    if (this.forceRandomChance !== null && this.forceRandomChance !== undefined) return this.forceRandomChance;
    if (n <= 0) return false;
    if (n >= d) return true;
    const id = this.effect?.id;
    if (CHANCES.has(id)) return ch.pick([1 - n / d, n / d]) === 1;
    if (d === 100 && inStack("hitStepAccuracy")) return true;
    return false;
  };
  b.sample = function (items: readonly unknown[]) {
    if (items.length === 1) return items[0];
    return items[ch.pick(Array(items.length).fill(1 / items.length))];
  };
  b.prng.shuffle = function (list: unknown[], start = 0, end = list.length) {
    const k = end - start;
    if (k < 2) return;
    permute(list, start, end, ch.pick(Array(factorial(k)).fill(1 / factorial(k))));
  };
}

function startBattle(spec: Spec) {
  const b = new Battle({ formatid: FORMAT[spec.game], seed: [1, 2, 3, 4] });
  const p1 = team(spec, "own"), p2 = team(spec, "opponent");
  b.setPlayer("p1", { team: p1.map((m, i) => setOf(m, i >= 2)) });
  b.setPlayer("p2", { team: p2.map((m, i) => setOf(m, i >= 2)) });
  const order = (n: number) => `team ${Array.from({ length: n }, (_, i) => i + 1).join("")}`;
  if (b.requestState === "teampreview") b.makeChoices(order(p1.length), order(p2.length));
  for (const [side, list] of [[b.p1, p1], [b.p2, p2]] as const) {
    list.forEach((m, index) => {
      const p = side.pokemon[index];
      if (m.hp !== undefined) p.sethp(m.hp);
      // A bench Pokémon's status is set directly (setStatus needs an active Pokémon).
      if (m.status) { if (p.isActive) p.setStatus(m.status, null, null, true); else { p.status = m.status; p.statusState = b.initEffectState({ id: m.status, target: p }); } }
      if (m.boosts) for (const [stat, value] of Object.entries(m.boosts)) p.boosts[stat] = value;
    });
  }
  for (const [side, hazards] of [[b.p1, spec.hazards?.own], [b.p2, spec.hazards?.opponent]] as const) {
    if (!hazards) continue;
    if (hazards.stealthRock) side.addSideCondition("stealthrock", "debug");
    for (let i = 0; i < (hazards.spikes ?? 0); i++) side.addSideCondition("spikes", "debug");
    for (let i = 0; i < (hazards.toxicSpikes ?? 0); i++) side.addSideCondition("toxicspikes", "debug");
    if (hazards.stickyWeb) side.addSideCondition("stickyweb", "debug");
    if (hazards.steelsurge) side.addSideCondition("gmaxsteelsurge", "debug");
  }
  const at = (slot: DoublesSlotId) => (slotSide(slot) === "own" ? b.p1 : b.p2).active[SHOWDOWN_POSITION[slot].position];
  for (const seed of spec.seeds ?? []) at(seed.target).addVolatile("leechseed", at(seed.source));
  for (const sub of spec.substitutes ?? []) { at(sub.slot).addVolatile("substitute"); at(sub.slot).volatiles.substitute.hp = sub.hp; }
  for (const wish of spec.wishes ?? []) {
    const target = at(wish.slot);
    target.side.addSlotCondition(target, "wish", at(wish.source));
    target.side.slotConditions[target.position].wish.startingTurn = b.getOverflowedTurnCount() - 1;
  }
  if (spec.field?.weather) b.field.setWeather(spec.field.weather, "debug");
  if (spec.field?.terrain) b.field.setTerrain(spec.field.terrain, "debug");
  if (spec.field?.trickRoom) b.field.addPseudoWeather("trickroom", "debug");
  return b;
}

/** The answer to a switch request: the spec's replacement for a starting Pokémon's first switch, else the first bench Pokémon in team order. */
function answer(spec: Spec, b: any, firsts: Set<string>): [string, string] {
  const sideAnswer = (s: any, sideId: "own" | "opponent") => {
    const req = s.activeRequest;
    if (!req || !req.forceSwitch) return "";
    const used = new Set<number>();
    return req.forceSwitch.map((flag: boolean, position: number) => {
      if (!flag) return "pass";
      const leaving = s.active[position];
      const slot = SLOTS.find((each) => slotSide(each) === sideId && spec.slots[each].name === leaving?.name);
      const wanted = slot && !firsts.has(leaving.name) ? spec.replacement?.[slot] : undefined;
      if (leaving) firsts.add(leaving.name);
      let i = wanted ? s.pokemon.findIndex((p: any, idx: number) => idx >= s.active.length && p.name === wanted && !p.fainted && !used.has(idx)) : -1;
      // The default: the first member of the spec's bench (its order) not in play, else the first in team order.
      const free = (idx: number) => idx >= s.active.length && !s.pokemon[idx].fainted && !used.has(idx);
      if (i < 0) for (const m of spec.bench?.[sideId] ?? []) { const at = s.pokemon.findIndex((p: any) => p.name === m.name); if (at >= 0 && free(at)) { i = at; break; } }
      if (i < 0) i = s.pokemon.findIndex((_p: any, idx: number) => free(idx));
      if (i < 0) return "pass";
      used.add(i);
      return `switch ${i + 1}`;
    }).join(", ");
  };
  return [sideAnswer(b.p1, "own"), sideAnswer(b.p2, "opponent")];
}

export type Dists = { after: Map<string, Map<number, number>>; end: Map<string, Map<number, number>>; runs: number };
export function showdown(spec: Spec): Dists {
  const b0 = startBattle(spec);
  const json = JSON.stringify(State.serializeBattle(b0));
  const out: Dists = { after: new Map(), end: new Map(), runs: 0 };
  let prefix: number[] | null = [];
  const choices: [string, string] = [
    `${choiceOf(spec, "own-left")}, ${choiceOf(spec, "own-right")}`, `${choiceOf(spec, "opponent-right")}, ${choiceOf(spec, "opponent-left")}`,
  ];
  while (prefix) {
    const ch = new Chooser(prefix);
    const b = State.deserializeBattle(json);
    install(b, ch);
    const snap = () => new Map<string, number>(b.sides.flatMap((side: any) => side.pokemon.map((p: any) => [p.name, p.fainted ? 0 : p.hp])));
    let after: Map<string, number> | null = null;
    const ra = b.runAction;
    b.runAction = function (action: any) {
      if (action.choice === "residual") after = snap();
      return ra.call(this, action);
    };
    b.makeChoices(...choices);
    const firsts = new Set<string>();
    for (let guard = 0; b.requestState === "switch" && b.midTurn && !b.ended && guard < 8; guard++) {
      const [a1, a2] = answer(spec, b, firsts);
      b.makeChoices(a1, a2);
    }
    const end = snap();
    const w = ch.weight;
    const add = (into: Map<string, Map<number, number>>, values: Map<string, number> | null) => {
      for (const [name, hp] of values ?? []) { const m = into.get(name) ?? new Map(); into.set(name, m); m.set(hp, (m.get(hp) ?? 0) + w); }
    };
    add(out.after, after ?? end);
    add(out.end, end);
    if (++out.runs > 40_000) throw new Error("too many runs");
    prefix = ch.next();
  }
  return out;
}

// ---------------- App ----------------

const appMon = (m: SMon): Mon => ({
  species: toID(m.species), ability: toID(m.ability), ...(m.item ? { item: toID(m.item) } : {}), move: m.move ? toID(m.move) : null, target: m.target ?? null,
  ...(m.hp !== undefined ? { hp: m.hp } : {}), ...(m.status ? { status: m.status } : {}), ...(m.boosts ? { boosts: m.boosts as never } : {}), evs: m.evs, nature: m.nature,
  ...(m.gender ? { build: { configuration: { gender: m.gender } } as never } : {}),
  // Its move slots, as the Showdown set has them (No move is Splash there).
  extra: { moves: movesOf(m).map(toID) },
});
export function appInput(spec: Spec, runtime: BattleRuntime): DoublesTurnInput {
  const slots = Object.fromEntries(SLOTS.map((slot) => [slot, appMon(spec.slots[slot])])) as Record<DoublesSlotId, Mon>;
  const benches = {
    own: (spec.bench?.own ?? []).map((m) => benchOf(runtime, m.name, appMon(m), { moves: movesOf(m, true).map(toID) })),
    opponent: (spec.bench?.opponent ?? []).map((m) => benchOf(runtime, m.name, appMon(m), { moves: movesOf(m, true).map(toID) })),
  };
  const value = inputOf(runtime, slots, {
    bench: benches, ...(spec.replacement ? { replacement: spec.replacement } : {}), ...(spec.hazards ? { hazards: spec.hazards } : {}),
    names: Object.fromEntries(SLOTS.map((slot) => [slot, spec.slots[slot].name])) as Record<DoublesSlotId, string>,
  });
  // A move that takes no chosen target in the app gets none.
  for (const seed of spec.seeds ?? []) value.pokemon[seed.target]!.carried = { ...value.pokemon[seed.target]!.carried, leechSeed: seed.source };
  for (const sub of spec.substitutes ?? []) value.pokemon[sub.slot]!.carried = { ...value.pokemon[sub.slot]!.carried, substitute: sub.hp };
  if (spec.wishes?.length) {
    const b = startBattle(spec);
    const at = (slot: DoublesSlotId) => (slotSide(slot) === "own" ? b.p1 : b.p2).active[SHOWDOWN_POSITION[slot].position];
    for (const wish of spec.wishes) value.pokemon[wish.slot]!.carried = { ...value.pokemon[wish.slot]!.carried, wish: Math.trunc(at(wish.source).maxhp / 2) };
  }
  const WEATHER: Record<string, string> = { SunnyDay: "Sun", RainDance: "Rain", Sandstorm: "Sand", Snow: "Snow", Hail: "Hail" };
  value.field = { ...value.field, ...(spec.field?.weather ? { weather: (WEATHER[spec.field.weather] ?? spec.field.weather) as never } : {}), ...(spec.field?.terrain ? { terrain: spec.field.terrain as never } : {}), ...(spec.field?.trickRoom ? { trickRoom: true } : {}) };
  return value;
}

// ---------------- Comparison ----------------

const stats = (dist: Map<number, number>) => {
  let total = 0, mean = 0, min = Infinity, max = -Infinity, ko = 0;
  for (const [hp, m] of dist) { total += m; mean += hp * m; if (hp < min) min = hp; if (hp > max) max = hp; if (hp <= 0) ko += m; }
  return { mean: mean / total, min, max, ko: ko / total };
};
const close = (a: number, b: number) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));

export async function compare(spec: Spec, verbose = false): Promise<{ ok: boolean; lines: string[] }> {
  const lines: string[] = [];
  const runtime = await loadBattleRuntime(RUNTIME[spec.game] as never);
  const value = appInput(spec, runtime);
  const result = calculateDoublesTurn(value);
  if (verbose) lines.push(show(result));
  const sd = showdown(spec);
  if (result.status !== "ready") {
    lines.push(`APP ${result.status}: ${result.status === "not-estimated" ? result.reason : JSON.stringify(result.issues)}`);
    return { ok: false, lines };
  }
  let ok = true;
  const names = new Map<string, string>(); // name -> how the app reports it
  for (const slot of SLOTS) names.set(spec.slots[slot].name, `slot:${slot}`);
  for (const side of ["own", "opponent"] as const) for (const m of spec.bench?.[side] ?? []) names.set(m.name, m.name);
  // After the moves: the starting Pokémon's hp[slot]; a bench Pokémon from hpEntered mixed with its bench HP where it stayed out.
  for (const [name, dist] of sd.after) {
    if (spec.skip?.includes(name)) continue;
    const want = stats(dist);
    const id = names.get(name)!;
    let got: { mean: number; min: number; max: number; ko: number } | null = null;
    if (id.startsWith("slot:")) {
      const h = result.hp[id.slice(5) as DoublesSlotId]!;
      got = { mean: h.average, min: h.min, max: h.max, ko: h.koChance };
    } else {
      let chance = 0;
      for (const r of Object.values(result.replaced ?? {})) for (const e of r!.entered) if (e.id === name) chance += e.chance;
      const entered = Object.values(result.hpEntered ?? {}).map((m) => m![name]).find(Boolean);
      if (!entered || chance === 0) got = { mean: want.mean, min: want.min, max: want.max, ko: 0 };
      else {
        const stay = entered.start;
        got = { mean: chance * entered.average + (1 - chance) * stay, min: chance < 1 - 1e-12 ? Math.min(entered.min, stay) : entered.min, max: chance < 1 - 1e-12 ? Math.max(entered.max, stay) : entered.max, ko: chance * entered.koChance };
      }
    }
    const match = close(want.mean, got.mean) && want.min === got.min && want.max === got.max && close(want.ko, got.ko);
    if (!match) ok = false;
    if (!match || verbose) lines.push(`${match ? "ok  " : "DIFF"} after ${name}: showdown ${want.min}-${want.max} mean ${want.mean.toFixed(4)} ko ${want.ko.toFixed(4)} | app ${got.min}-${got.max} mean ${got.mean.toFixed(4)} ko ${got.ko.toFixed(4)}`);
  }
  // After the turn: the E2 outcomes' distributions by Pokémon.
  if (result.endOfTurn.status !== "ready") {
    lines.push(`APP end not estimated: ${result.endOfTurn.reason}`);
    return { ok: false, lines };
  }
  const outcomes = calculateDoublesOutcomes(value);
  if (outcomes.status !== "ready") { lines.push(`APP outcomes ${outcomes.status}`); return { ok: false, lines }; }
  const ends = new Map<string, Map<number, number>>();
  const addTo = (name: string, hp: { hp: number; chance: number }[], mass: number) => {
    const m = ends.get(name) ?? new Map(); ends.set(name, m);
    for (const { hp: value, chance } of hp) m.set(value, (m.get(value) ?? 0) + chance * mass);
  };
  const nameOfId = (slot: DoublesSlotId, id: string | undefined) => (id === undefined ? spec.slots[slot].name : id.startsWith("slot:") ? spec.slots[id.slice(5) as DoublesSlotId].name : id);
  for (const o of outcomes.outcomes) {
    for (const [slot, m] of Object.entries(o.mons) as [DoublesSlotId, NonNullable<(typeof o.mons)[DoublesSlotId]>][]) addTo(nameOfId(slot, m.id), m.hp, o.chance);
    for (const list of Object.values(o.benched ?? {})) for (const b of list ?? []) addTo(nameOfId(b.slot, b.id), b.hp, o.chance);
  }
  for (const [name, dist] of sd.end) {
    if (spec.skip?.includes(name)) continue;
    const mine = ends.get(name) ?? new Map<number, number>();
    let present = 0;
    for (const m of mine.values()) present += m;
    if (present < 1 - 1e-9) {
      // A bench Pokémon that did not come in in some outcomes: its bench HP there.
      const side = (spec.bench?.own ?? []).some((m) => m.name === name) ? "own" : "opponent";
      const start = value.bench?.[side]?.find((each) => each.id === name);
      const hp = start ? (start.build.currentHP ?? [...dist.keys()].reduce((a, b) => Math.max(a, b), 0)) : 0;
      mine.set(hp, (mine.get(hp) ?? 0) + (1 - present));
    }
    const keys = new Set([...dist.keys(), ...mine.keys()]);
    let match = true;
    for (const key of keys) if (!close(dist.get(key) ?? 0, mine.get(key) ?? 0)) match = false;
    if (!match) ok = false;
    const text = (m: Map<number, number>) => [...m].sort((a, b) => a[0] - b[0]).map(([hp, p]) => `${hp}:${+p.toFixed(5)}`).join(" ");
    if (!match || verbose) lines.push(`${match ? "ok  " : "DIFF"} end ${name}: showdown ${text(dist)} | app ${text(mine)}`);
  }
  return { ok, lines };
}

/** One Showdown run's log (the first choice of every random event), for reading a probe. */
export function showdownTrace(spec: Spec): string[] {
  const b = startBattle(spec);
  install(b, new Chooser([]));
  const at = b.log.length;
  const choices: [string, string] = [
    `${choiceOf(spec, "own-left")}, ${choiceOf(spec, "own-right")}`, `${choiceOf(spec, "opponent-right")}, ${choiceOf(spec, "opponent-left")}`,
  ];
  try {
    b.makeChoices(...choices);
    const firsts = new Set<string>();
    for (let guard = 0; b.requestState === "switch" && b.midTurn && !b.ended && guard < 8; guard++) {
      const [a1, a2] = answer(spec, b, firsts);
      b.log.push(`(answer ${a1} / ${a2})`);
      b.makeChoices(a1, a2);
    }
  } catch (error) {
    b.log.push(`(ERROR ${(error as Error).message})`);
  }
  return (b.log.slice(at) as string[]).filter((line) => !line.startsWith("|t:|") && line !== "|");
}

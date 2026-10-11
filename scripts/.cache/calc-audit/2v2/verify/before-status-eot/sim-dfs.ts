// Exact doubles-turn oracle on pinned Showdown c23d2e94 (SPEC §8.1), extending design/turnsim.ts.
//
// One turn of a case runs in the real simulator (scripts/.cache/calc-audit/showdown) with every random decision enumerated:
// the 16 damage rolls (randomizer), full paralysis / Quick Claw / Quick Draw (randomChance by effect), speed-tie shuffles
// (prng.shuffle, every permutation), random targets and hit counts (sample, random). These are forced as the app assumes:
// every move hits (accuracy checks pass), no critical hit unless certain or the case's Critical hit is on, added effects below
// 100% fail (random(100) gives 99, other randomChance calls fail unless certain). HP is read when the residual action is picked,
// before the end of the turn. One bench Pokémon per side keeps the turn going when both actives on a side faint.
//
// The walk is exact and runs action by action: the battle is serialized (sim/state.ts) at every action boundary, equal states
// are merged with their masses added, and each state's next action is enumerated by replaying it from the snapshot with a
// decision prefix (DFS). `--validate` reruns the case as whole-turn replays without any merging or serialization and requires
// the same distributions.
//
// Run from the repo root:
//   npx --no-install tsx scripts/.cache/calc-audit/2v2/verify/sim-dfs.ts [V01 V02 ...] [--validate] [--samples=10000]
// Writes scripts/.cache/calc-audit/2v2/verify/results/<id>.json (OracleResult).
import fs from "node:fs";
import path from "node:path";
import * as sim from "../../showdown/sim/index.ts";
import { State } from "../../showdown/sim/state.ts";
import {
  DOUBLES_FORMAT, SLOTS, toID,
  type Case, type CaseMon, type HitResult, type OracleResult, type SlotId, type SlotResult, type StepResult, type WalkResult,
} from "./case-types";
import { CASES } from "./cases";

const { Battle, Dex } = sim as any;
export type Mode = "all" | "lowest" | "highest";

/** SPEC §3.1 SHOWDOWN_POSITION: the far side is mirrored, so the screen-left foe is p2b. */
export const SD: Record<SlotId, { side: 0 | 1; position: 0 | 1 }> = {
  "own-left": { side: 0, position: 0 }, "own-right": { side: 0, position: 1 },
  "opponent-left": { side: 1, position: 1 }, "opponent-right": { side: 1, position: 0 },
};
const IDENT: Record<SlotId, string> = { "own-left": "p1a", "own-right": "p1b", "opponent-left": "p2b", "opponent-right": "p2a" };
export function slotOf(p: any): SlotId | null {
  if (!p?.side || typeof p.position !== "number") return null;
  return SLOTS.find((slot) => SD[slot].side === p.side.n && SD[slot].position === p.position) ?? null;
}
/** Showdown targetLoc from `actor` to `target`: foes 1/2 by position, own side -1/-2. */
export function targetLoc(actor: SlotId, target: SlotId): number {
  const a = SD[actor], t = SD[target];
  return a.side === t.side ? -(t.position + 1) : t.position + 1;
}

const ZERO = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const IV31 = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
export function sdSet(m: CaseMon, move: string | null, name: string) {
  return {
    name, species: m.species, gender: m.gender ?? "", item: m.item ?? "", ability: m.ability,
    moves: [...new Set([move ?? "Splash", "Splash"])], nature: m.nature ?? "Serious",
    evs: { ...ZERO, ...m.evs }, ivs: { ...IV31, ...m.ivs }, level: m.level ?? 50, teraType: m.teraType, happiness: 255,
  };
}
export const BENCH: CaseMon = { species: "Snorlax", ability: "Thick Fat" };
export const WEATHER: Record<string, string> = {
  Sun: "sunnyday", Rain: "raindance", Sand: "sandstorm", Snow: "snowscape", Hail: "hail",
  "Harsh Sunshine": "desolateland", "Heavy Rain": "primordialsea", "Strong Winds": "deltastream",
};
export const TERRAIN: Record<string, string> = { Electric: "electricterrain", Grassy: "grassyterrain", Misty: "mistyterrain", Psychic: "psychicterrain" };

export function pokemonAt(b: any, slot: SlotId) {
  return b.sides[SD[slot].side].active[SD[slot].position];
}

/** A started battle at turn 1 with the case's start state applied; warnings where Showdown's start differs from the case. */
export function prepare(c: Case) {
  const format = c.format ?? DOUBLES_FORMAT[c.game];
  const b = new Battle({ formatid: format, seed: [1, 2, 3, 4] });
  const team = (slots: SlotId[]) => [...slots.map((slot) => sdSet(c.slots[slot], c.slots[slot].action.move, c.slots[slot].species)), sdSet(BENCH, null, "Bench")];
  b.setPlayer("p1", { team: team(["own-left", "own-right"]) });
  b.setPlayer("p2", { team: team(["opponent-right", "opponent-left"]) });
  if (b.requestState === "teampreview") b.makeChoices("team 123", "team 123");
  const warnings: string[] = [];
  const f = c.field ?? {};
  if (f.weather) b.field.setWeather(WEATHER[f.weather], "debug");
  if (f.terrain) b.field.setTerrain(TERRAIN[f.terrain], "debug");
  for (const [flag, id] of [["trickRoom", "trickroom"], ["gravity", "gravity"], ["wonderRoom", "wonderroom"], ["magicRoom", "magicroom"]] as const) {
    if (f[flag]) b.field.addPseudoWeather(id, "debug");
  }
  for (const [i, side] of [f.own, f.opponent].entries()) {
    for (const [flag, id] of [["tailwind", "tailwind"], ["reflect", "reflect"], ["lightScreen", "lightscreen"], ["auroraVeil", "auroraveil"]] as const) {
      if (side?.[flag]) b.sides[i].addSideCondition(id, "debug");
    }
  }
  for (const slot of SLOTS) {
    const m = c.slots[slot], p = pokemonAt(b, slot);
    if (m.absent) continue;
    if (toID(p.species.name) !== toID(m.species) && toID(p.baseSpecies.name) !== toID(m.species)) warnings.push(`${slot}: Showdown species ${p.species.name}`);
    if (m.hp !== undefined) p.sethp(m.hp);
    if (m.status) p.setStatus(m.status, null, null, true);
    for (const stat of ["atk", "def", "spa", "spd", "spe"] as const) {
      const want = m.boosts?.[stat] ?? 0;
      if (p.boosts[stat] !== want) {
        if (m.boosts?.[stat] === undefined) warnings.push(`${slot}: Showdown ${stat} stage ${p.boosts[stat]} at the start, case 0 (set to 0)`);
        p.boosts[stat] = want;
      }
    }
    if (m.charged) p.addVolatile("charge");
    if (p.item !== toID(m.item ?? "")) warnings.push(`${slot}: Showdown item ${p.item || "(none)"} at the start, case ${m.item ?? "(none)"}`);
  }
  // An empty slot: fainted before the turn, so it takes no action and the bench stays out until the turn ends (probe 1c).
  for (const slot of SLOTS) if (c.slots[slot].absent) pokemonAt(b, slot).faint();
  b.faintMessages();
  // Equal speeds at the start multiply the runs (every sort of actions and handlers shuffles them) even when the order cannot
  // matter, so cases keep the four apart unless the tie is what they test.
  const speeds = SLOTS.filter((slot) => !c.slots[slot].absent).map((slot) => [slot, pokemonAt(b, slot).getActionSpeed()] as const);
  for (const [i, [slot, speed]] of speeds.entries()) {
    for (const [other, otherSpeed] of speeds.slice(i + 1)) if (speed === otherSpeed) warnings.push(`speed tie at the start: ${slot} and ${other} (${speed})`);
  }
  if ((b.field.weather || "") !== (f.weather ? WEATHER[f.weather] : "")) warnings.push(`weather ${b.field.weather || "(none)"} at the start, case ${f.weather || "(none)"}`);
  if ((b.field.terrain || "") !== (f.terrain ? TERRAIN[f.terrain] : "")) warnings.push(`terrain ${b.field.terrain || "(none)"} at the start, case ${f.terrain || "(none)"}`);
  return { b, format, warnings, choices: [choice(b, c, "own-left") + ", " + choice(b, c, "own-right"), choice(b, c, "opponent-right") + ", " + choice(b, c, "opponent-left")] as [string, string] };
}

export function choice(b: any, c: Case, slot: SlotId): string {
  const m = c.slots[slot], move = m.action.move;
  if (m.absent) return "pass";
  let text = "move 1";
  if (move !== null) {
    let target = m.action.target;
    const dexMove = b.dex.moves.get(move);
    if (!dexMove.exists) throw new Error(`${c.id} ${slot}: unknown move ${move}`);
    if (!target && dexMove.target === "adjacentAlly") target = SLOTS.find((s) => s !== slot && SD[s].side === SD[slot].side);
    if (target) text += ` ${targetLoc(slot, target)}`;
    if (m.choice) text += ` ${m.choice}`;
  } else if (m.choice === "terastallize" || m.choice === "mega") {
    // No move (Splash) still Terastallizes or Mega Evolves as the turn starts, as the app's build mechanic does; a
    // Dynamaxed or Z-Powered Splash would be Max Guard or Z-Splash, so those stay plain.
    text += ` ${m.choice}`;
  }
  return text;
}

/** Serialized state with the log and other per-path noise blanked: the string is both the resume point and the merge key. */
function snapshot(b: any): string {
  const state = State.serializeBattle(b);
  state.log = [];
  state.sentLogPos = 0;
  state.lastMoveLine = -1;
  state.inputLog = [];
  state.messageLog = [];
  state.hints = [];
  return JSON.stringify(state);
}

class Chooser {
  trail: number[] = [];
  sizes: number[] = [];
  weight = 1;
  constructor(readonly prefix: number[], readonly mode: Mode, readonly kinds: Record<string, number>, readonly rng?: () => number) {}
  count(kind: string) {
    this.kinds[kind] = (this.kinds[kind] ?? 0) + 1;
  }
  /** One decision among options with these weights (summing to 1). */
  pick(kind: string, weights: number[]): number {
    this.count(kind);
    if (weights.length === 1) return 0;
    let i = 0;
    if (this.rng) {
      let u = this.rng();
      while (i < weights.length - 1 && u >= weights[i]) u -= weights[i++];
    } else {
      const depth = this.trail.length;
      i = depth < this.prefix.length ? this.prefix[depth] : 0;
    }
    this.trail.push(i);
    this.sizes.push(weights.length);
    this.weight *= weights[i];
    return i;
  }
  next(): number[] | null {
    for (let j = this.trail.length - 1; j >= 0; j--) {
      if (this.trail[j] + 1 < this.sizes[j]) return [...this.trail.slice(0, j), this.trail[j] + 1];
    }
    return null;
  }
}

const inStack = (...names: string[]) => {
  const stack = new Error().stack ?? "";
  return names.some((name) => stack.includes(name));
};
function factorial(k: number) {
  let f = 1;
  for (let i = 2; i <= k; i++) f *= i;
  return f;
}
/** The idx-th permutation (Lehmer code) of list[start..end). */
function permute(list: unknown[], start: number, end: number, idx: number) {
  const pool = list.slice(start, end);
  const out: unknown[] = [];
  for (let k = pool.length; k > 0; k--) {
    const f = factorial(k - 1);
    const j = Math.floor(idx / f);
    idx %= f;
    out.push(pool.splice(j, 1)[0]);
  }
  list.splice(start, end - start, ...out);
}
/** randomChance calls that are random events of the turn, keyed by the effect running them. */
const CHANCE_EFFECTS = new Set(["par", "quickclaw", "quickdraw", "confusion", "frz"]);

function install(b: any, ch: Chooser, critical: boolean) {
  b.randomizer = function (base: number) {
    const outs = Array.from({ length: 16 }, (_, i) => this.trunc(this.trunc(base * (85 + i)) / 100));
    if (ch.mode === "lowest") return ch.count("roll"), outs[0];
    if (ch.mode === "highest") return ch.count("roll"), outs[15];
    const values = [...new Set(outs)];
    return values[ch.pick("roll", values.map((v) => outs.filter((o) => o === v).length / 16))];
  };
  b.random = function (m?: number, n?: number) {
    if (m === undefined) throw new Error("random() without a range is not enumerated");
    if (m === 100 && n === undefined) return ch.count("secondary"), 99;
    const [lo, hi] = n === undefined ? [0, m] : [m, n];
    if (hi - lo <= 1) return lo;
    const hitCount = inStack("hitStepMoveHitLoop");
    if (hitCount && ch.mode !== "all") {
      ch.count("hits");
      // 5 - random(2) (Loaded Dice) and 10 - random(7) (Population Bomb) count down; random(a, b + 1) counts up.
      const fewest = n === undefined ? hi - 1 : lo, most = n === undefined ? lo : hi - 1;
      return ch.mode === "lowest" ? fewest : most;
    }
    const size = hi - lo;
    return lo + ch.pick(hitCount ? "hits" : "random", Array(size).fill(1 / size));
  };
  b.randomChance = function (n: number, d: number) {
    if (this.forceRandomChance !== null && this.forceRandomChance !== undefined) return this.forceRandomChance;
    if (n <= 0) return false;
    if (n >= d) return true;
    const id = this.effect?.id;
    if (CHANCE_EFFECTS.has(id)) return ch.pick(`chance:${id}`, [1 - n / d, n / d]) === 1;
    if (d === 100 && inStack("hitStepAccuracy", "hitStepMoveHitLoop")) return ch.count("accuracy"), true;
    ch.count(`fail:${id ?? "?"}`);
    return false;
  };
  b.sample = function (items: readonly unknown[]) {
    if (items.length === 1) return items[0];
    if (inStack("hitStepMoveHitLoop") && items.every((x) => typeof x === "number")) {
      const nums = items as number[];
      if (ch.mode !== "all") return ch.count("hits"), ch.mode === "lowest" ? Math.min(...nums) : Math.max(...nums);
      const values = [...new Set(nums)];
      return values[ch.pick("hits", values.map((v) => nums.filter((x) => x === v).length / nums.length))];
    }
    return items[ch.pick("sample", Array(items.length).fill(1 / items.length))];
  };
  b.prng.shuffle = function (list: unknown[], start = 0, end = list.length) {
    const k = end - start;
    if (k < 2) return;
    const perms = factorial(k);
    permute(list, start, end, ch.pick(`tie${k}`, Array(perms).fill(1 / perms)));
  };
  if (critical) {
    const gd = b.actions.getDamage;
    b.actions.getDamage = function (s: any, t: any, m: any, sup?: boolean) {
      if (typeof m === "object" && m && m.willCrit === undefined) m.willCrit = true;
      return gd.call(this, s, t, m, sup);
    };
  }
}

type ActionRec = {
  slot: SlotId; moveId: string; pos: number; faintedAtPick: boolean; moved: boolean; cant: string | null;
  reached: Set<SlotId>; landed: Set<SlotId>; dmg: Map<SlotId, number>; kos: SlotId[]; lines: string[]; effective: string | null;
  /** Targets whose knockout stopped a multi-hit move before its planned last hit (sim/battle-actions.ts:890-895 move.lastHit). */
  truncated: Set<SlotId>;
};
type Ctx = { c: Case; pass: Set<SlotId>; absent: Set<SlotId>; totalMoves: number; critical: boolean };

const hpOf = (p: any) => (p.fainted || !p.hp ? 0 : p.hp);
function hpNow(b: any): Record<SlotId, number> {
  return Object.fromEntries(SLOTS.map((slot) => [slot, hpOf(pokemonAt(b, slot))])) as Record<SlotId, number>;
}
function maxNow(b: any): Record<SlotId, number> {
  return Object.fromEntries(SLOTS.map((slot) => [slot, pokemonAt(b, slot).maxhp])) as Record<SlotId, number>;
}

/** Records each move action of a run: picks, |move| and |cant| lines, the targets its hit steps met, damage and KOs. */
class Recorder {
  recs: ActionRec[] = [];
  current: (ActionRec & { hpBefore: Record<SlotId, number>; logStart: number }) | null = null;
  firstMoveHP: { hp: Record<SlotId, number>; max: Record<SlotId, number> } | null = null;
  constructor(readonly b: any, readonly ctx: Ctx) {
    const rec = this;
    const acts = b.actions;
    const inv = acts.hitStepInvulnerabilityEvent;
    acts.hitStepInvulnerabilityEvent = function (targets: any[], pokemon: any, move: any) {
      for (const t of targets) { const s = slotOf(t); if (s && rec.current) rec.current.reached.add(s); }
      return inv.call(this, targets, pokemon, move);
    };
    const loop = acts.hitStepMoveHitLoop;
    acts.hitStepMoveHitLoop = function (targets: any[], pokemon: any, move: any) {
      for (const t of targets) { const s = slotOf(t); if (s && rec.current) rec.current.landed.add(s); }
      const out = loop.call(this, targets, pokemon, move);
      if (rec.current && move.multihit && !move.lastHit) for (const t of targets) { const s = slotOf(t); if (s && !t.hp) rec.current.truncated.add(s); }
      return out;
    };
    const gd = acts.getDamage;
    acts.getDamage = function (s: any, t: any, m: any, sup?: boolean) {
      const out = gd.call(this, s, t, m, sup);
      const slot = slotOf(t);
      if (rec.current && slot && typeof out === "number") rec.current.dmg.set(slot, (rec.current.dmg.get(slot) ?? 0) + out);
      return out;
    };
  }
  /** Called with the action just shifted from the queue. */
  begin(action: any) {
    this.finish();
    if (action.choice !== "move") return;
    const slot = slotOf(action.pokemon);
    if (!slot) return;
    const remainingMoves = this.b.queue.list.filter((a: any) => a.choice === "move").length;
    if (!this.firstMoveHP && remainingMoves === this.ctx.totalMoves - 1) this.firstMoveHP = { hp: hpNow(this.b), max: maxNow(this.b) };
    if (this.ctx.pass.has(slot)) return;
    const remaining = this.b.queue.list.filter((a: any) => a.choice === "move" && !this.ctx.pass.has(slotOf(a.pokemon)!)).length;
    const nonPass = SLOTS.filter((s) => !this.ctx.pass.has(s) && !this.ctx.absent.has(s)).length;
    this.current = {
      slot, moveId: toID(this.ctx.c.slots[slot].action.move!), pos: nonPass - remaining,
      faintedAtPick: !!action.pokemon.fainted || !action.pokemon.hp, moved: false, cant: null,
      reached: new Set(), landed: new Set(), dmg: new Map(), kos: [], lines: [], effective: null, truncated: new Set(),
      hpBefore: hpNow(this.b), logStart: this.b.log.length,
    };
  }
  finish() {
    const cur = this.current;
    if (!cur) return;
    this.current = null;
    const lines = this.b.log.slice(cur.logStart) as string[];
    const ident = IDENT[cur.slot];
    const moveLine = lines.find((l) => l.startsWith(`|move|${ident}: `));
    cur.moved = !!moveLine;
    cur.effective = moveLine ? moveLine.split("|")[3] : null;
    const cant = lines.find((l) => l.startsWith(`|cant|${ident}: `));
    cur.cant = cant ? cant.split("|")[3] : null;
    const after = hpNow(this.b);
    cur.kos = [...cur.reached].filter((s) => cur.hpBefore[s] > 0 && after[s] === 0);
    cur.lines = lines.filter((l) => /^\|(-fail|-activate|-immune|-miss|-block|cant|-enditem|-ability|-heal|-boost|-unboost|-start|-singleturn|-sidestart|-fieldstart|-weather|-status|-clearallboost)\||\[from\]|\[notarget\]|\[still\]/.test(l) && !/^\|debug\|/.test(l))
      .map((l) => l.replace(/\|\d+\/\d+( [a-z]+)?/g, "|hp").replace(/\|\[of\] /g, "|[of] "));
    this.recs.push(cur);
  }
}

const STOP = { stop: true };
type SegmentOut = { recs: ActionRec[]; weightPath: number; firstMoveHP: Recorder["firstMoveHP"] } & ({ kind: "boundary"; json: string } | { kind: "end"; hp: Record<SlotId, number>; max: Record<SlotId, number> });

function runSegment(json: string, first: boolean, choices: [string, string], ch: Chooser, ctx: Ctx, whole = false): SegmentOut {
  const b = State.deserializeBattle(json);
  install(b, ch, ctx.critical);
  const rec = new Recorder(b, ctx);
  let calls = 0;
  let out: SegmentOut | null = null;
  const ra = b.runAction;
  b.runAction = function (action: any) {
    calls++;
    const boundary = !whole && (first || calls === 2);
    if (action.choice === "residual" || boundary) {
      rec.finish();
      if (action.choice === "residual") {
        out = { kind: "end", hp: hpNow(this), max: maxNow(this), recs: rec.recs, weightPath: ch.weight, firstMoveHP: rec.firstMoveHP };
      } else {
        this.queue.list.unshift(action);
        out = { kind: "boundary", json: snapshot(this), recs: rec.recs, weightPath: ch.weight, firstMoveHP: rec.firstMoveHP };
        this.queue.list.shift();
      }
      throw STOP;
    }
    rec.begin(action);
    return ra.call(this, action);
  };
  try {
    if (first) {
      for (const [i, text] of choices.entries()) {
        if (!b.sides[i].choose(text)) throw new Error(`choice "${text}" for p${i + 1}: ${b.sides[i].choice.error}`);
      }
      b.commitChoices();
    } else {
      b.turnLoop();
    }
  } catch (e) {
    if (e !== STOP) throw e;
  }
  if (!out) throw new Error(`the turn stopped before the end of the moves (requestState "${b.requestState}", ended ${b.ended}): a mid-turn switch is not supported`);
  return out;
}

/** Accumulates a walk's marginals. */
class Tally {
  dist: Record<SlotId, Map<number, number>> = Object.fromEntries(SLOTS.map((s) => [s, new Map()])) as any;
  max: Record<SlotId, Map<number, number>> = Object.fromEntries(SLOTS.map((s) => [s, new Map()])) as any;
  start: Record<SlotId, Map<number, number>> = Object.fromEntries(SLOTS.map((s) => [s, new Map()])) as any;
  startMax: Record<SlotId, number> = {} as any;
  steps: Partial<Record<SlotId, StepResult>> = {};
  runs = 0;
  constructor(readonly ctx: Ctx) {
    for (const slot of SLOTS) {
      if (ctx.pass.has(slot) || ctx.absent.has(slot)) continue;
      this.steps[slot] = { moveId: toID(ctx.c.slots[slot].action.move!), picked: 0, faintedAtPick: 0, moved: 0, cant: {}, orderAll: {}, orderMoved: {}, hits: {}, lines: {} };
    }
  }
  add(recs: ActionRec[], w: number) {
    for (const r of recs) {
      const s = this.steps[r.slot]!;
      s.picked += w;
      if (r.faintedAtPick) s.faintedAtPick += w;
      if (r.moved) s.moved += w;
      if (r.cant) s.cant[r.cant] = (s.cant[r.cant] ?? 0) + w;
      s.orderAll[r.pos] = (s.orderAll[r.pos] ?? 0) + w;
      if (r.moved) s.orderMoved[r.pos] = (s.orderMoved[r.pos] ?? 0) + w;
      if (r.effective && toID(r.effective) !== s.moveId) s.lines[`|effective|${r.effective}`] = (s.lines[`|effective|${r.effective}`] ?? 0) + w;
      for (const t of new Set([...r.reached, ...r.dmg.keys()])) {
        const h: HitResult = s.hits[t] ??= { reached: 0, landed: 0, ko: 0, dmgMin: null, dmgMax: null, truncated: 0 };
        if (r.reached.has(t)) h.reached += w;
        if (r.truncated.has(t)) h.truncated = (h.truncated ?? 0) + w;
        if (r.landed.has(t)) h.landed += w;
        if (r.kos.includes(t)) h.ko += w;
        const d = r.dmg.get(t);
        if (d !== undefined && w > 0) {
          h.dmgMin = h.dmgMin === null ? d : Math.min(h.dmgMin, d);
          h.dmgMax = h.dmgMax === null ? d : Math.max(h.dmgMax, d);
        }
      }
      for (const line of new Set(r.lines)) s.lines[line] = (s.lines[line] ?? 0) + w;
    }
  }
  addStart(first: SegmentOut["firstMoveHP"], w: number) {
    if (!first) return;
    for (const slot of SLOTS) {
      this.start[slot].set(first.hp[slot], (this.start[slot].get(first.hp[slot]) ?? 0) + w);
      this.startMax[slot] = first.max[slot];
    }
  }
  end(hp: Record<SlotId, number>, max: Record<SlotId, number>, w: number) {
    for (const slot of SLOTS) {
      this.dist[slot].set(hp[slot], (this.dist[slot].get(hp[slot]) ?? 0) + w);
      this.max[slot].set(max[slot], (this.max[slot].get(max[slot]) ?? 0) + w);
    }
  }
  slots(): Record<SlotId, SlotResult> {
    return Object.fromEntries(SLOTS.map((slot) => {
      const dist = [...this.dist[slot]].sort((a, b) => a[0] - b[0]);
      const total = dist.reduce((sum, [, p]) => sum + p, 0);
      const top = Math.max(...dist.map(([, p]) => p));
      const near = (p: number) => Math.abs(p - top) <= 1e-12;
      const modes = dist.filter(([, p]) => near(p)).map(([hp]) => hp);
      const start = [...this.start[slot]].sort((a, b) => b[1] - a[1])[0]?.[0] ?? NaN;
      const maximum = [...this.max[slot]].sort((a, b) => b[1] - a[1])[0]?.[0] ?? NaN;
      const r: SlotResult = {
        species: this.ctx.c.slots[slot].species, start, maximum,
        dist, koChance: dist.find(([hp]) => hp === 0)?.[1] ?? 0,
        average: dist.reduce((sum, [hp, p]) => sum + hp * p, 0) / total,
        min: dist[0][0], max: dist[dist.length - 1][0], modeTieUp: Math.max(...modes), modeTieDown: Math.min(...modes),
      };
      if (Math.abs(total - 1) > 1e-9) throw new Error(`${slot}: masses sum to ${total}`);
      return [slot, r];
    })) as Record<SlotId, SlotResult>;
  }
}

function context(c: Case): Ctx {
  const absent = new Set(SLOTS.filter((slot) => c.slots[slot].absent));
  const pass = new Set(SLOTS.filter((slot) => !absent.has(slot) && c.slots[slot].action.move === null));
  return { c, pass, absent, totalMoves: SLOTS.length - absent.size, critical: !!c.field?.critical };
}

/** The exact walk: BFS over action boundaries, equal serialized states merged. */
export function walk(c: Case, mode: Mode, options: { merge?: boolean; maxRuns?: number; start?: (c: Case) => ReturnType<typeof prepare> } = {}): WalkResult {
  const t0 = performance.now();
  // `start`: another way to reach the case's start (fainted-engine/real-battle.ts: a real battle's turn before).
  const { b, choices } = (options.start ?? prepare)(c);
  const ctx = context(c);
  const tally = new Tally(ctx);
  const kinds: Record<string, number> = {};
  let frontier = new Map<string, { json: string; w: number; first: boolean }>([["pre", { json: snapshot(b), w: 1, first: true }]]);
  let classes = 0, unique = 0;
  while (frontier.size) {
    const next = new Map<string, { json: string; w: number; first: boolean }>();
    for (const cls of frontier.values()) {
      classes++;
      let prefix: number[] | null = [];
      while (prefix) {
        const ch = new Chooser(prefix, mode, kinds);
        const out = runSegment(cls.json, cls.first, choices, ch, ctx);
        tally.runs++;
        if (options.maxRuns && tally.runs > options.maxRuns) throw new Error(`over ${options.maxRuns} runs`);
        const w = cls.w * out.weightPath;
        tally.add(out.recs, w);
        tally.addStart(out.firstMoveHP, w);
        if (out.kind === "end") tally.end(out.hp, out.max, w);
        else {
          const key = options.merge === false ? String(unique++) : out.json;
          const had = next.get(key);
          if (had) had.w += w;
          else next.set(key, { json: out.json, w, first: false });
        }
        prefix = ch.next();
      }
    }
    frontier = next;
  }
  return { mode, exact: true, runs: tally.runs, classes, ms: Math.round(performance.now() - t0), decisions: kinds, slots: tally.slots(), steps: tally.steps };
}

/** Whole-turn replays from the pre-turn snapshot, no merging: the reference for walk(). */
export function walkReplay(c: Case, mode: Mode, maxRuns = 200_000, start: (c: Case) => ReturnType<typeof prepare> = prepare): WalkResult {
  const t0 = performance.now();
  const { b, choices } = start(c);
  const ctx = context(c);
  const tally = new Tally(ctx);
  const kinds: Record<string, number> = {};
  const json = snapshot(b);
  let prefix: number[] | null = [];
  while (prefix) {
    const ch = new Chooser(prefix, mode, kinds);
    const out = runSegment(json, true, choices, ch, ctx, true);
    if (++tally.runs > maxRuns) throw new Error(`over ${maxRuns} runs`);
    tally.add(out.recs, out.weightPath);
    tally.addStart(out.firstMoveHP, out.weightPath);
    if (out.kind !== "end") throw new Error("replay ended at a boundary");
    tally.end(out.hp, out.max, out.weightPath);
    prefix = ch.next();
  }
  return { mode, exact: true, runs: tally.runs, classes: tally.runs, ms: Math.round(performance.now() - t0), decisions: kinds, slots: tally.slots(), steps: tally.steps };
}

/** A Monte Carlo of the decision RNG (forced events stay forced), seeded. */
export function walkSample(c: Case, samples: number, seed = 1): WalkResult {
  const t0 = performance.now();
  const { b, choices } = prepare(c);
  const ctx = context(c);
  const tally = new Tally(ctx);
  const kinds: Record<string, number> = {};
  const json = snapshot(b);
  let state = seed >>> 0;
  const rng = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = 0; i < samples; i++) {
    const ch = new Chooser([], "all", kinds, rng);
    const out = runSegment(json, true, choices, ch, ctx, true);
    tally.runs++;
    tally.add(out.recs, 1 / samples);
    tally.addStart(out.firstMoveHP, 1 / samples);
    if (out.kind !== "end") throw new Error("sample ended at a boundary");
    tally.end(out.hp, out.max, 1 / samples);
  }
  return { mode: "all", exact: false, samples, runs: tally.runs, classes: 0, ms: Math.round(performance.now() - t0), decisions: kinds, slots: tally.slots(), steps: tally.steps };
}

export function oracle(c: Case, options: { samples?: number; validate?: boolean } = {}): OracleResult {
  const { format, warnings } = prepare(c);
  const lowest = walk(c, "lowest"), highest = walk(c, "highest");
  const all = c.oracle === "modes" ? walkSample(c, options.samples ?? 10_000) : walk(c, "all");
  if (options.validate) {
    for (const [mode, fast] of [["lowest", lowest], ["highest", highest], ...(c.oracle === "modes" ? [] : [["all", all]])] as [Mode, WalkResult][]) {
      const ref = walkReplay(c, mode);
      const diff = compareWalks(fast, ref);
      if (diff.length) warnings.push(`validate ${mode}: ${diff.join("; ")}`);
      else warnings.push(`validate ${mode}: equal to ${ref.runs} whole-turn replays`);
    }
  }
  const expected = Object.fromEntries(SLOTS.map((slot) => {
    const a = all.slots[slot];
    return [slot, {
      start: a.start, maximum: a.maximum, low: lowest.slots[slot].modeTieUp, high: highest.slots[slot].modeTieDown,
      average: a.average, min: a.min, max: a.max, koChance: a.koChance, dist: a.dist,
    }];
  })) as OracleResult["expected"];
  return { id: c.id, title: c.title, game: c.game, format, checks: c.checks, walks: { all, lowest, highest }, expected, warnings };
}

/** Differences between two walks' slot distributions and step marginals (|Δp| ≤ 1e-12). */
export function compareWalks(a: WalkResult, b: WalkResult): string[] {
  const out: string[] = [];
  const close = (x: number, y: number) => Math.abs(x - y) <= 1e-12;
  for (const slot of SLOTS) {
    const da = new Map(a.slots[slot].dist), db = new Map(b.slots[slot].dist);
    for (const hp of new Set([...da.keys(), ...db.keys()])) {
      if (!close(da.get(hp) ?? 0, db.get(hp) ?? 0)) out.push(`${slot} hp ${hp}: ${da.get(hp) ?? 0} vs ${db.get(hp) ?? 0}`);
    }
    const sa = a.steps[slot], sb = b.steps[slot];
    if (!sa || !sb) continue;
    for (const key of ["picked", "faintedAtPick", "moved"] as const) if (!close(sa[key], sb[key])) out.push(`${slot} ${key}: ${sa[key]} vs ${sb[key]}`);
    for (const pos of new Set([...Object.keys(sa.orderAll), ...Object.keys(sb.orderAll)])) {
      if (!close(sa.orderAll[pos] ?? 0, sb.orderAll[pos] ?? 0)) out.push(`${slot} order ${pos}: ${sa.orderAll[pos] ?? 0} vs ${sb.orderAll[pos] ?? 0}`);
    }
    for (const t of new Set([...Object.keys(sa.hits), ...Object.keys(sb.hits)]) as Set<SlotId>) {
      const ha = sa.hits[t], hb = sb.hits[t];
      for (const key of ["reached", "landed", "ko"] as const) if (!close(ha?.[key] ?? 0, hb?.[key] ?? 0)) out.push(`${slot}→${t} ${key}: ${ha?.[key]} vs ${hb?.[key]}`);
    }
  }
  return out;
}

export const RESULTS_DIR = path.resolve("scripts/.cache/calc-audit/2v2/verify/results");

if (process.argv[1]?.replace(/\\/g, "/").endsWith("verify/sim-dfs.ts")) {
  const args = process.argv.slice(2);
  const ids = args.filter((a) => !a.startsWith("--"));
  const validate = args.includes("--validate");
  const samples = Number(args.find((a) => a.startsWith("--samples="))?.split("=")[1] ?? 10_000);
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  for (const c of CASES) {
    if (ids.length && !ids.some((id) => c.id === id || c.id.startsWith(`${id}-`) || c.id.startsWith(`${id}`))) continue;
    if (c.notEstimated) continue;
    try {
      const r = oracle(c, { samples, validate });
      fs.writeFileSync(path.join(RESULTS_DIR, `${c.id}.json`), JSON.stringify(r, null, 1));
      const summary = SLOTS.map((slot) => {
        const e = r.expected[slot];
        return `${slot} ${r.walks.all.slots[slot].species} ${e.start}→ low ${e.low} avg ${e.average.toFixed(3)} high ${e.high} [${e.min}–${e.max}] ko ${(e.koChance * 100).toFixed(3)}%`;
      }).join(" | ");
      console.log(`${c.id} (${r.walks.all.runs}+${r.walks.lowest.runs}+${r.walks.highest.runs} runs, ${r.walks.all.ms + r.walks.lowest.ms + r.walks.highest.ms} ms): ${summary}`);
      for (const w of r.warnings) console.log(`  ! ${w}`);
    } catch (e) {
      console.log(`${c.id} FAILED: ${(e as Error).stack}`);
    }
  }
}

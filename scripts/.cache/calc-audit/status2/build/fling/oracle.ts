// Track F (SPEC2 §4.7): the exact 1v1 Fling oracle on pinned Showdown c23d2e94, for any app matchup (builds and conditions).
// zmove-status/verify/u-oracle2.ts's exact walk (every random decision of a turn enumerated by decision-prefix replay: damage
// rolls grouped by value, hit counts, sample(), speed ties; accuracy passes; full paralysis and confusion self-hits never happen;
// every other chance below 1 fails, a critical hit too unless the row's field says Critical hit; states merged at each turn's
// end), generalised to the app's builds: EVs (Champions: Stat Points), IVs, natures, levels, HP, status, stages, Tera, Dynamax,
// Mega forms (Mega Evolved on turn 1), weather, terrain, the rooms, Gravity, screens, Tailwind, Safeguard, and in Doubles the
// attacker's Helping Hand partner and the target's Friend Guard partner. The field the app sets lasts through every use (the
// count's terms). The target uses Splash (Protect on turn 1 when its side protects). Run its users from the repo root.
import * as sim from "../../../showdown/sim/index.ts";
import { State } from "../../../showdown/sim/state.ts";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions } from "@/app/lib/battle/types";
const { Battle } = sim as any;

export type Game = "champions" | "scarlet_violet" | "sword_shield" | "ultra_sun_ultra_moon";
const FORMAT: Record<Game, { singles: string; doubles: string }> = {
  champions: { singles: "gen9championscustomgame", doubles: "gen9championsdoublescustomgame" },
  scarlet_violet: { singles: "gen9customgame", doubles: "gen9doublescustomgame" },
  sword_shield: { singles: "gen8customgame", doubles: "gen8doublescustomgame" },
  ultra_sun_ultra_moon: { singles: "gen7customgame", doubles: "gen7doublescustomgame" },
};
type Stats = Record<"hp" | "atk" | "def" | "spa" | "spd" | "spe", number>;
export type FMon = {
  species: string; ability: string; item: string; nature: string; level: number; evs: Stats; ivs: Stats; gender?: string;
  hp?: number; status?: string; boosts?: Partial<Record<"atk" | "def" | "spa" | "spd" | "spe", number>>;
  teraType?: string; choice?: "terastallize" | "dynamax" | "mega";
};
export type FSpec = {
  id: string; game: Game; move: string; a: FMon; d: FMon;
  /** Doubles with partners (the attacker's Helping Hand, the target's Friend Guard); otherwise a Singles battle. */
  partners?: { helpingHand: boolean; friendGuard: boolean };
  weather?: string; terrain?: string; pseudo?: string[];
  defSide?: string[]; attSide?: string[];
  critical?: boolean; protect?: boolean;
};

class Chooser {
  trail: number[] = []; sizes: number[] = []; weight = 1;
  constructor(readonly prefix: number[], readonly mode: "all" | "lowest" | "highest") {}
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
const inStack = (name: string) => (new Error().stack ?? "").includes(name);
function factorial(k: number) { let f = 1; for (let i = 2; i <= k; i++) f *= i; return f; }
function permute(list: unknown[], start: number, end: number, idx: number) {
  const pool = list.slice(start, end); const out: unknown[] = [];
  for (let k = pool.length; k > 0; k--) { const f = factorial(k - 1); const j = Math.floor(idx / f); idx %= f; out.push(pool.splice(j, 1)[0]); }
  list.splice(start, end - start, ...out);
}

function install(b: any, ch: Chooser, s: FSpec) {
  b.randomizer = function (base: number) {
    const outs = Array.from({ length: 16 }, (_, i) => this.trunc(this.trunc(base * (85 + i)) / 100));
    if (ch.mode === "lowest") return outs[0];
    if (ch.mode === "highest") return outs[15];
    const values = [...new Set(outs)];
    return values[ch.pick(values.map((v) => outs.filter((o) => o === v).length / 16))];
  };
  b.random = function (m?: number, n?: number) {
    if (m === undefined) throw new Error("random() without a range");
    if (m === 100 && n === undefined) return 99;
    const [lo, hi] = n === undefined ? [0, m] : [m, n];
    if (hi - lo <= 1) return lo;
    if (!inStack("hitStepMoveHitLoop")) return lo;
    if (ch.mode !== "all") { const fewest = n === undefined ? hi - 1 : lo, most = n === undefined ? lo : hi - 1; return ch.mode === "lowest" ? fewest : most; }
    const size = hi - lo;
    return lo + ch.pick(Array(size).fill(1 / size));
  };
  b.randomChance = function (n: number, d: number) {
    if (this.forceRandomChance !== null && this.forceRandomChance !== undefined) return this.forceRandomChance;
    if (n <= 0) return false;
    if (n >= d) return true;
    // The row's field "Critical hit": every hit of the attacker's is critical (getDamage's critical roll).
    if (s.critical && inStack("getDamage")) return true;
    if (d === 100 && (inStack("hitStepAccuracy") || inStack("hitStepMoveHitLoop"))) return true;
    return false;
  };
  b.sample = function (items: readonly unknown[]) {
    if (items.length === 1) return items[0];
    if (ch.mode !== "all" && items.every((x) => typeof x === "number")) { const nums = items as number[]; return ch.mode === "lowest" ? Math.min(...nums) : Math.max(...nums); }
    return items[ch.pick(Array(items.length).fill(1 / items.length))];
  };
  b.prng.shuffle = function (list: unknown[], start = 0, end = list.length) {
    const k = end - start; if (k < 2) return;
    // With partners (Doubles), the tie orders among four Pokémon (handlers too) multiply the walk; the partners only Splash or
    // use Helping Hand (+5 priority), so they keep their order there.
    if (process.env.UORACLE_TIES === "fixed" || s.partners) return;
    const perms = factorial(k);
    permute(list, start, end, ch.pick(Array(perms).fill(1 / perms)));
  };
}

function snapshot(b: any): string {
  const state = State.serializeBattle(b);
  state.log = []; state.sentLogPos = 0; state.lastMoveLine = -1; state.inputLog = []; state.messageLog = []; state.hints = [];
  for (const side of state.sides) for (const p of side.pokemon) {
    p.lastDamage = 0;
    if (p.lastMove && typeof p.lastMove === "object") p.lastMove.totalDamage = 0;
    if (p.lastMoveUsed && typeof p.lastMoveUsed === "object") p.lastMoveUsed.totalDamage = 0;
    for (const hit of p.attackedBy ?? []) { hit.damage = 0; hit.damageValue = 0; }
  }
  return JSON.stringify(state);
}

const ZERO: Stats = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const BENCH = { name: "Bench", species: "Snorlax", ability: "Thick Fat", item: "", moves: ["Splash"], nature: "Serious", evs: ZERO, ivs: { ...ZERO, hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 50, happiness: 255 };
const setOf = (m: FMon, moves: string[], name: string) => ({
  name, species: m.species, gender: m.gender ?? "", item: m.item, ability: m.ability, moves, nature: m.nature, evs: m.evs, ivs: m.ivs, level: m.level, happiness: 255,
  ...(m.teraType ? { teraType: m.teraType } : {}),
});

/** Where the attacker and the target are (Singles: p1a and p2a; Doubles with partners: p1b and p2a). */
const attackerOf = (b: any, s: FSpec) => b.p1.active[s.partners ? 1 : 0];
const targetOf = (b: any) => b.p2.active[0];

export function prepare(s: FSpec) {
  const b = new Battle({ formatid: s.partners ? FORMAT[s.game].doubles : FORMAT[s.game].singles, seed: [1, 2, 3, 4] });
  const helper = { ...BENCH, name: "Helper", moves: [s.partners?.helpingHand ? "Helping Hand" : "Splash"] };
  const guard = { ...BENCH, name: "Guard", ability: s.partners?.friendGuard ? "Friend Guard" : "Thick Fat" };
  // The target has the move too (a transformed Imposter attacker copies its moves), and the attacker Splash (an Imposter target copies its).
  // Both have three moves: a transformed Pokémon keeps its own move count (sim/state.ts deserializePokemon matches the slots by index).
  const attacker = setOf(s.a, [s.move, "Splash", "Protect"], "Attacker"), target = setOf(s.d, ["Splash", "Protect", s.move], "Target");
  b.setPlayer("p1", { team: s.partners ? [helper, attacker, BENCH] : [attacker, BENCH] });
  b.setPlayer("p2", { team: s.partners ? [target, guard, BENCH] : [target, BENCH] });
  if (b.requestState === "teampreview") b.makeChoices(s.partners ? "team 123" : "team 12", s.partners ? "team 123" : "team 12");
  const src = attackerOf(b, s), tgt = targetOf(b);
  const warnings: string[] = [];
  for (const [p, m] of [[src, s.a], [tgt, s.d]] as const) {
    if (m.hp !== undefined) p.sethp(m.hp);
    if (m.status) p.setStatus(m.status, null, null, true);
    // The build's stages are the user's; the entry effects (Intimidate, Download...) come on top, as the app's settle adds them.
    for (const stat of ["atk", "def", "spa", "spd", "spe"] as const) p.boosts[stat] = Math.max(-6, Math.min(6, p.boosts[stat] + (m.boosts?.[stat] ?? 0)));
  }
  if (s.weather) b.field.setWeather(s.weather, "debug");
  if (s.terrain) b.field.setTerrain(s.terrain, "debug");
  for (const id of s.pseudo ?? []) b.field.addPseudoWeather(id, "debug");
  for (const id of s.defSide ?? []) b.p2.addSideCondition(id, "debug");
  for (const id of s.attSide ?? []) b.p1.addSideCondition(id, "debug");
  return { b, warnings, srcMax: src.maxhp, tgtMax: tgt.maxhp, tgtStart: tgt.hp, srcStart: src.hp };
}

type TurnOut = { json: string | null; ko: boolean; faint: boolean; afterMove: { tgt: number; src: number } | null; moveStart: number | null; damage: unknown[] };

function runTurn(json: string, s: FSpec, ch: Chooser, turn: number): TurnOut {
  const b = State.deserializeBattle(json);
  install(b, ch, s);
  const f = b.field;
  if (f.weather && f.weatherState?.duration) f.weatherState.duration = 99;
  if (f.terrain && f.terrainState?.duration) f.terrainState.duration = 99;
  for (const id of Object.keys(f.pseudoWeather ?? {})) if (f.pseudoWeather[id].duration) f.pseudoWeather[id].duration = 99;
  for (const side of [b.p1, b.p2]) for (const id of Object.keys(side.sideConditions ?? {})) if (side.sideConditions[id].duration) side.sideConditions[id].duration = 99;
  let afterMove: TurnOut["afterMove"] = null;
  let moveStart: number | null = null;
  const damage: unknown[] = [];
  const getDamage = b.actions.getDamage;
  b.actions.getDamage = function (source: any, target: any, ...rest: unknown[]) {
    const dealt = getDamage.call(this, source, target, ...rest);
    // A secondary effect runs its own moveHit, whose getDamage (no base power) returns undefined: only the hit counts.
    if (source === attackerOf(b, s) && target === targetOf(b) && dealt !== undefined) damage.push(dealt);
    return dealt;
  };
  const ra = b.runAction;
  b.runAction = function (action: any) {
    if (action.choice === "move" && action.pokemon === attackerOf(this, s) && moveStart === null) moveStart = targetOf(this).hp;
    if (action.choice === "residual" && !afterMove) afterMove = { tgt: targetOf(this).hp, src: attackerOf(this, s).hp };
    return ra.call(this, action);
  };
  const [p1, p2] = choices(b, s, turn);
  if (!b.p1.choose(p1)) throw new Error(`p1 choice ${p1}: ${b.p1.choice.error}`);
  if (!b.p2.choose(p2)) throw new Error(`p2 choice ${p2}: ${b.p2.choice.error}`);
  b.commitChoices();
  const s2 = attackerOf(b, s), t2 = targetOf(b);
  const ko = !t2 || t2.name !== "Target" || !t2.hp || t2.fainted, faint = !s2 || s2.name !== "Attacker" || !s2.hp || s2.fainted;
  return { json: ko || faint || b.ended ? null : snapshot(b), ko, faint, afterMove, moveStart, damage };
}

export type FOracle = {
  ko: number[]; faintFirst: number[]; both: number[]; open: number; turns: number;
  first: { dist: [number, number][]; min: number; max: number; average: number; koChance: number };
  /** The first use's getDamage results (uncapped) with their chances: "none" when the move dealt none (it failed or was blocked). */
  damage: [string, number][];
  lowest: { ko: number | null; faint: number | null; firstHP: number };
  highest: { ko: number | null; faint: number | null; firstHP: number };
  srcMax: number; tgtMax: number; tgtStart: number; srcStart: number; states: number; runs: number; warnings: string[];
  /** The first turn's battle log (the first decision everywhere), for the facts. */
  log: string[];
};

export function flingOracle(s: FSpec, turns: number, maxRuns = 400_000): FOracle {
  const { b, warnings, srcMax, tgtMax, tgtStart, srcStart } = prepare(s);
  let frontier = new Map<string, number>([[snapshot(b), 1]]);
  const ko: number[] = [], faintFirst: number[] = [], both: number[] = [];
  let cumKO = 0, runs = 0, states = 0;
  const firstDist = new Map<number, number>();
  const moveStarts = new Set<number>();
  const damage = new Map<string, number>();
  for (let turn = 1; turn <= turns && frontier.size; turn++) {
    const next = new Map<string, number>();
    let k = 0, f = 0, bo = 0;
    for (const [json, mass] of frontier) {
      states++;
      let prefix: number[] | null = [];
      while (prefix) {
        const ch = new Chooser(prefix, "all");
        const out = runTurn(json, s, ch, turn);
        if (++runs > maxRuns) throw new Error(`over ${maxRuns} runs`);
        const w = mass * ch.weight;
        if (turn === 1 && out.afterMove) firstDist.set(out.afterMove.tgt, (firstDist.get(out.afterMove.tgt) ?? 0) + w);
        if (turn === 1 && out.moveStart !== null) moveStarts.add(out.moveStart);
        if (turn === 1) { const key = out.damage.length ? out.damage.map(String).join("+") : "none"; damage.set(key, (damage.get(key) ?? 0) + w); }
        if (out.ko) { k += w; if (out.faint) bo += w; }
        else if (out.faint) f += w;
        else if (out.json) next.set(out.json, (next.get(out.json) ?? 0) + w);
        prefix = ch.next();
      }
    }
    cumKO += k;
    ko.push(cumKO); faintFirst.push(f); both.push(bo);
    frontier = next;
  }
  const open = [...frontier.values()].reduce((a, c) => a + c, 0);
  const path = (mode: "lowest" | "highest") => {
    let json: string | null = snapshot(prepare(s).b);
    const res = { ko: null as number | null, faint: null as number | null, firstHP: NaN };
    for (let turn = 1; turn <= turns && json; turn++) {
      const out = runTurn(json, s, new Chooser([], mode), turn);
      if (turn === 1) res.firstHP = out.afterMove?.tgt ?? NaN;
      if (out.ko && res.ko === null) res.ko = turn;
      if (out.faint && res.faint === null) res.faint = turn;
      json = out.json;
    }
    return res;
  };
  let log: string[] = [];
  {
    const bb = State.deserializeBattle(snapshot(prepare(s).b));
    const at = bb.log.length;
    install(bb, new Chooser([], "lowest"), s);
    try { runTurnOn(bb, s); } catch { /* the log so far */ }
    log = (bb.log.slice(at) as string[]).filter((line) => /^\|(move|-damage|-heal|-status|-enditem|-item|-fail|-activate|-immune|-enditem|cant|-boost|-unboost|-clearnegativeboost|-start)\|/.test(line));
  }
  const dist = [...firstDist].sort((a, c) => a[0] - c[0]);
  const total = dist.reduce((a, [, p]) => a + p, 0);
  return {
    ko, faintFirst, both, open, turns: ko.length,
    damage: [...damage].sort((x, y) => x[0].localeCompare(y[0], undefined, { numeric: true })),
    first: { dist, min: dist[0]?.[0] ?? NaN, max: dist[dist.length - 1]?.[0] ?? NaN, average: dist.reduce((a, [h, p]) => a + h * p, 0) / total, koChance: firstDist.get(0) ?? 0 },
    lowest: path("lowest"), highest: path("highest"), srcMax, tgtMax, tgtStart: moveStarts.size === 1 ? [...moveStarts][0] : tgtStart, srcStart, states, runs,
    warnings: [...warnings, ...(moveStarts.size > 1 ? [`move starts ${[...moveStarts]}`] : [])], log,
  };
}

function runTurnOn(b: any, s: FSpec) {
  const [p1, p2] = choices(b, s, 1);
  b.p1.choose(p1); b.p2.choose(p2); b.commitChoices();
}

/** This turn's choices: the attacker's move and the target's Splash (Protect on turn 1 when its side protects), by move slot. */
function choices(b: any, s: FSpec, turn: number): [string, string] {
  const slot = (p: any, id: string) => p.moveSlots.findIndex((m: any) => m.id === id) + 1;
  const mech = (m: FMon) => (turn === 1 && m.choice ? ` ${m.choice}` : "");
  const src = attackerOf(b, s), tgt = targetOf(b);
  const move = slot(src, s.move.toLowerCase().replace(/[^a-z0-9]/g, ""));
  const own = `move ${s.protect && turn === 1 && slot(tgt, "protect") ? slot(tgt, "protect") : slot(tgt, "splash")}${mech(s.d)}`;
  const p1 = s.partners ? `move 1${s.partners.helpingHand ? " -2" : ""}, move ${move} 1${mech(s.a)}` : `move ${move}${mech(s.a)}`;
  return [p1, s.partners ? `${own}, move 1` : own];
}

// ---------- the app's builds and conditions as an FSpec ----------
const WEATHER: Record<string, string> = { Sun: "sunnyday", Rain: "raindance", Sand: "sandstorm", Snow: "snowscape", Hail: "hail", "Harsh Sunshine": "desolateland", "Heavy Rain": "primordialsea", "Strong Winds": "deltastream" };
const TERRAIN: Record<string, string> = { Electric: "electricterrain", Grassy: "grassyterrain", Misty: "mistyterrain", Psychic: "psychicterrain" };

export function fmonOf(build: BattleBuild, runtime: BattleRuntime): FMon {
  const species = runtime.speciesById.get(build.speciesId)!;
  const mega = species.name.includes("-Mega");
  // A Mega form Mega Evolves on turn 1 from the form its stone names (megaTargets: Floette-Eternal for Floette-Mega).
  const from = mega ? runtime.itemsById.get(build.itemId)?.megaTargets.find((target) => target.formId === build.speciesId)?.baseSpeciesId ?? species.baseSpecies : null;
  const base = from ? runtime.speciesById.get(from)?.name ?? species.name : species.name;
  const native = build.native;
  const evs: Stats = build.game === "champions" ? { ...ZERO, ...(build.points ?? {}) } as Stats : { ...ZERO, ...(native?.evs ?? {}) } as Stats;
  const ivs: Stats = build.game === "champions" ? { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 } : { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31, ...(native?.ivs ?? {}) } as Stats;
  return {
    species: base, ability: runtime.abilitiesById.get(build.abilityId)?.name ?? build.abilityId, item: build.itemId ? runtime.itemsById.get(build.itemId)?.name ?? build.itemId : "",
    nature: build.nature, level: build.game === "champions" ? 50 : native?.level ?? 50, evs, ivs,
    ...(build.currentHP !== null && build.currentHP !== undefined ? { hp: build.currentHP } : {}),
    ...(build.status ? { status: build.status } : {}),
    boosts: { ...build.boosts },
    ...(build.mechanic === "tera" && build.configuration?.teraType ? { teraType: build.configuration.teraType, choice: "terastallize" as const } : {}),
    ...(build.mechanic === "dynamax" ? { choice: "dynamax" as const } : {}),
    ...(mega ? { choice: "mega" as const } : {}),
    ...(build.configuration?.gender ? { gender: build.configuration.gender } : {}),
  };
}

export function fspecOf(id: string, game: Game, move: string, attacker: BattleBuild, defender: BattleBuild, field: BattleConditions, runtime: BattleRuntime): FSpec {
  const doubles = field.gameType === "Doubles";
  // A Doubles row is a Doubles battle (screens are 2732/4096 there), with the partners the row names.
  const partners = doubles ? { helpingHand: !!field.attackerSide.helpingHand, friendGuard: !!field.defenderSide.friendGuard } : undefined;
  const pseudo = [field.gravity && "gravity", field.trickRoom && "trickroom", field.wonderRoom && "wonderroom", field.magicRoom && "magicroom"].filter(Boolean) as string[];
  const defSide = [field.defenderSide.reflect && "reflect", field.defenderSide.lightScreen && "lightscreen", field.defenderSide.auroraVeil && "auroraveil",
    field.defenderSide.tailwind && "tailwind", field.defenderSide.safeguard && "safeguard"].filter(Boolean) as string[];
  const attSide = [field.attackerSide.tailwind && "tailwind"].filter(Boolean) as string[];
  return {
    id, game, move, a: fmonOf(attacker, runtime), d: fmonOf(defender, runtime), ...(partners ? { partners } : {}),
    ...(field.weather ? { weather: WEATHER[field.weather] } : {}), ...(field.terrain ? { terrain: TERRAIN[field.terrain] } : {}),
    pseudo, defSide, attSide, critical: !!field.critical, protect: !!field.defenderSide.protect,
  };
}

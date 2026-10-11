// ADDENDUM probe harness (Ally Switch, Trick/Switcheroo/Bestow, hits into a Substitute): status-sim.ts's exact enumeration
// (every random decision by decision-prefix replay, the oracle's forcing: every move hits, chances below 100% fail unless
// enumerated, crits only when certain) plus an `inspect` hook that reads the battle when the residual action is picked
// ("after the moves") and once the turn has ended, tallied by mass. Run from the repo root:
//   npx --no-install tsx scripts/.cache/calc-audit/status-eot/design/addendum-probes-1.ts > .../addendum-probes-1.out
import * as sim from "../../showdown/sim/index.ts";
import { State } from "../../showdown/sim/state.ts";
import { FORMAT, type Mon, type Probe, CHANCE_EFFECTS } from "./status-sim";

const { Battle } = sim as any;
const ZERO = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const IV31 = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const setOf = (m: Mon, name: string) => ({
  name, species: m.species, gender: m.gender ?? "", item: m.item ?? "", ability: m.ability ?? "", moves: m.moves?.length ? m.moves : ["Splash"],
  nature: m.nature ?? "Serious", evs: { ...ZERO, ...m.evs }, ivs: { ...IV31, ...m.ivs }, level: m.level ?? 50, teraType: m.teraType, happiness: 255,
});
const BENCH: Mon = { species: "Snorlax", ability: "Thick Fat", moves: ["Splash"] };
CHANCE_EFFECTS.add("allyswitch");

export type AProbe = Probe & {
  /** Read at the residual pick of each turn and at each turn's end; the strings are tallied with their mass. */
  inspect?: (b: any) => string;
  /** Extra randomChance effect ids to enumerate (besides status-sim's CHANCE_EFFECTS). */
  chances?: string[];
};

class Chooser {
  trail: number[] = []; sizes: number[] = []; weight = 1; kinds: string[] = [];
  constructor(readonly prefix: number[]) {}
  pick(kind: string, weights: number[]): number {
    if (weights.length === 1) return 0;
    const depth = this.trail.length;
    const i = depth < this.prefix.length ? this.prefix[depth] : 0;
    this.trail.push(i); this.sizes.push(weights.length); this.weight *= weights[i]; this.kinds.push(kind);
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

function install(b: any, ch: Chooser, probe: AProbe) {
  const extra = new Set(probe.chances ?? []);
  b.randomizer = function (base: number) {
    const outs = Array.from({ length: 16 }, (_, i) => this.trunc(this.trunc(base * (85 + i)) / 100));
    if ((probe.rolls ?? "lowest") === "lowest") return outs[0];
    if (probe.rolls === "highest") return outs[15];
    const values = [...new Set(outs)];
    return values[ch.pick("roll", values.map((v) => outs.filter((o) => o === v).length / 16))];
  };
  b.random = function (m?: number, n?: number) {
    if (m === undefined) throw new Error("random() without a range");
    if (m === 100 && n === undefined) return 99;
    const [lo, hi] = n === undefined ? [0, m] : [m, n];
    if (hi - lo <= 1) return lo;
    return lo + ch.pick(`random(${lo},${hi})`, Array(hi - lo).fill(1 / (hi - lo)));
  };
  b.randomChance = function (n: number, d: number) {
    if (this.forceRandomChance !== null && this.forceRandomChance !== undefined) return this.forceRandomChance;
    if (n <= 0) return false;
    if (n >= d) return true;
    const id = this.effect?.id;
    if (CHANCE_EFFECTS.has(id) || extra.has(id)) return ch.pick(`chance:${id}`, [1 - n / d, n / d]) === 1;
    // Every move hits, a multiaccuracy move's later hits too (the oracle's forcing, 2v2/verify/sim-dfs.ts:234).
    if (d === 100 && inStack("hitStepAccuracy", "hitStepMoveHitLoop")) return true;
    return false;
  };
  b.sample = function (items: readonly unknown[]) {
    if (items.length === 1) return items[0];
    return items[ch.pick(`sample(${items.length})`, Array(items.length).fill(1 / items.length))];
  };
  b.prng.shuffle = function (list: unknown[], start = 0, end = list.length) {
    const k = end - start;
    if (k < 2) return;
    permute(list, start, end, ch.pick(`tie${k}`, Array(factorial(k)).fill(1 / factorial(k))));
  };
}

export function start(probe: AProbe) {
  const b = new Battle({ formatid: FORMAT[probe.game], seed: [1, 2, 3, 4] });
  b.setPlayer("p1", { team: [setOf(probe.mons[0], probe.mons[0].species), setOf(probe.mons[1], probe.mons[1].species), setOf(BENCH, "Bench")] });
  b.setPlayer("p2", { team: [setOf(probe.mons[2], probe.mons[2].species), setOf(probe.mons[3], probe.mons[3].species), setOf(BENCH, "Bench")] });
  if (b.requestState === "teampreview") b.makeChoices("team 123", "team 123");
  probe.setup?.(b);
  return b;
}

const IDS = ["p1a", "p1b", "p2a", "p2b"] as const;
const monAt = (b: any, id: (typeof IDS)[number]) => b[id.slice(0, 2)].active[id[2] === "a" ? 0 : 1];
const hpText = (p: any) => (p.fainted || !p.hp ? 0 : p.hp);

export type AResult = {
  runs: number; start: string;
  afterMoves: Map<string, number>[]; end: Map<string, number>[]; inspected: Map<string, number>[]; lines: Map<string, number>;
};

/** Every outcome of the probe's turns, exactly; HP per position (`p1a Name hp`) after the moves and at each turn's end. */
export function enumerate(probe: AProbe): AResult {
  const b0 = start(probe);
  const json = JSON.stringify(State.serializeBattle(b0));
  const snapOf = (b: any) => IDS.map((id) => `${id} ${monAt(b, id).name} ${hpText(monAt(b, id))}/${monAt(b, id).maxhp}`).join(" | ");
  const res: AResult = { runs: 0, start: snapOf(b0), afterMoves: [], end: [], inspected: [], lines: new Map() };
  let prefix: number[] | null = [];
  while (prefix) {
    const ch = new Chooser(prefix);
    const b = State.deserializeBattle(json);
    install(b, ch, probe);
    const after: string[] = [], end: string[] = [], seen: string[] = [];
    const ra = b.runAction;
    b.runAction = function (action: any) {
      if (action.choice === "residual") { after.push(snapOf(b)); if (probe.inspect) seen.push(`after moves: ${probe.inspect(b)}`); }
      return ra.call(this, action);
    };
    const logStart = b.log.length;
    for (const [c1, c2] of probe.turns) {
      if (b.ended) break;
      b.makeChoices(c1, c2);
      end.push(snapOf(b));
      if (probe.inspect) seen.push(`end of turn: ${probe.inspect(b)}`);
      if (b.requestState === "switch") break;
    }
    const lines = probe.lines ? (b.log.slice(logStart) as string[]).filter((l) => probe.lines!.test(l)) : [];
    const w = ch.weight;
    const tally = (list: Map<string, number>[], values: string[]) => values.forEach((v, t) => { const m = list[t] ??= new Map(); m.set(v, (m.get(v) ?? 0) + w); });
    tally(res.afterMoves, after); tally(res.end, end); tally(res.inspected, seen);
    for (const l of new Set(lines)) res.lines.set(l, (res.lines.get(l) ?? 0) + w);
    if (++res.runs > (probe.maxRuns ?? 50_000)) throw new Error("too many runs");
    prefix = ch.next();
  }
  return res;
}

const show = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1]).map(([k, w]) => `     ${+w.toFixed(6)}  ${k}`).join("\n");
export function report(title: string, r: AResult, opts: { lines?: boolean } = {}) {
  console.log(`\n### ${title}  (${r.runs} runs)`);
  console.log(`  start: ${r.start}`);
  r.afterMoves.forEach((m, t) => console.log(`  turn ${t + 1} after moves:\n${show(m)}`));
  r.end.forEach((m, t) => console.log(`  turn ${t + 1} end:\n${show(m)}`));
  r.inspected.forEach((m, t) => console.log(`  inspect #${t + 1}:\n${show(m)}`));
  if (opts.lines !== false) console.log(`  lines:\n${show(r.lines)}`);
}

/** Small readers for `inspect`. */
export const sub = (p: any) => (p.volatiles?.substitute ? `sub ${p.volatiles.substitute.hp}` : "no sub");
export const item = (p: any) => `${p.name}:${p.item || "-"}`;
export const at = (b: any, id: (typeof IDS)[number]) => monAt(b, id);

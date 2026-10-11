// FAMILY 4 (narrow guards) probe harness on pinned Showdown c23d2e94 (the runnable copy scripts/.cache/calc-audit/showdown).
// status-eot/design/status-sim.ts's exact enumeration (every random decision by decision-prefix replay; every move hits, no
// critical hit unless certain, added effects below 100% fail; damage rolls fixed or enumerated; randomChance of the listed
// effects, random(), sample() and speed-tie shuffles enumerated), extended for this family: a bench of any size per side,
// mid-turn switch requests answered by a callback (U-turn, Eject Pack, Eject Button, Emergency Exit...), extra chance
// effects, and an `inspect` hook whose string is tallied by mass at the residual pick and at each turn's end.
// Run probes from the repo root: npx --no-install tsx scripts/.cache/calc-audit/status2/design/guards-probes-1.ts
import * as sim from "../../showdown/sim/index.ts";
import { State } from "../../showdown/sim/state.ts";

const { Battle, Dex } = sim as any;
export { Dex };
export type Game = "sv" | "swsh" | "usum" | "champions";
export const FORMAT: Record<Game, string> = {
  sv: "gen9doublescustomgame", swsh: "gen8doublescustomgame", usum: "gen7doublescustomgame", champions: "gen9championsdoublescustomgame",
};
export type Mon = {
  species: string; ability?: string; item?: string; moves?: string[]; nature?: string; level?: number; gender?: "M" | "F" | "";
  evs?: Partial<Record<"hp" | "atk" | "def" | "spa" | "spd" | "spe", number>>; ivs?: Partial<Record<"hp" | "atk" | "def" | "spa" | "spd" | "spe", number>>;
  teraType?: string; name?: string;
};
const ZERO = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const IV31 = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const setOf = (m: Mon) => ({
  name: m.name ?? m.species, species: m.species, gender: m.gender ?? "", item: m.item ?? "", ability: m.ability ?? "", moves: m.moves?.length ? m.moves : ["Splash"],
  nature: m.nature ?? "Serious", evs: { ...ZERO, ...m.evs }, ivs: { ...IV31, ...m.ivs }, level: m.level ?? 50, teraType: m.teraType, happiness: 255,
});
export const BENCH: Mon = { species: "Snorlax", ability: "Thick Fat", moves: ["Splash"], name: "Bench" };

export type Probe = {
  game: Game;
  /** p1a, p1b, p2a, p2b. */
  mons: [Mon, Mon, Mon, Mon];
  /** Bench per side (default: one Snorlax named Bench). */
  bench?: { p1?: Mon[]; p2?: Mon[] };
  /** One [p1 choice, p2 choice] per turn. */
  turns: [string, string][];
  setup?: (b: any) => void;
  rolls?: "lowest" | "highest" | "all";
  lines?: RegExp;
  /** Answers a mid-turn switch request: [p1 choice, p2 choice] ("" for a side with none). Default: the first bench Pokémon. */
  answer?: (b: any) => [string, string];
  /** randomChance effect ids enumerated besides the defaults. */
  chances?: string[];
  /** randomChance effect ids forced true (e.g. "confused" for a confusion self-hit). */
  force?: string[];
  /** A string read at the residual pick and at each turn's end, tallied with its mass. */
  inspect?: (b: any) => string;
  maxRuns?: number;
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
export const CHANCE_EFFECTS = new Set(["par", "quickclaw", "quickdraw", "frz", "attract", "shedskin", "healer", "harvest", "allyswitch", "stall", "focusband"]);

function install(b: any, ch: Chooser, probe: Probe) {
  const extra = new Set(probe.chances ?? []), forced = new Set(probe.force ?? []);
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
    if (forced.has(id)) return true;
    if (CHANCE_EFFECTS.has(id) || extra.has(id)) return ch.pick(`chance:${id}`, [1 - n / d, n / d]) === 1;
    if (d === 100 && inStack("hitStepAccuracy")) return true;
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

const IDS = ["p1a", "p1b", "p2a", "p2b"] as const;
export const monAt = (b: any, id: (typeof IDS)[number]) => b[id.slice(0, 2)].active[id[2] === "a" ? 0 : 1];
const hpText = (p: any) => (!p || p.fainted || !p.hp ? 0 : p.hp);
const label = (b: any, id: (typeof IDS)[number]) => `${id} ${monAt(b, id)?.name ?? "-"}`;

export function start(probe: Probe) {
  const b = new Battle({ formatid: FORMAT[probe.game], seed: [1, 2, 3, 4] });
  const p1 = [probe.mons[0], probe.mons[1], ...(probe.bench?.p1 ?? [BENCH])];
  const p2 = [probe.mons[2], probe.mons[3], ...(probe.bench?.p2 ?? [BENCH])];
  b.setPlayer("p1", { team: p1.map(setOf) });
  b.setPlayer("p2", { team: p2.map(setOf) });
  const order = (n: number) => `team ${Array.from({ length: n }, (_, i) => i + 1).join("")}`;
  if (b.requestState === "teampreview") b.makeChoices(order(p1.length), order(p2.length));
  probe.setup?.(b);
  return b;
}

/** The first bench Pokémon for every flagged slot (switch request), "" for a side with none. */
export function firstBench(b: any): [string, string] {
  const side = (s: any) => {
    const req = s.activeRequest;
    if (!req || !req.forceSwitch) return "";
    const used = new Set<number>();
    return req.forceSwitch.map((flag: boolean) => {
      if (!flag) return "pass";
      const i = s.pokemon.findIndex((p: any, idx: number) => idx >= s.active.length && !p.fainted && !used.has(idx));
      if (i < 0) return "pass";
      used.add(i);
      return `switch ${i + 1}`;
    }).join(", ");
  };
  return [side(b.p1), side(b.p2)];
}

export type Outcome = { weight: number; lines: string[]; kinds: string[]; inspect: string[] };
export type Result = { runs: number; afterMoves: Map<string, Map<number, number>>[]; end: Map<string, Map<number, number>>[]; lines: Map<string, number>; inspect: Map<string, number>; outcomes: Outcome[] };

export function enumerate(probe: Probe): Result {
  const b0 = start(probe);
  const json = JSON.stringify(State.serializeBattle(b0));
  const res: Result = { runs: 0, afterMoves: probe.turns.map(() => new Map()), end: probe.turns.map(() => new Map()), lines: new Map(), inspect: new Map(), outcomes: [] };
  let prefix: number[] | null = [];
  while (prefix) {
    const ch = new Chooser(prefix);
    const b = State.deserializeBattle(json);
    install(b, ch, probe);
    const snap = () => Object.fromEntries(IDS.map((id) => [label(b, id), hpText(monAt(b, id))]));
    const after: Record<string, number>[] = [], end: Record<string, number>[] = [], seen: string[] = [];
    const ra = b.runAction;
    b.runAction = function (action: any) {
      if (action.choice === "residual") { after.push(snap()); if (probe.inspect) seen.push(`T${b.turn} moves: ${probe.inspect(b)}`); }
      return ra.call(this, action);
    };
    const logStart = b.log.length;
    for (const [c1, c2] of probe.turns) {
      if (b.ended) break;
      b.makeChoices(c1, c2);
      for (let guard = 0; b.requestState === "switch" && b.midTurn && !b.ended && guard < 6; guard++) {
        const [a1, a2] = (probe.answer ?? firstBench)(b);
        b.makeChoices(a1, a2);
      }
      end.push(snap());
      if (probe.inspect) seen.push(`T${b.turn - 1} end: ${probe.inspect(b)}`);
      if (b.requestState === "switch") break;
    }
    const lines = probe.lines ? (b.log.slice(logStart) as string[]).filter((l) => probe.lines!.test(l)) : [];
    const w = ch.weight;
    res.outcomes.push({ weight: w, lines, kinds: ch.kinds, inspect: seen });
    const tally = (into: Map<string, Map<number, number>>[], list: Record<string, number>[]) => list.forEach((hp, t) => {
      for (const [k, v] of Object.entries(hp)) { const m = into[t].get(k) ?? new Map(); into[t].set(k, m); m.set(v, (m.get(v) ?? 0) + w); }
    });
    tally(res.afterMoves, after); tally(res.end, end);
    for (const l of new Set(lines)) res.lines.set(l, (res.lines.get(l) ?? 0) + w);
    for (const s of new Set(seen)) res.inspect.set(s, (res.inspect.get(s) ?? 0) + w);
    if (++res.runs > (probe.maxRuns ?? 20_000)) throw new Error("too many runs");
    prefix = ch.next();
  }
  return res;
}

const fmt = (m: Map<number, number>) => [...m].sort((a, b) => a[0] - b[0]).map(([hp, p]) => `${hp}:${+p.toFixed(6)}`).join(" ");
export function report(title: string, r: Result, opts: { lines?: boolean; outcomes?: boolean; hp?: boolean } = {}) {
  console.log(`\n### ${title}  (${r.runs} runs)`);
  if (opts.hp !== false) {
    r.afterMoves.forEach((t, i) => console.log(` turn ${i + 1} after moves:`, [...t].map(([k, m]) => `${k} [${fmt(m)}]`).join(" | ")));
    r.end.forEach((t, i) => console.log(` turn ${i + 1} end of turn:`, [...t].map(([k, m]) => `${k} [${fmt(m)}]`).join(" | ")));
  }
  for (const [s, w] of [...r.inspect].sort((a, b) => a[0].localeCompare(b[0]))) console.log(`   [${+w.toFixed(6)}] ${s}`);
  if (opts.lines !== false) for (const [l, w] of [...r.lines]) console.log(`   ${+w.toFixed(6)}  ${l}`);
  if (opts.outcomes) for (const o of r.outcomes) console.log(`   w=${+o.weight.toFixed(6)} [${o.kinds.join(",")}] :: ${o.lines.join(" ; ")}`);
}

/** The battle log of one run (first decision everywhere), filtered: for timing probes. */
export function trace(probe: Probe, keep: RegExp = /./): string[] {
  const b = start(probe);
  install(b, new Chooser([]), probe);
  const at = b.log.length;
  try {
    for (const [c1, c2] of probe.turns) {
      if (b.ended) break;
      b.makeChoices(c1, c2);
      for (let guard = 0; b.requestState === "switch" && b.midTurn && !b.ended && guard < 6; guard++) {
        const [a1, a2] = (probe.answer ?? firstBench)(b);
        b.log.push(`(answer ${a1} / ${a2})`);
        b.makeChoices(a1, a2);
      }
    }
  } catch (error) {
    b.log.push(`(ERROR ${(error as Error).message}; requestState ${b.requestState})`);
  }
  return (b.log.slice(at) as string[]).filter((l) => keep.test(l) || l.startsWith("(ERROR") || l.startsWith("|error"));
}
export const showTrace = (title: string, probe: Probe, keep?: RegExp) => {
  console.log(`\n== ${title}`);
  for (const line of trace(probe, keep)) console.log(`  ${line}`);
};

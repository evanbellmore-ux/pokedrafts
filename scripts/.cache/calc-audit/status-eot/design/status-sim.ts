// Design probe harness (status moves and end of turn): whole turns in pinned Showdown c23d2e94 (the runnable copy at
// scripts/.cache/calc-audit/showdown), every random decision enumerated exactly by decision-prefix replay (no merging), as
// the 2v2 oracle (2v2/verify/sim-dfs.ts) does, but the turn runs THROUGH the residual phase: HP is read both when the
// residual action is picked ("after the moves") and once the turn has ended ("end of turn"). The forcing is the oracle's:
// every move hits, no critical hit, added effects below 100% fail; random events that the app branches are enumerated:
// damage rolls (optionally fixed), full paralysis, confusion, infatuation, freeze thaw, Quick Claw, speed-tie shuffles
// (actions AND residual handlers), random(), sample() (sleep length, Acupressure, Moody, Pickup), and the end-of-turn
// chances Shed Skin 1/3, Healer 3/10, Harvest 1/2.
// Run probes from the repo root: npx --no-install tsx scripts/.cache/calc-audit/status-eot/design/status-probes.ts
import * as sim from "../../showdown/sim/index.ts";
import { State } from "../../showdown/sim/state.ts";

const { Battle } = sim as any;
export type Game = "sv" | "swsh" | "usum" | "champions";
export const FORMAT: Record<Game, string> = {
  sv: "gen9doublescustomgame", swsh: "gen8doublescustomgame", usum: "gen7doublescustomgame", champions: "gen9championsdoublescustomgame",
};
export type Mon = {
  species: string; ability?: string; item?: string; moves?: string[]; nature?: string; level?: number; gender?: "M" | "F" | "";
  evs?: Partial<Record<"hp" | "atk" | "def" | "spa" | "spd" | "spe", number>>; ivs?: Partial<Record<"hp" | "atk" | "def" | "spa" | "spd" | "spe", number>>; teraType?: string;
};
const ZERO = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const IV31 = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const setOf = (m: Mon, name: string) => ({
  name, species: m.species, gender: m.gender ?? "", item: m.item ?? "", ability: m.ability ?? "", moves: m.moves?.length ? m.moves : ["Splash"],
  nature: m.nature ?? "Serious", evs: { ...ZERO, ...m.evs }, ivs: { ...IV31, ...m.ivs }, level: m.level ?? 50, teraType: m.teraType, happiness: 255,
});
const BENCH: Mon = { species: "Snorlax", ability: "Thick Fat", moves: ["Splash"] };

export type Probe = {
  game: Game;
  /** p1a, p1b, p2a, p2b. */
  mons: [Mon, Mon, Mon, Mon];
  /** One [p1 choice, p2 choice] per turn, e.g. ["move 1 1, move 1 2", "move 1 1, move 1 1"]. */
  turns: [string, string][];
  /** Runs after team preview, before the first turn (HP, statuses, volatiles, field). */
  setup?: (b: any) => void;
  /** "lowest" / "highest": every damage roll at its lowest / highest; "all": rolls enumerated. Default "lowest". */
  rolls?: "lowest" | "highest" | "all";
  /** Log line patterns to tally (with their mass). */
  lines?: RegExp;
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
/** randomChance calls enumerated, by the effect running them (the rest fail unless certain: added effects below 100%). */
export const CHANCE_EFFECTS = new Set(["par", "quickclaw", "quickdraw", "confusion", "frz", "attract", "shedskin", "healer", "harvest", "allyswitch", "stall"]);

function install(b: any, ch: Chooser, rolls: Probe["rolls"]) {
  b.randomizer = function (base: number) {
    const outs = Array.from({ length: 16 }, (_, i) => this.trunc(this.trunc(base * (85 + i)) / 100));
    if ((rolls ?? "lowest") === "lowest") return outs[0];
    if (rolls === "highest") return outs[15];
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
    if (CHANCE_EFFECTS.has(id)) return ch.pick(`chance:${id}`, [1 - n / d, n / d]) === 1;
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
  // Critical hits: their randomChance fails unless certain (ratio stage 3+ from gen 7), as the oracle forces them.
}

const IDS = ["p1a", "p1b", "p2a", "p2b"] as const;
const monAt = (b: any, id: (typeof IDS)[number]) => b[id.slice(0, 2)].active[id[2] === "a" ? 0 : 1];
const hpText = (p: any) => (p.fainted || !p.hp ? 0 : p.hp);

export function start(probe: Probe) {
  const b = new Battle({ formatid: FORMAT[probe.game], seed: [1, 2, 3, 4] });
  b.setPlayer("p1", { team: [setOf(probe.mons[0], probe.mons[0].species), setOf(probe.mons[1], probe.mons[1].species), setOf(BENCH, "Bench")] });
  b.setPlayer("p2", { team: [setOf(probe.mons[2], probe.mons[2].species), setOf(probe.mons[3], probe.mons[3].species), setOf(BENCH, "Bench")] });
  if (b.requestState === "teampreview") b.makeChoices("team 123", "team 123");
  probe.setup?.(b);
  return b;
}

export type Outcome = { weight: number; afterMoves: Record<string, number>[]; end: Record<string, number>[]; lines: string[]; kinds: string[] };
export type Result = {
  runs: number; maxhp: Record<string, number>; start: Record<string, number>;
  /** Per turn: HP distribution after the moves and at the end of the turn, per Pokémon. */
  afterMoves: Record<string, Map<number, number>>[]; end: Record<string, Map<number, number>>[];
  lines: Map<string, number>; outcomes: Outcome[];
};

/** Every outcome of the probe's turns, exactly (decision-prefix replay from one serialized start). */
export function enumerate(probe: Probe): Result {
  const b0 = start(probe);
  const json = JSON.stringify(State.serializeBattle(b0));
  const maxhp = Object.fromEntries(IDS.map((id) => [`${id} ${monAt(b0, id).species.name}`, monAt(b0, id).maxhp]));
  const startHP = Object.fromEntries(IDS.map((id) => [`${id} ${monAt(b0, id).species.name}`, hpText(monAt(b0, id))]));
  const res: Result = { runs: 0, maxhp, start: startHP, afterMoves: probe.turns.map(() => ({})), end: probe.turns.map(() => ({})), lines: new Map(), outcomes: [] };
  let prefix: number[] | null = [];
  while (prefix) {
    const ch = new Chooser(prefix);
    const b = State.deserializeBattle(json);
    install(b, ch, probe.rolls);
    const snap = () => Object.fromEntries(IDS.map((id) => [`${id} ${monAt(b, id).species.name}`, hpText(monAt(b, id))]));
    const after: Record<string, number>[] = [], end: Record<string, number>[] = [];
    const ra = b.runAction;
    b.runAction = function (action: any) {
      if (action.choice === "residual") after.push(snap());
      return ra.call(this, action);
    };
    const logStart = b.log.length;
    for (const [c1, c2] of probe.turns) {
      if (b.ended) break;
      b.makeChoices(c1, c2);
      end.push(snap());
      if (b.requestState === "switch") break;
    }
    const lines = probe.lines ? (b.log.slice(logStart) as string[]).filter((l) => probe.lines!.test(l)) : [];
    const w = ch.weight;
    res.outcomes.push({ weight: w, afterMoves: after, end, lines, kinds: ch.kinds });
    after.forEach((hp, t) => { for (const [k, v] of Object.entries(hp)) { const m = res.afterMoves[t][k] ??= new Map(); m.set(v, (m.get(v) ?? 0) + w); } });
    end.forEach((hp, t) => { for (const [k, v] of Object.entries(hp)) { const m = res.end[t][k] ??= new Map(); m.set(v, (m.get(v) ?? 0) + w); } });
    for (const l of new Set(lines)) res.lines.set(l, (res.lines.get(l) ?? 0) + w);
    if (++res.runs > (probe.maxRuns ?? 50_000)) throw new Error("too many runs");
    prefix = ch.next();
  }
  return res;
}

const fmt = (m: Map<number, number>) => [...m].sort((a, b) => a[0] - b[0]).map(([hp, p]) => `${hp}:${+p.toFixed(6)}`).join(" ");
export function report(title: string, r: Result, opts: { lines?: boolean; outcomes?: boolean } = {}) {
  console.log(`\n### ${title}  (${r.runs} runs)`);
  console.log(" start:", Object.entries(r.start).map(([k, v]) => `${k} ${v}/${r.maxhp[k]}`).join(" | "));
  r.afterMoves.forEach((t, i) => console.log(` turn ${i + 1} after moves:`, Object.entries(t).map(([k, m]) => `${k} [${fmt(m)}]`).join(" | ")));
  r.end.forEach((t, i) => console.log(` turn ${i + 1} end of turn:`, Object.entries(t).map(([k, m]) => `${k} [${fmt(m)}]`).join(" | ")));
  if (opts.lines !== false) for (const [l, w] of [...r.lines].sort((a, b) => b[1] - a[1])) console.log(`   ${+w.toFixed(6)}  ${l}`);
  if (opts.outcomes) for (const o of r.outcomes) console.log(`   w=${+o.weight.toFixed(6)} [${o.kinds.join(",")}] end=${JSON.stringify(o.end)} :: ${o.lines.join(" ; ")}`);
}

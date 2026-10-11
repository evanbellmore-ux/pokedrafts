// End-of-turn design probes harness: one doubles turn in pinned Showdown c23d2e94 (runnable copy scripts/.cache/calc-audit/showdown)
// with forced rolls (lowest unless `roll`), no crits, every move hitting, chances below 100% failing unless `chance` says
// otherwise, and a chosen order for speed ties. Reports HP at the start, when the residual action is picked (after the
// moves), and after the turn, plus the log from the residual on.
// Run from the repo root: npx --no-install tsx scripts/.cache/calc-audit/status-eot/design/<probe>.ts
import * as sim from "../../showdown/sim/index.ts";
const { Battle } = sim as any;

export type Game = "sv" | "swsh" | "usum" | "champions";
const DFMT: Record<Game, string> = { sv: "gen9doublescustomgame", swsh: "gen8doublescustomgame", usum: "gen7doublescustomgame", champions: "gen9championsdoublescustomgame" };
export type Mon = { species: string; ability?: string; item?: string; moves?: string[]; evs?: Partial<Record<string, number>>; nature?: string; level?: number; teraType?: string; gender?: string; gigantamax?: boolean };
const zero = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const iv31 = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const set = (m: Mon) => ({ name: m.species, species: m.species, gender: m.gender ?? "", item: m.item ?? "", ability: m.ability ?? "", moves: m.moves ?? ["Splash"],
  nature: m.nature ?? "Serious", evs: { ...zero, ...(m.evs ?? {}) }, ivs: iv31, level: m.level ?? 50, teraType: m.teraType, happiness: 255, gigantamax: m.gigantamax });

export type TurnOpts = {
  game: Game; p1: [Mon, Mon]; p2: [Mon, Mon]; bench?: Mon;
  c1: string | string[]; c2: string | string[];
  roll?: number;
  setup?: (b: any) => void;
  /** randomChance by the running effect's id: return a boolean to force it, undefined for the default (fail below 100%). */
  chance?: (id: string, n: number, d: number) => boolean | undefined;
  /** sample by the running effect's id: return the index to pick. */
  sample?: (id: string, items: readonly unknown[]) => number | undefined;
  ties?: string[];
  /** Number of turns to play (same choices each turn). */
  turns?: number;
};

const slotName = (p: any) => `${p.side.id}${"ab"[p.position]} ${p.species.name}`;
export function hpOf(b: any) {
  return Object.fromEntries([...b.p1.active, ...b.p2.active].map((p: any) => [slotName(p), p.fainted || !p.hp ? `0/${p.maxhp}` : `${p.hp}/${p.maxhp}`]));
}

export function turn(o: TurnOpts) {
  const b = new Battle({ formatid: DFMT[o.game], seed: [1, 2, 3, 4] });
  const bench: Mon = o.bench ?? { species: "Snorlax", ability: "Thick Fat", moves: ["Splash"] };
  b.setPlayer("p1", { team: [...o.p1, bench].map(set) });
  b.setPlayer("p2", { team: [...o.p2, bench].map(set) });
  if (b.requestState === "teampreview") b.makeChoices("team 123", "team 123");
  const tr = b.trunc;
  const roll = o.roll ?? 0;
  b.randomizer = (base: number) => tr(tr(base * (85 + roll)) / 100);
  b.actions.hitStepAccuracy = (targets: any[]) => targets.map(() => true);
  const gd = b.actions.getDamage;
  b.actions.getDamage = function (s: any, t: any, m: any, sup?: boolean) {
    if (typeof m === "object" && m && !m.willCrit) m.willCrit = false;
    return gd.call(this, s, t, m, sup);
  };
  const chances: string[] = [];
  b.randomChance = function (n: number, d: number) {
    const id = this.effect?.id ?? "?";
    const forced = o.chance?.(id, n, d);
    chances.push(`${id}:${n}/${d}${forced === undefined ? "" : `=${forced}`}`);
    return forced ?? n >= d;
  };
  const r0 = b.random;
  b.random = function (m?: number, n?: number) { return m === 100 && n === undefined ? 99 : r0.call(this, m, n); };
  const s0 = b.sample;
  b.sample = function (items: readonly unknown[]) {
    const id = this.effect?.id ?? "?";
    const pick = o.sample?.(id, items);
    chances.push(`sample:${id}[${items.length}]${pick === undefined ? "" : `=${pick}`}`);
    return pick === undefined ? s0.call(this, items) : items[pick];
  };
  if (o.ties) {
    const rank = (x: any) => { const p = x?.pokemon ?? x?.effectHolder ?? x; const slot = p?.side ? `${p.side.id}${"ab"[p.position]}` : ""; const i = o.ties!.indexOf(slot); return i < 0 ? 99 : i; };
    b.prng.shuffle = (list: any[], start = 0, end = list.length) => {
      const part = list.slice(start, end).sort((x, y) => rank(x) - rank(y)); list.splice(start, end - start, ...part);
    };
  }
  let afterMoves: Record<string, string> = {};
  let residualAt = -1;
  const ra = b.runAction;
  b.runAction = function (action: any) {
    if (action.choice === "residual") { afterMoves = hpOf(b); residualAt = b.log.length; }
    return ra.call(this, action);
  };
  o.setup?.(b);
  const start = hpOf(b);
  const turns: { afterMoves: Record<string, string>; afterTurn: Record<string, string>; residualLog: string[]; requestState: string }[] = [];
  for (let t = 0; t < (o.turns ?? 1); t++) {
    residualAt = -1;
    const idx = b.log.length;
    const pickC = (c: string | string[]) => Array.isArray(c) ? c[Math.min(t, c.length - 1)] : c;
    b.makeChoices(pickC(o.c1), pickC(o.c2));
    const lines: string[] = b.log.slice(residualAt >= 0 ? residualAt : idx);
    const residualLog = lines.filter((l: string) => /^\|(-damage|-heal|faint|-activate|-status|-curestatus|-boost|-unboost|-enditem|-item|-start|-end|-weather|-fieldend|-sideend|upkeep|switch|detailschange|-formechange|-message|-hint|turn)\|?/.test(l));
    turns.push({ afterMoves, afterTurn: hpOf(b), residualLog, requestState: b.requestState });
  }
  return { start, turns, chances, battle: b };
}

export function show(title: string, r: ReturnType<typeof turn>) {
  console.log(`\n### ${title}`);
  console.log(" start:      ", JSON.stringify(r.start));
  r.turns.forEach((t, i) => {
    console.log(` [turn ${i + 1}] after moves:`, JSON.stringify(t.afterMoves));
    console.log(` [turn ${i + 1}] after turn: `, JSON.stringify(t.afterTurn), t.requestState !== "move" ? `(request ${t.requestState})` : "");
    for (const line of t.residualLog) console.log("    ", line);
  });
  if (r.chances.length) console.log(" random calls:", r.chances.join(" "));
}

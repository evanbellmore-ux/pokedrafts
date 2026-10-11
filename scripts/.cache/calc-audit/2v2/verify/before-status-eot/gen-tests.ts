// Writes tests/unit/doubles-turn-showdown.test.ts from cases.ts and the oracle's results/<id>.json (SPEC §8.1: unit tests
// hard-code the harness outputs, each citing its case id). A results/<id>.all.json (an exhaustive "all" walk of a case that runs
// as a Monte Carlo by default) replaces that case's sampled values.
//
// Run from the repo root: npx --no-install tsx scripts/.cache/calc-audit/2v2/verify/gen-tests.ts
import fs from "node:fs";
import path from "node:path";
import { GAME_RUNTIME, SLOTS, type Case, type OracleResult, type SlotId, type WalkResult } from "./case-types";
import { CASES } from "./cases";

const RESULTS = path.resolve("scripts/.cache/calc-audit/2v2/verify/results");
const OUT = path.resolve("tests/unit/doubles-turn-showdown.test.ts");
const num = (x: number) => Number(x.toPrecision(15));
const js = (value: unknown) => JSON.stringify(value).replace(/"([a-zA-Z_][a-zA-Z0-9_]*)":/g, "$1:");

type Row = {
  id: string; game: Case["game"]; title: string; checks: string; field?: Case["field"]; exact: boolean;
  slots: Record<SlotId, unknown>; hp: Record<SlotId, unknown>; steps: Record<string, unknown>;
};
const catalogs = Object.fromEntries(Object.entries(GAME_RUNTIME).map(([game, id]) => {
  const file = id === "champions" ? "data/champions/catalog.json" : `data/battle/${id}/catalog.json`;
  return [game, new Map((JSON.parse(fs.readFileSync(file, "utf8")).moves as { id: string; category: string }[]).map((m) => [m.id, m.category]))];
})) as Record<Case["game"], Map<string, string>>;
const rows: Row[] = [];
for (const c of CASES) {
  if (c.notEstimated) continue;
  const file = path.join(RESULTS, `${c.id}.json`);
  if (!fs.existsSync(file)) { console.log(`skip ${c.id}: no results`); continue; }
  const r = JSON.parse(fs.readFileSync(file, "utf8")) as OracleResult;
  const exhaustive = path.join(RESULTS, `${c.id}.all.json`);
  const all: WalkResult = fs.existsSync(exhaustive) ? JSON.parse(fs.readFileSync(exhaustive, "utf8")) : r.walks.all;
  const slots = Object.fromEntries(SLOTS.map((slot) => {
    const m = c.slots[slot];
    const { action, ...mon } = m;
    return [slot, { ...mon, move: action.move, ...(action.target ? { target: action.target } : {}), ...(action.context ? { context: action.context } : {}) }];
  })) as Record<SlotId, unknown>;
  const hp = Object.fromEntries(SLOTS.map((slot) => {
    if (c.slots[slot].absent) return [slot, null];
    const a = all.slots[slot];
    const fbm = all.steps[slot]?.faintedAtPick ?? 0;
    return [slot, {
      start: a.start, maximum: a.maximum, low: r.walks.lowest.slots[slot].modeTieUp, high: r.walks.highest.slots[slot].modeTieDown,
      min: a.min, max: a.max, average: num(a.average), koChance: num(a.koChance), ...(fbm > 0 ? { faintsBeforeMoving: num(fbm) } : {}),
    }];
  })) as Record<SlotId, unknown>;
  const steps = Object.fromEntries(Object.entries(all.steps).map(([slot, s]) => [slot, {
    moveId: s!.moveId, moves: num(s!.moved),
    order: Object.entries(s!.orderAll).map(([pos, p]) => [Number(pos), num(p)]),
    // A status move's targets are not damage hits (DoublesStep.hits lists the Pokémon a damaging move reaches).
    hits: Object.entries(s!.hits).filter(([, h]) => h!.reached > 0 && catalogs[c.game].get(s!.moveId) !== "Status").map(([target, h]) => {
      const immune = Object.keys(s!.lines).some((l) => l.startsWith(`|-immune|${{ "own-left": "p1a", "own-right": "p1b", "opponent-left": "p2b", "opponent-right": "p2a" }[target as SlotId]}: `));
      // A multi-hit move whose hits stopped at this target's knockout (truncated): Showdown's sum covers the hits dealt, the
      // app's hit is the move's calculation (verify/compare.ts), so only its kind is fixed.
      const dealt = h!.landed > 0 && h!.dmgMax !== null && h!.dmgMax > 0;
      return { slot: target, reached: num(h!.reached), koChance: num(h!.ko), ...(dealt && (h!.truncated ?? 0) > 0 ? { kind: "calculated" } : dealt ? { min: h!.dmgMin, max: h!.dmgMax } : h!.landed === 0 ? { kind: immune ? "no-damage" : "blocked" } : {}) };
    }),
  }]));
  rows.push({ id: c.id, game: c.game, title: c.title, checks: c.checks, ...(c.field ? { field: c.field } : {}), exact: all.exact, slots, hp, steps });
}

const header = `import { describe, expect, it } from "vitest";
import { calculateDoublesTurn } from "@/app/lib/battle/doubles-turn";
import type { DoublesPokemonInput, DoublesSlotId, DoublesTurnInput } from "@/app/lib/battle/doubles-types";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions, createSide, defaultAbilityActive } from "@/app/lib/battle/model";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions, BattleGame, MoveContext } from "@/app/lib/battle/types";

/**
 * The whole turn against pinned Showdown c23d2e94 (SPEC §8.2). Each case's values are the exact oracle of
 * scripts/.cache/calc-audit/2v2/verify/sim-dfs.ts: one real doubles turn per case with every damage roll, speed tie, Quick Claw,
 * Quick Draw, full paralysis, random target and hit count enumerated with its weight, every move hitting, no critical hit unless
 * certain or the field's, added effects below 100% failing, and HP read before the end of the turn. low and high are the most
 * likely HP when every roll is the lowest (ties to the higher HP) or the highest (ties to the lower HP), every other branch kept.
 * Damage min and max are the action's getDamage values into that slot (all its hits), uncapped. Level 50, 31 IVs, Serious nature
 * and 0 EVs / Stat Points unless set; Champions sets give Stat Points. Generated by verify/gen-tests.ts from verify/results.
 */
type Stat = "hp" | "atk" | "def" | "spa" | "spd" | "spe";
type Mon = {
  species: string; appSpecies?: string; ability: string; item?: string; nature?: string; evs?: Partial<Record<Stat, number>>;
  ivs?: Partial<Record<Stat, number>>; level?: number; hp?: number; status?: BattleBuild["status"];
  boosts?: Partial<Record<Exclude<Stat, "hp">, number>>; teraType?: string; choice?: "mega" | "terastallize" | "dynamax" | "zmove";
  charged?: boolean; appBuild?: Record<string, unknown>; absent?: boolean; gender?: string;
  move: string | null; target?: DoublesSlotId; context?: MoveContext;
};
type Side = { tailwind?: boolean; reflect?: boolean; lightScreen?: boolean; auroraVeil?: boolean };
type Field = Partial<Pick<BattleConditions, "weather" | "terrain" | "trickRoom" | "gravity" | "wonderRoom" | "magicRoom" | "critical">> & { own?: Side; opponent?: Side };
type HP = { start: number; maximum: number; low: number; high: number; min: number; max: number; average: number; koChance: number; faintsBeforeMoving?: number };
type Hit = { slot: DoublesSlotId; reached: number; koChance: number; min?: number; max?: number; kind?: "blocked" | "no-damage" | "calculated" };
type Step = { moveId: string; moves: number; order: [number, number][]; hits: Hit[] };
type Case = {
  id: string; game: "sv" | "swsh" | "usum" | "champions"; title: string; checks: string; field?: Field; exact: boolean;
  slots: Record<DoublesSlotId, Mon>; hp: Record<DoublesSlotId, HP | null>; steps: Partial<Record<DoublesSlotId, Step>>;
};

const GAMES: Record<Case["game"], BattleGame> = { sv: "scarlet_violet", swsh: "sword_shield", usum: "ultra_sun_ultra_moon", champions: "champions" };
const SLOTS: DoublesSlotId[] = ["own-left", "own-right", "opponent-left", "opponent-right"];
const id = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "");
const ZERO = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };

/** The app build for an oracle set: Showdown names as ids, EVs (native) or Stat Points (Champions), the start state. */
function build(m: Mon, runtime: BattleRuntime): BattleBuild {
  const base = createBuild(m.appSpecies ?? id(m.species), runtime);
  const abilityId = id(m.ability);
  const shared = {
    nature: m.nature ?? "Serious", abilityId, abilityActive: defaultAbilityActive(abilityId), itemId: id(m.item ?? ""),
    boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...m.boosts }, currentHP: m.hp ?? null, status: m.status ?? "",
  };
  const configuration = { ...base.configuration, ...(m.teraType ? { teraType: m.teraType } : {}) };
  const mechanic = m.choice === "terastallize" ? { mechanic: "tera" as const } : m.choice === "dynamax" ? { mechanic: "dynamax" as const } : {};
  const trained = base.game === "champions"
    ? { ...base, ...shared, points: { ...ZERO, ...m.evs } }
    : { ...base, ...shared, native: { level: m.level ?? 50, evs: { ...ZERO, ...m.evs }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31, ...m.ivs } } };
  return { ...trained, ...(Object.keys(configuration).length ? { configuration } : {}), ...mechanic, ...m.appBuild } as BattleBuild;
}
function side(s: Side | undefined) {
  return { ...createSide(), tailwind: !!s?.tailwind, reflect: !!s?.reflect, lightScreen: !!s?.lightScreen, auroraVeil: !!s?.auroraVeil };
}
async function input(c: Case): Promise<DoublesTurnInput> {
  const runtime = await loadBattleRuntime(GAMES[c.game]);
  const f = c.field ?? {};
  const field: BattleConditions = {
    ...createConditions(), gameType: "Doubles", weather: f.weather ?? "", terrain: f.terrain ?? "", critical: !!f.critical,
    trickRoom: !!f.trickRoom, gravity: !!f.gravity, wonderRoom: !!f.wonderRoom, magicRoom: !!f.magicRoom,
    attackerSide: side(f.own), defenderSide: side(f.opponent),
  };
  const pokemon = Object.fromEntries(SLOTS.map((slot) => {
    const m = c.slots[slot];
    if (m.absent) return [slot, null];
    const moveId = m.move === null ? null : id(m.move);
    const context: MoveContext = { ...(m.choice === "zmove" ? { useZ: true } : {}), ...m.context };
    const entry: DoublesPokemonInput = {
      build: build(m, runtime), contexts: moveId && Object.keys(context).length ? { [moveId]: context } : {}, charged: !!m.charged,
      action: { moveId, target: m.target ?? null },
    };
    return [slot, entry];
  })) as Record<DoublesSlotId, DoublesPokemonInput | null>;
  return { runtime, field, pokemon };
}

`;

const body = `
describe("the 2v2 turn against pinned Showdown", () => {
  for (const c of CASES) {
    it(\`\${c.id}: \${c.title}\`, async () => {
      const result = calculateDoublesTurn(await input(c));
      expect(result.status, c.checks).toBe("ready");
      if (result.status !== "ready") return;
      // Exhaustive cases are exact to 1e-9; a sampled one (exact: false) to 0.015 in its chances and 0.5 HP in its average.
      const digits = c.exact ? 9 : 1;
      for (const slot of SLOTS) {
        const want = c.hp[slot], got = result.hp[slot];
        if (!want) { expect(got, slot).toBeNull(); continue; }
        expect(got, slot).not.toBeNull();
        expect({ start: got!.start, maximum: got!.maximum, low: got!.low, high: got!.high }, \`\${c.id} \${slot}\`).toEqual({ start: want.start, maximum: want.maximum, low: want.low, high: want.high });
        if (c.exact) expect({ min: got!.min, max: got!.max }, \`\${c.id} \${slot}\`).toEqual({ min: want.min, max: want.max });
        else expect(got!.min <= want.min && got!.max >= want.max, \`\${c.id} \${slot} range\`).toBe(true);
        expect(got!.average, \`\${c.id} \${slot} average\`).toBeCloseTo(want.average, c.exact ? 9 : 0);
        expect(Math.abs(got!.koChance - want.koChance), \`\${c.id} \${slot} KO chance\`).toBeLessThanOrEqual(c.exact ? 1e-9 : 0.015);
        expect(got!.faintsBeforeMoving ?? 0, \`\${c.id} \${slot} faints before moving\`).toBeCloseTo(want.faintsBeforeMoving ?? 0, digits);
      }
      expect(result.steps.map((step) => step.slot).sort()).toEqual(Object.keys(c.steps).sort());
      for (const step of result.steps) {
        const want = c.steps[step.slot as DoublesSlotId]!;
        expect(step.moveId).toBe(want.moveId);
        expect(step.moves, \`\${c.id} \${step.slot} moves\`).toBeCloseTo(want.moves, digits);
        const order = new Map(step.order.map((entry) => [entry.position, entry.chance]));
        for (const [position, chance] of want.order) expect(order.get(position) ?? 0, \`\${c.id} \${step.slot} order \${position}\`).toBeCloseTo(chance, digits);
        expect([...order.keys()].every((position) => want.order.some(([p]) => p === position))).toBe(true);
        if (!want.hits.length) continue;
        for (const hit of want.hits) {
          const got = step.hits.find((h) => h.slot === hit.slot);
          expect(got, \`\${c.id} \${step.slot} → \${hit.slot}\`).toBeDefined();
          expect(got!.reached, \`\${c.id} \${step.slot} → \${hit.slot} reached\`).toBeCloseTo(hit.reached, digits);
          expect(got!.koChance, \`\${c.id} \${step.slot} → \${hit.slot} KO chance\`).toBeCloseTo(hit.koChance, digits);
          if (hit.kind) expect(got!.kind === hit.kind || (hit.kind === "blocked" && got!.kind === "no-damage"), \`\${c.id} \${step.slot} → \${hit.slot} \${got!.kind}\`).toBe(true);
          if (hit.min !== undefined) expect({ kind: got!.kind, min: got!.min, max: got!.max }, \`\${c.id} \${step.slot} → \${hit.slot}\`).toEqual({ kind: "calculated", min: hit.min, max: hit.max });
        }
      }
    });
  }
});
`;

const table = `/** The oracle's cases (verify/cases.ts) with their expected values (verify/results/<id>.json). */
const CASES: Case[] = [
${rows.map((r) => `  ${js(r)},`).join("\n")}
];
`;
fs.writeFileSync(OUT, header + table + body);
console.log(`wrote ${rows.length} cases to ${OUT}`);

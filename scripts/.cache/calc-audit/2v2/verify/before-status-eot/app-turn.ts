// The app side of the 2v2 validation (SPEC §8.1): each case as a DoublesTurnInput, run through calculateDoublesTurn
// (app/lib/battle/doubles-turn.ts, SPEC §3.3). The engine is loaded lazily, so the input builder and the catalog preflight work
// before it exists.
//
// Run from the repo root (the @/ alias resolves from there):
//   npx --no-install tsx scripts/.cache/calc-audit/2v2/verify/app-turn.ts [V01 ...] [--preflight]
// Writes scripts/.cache/calc-audit/2v2/verify/app-results/<id>.json ({ input summary, result, ms }).
import fs from "node:fs";
import path from "node:path";
import { createBuild, createConditions, createSide, defaultAbilityActive, validateBuild } from "@/app/lib/battle/model";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions, MoveContext } from "@/app/lib/battle/types";
import type { DoublesPokemonInput, DoublesSlotId, DoublesTurnInput, DoublesTurnResult } from "@/app/lib/battle/doubles-types";
import { GAME_RUNTIME, SLOTS, toID, type Case, type CaseMon, type CaseSide, type SlotId } from "./case-types";
import { CASES } from "./cases";

export const APP_RESULTS_DIR = path.resolve("scripts/.cache/calc-audit/2v2/verify/app-results");
const ZERO = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const IV31 = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };

export async function runtimeFor(c: Case): Promise<BattleRuntime> {
  return loadBattleRuntime(GAME_RUNTIME[c.game]);
}

/** The app build for a case Pokémon: Showdown names to ids, EVs or Stat Points, the start state. */
export function caseBuild(m: CaseMon, runtime: BattleRuntime): BattleBuild {
  const speciesId = m.appSpecies ?? toID(m.species);
  const base = createBuild(speciesId, runtime);
  const abilityId = toID(m.ability);
  const shared = {
    nature: m.nature ?? "Serious", abilityId, abilityActive: defaultAbilityActive(abilityId), itemId: toID(m.item ?? ""),
    boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...m.boosts }, currentHP: m.hp ?? null, status: m.status ?? "",
  };
  const configuration = { ...base.configuration, ...(m.teraType ? { teraType: m.teraType } : {}) };
  const mechanic = m.choice === "terastallize" ? { mechanic: "tera" as const } : m.choice === "dynamax" ? { mechanic: "dynamax" as const } : {};
  const build = base.game === "champions"
    ? { ...base, ...shared, points: { ...ZERO, ...m.evs } }
    : { ...base, ...shared, native: { level: m.level ?? 50, evs: { ...ZERO, ...m.evs }, ivs: { ...IV31, ...m.ivs } } };
  return { ...build, ...(Object.keys(configuration).length ? { configuration } : {}), ...mechanic, ...m.appBuild } as BattleBuild;
}

function side(s: CaseSide | undefined) {
  return { ...createSide(), tailwind: !!s?.tailwind, reflect: !!s?.reflect, lightScreen: !!s?.lightScreen, auroraVeil: !!s?.auroraVeil };
}
export function caseField(c: Case): BattleConditions {
  const f = c.field ?? {};
  return {
    ...createConditions(), gameType: "Doubles", weather: f.weather ?? "", terrain: f.terrain ?? "", critical: !!f.critical,
    trickRoom: !!f.trickRoom, gravity: !!f.gravity, wonderRoom: !!f.wonderRoom, magicRoom: !!f.magicRoom,
    attackerSide: side(f.own), defenderSide: side(f.opponent),
  };
}

export function caseInput(c: Case, runtime: BattleRuntime): DoublesTurnInput {
  const pokemon = Object.fromEntries(SLOTS.map((slot) => {
    const m = c.slots[slot];
    if (m.absent) return [slot, null];
    const moveId = m.action.move === null ? null : toID(m.action.move);
    const context: MoveContext = { ...(m.choice === "zmove" ? { useZ: true } : {}), ...(m.action.context as MoveContext | undefined) };
    const entry: DoublesPokemonInput = {
      build: caseBuild(m, runtime),
      contexts: moveId && Object.keys(context).length ? { [moveId]: context } : {},
      charged: !!m.charged,
      action: { moveId, target: (m.action.target ?? null) as DoublesSlotId | null },
    };
    return [slot, entry];
  })) as Record<DoublesSlotId, DoublesPokemonInput | null>;
  return { runtime, field: caseField(c), pokemon };
}

/** Catalog problems the engine would report as issues: unknown species, ability, item, or a move the species does not learn. */
export function preflight(c: Case, runtime: BattleRuntime): string[] {
  const out: string[] = [];
  for (const slot of SLOTS) {
    const m = c.slots[slot];
    if (m.absent) continue;
    const build = caseBuild(m, runtime);
    for (const issue of validateBuild(build, runtime)) out.push(`${slot} ${build.speciesId}: ${issue.field}: ${issue.message}`);
    const move = m.action.move === null ? null : toID(m.action.move);
    const species = runtime.speciesById.get(build.speciesId);
    if (move && !runtime.movesById.has(move)) out.push(`${slot}: move ${move} is not in the ${runtime.profile.id} catalog`);
    else if (move && species && !species.moves.includes(move)) out.push(`${slot}: ${species.name} does not learn ${move} in ${runtime.profile.id}`);
  }
  return out;
}

type Engine = { calculateDoublesTurn: (input: DoublesTurnInput) => DoublesTurnResult };
let engine: Engine | null | undefined;
export async function loadEngine(): Promise<Engine | null> {
  if (engine !== undefined) return engine;
  try {
    engine = (await import("@/app/lib/battle/doubles-turn")) as unknown as Engine;
  } catch (e) {
    console.log(`doubles-turn.ts is not loadable: ${(e as Error).message.split("\n")[0]}`);
    engine = null;
  }
  return engine;
}

export async function appTurn(c: Case): Promise<{ result: DoublesTurnResult | null; ms: number; error?: string; preflight: string[] }> {
  const runtime = await runtimeFor(c);
  const pre = preflight(c, runtime);
  const e = await loadEngine();
  if (!e) return { result: null, ms: 0, error: "engine not built", preflight: pre };
  const input = caseInput(c, runtime);
  const t0 = performance.now();
  try {
    const result = e.calculateDoublesTurn(input);
    return { result, ms: performance.now() - t0, preflight: pre };
  } catch (err) {
    return { result: null, ms: performance.now() - t0, error: (err as Error).stack ?? String(err), preflight: pre };
  }
}

export type SlotIdAlias = SlotId;

if (process.argv[1]?.replace(/\\/g, "/").endsWith("verify/app-turn.ts")) {
  (async () => {
    const args = process.argv.slice(2);
    const ids = args.filter((a) => !a.startsWith("--"));
    const onlyPreflight = args.includes("--preflight");
    fs.mkdirSync(APP_RESULTS_DIR, { recursive: true });
    for (const c of CASES) {
      if (ids.length && !ids.some((id) => c.id.startsWith(id))) continue;
      const runtime = await runtimeFor(c);
      const pre = preflight(c, runtime);
      if (onlyPreflight) {
        console.log(`${c.id}: ${pre.length ? pre.join(" | ") : "ok"}`);
        continue;
      }
      const out = await appTurn(c);
      fs.writeFileSync(path.join(APP_RESULTS_DIR, `${c.id}.json`), JSON.stringify(out, null, 1));
      console.log(`${c.id}: ${out.error ? out.error.split("\n")[0] : out.result?.status} (${out.ms.toFixed(1)} ms)${pre.length ? ` preflight: ${pre.join(" | ")}` : ""}`);
    }
  })();
}

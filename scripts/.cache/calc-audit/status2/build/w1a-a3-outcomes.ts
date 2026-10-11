import { readFileSync } from "node:fs";

import { doublesTargetRule } from "@/app/lib/battle/doubles-targets";
import { calculateDoublesOutcomes, calculateDoublesTurn, DOUBLES_REFERENCE } from "@/app/lib/battle/doubles-turn";
import type { DoublesCarried, DoublesOutcome, DoublesPokemonInput, DoublesSideId, DoublesSlotId, DoublesTurnInput } from "@/app/lib/battle/doubles-types";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions, createSide, defaultAbilityActive } from "@/app/lib/battle/model";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions, BattleGame, MoveContext } from "@/app/lib/battle/types";

/**
 * E2 (Training SPEC §5.11): calculateDoublesOutcomes is calculateDoublesTurn's "all" walk as finished worlds. For every case
 * of tests/unit/doubles-turn-showdown.test.ts (read from that file, unchanged) and 300 seeded turns from the generator of
 * tests/unit/doubles-turn-perf.test.ts, the outcomes' HP mixture equals calculateDoublesTurn's average (1e-9), min, max and
 * KO chance (1e-9), and each outcome's allFainted is at most its smallest marginal KO chance on that side. With the end of
 * turn applied (status-eot SPEC §4.9) the outcomes are after the whole turn and equal endOfTurn.hp; otherwise they are
 * after the moves, equal hp, and say why the end of turn is not estimated.
 */
const SLOTS: DoublesSlotId[] = ["own-left", "own-right", "opponent-left", "opponent-right"];
const SIDES: DoublesSideId[] = ["own", "opponent"];
const side = (slot: DoublesSlotId): DoublesSideId => slot.startsWith("own") ? "own" : "opponent";

// ---------- The Showdown cases (the same input builder as doubles-turn-showdown.test.ts) ----------
type Stat = "hp" | "atk" | "def" | "spa" | "spd" | "spe";
type Mon = {
  species: string; appSpecies?: string; ability: string; item?: string; nature?: string; evs?: Partial<Record<Stat, number>>;
  ivs?: Partial<Record<Stat, number>>; level?: number; hp?: number; status?: BattleBuild["status"];
  boosts?: Partial<Record<Exclude<Stat, "hp">, number>>; teraType?: string; choice?: "mega" | "terastallize" | "dynamax" | "zmove";
  charged?: boolean; appBuild?: Record<string, unknown>; absent?: boolean; move: string | null; target?: DoublesSlotId; context?: MoveContext;
  carried?: Carried; substitute?: number; moves?: string[]; lastMove?: string | null;
};
type Carried = Omit<DoublesCarried, "trap" | "futureMove"> & { trap?: { source: DoublesSlotId; bindingBand: boolean; move?: string }; futureMove?: string };
type SideField = { tailwind?: boolean; reflect?: boolean; lightScreen?: boolean; auroraVeil?: boolean };
type Field = Partial<Pick<BattleConditions, "weather" | "terrain" | "trickRoom" | "gravity" | "wonderRoom" | "magicRoom" | "critical">> & { own?: SideField; opponent?: SideField };
type Case = {
  id: string; game: "sv" | "swsh" | "usum" | "champions"; field?: Field; slots: Record<DoublesSlotId, Mon>;
  weatherTurns?: number; canSwitch?: Partial<Record<"own" | "opponent", boolean>>;
};
const GAMES: Record<Case["game"], BattleGame> = { sv: "scarlet_violet", swsh: "sword_shield", usum: "ultra_sun_ultra_moon", champions: "champions" };
const toId = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "");
const ZERO = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };

function showdownCases(): Case[] {
  const text = readFileSync("tests/unit/doubles-turn-showdown.test.ts", "utf8");
  const start = text.indexOf("const CASES: Case[] = [");
  const end = text.indexOf("\n];", start);
  if (start < 0 || end < 0) throw new Error("The Showdown cases were not found.");
  const literal = text.slice(start + "const CASES: Case[] = ".length, end + 3).replace(/;$/, "");
  return new Function(`return ${literal}`)() as Case[];
}
function caseBuild(m: Mon, runtime: BattleRuntime): BattleBuild {
  const base = createBuild(m.appSpecies ?? toId(m.species), runtime);
  const abilityId = toId(m.ability);
  const shared = {
    nature: m.nature ?? "Serious", abilityId, abilityActive: defaultAbilityActive(abilityId), itemId: toId(m.item ?? ""),
    boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...m.boosts }, currentHP: m.hp ?? null, status: m.status ?? "",
  };
  const configuration = { ...base.configuration, ...(m.teraType ? { teraType: m.teraType } : {}) };
  const mechanic = m.choice === "terastallize" ? { mechanic: "tera" as const } : m.choice === "dynamax" ? { mechanic: "dynamax" as const } : {};
  const trained = base.game === "champions"
    ? { ...base, ...shared, points: { ...ZERO, ...m.evs } }
    : { ...base, ...shared, native: { level: m.level ?? 50, evs: { ...ZERO, ...m.evs }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31, ...m.ivs } } };
  return { ...trained, ...(Object.keys(configuration).length ? { configuration } : {}), ...mechanic, ...m.appBuild } as BattleBuild;
}
/** The state from earlier turns (doubles-turn-showdown.test.ts carried). */
function carriedOf(m: Mon): DoublesCarried | undefined {
  const { trap, futureMove, ...rest } = m.carried ?? {};
  const out: DoublesCarried = {
    ...rest, ...(trap ? { trap: { source: trap.source, bindingBand: trap.bindingBand, move: toId(trap.move ?? "Fire Spin") } } : {}), ...(futureMove ? { futureMove: toId(futureMove) } : {}),
    ...(m.substitute !== undefined ? { substitute: m.substitute } : {}),
  };
  return Object.keys(out).length ? out : undefined;
}
const sideOf = (s: SideField | undefined) => ({ ...createSide(), tailwind: !!s?.tailwind, reflect: !!s?.reflect, lightScreen: !!s?.lightScreen, auroraVeil: !!s?.auroraVeil });
async function caseInput(c: Case): Promise<DoublesTurnInput> {
  const runtime = await loadBattleRuntime(GAMES[c.game]);
  const f = c.field ?? {};
  const field: BattleConditions = {
    ...createConditions(), gameType: "Doubles", weather: f.weather ?? "", terrain: f.terrain ?? "", critical: !!f.critical,
    trickRoom: !!f.trickRoom, gravity: !!f.gravity, wonderRoom: !!f.wonderRoom, magicRoom: !!f.magicRoom,
    attackerSide: sideOf(f.own), defenderSide: sideOf(f.opponent),
  };
  const pokemon = Object.fromEntries(SLOTS.map((slot) => {
    const m = c.slots[slot];
    if (m.absent) return [slot, null];
    const moveId = m.move === null ? null : toId(m.move);
    const context: MoveContext = { ...(m.choice === "zmove" ? { useZ: true } : {}), ...m.context };
    const state = carriedOf(m);
    const entry: DoublesPokemonInput = {
      build: caseBuild(m, runtime), contexts: moveId && Object.keys(context).length ? { [moveId]: context } : {}, charged: !!m.charged,
      action: { moveId, target: m.target ?? null },
      ...(state ? { carried: state } : {}),
      ...(m.lastMove !== undefined ? { lastMove: m.lastMove === null ? null : toId(m.lastMove) } : {}),
      ...(m.moves ? { moves: [...new Set([...(moveId ? [moveId] : []), ...m.moves.map(toId)])] } : {}),
    };
    return [slot, entry];
  })) as Record<DoublesSlotId, DoublesPokemonInput | null>;
  const turn: DoublesTurnInput = {
    runtime, field, pokemon, ...(c.weatherTurns !== undefined ? { weatherTurns: c.weatherTurns } : {}),
    canSwitch: { own: c.canSwitch?.own ?? true, opponent: c.canSwitch?.opponent ?? true },
  };
  // A move the app takes no chosen target for gets none, whatever Showdown's choice aims at (as the Showdown test does).
  for (const slot of SLOTS) {
    const entry = pokemon[slot];
    if (entry?.action.moveId && entry.action.target && doublesTargetRule(turn, slot, entry.action.moveId).kind !== "choose") entry.action = { ...entry.action, target: null };
  }
  return turn;
}
(async () => {
  const cases = showdownCases();
  for (const c of cases) {
    const input = await caseInput(c);
    const full = calculateDoublesTurn(input);
    if (full.status !== "ready") console.log(c.id, full.status, (full as { reason?: string }).reason ?? JSON.stringify(full).slice(0, 300));
  }
  console.log("done", cases.length);
})();

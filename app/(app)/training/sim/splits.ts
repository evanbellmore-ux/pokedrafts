// Exact weighted mixtures of engine inputs for public random events at the start of a move (SPEC §9.4 "Splits"),
// from public counts only (never a battle's hidden counters): consecutive protection (data/conditions.ts stall
// 1/counter), sleep (champions/conditions.ts slp startTime sample([2, 3, 3])) and freeze (champions frz: 3 attempts, 1/4).
import { DOUBLES_SLOTS, foesOf, type DoublesSlotId, type DoublesTurnInput } from "@/app/lib/battle/doubles-types";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { MonKey } from "../model/ai-view";
import type { PublicMon } from "../model/public-state";
import { PROTECT_FAMILY } from "./tracker";

export type SplitWorld = { weight: number; input: DoublesTurnInput; notes: string[] };
export type SplitResult = { kind: "worlds"; worlds: SplitWorld[] } | { kind: "rollout"; reasons: string[] };

const third = 1 / 3;
/** P(wakes at this attempt | still asleep after `elapsed` attempts); Early Bird counts 2 per attempt. */
export function wakeChance(elapsed: number, earlyBird: boolean): number {
  if (earlyBird) return elapsed <= 0 ? third : 1;
  return elapsed <= 0 ? 0 : elapsed === 1 ? third : 1;
}
/** P(thaws at this attempt): a defrost move or the third attempt always; else 1/4. */
export function thawChance(elapsed: number, defrost: boolean): number {
  return defrost || elapsed + 1 >= 3 ? 1 : 0.25;
}
const pct = (p: number) => `${Math.round(p * 100)}%`;

export function splitWorlds(base: DoublesTurnInput, ctx: { runtime: BattleRuntime; slotKeys: Record<DoublesSlotId, MonKey | null>; publicOf: (key: MonKey) => PublicMon | null }): SplitResult {
  let worlds: SplitWorld[] = [{ weight: 1, input: base, notes: [] }];
  const fork = (slot: DoublesSlotId, branches: { weight: number; apply: (input: DoublesTurnInput) => void; note: string }[]) => {
    const live = branches.filter((branch) => branch.weight > 0);
    if (live.length === 1 && live[0].weight === 1) { for (const world of worlds) live[0].apply(world.input); return; }
    const next: SplitWorld[] = [];
    for (const world of worlds) {
      for (const branch of live) {
        const { runtime, ...rest } = world.input;
        const input: DoublesTurnInput = { ...structuredClone(rest), runtime };
        branch.apply(input);
        next.push({ weight: world.weight * branch.weight, input, notes: [...world.notes, branch.note] });
      }
    }
    worlds = next;
  };
  const noMove = (slot: DoublesSlotId) => (input: DoublesTurnInput) => { const entry = input.pokemon[slot]; if (entry) entry.action = { moveId: null, target: null }; };
  for (const slot of DOUBLES_SLOTS) {
    const entry = base.pokemon[slot];
    const key = ctx.slotKeys[slot];
    const moveId = entry?.action.moveId;
    if (!entry || !key || !moveId) continue;
    const mon = ctx.publicOf(key);
    const move = ctx.runtime.movesById.get(moveId);
    const name = ctx.runtime.speciesById.get(entry.build.speciesId)?.name ?? key;
    if (PROTECT_FAMILY.has(moveId) && mon && mon.protectStreak > 0) {
      const p = 1 / Math.min(729, 3 ** mon.protectStreak);
      fork(slot, [
        { weight: p, apply: () => {}, note: `${move?.name ?? moveId} works (${pct(p)}).` },
        { weight: 1 - p, apply: noMove(slot), note: `${move?.name ?? moveId} fails (${pct(1 - p)}).` },
      ]);
    }
    if (entry.build.status === "slp" && mon) {
      const p = wakeChance(mon.statusElapsed, entry.build.abilityId === "earlybird");
      fork(slot, [
        { weight: 1 - p, apply: noMove(slot), note: `${name} stays asleep (${pct(1 - p)}).` },
        { weight: p, apply: (input) => { const each = input.pokemon[slot]; if (each) each.build = { ...each.build, status: "" }; }, note: `${name} wakes up (${pct(p)}).` },
      ]);
    } else if (entry.build.status === "frz" && mon) {
      // A foe's Fire move into it this turn thaws it mid-turn: not a start-of-turn split.
      const fire = foesOf(slot).some((foe) => { const other = base.pokemon[foe]; return other?.action.moveId && ctx.runtime.movesById.get(other.action.moveId)?.type === "Fire"; });
      if (fire) return { kind: "rollout", reasons: [`${name} is frozen and a Fire move may thaw it.`] };
      const defrost = DEFROST_MOVES.has(moveId);
      const p = thawChance(mon.statusElapsed, defrost);
      fork(slot, [
        { weight: 1 - p, apply: noMove(slot), note: `${name} stays frozen (${pct(1 - p)}).` },
        { weight: p, apply: (input) => { const each = input.pokemon[slot]; if (each) each.build = { ...each.build, status: "" }; }, note: `${name} thaws (${pct(p)}).` },
      ]);
    }
  }
  return { kind: "worlds", worlds };
}

/** Moves with the defrost flag (pinned data/moves.ts flags.defrost). */
const DEFROST_MOVES: ReadonlySet<string> = new Set(["burnup", "flamewheel", "flareblitz", "fusionflare", "hydrosteam", "matchagotcha", "pyroball", "sacredfire", "scald", "scorchingsands", "sizzlyslide", "steameruption", "polarflare"]);

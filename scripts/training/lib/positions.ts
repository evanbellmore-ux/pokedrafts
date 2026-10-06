// Addendum A1.5 gate: the AI's turn-1 Mega decision on fixed positions (tests/fixtures/training-teams.ts MEGA_POSITIONS).
// Each sample is a new battle (its own seeds) up to the AI's first turn decision; both previews are forced to 1234.
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import { DEFAULT_INFO } from "@/app/(app)/training/model/info";
import type { TrainingUsageData } from "@/app/(app)/training/model/usage";
import { megaSlots } from "@/app/(app)/training/model/view-types";
import { MEGA_POSITIONS, positionTeam, type MegaPosition } from "@/tests/fixtures/training-teams";
import { runMatch } from "./match";
import { createSeat, ensureSeats, type SeatName } from "./providers";
import { mean, wilson, type Interval } from "./report";

export type PositionSummary = {
  id: string; expect: MegaPosition["expect"]; seat: SeatName;
  megaRate: Interval; meanShare: number;
  /** The read's Mega facts (DecisionReport.mega.text), most common first. */
  reads: string[];
  errors: string[];
};

export async function runMegaPositions(options: { samples: number; run: string; runtime: BattleRuntime; usage: TrainingUsageData; seat?: SeatName }): Promise<PositionSummary[]> {
  const seat = options.seat ?? "safe";
  await ensureSeats([seat]);
  const out: PositionSummary[] = [];
  for (const position of MEGA_POSITIONS) {
    let evolved = 0;
    const shares: number[] = [];
    const reads = new Map<string, number>();
    const errors: string[] = [];
    let n = 0;
    for (let sample = 0; sample < options.samples; sample++) {
      const result = await runMatch({
        seats: { p1: createSeat("val-random", options.runtime, null), p2: createSeat(seat, options.runtime, null) },
        teams: { p1: positionTeam(position, "player", options.runtime), p2: positionTeam(position, "ai", options.runtime) },
        info: DEFAULT_INFO, runtime: options.runtime, usage: options.usage,
        seedRun: `${options.run}:position:${position.id}`, index: sample,
        forcedPreview: { p1: [1, 2, 3, 4], p2: [1, 2, 3, 4] },
        stop: (record) => record.side === "p2" && record.kind === "turn",
      });
      errors.push(...result.errors.map((error) => `${error.stage}: ${error.message.split("\n")[0]}`));
      const decision = result.decisions.find((record) => record.side === "p2" && record.kind === "turn");
      if (!decision?.action) continue;
      n++;
      // A KO-race position counts a Mega only with the race's move from the Mega slot (Mega + Protect is not the race).
      const megaSlot = megaSlots(decision.action)[0];
      const megaAction = megaSlot ? decision.action[megaSlot] : undefined;
      if (megaSlot && (position.expect !== "mega" || !position.move || (megaAction?.kind === "move" && megaAction.moveId === position.move))) evolved++;
      if (decision.stats?.mega) shares.push(decision.stats.mega.share);
      const text = decision.report?.mega?.text;
      if (text) reads.set(text, (reads.get(text) ?? 0) + 1);
    }
    out.push({
      id: position.id, expect: position.expect, seat, megaRate: wilson(evolved, n), meanShare: mean(shares),
      reads: [...reads].sort((a, b) => b[1] - a[1]).map(([text, count]) => `${text} (${count})`), errors: [...new Set(errors)].slice(0, 10),
    });
  }
  return out;
}

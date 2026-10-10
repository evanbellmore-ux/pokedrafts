// Training leak tests (SPEC §14.4).
// L1 (the AI's direction): battles A and B differ only in one hidden field H and replay the same choice strings for both
// seats; at every AI decision whose p2-channel history (without t: lines) is byte-identical in A and B, the AI's inputs
// (JSON) and its decision (choice string, report, engine calls, rollout samples) must be identical. Two settings must make
// a difference instead: aiKnows.exactHP for L1-hp and aiKnows.open.statPoints for L1-sp.
// L2 (your direction): with youSee closed, no posted battle message names an AI item, ability, move, nature or Stat Point
// the p1 channel has not shown, and no unbrought AI member is marked brought; the same holds for every saved battle's replay
// boards and for a resumed battle's messages, and each checkpoint leaves the worker sealed.
// The L2 Illusion and Transform slice plays the same checks with fixed teams (tests/fixtures/training-teams.ts
// ILLUSION_TRANSFORM: the AI's Zoroark leads disguised and its Imposter Ditto transforms; your Garchomp and Ditto), so the
// gate sees an Illusion, a Transform and look-alikes, which the pools' teams never bring.
//   npx tsx scripts/training/leak.ts [--battles 40 (dice 60)] [--fields sp,nature,…] [--l2 40] [--l2-illusion 8] [--seat safe]
import { join } from "node:path";
import { CLOSED_TEAM_SHEETS, DEFAULT_INFO } from "@/app/(app)/training/model/info";
import { l1Fields, runL1Field } from "./lib/leak-l1";
import { runL2 } from "./lib/leak-l2";
import type { SeatName } from "./lib/providers";
import { illusionTransformPair } from "./lib/teams";
import { ILLUSION_TRANSFORM } from "@/tests/fixtures/training-teams";
import { gateTable, parseArgs, writeJson, writeText, type GateRow } from "./lib/report";

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  // 40 battles per field compare at least 50 decisions for every field; the dice field (decisions with a shown sleep or
  // confusion only) needs 60 (integration runs, scripts/.cache/training/build/integrate/), as does dice-eot (pool E).
  const battles = Number(args.battles ?? 40);
  const seat = String(args.seat ?? "safe") as SeatName;
  const only = typeof args.fields === "string" ? String(args.fields).split(",") : null;
  const rows: GateRow[] = [];
  const details: Record<string, unknown> = {};
  for (const field of l1Fields().filter((each) => !only || only.includes(each.id))) {
    const result = await runL1Field(field, { battles: field.id.startsWith("dice") && args.battles === undefined ? 60 : battles, seat });
    details[field.id] = result;
    if (field.mustDiffer) rows.push({ gate: `L1-${field.id} (setting works)`, threshold: "inputs differ at compared decisions", result: `${result.inputDifferences}/${result.compared} differ`, status: result.compared > 0 && result.inputDifferences > 0 ? "pass" : "fail" });
    else rows.push({ gate: `L1-${field.id}`, threshold: "≥ 50 compared, 0 differences", result: `${result.differences} differences in ${result.compared}`, status: result.compared >= 50 && result.differences === 0 ? "pass" : "fail", detail: result.notes.join(" | ") });
  }
  const l2Battles = Number(args.l2 ?? 40);
  if (l2Battles > 0) {
    const l2 = await runL2({ battles: l2Battles, seat, info: { aiKnows: DEFAULT_INFO.aiKnows, youSee: CLOSED_TEAM_SHEETS } });
    details.L2 = l2;
    rows.push({ gate: "L2 (your direction, youSee closed)", threshold: "0 hits over 40 battles", result: `${l2.hits.length} hits in ${l2.messages} messages over ${l2.battles} battles (${l2.forfeits} forfeited on a locked turn)`, status: l2.hits.length === 0 && l2.errors.length === 0 && l2.battles >= Math.min(40, l2Battles) ? "pass" : "fail", detail: [...l2.hits.slice(0, 10), ...l2.errors.slice(0, 5)].join(" | ") });
    rows.push({ gate: "L2 saved battles (replay boards, Resume, sealed checkpoints)", threshold: "every battle replayed, its boards = the battle's; 0 hits (above)", result: `${l2.replays} replays (${l2.replayBoards} boards; ${l2.replayBoardsEqual} of ${l2.replays} equal to the battle's boards), ${l2.resumes} resumed, ${l2.checkpoints} checkpoints sealed`, status: l2.replays === l2.battles && l2.replayBoardsEqual === l2.replays && l2.resumes > 0 && l2.checkpoints > 0 && l2.hits.length === 0 && l2.errors.length === 0 ? "pass" : "fail" });
  }
  const sliceBattles = Number(args["l2-illusion"] ?? 8);
  if (sliceBattles > 0) {
    const slice = await runL2({
      battles: sliceBattles, seat, info: { aiKnows: DEFAULT_INFO.aiKnows, youSee: CLOSED_TEAM_SHEETS },
      teams: { pair: () => illusionTransformPair(), aiOrder: ILLUSION_TRANSFORM.aiOrder, aiReplaceWith: ILLUSION_TRANSFORM.aiReplaceWith, run: "leak-l2-illusion" },
    });
    details["L2-illusion"] = slice;
    const shown = slice.illusions > 0 && slice.transforms > 0 && slice.lookAlikes > 0;
    rows.push({
      gate: "L2 Illusion and Transform (Zoroark, Ditto; youSee closed)", threshold: `0 hits over ${sliceBattles} battles; an Illusion ended, a Transform and look-alikes shown`,
      result: `${slice.hits.length} hits in ${slice.messages} messages over ${slice.battles} battles; ${slice.illusions} Illusions ended, ${slice.transforms} with a Transform, ${slice.lookAlikes} look-alike decisions; ${slice.replayBoardsEqual}/${slice.replays} replays equal, ${slice.resumes} resumed`,
      status: slice.hits.length === 0 && slice.errors.length === 0 && slice.battles === sliceBattles && shown && slice.replays === slice.battles && slice.replayBoardsEqual === slice.replays ? "pass" : "fail",
      detail: [...slice.hits.slice(0, 10), ...slice.errors.slice(0, 5)].join(" | "),
    });
  }
  const dir = join(process.cwd(), "scripts", ".cache", "training", "leak");
  writeJson(join(dir, "leak.json"), details);
  const text = `${gateTable(rows)}\n`;
  writeText(join(dir, "leak.txt"), text);
  process.stdout.write(text);
  if (rows.some((row) => row.status === "fail")) process.exitCode = 1;
}

main().catch((error) => { process.stderr.write(`${(error as Error).stack ?? String(error)}\n`); process.exitCode = 1; });

// Training leak tests (SPEC §14.4).
// L1 (the AI's direction): battles A and B differ only in one hidden field H and replay the same choice strings for both
// seats; at every AI decision whose p2-channel history (without t: lines) is byte-identical in A and B, the AI's inputs
// (JSON) and its decision (choice string, report, engine calls, rollout samples) must be identical. Two settings must make
// a difference instead: aiKnows.exactHP for L1-hp and aiKnows.open.statPoints for L1-sp.
// L2 (your direction): with youSee closed, no posted battle message names an AI item, ability, move, nature or Stat Point
// the p1 channel has not shown, and no unbrought AI member is marked brought.
//   npx tsx scripts/training/leak.ts [--battles 40 (dice 60)] [--fields sp,nature,…] [--l2 40] [--seat safe]
import { join } from "node:path";
import { CLOSED_TEAM_SHEETS, DEFAULT_INFO } from "@/app/(app)/training/model/info";
import { l1Fields, runL1Field } from "./lib/leak-l1";
import { runL2 } from "./lib/leak-l2";
import type { SeatName } from "./lib/providers";
import { gateTable, parseArgs, writeJson, writeText, type GateRow } from "./lib/report";

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  // 40 battles per field compare at least 50 decisions for every field; the dice field (decisions with a shown sleep or
  // confusion only) needs 60 (integration runs, scripts/.cache/training/build/integrate/).
  const battles = Number(args.battles ?? 40);
  const seat = String(args.seat ?? "safe") as SeatName;
  const only = typeof args.fields === "string" ? String(args.fields).split(",") : null;
  const rows: GateRow[] = [];
  const details: Record<string, unknown> = {};
  for (const field of l1Fields().filter((each) => !only || only.includes(each.id))) {
    const result = await runL1Field(field, { battles: field.id === "dice" && args.battles === undefined ? 60 : battles, seat });
    details[field.id] = result;
    if (field.mustDiffer) rows.push({ gate: `L1-${field.id} (setting works)`, threshold: "inputs differ at compared decisions", result: `${result.inputDifferences}/${result.compared} differ`, status: result.compared > 0 && result.inputDifferences > 0 ? "pass" : "fail" });
    else rows.push({ gate: `L1-${field.id}`, threshold: "≥ 50 compared, 0 differences", result: `${result.differences} differences in ${result.compared}`, status: result.compared >= 50 && result.differences === 0 ? "pass" : "fail", detail: result.notes.join(" | ") });
  }
  const l2Battles = Number(args.l2 ?? 40);
  if (l2Battles > 0) {
    const l2 = await runL2({ battles: l2Battles, seat, info: { aiKnows: DEFAULT_INFO.aiKnows, youSee: CLOSED_TEAM_SHEETS } });
    details.L2 = l2;
    rows.push({ gate: "L2 (your direction, youSee closed)", threshold: "0 hits over 40 battles", result: `${l2.hits.length} hits in ${l2.messages} messages over ${l2.battles} battles (${l2.forfeits} forfeited on a locked turn)`, status: l2.hits.length === 0 && l2.errors.length === 0 && l2.battles >= Math.min(40, l2Battles) ? "pass" : "fail", detail: [...l2.hits.slice(0, 10), ...l2.errors.slice(0, 5)].join(" | ") });
  }
  const dir = join(process.cwd(), "scripts", ".cache", "training", "leak");
  writeJson(join(dir, "leak.json"), details);
  const text = `${gateTable(rows)}\n`;
  writeText(join(dir, "leak.txt"), text);
  process.stdout.write(text);
  if (rows.some((row) => row.status === "fail")) process.exitCode = 1;
}

main().catch((error) => { process.stderr.write(`${(error as Error).stack ?? String(error)}\n`); process.exitCode = 1; });

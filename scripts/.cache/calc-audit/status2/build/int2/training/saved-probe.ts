// Integration 2 probe: conformance check 9a's saved battles (scripts/training/lib/saved-check.ts runSavedCheck's first
// play of each battle, run "conformance-SVA-saved") one by one, printing each battle's end turn, forfeit, choice-line count,
// log hash and record size, so two processes can be compared (9a gave 6 forfeits and 44841 bytes in one conformance run,
// 5 and 42299 in the next).
//   TSX_TSCONFIG_PATH=tsconfig.json npx --no-install tsx saved-probe.ts [first=0] [last=29]
import { championsRuntime as runtime } from "@/app/lib/battle/runtime";
import { CLOSED_TEAM_SHEETS, DEFAULT_INFO, PERFECT_INFORMATION, type InfoSettings } from "@/app/(app)/training/model/info";
import { logHash } from "@/app/(app)/training/model/saved-battle";
import type { TrainingSetup } from "@/app/(app)/training/model/view-types";
import { createMemorySealer } from "@/app/(app)/training/worker/sealer";
import { playBattle } from "/home/user/pokedrafts/scripts/training/lib/saved-check";
import { parsePools, teamPair } from "/home/user/pokedrafts/scripts/training/lib/teams";

const INFOS: InfoSettings[] = [DEFAULT_INFO, { aiKnows: DEFAULT_INFO.aiKnows, youSee: CLOSED_TEAM_SHEETS }, { aiKnows: CLOSED_TEAM_SHEETS, youSee: PERFECT_INFORMATION }];
async function main() {
  const first = Number(process.argv[2] ?? 0), last = Number(process.argv[3] ?? 29);
  const run = "conformance-SVA-saved";
  const pools = parsePools("S,V,A");
  const sealer = createMemorySealer();
  for (let index = first; index <= last; index++) {
    const pair = teamPair(run, index, pools, runtime);
    const setup: TrainingSetup = { own: pair.p1.team, opponent: pair.p2.team, difficulty: index % 2 ? "reads" : "safe", showRead: true, info: INFOS[index % INFOS.length] };
    const forfeitTurn = index % 5 === 4 ? 3 : null;
    const a = await playBattle({ run, index, setup, seat: "safe", sealer, forfeitTurn });
    const finalLog = [...a.log.values()].sort((x, y) => x.turn - y.turn);
    const bytes = a.ended ? JSON.stringify({ setup, log: finalLog, inputLog: a.ended.inputLog, seed: a.ended.seed }).length : 0;
    const elapsed = finalLog.flatMap((turn) => JSON.stringify(turn).match(/"elapsedMs":[0-9.e-]+/g) ?? []).slice(0, 4).join(" ");
    console.log(`#${index} turn ${a.ended?.board.turn ?? "-"} forfeited ${!!a.ended?.ended?.forfeited} choices ${a.ended?.inputLog?.length ?? "-"} hash ${a.ended ? logHash(finalLog).slice(0, 12) : "-"} bytes ${bytes} errors ${a.errors.length} | ${elapsed}`);
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });

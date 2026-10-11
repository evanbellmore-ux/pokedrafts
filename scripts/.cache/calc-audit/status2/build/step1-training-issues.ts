// status2 Step 1: tally the engine's issue messages on Training's engine worlds (eval-ai's "engine issues"), over seat battles
// played with random legal choices (the bridge test's loop), every legal cell of each turn up to a cap.
//   npx --no-install tsx scripts/.cache/calc-audit/status2/build/step1-training-issues.ts [battles=6]
import { calculateDoublesOutcomes } from "@/app/lib/battle/doubles-turn";
import { createTurnServices } from "@/app/(app)/training/sim/services";
import { createRandom } from "@/app/(app)/training/model/random";
import { runtime, seatBattle } from "../../../../../tests/unit/training-sim-fixtures";
import { createChooser } from "../../../../../scripts/lib/showdown-sim/fixtures.mjs";

const hex = (n: number) => n.toString(16).padStart(32, "0");
const battles = Number(process.argv[2] ?? 6);
const tally = new Map<string, number>();
let cells = 0, engine = 0, issues = 0;
for (let k = 0; k < battles; k++) {
  const seat = seatBattle([k + 3, 5, 7, 11]);
  const choose = createChooser(k + 3);
  const random = createRandom("issues", k);
  let guard = 0;
  while (!seat.battle.ended && guard++ < 40) {
    const r1 = seat.battle.p1.activeRequest, r2 = seat.battle.p2.activeRequest;
    if (r1 && "active" in r1 && r2 && "active" in r2) {
      const services = createTurnServices(seat.inputs(), [seat.truthWorld(hex(guard))], { runtime, keys: seat.keys, seedBase: hex(k * 1000 + guard) });
      for (let n = 0; n < 12; n++) {
        const own = services.view.legal.own, ai = services.view.legal.opponent;
        const cell = { own: own[random.int(own.length)], opponent: ai[random.int(ai.length)] };
        cells++;
        const worlds = services.engineWorlds(cell);
        if (worlds.kind !== "engine") continue;
        for (const world of worlds.worlds) {
          engine++;
          const result = calculateDoublesOutcomes(world.input);
          if (result.status !== "issues") continue;
          issues++;
          const all = [...Object.values(result.issues.pokemon ?? {}).flat(), ...(result.issues.field ?? []), ...(result.issues.actions ?? [])] as { field?: string; message: string }[];
          for (const issue of all) tally.set(`${issue.field ?? ""} ${issue.message}`, (tally.get(`${issue.field ?? ""} ${issue.message}`) ?? 0) + 1);
        }
      }
    }
    seat.step(choose("p1", r1), choose("p2", r2));
  }
}
console.log(`${battles} battles: ${cells} cells, ${engine} engine worlds, ${issues} with issues`);
for (const [text, n] of [...tally].sort((a, b) => b[1] - a[1])) console.log(`  ${n}  ${text}`);

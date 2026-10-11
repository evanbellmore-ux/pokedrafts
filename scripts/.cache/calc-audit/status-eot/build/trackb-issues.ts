// Track B diagnostics: the E2 "issues" results Training's bridge inputs produce (eval reported "engine issues").
//   npx --no-install tsx scripts/.cache/calc-audit/status-eot/build/trackb-issues.ts [battles]
import { calculateDoublesOutcomes } from "@/app/lib/battle/doubles-turn";
import { createRandom } from "@/app/(app)/training/model/random";
import { createTurnServices } from "@/app/(app)/training/sim/services";
import { runtime, seatBattle } from "../../../../../tests/unit/training-sim-fixtures";
import { createChooser } from "../../../../lib/showdown-sim/fixtures.mjs";

const hex = (n: number) => n.toString(16).padStart(32, "0");
const counts = new Map<string, number>();
const examples = new Map<string, string>();
const battles = Number(process.argv[2] ?? 12);
for (let k = 0; k < battles; k++) {
  const seat = seatBattle([k + 101, 5, 7, 11]);
  const choose = createChooser(k + 101);
  const random = createRandom("trackb-issues", k);
  let guard = 0;
  while (!seat.battle.ended && guard++ < 60) {
    const r1 = seat.battle.p1.activeRequest, r2 = seat.battle.p2.activeRequest;
    const c1 = choose("p1", r1), c2 = choose("p2", r2);
    if (r1 && "active" in r1 && r2 && "active" in r2) {
      const inputs = seat.inputs();
      const services = createTurnServices(inputs, [seat.truthWorld(hex(guard))], { runtime, keys: seat.keys, seedBase: hex(k * 1000 + guard) });
      for (let n = 0; n < 20; n++) {
        const own = services.view.legal.own, ai = services.view.legal.opponent;
        const cell = { own: own[random.int(own.length)], opponent: ai[random.int(ai.length)] };
        const worlds = services.engineWorlds(cell);
        if (worlds.kind !== "engine") continue;
        for (const world of worlds.worlds) {
          const result = calculateDoublesOutcomes(world.input);
          if (result.status !== "issues") continue;
          const texts = [...Object.entries(result.issues.pokemon).flatMap(([slot, list]) => (list ?? []).map((each) => `${slot} ${each.field}: ${each.message}`)),
            ...result.issues.field.map((each) => `field ${each.field}: ${each.message}`), ...result.issues.actions.map((each) => `${each.slot} action: ${each.message}`)];
          for (const text of texts) {
            const key = text.replace(/\d+/g, "N");
            counts.set(key, (counts.get(key) ?? 0) + 1);
            if (!examples.has(key)) examples.set(key, `${text} | carried ${JSON.stringify(Object.fromEntries(Object.entries(world.input.pokemon).map(([s, p]) => [s, p?.carried])))} status ${JSON.stringify(Object.fromEntries(Object.entries(world.input.pokemon).map(([s, p]) => [s, p?.build.status])))}`);
          }
        }
      }
    }
    seat.step(c1, c2);
  }
}
for (const [key, count] of [...counts].sort((a, b) => b[1] - a[1])) console.log(count, key, "\n   ", examples.get(key));
console.log("done");

// Track B diagnostics: E2 "issues" on the AI's own belief worlds in real eval matches (safe vs maxdamage, open sheets).
//   npx --no-install tsx scripts/.cache/calc-audit/status-eot/build/trackb-issues2.ts [battles]
import { calculateDoublesOutcomes } from "@/app/lib/battle/doubles-turn";
import { championsRuntime as runtime } from "@/app/lib/battle/runtime";
import { CLOSED_TEAM_SHEETS, DEFAULT_INFO } from "@/app/(app)/training/model/info";
import { createRandom, seedHex } from "@/app/(app)/training/model/random";
import { createTurnServices } from "@/app/(app)/training/sim/services";
import { memberKeys, toShowdownTeam } from "@/app/(app)/training/sim/showdown-set";
import { loadTrainingUsage } from "@/app/(app)/training/usage/training-usage";
import { runMatch } from "../../../../training/lib/match";
import { createSeat, ensureSeats } from "../../../../training/lib/providers";
import { mirroredPair, parsePools, teamPair } from "../../../../training/lib/teams";

async function main() {
  const battles = Number(process.argv[2] ?? 20);
  await ensureSeats(["safe", "maxdamage", "random"]);
  const usage = loadTrainingUsage();
  const counts = new Map<string, number>();
  const examples = new Map<string, string>();
  const only = process.argv.find((arg) => arg.startsWith("--index="));
  for (let index = 0; index < battles; index++) {
    if (only && Number(only.split("=")[1]) !== index) continue;
    const run = process.argv.find((arg) => arg.startsWith("--run="))?.split("=")[1];
    const pair = run ? mirroredPair(run, index, parsePools("S,V"), runtime) : teamPair("trackb-issues", index, parsePools("S,V"), runtime);
    const adapted = { p1: toShowdownTeam(pair.p1.team.members, runtime), p2: toShowdownTeam(pair.p2.team.members, runtime) };
    const keys = memberKeys(adapted.p1, adapted.p2);
    const random = createRandom("trackb-issues", index);
    await runMatch({
      seats: { p1: createSeat((process.argv.find((arg) => arg.startsWith("--seat="))?.split("=")[1] ?? (process.argv.includes("--closed") ? "random" : "maxdamage")) as "random", runtime, null), p2: createSeat("safe", runtime, null) },
      teams: { p1: pair.p1.team, p2: pair.p2.team }, info: process.argv.includes("--closed") ? { aiKnows: CLOSED_TEAM_SHEETS, youSee: CLOSED_TEAM_SHEETS } : DEFAULT_INFO, runtime, usage, seedRun: process.argv.find((arg) => arg.startsWith("--run="))?.split("=")[1] ?? "trackb-issues", index,
      observer: {
        services(side, inputs, worlds) {
          if (side !== "p2" || !worlds.length || !("active" in inputs.request)) return;
          const services = createTurnServices(inputs, worlds, { runtime, keys, seedBase: seedHex("trackb-issues", index, inputs.requestId) });
          const { own, opponent } = services.view.legal;
          for (const cell of own.flatMap((a) => opponent.map((b) => ({ own: a, opponent: b })))) {
            const engine = services.engineWorlds(cell);
            if (engine.kind !== "engine") continue;
            for (const world of engine.worlds) {
              const result = calculateDoublesOutcomes(world.input);
              if (result.status !== "issues") continue;
              const texts = [...Object.entries(result.issues.pokemon).flatMap(([slot, list]) => (list ?? []).map((each) => `${slot} ${each.field}: ${each.message}`)),
                ...result.issues.field.map((each) => `field ${each.field}: ${each.message}`), ...result.issues.actions.map((each) => `${each.slot} action: ${each.message}`)];
              for (const text of texts) {
                const key = text.replace(/\d+/g, "N");
                counts.set(key, (counts.get(key) ?? 0) + 1);
                if (!examples.has(key)) {
                  const slot = text.split(" ")[0] as keyof typeof world.input.pokemon;
                  const entry = world.input.pokemon[slot];
                  examples.set(key, `${text} | ${entry?.build.speciesId} status ${entry?.build.status} carried ${JSON.stringify(entry?.carried)} lastMove ${entry?.lastMove} moves ${JSON.stringify(entry?.moves)}`);
                }
              }
            }
          }
        },
      },
    });
  }
  for (const [key, count] of [...counts].sort((a, b) => b[1] - a[1])) console.log(count, key, "\n   ", examples.get(key));
  console.log("done");
}
void main();

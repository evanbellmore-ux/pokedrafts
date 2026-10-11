// Debug conformance gate 2b/2c on pool E: replay battle #N of a conformance run (perfect mode), and at the decision of
// turn T print the real battle's log since the last turn, both p2 requests (real, belief) and the AI's public volatiles.
//   npx --no-install tsx scripts/.cache/calc-audit/status-eot/build/fix-eot-equiv-debug.ts <index> <turn> [run] [pools]
import { State } from "@pokedrafts/showdown-sim";
import { championsRuntime as runtime } from "@/app/lib/battle/runtime";
import { PERFECT_INFORMATION, DEFAULT_INFO } from "@/app/(app)/training/model/info";
import { seedHex } from "@/app/(app)/training/model/random";
import { buildBeliefBattle } from "@/app/(app)/training/sim/belief-battle";
import { memberKeys, toShowdownTeam } from "@/app/(app)/training/sim/showdown-set";
import { loadTrainingUsage } from "@/app/(app)/training/usage/training-usage";
import type { AiInputs, BeliefWorld } from "@/app/(app)/training/model/ai-inputs";
import { runMatch } from "../../../../training/lib/match";
import { createSeat, ensureSeats } from "../../../../training/lib/providers";
import { parsePools, teamPair } from "../../../../training/lib/teams";
import { realBattle } from "../../../../training/lib/oracle";

const [indexArg, turnArg, run = "conformance-E", poolsArg = "E", side = "p2"] = process.argv.slice(2);
const index = Number(indexArg), wantTurn = Number(turnArg);
(async () => {
  await ensureSeats(["maxdamage", "random"]);
  const pools = parsePools(poolsArg);
  const pair = teamPair(run, index, pools, runtime);
  const adapted = { p1: toShowdownTeam(pair.p1.team.members, runtime), p2: toShowdownTeam(pair.p2.team.members, runtime) };
  const keys = memberKeys(adapted.p1, adapted.p2);
  let pending: AiInputs | null = null;
  let lastLog = 0;
  await runMatch({
    seats: { p1: createSeat("random", runtime, null), p2: createSeat("maxdamage", runtime, null) },
    teams: { p1: pair.p1.team, p2: pair.p2.team }, info: { aiKnows: PERFECT_INFORMATION, youSee: DEFAULT_INFO.youSee }, runtime, usage: loadTrainingUsage(), seedRun: `${run}:perfect`, index,
    observer: {
      inputs(s, _kind, inputs) { if (s === "p2") pending = inputs; },
      committing(host) {
        const battle = realBattle(host);
        const inputs = pending;
        if (battle.turn === wantTurn && inputs) {
          const brought = battle.p1.pokemon.map((pokemon) => keys.keyOf("p1", pokemon.name));
          const sets = Object.fromEntries(adapted.p1.sets.filter(({ key }) => brought.includes(key)).map(({ key, set }) => [key, set]));
          const truth: BeliefWorld = { weight: 1, brought, sets, hp: "midpoint", seed: seedHex(run, index, host.requestId, "truth") };
          const belief = buildBeliefBattle(inputs, truth, runtime);
          console.log(`--- ${pair.p1.id} v ${pair.p2.id} #${index} turn ${battle.turn} log since last decision:`);
          console.log(battle.log.slice(lastLog).filter((line) => !line.startsWith("|t:|")).join("\n"));
          const real = host.request(side as "p1" | "p2") as { active?: unknown };
          const built = (belief.battle[side as "p1" | "p2"] as { activeRequest?: { active?: unknown } }).activeRequest;
          console.log("REAL active:", JSON.stringify(real?.active));
          console.log("BELIEF active:", JSON.stringify(built?.active));
          for (const p of battle[side as "p1" | "p2"].active) if (p) console.log("real", p.name, "item", p.item, "volatiles", JSON.stringify(Object.fromEntries(Object.entries(p.volatiles).map(([k, v]) => [k, { ...(v as object), target: undefined, source: undefined, sourceEffect: undefined }]))));
          for (const p of belief.battle[side as "p1" | "p2"].active) if (p) console.log("belief", p.name, "item", p.item, "volatiles", JSON.stringify(Object.fromEntries(Object.entries(p.volatiles).map(([k, v]) => [k, { ...(v as object), target: undefined, source: undefined, sourceEffect: undefined }]))));
          for (const mon of Object.values(inputs.public.mons)) if (mon.position !== null && mon.side === side) console.log("public", mon.key, "item", JSON.stringify((mon as { item?: unknown }).item), "volatiles", JSON.stringify(mon.volatiles), "lastMove", mon.lastMove);
          void State;
          process.exit(0);
        }
        lastLog = battle.log.length;
      },
    },
  });
})();

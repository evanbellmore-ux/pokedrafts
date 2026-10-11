// How many conformance battles draw a pool E team (lib/teams.ts teamPair over the run's pools).
import { championsRuntime as runtime } from "@/app/lib/battle/runtime";
import { parsePools, teamPair } from "../../../../training/lib/teams";
const run = process.argv[2] ?? "conformance-SVAE", battles = Number(process.argv[3] ?? 40);
const pools = parsePools(process.argv[4] ?? "S,V,A,E");
const hits: string[] = [];
for (let index = 0; index < battles; index++) {
  const pair = teamPair(run, index, pools, runtime);
  if (pair.p1.id.startsWith("E") || pair.p2.id.startsWith("E")) hits.push(`#${index} ${pair.p1.id} v ${pair.p2.id}`);
}
console.log(`${hits.length}/${battles} battles with a pool E team: ${hits.join(", ")}`);

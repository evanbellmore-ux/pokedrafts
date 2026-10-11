// Integration 1a: the two teams of an eval battle index (lib/teams.ts mirroredPair), species, ability, item and moves.
import { championsRuntime as runtime } from "@/app/lib/battle/runtime";
import { mirroredPair, parsePools } from "@/scripts/training/lib/teams";
const [index, pools = "S,V"] = process.argv.slice(2);
const pair = mirroredPair("s1-step1", Number(index), parsePools(pools), runtime);
for (const side of ["p1", "p2"] as const) {
  console.log(`${side} ${pair[side].id}`);
  for (const m of pair[side].team.members as any[]) console.log(`  ${m.build?.speciesId ?? m.speciesId} [${m.build?.abilityId ?? m.abilityId}/${m.build?.itemId ?? m.itemId}] ${m.moves.map((s: any) => s.moveId).join(",")}`);
}

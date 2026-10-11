// R-U probe: the calculator's bench state through getDoublesTurnInput into the engine (validation and the stub's results).
import { createDoubles, getDoublesTurnInput, type DoublesMatchup } from "../../../../../../app/(app)/calculator/doubles-prep";
import { addBenchEntry, setBenchHazards, setBenchPick, type DoublesBenchEntry } from "../../../../../../app/(app)/calculator/doubles-inputs";
import { calculateDoublesTurn } from "../../../../../../app/lib/battle/doubles-turn";
import { loadBattleRuntime } from "../../../../../../app/lib/battle/load-runtime";
import { createBuild } from "../../../../../../app/lib/battle/model";
import type { BattleGame } from "../../../../../../app/lib/battle/types";

async function main() {
  for (const game of ["champions", "scarlet_violet", "sword_shield", "ultra_sun_ultra_moon"] as BattleGame[]) {
    const runtime = await loadBattleRuntime(game);
    let doubles: DoublesMatchup = createDoubles(0, runtime);
    const pick = (id: string) => runtime.speciesById.has(id) ? id : runtime.catalog.species.find((s) => !s.battleForm && !s.unsupported.length)!.id;
    const entry = (id: string, n: number): DoublesBenchEntry => ({
      key: `probe-${n}`, base: createBuild(pick(id), runtime), moves: [],
      source: { kind: "paste", key: `probe-${n}`, name: id, speciesId: pick(id), runtimeIdentity: runtime.identity, role: "own", importId: "x", index: n },
    });
    doubles = addBenchEntry("own", entry("corviknight", 1), [])(doubles);
    doubles = addBenchEntry("own", entry("snorlax", 2), [])(doubles);
    doubles = setBenchPick("own-left", "probe-2")(doubles);
    doubles = setBenchHazards("own", { stealthRock: true, spikes: 2 })(doubles);
    const uturn = runtime.speciesById.get(doubles.slots["own-left"].build.speciesId)!.moves.includes("uturn");
    doubles = { ...doubles, actions: { ...doubles.actions, "own-left": { moveId: uturn ? "uturn" : null, target: uturn ? "opponent-left" : null } } };
    const input = getDoublesTurnInput(doubles);
    const result = calculateDoublesTurn(input);
    console.log(game, JSON.stringify({ bench: Object.keys(input.bench ?? {}), replacement: input.replacement, hazards: input.hazards, status: result.status,
      issues: result.status === "issues" ? result.issues : undefined, reason: result.status === "not-estimated" ? result.reason : undefined,
      facts: result.status === "ready" ? result.facts : undefined }));
  }
}
main();

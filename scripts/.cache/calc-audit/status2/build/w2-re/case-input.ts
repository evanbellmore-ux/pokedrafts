// Prints a stored case's app input (pokemon moves, bench, replacement, hazards) and the app's turn summary.
import { CASES } from "../../../2v2/verify/cases";
import { caseInput, runtimeFor } from "../../../2v2/verify/app-turn";
import { calculateDoublesTurn } from "@/app/lib/battle/doubles-turn";
import { show } from "./kit";
(async () => {
  for (const id of process.argv.slice(2)) {
    const c = CASES.find((each) => each.id === id)!;
    const input = caseInput(c, await runtimeFor(c));
    console.log(id, JSON.stringify(Object.fromEntries(Object.entries(input.pokemon).map(([slot, p]) => [slot, p && { species: p.build.speciesId, ability: p.build.abilityId, item: p.build.itemId, hp: p.build.currentHP, action: p.action, moves: p.moves, carried: p.carried }]))));
    console.log(" bench", JSON.stringify(input.bench && Object.fromEntries(Object.entries(input.bench).map(([side, list]) => [side, list!.map((b) => ({ id: b.id, species: b.build.speciesId, hp: b.build.currentHP, status: b.build.status, moves: b.moves }))]))), "replacement", JSON.stringify(input.replacement), "hazards", JSON.stringify(input.hazards));
    console.log(show(calculateDoublesTurn(input)));
  }
})();

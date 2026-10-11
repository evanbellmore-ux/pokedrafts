// Track U1: the 2v2 turn after "Apply Trace's Intimidate to both foes" (doubles-prep applyDoublesIntimidate). Today the
// settle (doubles-start.ts settleDoublesStart) gives "Trace copying Intimidate is not modelled in 2v2." whatever the holder
// stored; with the integrator's one line (W1A-U1.md) the turn is estimated with the holder as Intimidate.
//   npx --no-install tsx scripts/.cache/calc-audit/status2/build/u1-trace-settle.ts
import { applyDoublesIntimidate, createDoubles, getDoublesTurnInput, updateDoublesBuild, type CalculatorState } from "@/app/(app)/calculator/doubles-prep";
import { createMatchup } from "@/app/(app)/calculator/roster-prep";
import { calculateDoublesTurn } from "@/app/lib/battle/doubles-turn";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild } from "@/app/lib/battle/model";

(async () => {
  const runtime = await loadBattleRuntime("scarlet_violet");
  let state: CalculatorState = { matchup: createMatchup(0, runtime), doubles: createDoubles(0, runtime) };
  const put = (slot: "own-left" | "opponent-left" | "opponent-right", id: string, abilityId: string) => {
    state = updateDoublesBuild(state, state.doubles.slots[slot].key, { ...createBuild(id, runtime), abilityId });
  };
  put("own-left", "gardevoir", "trace");
  put("opponent-left", "incineroar", "intimidate");
  put("opponent-right", "gyarados", "intimidate");
  const before = calculateDoublesTurn(getDoublesTurnInput(state.doubles));
  state = applyDoublesIntimidate(state, state.doubles.slots["own-left"].key);
  const after = calculateDoublesTurn(getDoublesTurnInput(state.doubles));
  const show = (turn: ReturnType<typeof calculateDoublesTurn>) => turn.status === "not-estimated" ? `not-estimated: ${turn.reason}` : turn.status === "ready" ? `ready; facts: ${turn.facts.join(" | ")}` : `issues: ${JSON.stringify(turn.issues)}`;
  console.log("before apply:", show(before));
  console.log("stored:", state.doubles.slots["own-left"].build.copiedIntimidateStored, "foes atk", state.doubles.slots["opponent-left"].build.boosts.atk, state.doubles.slots["opponent-right"].build.boosts.atk);
  console.log("after apply:", show(after));
})();

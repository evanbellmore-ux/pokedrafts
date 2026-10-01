import { describe, expect, it, vi } from "vitest";
import { calculateMatchup } from "@/app/lib/battle/calculate";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { activateMoveSlot, createMatchup, getAttackView, getMoveOwner, getTeamSourceOwner, selectMatchupMove, swapMatchup, updateImportDraft, updateMatchupBuild, updateMatchupHP, updateMatchupMoveContext, type PreparedMatchup } from "@/app/(app)/calculator/roster-prep";
import { useMatchupCalculation } from "@/app/(app)/calculator/useMatchupCalculation";

/**
 * React's memo and deferred-value rules across renders, without a DOM: useMemo keeps its value while every
 * dependency is the same (Object.is); useDeferredValue gives an urgent render the value it last settled on
 * and schedules a background render with the new one.
 */
const hooks = vi.hoisted(() => ({ slots: [] as { deps?: readonly unknown[]; value: unknown }[], index: 0, urgent: true, pending: false }));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useMemo: <T>(create: () => T, deps: readonly unknown[]): T => {
      const index = hooks.index++;
      const slot = hooks.slots[index];
      if (slot?.deps && slot.deps.length === deps.length && slot.deps.every((dep, at) => Object.is(dep, deps[at]))) return slot.value as T;
      const value = create();
      hooks.slots[index] = { deps, value };
      return value;
    },
    useDeferredValue: <T>(value: T): T => {
      const index = hooks.index++;
      const slot = hooks.slots[index];
      if (slot && hooks.urgent && !Object.is(slot.value, value)) {
        hooks.pending = true;
        return slot.value as T;
      }
      hooks.slots[index] = { value };
      return value;
    },
  };
});

const calculate = vi.fn(calculateMatchup);
// Called through a plain name: these renders are the harness's, not a component's.
const calculation = useMatchupCalculation;
/** One state update: the urgent render, then the background render a changed deferred value schedules. */
function render(matchup: PreparedMatchup) {
  Object.assign(hooks, { index: 0, urgent: true, pending: false });
  const urgent = calculation(calculate, matchup, getAttackView(matchup));
  if (!hooks.pending) return { urgent, settled: urgent };
  Object.assign(hooks, { index: 0, urgent: false });
  return { urgent, settled: calculation(calculate, matchup, getAttackView(matchup)) };
}
function start(matchup: PreparedMatchup) {
  hooks.slots = [];
  calculate.mockClear();
  return render(matchup).settled;
}

describe("Calculator recalculation", () => {
  it("keeps the result when a move row is selected or an import draft is typed", () => {
    const matchup = createMatchup();
    const first = start(matchup);
    expect(calculate).toHaveBeenCalledTimes(1);
    expect(first?.result?.results.length).toBeGreaterThan(0);
    const owner = getAttackView(matchup).owner;
    const moveIds = first!.result!.results.map((row) => row.moveId);
    let current = matchup;
    for (const moveId of moveIds.slice(0, 5)) {
      current = selectMatchupMove(current, moveId, owner);
      expect(render(current).settled).toBe(first);
    }
    for (const text of ["P", "Pi", "Pik"]) {
      current = updateImportDraft(current, getTeamSourceOwner(current, "own"), { text, url: "", title: "", format: "traditional" });
      expect(getAttackView(current)).not.toBe(getAttackView(matchup));
      expect(render(current).settled).toBe(first);
    }
    expect(calculate).toHaveBeenCalledTimes(1);
  });

  it("keeps the result when the right Pokémon attacks, though its side conditions are swapped into a new field each time", () => {
    const matchup = activateMoveSlot(createMatchup(), getMoveOwner(createMatchup().defender), 0);
    const view = getAttackView(matchup);
    expect(view.sourceSide).toBe("defender");
    expect(getAttackView(matchup).field).not.toBe(view.field);
    const first = start(matchup);
    expect(first?.identity).toEqual({ source: view.owner, receiver: view.receiverOwner });
    const moveId = first!.result!.results.at(-1)!.moveId;
    expect(render(selectMatchupMove(matchup, moveId, view.owner)).settled).toBe(first);
    expect(calculate).toHaveBeenCalledTimes(1);
  });

  it("recalculates in the background when the same two Pokémon change, and at once for a new pair", async () => {
    const sv = await loadBattleRuntime("scarlet_violet");
    const matchup = createMatchup(0, sv);
    const first = start(matchup);
    const view = getAttackView(matchup);
    // Typing the receiving Pokémon's HP: the urgent render keeps the last rows, the background render has the new ones.
    const typed = updateMatchupHP(matchup, "defender", "100");
    const { urgent, settled } = render(typed);
    expect(urgent).toBe(first);
    expect(settled).not.toBe(first);
    expect(calculate).toHaveBeenCalledTimes(2);
    expect(calculate.mock.lastCall![1].currentHP).toBe(100);
    // A hit count is a calculation input too.
    const moveId = first!.result!.results[0].moveId;
    const context = updateMatchupMoveContext(typed, view.owner, moveId, { hits: 2 });
    expect(render(context).urgent).toBe(settled);
    expect(calculate).toHaveBeenCalledTimes(3);
    // Swapping the Pokémon is a new pair: calculated in the urgent render, never the last pair's rows.
    const swapped = swapMatchup(context);
    const pair = render(swapped);
    expect(pair.urgent).toBe(pair.settled);
    expect(pair.urgent?.identity).toEqual({ source: getAttackView(swapped).owner, receiver: getAttackView(swapped).receiverOwner });
    expect(calculate).toHaveBeenCalledTimes(4);
    // So is a new Pokémon (a species change starts a new move epoch).
    const garchomp = updateMatchupBuild(swapped, "attacker", { ...swapped.attacker.build, speciesId: "garchomp" });
    expect(render(garchomp).urgent?.identity.source).toEqual(getAttackView(garchomp).owner);
    expect(calculate).toHaveBeenCalledTimes(5);
  });

  it("returns nothing until the calculator loads, and the error when the calculation throws", () => {
    hooks.slots = [];
    const matchup = createMatchup();
    Object.assign(hooks, { index: 0, urgent: true, pending: false });
    expect(calculation(null, matchup, getAttackView(matchup))).toBeNull();
    hooks.slots = [];
    Object.assign(hooks, { index: 0, urgent: true, pending: false });
    const failing = vi.fn((): never => { throw new Error("Engine unavailable."); });
    expect(calculation(failing, matchup, getAttackView(matchup))).toMatchObject({ result: null, error: "Engine unavailable." });
  });
});

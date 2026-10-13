import { describe, expect, it } from "vitest";
import type { AiInputs } from "@/app/(app)/training/model/ai-inputs";
import type { DecisionProvider } from "@/app/(app)/training/model/decision";
import { DEFAULT_INFO } from "@/app/(app)/training/model/info";
import type { FromWorker } from "@/app/(app)/training/model/worker-protocol";
import type { JointAction, TrainingSetup, TrainingTeam } from "@/app/(app)/training/model/view-types";
import { createStubProvider } from "@/app/(app)/training/worker/stub-provider";
import { createTrainingWorker } from "@/app/(app)/training/worker/worker-handler";
import { memberFromSet } from "./training-sim-fixtures";

/**
 * status2 Track R-T: the worker tells the AI seat's tracker its own accepted choices (PublicTracker.chose), so the AI's
 * inputs keep the target its move was chosen at where the move's line names none: Future Sight into a slot that already holds
 * one prints `|move|p2a: Farigiraf|Future Sight||[still]` (pinned sim/battle.ts attrLastMove blanks the target), while
 * Showdown's lastMoveTargetLoc is the chosen slot (INTEGRATION-1B open item 3).
 */
const IV = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const set = (species: string, ability: string, moves: string[]) =>
  ({ name: species, species, item: "", ability, moves, nature: "Serious", evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: IV, level: 50, gender: "M" });
const teamOf = (label: string, sets: ReturnType<typeof set>[]): TrainingTeam => ({ label, members: sets.map((each) => memberFromSet(each as never)) });
const flush = async (times = 8) => { for (let i = 0; i < times; i++) await new Promise((resolve) => setTimeout(resolve, 0)); };

describe("the worker's AI seat keeps its own chosen targets", () => {
  it("a second Future Sight at the same slot ([still], no target in its line): the next decision's inputs name the chosen slot", async () => {
    const seen: AiInputs[] = [];
    const stub = createStubProvider(null);
    const action: JointAction = { "opponent-right": { kind: "move", moveId: "futuresight", target: "own-left" }, "opponent-left": { kind: "move", moveId: "protect", target: null } };
    const provider: DecisionProvider = {
      ...stub,
      async chooseTurn(context, options) {
        seen.push(structuredClone(context.inputs));
        const decision = await stub.chooseTurn(context, options);
        return { ...decision, action };
      },
    };
    const posted: FromWorker[] = [];
    let hex = 0;
    const worker = createTrainingWorker({ post: (message) => posted.push(structuredClone(message)), createProvider: () => provider, now: () => 0, randomHex: () => (++hex).toString(16).padStart(32, "0"), deadlineMs: null });
    const last = () => posted.filter((m): m is Extract<FromWorker, { type: "battle" }> => m.type === "battle").at(-1)!;
    const setup: TrainingSetup = {
      own: teamOf("You", [set("Snorlax", "Thick Fat", ["Rest", "Protect"]), set("Corviknight", "Pressure", ["Roost", "Protect"]), set("Garchomp", "Rough Skin", ["Dragon Claw", "Protect"]), set("Incineroar", "Intimidate", ["Fake Out", "Protect"]), set("Gyarados", "Intimidate", ["Waterfall", "Protect"]), set("Gengar", "Cursed Body", ["Shadow Ball", "Protect"])]),
      opponent: teamOf("AI", [set("Farigiraf", "Armor Tail", ["Future Sight", "Protect"]), set("Snorlax", "Thick Fat", ["Rest", "Protect"]), set("Corviknight", "Pressure", ["Roost", "Protect"]), set("Kingambit", "Defiant", ["Iron Head", "Protect"]), set("Garchomp", "Rough Skin", ["Dragon Claw", "Protect"]), set("Sinistcha", "Hospitality", ["Matcha Gotcha", "Protect"])]),
      difficulty: "safe", showRead: false, info: DEFAULT_INFO,
    };
    worker.receive({ type: "start", battleId: 1, setup, habits: null });
    await flush();
    if (!posted.some((m) => m.type === "battle")) throw new Error(JSON.stringify(posted).slice(0, 800));
    worker.receive({ type: "choose", battleId: 1, requestId: last().request!.id, choice: { kind: "team", order: [1, 2, 3, 4] } });
    await flush();
    const protect: JointAction = { "own-left": { kind: "move", moveId: "protect", target: null }, "own-right": { kind: "move", moveId: "protect", target: null } };
    for (let turn = 0; turn < 2; turn++) {
      worker.receive({ type: "choose", battleId: 1, requestId: last().request!.id, choice: { kind: "action", action: protect } });
      await flush();
    }
    expect(seen).toHaveLength(3);
    // After turn 1 the line named Snorlax; after turn 2's failed Future Sight it named none, and the choice still stands.
    expect(seen[1].public.mons["p2:farigiraf"].lastMoveTarget).toEqual({ side: "p1", position: 0 });
    expect(seen[2].public.mons["p2:farigiraf"].lastMove).toBe("futuresight");
    expect(seen[2].public.mons["p2:farigiraf"].lastMoveTarget).toEqual({ side: "p1", position: 0 });
  });
});

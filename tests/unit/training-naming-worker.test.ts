import { describe, expect, it } from "vitest";
import { championsRuntime as runtime } from "@/app/lib/battle/runtime";
import { jointText, occupantNames, turnNames } from "@/app/(app)/training/log/report-format";
import type { DecisionProvider } from "@/app/(app)/training/model/decision";
import { CLOSED_TEAM_SHEETS, DEFAULT_INFO } from "@/app/(app)/training/model/info";
import { createRandom } from "@/app/(app)/training/model/random";
import type { ShowdownRequest } from "@/app/(app)/training/model/showdown-types";
import type { BoardView, JointAction, LogTurn, PlayerChoice, TrainingRequest, TrainingSetup, TrainingTeam } from "@/app/(app)/training/model/view-types";
import type { FromWorker } from "@/app/(app)/training/model/worker-protocol";
import { identName, legalJointActions } from "@/app/(app)/training/sim/choices";
import { memberKeys, toShowdownTeam } from "@/app/(app)/training/sim/showdown-set";
import { createStubProvider } from "@/app/(app)/training/worker/stub-provider";
import { createTrainingWorker } from "@/app/(app)/training/worker/worker-handler";
import { fixtureTeam } from "../fixtures/training-teams";

// Naming review T1 and T2 (scripts/.cache/naming/RULES.md §1.2-1.3, §3.4): the AI's read and the actions name each slot
// by its Pokémon on the board the turn was chosen on (LogTurn.names), so a later Transform, Mega Evolution or switch never
// renames an earlier turn; an Illusion beside the Pokémon it copies is that member in the occupants (never the tracker's
// "?illusion" placeholder), so both look-alikes are numbered as the log numbers them. The real worker with the stub AI.

type BattleMessage = Extract<FromWorker, { type: "battle" }>;
const SETS = {
  ditto: "Ditto @ Choice Scarf; Limber; Hardy 32/0/0/0/0/32; Transform",
  garchomp: "Garchomp @ Life Orb; Rough Skin; Jolly 2/32/0/0/0/32; Dragon Claw / Earthquake / Rock Slide / Protect",
  farigiraf: "Farigiraf @ Sitrus Berry; Armor Tail; Quiet 32/0/2/32/0/0; Ally Switch / Wish / Psychic / Protect",
  charizard: "Charizard @ Charizardite Y; Blaze; Timid 2/0/0/32/0/32; Heat Wave / Weather Ball / Solar Beam / Protect",
  incineroar: "Incineroar @ Shuca Berry; Intimidate; Careful 32/0/14/0/20/0; Fake Out / Parting Shot / Flare Blitz / Throat Chop",
  sneasler: "Sneasler @ White Herb; Unburden; Jolly 2/32/0/0/0/32; Fake Out / Close Combat / Dire Claw / Protect",
  whimsicott: "Whimsicott @ Mental Herb; Prankster; Timid 2/0/0/32/0/32; Tailwind / Moonblast / Encore / Protect",
  zoroark: "Zoroark @ Focus Sash; Illusion; Timid 2/0/0/32/0/32; Night Daze / Flamethrower / Focus Blast / Protect",
  kingambit: "Kingambit @ Black Glasses; Defiant; Adamant 32/32/0/0/2/0; Kowtow Cleave / Sucker Punch / Iron Head / Protect",
  aiGarchomp: "Garchomp @ Rocky Helmet; Rough Skin; Jolly 0/30/4/0/0/32; Dragon Claw / Earthquake / Stomping Tantrum / Protect",
  absol: "Absol @ Absolite; Pressure; Adamant 2/32/0/0/0/32; Sucker Punch / Night Slash / Close Combat / Protect",
  gardevoir: "Gardevoir @ Wise Glasses; Trace; Modest 32/0/2/32/0/0; Hyper Voice / Psychic / Moonblast / Dazzling Gleam",
  aiIncineroar: "Incineroar @ Sitrus Berry; Intimidate; Careful 32/0/14/0/20/0; Fake Out / Parting Shot / Flare Blitz / Protect",
  pelipper: "Pelipper @ Damp Rock; Drizzle; Modest 32/0/1/5/17/11; Hurricane / Weather Ball / Tailwind / Wide Guard",
};
const team = (id: string, sets: string[]): TrainingTeam => fixtureTeam({ id, pool: "V", sets }, runtime);
const setupOf = (own: string[], opponent: string[]): TrainingSetup => ({
  own: team("Mine", own), opponent: team("AI", opponent), difficulty: "safe", showRead: true, info: { aiKnows: DEFAULT_INFO.aiKnows, youSee: CLOSED_TEAM_SHEETS },
});

type Script = {
  setup: TrainingSetup; ownOrder: number[]; aiOrder: number[];
  /** Your action for a move request (null: a seeded legal one). */
  pick(request: TrainingRequest, board: BoardView, legal: JointAction[]): JointAction | null;
  /** The AI's replacement (null: the stub's first legal one). */
  aiReplace?(slots: readonly string[]): JointAction | null;
  /** Stop once a move request for this turn arrives. */
  untilTurn: number;
};

function legalFor(request: TrainingRequest, board: BoardView, own: TrainingTeam): JointAction[] {
  if (request.kind !== "move" && request.kind !== "switch") return [];
  const adapted = toShowdownTeam(own.members, runtime);
  const keys = memberKeys(adapted, adapted);
  const side = { name: "You", id: "p1" as const, pokemon: request.side };
  const raw: ShowdownRequest = request.kind === "move" ? { active: request.active, side } : { forceSwitch: request.forceSwitch, side };
  const bench = request.side.filter((pokemon) => !pokemon.active && !pokemon.condition.endsWith(" fnt")).map((pokemon) => keys.keyOf("p1", identName(pokemon.ident)));
  return legalJointActions({ side: "p1", aiSide: "p2", request: raw, bench, firstTurn: [board.turn === 1, board.turn === 1], megaUsed: board.megaUsed.own, keys });
}

/** Plays the script in the real worker; every battle message, in order. */
async function play(script: Script): Promise<BattleMessage[]> {
  const inbox: FromWorker[] = [];
  const stub = createStubProvider(null);
  const provider: DecisionProvider = {
    ...stub,
    async teamPreview(context, options) { return { ...(await stub.teamPreview(context, options)), order: script.aiOrder }; },
    async chooseReplacements(context, options) {
      const forced = script.aiReplace?.(context.slots);
      return forced ? { action: forced } : stub.chooseReplacements(context, options);
    },
  };
  let hex = 0;
  const worker = createTrainingWorker({
    post: (message) => inbox.push(structuredClone(message)), createProvider: () => provider, now: () => 0,
    randomHex: () => (++hex).toString(16).padStart(32, "0"), deadlineMs: null,
  });
  const messages: BattleMessage[] = [];
  const random = createRandom("naming-worker", 0, "p1");
  worker.receive({ type: "start", battleId: 1, setup: script.setup, habits: null });
  let answered = -1;
  for (let wait = 0; wait < 4000; wait++) {
    const message = inbox.shift();
    if (!message) { await new Promise((resolve) => setTimeout(resolve, 0)); continue; }
    if (message.type === "battle-error") throw new Error(message.message);
    if (message.type !== "battle") continue;
    messages.push(message);
    const request = message.request;
    if (message.ended || !request || request.kind === "wait" || request.id === answered) continue;
    if (request.kind === "move" && message.board.turn >= script.untilTurn) break;
    answered = request.id;
    let choice: PlayerChoice;
    if (request.kind === "team-preview") choice = { kind: "team", order: script.ownOrder };
    else {
      const legal = legalFor(request, message.board, script.setup.own);
      const picked = request.kind === "move" ? script.pick(request, message.board, legal) : null;
      choice = { kind: "action", action: picked ?? legal[random.int(legal.length)] ?? {} };
    }
    worker.receive({ type: "choose", battleId: 1, requestId: request.id, choice });
  }
  worker.receive({ type: "stop", battleId: 1 });
  return messages;
}

const moveOf = (action: JointAction[keyof JointAction], id: string) => action?.kind === "move" && action.moveId === id;
/** The board each turn's actions were chosen on: the one posted with its first move request. */
function decisionBoards(messages: readonly BattleMessage[]): Map<number, BoardView> {
  const boards = new Map<number, BoardView>();
  for (const message of messages) if (message.request?.kind === "move" && !boards.has(message.board.turn)) boards.set(message.board.turn, message.board);
  return boards;
}
/** Every copy of each resolved turn the worker posted, oldest first. */
function postedTurns(messages: readonly BattleMessage[]): Map<number, LogTurn[]> {
  const turns = new Map<number, LogTurn[]>();
  for (const message of messages) for (const turn of message.log) if (turn.actions) turns.set(turn.turn, [...(turns.get(turn.turn) ?? []), turn]);
  return turns;
}

describe("the AI's read names a turn's Pokémon as the board of its decision did", () => {
  it("Transform: your Ditto keeps its name in turn 1 after it becomes Garchomp, and no earlier turn is renamed later", async () => {
    const setup = setupOf([SETS.ditto, SETS.garchomp, SETS.farigiraf, SETS.charizard, SETS.incineroar, SETS.sneasler],
      [SETS.aiGarchomp, SETS.kingambit, SETS.absol, SETS.gardevoir, SETS.aiIncineroar, SETS.pelipper]);
    const messages = await play({
      // Your Garchomp leads on the left (the stub AI's moves go there), your Ditto on the right.
      setup, ownOrder: [2, 1, 3, 4], aiOrder: [1, 2, 3, 4], untilTurn: 4,
      // Turn 1: Ditto transforms into your Garchomp beside it, which protects.
      pick: (request, board, legal) => board.turn === 1
        ? legal.find((action) => moveOf(action["own-right"], "transform") && action["own-right"]?.kind === "move" && action["own-right"].target === "own-left" && moveOf(action["own-left"], "protect")) ?? null
        : null,
    });
    const boards = decisionBoards(messages);
    const turns = postedTurns(messages);
    const first = turns.get(1)!.at(-1)!;
    expect(first.occupants?.["own-right"]).toBe("ditto");
    expect(first.names).toMatchObject({ "own-left": "Garchomp (yours)", "own-right": "Ditto" });
    // The board right after turn 1 shows your Ditto as Garchomp; the turn's own rows keep the names of its decision.
    const after = messages.find((message) => message.board.turn === 2)!.board;
    expect(after.team.own.find((view) => view.key === "ditto")?.name).toBe("Garchomp");
    const names = turnNames(first, after);
    expect(jointText(first.actions!.own, after, runtime, names)).toBe("Garchomp (yours): Protect · Ditto: Transform → Garchomp (yours)");
    // Without the stored names the occupants would be named on that later board (the review's finding).
    expect(occupantNames(first.occupants, after)["own-right"]).toBe("Garchomp (yours, 2)");
    // Turn 2 was chosen with your Ditto shown as Garchomp: its rows name the two cards as the board did then.
    expect(turns.get(2)!.at(-1)!.names).toMatchObject({ "own-left": "Garchomp (yours, 1)", "own-right": "Garchomp (yours, 2)" });
    // Every resolved turn: its names are the occupants on its decision board, the same in every message that carries it.
    expect(turns.size).toBeGreaterThanOrEqual(2);
    for (const [turn, copies] of turns) {
      const expected = Object.fromEntries(Object.entries(occupantNames(copies[0].occupants, boards.get(turn)!)).filter(([slot]) => copies[0].occupants?.[slot as keyof LogTurn["occupants"]]));
      for (const copy of copies) expect(copy.names, `turn ${turn}`).toEqual(expected);
    }
  }, 120_000);

  it("Illusion beside the Pokémon it copies: both are that member in the occupants and numbered as the log numbers them", async () => {
    // The AI brings Zoroark, Kingambit, Absol and Garchomp: Zoroark leads disguised as Garchomp (the last brought).
    const setup = setupOf([SETS.sneasler, SETS.garchomp, SETS.incineroar, SETS.charizard, SETS.farigiraf, SETS.whimsicott],
      [SETS.zoroark, SETS.kingambit, SETS.aiIncineroar, SETS.aiGarchomp, SETS.absol, SETS.gardevoir]);
    let replaced = false;
    const messages = await play({
      setup, ownOrder: [1, 2, 3, 4], aiOrder: [1, 2, 5, 4], untilTurn: 3,
      // Turn 1: Sneasler's Close Combat knocks Kingambit out; your Garchomp protects. Later turns: no attack into the disguise.
      pick: (request, board, legal) => {
        const kingambit = (["opponent-left", "opponent-right"] as const).find((slot) => board.active[slot]?.key === "kingambit");
        if (kingambit) return legal.find((action) => moveOf(action["own-left"], "closecombat") && action["own-left"]?.kind === "move" && action["own-left"].target === kingambit && moveOf(action["own-right"], "protect")) ?? null;
        return legal.find((action) => moveOf(action["own-left"], "protect") && moveOf(action["own-right"], "protect")) ?? null;
      },
      // The AI replaces Kingambit with its real Garchomp, beside the disguised Zoroark.
      aiReplace: (slots) => {
        if (replaced || slots.length !== 1) return null;
        replaced = true;
        return { [slots[0]]: { kind: "switch", to: "garchomp" } } as JointAction;
      },
    });
    const turns = postedTurns(messages);
    const second = turns.get(2)?.at(-1);
    expect(second, "turn 2 resolved").toBeDefined();
    // Both of the AI's slots hold a Pokémon your log calls Garchomp; neither is the placeholder.
    expect(second!.occupants).toMatchObject({ "opponent-left": "garchomp", "opponent-right": "garchomp" });
    expect(Object.values(second!.occupants ?? {})).not.toContain("?illusion");
    expect([second!.names?.["opponent-left"], second!.names?.["opponent-right"]]).toEqual(["Garchomp (opponent's, 1)", "Garchomp (opponent's, 2)"]);
    // The turn's own lines number them the same way.
    const lines = second!.lines.map((line) => line.text).join("\n");
    expect(lines).toMatch(/Garchomp \(opponent's, [12]\)/);
    for (const [, copies] of turns) for (const copy of copies) expect(Object.values(copy.occupants ?? {})).not.toContain("?illusion");
  }, 120_000);
});

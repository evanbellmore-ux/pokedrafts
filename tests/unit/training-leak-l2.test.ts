import { describe, expect, it } from "vitest";
import { CLOSED_TEAM_SHEETS, DEFAULT_INFO } from "@/app/(app)/training/model/info";
import type { BoardView, LogLine, LogTurn, PokemonView } from "@/app/(app)/training/model/view-types";
import type { FromWorker } from "@/app/(app)/training/model/worker-protocol";
import { runL2, scan } from "@/scripts/training/lib/leak-l2";
import { illusionTransformPair } from "@/scripts/training/lib/teams";
import { boardView, report } from "../fixtures/training";
import { ILLUSION_TRANSFORM } from "../fixtures/training-teams";

// Naming review T3: leak:training's L2 checks (scripts/training/lib/leak-l2.ts) on the cases an Illusion and a Transform
// bring, which the pools' teams never do: BoardView.mirrored is the whole set of names on both teams (never what the AI
// brought), an AI occupant is the member your log showed in that slot (a look-alike in a slot the board leaves empty
// included), each turn's names are its occupants on the decision board, a move used under a disguise counts for the
// revealed member, and the moves your Transformed Pokémon copied are yours to see. Then the Illusion and Transform slice.

const pair = illusionTransformPair();
const ai = pair.p2.team, own = pair.p1.team;
/** Every key whose battle name is on both teams (Garchomp, Ditto, Incineroar). */
const MIRRORED = ["garchomp", "ditto", "incineroar"];
const base = boardView();
const card = (view: PokemonView, key: string, name: string, slot: PokemonView["slot"], side: PokemonView["side"]): PokemonView =>
  ({ ...view, key, name, speciesId: key, slot, side, item: { state: "unknown" }, ability: null, moves: [], nature: null, points: null, brought: null });
/** The decision board: your Sneasler and Garchomp; the AI's Garchomp on the right and, on the left, a slot the board leaves empty. */
const decision: BoardView = {
  ...base, turn: 3, mirrored: MIRRORED, megaUsed: { own: false, opponent: false },
  active: {
    "own-left": card(base.active["own-left"]!, "sneasler", "Sneasler", "own-left", "own"), "own-right": card(base.active["own-right"]!, "garchomp", "Garchomp", "own-right", "own"),
    "opponent-left": null, "opponent-right": card(base.active["opponent-right"]!, "garchomp", "Garchomp", "opponent-right", "opponent"),
  },
  team: { own: [card(base.active["own-left"]!, "sneasler", "Sneasler", "own-left", "own"), card(base.active["own-right"]!, "garchomp", "Garchomp", "own-right", "own")], opponent: [card(base.active["opponent-right"]!, "garchomp", "Garchomp", "opponent-right", "opponent"), card(base.team.opponent[2], "zoroark", "Zoroark", null, "opponent")] },
};
const line = (text: string, kind: LogLine["kind"], slots: LogLine["slots"]): LogLine => ({ text, kind, slots });
/** Turns 1-2: Zoroark leads on the right disguised as Garchomp and uses Night Daze; the real Garchomp comes in on the left. */
const EARLIER: LogTurn[] = [
  { turn: 1, lines: [line("Garchomp (opponent's) sent out.", "switch", ["opponent-right"])], actions: null, read: null },
  {
    turn: 2, actions: null, read: null, lines: [
      line("Garchomp (opponent's) used Night Daze → Sneasler.", "move", ["opponent-right", "own-left"]),
      line("Garchomp (opponent's, 1) sent out.", "switch", ["opponent-left"]),
    ],
  },
];
const OCCUPANTS = { "own-left": "sneasler", "own-right": "garchomp", "opponent-left": "garchomp", "opponent-right": "garchomp" };
const NAMES = { "own-left": "Sneasler", "own-right": "Garchomp (yours)", "opponent-left": "Garchomp (opponent's, 1)", "opponent-right": "Garchomp (opponent's, 2)" };

function hitsOf(turn: Partial<LogTurn>, options: { board?: BoardView; earlier?: LogTurn[]; requested?: string[] } = {}): string[] {
  const hits: string[] = [];
  const board = options.board ?? decision;
  const message: Extract<FromWorker, { type: "battle" }> = {
    type: "battle", battleId: 1, seed: null, request: null, board, ended: null,
    log: [{ turn: 3, lines: [], actions: null, read: null, ...turn }],
  };
  const turns = new Map((options.earlier ?? EARLIER).map((each) => [each.turn, each]));
  scan(message, ai, own, turns, hits, "#t", new Map([[3, board]]), undefined, new Set(options.requested ?? []));
  return hits;
}

describe("leak:training L2 checks with an Illusion and a Transform", () => {
  it("passes the shown look-alikes and their names; the board's mirrored set is all of the names on both teams", () => {
    expect(hitsOf({ occupants: OCCUPANTS, names: NAMES })).toEqual([]);
    // A mirrored set that depends on what the AI brought (Incineroar stayed home) tells you a closed fact.
    expect(hitsOf({ occupants: OCCUPANTS }, { board: { ...decision, mirrored: ["garchomp", "ditto"] } })).toEqual(["#t t3: board.mirrored lacks incineroar, whose battle name is on both teams"]);
    expect(hitsOf({}, { board: { ...decision, mirrored: [...MIRRORED, "kingambit"] } })).toEqual(["#t t3: board.mirrored holds kingambit, whose battle name is not on both teams"]);
  });

  it("refuses an occupant your log did not show, and names that are not the decision board's", () => {
    // The disguised Zoroark named by its real member, in the shown slot and in the slot the board leaves empty.
    expect(hitsOf({ occupants: { ...OCCUPANTS, "opponent-right": "zoroark" } })).toEqual(["#t t3: turn 3 occupants: opponent-right is zoroark, the board showed garchomp"]);
    expect(hitsOf({ occupants: { ...OCCUPANTS, "opponent-left": "zoroark" } })).toEqual(["#t t3: turn 3 occupants: opponent-left is zoroark, the board showed no one"]);
    // The tracker's placeholder is no member.
    expect(hitsOf({ occupants: { ...OCCUPANTS, "opponent-left": "?illusion" } })).toEqual(["#t t3: turn 3 occupants: opponent-left is ?illusion, the board showed no one"]);
    expect(hitsOf({ occupants: OCCUPANTS, names: { ...NAMES, "opponent-left": "Zoroark" } })).toEqual(["#t t3: turn 3 names: opponent-left is Zoroark, the board named Garchomp (opponent's, 1)"]);
  });

  it("counts a move used under a disguise for the revealed member once the Illusion ends", () => {
    const revealed: LogTurn[] = [...EARLIER, { turn: 3, actions: null, read: null, lines: [line("Illusion ended: Zoroark.", "form", ["opponent-right"])] }];
    const zoroark = card(base.team.opponent[2], "zoroark", "Zoroark", "opponent-right", "opponent");
    const board: BoardView = { ...decision, turn: 4, active: { ...decision.active, "opponent-right": zoroark } };
    const nightDaze = { action: { "opponent-right": { kind: "move" as const, moveId: "nightdaze", target: "own-left" as const } }, chance: 1 };
    const read = report({ turn: 4, strategy: [nightDaze], reason: null, mega: null });
    const hits: string[] = [];
    const message: Extract<FromWorker, { type: "battle" }> = { type: "battle", battleId: 1, seed: null, request: null, board, ended: null, log: [{ turn: 4, lines: [], actions: null, read }] };
    scan(message, ai, own, new Map(revealed.map((each) => [each.turn, each])), hits, "#t", new Map([[4, board]]));
    expect(hits).toEqual([]);
    // Before the Illusion ended, the log showed Zoroark use nothing.
    const early: string[] = [];
    scan(message, ai, own, new Map(EARLIER.map((each) => [each.turn, each])), early, "#t", new Map([[4, board]]));
    expect(early).toEqual(["#t t4: turn 4 read: Zoroark never used Night Daze in the log"]);
  });

  it("lets the read name a move your Transformed Pokémon copied (your request listed it), and no other move of the AI's", () => {
    const read = report({ turn: 3, strategy: [], reason: "Predicted Stomping Tantrum into Zoroark (40%), so it protected." , mega: null });
    expect(hitsOf({ read }, { requested: ["stompingtantrum"] }).filter((hit) => hit.includes("Stomping Tantrum"))).toEqual([]);
    expect(hitsOf({ read }).filter((hit) => hit.includes("Stomping Tantrum"))).toEqual(["#t t3: turn 3 read text names Stomping Tantrum"]);
  });

  it("the Illusion and Transform slice (random AI, 3 battles): an Imposter Transform in each, 0 hits, replays equal", async () => {
    const result = await runL2({
      battles: 3, seat: "random", info: { aiKnows: DEFAULT_INFO.aiKnows, youSee: CLOSED_TEAM_SHEETS },
      teams: { pair: () => illusionTransformPair(), aiOrder: ILLUSION_TRANSFORM.aiOrder, aiReplaceWith: ILLUSION_TRANSFORM.aiReplaceWith, run: "leak-l2-unit" },
    });
    expect(result.errors).toEqual([]);
    expect(result.hits).toEqual([]);
    expect(result).toMatchObject({ battles: 3, replays: 3, replayBoardsEqual: 3, transforms: 3 });
    expect(result.resumes).toBeGreaterThanOrEqual(1);
  }, 240_000);
});

// Debug: the shuffles and samples a Training prelude meets (the seat battle of training-status2-step1.test.ts's switch-in;
// argv[2] "mega": Charizard Mega Evolves as in training-bridge.test.ts's prelude test).
//   npx --no-install tsx scripts/.cache/calc-audit/status2/build/step1-prelude-dbg2.ts [mega]
import { PRNG, State, type PRNGSeed } from "@/app/(app)/training/sim/sim";
import { buildBeliefBattle } from "@/app/(app)/training/sim/belief-battle";
import { toChoiceString } from "@/app/(app)/training/sim/choices";
import type { CellActions } from "@/app/(app)/training/model/ai-view";
import { runtime, seatBattle } from "../../../../../tests/unit/training-sim-fixtures";

const seat = seatBattle([17, 2, 3, 4]);
seat.step("team 2413", "team 2513");
const belief = buildBeliefBattle(seat.inputs(), seat.truthWorld(), runtime);
const cell: CellActions = {
  own: { "own-left": { kind: "move", moveId: "heatwave", target: null, ...(process.argv[2] === "mega" ? { mega: "mega" as const } : {}) }, "own-right": { kind: "move", moveId: "earthquake", target: null } },
  opponent: { "opponent-right": { kind: "switch", to: "gyarados" }, "opponent-left": { kind: "move", moveId: "protect", target: null } },
};
const choices = { p1: toChoiceString("p1", cell.own, belief.battle.p1.activeRequest!, belief.keys, "p2"), p2: toChoiceString("p2", cell.opponent, belief.battle.p2.activeRequest!, belief.keys, "p2") };
console.log(choices);
const clone = State.deserializeBattle(belief.json);
clone.restart(() => {});
clone.prng = new PRNG(`sodium,${"0".repeat(32)}` as PRNGSeed);
const any = clone as any;
const ids: string[] = [];
const ee = any.eachEvent.bind(clone);
any.eachEvent = (id: string, ...rest: unknown[]) => { ids.push(id); try { return ee(id, ...rest); } finally { ids.pop(); } };
const caller = () => new Error().stack!.split("\n").slice(3, 7).map((line) => line.trim().split(" ")[1]).join("<");
any.prng.shuffle = (list: any[], start = 0, end = list.length) => {
  const tied = list.slice(start, end);
  const id = ids[ids.length - 1];
  const show = (x: any) => x?.choice ? `${x.choice}:${x.pokemon?.name}:${x.order}` : x?.species ? `${x.name}[${id ? any.findEventHandlers(x, id).map((h: any) => h.effect?.id).join("/") : ""}]` : x?.effect ? `${x.effect.id}@${x.effectHolder?.name ?? ""}:${x.speed}` : String(x);
  console.log("shuffle", end - start, id ?? "-", tied.map(show).join(", "), caller());
};
let resolving = 0;
const ra = any.queue.resolveAction.bind(any.queue);
any.queue.resolveAction = (...args: unknown[]) => { resolving++; try { return ra(...args); } finally { resolving--; } };
any.sample = (items: unknown[]) => { if (!resolving) console.log("sample", items.length, caller()); return items[0]; };
const run = clone.runAction.bind(clone);
clone.runAction = (action: any) => { if (action.order >= 200) throw new Error("STOP"); console.log("action", action.choice, action.pokemon?.name ?? ""); run(action); };
try { clone.makeChoices(choices.p1, choices.p2); } catch (error) { console.log((error as Error).message); }

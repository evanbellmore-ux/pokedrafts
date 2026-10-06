// The start of a turn on a reseeded copy of a belief battle (SPEC §9.4, C2): Showdown runs switches, entry abilities and
// items, hazards and Mega Evolution exactly, and the copy stops at its first action of order ≥ 200 (moves; pinned
// sim/battle-queue.ts:174-195), so the bridge reads the field the moves will see. Prototype: design probe/prelude-probe.ts.
import { PRNG, State, type BattleAction, type ClonedBattle, type PRNGSeed } from "./sim";

const STOP = { stop: "prelude" } as const;

export type PreludeResult = { kind: "stopped"; battle: ClonedBattle } | { kind: "rollout"; reasons: string[] };

/** Abilities whose entry effect changes what the moves see; with a Speed tie between two switches the order is random. */
const ENTRY_EFFECTS: ReadonlySet<string> = new Set([
  "intimidate", "drought", "drizzle", "sandstream", "snowwarning", "electricsurge", "grassysurge", "psychicsurge", "mistysurge",
  "trace", "download", "hospitality", "supersweetsyrup", "commander", "neutralizinggas", "airlock", "cloudnine", "screencleaner",
]);

export function runPrelude(json: string, choices: { p1: string; p2: string }, seed: string): PreludeResult {
  const clone = State.deserializeBattle(json);
  clone.restart(() => {});
  // Two switches out at the same Speed go in a random order (sim/battle.ts speedSort): random when either entry acts.
  const switching = (["p1", "p2"] as const).flatMap((side) => choices[side].split(", ").map((part, position) => ({ side, position, part })))
    .filter((each) => each.part.startsWith("switch "));
  if (switching.length >= 2) {
    const outgoing = switching.map((each) => clone[each.side].active[each.position]);
    const incoming = switching.map((each) => clone[each.side].pokemon[Number(each.part.split(" ")[1]) - 1]);
    const speeds = outgoing.map((mon) => (mon && !mon.fainted ? mon.getStat("spe") : -1));
    const tie = speeds.some((speed, i) => speeds.indexOf(speed) !== i);
    if (tie && incoming.some((mon) => mon && ENTRY_EFFECTS.has(mon.ability))) return { kind: "rollout", reasons: ["Speed tie between switches with an entry effect."] };
  }
  for (const each of switching) {
    const mon = clone[each.side].pokemon[Number(each.part.split(" ")[1]) - 1];
    if (mon?.ability !== "trace") continue;
    const foes = clone[each.side === "p1" ? "p2" : "p1"].active.filter((foe) => foe && !foe.fainted).map((foe) => foe!.ability);
    if (new Set(foes).size > 1) return { kind: "rollout", reasons: ["Trace enters against two different abilities."] };
  }
  clone.prng = new PRNG(`sodium,${seed}` as PRNGSeed);
  const runAction = clone.runAction.bind(clone);
  clone.runAction = (action: BattleAction) => {
    if (action.order >= 200) throw STOP;
    runAction(action);
  };
  try {
    clone.makeChoices(choices.p1, choices.p2);
  } catch (error) {
    if (error !== STOP) return { kind: "rollout", reasons: [`Prelude failed: ${String((error as Error)?.message ?? error).slice(0, 80)}`] };
    clone.runAction = runAction;
    return { kind: "stopped", battle: clone };
  }
  // No move was reached: the turn ended (all switches) or a replacement is asked mid-turn (Eject Pack, Emergency Exit).
  clone.runAction = runAction;
  return { kind: "rollout", reasons: [clone.ended ? "The battle ended before the moves." : "A replacement is needed before the moves."] };
}

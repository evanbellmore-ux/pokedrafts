// status2 Step 1 #11 (ADDENDUM2 C19, §7.1): which oracle cases the turn's clear can change. sim-dfs.ts prepare() now clears
// pinned statsRaisedThisTurn, statsLoweredThisTurn, usedItemThisTurn and hurtThisTurn after the case's setup (the oracle's
// turn 1 would otherwise count the leads' entry effects as this turn's). For every case, the flags the leads' entry left
// (prepare with keepEntryFlags) and the readers of each flag in the turn (pinned: Lash Out reads its user's
// statsLoweredThisTurn, PS/data/moves.ts:10059; Burning Jealousy and Alluring Voice their target's statsRaisedThisTurn,
// :2083, :294; Pickup its neighbours' usedItemThisTurn, PS/data/abilities.ts:3268; hurtThisTurn, Emergency Exit's, cannot be
// set before a turn). A case whose set flag has a reader is listed: its stored oracle result must be re-run with the clear.
//   npx --no-install tsx scripts/.cache/calc-audit/status2/build/step1-c19-scan.ts
import { CASES } from "../../2v2/verify/cases";
import { SLOTS, toID, type SlotId } from "../../2v2/verify/case-types";
import { hiddenCases, pokemonAt, prepare } from "../../2v2/verify/sim-dfs";

const side = (slot: SlotId) => (slot.startsWith("own") ? "own" : "opponent");
let flagged = 0;
const reached: string[] = [];
for (const c of CASES) {
  if (SLOTS.some((slot) => c.slots[slot].action.switchIn)) continue;
  let b: any;
  try { ({ b } = prepare(c, hiddenCases(c)[0].hidden, { keepEntryFlags: true })); } catch (error) { console.log(`${c.id}: prepare failed: ${(error as Error).message.split("\n")[0]}`); continue; }
  const flags: Partial<Record<SlotId, string[]>> = {};
  for (const slot of SLOTS) {
    if (c.slots[slot].absent) continue;
    const p = pokemonAt(b, slot);
    const set = [p.statsRaisedThisTurn && "statsRaised", p.statsLoweredThisTurn && "statsLowered", p.usedItemThisTurn && "usedItem", p.hurtThisTurn ? "hurt" : ""].filter(Boolean) as string[];
    if (set.length) flags[slot] = set;
  }
  if (!Object.keys(flags).length) continue;
  flagged++;
  const moves = Object.fromEntries(SLOTS.map((slot) => [slot, c.slots[slot].absent || c.slots[slot].action.move === null ? null : toID(c.slots[slot].action.move!)])) as Record<SlotId, string | null>;
  const readers: string[] = [];
  for (const [slot, set] of Object.entries(flags) as [SlotId, string[]][]) {
    if (set.includes("statsLowered") && moves[slot] === "lashout") readers.push(`${slot} Lash Out`);
    if (set.includes("statsRaised")) for (const user of SLOTS) if ((moves[user] === "burningjealousy" && side(user) !== side(slot)) || (moves[user] === "alluringvoice" && c.slots[user].action.target === slot)) readers.push(`${user} ${moves[user]} into ${slot}`);
    if (set.includes("usedItem")) for (const holder of SLOTS) if (!c.slots[holder].absent && holder !== slot && toID(c.slots[holder].ability) === "pickup") readers.push(`${holder} Pickup reads ${slot}`);
    if (set.includes("hurt")) readers.push(`${slot} hurt before the turn`);
  }
  if (readers.length) reached.push(`${c.id}${c.notEstimated ? ` (not estimated: ${c.notEstimated})` : c.endNotEstimated ? ` (end not estimated: ${c.endNotEstimated})` : ""}: ${JSON.stringify(flags)} read by ${readers.join("; ")}`);
}
console.log(`${CASES.length} cases; ${flagged} with a flag the leads' entry set; ${reached.length} with a reader of it:`);
for (const line of reached) console.log(`  ${line}`);

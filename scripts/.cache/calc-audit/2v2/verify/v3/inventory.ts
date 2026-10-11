// Track R-V (status2 wave 2): the stored cases the switch family reaches (reasons, moves, items, abilities), for changed-cases.ts.
import { CASES } from "../cases";
import { SLOTS, toID } from "../case-types";
const SWITCH_MOVES = new Set(["uturn", "voltswitch", "flipturn", "partingshot", "teleport", "batonpass", "shedtail", "chillyreception", "roar", "whirlwind", "dragontail", "circlethrow"]);
const SWITCH_ITEMS = new Set(["ejectbutton", "ejectpack", "redcard"]);
const SWITCH_ABILITIES = new Set(["emergencyexit", "wimpout"]);
const counts: Record<string, number> = {};
for (const c of CASES) {
  const present = SLOTS.filter((s) => !c.slots[s].absent);
  const tags: string[] = [];
  for (const s of present) {
    const m = c.slots[s];
    const mv = toID(m.action.move ?? "");
    if (SWITCH_MOVES.has(mv)) tags.push(`${s}:${mv}`);
    if (SWITCH_ITEMS.has(toID(m.item ?? ""))) tags.push(`${s}:${toID(m.item!)}`);
    if (SWITCH_ABILITIES.has(toID(m.ability))) tags.push(`${s}:${toID(m.ability)}`);
  }
  const r = [c.notEstimated, c.endNotEstimated].filter(Boolean).join(" | ");
  const sw = /switches out: the replacement is not known/.test(r);
  const hz = present.length && (c.field?.own?.hazards?.length || c.field?.opponent?.hazards?.length);
  if (!tags.length && !sw && !hz) continue;
  const key = `${sw ? "reason" : "noreason"}${tags.length ? "+tags" : ""}${hz ? "+hazards" : ""}`;
  counts[key] = (counts[key] ?? 0) + 1;
  console.log(`${c.id} [${c.game}] ${tags.join(",")}${hz ? " hazards" : ""}${c.canSwitch ? ` canSwitch=${JSON.stringify(c.canSwitch)}` : ""} :: ne=${c.notEstimated ?? "-"} :: end=${c.endNotEstimated ?? "-"}`);
}
console.log(counts);

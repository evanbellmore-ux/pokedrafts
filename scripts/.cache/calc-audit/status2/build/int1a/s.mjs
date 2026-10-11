// Integration 1a, S's kernel lines (W1A-S.md needsFromIntegrator 1-2) and the doubles-spread.ts lines S asked of D
// (needsFromOthers), from w1a-s/sync-tree.mjs, applied to the repo.
import fs from "node:fs";
import path from "node:path";
const SRC = path.resolve("app/lib/battle");
function patch(name, edits) {
  const file = path.join(SRC, name);
  let text = fs.readFileSync(file, "utf8");
  for (const [anchor, replacement] of edits) {
    const at = text.indexOf(anchor);
    if (at < 0 || text.indexOf(anchor, at + 1) >= 0) throw new Error(`${name}: the anchor is not unique: ${anchor.slice(0, 80)}`);
    text = text.replace(anchor, () => replacement);
  }
  fs.writeFileSync(file, text);
  console.log(`patched ${name} (${edits.length})`);
}
patch("doubles-turn.ts", [
  ["    opts?: { residual?: { attacker: DoublesSlotId | null } }): StepChild[];\n",
    "    opts?: { residual?: { attacker: DoublesSlotId | null } }): StepChild[];\n" +
    "  /** The turn's reactions to one hit (afterHit), for a hit no step applies: an intact Disguise's or Ice Face's 0-damage hit (doubles-faces.ts). */\n" +
    "  afterHit(w: World, action: PendingAction, target: DoublesSlotId, outcome: TurnStepOutcome, info: TurnMoveInfo, raisedBefore?: boolean): void;\n"],
  ["    applyStep: (w, action, target, entry, info, spread, part, opts) => applyStep(ctx, w, action, target, entry, info, spread, part, opts),\n",
    "    applyStep: (w, action, target, entry, info, spread, part, opts) => applyStep(ctx, w, action, target, entry, info, spread, part, opts),\n" +
    "    afterHit: (w, action, target, outcome, info, raisedBefore) => afterHit(ctx, w, action, target, outcome, info, raisedBefore),\n"],
]);
patch("doubles-status.ts", [
  ["  faceHooks.selfHit(kernel, w, slot);\n", "  const faced = faceHooks.selfHit(kernel, w, action);\n  if (faced) return faced;\n"],
]);
patch("doubles-spread.ts", [
  ["import * as substituteNs from \"./doubles-substitute\";\n", "import * as substituteNs from \"./doubles-substitute\";\nimport * as faceNs from \"./doubles-faces\";\n"],
  ["    const sub = substituteHooks.plan(kernel, w, action, info, check, multiple, attackerHP);\n",
    "    const sub = substituteHooks.plan(kernel, w, action, info, check, multiple, attackerHP, { costs: true });\n"],
  ["    if (sub) { hit = true; worlds = worlds.flatMap((world) => sub.apply(world)); continue; }\n    if (face) {\n      hit = true;\n      worlds = worlds.flatMap((world) => kernel.faceHit(world, action, info, target, face, multiple, true));\n      continue;\n    }\n",
    "    if (sub) { hit = true; retaliation += sub.cost ?? 0; worlds = worlds.flatMap((world) => sub.apply(world)); continue; }\n    if (face) {\n      hit = true;\n      retaliation += faceNs.faceRetaliation(kernel, w, action, info, target);\n      worlds = worlds.flatMap((world) => faceNs.faceHit(kernel, world, action, info, target, face, multiple, true, { retaliation: \"caller\" }));\n      continue;\n    }\n"],
  ["    if (mindBlown && !guarded) end.push(Math.max(1, Math.round(kernel.hp[attacker].maxHP / 2)));\n",
    "    const damaged = plans.some((p) => p.entry?.search), failed = plans.every((p) => p.check.block || (p.entry && !p.entry.search));\n    if (mindBlown && !guarded && (damaged || failed)) end.push(Math.max(1, Math.round(kernel.hp[attacker].maxHP / 2)));\n"],
]);

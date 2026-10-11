# Integration 1a: the doubles-spread.ts lines S asked of D (W1A-S.md needsFromOthers; w1a-s/sync-tree.mjs --spread) and W's
# userLosses line (W1A-W.md needsFromOthers; w1a-w/kernel-lines.patch). S's lines go into both spreadStep and D's drainingStep
# (a Substitute's Mind Blown cost and a face's retaliation join the user's first loss in either).
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from apply import apply
SUB_FACE_OLD = '''    if (sub) { hit = true; worlds = worlds.flatMap((world) => sub.apply(world)); continue; }
    if (face) {
      hit = true;
      worlds = worlds.flatMap((world) => kernel.faceHit(world, action, info, target, face, multiple, true));
      continue;
    }
'''
SUB_FACE_NEW = '''    if (sub) { hit = true; retaliation += sub.cost ?? 0; worlds = worlds.flatMap((world) => sub.apply(world)); continue; }
    if (face) {
      hit = true;
      retaliation += faceNs.faceRetaliation(kernel, w, action, info, target);
      worlds = worlds.flatMap((world) => faceNs.faceHit(kernel, world, action, info, target, face, multiple, true, { retaliation: "caller" }));
      continue;
    }
'''
apply([
 ("doubles-spread.ts", 'import * as substituteNs from "./doubles-substitute";\n', 'import * as substituteNs from "./doubles-substitute";\nimport * as faceNs from "./doubles-faces";\nimport * as pairNs from "./doubles-pairs";\n', "imports"),
 ("doubles-spread.ts", 'const substituteHooks = { ...substituteNs };\n', 'const substituteHooks = { ...substituteNs };\nconst pairHooks = { ...pairNs };\n', "pairHooks"),
 ("doubles-spread.ts", '    const sub = substituteHooks.plan(kernel, w, action, info, check, multiple, attackerHP);\n', '    // status2 (S): with each Substitute\'s Mind Blown cost (SubPlan.cost), which the user takes with the retaliation.\n    const sub = substituteHooks.plan(kernel, w, action, info, check, multiple, attackerHP, { costs: true });\n', "S: plan with costs"),
 ("doubles-spread.ts", SUB_FACE_OLD + '''    if (!entry!.search) {
      for (const world of worlds) if (step) { kernel.hitStats(action, target)!.noDamage += world.mass; kernel.hitFact(action, target, kernel.noDamageFact(entry!.row, move, target), world.mass); }
      continue;
    }
    hit = true;
    retaliation += entry!.search.retaliation();
    worlds = worlds.flatMap((world) => kernel.applyStep(''', SUB_FACE_NEW + '''    if (!entry!.search) {
      for (const world of worlds) if (step) { kernel.hitStats(action, target)!.noDamage += world.mass; kernel.hitFact(action, target, kernel.noDamageFact(entry!.row, move, target), world.mass); }
      continue;
    }
    hit = true;
    retaliation += entry!.search.retaliation();
    worlds = worlds.flatMap((world) => kernel.applyStep(''', "S: spreadStep's Substitute cost and face retaliation"),
 ("doubles-spread.ts", SUB_FACE_OLD + '''    if (!entry!.search) {
      for (const world of worlds) if (step) { kernel.hitStats(action, target)!.noDamage += world.mass; kernel.hitFact(action, target, kernel.noDamageFact(entry!.row, move, target), world.mass); }
      continue;
    }
    hit = true;
    retaliation += entry!.search.retaliation();
    const counted''', SUB_FACE_NEW + '''    if (!entry!.search) {
      for (const world of worlds) if (step) { kernel.hitStats(action, target)!.noDamage += world.mass; kernel.hitFact(action, target, kernel.noDamageFact(entry!.row, move, target), world.mass); }
      continue;
    }
    hit = true;
    retaliation += entry!.search.retaliation();
    const counted''', "S: drainingStep's Substitute cost and face retaliation"),
 ("doubles-spread.ts", '''    const end: number[] = [];
    if (mindBlown && !guarded) end.push(Math.max(1, Math.round(kernel.hp[attacker].maxHP / 2)));
''', '''    const end: number[] = [];
    // Mind Blown's own cost only where a target took damage or every target failed (S; PS/data/moves.ts mindblown onAfterMove).
    if (mindBlown && !guarded && (damaged || failed)) end.push(Math.max(1, Math.round(kernel.hp[attacker].maxHP / 2)));
''', "S: spreadStep's Mind Blown cost"),
 ("doubles-spread.ts", '''      const end: number[] = [];
      if (mindBlown && !guarded) end.push(Math.max(1, Math.round(kernel.hp[attacker].maxHP / 2)));
''', '''      const end: number[] = [];
      if (mindBlown && !guarded && (damaged || failed)) end.push(Math.max(1, Math.round(kernel.hp[attacker].maxHP / 2)));
''', "S: drainingStep's Mind Blown cost"),
 ("doubles-spread.ts", '''    out.push(...(losses.length ? kernel.afterLoss(world, attacker, ...losses) : [world]));''', '''    // W's userLosses: a Sparkling Aria user's faint in the hits is told apart from one after them (doubles-pairs.ts).
    out.push(...(losses.length ? pairHooks.userLosses(kernel, world, action, info, losses) : [world]));''', "W: spreadStep's user losses"),
])
# damaged / failed for Mind Blown's cost (S's line), once per move in each function.
DF = '''  // Mind Blown (S): a target took damage, or every target failed (blocked or no damage).
  const damaged = plans.some((p) => p.entry?.search), failed = plans.every((p) => p.check.block || (p.entry && !p.entry.search));
'''
apply([
 ("doubles-spread.ts", '''  // The attacker after the move: the state every target's step left it in (its own effects, applied once).
  const out: World[] = [];
''', DF + '''  // The attacker after the move: the state every target's step left it in (its own effects, applied once).
  const out: World[] = [];
''', "S: damaged/failed in spreadStep"),
 ("doubles-spread.ts", '''  const out: World[] = [];
  for (const each of worlds) {
    attackerAfter(kernel, w, each, action, info);
''', DF + '''  const out: World[] = [];
  for (const each of worlds) {
    attackerAfter(kernel, w, each, action, info);
''', "S: damaged/failed in drainingStep"),
])

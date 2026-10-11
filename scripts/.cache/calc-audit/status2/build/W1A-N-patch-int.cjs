// Applies Track N's proposed integrator changes (N-1 … N-4) to a scratch copy of app/lib/battle (argv[2]).
const fs = require("fs");
const path = require("path");
const dir = process.argv[2];
const rep = (file, fromLines, toLines) => {
  const from = fromLines.join("\n"), to = toLines.join("\n");
  const p = path.join(dir, file);
  const s = fs.readFileSync(p, "utf8").split(String.fromCharCode(13)).join("");
  if (!s.includes(from)) throw new Error("missing in " + file + ": " + JSON.stringify(from.slice(0, 120)));
  fs.writeFileSync(p, s.replace(from, to));
};
// N-1
rep("doubles-status.ts", [
  `  if (move.id === "destinybond") {`,
  `    mon.destinyBond = true;`,
], [
  `  if (move.id === "destinybond") {`,
  `    // status2 N: its own PrepareHit fails it while one from last turn is still up (doubles-history.ts destinyBondPrepare).`,
  `    if (historyHooks.destinyBondPrepare(kernel, w, action)) return [w];`,
  `    mon.destinyBond = true;`,
]);
// N-4
rep("doubles-status.ts", [
  `    w.sides[slotSide(slot)] = { ...w.sides[slotSide(slot)], [move.id === "wideguard" ? "wideGuard" : "quickGuard"]: true };`,
  `    return [w];`,
], [
  `    w.sides[slotSide(slot)] = { ...w.sides[slotSide(slot)], [move.id === "wideguard" ? "wideGuard" : "quickGuard"]: true };`,
  `    // status2 N: the guard raises the stall counter with no roll (doubles-history.ts stallRaise; kept only for a later reader).`,
  `    historyHooks.stallRaise(kernel, w, action);`,
  `    return [w];`,
]);
// N-2
rep("doubles-turn.ts", [
  `  if (found?.ties.length) {`,
  `    const first = found.ties.length === 1 ? historyHooks.entryTie(kernelOf(ctx), w, found.taken.slot, found.ties[0]) : null;`,
  `    if (first === null) notEstimated(REASONS.notIn2v2(found.taken.by));`,
  `    return first === found.taken.slot ? found.taken : found.tied[0];`,
  `  }`,
], [
  `  if (found?.ties.length) {`,
  `    // status2 N (C37): the oldest ability state among the tied holders (doubles-history.ts entryTie), pairwise; not known: not estimated.`,
  `    let first = found.taken.slot;`,
  `    for (const tie of found.ties) {`,
  `      const older = historyHooks.entryTie(kernelOf(ctx), w, first, tie);`,
  `      if (older === null) notEstimated(REASONS.needsEntryOrder(found.taken.by, ctx.names[first], ctx.names[tie]));`,
  `      first = older;`,
  `    }`,
  `    return first === found.taken.slot ? found.taken : found.tied[found.ties.indexOf(first)];`,
  `  }`,
]);
// N-3
rep("doubles-turn.ts", [
  `    const found = [...validateBuild(entry.build, runtime), ...carriedIssues(input, slot)];`,
], [
  `    // status2 N (IN §4.2): a used Protean or Libero is the 2v2 turn's (doubles-history.ts proteanUsed; its types BuildBase.types).`,
  `    const used = entry.build.abilityId === "protean" || entry.build.abilityId === "libero";`,
  `    const found = [...validateBuild(entry.build, runtime).filter((issue) => !(used && issue.field === "abilityActive")), ...carriedIssues(input, slot)];`,
]);
// N-5: Protean and Libero (the PrepareHit event) after a protecting move's own PrepareHit (willAct, the stall roll), only where it passed.
rep("doubles-status.ts", [
  `  // A protecting move that fails stops in its own PrepareHit (data/moves.ts protect onPrepareHit), before Protean's:`,
  `  // it fails only with no action left, where nothing reads the type.`,
  `  typingHooks.proteanGuard(kernel, w, slot, move.id, () => move.type);`,
  `  const protect = PROTECT_MOVES[move.id];`,
  `  if (protect || move.id === "endure") {`,
  `    // onPrepareHit: !!this.queue.willAct() (data/moves.ts:13973-13974): an action, a fainted Pokémon's included, is still queued.`,
  `    if (!w.remaining.length) { kernel.stepFact(action, \`\${move.name} fails: no Pokémon moves after it.\`, w.mass); return [w]; }`,
  `    // The stall roll (N, ADDENDUM2 §4.2): the worlds where it fails get no protection (the stub: every world passes).`,
  `    const roll = historyHooks.stallPrepare(kernel, w, action, move);`,
  `    for (const world of roll.pass) {`,
], [
  `  const protect = PROTECT_MOVES[move.id];`,
  `  if (protect || move.id === "endure") {`,
  `    // onPrepareHit: !!this.queue.willAct() (data/moves.ts:13973-13974): an action, a fainted Pokémon's included, is still queued.`,
  `    if (!w.remaining.length) { kernel.stepFact(action, \`\${move.name} fails: no Pokémon moves after it.\`, w.mass); return [w]; }`,
  `    // The stall roll (N, ADDENDUM2 §4.2): the worlds where it fails get no protection and no Protean change.`,
  `    const roll = historyHooks.stallPrepare(kernel, w, action, move);`,
  `    for (const world of roll.pass) {`,
  `      // The PrepareHit event after the move's own (PS/sim/battle-actions.ts:591-592): Protean and Libero where it passed.`,
  `      typingHooks.proteanGuard(kernel, world, slot, move.id, () => move.type);`,
]);
rep("doubles-status.ts", [
  `  // A snatchable move here (Quick Guard, Wide Guard; the screens, Tailwind) is taken by a Snatch user (A3; the stub: none).`,
], [
  `  // Protean and Libero for the other early moves (their PrepareHit as before status2 N).`,
  `  typingHooks.proteanGuard(kernel, w, slot, move.id, () => move.type);`,
  `  // A snatchable move here (Quick Guard, Wide Guard; the screens, Tailwind) is taken by a Snatch user (A3; the stub: none).`,
]);
console.log("patched", dir);

#!/usr/bin/env bash
# Integration 1b: FC's I1-I8 (W1B-FC.md; the lines of w1b-fc/itree.sh but its E1-E3, which E2 landed in doubles-eot.ts).
set -euo pipefail
B="$1"
apply() {
  node -e '
    const fs = require("fs"); const [file, from, to, want] = process.argv.slice(1);
    const raw = fs.readFileSync(file, "utf8"); const crlf = raw.includes("\r\n");
    const text = raw.replace(/\r\n/g, "\n");
    const count = text.split(from).length - 1;
    if (count !== Number(want || 1)) { console.error(`${file}: ${count} matches for ${JSON.stringify(from.slice(0, 90))}`); process.exit(1); }
    const out = text.split(from).join(to);
    fs.writeFileSync(file, crlf ? out.replace(/\n/g, "\r\n") : out);
  ' "$1" "$2" "$3" "${4:-1}"
}
node scripts/.cache/calc-audit/status2/build/w1b-fc/i1.mjs "$B/doubles-field.ts"
apply "$B/doubles-field.ts" '    kernel.stepFact(use.action, `${use.move.name}: the ${terrain} Terrain ends.`, w.mass);
    fieldChangeHooks.changed(kernel, w);' '    kernel.stepFact(use.action, `${use.move.name}: the ${terrain} Terrain ends.`, w.mass);
    fieldChangeHooks.changed(kernel, w, { weather: w.field.weather, terrain }, use);'
apply "$B/doubles-field.ts" 'fieldChangeHooks.pseudoWeatherChanged(kernel, w, use.move.id);' 'fieldChangeHooks.pseudoWeatherChanged(kernel, w, use.move.id, use);' 2
apply "$B/doubles-field.ts" 'return fieldChangeHooks.itemsAfterField(kernel, world, slot);' 'return fieldChangeHooks.itemsAfterField(kernel, world, slot, use);'
apply "$B/doubles-abilities.ts" 'if (fieldKey(kernel, w) !== c.field) fieldChangeHooks.changed(kernel, w);' 'if (fieldKey(kernel, w) !== c.field) fieldChangeHooks.changed(kernel, w, c.field, c.use);'
apply "$B/doubles-abilities.ts" 'return fieldChangeHooks.settleHolder(kernel, w, slot);' 'return fieldChangeHooks.settleHolder(kernel, w, slot, c.use);'
apply "$B/doubles-substitute.ts" 'if (w.field.weather !== weather0 || w.field.terrain !== terrain0) fieldChangeHooks.changed(kernel, w);' 'if (w.field.weather !== weather0 || w.field.terrain !== terrain0) fieldChangeHooks.changed(kernel, w, { weather: weather0, terrain: terrain0 }, action);'
apply "$B/doubles-turn.ts" '  const keeper = STRONG_WEATHERS[w.field.weather];
  if (keeper && mon.build.abilityId === keeper' '  fieldChangeHooks.fainted(kernelOf(ctx), w, slot);
  const keeper = STRONG_WEATHERS[w.field.weather];
  if (keeper && mon.build.abilityId === keeper'
apply "$B/doubles-turn.ts" 'pairHooks.stepEnv(kernel, w, attacker, target, moveId, spread));' 'pairHooks.stepEnv(kernel, w, attacker, target, moveId, spread), fieldChangeHooks.stepEnv(kernel, w, attacker, target, moveId, spread));'
apply "$B/doubles-turn.ts" '    next.field = { ...next.field, weather: kept ? next.field.weather : outcome.conditions.weather, terrain: outcome.conditions.terrain };' '    next.field = { ...next.field, weather: kept ? next.field.weather : outcome.conditions.weather, terrain: outcome.conditions.terrain };
    if (next.field.weather !== w.field.weather || next.field.terrain !== w.field.terrain) fieldChangeHooks.stepField(kernel, next, w.field, action);'
echo "fc applied in $B"

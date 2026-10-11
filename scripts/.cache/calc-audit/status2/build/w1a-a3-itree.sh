#!/usr/bin/env bash
# Track A3 (wave 1a): a scratch copy of app/lib with the integrator lines A3 asks for (W1A-A3.md "needsFromIntegrator")
# applied, to check A3's code with them before integration 1a. The frozen files in the real tree are never touched.
#   bash scripts/.cache/calc-audit/status2/build/w1a-a3-itree.sh            (re-copies app/lib and re-applies the lines)
#   TSX_TSCONFIG_PATH=scripts/.cache/calc-audit/status2/build/w1a-a3-itree/tsconfig.json npx --no-install tsx scripts/.cache/calc-audit/status2/build/w1a-a3-run.ts A3-MB
set -euo pipefail
cd "$(dirname "$0")/../../../../.."
T=scripts/.cache/calc-audit/status2/build/w1a-a3-itree
rm -rf "$T/app"
mkdir -p "$T/app"
cp -r app/lib "$T/app/lib"
B="$T/app/lib/battle"
apply() { # file, old (fixed string), new
  node -e '
    const fs = require("fs"); const [file, from, to] = process.argv.slice(1);
    const text = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
    const count = text.split(from).length - 1;
    if (count !== 1) { console.error(`${file}: ${count} matches for ${JSON.stringify(from.slice(0, 80))}`); process.exit(1); }
    fs.writeFileSync(file, text.replace(from, () => to));
  ' "$1" "$2" "$3"
}
# I1 (doubles-turn.ts hitChecks): Mat Block stops a damaging move the protections stop (the engine move has no protect flag;
# PS/data/moves.ts matblock onTryHit checks no source: an ally's too, F31).
apply "$B/doubles-turn.ts" 'if (side.matBlock && isFoe(attacker, slot) && !info.isZ && !info.isMax && info.flags.protect) return' 'if (side.matBlock && slot !== attacker && !passes()) return'
# I2 (doubles-turn.ts conditionsFor): a Z-Move or Max Move into a Mat Block side from any other Pokémon at a quarter.
apply "$B/doubles-turn.ts" 'if (w.sides[slotSide(target)].matBlock && attacker && moveId && isFoe(attacker, target)) {' 'if (w.sides[slotSide(target)].matBlock && attacker && moveId && target !== attacker) {'
# I3 (kernel.useCalled → runCalledStatus): the stolen use's `snatched`, the reflected use's `bounced`.
apply "$B/doubles-turn.ts" 'useCalled(w: World, action: PendingAction, moveId: string, target: DoublesSlotId | null, opts?: { priority?: number; prankster?: boolean }): World[];' 'useCalled(w: World, action: PendingAction, moveId: string, target: DoublesSlotId | null, opts?: { priority?: number; prankster?: boolean; snatched?: true; bounced?: true }): World[];'
apply "$B/doubles-turn.ts" 'function useCalled(ctx: Ctx, w: World, action: PendingAction, moveId: string, target: DoublesSlotId | null, opts?: { priority?: number; prankster?: boolean }): World[] {' 'function useCalled(ctx: Ctx, w: World, action: PendingAction, moveId: string, target: DoublesSlotId | null, opts?: { priority?: number; prankster?: boolean; snatched?: true; bounced?: true }): World[] {'
apply "$B/doubles-turn.ts" '{ priority, ...(opts?.prankster !== undefined ? { prankster: opts.prankster } : {}) })' '{ priority, ...(opts?.prankster !== undefined ? { prankster: opts.prankster } : {}), ...(opts?.snatched ? { snatched: true as const } : {}), ...(opts?.bounced ? { bounced: true as const } : {}) })'
apply "$B/doubles-status.ts" 'opts: { priority: number; prankster?: boolean }): World[] {' 'opts: { priority: number; prankster?: boolean; snatched?: true; bounced?: true }): World[] {'
apply "$B/doubles-status.ts" '  const use = makeUse(kernel, w, action, action.slot, move, entry, opts.priority, false, target, opts.prankster);' '  const use = makeUse(kernel, w, action, action.slot, move, entry, opts.priority, !!opts.bounced, target, opts.prankster);
  if (opts.snatched) use.snatched = true;'
# I4 (doubles-status.ts prepareHit, sideOrField): no Protean for a snatched use (PS/data/abilities.ts protean onPrepareHit: sourceEffect snatch).
apply "$B/doubles-status.ts" '  if (!use.bounced) typingHooks.proteanGuard(kernel, w, use.user, use.move.id, () => use.type);' '  if (!use.bounced && !use.snatched) typingHooks.proteanGuard(kernel, w, use.user, use.move.id, () => use.type);'
apply "$B/doubles-status.ts" '  if (!use.bounced) typingHooks.proteanGuard(kernel, w, user, move.id, () => use.type);' '  if (!use.bounced && !use.snatched) typingHooks.proteanGuard(kernel, w, user, move.id, () => use.type);'
# I5 (doubles-actions.ts, SPEC2 §8.4): Magic Room, Corrosive Gas, Bestow and Embargo leave GAS_CHANGING_MOVES.
apply "$B/doubles-actions.ts" '  "trick", "switcheroo", "bestow", "corrosivegas", "embargo", "magicroom",' '  "trick", "switcheroo",'
# I6 (doubles-field.ts, A3's own line once I3 lands): the snatched-Swallow guard goes.
apply "$B/doubles-field.ts" '  if (move.id === "swallow" && !w.mons[by]!.vol.stockpile) kernel.notEstimated(REASONS.notIn2v2(`${move.name} taken by ${kernel.moveName("snatch")}`));' ''
cat > "$T/tsconfig.json" <<'EOF'
{
  "compilerOptions": {
    "target": "ES2017", "module": "esnext", "moduleResolution": "bundler", "resolveJsonModule": true, "esModuleInterop": true, "strict": true, "skipLibCheck": true,
    "baseUrl": "../../../../../..",
    "paths": { "@/app/*": ["scripts/.cache/calc-audit/status2/build/w1a-a3-itree/app/*"], "@/*": ["./*"] }
  }
}
EOF
echo "itree ready: $T"

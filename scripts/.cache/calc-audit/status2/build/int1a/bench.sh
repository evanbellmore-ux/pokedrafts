#!/usr/bin/env bash
# Integration 1a bench: int1a/bench-stored.ts (verify/bench.ts over the stored cases) alternating main (the HEAD tree through
# TSX_TSCONFIG_PATH) and this tree, ROUNDS rounds. Prints each run's turn p50, p95, moves-pane p50, statuses and reference.
S=/c/Users/evanb/AppData/Local/Temp/claude/C--Users-evanb-OneDrive-pokedrafts/2f5050c3-27de-4325-af6b-e1650dd1d85e/scratchpad
cd /c/Users/evanb/OneDrive/pokedrafts
ROUNDS=${1:-4}
B=scripts/.cache/calc-audit/status2/build/int1a
summ() { node -e '
  const j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).summary;
  console.log(`turn p50 ${j.turn.p50.toFixed(2)} p95 ${j.turn.p95.toFixed(2)} max ${j.turn.max.toFixed(1)} | moves p50 ${j.movesPane.p50.toFixed(2)} | statuses ${JSON.stringify(j.statuses)} | reference ${j.reference.equal}/${j.reference.of}`);' "$1"; }
for r in $(seq 1 $ROUNDS); do
  BENCH_OUT=$B/bench-head.json TSX_TSCONFIG_PATH=$(cygpath -m $S/tsconfig.head.json) npx --no-install tsx $B/bench-stored.ts >/dev/null 2>&1
  echo "benchH-$r $(summ $B/bench-head.json)"
  BENCH_OUT=$B/bench-now.json npx --no-install tsx $B/bench-stored.ts >/dev/null 2>&1
  echo "benchC-$r $(summ $B/bench-now.json)"
done

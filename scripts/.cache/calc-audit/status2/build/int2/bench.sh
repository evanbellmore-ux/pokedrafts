#!/usr/bin/env bash
# Integration 2 bench (int1a/bench.sh on this machine): int2/bench-stored.ts alternating main (the detached worktree of
# 4008ee8 through TSX_TSCONFIG_PATH) and this tree, ROUNDS rounds. Prints each run's turn p50, p95, max, moves-pane p50,
# statuses and reference; after the last round, bench-paired.mjs over that round's two files.
S=/tmp/claude-0/-home-user-pokedrafts/1fff6e15-9f52-5b3b-bbb9-2b51ed040eae/scratchpad
cd /home/user/pokedrafts
ROUNDS=${1:-4}
B=scripts/.cache/calc-audit/status2/build/int2
summ() { node -e '
  const j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).summary;
  console.log(`turn p50 ${j.turn.p50.toFixed(2)} p95 ${j.turn.p95.toFixed(2)} max ${j.turn.max.toFixed(1)} | moves p50 ${j.movesPane.p50.toFixed(2)} | statuses ${JSON.stringify(j.statuses)} | reference ${j.reference.equal}/${j.reference.of}`);' "$1"; }
for r in $(seq 1 $ROUNDS); do
  BENCH_OUT=$B/bench-head.json TSX_TSCONFIG_PATH=$S/maintree/tsconfig.json npx --no-install tsx $B/bench-stored.ts >/dev/null 2>$S/int2/logs/bench-head-$r.err
  echo "benchH-$r $(summ $B/bench-head.json)"
  cp $B/bench-head.json $S/int2/bench-head-$r.json
  BENCH_OUT=$B/bench-now.json npx --no-install tsx $B/bench-stored.ts >/dev/null 2>$S/int2/logs/bench-now-$r.err
  echo "benchC-$r $(summ $B/bench-now.json)"
  cp $B/bench-now.json $S/int2/bench-now-$r.json
  node $B/bench-paired.mjs | sed "s/^/  round $r: /"
done

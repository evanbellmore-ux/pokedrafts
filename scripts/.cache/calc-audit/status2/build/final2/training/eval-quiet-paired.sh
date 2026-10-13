#!/usr/bin/env bash
# FINAL2 quiet paired decision-time check (HANDOFF item 3). Plays the given runs of eval's gate suite on main's seeds
# (run s1-step1) with the gate's own 8-shard partition (shard k plays battles i with i % 8 == k, carrying habits in order,
# exactly as `eval-ai.ts --shards 8` does), but runs at most PAR shard processes at a time, so a 4-CPU machine is not
# oversubscribed. Each shard is eval-ai.ts's own child mode (--child spec --shard k/8 --file out). main (scratch maintree,
# 4008ee8) and this tree alternate, main first in odd rounds. Nothing is written under either tree's scripts/.cache.
#   eval-quiet-paired.sh <rounds> <run,run,...> <par> [first-round]
set -u
SP=/tmp/claude-0/-home-user-pokedrafts/1fff6e15-9f52-5b3b-bbb9-2b51ed040eae/scratchpad
NOW=/home/user/pokedrafts
MAIN=$SP/maintree
ROUNDS=${1:-3}
RUNS=${2:-safe-maxdamage-suggested,safe-maxdamage-perfect,safe-random-open}
PAR=${3:-2}
FIRST=${4:-1}
OUT=$SP/final/training/quiet
SPECS=$OUT/specs
LOG=$SP/final/logs/quiet
mkdir -p "$SPECS" "$LOG"
# The gate suite's specs (eval-ai.ts gateRuns, scale 1, run s1-step1).
node -e '
const fs = require("fs"); const dir = process.argv[1]; const run = "s1-step1";
const specs = [
  { name: "safe-random-open", p2: "safe", p1: "random", battles: 200, pools: "S,V", info: "open", run },
  { name: "safe-random-closed", p2: "safe", p1: "random", battles: 200, pools: "S,V", info: "closed", run },
  { name: "safe-maxdamage-perfect", p2: "safe", p1: "maxdamage", battles: 400, pools: "S,V", info: "perfect", run },
  { name: "safe-maxdamage-suggested", p2: "safe", p1: "maxdamage", battles: 100, pools: "S", info: "open", run },
  { name: "safe-maxdamage-open", p2: "safe", p1: "maxdamage", battles: 400, pools: "S,V", info: "open", run },
];
for (const spec of specs) fs.writeFileSync(`${dir}/${spec.name}.json`, JSON.stringify(spec, null, 1));
' "$SPECS"
for round in $(seq "$FIRST" "$ROUNDS"); do
  if [ $((round % 2)) -eq 1 ]; then order="main now"; else order="now main"; fi
  for tree in $order; do
    if [ "$tree" = main ]; then dir=$MAIN; else dir=$NOW; fi
    d=$OUT/r$round-$tree
    if [ -e "$d" ]; then echo "refusing: $d exists" >&2; exit 2; fi
    mkdir -p "$d"
    echo "=== round $round $tree start $(date -u +%H:%M:%S) load $(cut -d' ' -f1-3 /proc/loadavg)"
    start=$(date +%s)
    # Longest runs first (the biggest shards start first, so the last slot frees early).
    for run in $(echo "$RUNS" | tr , '\n'); do for k in 0 1 2 3 4 5 6 7; do echo "$run $k"; done; done \
      | awk '{ w = ($1 ~ /perfect|maxdamage-open/) ? 3 : ($1 ~ /random/) ? 2 : 1; print w, $0 }' | sort -s -k1,1nr | cut -d' ' -f2- \
      | DIR="$dir" D="$d" SPECS="$SPECS" LOGD="$LOG" R="r$round-$tree" xargs -P "$PAR" -L 1 bash -c '
          s=$(date +%s.%N)
          ( cd "$DIR" && TSX_TSCONFIG_PATH="$DIR/tsconfig.json" node "$DIR/node_modules/tsx/dist/cli.mjs" --tsconfig tsconfig.json \
              scripts/training/eval-ai.ts --child "$SPECS/$0.json" --shard "$1/8" --file "$D/$0.shard-$1.json" ) 2> "$LOGD/$R-$0-$1.err"
          code=$?
          e=$(date +%s.%N)
          echo "$R $0 shard $1 exit $code $(echo "$e - $s" | bc) s"'
    echo "=== round $round $tree end $(date -u +%H:%M:%S) real $(( $(date +%s) - start )) s"
  done
done
echo "=== done $(date -u +%H:%M:%S)"

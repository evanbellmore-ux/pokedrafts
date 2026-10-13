#!/usr/bin/env bash
# Integration 2 paired decision-time check (INTEGRATION-1B's eval-paired.sh, rebuilt: the original is not in this clone).
# The given runs of eval's gate suite, on main's seeds (--run s1-step1, 8 shards), main (scratch maintree, 4008ee8) and this
# tree alternating, for ROUNDS rounds. Each run's output folder is moved to int2-paired-<tree>-r<round> afterwards, so the
# gate run's folder (moved to int2-s1seeds beforehand) is not overwritten.
#   eval-paired.sh <rounds> <run,run>
set -u
SP=/tmp/claude-0/-home-user-pokedrafts/1fff6e15-9f52-5b3b-bbb9-2b51ed040eae/scratchpad
NOW=/home/user/pokedrafts
MAIN=$SP/maintree
ROUNDS=${1:-2}
ONLY=${2:-safe-random-open,safe-maxdamage-suggested}
LOG=$SP/int2/logs/eval-paired
mkdir -p "$LOG"
for round in $(seq 1 "$ROUNDS"); do
  # main first in odd rounds, this tree first in even rounds
  if [ $((round % 2)) -eq 1 ]; then order="main now"; else order="now main"; fi
  for tree in $order; do
    if [ "$tree" = main ]; then dir=$MAIN; else dir=$NOW; fi
    out=$dir/scripts/.cache/training/eval
    if [ -e "$out/s1-step1" ]; then echo "refusing: $out/s1-step1 exists" >&2; exit 2; fi
    echo "=== round $round $tree $(date -u +%H:%M:%S) load $(cut -d' ' -f1-3 /proc/loadavg)"
    start=$(date +%s)
    ( cd "$dir" && TSX_TSCONFIG_PATH=$dir/tsconfig.json npx --no-install tsx scripts/training/eval-ai.ts --gates --scale 1 --shards 8 --run s1-step1 --only "$ONLY" ) > "$LOG/r$round-$tree.log" 2>&1
    echo "exit $?" >> "$LOG/r$round-$tree.log"
    echo "real $(( $(date +%s) - start )) s" >> "$LOG/r$round-$tree.log"
    mv "$out/s1-step1" "$out/int2-paired-$tree-r$round"
    grep -E "^[a-z-]+: |time turn|^real|^exit" "$LOG/r$round-$tree.log"
  done
done
echo "=== done $(date -u +%H:%M:%S)"

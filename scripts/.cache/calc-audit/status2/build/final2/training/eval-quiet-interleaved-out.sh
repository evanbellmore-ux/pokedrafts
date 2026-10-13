#!/usr/bin/env bash
# FINAL2 quiet paired decision-time check, shard-interleaved variant (a robustness check on eval-quiet-paired.sh, whose
# trees alternate in ~17-minute blocks and so see the machine's drift between blocks). The same shards, specs and seeds
# (eval-ai.ts's own child mode, the gate's 8-shard partition, run s1-step1), but the job queue alternates main's and this
# tree's shard of the same run (main shard k, now shard k, ...; this tree first in even rounds), PAR processes at a time,
# so with PAR=2 a main shard and a now shard mostly run side by side under the same machine conditions.
#   eval-quiet-interleaved.sh <first-round> <last-round> <run,run,...> <par>
set -u
SP=/tmp/claude-0/-home-user-pokedrafts/1fff6e15-9f52-5b3b-bbb9-2b51ed040eae/scratchpad
NOW=/home/user/pokedrafts
MAIN=$SP/maintree
FIRST=${1:?}; LAST=${2:?}
RUNS=${3:-safe-maxdamage-suggested,safe-random-closed,safe-maxdamage-perfect}
PAR=${4:-2}
OUT=${QUIET_OUT:-$SP/final/training/quiet-il}
SPECS=$SP/final/training/quiet/specs
LOG=${QUIET_LOG:-$SP/final/logs/quiet-il}
mkdir -p "$OUT" "$LOG"
for round in $(seq "$FIRST" "$LAST"); do
  if [ $((round % 2)) -eq 1 ]; then order="main now"; else order="now main"; fi
  for tree in main now; do
    if [ -e "$OUT/r$round-$tree" ]; then echo "refusing: $OUT/r$round-$tree exists" >&2; exit 2; fi
    mkdir -p "$OUT/r$round-$tree"
  done
  echo "=== round $round ($order) start $(date -u +%H:%M:%S) load $(cut -d' ' -f1-3 /proc/loadavg)"
  start=$(date +%s)
  for run in $(echo "$RUNS" | tr , '\n'); do for k in 0 1 2 3 4 5 6 7; do for tree in $order; do echo "$run $k $tree"; done; done; done \
    | awk '{ w = ($1 ~ /perfect|maxdamage-open/) ? 3 : ($1 ~ /random/) ? 2 : 1; print w, $0 }' | sort -s -k1,1nr | cut -d' ' -f2- \
    | MAIN="$MAIN" NOW="$NOW" OUT="$OUT" SPECS="$SPECS" LOGD="$LOG" RD="r$round" xargs -P "$PAR" -L 1 bash -c '
        if [ "$2" = main ]; then DIR=$MAIN; else DIR=$NOW; fi
        s=$(date +%s.%N)
        ( cd "$DIR" && TSX_TSCONFIG_PATH="$DIR/tsconfig.json" node "$DIR/node_modules/tsx/dist/cli.mjs" --tsconfig tsconfig.json \
            scripts/training/eval-ai.ts --child "$SPECS/$0.json" --shard "$1/8" --file "$OUT/$RD-$2/$0.shard-$1.json" ) 2> "$LOGD/$RD-$2-$0-$1.err"
        code=$?
        e=$(date +%s.%N)
        echo "$RD-$2 $0 shard $1 exit $code $(echo "$e - $s" | bc) s"'
  echo "=== round $round end $(date -u +%H:%M:%S) real $(( $(date +%s) - start )) s"
done
echo "=== done $(date -u +%H:%M:%S)"

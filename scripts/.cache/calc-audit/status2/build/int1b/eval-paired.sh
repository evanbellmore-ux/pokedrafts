#!/usr/bin/env bash
# Integration 1b: decision time, main against this tree, alternating. The two eval runs with the highest p95 in int1b/eval.log
# (safe-random-open, safe-maxdamage-suggested) on main's seeds (--run s1-step1), ROUNDS rounds; each tree's s1-step1 folder is
# kept aside and put back after every run. Prints each run's "time turn" lines and its cell share.
S=/c/Users/evanb/AppData/Local/Temp/claude/C--Users-evanb-OneDrive-pokedrafts/2f5050c3-27de-4325-af6b-e1650dd1d85e/scratchpad
R=/c/Users/evanb/OneDrive/pokedrafts
H=$S/headtree
B=$R/scripts/.cache/calc-audit/status2/build/int1b
ROUNDS=${1:-3}
one() { # $1 tree root, $2 label
  local E=$1/scripts/.cache/training/eval
  rm -rf $E/s1-step1.keep && cp -r $E/s1-step1 $E/s1-step1.keep
  (cd $1 && node node_modules/tsx/dist/cli.mjs scripts/training/eval-ai.ts --gates --only safe-random-open,safe-maxdamage-suggested --scale 1 --shards 8 --run s1-step1) > $B/eval-paired-$2.log 2>&1
  rm -rf $E/s1-step1 && mv $E/s1-step1.keep $E/s1-step1
  echo "== $2"; grep -E "^(safe-random-open|safe-maxdamage-suggested):|time turn|Cell methods" $B/eval-paired-$2.log | sed -E 's/ +\| +/ | /g'
}
for r in $(seq 1 $ROUNDS); do
  one $H main-$r
  one $R now-$r
done
echo paired-done

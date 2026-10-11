#!/usr/bin/env bash
# Track T2 (wave 1b): the Training eval gates on this tree, as integration 1a and the perf pass ran them. eval's seeds follow
# its --run name, so it runs as "s1-step1" (the seeds of main's and 1a's results); Step 1's s1-step1 directory is kept aside
# and put back, this run's moved to t2-w1b-s1seeds.
R=/c/Users/evanb/OneDrive/pokedrafts
B=$R/scripts/.cache/calc-audit/status2/build/t2
E=$R/scripts/.cache/training/eval
cd $R
rm -rf $E/s1-step1.t2keep && cp -r $E/s1-step1 $E/s1-step1.t2keep
{ time node node_modules/tsx/dist/cli.mjs scripts/training/eval-ai.ts --gates --scale 1 --shards 8 --run s1-step1; } > $B/eval.log 2>&1
rm -rf $E/t2-w1b-s1seeds && mv $E/s1-step1 $E/t2-w1b-s1seeds && mv $E/s1-step1.t2keep $E/s1-step1
echo done > $B/training-eval.done

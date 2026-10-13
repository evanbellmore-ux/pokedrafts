#!/usr/bin/env bash
# Integration 1b: the Training gates on this tree. eval's seeds follow its --run name, so it runs as "s1-step1" (main's results
# on those seeds: the scratch headtree's scripts/.cache/training/eval/s1-step1); Step 1's s1-step1 directory is kept aside and
# put back, this run's moved to int1b-s1seeds.
R=/c/Users/evanb/OneDrive/pokedrafts
B=$R/scripts/.cache/calc-audit/status2/build/int1b
E=$R/scripts/.cache/training/eval
cd $R
rm -rf $E/s1-step1.keep && cp -r $E/s1-step1 $E/s1-step1.keep
{ time node node_modules/tsx/dist/cli.mjs scripts/training/eval-ai.ts --gates --scale 1 --shards 8 --run s1-step1; } > $B/eval.log 2>&1
rm -rf $E/int1b-s1seeds && mv $E/s1-step1 $E/int1b-s1seeds && mv $E/s1-step1.keep $E/s1-step1
{ time node node_modules/tsx/dist/cli.mjs scripts/training/conformance.ts; } > $B/conformance.log 2>&1
{ time node node_modules/tsx/dist/cli.mjs scripts/training/leak.ts; } > $B/leak.log 2>&1
echo done > $B/training-gates.done

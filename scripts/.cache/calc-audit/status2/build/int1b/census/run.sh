#!/usr/bin/env bash
# Integration 1b: ADDENDUM2 §7.3's census sample (census-sim.ts, 8000 Champions + 2000 SV turns, seed 7) on this tree.
# census-sim writes design/census-sim.out.json; this run's copy goes to build/int1b/census and the design file is put back.
R=/c/Users/evanb/OneDrive/pokedrafts
C=$R/scripts/.cache/calc-audit/status2/build/int1b/census
D=$R/scripts/.cache/calc-audit/status2/design
cd $R
cp $D/census-sim.out.json $C/census-sim.before.json
node node_modules/tsx/dist/cli.mjs scripts/.cache/calc-audit/status2/design/census-sim.ts --n=8000 --sv=2000 > $C/census-sim.after.out 2> $C/census-sim.after.err
cp $D/census-sim.out.json $C/census-sim.after.json && cp $C/census-sim.before.json $D/census-sim.out.json
echo census-done > $C/census.done

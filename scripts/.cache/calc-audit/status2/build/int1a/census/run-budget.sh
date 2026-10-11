#!/usr/bin/env bash
R=/c/Users/evanb/OneDrive/pokedrafts
C=$R/scripts/.cache/calc-audit/status2/build/int1a/census
cd $R
node node_modules/tsx/dist/cli.mjs scripts/.cache/calc-audit/status2/build/int1a/census/budget-probe.ts > $C/budget.out 2> $C/budget.err
echo budget-done > $C/budget.done

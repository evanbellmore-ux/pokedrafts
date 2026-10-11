#!/usr/bin/env bash
# Track R-T: the Training gates on the frozen tree (this track's Training code; the engine as Step 2 left it: the R stubs
# keep today's rule, so the engine's numbers equal integration 1b's and only Training's own changes move anything).
# eval's seeds follow its --run name: "s1-step1" are main's (and 1a's, 1b's) seeds.
R=/c/Users/evanb/OneDrive/pokedrafts
L=$R/scripts/.cache/calc-audit/status2/build/w2-rt/logs
F="/c/Users/evanb/AppData/Local/Temp/claude/C--Users-evanb-OneDrive-pokedrafts/2f5050c3-27de-4325-af6b-e1650dd1d85e/scratchpad/frozen"
bash $R/scripts/.cache/calc-audit/status2/build/w2-rt/sync-frozen.sh
cd "$F"
{ time node node_modules/tsx/dist/cli.mjs scripts/training/conformance.ts; } > $L/conformance.log 2>&1
{ time node node_modules/tsx/dist/cli.mjs scripts/training/leak.ts; } > $L/leak.log 2>&1
{ time node node_modules/tsx/dist/cli.mjs scripts/training/eval-ai.ts --gates --scale 1 --shards 8 --run s1-step1; } > $L/eval.log 2>&1
echo done > $L/frozen-gates.done

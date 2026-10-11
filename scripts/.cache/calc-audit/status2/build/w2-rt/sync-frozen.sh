#!/usr/bin/env bash
# Track R-T: copy this track's files (Training, its scripts and tests) from the working tree into the frozen tree (the
# working tree's other files with Step 2's engine: doubles-turn.ts and doubles-world.ts rebuilt from step2/pre + step2.diff).
set -e
R=/c/Users/evanb/OneDrive/pokedrafts
F="/c/Users/evanb/AppData/Local/Temp/claude/C--Users-evanb-OneDrive-pokedrafts/2f5050c3-27de-4325-af6b-e1650dd1d85e/scratchpad/frozen"
rm -rf "$F/app/(app)/training" "$F/scripts/training"
cp -r "$R/app/(app)/training" "$F/app/(app)/training"
cp -r "$R/scripts/training" "$F/scripts/training"
cp "$R"/tests/unit/training-* "$F/tests/unit/"
echo synced

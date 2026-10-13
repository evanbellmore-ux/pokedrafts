#!/usr/bin/env bash
# Integration 2's census sample and budget probes, in order (repo root): census-sim.ts (ADDENDUM2 §7.3, seed 7; the design's
# census-sim.out.json kept as main's baseline and put back), census-bench.ts (the same turns with a bench), the budget probe
# without and with the bench.
set -u
cd "$(dirname "$0")/../../../../../../.."
C=scripts/.cache/calc-audit/status2/build/int2/census
D=scripts/.cache/calc-audit/status2/design
cp -p $D/census-sim.out.json $C/census-sim.main.json.bak
{ time npx --no-install tsx $D/census-sim.ts --n=8000 --sv=2000 --seed=7 > $C/census-sim.int2.out 2> $C/census-sim.int2.err; } 2> $C/census-sim.time
cp -p $D/census-sim.out.json $C/census-sim.int2.json
cp -p $C/census-sim.main.json.bak $D/census-sim.out.json && rm $C/census-sim.main.json.bak
sha256sum $D/census-sim.out.json > $C/census-sim.design-restored.sha256
{ time npx --no-install tsx $C/census-bench.ts --n=8000 --sv=2000 --seed=7 > $C/census-bench.out 2> $C/census-bench.err; } 2> $C/census-bench.time
{ time npx --no-install tsx $C/budget-probe.ts > $C/budget.out 2> $C/budget.err; } 2> $C/budget.time
{ time npx --no-install tsx $C/budget-probe.ts --bench > $C/budget-bench.out 2> $C/budget-bench.err; } 2> $C/budget-bench.time
echo done > $C/run.done

// Prints one Showdown run's log of a probe (the first choice everywhere).
import { showdownTrace } from "./oracle";
import { PROBES } from "./probes";
const id = process.argv[2];
const spec = PROBES.find((each) => each.id === id)!;
for (const line of showdownTrace(spec)) console.log(line);

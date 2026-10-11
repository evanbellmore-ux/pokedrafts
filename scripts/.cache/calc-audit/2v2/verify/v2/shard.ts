// Track V2: the ids of one shard (v2/run.ts --wave1b --shard=i/n), in order.
import { CASES } from "../cases";
import { WAVE1B_CASES } from "../cases-wave1b";
const [i, n] = process.argv[2].split("/").map(Number);
const w = new Set(WAVE1B_CASES.map((c) => c.id));
let seen = 0;
console.log(CASES.filter((c) => w.has(c.id)).filter(() => seen++ % n === i).map((c) => c.id).join(" "));

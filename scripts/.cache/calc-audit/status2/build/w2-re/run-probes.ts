// Runs R-E's probe specs (probes.ts) through oracle.ts's comparison. Args: probe ids (default: all); -v for the full app result.
import { compare } from "./oracle";
import { PROBES } from "./probes";
import { PROBES2 } from "./probes2";
import { PROBES3 } from "./probes3";

async function main() {
  const args = process.argv.slice(2);
  const verbose = args.includes("-v");
  const ids = args.filter((arg) => !arg.startsWith("-"));
  let bad = 0;
  for (const spec of [...PROBES, ...PROBES2, ...PROBES3].filter((each) => !ids.length || ids.includes(each.id))) {
    try {
      const { ok, lines } = await compare(spec, verbose);
      if (!ok) bad++;
      console.log(`${ok ? "PASS" : "FAIL"} ${spec.id}`);
      for (const line of lines) console.log(`  ${line.replace(/\n/g, "\n  ")}`);
    } catch (error) {
      bad++;
      console.log(`ERROR ${spec.id}: ${(error as Error).stack}`);
    }
  }
  console.log(`${bad ? `${bad} failing` : "all pass"}`);
}
void main();

// Integration 1a: one eval battle in-process (eval-ai.ts playShard, one shard), printing each p2 decision's time, to find the
// decisions the 1a tree makes slower than main on the same seeds. Run from a tree's root:
//   npx --no-install tsx scripts/.cache/calc-audit/status2/build/int1a/one-battle.ts <name> <p2> <p1> <index> [pools] [info]
import { playShard } from "@/scripts/training/eval-ai";
const [name, p2, p1, index, pools = "S,V", info = "open"] = process.argv.slice(2);
(async () => {
  const t0 = performance.now();
  const out = await playShard({ name, p2: p2 as never, p1: p1 as never, battles: 1, first: Number(index), pools, info: info as never, run: "s1-step1" }, 0, 1);
  for (const b of out) for (const d of b.decisions) if (d.kind === "turn") console.log(`${d.side} turn ${d.turn}: ${d.ms.toFixed(0)} ms, engine calls ${d.stats?.engineCalls ?? "-"}, moves ${d.moves.join(",")}`);
  console.log(`total ${(performance.now() - t0).toFixed(0)} ms`);
})();

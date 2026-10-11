// Integration 1a: which species of a game learn a move (for the static render scenarios).
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
const [game, ...moves] = process.argv.slice(2);
(async () => {
  const rt = await loadBattleRuntime(game as never);
  for (const m of moves) {
    const [id, ability] = m.split("@");
    const list = [...rt.speciesById.values()].filter((s: any) => s.moves.includes(id) && !s.unsupported.length && (!ability || (s.abilities ?? []).some((a: any) => (a.id ?? a) === ability)));
    console.log(`${m}: ${list.slice(0, 14).map((s: any) => s.id).join(", ")}${list.length > 14 ? ` (+${list.length - 14})` : ""}`);
  }
})();

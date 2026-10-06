import type { BoardView, PokemonView } from "../model/view-types";
import { hpText } from "./board-format";

function benchFact(mon: PokemonView) {
  return `${mon.name} ${mon.fainted ? "Fainted" : hpText(mon.hp)}`;
}

/** Your benched Pokémon; the AI's seen bench and how many it has not shown (or, under the "brought" test setting, its six). */
export function benchFacts(board: BoardView) {
  const own = board.team.own.filter((mon) => !mon.slot).map(benchFact);
  const foes = board.team.opponent;
  const tested = foes.some((mon) => mon.brought !== null);
  const opponent = tested
    ? foes.filter((mon) => !mon.slot).map((mon) => `${mon.revealed ? benchFact(mon) : mon.name} · ${mon.brought ? "Brought" : "Not brought"}`)
    : foes.filter((mon) => mon.revealed && !mon.slot).map(benchFact);
  const seen = foes.filter((mon) => mon.revealed).length;
  const unseen = tested ? 0 : Math.max(0, 4 - seen);
  return { own, opponent, unseen };
}

export default function BenchStrip({ board }: { board: BoardView }) {
  const { own, opponent, unseen } = benchFacts(board);
  return (
    <dl data-training-bench className="grid gap-1 text-xs sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-x-3">
      <dt className="font-semibold text-muted">Your bench</dt>
      <dd className="wrap-anywhere text-text">{own.length ? own.join(" · ") : "None"}</dd>
      <dt className="font-semibold text-muted">Opponent&apos;s bench</dt>
      <dd className="wrap-anywhere text-text">{[...opponent, ...(unseen ? [`${unseen} not seen`] : [])].join(" · ") || "None"}</dd>
    </dl>
  );
}

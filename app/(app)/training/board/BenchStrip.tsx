import { Fragment } from "react";
import BattleSprite from "@/app/components/BattleSprite";
import type { BoardView, PokemonView } from "../model/view-types";
import { hpText } from "./board-format";

function benchFact(mon: PokemonView) {
  return `${mon.name} ${mon.fainted ? "Fainted" : hpText(mon.hp)}`;
}

/** One bench entry: the Pokémon (its sprite) and its fact ("Incineroar 202 / 202 HP", "Altaria · Brought"). */
type BenchEntry = { mon: PokemonView; fact: string };

/** Your benched Pokémon; the AI's seen bench and how many it has not shown (or, under the "brought" test setting, its six). */
function benchEntries(board: BoardView) {
  const entry = (mon: PokemonView, fact = benchFact(mon)): BenchEntry => ({ mon, fact });
  const own = board.team.own.filter((mon) => !mon.slot).map((mon) => entry(mon));
  const foes = board.team.opponent;
  const tested = foes.some((mon) => mon.brought !== null);
  const opponent = tested
    ? foes.filter((mon) => !mon.slot).map((mon) => entry(mon, `${mon.revealed ? benchFact(mon) : mon.name} · ${mon.brought ? "Brought" : "Not brought"}`))
    : foes.filter((mon) => mon.revealed && !mon.slot).map((mon) => entry(mon));
  const seen = foes.filter((mon) => mon.revealed).length;
  const unseen = tested ? 0 : Math.max(0, 4 - seen);
  return { own, opponent, unseen };
}

export function benchFacts(board: BoardView) {
  const { own, opponent, unseen } = benchEntries(board);
  return { own: own.map(({ fact }) => fact), opponent: opponent.map(({ fact }) => fact), unseen };
}

/** A side's bench: each Pokémon's sprite and fact, then how many are not seen ("None" when there is nothing to list). */
function BenchLine({ entries, unseen = 0 }: { entries: readonly BenchEntry[]; unseen?: number }) {
  if (!entries.length && !unseen) return <>None</>;
  return (
    <>
      {entries.map(({ mon, fact }, index) => (
        <Fragment key={mon.key}>
          {index > 0 && " · "}
          <span className="inline-flex max-w-full items-center gap-1 align-middle">
            <BattleSprite speciesId={mon.speciesId} name={mon.name} size="sm" fainted={mon.fainted} />
            <span className="min-w-0 wrap-anywhere">{fact}</span>
          </span>
        </Fragment>
      ))}
      {!!unseen && `${entries.length ? " · " : ""}${unseen} not seen`}
    </>
  );
}

export default function BenchStrip({ board }: { board: BoardView }) {
  const { own, opponent, unseen } = benchEntries(board);
  return (
    <dl data-training-bench className="grid gap-1 text-xs leading-8 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-x-3">
      <dt className="font-semibold text-muted">Your bench</dt>
      <dd className="wrap-anywhere text-text"><BenchLine entries={own} /></dd>
      <dt className="font-semibold text-muted">Opponent&apos;s bench</dt>
      <dd className="wrap-anywhere text-text"><BenchLine entries={opponent} unseen={unseen} /></dd>
    </dl>
  );
}

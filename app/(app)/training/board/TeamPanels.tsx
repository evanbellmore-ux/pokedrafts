import type { BattleRuntime } from "@/app/lib/battle/runtime";
import { redactSheet, sheetFromTeam } from "../model/sheet";
import type { BoardView, PokemonView, TrainingSetup } from "../model/view-types";
import OpponentSheet from "../preview/OpponentSheet";
import { pointsText } from "../setup/team-export";
import { abilityText } from "./BattleCard";
import { hpText, itemText, statsLabel, statsText, statusLabel } from "./board-format";

/** Where one of your brought Pokémon is: in play, in the back, or fainted. */
function placeOf(mon: PokemonView) {
  return mon.fainted ? "Fainted" : mon.slot ? "In play" : "In the back";
}

/** In play (left, then right), in the back, then fainted; the team's order within each. */
const placeRank = (mon: PokemonView) => (mon.fainted ? 3 : mon.slot === "own-left" ? 0 : mon.slot ? 1 : 2);

/** Your brought Pokémon as the game's summary shows them: HP and status, item, ability, nature and Stat Points, stats, moves with PP. */
export function OwnTeamSummary({ team }: { team: readonly PokemonView[] }) {
  return (
    <ul data-training-own-summary className="grid gap-2 lg:grid-cols-2">
      {[...team].sort((a, b) => placeRank(a) - placeRank(b)).map((mon) => {
        const spread = mon.points ? pointsText(mon.points) : null;
        const condition = mon.fainted ? null : [hpText(mon.hp), mon.status ? statusLabel(mon.status) : null].filter(Boolean).join(" · ");
        return (
          <li key={mon.key} data-training-own-member={mon.key} className="min-w-0 rounded-lg border border-line bg-bg px-3 py-2 text-sm">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="wrap-anywhere font-semibold text-text">{mon.name}</span>
              <span className={`text-xs ${mon.fainted ? "font-semibold text-danger" : "text-muted"}`}>{placeOf(mon)}</span>
              {condition && <span className="ms-auto tabular-nums text-xs text-text">{condition}</span>}
            </div>
            <p className="mt-1 wrap-anywhere text-xs text-text">{[itemText(mon.item), abilityText(mon), mon.nature, spread ? `SPs: ${spread}` : null].filter(Boolean).join(" · ")}</p>
            {mon.stats && <p className="mt-0.5 wrap-anywhere text-xs tabular-nums text-text" aria-label={statsLabel(mon.stats)}>{statsText(mon.stats)}</p>}
            <ul className="mt-0.5 grid grid-cols-2 gap-x-3 text-xs text-muted">
              {mon.moves.map((move) => (
                <li key={move.id} className="flex min-w-0 justify-between gap-2">
                  <span className="min-w-0 wrap-anywhere text-text">{move.name}</span>
                  {typeof move.pp === "number" && <span className="shrink-0 tabular-nums">{move.pp}/{move.maxpp ?? move.pp}</span>}
                </li>
              ))}
            </ul>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Below the board: "Your team" (the summary above) and "Opponent's team" (its sheet as "You see" allows, as team preview
 * showed it). Open from the start in a battle dealt partway through (no team preview showed the teams), closed otherwise.
 */
export default function TeamPanels({ board, setup, runtime }: { board: BoardView; setup: TrainingSetup; runtime: BattleRuntime }) {
  const open = !!setup.situation;
  const sheet = redactSheet(sheetFromTeam(setup.opponent), setup.info.youSee);
  const summary = "min-h-11 cursor-pointer rounded py-2 text-sm font-semibold text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus";
  return (
    <div data-training-team-panels className="min-w-0 space-y-1 border-t border-line pt-2">
      <details open={open} data-training-own-team>
        <summary className={summary}>Your team</summary>
        <OwnTeamSummary team={board.team.own} />
      </details>
      <details open={open} data-training-opponent-team>
        <summary className={summary}>Opponent&apos;s team</summary>
        <OpponentSheet sheet={sheet} runtime={runtime} />
      </details>
    </div>
  );
}

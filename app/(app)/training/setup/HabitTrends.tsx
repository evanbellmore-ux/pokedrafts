"use client";

import { useId, useMemo, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { HabitsData } from "../model/habits-data";
import {
  BROUGHT_FACT, DECAY_FACT, fewerText, habitTrends, MOVES_SHOWN, shareText, THREATENED_FACT, whole,
  type CountItem, type MoveTrend, type ShareGroup, type ShareLine, type TrendNames,
} from "./habit-trends";

export type HabitTrendsProps = {
  data: HabitsData;
  runtime: BattleRuntime;
  open: boolean;
  onToggle(open: boolean): void;
};

const dl = "grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_minmax(0,1fr)]";
const dt = "font-medium text-muted";
const dd = "mb-1 min-w-0 wrap-anywhere tabular-nums text-text sm:mb-0";
const h4 = "text-sm font-semibold text-text";

export function trendNames(runtime: BattleRuntime): TrendNames {
  return {
    species: (id) => runtime.speciesById.get(id)?.name ?? id,
    move: (id) => runtime.movesById.get(id)?.name ?? id,
  };
}

function Lines({ lines }: { lines: ShareLine[] }) {
  return (
    <dl className={dl}>
      {lines.map((line) => (
        <div key={line.id} data-training-trend={line.id} className="contents">
          <dt className={dt}>{line.label}</dt>
          <dd className={dd}>{shareText(line)}</dd>
        </div>
      ))}
    </dl>
  );
}

function Group({ group }: { group: ShareGroup }) {
  return group.lines.length ? <Lines lines={group.lines} /> : <p className="text-sm text-text">{fewerText(group.unit)}</p>;
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="min-w-0 space-y-1.5">
      <h4 id={id} className={h4}>{title}</h4>
      {children}
    </section>
  );
}

function MoveList({ moves }: { moves: MoveTrend[] }) {
  return (
    <dl className={dl}>
      {moves.map((species) => (
        <div key={species.speciesId} data-training-trend-moves={species.speciesId} className="contents">
          <dt className={dt}>{species.name}</dt>
          <dd className={dd}>{species.moves
            ? `${species.moves.map((move) => `${move.name} ${whole(move.count)} (${move.percent}%)`).join(" · ")} · ${whole(species.total)} moves used`
            : fewerText("moves used")}</dd>
        </div>
      ))}
    </dl>
  );
}

const countsText = (items: CountItem[]) => items.map((item) => `${item.name} ${whole(item.count)}`).join(" · ");

/** "Your trends": the habits the AI recorded in this browser, as facts (setup/habit-trends.ts). Collapsed by default. */
export default function HabitTrends({ data, runtime, open, onToggle }: HabitTrendsProps) {
  const id = useId();
  const view = useMemo(() => open ? habitTrends(data, trendNames(runtime)) : null, [open, data, runtime]);
  const shown = view?.moves.slice(0, MOVES_SHOWN) ?? [];
  const more = view?.moves.slice(MOVES_SHOWN) ?? [];
  return (
    <div data-training-trends className="min-w-0 rounded-lg border border-line">
      <h3 className="text-sm font-semibold text-text">
        <button
          id={`${id}-toggle`}
          type="button"
          data-training-trends-toggle
          aria-expanded={open}
          aria-controls={`${id}-region`}
          onClick={() => onToggle(!open)}
          className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 py-1 text-left hover:bg-panel-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus"
        >
          <ChevronDown aria-hidden="true" className={`h-4 w-4 shrink-0 text-muted motion-safe:transition-transform ${open ? "rotate-180" : ""}`} />
          Your trends
        </button>
      </h3>
      <div id={`${id}-region`} role="region" aria-labelledby={`${id}-toggle`} hidden={!open} className="min-w-0 space-y-3 border-t border-line px-3 pb-3 pt-2">
        {open && !view && <p className="text-sm text-text">No turns recorded</p>}
        {view && (
          <>
            <p className="text-sm text-muted">{view.battles} {view.battles === 1 ? "battle" : "battles"} recorded. {DECAY_FACT}</p>
            <Section id={`${id}-actions`} title="Actions"><Group group={view.actions} /></Section>
            <Section id={`${id}-situations`} title="Situations">
              <Lines lines={view.situations} />
              <p className="text-xs text-muted">{THREATENED_FACT}</p>
            </Section>
            <Section id={`${id}-targets`} title="Targets">
              <Group group={view.targets} />
              <Group group={view.aims} />
            </Section>
            <Section id={`${id}-moves`} title="Moves by Pokémon">
              {shown.length ? <MoveList moves={shown} /> : <p className="text-sm text-text">{fewerText("moves used")}</p>}
              {!!more.length && (
                <details className="text-sm">
                  <summary className="min-h-11 cursor-pointer rounded py-3 font-medium text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
                    {more.length} more Pokémon
                  </summary>
                  <MoveList moves={more} />
                </details>
              )}
            </Section>
            <Section id={`${id}-preview`} title="Team preview">
              {view.brought && view.leads ? (
                <dl className={dl}>
                  <div data-training-trend="brought" className="contents">
                    <dt className={dt}>Most brought (battles)</dt>
                    <dd className={dd}>{view.brought.length ? countsText(view.brought) : "None seen"}</dd>
                  </div>
                  <div data-training-trend="leads" className="contents">
                    <dt className={dt}>Leads (battles)</dt>
                    <dd className={dd}>{view.leads.length ? countsText(view.leads) : "None seen"}</dd>
                  </div>
                </dl>
              ) : <p className="text-sm text-text">{fewerText("battles")}</p>}
              <p className="text-xs text-muted">{BROUGHT_FACT}</p>
            </Section>
            <Section id={`${id}-mega`} title="Mega Evolution"><Lines lines={view.mega} /></Section>
          </>
        )}
      </div>
    </div>
  );
}

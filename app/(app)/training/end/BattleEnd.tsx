"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Button } from "@/app/components/ui";
import { remaining } from "../board/board-format";
import { resultHeading } from "../log/announcement";
import type { HabitsData } from "../model/habits-data";
import type { TrainingBattle } from "../model/view-types";
import { battleComparison, DECAY_FACT, type ComparisonRow } from "../setup/habit-trends";

export type BattleEndProps = {
  battle: TrainingBattle;
  onRematch(): void;
  onChangeTeams(): void;
  /** The whole log as plain text (log/announcement.ts logText). */
  logText: string;
  /** The stored habits now (after this battle's observations); compared with battle.habitsBefore. */
  habits: HabitsData;
};

/** "This battle compared with your usual": this battle's exact shares and the habits before it (setup/habit-trends.ts). */
export function BattleComparison({ rows }: { rows: ComparisonRow[] }) {
  const id = useId();
  return (
    <section data-training-comparison aria-labelledby={`${id}-heading`} className="min-w-0 space-y-1.5 border-t border-line pt-2">
      <h3 id={`${id}-heading`} className="text-sm font-semibold text-text">This battle compared with your usual</h3>
      {rows.length ? (
        <table aria-labelledby={`${id}-heading`} className="w-full table-fixed border-collapse text-sm">
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className="py-1 pr-2 text-left font-medium text-muted"><span className="sr-only">Line</span></th>
              <th scope="col" className="py-1 pr-2 text-left text-xs font-semibold text-muted">This battle</th>
              <th scope="col" className="py-1 text-left text-xs font-semibold text-muted">Your usual</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} data-training-comparison-row={row.id} className="border-b border-line align-top last:border-b-0">
                <th scope="row" className="py-1 pr-2 text-left font-normal wrap-anywhere text-text">{row.label}</th>
                <td className="py-1 pr-2 wrap-anywhere tabular-nums text-text">{row.battle}</td>
                <td className="py-1 wrap-anywhere tabular-nums text-text">{row.usual}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className="text-sm text-text">No turns recorded this battle</p>}
      <p className="text-xs text-muted">Your usual: the habits recorded before this battle. {DECAY_FACT}</p>
    </section>
  );
}

/** "You won", "The AI won", "Tie", "You forfeited", with the facts line; focused on arrival. */
export default function BattleEnd({ battle, onRematch, onChangeTeams, logText, habits }: BattleEndProps) {
  const id = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => { heading.current?.focus(); }, []);
  const comparison = useMemo(() => battleComparison(battle.habitsBefore, habits), [battle.habitsBefore, habits]);
  if (battle.phase.kind !== "ended") return null;
  const board = battle.board;
  const facts = [
    `${board?.turn ?? 0} ${(board?.turn ?? 0) === 1 ? "turn" : "turns"}`,
    board ? `You: ${remaining(board, "own")} left · AI: ${remaining(board, "opponent")} left` : null,
    battle.seed ? `Seed ${battle.seed}` : null,
  ].filter(Boolean).join(" · ");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(logText);
      setCopied("copied");
    } catch {
      setCopied("failed");
    }
  };
  return (
    <section data-training-end aria-labelledby={`${id}-result`} className="min-w-0 space-y-2 rounded-xl border border-accent-border bg-panel p-3 sm:p-4">
      <h2 id={`${id}-result`} ref={heading} tabIndex={-1} className="rounded text-xl font-semibold text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">{resultHeading(battle.phase)}</h2>
      <p className="wrap-anywhere text-sm tabular-nums text-muted">{facts}</p>
      <div className="flex flex-wrap gap-2">
        <Button className="min-h-11" onClick={onRematch}>Rematch</Button>
        <Button variant="secondary" className="min-h-11" onClick={onChangeTeams}>Change teams</Button>
        <Button variant="secondary" className="min-h-11" onClick={() => void copy()}>Copy log</Button>
      </div>
      {copied !== "idle" && <p role="status" className="text-sm text-muted">{copied === "copied" ? "Log copied." : "Copy failed."}</p>}
      {comparison && <BattleComparison rows={comparison} />}
    </section>
  );
}

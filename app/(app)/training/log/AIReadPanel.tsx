import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { BoardView, LogTurn } from "../model/view-types";
import { actualText, jointText, leadsText, optionText, providerText } from "./report-format";

// The AI's read for a resolved turn (the worker releases it after the turn and redacts it per "You see", SPEC 9.7):
// what it predicted you would do, its mixed strategy and what it chose, what you did, its assumed spreads, its Mega fact.

export type AIReadPanelProps = {
  turn: LogTurn;
  board: BoardView | null;
  runtime: BattleRuntime;
  /** Your members' names by key (team preview's predicted leads). */
  ownName(key: string): string | null;
};

export default function AIReadPanel({ turn, board, runtime, ownName }: AIReadPanelProps) {
  const report = turn.read;
  if (!report) return null;
  const leads = report.preview?.predictedLeads ?? [];
  return (
    <div data-training-read className="mt-2 rounded-lg border border-line bg-bg p-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">AI&apos;s read</p>
      <dl className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1 text-xs tabular-nums">
        {report.turn === 0 ? (
          <>
            <dt className="font-semibold text-muted">Predicted</dt>
            <dd className="min-w-0 wrap-anywhere text-text">{leads.length ? leads.map((lead) => <span key={lead.keys.join("+")} className="block">Expected leads: {leadsText(lead.keys, lead.chance, board, ownName)}</span>) : "—"}</dd>
          </>
        ) : (
          <>
            <dt className="font-semibold text-muted">Predicted</dt>
            <dd className="min-w-0 wrap-anywhere text-text">{report.predicted.length ? report.predicted.map((option, index) => <span key={index} className="block">{optionText(option, board, runtime)}</span>) : "—"}</dd>
            <dt className="font-semibold text-muted">Chose</dt>
            <dd className="min-w-0 wrap-anywhere text-text">{report.strategy.length ? report.strategy.map((option, index) => (
              <span key={index} className="block">{optionText(option, board, runtime)}{index === report.chosen ? " (chosen)" : ""}</span>
            )) : "—"}</dd>
            {turn.actions && (
              <>
                <dt className="font-semibold text-muted">You</dt>
                <dd className="min-w-0 wrap-anywhere text-text">{jointText(turn.actions.own, board, runtime)}{actualText(report)}</dd>
              </>
            )}
          </>
        )}
        {!!report.assumed.length && (
          <>
            <dt className="font-semibold text-muted">Assumed</dt>
            <dd className="min-w-0 wrap-anywhere text-text">{report.assumed.map((line) => <span key={line} className="block">{line}</span>)}</dd>
          </>
        )}
        {report.mega?.text && (
          <>
            <dt className="font-semibold text-muted">Mega</dt>
            <dd className="min-w-0 wrap-anywhere text-text">{report.mega.text}</dd>
          </>
        )}
        <dt className="font-semibold text-muted">Source</dt>
        <dd className="min-w-0 wrap-anywhere text-text">
          {providerText(report)}
          {report.reason && <span className="block text-muted">{report.reason}</span>}
        </dd>
      </dl>
    </div>
  );
}

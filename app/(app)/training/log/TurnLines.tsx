import type { LogLine } from "../model/view-types";

export function TurnLines({ lines }: { lines: readonly LogLine[] }) {
  if (!lines.length) return <p className="text-xs text-muted">No events</p>;
  return (
    <ol className="space-y-0.5 text-xs">
      {lines.map((line, index) => (
        <li key={index} data-training-line={line.kind} className={`wrap-anywhere ${line.kind === "result" ? "font-semibold text-text" : line.kind === "faint" ? "text-danger" : "text-text"}`}>{line.text}</li>
      ))}
    </ol>
  );
}

export function turnTitle(turn: number) {
  return turn === 0 ? "Start" : `Turn ${turn}`;
}

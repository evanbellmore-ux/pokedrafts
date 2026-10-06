import { Button } from "@/app/components/ui";
import styles from "./actions.module.css";

export type SubmitBarProps = {
  /** One fact per slot ("Aerodactyl: Rock Slide → both foes"), or the missing ones ("Aegislash: no action"). */
  summary: string[];
  missing: string[];
  label: "Submit turn" | "Send out";
  /** "Simulating turn 3…", "AI choosing…": the form is waiting. */
  waiting: string | null;
};

export default function SubmitBar({ summary, missing, label, waiting }: SubmitBarProps) {
  return (
    <div data-training-submit-bar className={`${styles.submitBar} flex flex-wrap items-center justify-between gap-2 border-t border-line bg-panel px-3 py-2`}>
      {waiting ? (
        <p className="text-sm text-muted">{waiting}</p>
      ) : (
        <ul className="min-w-0 flex-1 space-y-0.5 text-xs">
          {summary.map((fact) => <li key={fact} className="wrap-anywhere text-text">{fact}</li>)}
          {missing.map((fact) => <li key={fact} data-training-missing className="wrap-anywhere text-danger">{fact}</li>)}
        </ul>
      )}
      {!waiting && <Button type="submit" data-training-submit className="min-h-11" disabled={missing.length > 0}>{label}</Button>}
    </div>
  );
}

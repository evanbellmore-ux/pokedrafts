import { FORMAT_FACTS } from "../model/format-facts";

/** The closed disclosure's own fact, "Doubles · Level 50 · Bring 6, pick 4", from the Battle and Teams facts. */
const SUMMARY_FACT = FORMAT_FACTS.filter((fact) => fact.term === "Battle" || fact.term === "Teams").map((fact) => fact.value).join(" · ");

/**
 * Battle settings' format facts: the format, the rules source and the usage data (SPEC 12.2), closed behind "Format and
 * rules" (they never change between battles). The information lines are the Information panel's own (InfoSettingsPanel).
 */
export default function FormatFacts() {
  return (
    <details data-training-format className="min-w-0 rounded-lg border border-line">
      <summary className="min-h-11 cursor-pointer rounded-lg px-3 py-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
        <span className="font-semibold text-text">Format and rules</span> <span className="text-muted">{SUMMARY_FACT}</span>
      </summary>
      <dl className="grid gap-x-4 gap-y-1 px-3 pb-3 text-sm sm:grid-cols-[auto_minmax(0,1fr)]">
        {FORMAT_FACTS.map((fact) => (
          <div key={fact.term} className="contents">
            <dt className="font-medium text-muted">{fact.term}</dt>
            <dd className="mb-1 min-w-0 wrap-anywhere text-text sm:mb-0">{fact.value}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

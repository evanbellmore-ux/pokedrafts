import type { InfoSettings } from "../model/info";
import { formatFacts } from "../model/format-facts";

/** The Battle section's facts: the format, the rules source, the usage data and the two information lines (SPEC 12.2). */
export default function FormatFacts({ info }: { info: InfoSettings }) {
  return (
    <dl data-training-format className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_minmax(0,1fr)]">
      {formatFacts(info).map((fact) => (
        <div key={fact.term} className="contents">
          <dt className="font-medium text-muted">{fact.term}</dt>
          <dd className="mb-1 min-w-0 wrap-anywhere text-text sm:mb-0">{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}

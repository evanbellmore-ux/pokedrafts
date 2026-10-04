import { Alert, Button, EmptyState } from "@/app/components/ui";

// The loading, error and invalid-settings wording both views show for the same state (1v1's, kept as it was).

export type ResultsState = {
  loading: boolean;
  /** The engine's load or calculation error; null without one. */
  error: string | null;
  /** A build or the field has a validation issue. */
  invalid: boolean;
};

/** Why the HP preview is not shown, or undefined when it is. */
export function previewBlockedReason({ loading, error, invalid }: ResultsState): string | undefined {
  return loading ? "HP preview paused while the calculator loads."
    : error !== null ? "HP preview unavailable. Retry the calculator."
      : invalid ? "HP preview paused. Fix the highlighted build or field settings." : undefined;
}

/** ResultsFeedback has something to show: loading, an error or invalid settings. */
export function hasResultsFeedback({ loading, error, invalid }: ResultsState) {
  return loading || error !== null || invalid;
}

/** The feedback under the summary: loading, the error with Retry calculator, or the invalid settings with Fix settings. */
export default function ResultsFeedback({ loading, error, invalid, champions, onRetry, onFixSettings }: ResultsState & {
  champions: boolean;
  onRetry: () => void;
  onFixSettings: () => void;
}) {
  if (loading) return <Alert variant="info" title={champions ? "Loading the Champions engine" : "Loading the battle engine"} />;
  if (error !== null) {
    return (
      <Alert variant="error" title="Calculator unavailable">
        <p>{error}</p>
        <Button variant="secondary" size="sm" className="mt-3" onClick={onRetry}>Retry calculator</Button>
      </Alert>
    );
  }
  if (!invalid) return null;
  return (
    <div>
      <p role="status" className="sr-only">Results paused. Check the highlighted build or field settings.</p>
      <EmptyState title="Check the highlighted settings" description="Fix the messages in Build settings or Field conditions to continue." action={<Button variant="secondary" onClick={onFixSettings}>Fix settings</Button>} />
    </div>
  );
}

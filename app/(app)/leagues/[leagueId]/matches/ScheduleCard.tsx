"use client";

import { useState, type FormEvent } from "react";
import { CalendarPlus } from "lucide-react";
import { Alert, Button, Dialog, Field, Select } from "@/app/components/ui";
import { pluralize, scheduleFormatLabel } from "@/app/lib/league/labels";
import { rpc } from "@/app/lib/rpc";
import type { ScheduleFormat } from "@/app/types/league";
import { isResultsExistError, SCHEDULE_FORMATS, toScheduleFormat } from "./helpers";

type ScheduleCardProps = {
  leagueId: string;
  /** `league.schedule_format`; the form starts on it. */
  defaultFormat: ScheduleFormat;
  draftCompleted: boolean;
  matchCount: number;
  /** Regular matches with a reported result; regenerating asks before discarding them. */
  resultCount: number;
  /** Playoff matches on file; regenerating deletes the bracket with the schedule. */
  playoffMatchCount: number;
  /** Called after a successful generation; the parent reloads and reports. */
  onGenerated: (matchCount: number, format: ScheduleFormat) => Promise<void>;
};

/**
 * Commissioner card for `generate_schedule`. The function refuses with the
 * `results_exist` code once a result has been reported; `rpc.*` carries it
 * as `code`, and that turns into a destructive confirmation that calls the
 * function again with `discardResults`.
 */
export default function ScheduleCard({
  leagueId,
  defaultFormat,
  draftCompleted,
  matchCount,
  resultCount,
  playoffMatchCount,
  onGenerated,
}: ScheduleCardProps) {
  const [seed, setSeed] = useState(defaultFormat);
  const [format, setFormat] = useState<ScheduleFormat>(defaultFormat);
  const [randomize, setRandomize] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [discardError, setDiscardError] = useState<string | null>(null);

  // Follow the saved format when it changes elsewhere (Settings, another tab).
  if (seed !== defaultFormat) {
    setSeed(defaultFormat);
    setFormat(defaultFormat);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    setError(null);
    setPending(true);
    const result = await rpc.generateSchedule(leagueId, format, randomize, false);
    if (result.error !== null) {
      setPending(false);
      if (isResultsExistError(result)) {
        setDiscardError(null);
        setDiscardOpen(true);
      } else {
        setError(result.error);
      }
      return;
    }

    await onGenerated(result.data ?? 0, format);
    setPending(false);
  }

  async function confirmDiscard() {
    if (pending) return;

    setDiscardError(null);
    setPending(true);
    const { data, error: rpcError } = await rpc.generateSchedule(
      leagueId,
      format,
      randomize,
      true
    );
    if (rpcError !== null) {
      setDiscardError(rpcError);
      setPending(false);
      return;
    }

    await onGenerated(data ?? 0, format);
    setPending(false);
    setDiscardOpen(false);
  }

  function closeDiscard() {
    if (pending) return;
    setDiscardOpen(false);
    setDiscardError(null);
  }

  return (
    <section
      aria-labelledby="schedule-heading"
      className="rounded-xl border border-line bg-panel p-5"
    >
      <div className="flex items-center gap-2">
        <CalendarPlus className="h-5 w-5 text-accent-text" aria-hidden="true" />
        <h2 id="schedule-heading" className="text-lg font-semibold text-text">
          Schedule
        </h2>
      </div>

      {!draftCompleted ? (
        <Alert variant="info" className="mt-4">
          The schedule is created automatically when the draft finishes. Once
          it has, you can change the format or regenerate it here.
        </Alert>
      ) : (
        <form onSubmit={handleSubmit} noValidate className="mt-4 flex flex-col gap-4">
          <p className="text-sm text-muted">
            Every coach in the draft order plays in the schedule. Generating
            again replaces the current schedule
            {playoffMatchCount > 0 ? " and removes the playoff bracket" : ""}
            {resultCount > 0
              ? `, and asks before discarding the ${pluralize(resultCount, "reported result")}.`
              : "."}
          </p>

          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2 sm:items-end">
            <Field
              label="Format"
              help="Round robin plays every team once; double round robin plays home and away."
            >
              <Select
                value={format}
                onChange={(event) => setFormat(toScheduleFormat(event.target.value))}
                disabled={pending}
              >
                {SCHEDULE_FORMATS.map((option) => (
                  <option key={option} value={option}>
                    {scheduleFormatLabel(option)}
                  </option>
                ))}
              </Select>
            </Field>

            <label className="flex items-center gap-2 pb-2.5 text-sm text-text">
              <input
                type="checkbox"
                checked={randomize}
                onChange={(event) => setRandomize(event.target.checked)}
                disabled={pending}
                className="h-4 w-4 rounded border-line-strong accent-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
              />
              Randomize team order
            </label>
          </div>

          {error && <Alert variant="error">{error}</Alert>}

          <div>
            <Button
              type="submit"
              pending={pending && !discardOpen}
              pendingText="Generating..."
              disabled={pending}
            >
              {matchCount > 0 ? "Regenerate schedule" : "Generate schedule"}
            </Button>
          </div>
        </form>
      )}

      <Dialog
        open={discardOpen}
        onClose={closeDiscard}
        title="Discard reported results and regenerate?"
        description={`${pluralize(resultCount, "result has", "results have")} been reported. Regenerating removes ${resultCount === 1 ? "it" : "them"}${playoffMatchCount > 0 ? ", the playoff bracket" : ""} and the matching news items; standings start over from 0-0.`}
        danger
        confirmLabel="Discard and regenerate"
        onConfirm={confirmDiscard}
        pending={pending}
        error={discardError}
      />
    </section>
  );
}

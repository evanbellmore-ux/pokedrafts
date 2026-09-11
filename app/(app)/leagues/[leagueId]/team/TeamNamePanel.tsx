"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLeague } from "@/app/components/league/LeagueProvider";
import { Alert, Button, Field, Input, StatusPill } from "@/app/components/ui";
import { teamNameLabel } from "@/app/lib/league/labels";
import { rpc } from "@/app/lib/rpc";
import { LEAGUE_LIMITS } from "@/app/types/league";

export type TeamNamePanelProps = {
  /** Called with the success message once the league context has reloaded. */
  onSaved: (message: string) => void;
  className?: string;
};

/**
 * The coach's team name with an inline rename form. The name itself comes
 * from `useLeague().member`, so after `rename_team` succeeds the panel calls
 * `refresh()` and only reports success once the new row is in place.
 */
export default function TeamNamePanel({
  onSaved,
  className = "",
}: TeamNamePanelProps) {
  const { league, member, isCommissioner, refresh } = useLeague();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const renameButtonRef = useRef<HTMLButtonElement | null>(null);
  const restoreFocus = useRef(false);

  // The form replaces the Rename button while editing, so when it closes
  // (Save or Cancel) focus would land on <body>; put it back on the button
  // once it has rendered again (docs section 8.4).
  useEffect(() => {
    if (editing || !restoreFocus.current) return;
    restoreFocus.current = false;
    renameButtonRef.current?.focus();
  }, [editing]);

  function closeEditor() {
    restoreFocus.current = true;
    setEditing(false);
  }

  function startEditing() {
    setValue(member.team_name ?? "");
    setFieldError(null);
    setSubmitError(null);
    setEditing(true);
  }

  function cancel() {
    if (pending) return;
    setFieldError(null);
    setSubmitError(null);
    closeEditor();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const cleanName = value.trim();
    if (
      cleanName.length < LEAGUE_LIMITS.teamName.min ||
      cleanName.length > LEAGUE_LIMITS.teamName.max
    ) {
      setFieldError(
        `Team names are ${LEAGUE_LIMITS.teamName.min} to ${LEAGUE_LIMITS.teamName.max} characters.`
      );
      return;
    }

    setFieldError(null);
    setSubmitError(null);
    setPending(true);

    const { error } = await rpc.renameTeam(league.id, cleanName);
    if (error) {
      setSubmitError(error);
      setPending(false);
      return;
    }

    // The rename is saved; the success message waits for the reload so the
    // panel never announces a name it is not showing yet.
    const refreshError = await refresh();
    setPending(false);

    if (refreshError) {
      setSubmitError(
        `Your team name was saved, but it could not be reloaded. ${refreshError}`
      );
      return;
    }

    closeEditor();
    onSaved("Team name saved.");
  }

  return (
    <section
      aria-labelledby="team-name-heading"
      className={`rounded-xl border border-line bg-panel p-5 ${className}`.trim()}
    >
      <h2
        id="team-name-heading"
        className="text-xs font-semibold uppercase tracking-wide text-muted"
      >
        Team name
      </h2>

      {editing ? (
        <form
          onSubmit={handleSubmit}
          noValidate
          className="mt-3 flex flex-col gap-3"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
            <Field
              label="Team name"
              required
              help={`${LEAGUE_LIMITS.teamName.max} characters max.`}
              error={fieldError}
              className="flex-1"
            >
              <Input
                name="team-name"
                autoComplete="off"
                maxLength={LEAGUE_LIMITS.teamName.max}
                value={value}
                onChange={(event) => setValue(event.target.value)}
                disabled={pending}
                autoFocus
              />
            </Field>
            <div className="flex gap-2 sm:pt-7">
              <Button
                type="submit"
                pending={pending}
                pendingText="Saving..."
                disabled={!value.trim()}
              >
                Save
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={cancel}
                disabled={pending}
              >
                Cancel
              </Button>
            </div>
          </div>

          {submitError && <Alert variant="error">{submitError}</Alert>}
        </form>
      ) : (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <p className="truncate text-2xl font-bold text-text">
              {teamNameLabel(member.team_name)}
            </p>
            <StatusPill tone={isCommissioner ? "accent" : "neutral"}>
              {isCommissioner ? "Commissioner" : "Coach"}
            </StatusPill>
          </div>
          <Button
            ref={renameButtonRef}
            variant="secondary"
            onClick={startEditing}
          >
            Rename
          </Button>
        </div>
      )}
    </section>
  );
}

"use client";

import { useState, type FormEvent } from "react";
import { SlidersHorizontal } from "lucide-react";
import {
  Alert,
  Button,
  Field,
  Input,
  NumberInput,
  Select,
} from "@/app/components/ui";
import { toPlayoffFormat, toTiebreaker } from "@/app/lib/league/bracket";
import {
  playoffFormatLabel,
  pluralize,
  scheduleFormatLabel,
  tiebreakerLabel,
} from "@/app/lib/league/labels";
import { rpc } from "@/app/lib/rpc";
import {
  LEAGUE_LIMITS,
  PLAYOFF_FORMATS,
  TIEBREAKERS,
  type League,
  type LeagueSettingsInput,
} from "@/app/types/league";
import {
  buildSettingsPatch,
  groupFormatOptions,
  NO_FORMAT,
  playoffFormatOptions,
  SCHEDULE_FORMATS,
  sameSettingsValues,
  settingsValuesFromLeague,
  toScheduleFormat,
  type FormatOption,
  type SettingsFieldErrors,
  type SettingsValues,
} from "./helpers";

type SettingsFormProps = {
  league: League;
  /** Current coach count; `max_coaches` may not drop below it. */
  memberCount: number;
  /**
   * Coaches who play in the season; once the draft has started, playoff
   * formats needing more are disabled (the function accepts any format
   * before the draft).
   */
  playingCount: number;
  /** A playoff result exists, so the playoff settings are locked (section 12.5). */
  playoffResultsExist: boolean;
  formats: FormatOption[];
  currentUserId: string;
  /** Called after a successful save; the parent refreshes the league and reports. */
  onSaved: (patch: LeagueSettingsInput) => Promise<void>;
};

const LOCKED_NOTE = "Locked during the draft.";
const PLAYOFFS_LOCKED_NOTE = "Locked while playoff results exist.";
const RESEED_NOTE =
  "Changing this after the regular season reseeds the playoff bracket.";

/**
 * League settings form for the commissioner. Only changed keys are sent to
 * `update_league_settings`; the draft-shaping fields are disabled once the
 * draft has started, matching the function's `locked_during_draft` rule,
 * and the playoff settings once a playoff result exists (`playoffs_started`).
 */
export default function SettingsForm({
  league,
  memberCount,
  playingCount,
  playoffResultsExist,
  formats,
  currentUserId,
  onSaved,
}: SettingsFormProps) {
  const saved = settingsValuesFromLeague(league);
  const [seed, setSeed] = useState(saved);
  const [form, setForm] = useState(saved);
  const [errors, setErrors] = useState<SettingsFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Adopt the row after a refresh (own save, reset, transfer) so the form
  // never shows values the league no longer has.
  if (!sameSettingsValues(seed, saved)) {
    setSeed(saved);
    setForm(saved);
    setErrors({});
  }

  const locked = Boolean(league.draft_started);
  const dirty = !sameSettingsValues(form, saved);
  const minCoaches = Math.max(LEAGUE_LIMITS.maxCoaches.min, memberCount);

  const formatGroups = groupFormatOptions(
    formats,
    currentUserId,
    league.draft_format_id
  );
  const playoffOptions = playoffFormatOptions(
    PLAYOFF_FORMATS,
    locked ? playingCount : null,
    saved.playoffFormat
  );

  function update<K extends keyof SettingsValues>(key: K, value: SettingsValues[K]) {
    setForm((previous) => ({ ...previous, [key]: value }));
    setErrors((previous) =>
      previous[key] ? { ...previous, [key]: undefined } : previous
    );
    if (formError) setFormError(null);
  }

  function resetForm() {
    setForm(saved);
    setErrors({});
    setFormError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const { patch, errors: nextErrors } = buildSettingsPatch(saved, form, memberCount);
    setErrors(nextErrors);
    if (Object.values(nextErrors).some(Boolean)) {
      setFormError("Fix the highlighted fields and try again.");
      return;
    }
    if (Object.keys(patch).length === 0) {
      setFormError("Nothing has changed.");
      return;
    }

    setFormError(null);
    setPending(true);
    const { error } = await rpc.updateLeagueSettings(league.id, patch);
    if (error !== null) {
      setFormError(error);
      setPending(false);
      return;
    }

    await onSaved(patch);
    setPending(false);
  }

  return (
    <section
      aria-labelledby="league-settings-heading"
      className="rounded-xl border border-line bg-panel p-5"
    >
      <div className="flex items-center gap-2">
        <SlidersHorizontal className="h-5 w-5 text-accent-text" aria-hidden="true" />
        <h2 id="league-settings-heading" className="text-lg font-semibold text-text">
          League settings
        </h2>
      </div>

      {locked && (
        <Alert variant="info" className="mt-4">
          The draft has started. The point budget, picks per team, max coaches
          and draft format are locked; the name, pick timer, swap limit,
          matchup format, tiebreaker and playoff format can still change.
        </Alert>
      )}

      {playoffResultsExist && (
        <Alert variant="info" className="mt-4">
          Playoff results have been recorded, so the tiebreaker and playoff
          format are locked. Clear the playoff results or the bracket on the
          Matches page to change them.
        </Alert>
      )}

      <form onSubmit={handleSubmit} noValidate className="mt-4 flex flex-col gap-4">
        <Field
          label="League name"
          required
          error={errors.name}
          help={`${LEAGUE_LIMITS.name.max} characters max.`}
        >
          <Input
            name="league-name"
            autoComplete="off"
            maxLength={LEAGUE_LIMITS.name.max}
            value={form.name}
            onChange={(event) => update("name", event.target.value)}
            disabled={pending}
          />
        </Field>

        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
          <Field
            label="Max coaches"
            error={errors.maxCoaches}
            help={locked ? LOCKED_NOTE : `${minCoaches} to ${LEAGUE_LIMITS.maxCoaches.max}. ${memberCount} joined so far.`}
          >
            <NumberInput
              value={form.maxCoaches}
              onValueChange={(value) => update("maxCoaches", value)}
              min={minCoaches}
              max={LEAGUE_LIMITS.maxCoaches.max}
              disabled={pending || locked}
            />
          </Field>

          <Field
            label="Point budget"
            error={errors.pointBudget}
            help={locked ? LOCKED_NOTE : `Points each coach can spend in the draft (${LEAGUE_LIMITS.pointBudget.min} to ${LEAGUE_LIMITS.pointBudget.max}).`}
          >
            <NumberInput
              value={form.pointBudget}
              onValueChange={(value) => update("pointBudget", value)}
              min={LEAGUE_LIMITS.pointBudget.min}
              max={LEAGUE_LIMITS.pointBudget.max}
              disabled={pending || locked}
            />
          </Field>

          <Field
            label="Picks per team"
            error={errors.picksPerTeam}
            help={locked ? LOCKED_NOTE : `Roster size (${LEAGUE_LIMITS.picksPerTeam.min} to ${LEAGUE_LIMITS.picksPerTeam.max}).`}
          >
            <NumberInput
              value={form.picksPerTeam}
              onValueChange={(value) => update("picksPerTeam", value)}
              min={LEAGUE_LIMITS.picksPerTeam.min}
              max={LEAGUE_LIMITS.picksPerTeam.max}
              disabled={pending || locked}
            />
          </Field>

          <Field
            label="Pick timer (seconds)"
            error={errors.pickTimerSeconds}
            help={`Time to pick before the best available Pokémon is auto-picked (${LEAGUE_LIMITS.pickTimerSeconds.min} to ${LEAGUE_LIMITS.pickTimerSeconds.max}).`}
          >
            <NumberInput
              value={form.pickTimerSeconds}
              onValueChange={(value) => update("pickTimerSeconds", value)}
              min={LEAGUE_LIMITS.pickTimerSeconds.min}
              max={LEAGUE_LIMITS.pickTimerSeconds.max}
              disabled={pending}
            />
          </Field>

          <Field
            label="Free agent swap limit"
            error={errors.freeAgentSwapLimit}
            help="Free agent swaps each coach may make after the draft. 0 turns them off."
          >
            <NumberInput
              value={form.freeAgentSwapLimit}
              onValueChange={(value) => update("freeAgentSwapLimit", value)}
              min={LEAGUE_LIMITS.freeAgentSwapLimit.min}
              max={LEAGUE_LIMITS.freeAgentSwapLimit.max}
              disabled={pending}
            />
          </Field>

          <Field
            label="Matchup format"
            help="How the season schedule is built. Regenerate the schedule on the Matches page to apply it."
          >
            <Select
              value={form.scheduleFormat}
              onChange={(event) =>
                update("scheduleFormat", toScheduleFormat(event.target.value))
              }
              disabled={pending}
            >
              {SCHEDULE_FORMATS.map((option) => (
                <option key={option} value={option}>
                  {scheduleFormatLabel(option)}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Tiebreaker"
            help={
              playoffResultsExist
                ? PLAYOFFS_LOCKED_NOTE
                : `Applied after win percentage and wins, then the other tiebreaker, strength of schedule and a coin flip. ${RESEED_NOTE}`
            }
          >
            <Select
              value={form.tiebreaker}
              onChange={(event) => update("tiebreaker", toTiebreaker(event.target.value))}
              disabled={pending || playoffResultsExist}
            >
              {TIEBREAKERS.map((option) => (
                <option key={option} value={option}>
                  {tiebreakerLabel(option)}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Playoff format"
            help={
              playoffResultsExist
                ? PLAYOFFS_LOCKED_NOTE
                : `The top seeds after the regular season play a single-elimination bracket. ${
                    locked
                      ? `${pluralize(playingCount, "coach plays", "coaches play")}.`
                      : "Formats that need more coaches than play are disabled once the draft starts."
                  } ${RESEED_NOTE}`
            }
          >
            <Select
              value={form.playoffFormat}
              onChange={(event) =>
                update("playoffFormat", toPlayoffFormat(event.target.value))
              }
              disabled={pending || playoffResultsExist}
            >
              {playoffOptions.map((option) => (
                <option key={option.value} value={option.value} disabled={option.disabled}>
                  {playoffFormatLabel(option.value)}
                  {option.disabled ? ` (needs ${option.needs} coaches)` : ""}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field
          label="Draft format"
          error={errors.draftFormatId}
          help={
            locked
              ? LOCKED_NOTE
              : "Changing the format replaces the league's draft pool with a copy of the chosen format, so any customisation made on the Pool page is reset. Choosing None clears the pool."
          }
        >
          <Select
            value={form.draftFormatId}
            onChange={(event) => update("draftFormatId", event.target.value)}
            disabled={pending || locked}
          >
            <option value={NO_FORMAT}>None</option>
            {(formatGroups.current || formatGroups.currentMissing) && (
              <optgroup label="Current format">
                {formatGroups.current ? (
                  <option value={formatGroups.current.id}>
                    {formatGroups.current.name} (from a previous commissioner)
                  </option>
                ) : (
                  <option value={league.draft_format_id ?? NO_FORMAT}>
                    Format no longer available
                  </option>
                )}
              </optgroup>
            )}
            {formatGroups.own.length > 0 && (
              <optgroup label="Your formats">
                {formatGroups.own.map((format) => (
                  <option key={format.id} value={format.id}>
                    {format.name}
                  </option>
                ))}
              </optgroup>
            )}
            {formatGroups.shared.length > 0 && (
              <optgroup label="Shared formats">
                {formatGroups.shared.map((format) => (
                  <option key={format.id} value={format.id}>
                    {format.name}
                  </option>
                ))}
              </optgroup>
            )}
          </Select>
        </Field>

        {formError && <Alert variant="error">{formError}</Alert>}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="secondary"
            onClick={resetForm}
            disabled={!dirty || pending}
          >
            Discard changes
          </Button>
          <Button
            type="submit"
            pending={pending}
            pendingText="Saving..."
            disabled={!dirty}
          >
            Save settings
          </Button>
        </div>
      </form>
    </section>
  );
}

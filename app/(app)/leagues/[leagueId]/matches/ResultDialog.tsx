"use client";

import { useState } from "react";
import {
  Alert,
  Button,
  clampInteger,
  Dialog,
  Field,
  NumberInput,
  Select,
} from "@/app/components/ui";
import { isMatchCompleted, isPlayoffMatch } from "@/app/lib/league/bracket";
import { rpc } from "@/app/lib/rpc";
import { LEAGUE_LIMITS, type LeagueMatch } from "@/app/types/league";
import {
  isStaleBracketError,
  matchLabel,
  memberTeamName,
  resultErrorHint,
  type MatchMember,
} from "./helpers";

/** A result dialog: record a winner for an upcoming match, or edit a final. */
export type ResultAction =
  | { kind: "report"; match: LeagueMatch; winnerMemberId: string }
  | { kind: "edit"; match: LeagueMatch };

type ResultDialogProps = {
  action: ResultAction | null;
  members: MatchMember[];
  /** Every match of the league, for playoff round names and feeder lookups. */
  matches: LeagueMatch[];
  onClose: () => void;
  /** After a successful save or clear; the parent reloads and reports. */
  onDone: (message: string) => Promise<void>;
  /**
   * A refusal whose code means the bracket on screen is behind the server
   * (`playoffs_started`, `later_round_decided`, `match_not_ready`); the
   * parent reloads while the dialog keeps showing the message.
   */
  onStale: () => void;
};

type Pending = "save" | "clear" | null;

function actionKey(action: ResultAction | null): string {
  return action ? `${action.kind}:${action.match.id}` : "";
}

function initialWinner(action: ResultAction | null): string {
  if (!action) return "";
  if (action.kind === "report") return action.winnerMemberId;
  return action.match.winner_member_id ?? action.match.home_member_id ?? "";
}

function initialRemaining(action: ResultAction | null): number | null {
  return action?.kind === "edit" ? action.match.winner_remaining : null;
}

/**
 * Records, edits and clears a result through `report_match_result` and
 * `clear_match_result`. "Winner's Pokémon left standing" is optional and
 * feeds the differential tiebreaker (section 12.3). Failures keep the
 * function's message and add the next step for the playoff codes
 * (`resultErrorHint`), never matching on the wording.
 */
export default function ResultDialog({
  action,
  members,
  matches,
  onClose,
  onDone,
  onStale,
}: ResultDialogProps) {
  const key = actionKey(action);
  const [seedKey, setSeedKey] = useState(key);
  const [winnerId, setWinnerId] = useState(() => initialWinner(action));
  const [remaining, setRemaining] = useState<number | null>(() =>
    initialRemaining(action)
  );
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  // Start over for every match the dialog opens on (React's "adjusting
  // state when a prop changes" pattern, evaluated during render).
  if (seedKey !== key) {
    setSeedKey(key);
    setWinnerId(initialWinner(action));
    setRemaining(initialRemaining(action));
    setError(null);
    setHint(null);
  }

  const match = action?.match ?? null;
  const playoff = match ? isPlayoffMatch(match) : false;
  const label = match ? matchLabel(match, matches) : "";
  // "the Final" / "the Semifinals" in prose; a regular match is "Round 3".
  const labelPhrase = playoff ? `the ${label}` : label;
  const homeName = match ? memberTeamName(members, match.home_member_id) : "";
  const awayName = match ? memberTeamName(members, match.away_member_id) : "";
  const fed =
    match?.feeds_match_id
      ? (matches.find((candidate) => candidate.id === match.feeds_match_id) ?? null)
      : null;
  const laterRoundDecided = fed !== null && isMatchCompleted(fed);
  const isFinal = playoff && match !== null && match.feeds_match_id === null;

  function fail(result: { error: string; code: string | null }) {
    setError(result.error);
    setHint(resultErrorHint(result.code));
    setPending(null);
    if (isStaleBracketError(result.code)) onStale();
  }

  function close() {
    if (pending) return;
    onClose();
  }

  async function confirm() {
    if (!action || pending) return;
    if (!winnerId) {
      setError("Choose the winner.");
      return;
    }

    setError(null);
    setHint(null);
    setPending("save");
    const left =
      remaining === null
        ? null
        : clampInteger(
            remaining,
            LEAGUE_LIMITS.winnerRemaining.min,
            LEAGUE_LIMITS.winnerRemaining.max
          );
    const result = await rpc.reportMatchResult(action.match.id, winnerId, left);
    if (result.error !== null) {
      fail(result);
      return;
    }

    const winnerName = memberTeamName(members, winnerId);
    await onDone(
      isFinal
        ? `Recorded ${winnerName} as the winner of the Final. ${winnerName} is the champion.`
        : `Recorded ${winnerName} as the winner of ${labelPhrase}.`
    );
    setPending(null);
  }

  async function clear() {
    if (!action || action.kind !== "edit" || pending) return;

    setError(null);
    setHint(null);
    setPending("clear");
    const result = await rpc.clearMatchResult(action.match.id);
    if (result.error !== null) {
      fail(result);
      return;
    }

    await onDone(`Cleared the ${label} result for ${homeName} vs ${awayName}.`);
    setPending(null);
  }

  return (
    <Dialog
      open={action !== null}
      onClose={close}
      title={
        action?.kind === "report"
          ? `Record ${memberTeamName(members, action.winnerMemberId)} as the winner of ${labelPhrase}?`
          : "Edit result"
      }
      description={
        match
          ? action?.kind === "report"
            ? `${homeName} vs ${awayName}${playoff ? "" : `, match ${match.match_number}`}. ${
                isFinal
                  ? "The winner is the champion."
                  : playoff
                    ? "The winner advances to the next round."
                    : "The result is posted to the league news."
              }`
            : `${label}${playoff ? "" : `, match ${match.match_number}`}: ${homeName} vs ${awayName}.`
          : undefined
      }
      onConfirm={confirm}
      confirmLabel={action?.kind === "edit" ? "Save result" : "Record result"}
      pending={pending === "save"}
      error={
        error ? (
          <>
            {error}
            {hint && <span className="mt-1 block font-normal">{hint}</span>}
          </>
        ) : null
      }
    >
      {match && (
        <div className="flex flex-col gap-4">
          {action?.kind === "edit" && laterRoundDecided && (
            <Alert variant="info">
              The next round has already been decided. Clear that result
              first to change this one.
            </Alert>
          )}

          {action?.kind === "edit" && (
            <Field label="Winner">
              <Select
                value={winnerId}
                onChange={(event) => setWinnerId(event.target.value)}
                disabled={pending !== null}
              >
                {match.home_member_id && (
                  <option value={match.home_member_id}>{homeName}</option>
                )}
                {match.away_member_id && (
                  <option value={match.away_member_id}>{awayName}</option>
                )}
              </Select>
            </Field>
          )}

          <Field
            label="Winner's Pokémon left standing"
            help={`Optional, ${LEAGUE_LIMITS.winnerRemaining.min} to ${LEAGUE_LIMITS.winnerRemaining.max}. Used for the differential tiebreaker.`}
          >
            <div className="w-24">
              <NumberInput
                value={remaining}
                onValueChange={setRemaining}
                min={LEAGUE_LIMITS.winnerRemaining.min}
                max={LEAGUE_LIMITS.winnerRemaining.max}
                disabled={pending !== null}
              />
            </div>
          </Field>

          {action?.kind === "edit" && (
            <div>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={clear}
                pending={pending === "clear"}
                pendingText="Clearing..."
                disabled={pending === "save"}
              >
                Clear result
              </Button>
              <p className="mt-1.5 text-xs text-muted">
                {isFinal
                  ? "Clearing sets the Final back to Upcoming and removes the champion."
                  : playoff
                    ? "Clearing sets the match back to Upcoming and empties the next round's slot."
                    : "Clearing sets the match back to Upcoming and removes its news item."}
              </p>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}

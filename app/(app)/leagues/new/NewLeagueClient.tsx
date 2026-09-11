"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import Alert from "@/app/components/ui/Alert";
import Button, { ButtonLink } from "@/app/components/ui/Button";
import Field from "@/app/components/ui/Field";
import Input from "@/app/components/ui/Input";
import NumberInput from "@/app/components/ui/NumberInput";
import PageHeader from "@/app/components/ui/PageHeader";
import Select from "@/app/components/ui/Select";
import Skeleton from "@/app/components/ui/Skeleton";
import { getCurrentUser } from "@/app/lib/auth/current-user";
import { friendlyError } from "@/app/lib/errors";
import {
  buildCreateLeagueInput,
  CREATE_LEAGUE_DEFAULTS,
} from "@/app/lib/league/limits";
import { rpc } from "@/app/lib/rpc";
import { createClient } from "@/app/lib/supabase/client";
import { LEAGUE_LIMITS } from "@/app/types/league";

type FormatOption = {
  id: string;
  name: string;
  /** Null means the format is shared with everyone. */
  created_by: string | null;
};

/** The dropdown's two groups: the caller's own formats and the shared ones. */
type FormatGroups = { own: FormatOption[]; shared: FormatOption[] };

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; formats: FormatGroups; signedIn: boolean };

const NO_FORMATS: FormatGroups = { own: [], shared: [] };

/**
 * Keeps only the formats `create_league` accepts. The `draft_formats` select
 * policy also returns the format behind any league the caller belongs to
 * (docs/schema.md "Row level security"), but `create_league` validates the
 * choice with `_visible_format`, which takes own and shared rows only; a
 * league's private format would fail with `format_not_found`.
 */
function groupFormats(rows: FormatOption[], userId: string): FormatGroups {
  const groups: FormatGroups = { own: [], shared: [] };
  for (const row of rows) {
    if (row.created_by === userId) groups.own.push(row);
    else if (row.created_by === null) groups.shared.push(row);
  }
  return groups;
}

type NumberKey =
  | "maxCoaches"
  | "pointBudget"
  | "picksPerTeam"
  | "pickTimerSeconds";

type NumberValues = Record<NumberKey, number | null>;
type NumberErrors = Partial<Record<NumberKey, string>>;

const NUMBER_FIELDS: ReadonlyArray<{
  key: NumberKey;
  label: string;
  help: string;
  range: { readonly min: number; readonly max: number };
}> = [
  {
    key: "maxCoaches",
    label: "Max coaches",
    help: "Including you. The invite stops working once the league is full.",
    range: LEAGUE_LIMITS.maxCoaches,
  },
  {
    key: "pointBudget",
    label: "Point budget",
    help: "Points each team can spend on its roster.",
    range: LEAGUE_LIMITS.pointBudget,
  },
  {
    key: "picksPerTeam",
    label: "Picks per team",
    help: "Roster size for every team.",
    range: LEAGUE_LIMITS.picksPerTeam,
  },
  {
    key: "pickTimerSeconds",
    label: "Pick timer (seconds)",
    help: "Time to pick before the best available Pokémon is drafted automatically.",
    range: LEAGUE_LIMITS.pickTimerSeconds,
  },
];

/** Select value for "no draft format". */
const NO_FORMAT = "";

/**
 * Create League: one form that calls `create_league` through the typed
 * wrapper (docs/release-architecture.md sections 5 and 8.3). The function
 * inserts the league, the commissioner member row and the invite in one
 * transaction, so nothing here writes to a table directly.
 *
 * The session is classified with `getCurrentUser` (section 8.2): a failed
 * check is shown with Retry, and a missing session renders a warning with a
 * login link instead of a redirect (the proxy owns the auth gate).
 */
export default function NewLeagueClient() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [name, setName] = useState("");
  const [teamName, setTeamName] = useState("");
  const [draftFormatId, setDraftFormatId] = useState(NO_FORMAT);
  const [numbers, setNumbers] = useState<NumberValues>({
    maxCoaches: CREATE_LEAGUE_DEFAULTS.maxCoaches,
    pointBudget: CREATE_LEAGUE_DEFAULTS.pointBudget,
    picksPerTeam: CREATE_LEAGUE_DEFAULTS.picksPerTeam,
    pickTimerSeconds: CREATE_LEAGUE_DEFAULTS.pickTimerSeconds,
  });
  const [numberErrors, setNumberErrors] = useState<NumberErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const load = useCallback(async (): Promise<LoadState> => {
    try {
      const [current, formatsResult] = await Promise.all([
        getCurrentUser(supabase.auth),
        supabase
          .from("draft_formats")
          .select("id, name, created_by")
          .order("name", { ascending: true }),
      ]);

      if (current.status === "error") {
        return { status: "error", message: current.message };
      }
      if (formatsResult.error) {
        return { status: "error", message: friendlyError(formatsResult.error) };
      }
      if (current.status !== "signed-in") {
        // The table is readable by authenticated users only; a signed-out
        // visitor gets the login warning and no choices.
        return { status: "ready", formats: NO_FORMATS, signedIn: false };
      }

      return {
        status: "ready",
        formats: groupFormats(
          (formatsResult.data ?? []) as FormatOption[],
          current.user.id
        ),
        signedIn: true,
      };
    } catch (caught) {
      return { status: "error", message: friendlyError(caught) };
    }
  }, [supabase]);

  useEffect(() => {
    let active = true;
    void load().then((next) => {
      if (active) setState(next);
    });
    return () => {
      active = false;
    };
  }, [load]);

  function retry() {
    setState({ status: "loading" });
    void load().then(setState);
  }

  function setNumber(key: NumberKey, value: number | null) {
    setNumbers((prev) => ({ ...prev, [key]: value }));
    setNumberErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const missing: NumberErrors = {};
    for (const field of NUMBER_FIELDS) {
      if (numbers[field.key] === null) {
        missing[field.key] =
          `Enter a number from ${field.range.min} to ${field.range.max}.`;
      }
    }
    if (Object.keys(missing).length > 0) {
      setNumberErrors(missing);
      setError("Fill in every number before creating the league.");
      return;
    }

    const built = buildCreateLeagueInput({
      name,
      teamName,
      maxCoaches: numbers.maxCoaches,
      draftFormatId: draftFormatId || null,
      pointBudget: numbers.pointBudget,
      picksPerTeam: numbers.picksPerTeam,
      pickTimerSeconds: numbers.pickTimerSeconds,
    });
    if (built.error !== null) {
      setError(built.error);
      return;
    }

    setError(null);
    setPending(true);
    try {
      const { data: leagueId, error: createError } = await rpc.createLeague(
        built.input
      );
      if (createError !== null || !leagueId) {
        setError(createError ?? "Could not create the league.");
        setPending(false);
        return;
      }
      // Stay pending so the button does not flicker while the router moves on.
      router.replace(`/leagues/${leagueId}`);
    } catch (caught) {
      setError(friendlyError(caught));
      setPending(false);
    }
  }

  const loading = state.status === "loading";
  const signedOut = state.status === "ready" && !state.signedIn;
  const formats = state.status === "ready" ? state.formats : NO_FORMATS;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <PageHeader
        eyebrow="League setup"
        title="Create League"
        description="You become the commissioner. Coaches join with the invite code shown on the league overview."
      />

      {signedOut && (
        <Alert
          variant="warning"
          title="You are not logged in"
          action={
            <ButtonLink
              size="sm"
              variant="secondary"
              href="/login?next=/leagues/new"
            >
              Log in
            </ButtonLink>
          }
        >
          Log in to create a league.
        </Alert>
      )}

      {state.status === "error" && (
        <Alert
          variant="error"
          title="Could not finish loading"
          action={
            <Button size="sm" variant="secondary" onClick={retry}>
              Retry
            </Button>
          }
        >
          {state.message} You can still try to create the league without a
          draft format.
        </Alert>
      )}

      <form
        onSubmit={handleSubmit}
        noValidate
        className="flex flex-col gap-6 rounded-xl border border-line bg-panel p-5 sm:p-6"
      >
        <section aria-labelledby="basics-heading" className="flex flex-col gap-4">
          <h2 id="basics-heading" className="text-lg font-semibold text-text">
            Basics
          </h2>

          <Field
            label="League name"
            required
            help={`Up to ${LEAGUE_LIMITS.name.max} characters.`}
          >
            <Input
              name="league-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={LEAGUE_LIMITS.name.max}
              autoComplete="off"
              disabled={pending}
              autoFocus
            />
          </Field>

          <Field
            label="Your team name"
            required
            help={`You can change this later. Up to ${LEAGUE_LIMITS.teamName.max} characters.`}
          >
            <Input
              name="team-name"
              value={teamName}
              onChange={(event) => setTeamName(event.target.value)}
              maxLength={LEAGUE_LIMITS.teamName.max}
              autoComplete="off"
              disabled={pending}
            />
          </Field>
        </section>

        <section aria-labelledby="draft-heading" className="flex flex-col gap-4">
          <h2 id="draft-heading" className="text-lg font-semibold text-text">
            Draft rules
          </h2>

          <div className="grid gap-4 sm:grid-cols-2">
            {NUMBER_FIELDS.map((field) => (
              <Field
                key={field.key}
                label={field.label}
                required
                help={field.help}
                error={numberErrors[field.key]}
              >
                <NumberInput
                  value={numbers[field.key]}
                  onValueChange={(value) => setNumber(field.key, value)}
                  min={field.range.min}
                  max={field.range.max}
                  disabled={pending}
                />
              </Field>
            ))}
          </div>

          <Field
            label="Draft format"
            help={
              <>
                Copies the format&apos;s Pokémon into this league as its draft
                pool. Lists the formats you created and the shared ones. You
                can customise the pool later on the league&apos;s Pool page, or
                build a new format in the{" "}
                <Link
                  href="/builder"
                  className="font-semibold text-accent-text hover:underline"
                >
                  Pool Builder
                </Link>
                .
              </>
            }
          >
            <Select
              value={draftFormatId}
              onChange={(event) => setDraftFormatId(event.target.value)}
              disabled={pending || loading}
            >
              <option value={NO_FORMAT}>No format yet (set it later)</option>
              {formats.own.length > 0 && (
                <optgroup label="My formats">
                  {formats.own.map((format) => (
                    <option key={format.id} value={format.id}>
                      {format.name}
                    </option>
                  ))}
                </optgroup>
              )}
              {formats.shared.length > 0 && (
                <optgroup label="Shared formats">
                  {formats.shared.map((format) => (
                    <option key={format.id} value={format.id}>
                      {format.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </Select>
          </Field>

          {loading && (
            <div aria-busy="true">
              <Skeleton className="h-4 w-56 max-w-full" />
            </div>
          )}
        </section>

        {error && <Alert variant="error">{error}</Alert>}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <ButtonLink href="/dashboard" variant="secondary">
            Cancel
          </ButtonLink>
          <Button
            type="submit"
            pending={pending}
            pendingText="Creating..."
            disabled={!name.trim() || !teamName.trim() || signedOut}
          >
            Create League
          </Button>
        </div>
      </form>
    </div>
  );
}

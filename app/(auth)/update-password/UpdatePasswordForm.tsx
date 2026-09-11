"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import Alert from "@/app/components/ui/Alert";
import Button, { ButtonLink } from "@/app/components/ui/Button";
import Field from "@/app/components/ui/Field";
import Input from "@/app/components/ui/Input";
import Skeleton from "@/app/components/ui/Skeleton";
import { getCurrentUser } from "@/app/lib/auth/current-user";
import { withNextParam } from "@/app/lib/auth/next-path";
import { friendlyError } from "@/app/lib/errors";
import { createClient } from "@/app/lib/supabase/client";
import { linkClassName } from "@/app/lib/theme";

const MIN_PASSWORD_LENGTH = 8;

type SessionState =
  | { status: "checking" }
  | { status: "ready" }
  | { status: "missing" }
  | { status: "error"; message: string };

/**
 * "missing" only when auth-js really has no session; a failed check (auth
 * server unreachable, 5xx) is reported as an error with Retry instead of
 * being mistaken for an expired link (app/lib/auth/current-user.ts).
 */
async function checkSession(): Promise<SessionState> {
  const current = await getCurrentUser(createClient().auth);
  if (current.status === "signed-in") return { status: "ready" };
  if (current.status === "signed-out") return { status: "missing" };
  return { status: "error", message: current.message };
}

/**
 * Reached from the recovery email via /auth/callback?next=/update-password,
 * which establishes a session first. Visitors without a session are told to
 * request a new link instead of seeing a form that cannot succeed.
 *
 * `next` is the destination the user was heading for before they forgot
 * their password (carried by the forgot-password page through the email
 * link and sanitized by the page); a saved password sends them there.
 */
export default function UpdatePasswordForm({ next }: { next: string }) {
  const router = useRouter();
  const [sessionState, setSessionState] = useState<SessionState>({
    status: "checking",
  });
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let active = true;

    void checkSession().then((next) => {
      if (active) setSessionState(next);
    });

    return () => {
      active = false;
    };
  }, []);

  function retryCheck() {
    setSessionState({ status: "checking" });
    void checkSession().then(setSessionState);
  }

  const mismatch = confirm.length > 0 && confirm !== password;
  const tooShort = password.length > 0 && password.length < MIN_PASSWORD_LENGTH;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Use at least ${MIN_PASSWORD_LENGTH} characters for your password.`);
      return;
    }
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }

    setError(null);
    setPending(true);

    try {
      const supabase = createClient();
      const { error: updateError } = await supabase.auth.updateUser({
        password,
      });

      if (updateError) {
        setError(friendlyError(updateError));
        return;
      }

      router.replace(next);
      router.refresh();
    } catch (caught) {
      setError(friendlyError(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <h1 className="text-2xl font-bold sm:text-3xl">Choose a new password</h1>
      <p className="mt-1 text-sm text-muted">
        Pick something you have not used here before.
      </p>

      {sessionState.status === "checking" && (
        <div className="mt-6 flex flex-col gap-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      )}

      {sessionState.status === "missing" && (
        <>
          <Alert variant="warning" title="This link has expired" className="mt-5">
            Password links only work once and for a short time. Request a new
            one and open it from the same browser.
          </Alert>
          {/* The log-in link below is shared by every state, so it is not
              repeated here as a second button. */}
          <div className="mt-5">
            <ButtonLink href={withNextParam("/forgot-password", next)}>
              Request a new link
            </ButtonLink>
          </div>
        </>
      )}

      {sessionState.status === "error" && (
        <Alert
          variant="error"
          title="Could not check your session"
          className="mt-5"
          action={
            <Button size="sm" variant="secondary" onClick={retryCheck}>
              Retry
            </Button>
          }
        >
          {sessionState.message}
        </Alert>
      )}

      {sessionState.status === "ready" && (
        <form onSubmit={handleSubmit} noValidate className="mt-6 flex flex-col gap-4">
          <Field
            label="New password"
            required
            help={`At least ${MIN_PASSWORD_LENGTH} characters.`}
            error={
              tooShort ? `Use at least ${MIN_PASSWORD_LENGTH} characters.` : undefined
            }
          >
            <Input
              type="password"
              name="new-password"
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={pending}
              autoFocus
            />
          </Field>

          <Field
            label="Confirm new password"
            required
            error={mismatch ? "The two passwords do not match." : undefined}
          >
            <Input
              type="password"
              name="confirm-password"
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              disabled={pending}
            />
          </Field>

          {error && <Alert variant="error">{error}</Alert>}

          <Button
            type="submit"
            size="lg"
            pending={pending}
            pendingText="Saving..."
            disabled={
              password.length < MIN_PASSWORD_LENGTH || confirm !== password
            }
            className="w-full"
          >
            Save new password
          </Button>
        </form>
      )}

      <p className="mt-6 text-sm text-muted">
        <Link
          href={withNextParam("/login", next)}
          className={`${linkClassName} font-semibold text-accent-text hover:underline`}
        >
          Back to log in
        </Link>
      </p>
    </>
  );
}

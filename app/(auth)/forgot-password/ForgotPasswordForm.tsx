"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import Alert from "@/app/components/ui/Alert";
import Button from "@/app/components/ui/Button";
import Field from "@/app/components/ui/Field";
import Input from "@/app/components/ui/Input";
import { withNextParam } from "@/app/lib/auth/next-path";
import { friendlyError } from "@/app/lib/errors";
import { createClient } from "@/app/lib/supabase/client";
import { linkClassName } from "@/app/lib/theme";

/**
 * Where the recovery email lands. `/auth/callback` establishes the session
 * and redirects to `/update-password`, which carries the original `next`
 * (`/update-password?next=<path>`, omitted for the default destination) so
 * the page can send the user on once the new password is saved. Every hop
 * re-validates the path: `resolveCallbackNext` in the callback route and
 * `sanitizeNextPath` in the update-password page.
 */
function recoveryRedirectUrl(next: string) {
  const destination = withNextParam("/update-password", next);
  return `${window.location.origin}/auth/callback?next=${encodeURIComponent(destination)}`;
}

export default function ForgotPasswordForm({ next }: { next: string }) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const cleanEmail = email.trim();
    setError(null);
    setPending(true);

    try {
      const supabase = createClient();
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(
        cleanEmail,
        { redirectTo: recoveryRedirectUrl(next) }
      );

      if (resetError) {
        setError(friendlyError(resetError));
        return;
      }

      setSentTo(cleanEmail);
    } catch (caught) {
      setError(friendlyError(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <h1 className="text-2xl font-bold sm:text-3xl">Reset your password</h1>
      <p className="mt-1 text-sm text-muted">
        Enter your email and we will send you a link to choose a new password.
      </p>

      {sentTo ? (
        <Alert variant="success" title="Reset link sent" className="mt-5">
          If an account exists for{" "}
          <span className="font-semibold text-text">{sentTo}</span>, a reset
          link is on its way. The link opens a page where you can set a new
          password.
        </Alert>
      ) : (
        <form onSubmit={handleSubmit} noValidate className="mt-6 flex flex-col gap-4">
          <Field label="Email" required>
            <Input
              type="email"
              name="email"
              autoComplete="email"
              inputMode="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={pending}
              autoFocus
            />
          </Field>

          {error && <Alert variant="error">{error}</Alert>}

          <Button
            type="submit"
            size="lg"
            pending={pending}
            pendingText="Sending..."
            disabled={!email.trim()}
            className="w-full"
          >
            Send reset link
          </Button>
        </form>
      )}

      <p className="mt-6 text-sm text-muted">
        Remembered it?{" "}
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

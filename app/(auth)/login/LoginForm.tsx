"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import Alert from "@/app/components/ui/Alert";
import Button from "@/app/components/ui/Button";
import Field from "@/app/components/ui/Field";
import Input from "@/app/components/ui/Input";
import type { LinkError } from "@/app/lib/auth/callback";
import { withNextParam } from "@/app/lib/auth/next-path";
import { friendlyError } from "@/app/lib/errors";
import { createClient } from "@/app/lib/supabase/client";
import { linkClassName } from "@/app/lib/theme";

export default function LoginForm({
  next,
  linkError = null,
}: {
  next: string;
  /**
   * Why /auth/callback sent the user here (app/lib/auth/callback.ts).
   * `invalid`: the email link was invalid or expired. `other-device`: the
   * link was opened in a different browser or device than the one that
   * signed up, so the PKCE verifier cookie was missing; the email is
   * confirmed and a password login finishes the job (`next` is preserved).
   */
  linkError?: LinkError | null;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    setError(null);
    setPending(true);

    try {
      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (signInError) {
        setError(friendlyError(signInError));
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
      <h1 className="text-2xl font-bold sm:text-3xl">Log in</h1>
      <p className="mt-1 text-sm text-muted">
        Welcome back, coach. Log in to get to your leagues.
      </p>

      {linkError === "other-device" && (
        <Alert
          variant="warning"
          title="Almost there"
          className="mt-5"
        >
          That link was opened in a different browser or device than the one
          you signed up on, so it could not sign you in by itself. Your email
          is confirmed: log in with your password to continue where you left
          off.
        </Alert>
      )}

      {linkError === "invalid" && (
        <Alert variant="warning" className="mt-5">
          We could not finish signing you in from that link. If you just
          confirmed your email, log in with your password. Otherwise the link
          may have expired, so{" "}
          <Link
            href={withNextParam("/forgot-password", next)}
            className={`${linkClassName} font-semibold underline`}
          >
            request a new one
          </Link>
          .
        </Alert>
      )}

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

        <Field label="Password" required>
          <Input
            type="password"
            name="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={pending}
          />
        </Field>

        {error && <Alert variant="error">{error}</Alert>}

        <Button
          type="submit"
          size="lg"
          pending={pending}
          pendingText="Logging in..."
          disabled={!email.trim() || !password}
          className="w-full"
        >
          Log in
        </Button>
      </form>

      {/* Both links to /forgot-password carry `next`, so a coach who came
          from an invite still lands on it after the recovery round trip
          (forgot-password -> email -> /auth/callback -> update-password). */}
      <div className="mt-6 flex flex-col gap-2 text-sm text-muted sm:flex-row sm:justify-between">
        <Link
          href={withNextParam("/forgot-password", next)}
          className={`${linkClassName} font-semibold text-accent-text hover:underline`}
        >
          Forgot your password?
        </Link>
        <p>
          New here?{" "}
          <Link
            href={withNextParam("/signup", next)}
            className={`${linkClassName} font-semibold text-accent-text hover:underline`}
          >
            Sign up
          </Link>
        </p>
      </div>
    </>
  );
}

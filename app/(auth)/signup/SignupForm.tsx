"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import Alert from "@/app/components/ui/Alert";
import Button from "@/app/components/ui/Button";
import Field from "@/app/components/ui/Field";
import Input from "@/app/components/ui/Input";
import { withNextParam } from "@/app/lib/auth/next-path";
import { friendlyError } from "@/app/lib/errors";
import { createClient } from "@/app/lib/supabase/client";
import { linkClassName } from "@/app/lib/theme";

export const MIN_PASSWORD_LENGTH = 8;

function callbackUrl(next: string) {
  return `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
}

export default function SignupForm({ next }: { next: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [resendState, setResendState] = useState<
    "idle" | "sending" | "sent" | "error"
  >("idle");
  const [resendError, setResendError] = useState<string | null>(null);

  const passwordTooShort =
    password.length > 0 && password.length < MIN_PASSWORD_LENGTH;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const cleanEmail = email.trim();
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Use at least ${MIN_PASSWORD_LENGTH} characters for your password.`);
      return;
    }

    setError(null);
    setPending(true);

    try {
      const supabase = createClient();
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: cleanEmail,
        password,
        options: { emailRedirectTo: callbackUrl(next) },
      });

      if (signUpError) {
        setError(friendlyError(signUpError));
        return;
      }

      if (data.session) {
        // Email confirmation is disabled on this project: already logged in.
        router.replace(next);
        router.refresh();
        return;
      }

      if (data.user && data.user.identities?.length === 0) {
        // Supabase returns an obfuscated user for an existing email.
        setError("An account with this email already exists. Log in instead.");
        return;
      }

      setSentTo(cleanEmail);
    } catch (caught) {
      setError(friendlyError(caught));
    } finally {
      setPending(false);
    }
  }

  async function resend() {
    if (!sentTo || resendState === "sending") return;
    setResendState("sending");
    setResendError(null);
    try {
      const supabase = createClient();
      const { error: resendFailure } = await supabase.auth.resend({
        type: "signup",
        email: sentTo,
        options: { emailRedirectTo: callbackUrl(next) },
      });
      if (resendFailure) {
        setResendError(friendlyError(resendFailure));
        setResendState("error");
        return;
      }
      setResendState("sent");
    } catch (caught) {
      setResendError(friendlyError(caught));
      setResendState("error");
    }
  }

  if (sentTo) {
    return (
      <>
        <h1 className="text-2xl font-bold sm:text-3xl">Check your email</h1>
        <Alert variant="success" title="Confirmation link sent" className="mt-5">
          We sent a link to <span className="font-semibold text-text">{sentTo}</span>.
          Open it to confirm your account; it brings you straight back here.
        </Alert>
        <p className="mt-4 text-sm text-muted">
          Nothing after a couple of minutes? Check your spam folder, or send
          the link again.
        </p>
        {resendError && (
          <Alert variant="error" className="mt-3">
            {resendError}
          </Alert>
        )}
        {resendState === "sent" && (
          <Alert variant="info" className="mt-3">
            A new link is on its way.
          </Alert>
        )}
        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <Button
            variant="secondary"
            onClick={resend}
            pending={resendState === "sending"}
            pendingText="Sending..."
            disabled={resendState === "sent"}
          >
            Resend link
          </Button>
          <Button variant="ghost" onClick={() => setSentTo(null)}>
            Use a different email
          </Button>
        </div>
      </>
    );
  }

  return (
    <>
      <h1 className="text-2xl font-bold sm:text-3xl">Create your account</h1>
      <p className="mt-1 text-sm text-muted">
        One account lets you run leagues and coach in others.
      </p>

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

        <Field
          label="Password"
          required
          help={`At least ${MIN_PASSWORD_LENGTH} characters.`}
          error={
            passwordTooShort
              ? `Use at least ${MIN_PASSWORD_LENGTH} characters.`
              : undefined
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
          />
        </Field>

        {error && <Alert variant="error">{error}</Alert>}

        <Button
          type="submit"
          size="lg"
          pending={pending}
          pendingText="Creating account..."
          disabled={!email.trim() || password.length < MIN_PASSWORD_LENGTH}
          className="w-full"
        >
          Sign up
        </Button>
      </form>

      <p className="mt-6 text-sm text-muted">
        Already have an account?{" "}
        <Link
          href={withNextParam("/login", next)}
          className={`${linkClassName} font-semibold text-accent-text hover:underline`}
        >
          Log in
        </Link>
      </p>
    </>
  );
}

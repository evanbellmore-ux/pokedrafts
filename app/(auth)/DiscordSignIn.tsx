"use client";

import { useState } from "react";
import Alert from "@/app/components/ui/Alert";
import Button from "@/app/components/ui/Button";
import { providerCallbackUrl } from "@/app/lib/auth/callback";
import { friendlyError } from "@/app/lib/errors";
import { createClient } from "@/app/lib/supabase/client";

/**
 * Continue with Discord, above the email form on the login and sign-up pages
 * while the Supabase project has Discord on (app/lib/auth/providers.ts).
 * Supabase sends the browser to Discord and back through /auth/callback,
 * which signs the user in (a new account on the first visit) and lands on
 * `next`. No email is sent.
 */
export default function DiscordSignIn({ next }: { next: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    if (pending) return;
    setError(null);
    setPending(true);
    try {
      const supabase = createClient();
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "discord",
        options: { redirectTo: providerCallbackUrl(window.location.origin, next) },
      });
      // On success the browser is on its way to Discord: the button stays pending.
      if (oauthError) {
        setError(friendlyError(oauthError));
        setPending(false);
      }
    } catch (caught) {
      setError(friendlyError(caught));
      setPending(false);
    }
  }

  return (
    <div className="mt-6 flex flex-col gap-4">
      <Button
        type="button"
        variant="secondary"
        size="lg"
        pending={pending}
        pendingText="Opening Discord..."
        onClick={start}
        className="w-full"
      >
        Continue with Discord
      </Button>
      {error && <Alert variant="error">{error}</Alert>}
      <p className="flex items-center gap-3 text-xs text-muted">
        <span aria-hidden="true" className="h-px flex-1 bg-hairline" />
        or use your email
        <span aria-hidden="true" className="h-px flex-1 bg-hairline" />
      </p>
    </div>
  );
}

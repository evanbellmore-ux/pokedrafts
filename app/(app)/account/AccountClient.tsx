"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import Alert from "@/app/components/ui/Alert";
import Button, { ButtonLink } from "@/app/components/ui/Button";
import PageHeader from "@/app/components/ui/PageHeader";
import Skeleton from "@/app/components/ui/Skeleton";
import { getCurrentUser } from "@/app/lib/auth/current-user";
import { rpc } from "@/app/lib/rpc";
import { createClient } from "@/app/lib/supabase/client";
import { linkClassName } from "@/app/lib/theme";
import type { AccountDeletionPreview } from "@/app/types/account";
import type { SessionUser } from "@/app/types/league";
import DeleteAccount from "./DeleteAccount";

type LoadState =
  | { status: "loading" }
  /** `user` is known when only the deletion preview failed. */
  | { status: "error"; message: string; user: SessionUser | null }
  | { status: "signed-out" }
  | { status: "ready"; user: SessionUser; preview: AccountDeletionPreview };

/**
 * The Account page: who is signed in, the privacy and terms links, and
 * Delete account (docs/release-architecture.md section 17). The preview of
 * the deletion loads with the page so a league that blocks it shows at once.
 */
export default function AccountClient() {
  const supabase = useMemo(() => createClient(), []);
  const [state, setState] = useState<LoadState>({ status: "loading" });

  const load = useCallback(async (): Promise<LoadState> => {
    const current = await getCurrentUser(supabase.auth);
    if (current.status === "error") return { status: "error", message: current.message, user: null };
    if (current.status === "signed-out") return { status: "signed-out" };

    const { data, error } = await rpc.accountDeletionPreview();
    if (error !== null) return { status: "error", message: error, user: current.user };
    return { status: "ready", user: current.user, preview: data };
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

  async function retry() {
    setState({ status: "loading" });
    setState(await load());
  }

  const user = state.status === "ready" || state.status === "error" ? state.user : null;

  /** Re-reads the preview (before the confirm step opens); resolves to it, or null after showing the error. */
  async function refreshPreview(): Promise<AccountDeletionPreview | null> {
    const next = await load();
    setState(next);
    return next.status === "ready" ? next.preview : null;
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeader title="Account" />

      {state.status === "error" && (
        <Alert
          variant="error"
          title="Could not load your account"
          action={
            <Button variant="secondary" size="sm" onClick={retry}>
              Retry
            </Button>
          }
        >
          {state.message}
        </Alert>
      )}

      {state.status === "signed-out" && (
        <Alert
          variant="warning"
          title="You are not logged in"
          action={
            <ButtonLink size="sm" variant="secondary" href="/login?next=/account">
              Log in
            </ButtonLink>
          }
        >
          Log in to manage your account.
        </Alert>
      )}

      <section
        aria-labelledby="signed-in-heading"
        className="rounded-xl border border-hairline bg-panel/60 p-5"
      >
        <h2 id="signed-in-heading" className="text-base font-semibold text-text">
          Signed in as
        </h2>
        {state.status === "loading" ? (
          <Skeleton className="mt-2 h-5 w-56" />
        ) : (
          <p className="mt-1 wrap-anywhere text-sm text-muted">
            {user ? (user.email ?? "No email address") : "Not available"}
          </p>
        )}
        <p className="mt-4 border-t border-hairline pt-4 text-sm text-muted">
          How PokeDrafts handles your data:{" "}
          <Link href="/privacy" className={`${linkClassName} font-medium text-accent-text hover:underline`}>
            Privacy Policy
          </Link>{" "}
          and{" "}
          <Link href="/terms" className={`${linkClassName} font-medium text-accent-text hover:underline`}>
            Terms of Service
          </Link>
          .
        </p>
      </section>

      <DeleteAccount
        preview={state.status === "ready" ? state.preview : null}
        email={user?.email ?? null}
        onRefresh={refreshPreview}
      />
    </div>
  );
}

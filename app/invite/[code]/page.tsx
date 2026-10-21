import type { Metadata } from "next";
import PublicShell from "@/app/components/PublicShell";
import { createServerSupabase } from "@/app/lib/supabase/server";
import type { InvitePreview } from "@/app/types/league";
import InviteClient from "./InviteClient";
import { inviteMetadata } from "./invite-metadata";

type Props = { params: Promise<{ code: string }> };

/** A link preview falls back to the generic text after this long. */
const PREVIEW_TIMEOUT_MS = 3000;

async function readInvitePreview(code: string): Promise<InvitePreview | null> {
  try {
    const supabase = await createServerSupabase();
    const { data, error } = await supabase
      .rpc("get_invite_preview", { p_code: code })
      .abortSignal(AbortSignal.timeout(PREVIEW_TIMEOUT_MS));
    return error ? null : ((data as InvitePreview | null) ?? null);
  } catch {
    return null;
  }
}

/**
 * Coaches paste invite links into Discord, so the preview names the league
 * (app/invite/[code]/invite-metadata.ts). Invite links stay out of search
 * results.
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code } = await params;
  const { title, description } = inviteMetadata(await readInvitePreview(code));

  return {
    title,
    description,
    robots: { index: false, follow: false },
  };
}

/**
 * Viewable while logged out (the preview comes from the anon-callable
 * `get_invite_preview` function). Joining requires an account and carries
 * ?next=/invite/CODE through login and signup. Same shell as the auth pages.
 */
export default async function InvitePage({ params }: Props) {
  const { code } = await params;

  return (
    <PublicShell>
      <InviteClient code={code} />
    </PublicShell>
  );
}

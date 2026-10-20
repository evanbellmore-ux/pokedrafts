import type { Metadata } from "next";
import PublicShell from "@/app/components/PublicShell";
import InviteClient from "./InviteClient";

export const metadata: Metadata = {
  title: "League invite",
  description: "You have been invited to coach in a PokeDrafts league.",
};

/**
 * Viewable while logged out (the preview comes from the anon-callable
 * `get_invite_preview` function). Joining requires an account and carries
 * ?next=/invite/CODE through login and signup. Same shell as the auth pages.
 */
export default async function InvitePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;

  return (
    <PublicShell>
      <InviteClient code={code} />
    </PublicShell>
  );
}

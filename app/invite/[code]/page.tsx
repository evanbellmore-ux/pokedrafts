import type { Metadata } from "next";
import Link from "next/link";
import InviteClient from "./InviteClient";

export const metadata: Metadata = {
  title: "League invite",
  description: "You have been invited to coach in a PokeDrafts league.",
};

/**
 * Viewable while logged out (the preview comes from the anon-callable
 * `get_invite_preview` function). Joining requires an account and carries
 * ?next=/invite/CODE through login and signup.
 */
export default async function InvitePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 py-10 sm:py-16">
      <div className="w-full max-w-md">
        <Link
          href="/"
          className="inline-block text-sm font-bold uppercase tracking-wide text-accent-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          PokeDrafts
        </Link>
        <div className="mt-4 rounded-xl border border-line bg-panel p-6 shadow-xl sm:p-8">
          <InviteClient code={code} />
        </div>
      </div>
    </main>
  );
}

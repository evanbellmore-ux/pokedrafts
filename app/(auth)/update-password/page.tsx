import type { Metadata } from "next";
import { DEFAULT_NEXT_PATH, sanitizeNextPath } from "@/app/lib/auth/next-path";
import { firstParam, type SearchParams } from "@/app/lib/search-params";
import UpdatePasswordForm from "./UpdatePasswordForm";

export const metadata: Metadata = {
  title: "Choose a new password",
};

/**
 * Where to go once the password is saved. `sanitizeNextPath` already
 * rejects the other auth pages; this page also refuses itself so a stray
 * `?next=/update-password` never re-opens the form after success.
 */
function afterPasswordPath(value: string | undefined) {
  const next = sanitizeNextPath(value);
  return next.split(/[?#]/)[0] === "/update-password" ? DEFAULT_NEXT_PATH : next;
}

export default async function UpdatePasswordPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  // Written by the forgot-password page into the recovery link and carried
  // through /auth/callback as `/update-password?next=<path>`.
  const next = afterPasswordPath(firstParam(params.next));

  return <UpdatePasswordForm next={next} />;
}

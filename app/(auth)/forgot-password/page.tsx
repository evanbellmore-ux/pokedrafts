import type { Metadata } from "next";
import { sanitizeNextPath } from "@/app/lib/auth/next-path";
import { firstParam, type SearchParams } from "@/app/lib/search-params";
import ForgotPasswordForm from "./ForgotPasswordForm";

export const metadata: Metadata = {
  title: "Reset your password",
};

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  // Arrives from the login page's "Forgot your password?" link and rides
  // the recovery email through to /update-password.
  const next = sanitizeNextPath(firstParam(params.next));

  return <ForgotPasswordForm next={next} />;
}

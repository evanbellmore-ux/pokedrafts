import type { Metadata } from "next";
import { parseCallbackFailure } from "@/app/lib/auth/callback";
import { sanitizeNextPath } from "@/app/lib/auth/next-path";
import { firstParam, type SearchParams } from "@/app/lib/search-params";
import LoginForm from "./LoginForm";

export const metadata: Metadata = {
  title: "Log in",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const next = sanitizeNextPath(firstParam(params.next));
  // Written by app/auth/callback/route.ts; `next` survives the failure.
  const linkError = parseCallbackFailure(firstParam(params.error));

  return <LoginForm next={next} linkError={linkError} />;
}

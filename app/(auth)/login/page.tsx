import type { Metadata } from "next";
import { parseCallbackFailure } from "@/app/lib/auth/callback";
import { sanitizeNextPath } from "@/app/lib/auth/next-path";
import { signInProviders } from "@/app/lib/auth/providers";
import { firstParam, type SearchParams } from "@/app/lib/search-params";
import LoginForm from "./LoginForm";

export const metadata: Metadata = {
  title: "Log in",
  description: "Log in to PokeDrafts to run your Pokémon draft leagues.",
  alternates: { canonical: "/login" },
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
  // Written by the Account page right after delete_account succeeded.
  const accountDeleted = firstParam(params.account) === "deleted";
  const { discord } = await signInProviders();

  return (
    <LoginForm
      next={next}
      linkError={linkError}
      discord={discord}
      accountDeleted={accountDeleted}
    />
  );
}

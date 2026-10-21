import type { Metadata } from "next";
import { sanitizeNextPath } from "@/app/lib/auth/next-path";
import { signInProviders } from "@/app/lib/auth/providers";
import { firstParam, type SearchParams } from "@/app/lib/search-params";
import SignupForm from "./SignupForm";

export const metadata: Metadata = {
  title: "Sign up",
  description:
    "Create a PokeDrafts account to start a Pokémon draft league or join one from an invite link.",
  alternates: { canonical: "/signup" },
};

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const next = sanitizeNextPath(firstParam(params.next));
  const { discord } = await signInProviders();

  return <SignupForm next={next} discord={discord} />;
}

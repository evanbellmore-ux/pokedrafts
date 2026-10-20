import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import {
  classifyCallbackError,
  PROVIDER_PARAM,
  type CallbackFailure,
} from "@/app/lib/auth/callback";
import {
  DEFAULT_NEXT_PATH,
  resolveCallbackNext,
} from "@/app/lib/auth/next-path";
import { createServerSupabase } from "@/app/lib/supabase/server";

const OTP_TYPES = new Set<string>([
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
]);

/**
 * Lands every Supabase email link (confirmation, recovery, magic link) and
 * the return from a Discord sign-in (`?code&provider=discord`).
 * PKCE links carry `?code`; token-hash links carry `?token_hash&type`.
 * On success the session cookies are written and we redirect to the
 * validated `next` path. On failure we send the user to `/login?error=...`
 * (see app/lib/auth/callback.ts for the reasons) and keep `next`, so an
 * invited coach who logs in afterwards still lands on their invite and a
 * recovery link still leads to /update-password.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const next = resolveCallbackNext(searchParams.get("next"));
  const viaProvider = searchParams.get(PROVIDER_PARAM) === "discord";

  // Behind a load balancer the public host differs from the origin Next sees.
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto") ?? "https";
  const base =
    process.env.NODE_ENV !== "development" && forwardedHost
      ? `${forwardedProto}://${forwardedHost}`
      : origin;

  function failure(reason: CallbackFailure) {
    const url = new URL("/login", base);
    url.searchParams.set("error", reason);
    // `next` is already sanitized and never points back at an auth page, so
    // the login page cannot loop through here.
    if (next !== DEFAULT_NEXT_PATH) url.searchParams.set("next", next);
    return NextResponse.redirect(url);
  }

  if (searchParams.get("error")) {
    return failure(viaProvider ? "auth-provider" : "auth");
  }

  const supabase = await createServerSupabase();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return failure(viaProvider ? "auth-provider" : classifyCallbackError(error));
    return NextResponse.redirect(new URL(next, base));
  }

  if (tokenHash && type && OTP_TYPES.has(type)) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as EmailOtpType,
    });
    if (error) return failure("auth");
    return NextResponse.redirect(new URL(next, base));
  }

  return failure("auth");
}

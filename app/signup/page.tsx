"use client";

import { useState } from "react";
import { createClient } from "@/app/lib/supabase/client";

export default function SignupPage() {
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");

  async function signUp() {
    setMessage("");

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/dashboard`,
      },
    });

    if (error) setMessage(error.message);
    else setMessage("Check your email to confirm your account.");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-stone-950 p-6 text-stone-100">
      <div className="w-full max-w-md rounded-lg border border-amber-900/40 bg-stone-900 p-6">
        <p className="text-sm font-medium uppercase tracking-wide text-amber-300">
          PokeDrafts
        </p>
        <h1 className="mt-2 text-3xl font-bold">Create account</h1>

        <input
          className="mt-6 w-full rounded-lg border border-stone-700 bg-stone-950 p-3"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <input
          className="mt-3 w-full rounded-lg border border-stone-700 bg-stone-950 p-3"
          placeholder="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <button
          onClick={signUp}
          className="mt-5 w-full rounded-lg bg-emerald-500 px-4 py-3 font-semibold text-stone-950 hover:bg-emerald-400"
        >
          Sign up
        </button>

        {message && <p className="mt-4 text-sm text-stone-300">{message}</p>}
      </div>
    </main>
  );
}

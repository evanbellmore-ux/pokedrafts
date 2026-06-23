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
    <main className="min-h-screen bg-zinc-950 text-zinc-100 p-6 flex items-center justify-center">
      <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
        <h1 className="text-3xl font-bold">Create account</h1>

        <input
          className="mt-6 w-full rounded-xl bg-zinc-950 border border-zinc-700 p-3"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <input
          className="mt-3 w-full rounded-xl bg-zinc-950 border border-zinc-700 p-3"
          placeholder="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <button
          onClick={signUp}
          className="mt-5 w-full rounded-xl bg-emerald-500 px-4 py-3 font-semibold text-zinc-950"
        >
          Sign up
        </button>

        {message && <p className="mt-4 text-sm text-zinc-300">{message}</p>}
      </div>
    </main>
  );
}
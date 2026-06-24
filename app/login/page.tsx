"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/app/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");

  async function login() {
    setMessage("");

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) setMessage(error.message);
    else router.push("/dashboard");
  }

async function signUp() {
  setMessage("");

  const { error } = await supabase.auth.signUp({
    email,
    password,
  });

  if (error) {
    setMessage(error.message);
    return;
  }

  setMessage(
    "Account created. Check your email for the confirmation link."
  );
}

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 p-6 flex items-center justify-center">
      <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
        <h1 className="text-3xl font-bold">Log in</h1>

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
          onClick={login}
          className="mt-5 w-full rounded-xl bg-emerald-500 px-4 py-3 font-semibold text-zinc-950"
        >
          Log in
        </button>

        <button
          onClick={signUp}
          className="mt-3 w-full rounded-xl bg-zinc-800 px-4 py-3 font-semibold text-zinc-300"
        >
          Sign up
        </button>

        {message && <p className="mt-4 text-sm text-red-300">{message}</p>}
      </div>
    </main>
  );
}
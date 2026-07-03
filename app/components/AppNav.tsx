"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import ThemeToggle from "@/app/components/ThemeToggle";
import { createClient } from "@/app/lib/supabase/client";

function navLinkClass(active: boolean) {
  return `inline-flex items-center justify-center rounded-lg px-4 py-2.5 text-sm font-semibold ${
    active
      ? "bg-emerald-500 text-stone-950"
      : "border border-amber-800/50 bg-stone-900 text-stone-200 hover:border-amber-600/70 hover:bg-stone-800"
  }`;
}

export default function AppNav() {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();

  async function logout() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <header className="mb-6 flex flex-col gap-5 border-b border-amber-900/40 pb-6 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-sm font-medium uppercase tracking-wide text-amber-300">
          PokeDrafts
        </p>
      </div>

      <nav className="flex flex-wrap gap-3">
        <Link href="/dashboard" className={navLinkClass(pathname === "/dashboard")}>
          Home
        </Link>
        <Link href="/builder" className={navLinkClass(pathname === "/builder")}>
          Pool Builder
        </Link>
        <ThemeToggle />
        <button
          onClick={logout}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-stone-700 px-4 py-2.5 text-sm font-semibold text-stone-300 hover:border-stone-500 hover:text-white"
        >
          <LogOut className="h-4 w-4" />
          Log out
        </button>
      </nav>
    </header>
  );
}

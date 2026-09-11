import Link from "next/link";
import { linkClassName } from "@/app/lib/theme";

/** Centered card shell for login, signup and password pages. No AppNav. */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 py-10 sm:py-16">
      <div className="w-full max-w-md">
        <Link
          href="/"
          className={`${linkClassName} inline-block text-sm font-bold uppercase tracking-wide text-accent-text`}
        >
          PokeDrafts
        </Link>
        <div className="mt-4 rounded-xl border border-line bg-panel p-6 shadow-xl sm:p-8">
          {children}
        </div>
      </div>
    </main>
  );
}

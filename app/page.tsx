import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen bg-stone-950 px-4 py-8 text-stone-100 sm:px-8">
      <section className="mx-auto max-w-5xl border-b border-amber-900/40 py-24">
        <p className="text-sm font-medium uppercase tracking-wide text-amber-300">
          Fantasy draft control room
        </p>
        <h1 className="mt-3 text-5xl font-bold tracking-tight">PokeDrafts</h1>
        <p className="mt-4 max-w-2xl text-xl text-stone-300">
          Build, edit, and export custom Pokemon draft pools.
        </p>

        <Link
          href="/builder"
          className="mt-8 inline-flex rounded-lg bg-emerald-500 px-6 py-3 font-semibold text-stone-950 hover:bg-emerald-400"
        >
          Open Builder
        </Link>
      </section>
    </main>
  );
}

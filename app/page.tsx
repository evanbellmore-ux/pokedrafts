import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 p-8">
      <section className="mx-auto max-w-4xl py-24">
        <h1 className="text-5xl font-bold tracking-tight">PokeDrafts</h1>
        <p className="mt-4 text-xl text-zinc-300">
          Build, edit, and export custom Pokémon draft pools.
        </p>

        <Link
          href="/builder"
          className="mt-8 inline-block rounded-xl bg-emerald-500 px-6 py-3 font-semibold text-zinc-950 hover:bg-emerald-400"
        >
          Open Builder
        </Link>
      </section>
    </main>
  );
}
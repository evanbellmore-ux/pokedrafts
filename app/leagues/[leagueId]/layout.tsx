import AppNav from "@/app/components/AppNav";
import LeagueNav from "@/app/components/LeagueNav";

export default async function LeagueLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ leagueId: string }>;
}) {
  const { leagueId } = await params;

  return (
    <main className="min-h-screen bg-stone-950 px-4 py-6 text-stone-100 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <AppNav />
        <LeagueNav leagueId={leagueId} />
        {children}
      </div>
    </main>
  );
}

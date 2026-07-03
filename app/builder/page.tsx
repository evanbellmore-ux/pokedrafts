import AppNav from "@/app/components/AppNav";
import DraftBuilder from "@/app/components/DraftBuilder";

export default function BuilderPage() {
  return (
    <main className="min-h-screen bg-stone-950 px-4 py-6 text-stone-100 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <AppNav />
        <DraftBuilder />
      </div>
    </main>
  );
}

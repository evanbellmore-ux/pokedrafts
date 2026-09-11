import AppNav from "@/app/components/AppNav";

/** Signed-in shell: AppNav plus a max-w-6xl content column. */
export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <AppNav />
      <main
        id="main-content"
        className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 lg:px-8"
      >
        {children}
      </main>
    </>
  );
}

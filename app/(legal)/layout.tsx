import PublicFooter from "@/app/components/PublicFooter";
import PublicHeader from "@/app/components/PublicHeader";

/**
 * The privacy policy and the terms: the landing page's header and footer
 * around one readable column. Both pages are public (proxy.ts) for signed-in
 * and signed-out visitors alike.
 */
export default function LegalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <PublicHeader />
      <main id="main-content" className="flex flex-1 flex-col">
        {children}
      </main>
      <PublicFooter />
    </>
  );
}

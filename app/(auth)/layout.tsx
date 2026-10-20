import PublicShell from "@/app/components/PublicShell";

/** Login, signup and the password pages: the brand above one card. No AppNav. */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <PublicShell>{children}</PublicShell>;
}

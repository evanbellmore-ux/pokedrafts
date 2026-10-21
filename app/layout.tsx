import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import { ThemeProvider } from "@/app/components/ThemeProvider";
import { SITE_NAME, SITE_URL } from "@/app/lib/site";
import { THEME_COOKIE, parseTheme, themeBackgrounds } from "@/app/lib/theme";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * Link previews: og:title and og:description follow each page's own title and
 * description, and app/opengraph-image.tsx is the share image (Next fills the
 * Twitter card from the Open Graph tags). A page that sets its own `openGraph`
 * replaces this object, image included, so pages set `title`, `description`
 * and `alternates.canonical` only.
 */
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_NAME,
    template: `%s | ${SITE_NAME}`,
  },
  description:
    "Fantasy-style Pokémon draft leagues: create a league, invite coaches, run a live snake draft with a pick timer, then play a season with standings and free agents.",
  applicationName: SITE_NAME,
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
  },
};

/**
 * The theme cookie also picks `themeColor`, so the mobile browser chrome
 * matches the palette's page background (`themeBackgrounds` mirrors
 * `--type-bg`). The layout already reads the cookie for
 * `<html data-pokemon-theme>`, so this adds no new dynamic dependency.
 */
export async function generateViewport(): Promise<Viewport> {
  const cookieStore = await cookies();
  const theme = parseTheme(cookieStore.get(THEME_COOKIE)?.value);

  return {
    width: "device-width",
    initialScale: 1,
    colorScheme: "dark",
    themeColor: themeBackgrounds[theme],
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const theme = parseTheme(cookieStore.get(THEME_COOKIE)?.value);

  return (
    <html
      lang="en"
      data-pokemon-theme={theme}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-bg font-sans text-text">
        <ThemeProvider initialTheme={theme}>{children}</ThemeProvider>
      </body>
    </html>
  );
}

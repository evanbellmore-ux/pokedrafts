import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import { ThemeProvider } from "@/app/components/ThemeProvider";
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

export const metadata: Metadata = {
  title: {
    default: "PokeDrafts",
    template: "%s | PokeDrafts",
  },
  description:
    "Fantasy-style Pokémon draft leagues: create a league, invite coaches, run a live snake draft with a pick timer, then play a season with standings and free agents.",
  applicationName: "PokeDrafts",
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

/**
 * Where PokeDrafts lives and which of its pages are public. The app is served
 * on www (the apex domain redirects there, and pokedrafts.vercel.app serves
 * the same pages), so canonical URLs, the sitemap and the share image all
 * name www.
 */
export const SITE_URL = "https://www.pokedrafts.io";

export const SITE_NAME = "PokeDrafts";

/** The pages search engines may index: app/sitemap.ts lists exactly these. */
export const INDEXED_PATHS = ["/", "/login", "/signup"] as const;

/**
 * The signed-in areas, one per top-level folder of app/(app). proxy.ts sends
 * a signed-out visitor anywhere inside one to /login (even where no page
 * matches), and app/robots.ts keeps crawlers out of them.
 * tests/unit/site-routes.test.ts checks this list against app/(app).
 */
export const SIGNED_IN_SECTIONS = [
  "/builder",
  "/calculator",
  "/dashboard",
  "/leagues",
  "/training",
] as const;

/** `pathname` is `section` itself or a path inside it. */
export function isInSection(pathname: string, section: string) {
  return pathname === section || pathname.startsWith(`${section}/`);
}

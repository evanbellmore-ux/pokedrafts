import type { MetadataRoute } from "next";
import { SIGNED_IN_SECTIONS, SITE_URL } from "@/app/lib/site";

/**
 * Crawlers may read the public pages (invite links included, so chat apps can
 * build their previews; the invite page itself asks not to be indexed) and
 * stay out of the signed-in sections and the sign-in callback.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [...SIGNED_IN_SECTIONS, "/auth/"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}

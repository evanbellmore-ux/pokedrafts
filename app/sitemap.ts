import type { MetadataRoute } from "next";
import { INDEXED_PATHS, SITE_URL } from "@/app/lib/site";

/** The public pages, on www. Nothing behind sign-in is listed. */
export default function sitemap(): MetadataRoute.Sitemap {
  return INDEXED_PATHS.map((path) => ({
    url: path === "/" ? SITE_URL : `${SITE_URL}${path}`,
  }));
}

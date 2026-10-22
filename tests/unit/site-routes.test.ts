import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import OpenGraphImage, { alt, contentType, size } from "@/app/opengraph-image";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { INDEXED_PATHS, SIGNED_IN_SECTIONS, SITE_URL, isInSection } from "@/app/lib/site";

/**
 * What the public site tells crawlers and chat apps (app/lib/site.ts):
 * robots.txt, sitemap.xml, canonical URLs and the share image, and the list
 * of signed-in sections the proxy gates, checked against the app tree.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const appDir = join(root, "app");

function read(file: string) {
  return readFileSync(join(root, file), "utf8");
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/** Route groups `(name)` are dropped, so `app/(auth)/login/page.tsx` -> `/login`. */
function toUrl(file: string) {
  const segments = relative(appDir, dirname(file))
    .split(sep)
    .filter((segment) => segment && !/^\(.*\)$/.test(segment));
  return `/${segments.join("/")}`;
}

const pages = walk(appDir).filter((file) => /[\\/]page\.tsx$/.test(file));

/** The URL segments directly under app/(app), looking through nested route groups. */
function signedInSections(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
    .flatMap((entry) =>
      /^\(.*\)$/.test(entry.name)
        ? signedInSections(join(dir, entry.name))
        : [`/${entry.name}`]
    );
}

describe("signed-in sections", () => {
  it("are exactly the top-level folders of app/(app), so the proxy gates every signed-in page", () => {
    expect([...SIGNED_IN_SECTIONS].sort()).toEqual(signedInSections(join(appDir, "(app)")).sort());
  });

  it("cover every page under app/(app) and no page outside it", () => {
    for (const file of pages) {
      const url = toUrl(file);
      const gated = SIGNED_IN_SECTIONS.some((section) => isInSection(url, section));
      const signedInPage = relative(appDir, file).split(sep)[0] === "(app)";
      expect(gated, url).toBe(signedInPage);
    }
  });

  it("match whole path segments", () => {
    expect(isInSection("/leagues", "/leagues")).toBe(true);
    expect(isInSection("/leagues/new", "/leagues")).toBe(true);
    expect(isInSection("/leaguesX", "/leagues")).toBe(false);
    expect(isInSection("/", "/leagues")).toBe(false);
  });
});

describe("robots.txt", () => {
  it("lets crawlers read the public site and keeps them out of the signed-in sections", () => {
    const { rules, sitemap: sitemapUrl } = robots();
    expect(rules).toEqual({
      userAgent: "*",
      allow: "/",
      disallow: [...SIGNED_IN_SECTIONS, "/auth/"],
    });
    expect(sitemapUrl).toBe("https://www.pokedrafts.io/sitemap.xml");
  });
});

describe("sitemap.xml", () => {
  it("lists the indexed public pages on www and nothing else", () => {
    expect(sitemap().map((entry) => entry.url)).toEqual([
      "https://www.pokedrafts.io",
      "https://www.pokedrafts.io/login",
      "https://www.pokedrafts.io/signup",
      "https://www.pokedrafts.io/watch",
    ]);
    expect(INDEXED_PATHS.every((path) => !SIGNED_IN_SECTIONS.some((s) => isInSection(path, s)))).toBe(true);
  });

  it.each(INDEXED_PATHS.map((path) => [path]))(
    "%s is a page with its canonical URL",
    (path) => {
      const file = pages.find((page) => toUrl(page) === path);
      expect(file, `no page for ${path}`).toBeDefined();
      expect(read(relative(root, file!))).toContain(`alternates: { canonical: "${path}" }`);
    }
  );
});

describe("link previews", () => {
  it("the root layout resolves URLs against www and asks for the large card", () => {
    const layout = read("app/layout.tsx");
    expect(SITE_URL).toBe("https://www.pokedrafts.io");
    expect(layout).toContain("metadataBase: new URL(SITE_URL)");
    expect(layout).toMatch(/openGraph: \{\s*type: "website",\s*siteName: SITE_NAME,/);
    expect(layout).toMatch(/twitter: \{\s*card: "summary_large_image",\s*\}/);
  });

  it("no page replaces the root openGraph object, which would drop the share image", () => {
    // Next merges metadata shallowly: a page's `openGraph` replaces the
    // root's, and the opengraph-image file only fills the root's.
    for (const file of pages) {
      expect(read(relative(root, file)), relative(root, file)).not.toMatch(/\bopenGraph:/);
    }
  });

  it("the share image is a 1200x630 PNG", async () => {
    expect(size).toEqual({ width: 1200, height: 630 });
    expect(contentType).toBe("image/png");
    expect(alt).toMatch(/^PokeDrafts/);

    const response = OpenGraphImage();
    const png = Buffer.from(await response.arrayBuffer());
    expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
    // The IHDR chunk holds the width and height.
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBe(630);
  });
});

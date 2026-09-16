import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Static checks for the Next.js 16 conventions in docs/release-architecture.md
 * (sections 1, 3, 3.1 and 8.2). They read the app tree from disk so a
 * regression fails `npm run test` instead of surfacing in production.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const appDir = join(root, "app");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const appFiles = walk(appDir).filter((file) => /\.(ts|tsx)$/.test(file));

function read(file: string) {
  return readFileSync(file, "utf8");
}

function isClientModule(source: string) {
  return /^\s*["']use client["'];?/m.test(source.slice(0, 200));
}

/** Route groups `(name)` are dropped, so `app/(app)/dashboard/page.tsx` -> `/dashboard`. */
function toUrl(file: string) {
  const rel = relative(appDir, dirname(file)).split(sep);
  const segments = rel.filter((segment) => segment && !/^\(.*\)$/.test(segment));
  return `/${segments.join("/")}`;
}

describe("route map (docs section 3)", () => {
  it("keeps every URL the architecture lists, with route groups invisible", () => {
    const pages = appFiles.filter((file) => /[\\/]page\.tsx$/.test(file));
    // app/api/castmirror belongs to another project that shares this repo.
    const routes = appFiles.filter(
      (file) => /[\\/]route\.ts$/.test(file) && !/[\\/]api[\\/]castmirror[\\/]/.test(file)
    );
    const urls = [...pages, ...routes].map(toUrl).sort();

    expect(urls).toEqual(
      [
        "/",
        "/auth/callback",
        "/builder",
        "/calculator",
        "/dashboard",
        "/forgot-password",
        "/invite/[code]",
        "/leagues/[leagueId]",
        "/leagues/[leagueId]/draft",
        "/leagues/[leagueId]/free-agents",
        "/leagues/[leagueId]/matches",
        "/leagues/[leagueId]/pool",
        "/leagues/[leagueId]/settings",
        "/leagues/[leagueId]/standings",
        "/leagues/[leagueId]/team",
        "/leagues/new",
        "/login",
        "/signup",
        "/update-password",
      ].sort()
    );
  });

  it("does not resolve two page files to the same URL", () => {
    const pages = appFiles.filter((file) => /[\\/]page\.tsx$/.test(file));
    const urls = pages.map(toUrl);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("has the special files the architecture prescribes", () => {
    for (const file of [
      "layout.tsx",
      "not-found.tsx",
      "error.tsx",
      "global-error.tsx",
      "(auth)/layout.tsx",
      "(app)/layout.tsx",
      "(app)/loading.tsx",
      "(app)/leagues/[leagueId]/layout.tsx",
      "(app)/leagues/[leagueId]/loading.tsx",
      // Catches notFound() thrown by the league layout: a segment's own
      // not-found.tsx renders inside its layout (node_modules/next/dist/docs
      // .../file-conventions/not-found.md), so the parent segment needs one.
      "(app)/leagues/not-found.tsx",
      "(app)/leagues/[leagueId]/not-found.tsx",
    ]) {
      expect(appFiles, file).toContain(join(appDir, file));
    }
  });
});

describe("page.tsx files are server components with metadata", () => {
  const pages = appFiles.filter((file) => /[\\/]page\.tsx$/.test(file));

  it.each(pages.map((file) => [relative(root, file), file]))(
    "%s",
    (_label, file) => {
      const source = read(file);
      expect(isClientModule(source), "must not be a client component").toBe(false);

      const hasMetadata =
        /export const metadata\b/.test(source) ||
        /export (async )?function generateMetadata\b/.test(source);
      const leagueLayoutProvidesTitle = file.includes(
        join("[leagueId]", "page.tsx")
      );
      expect(hasMetadata || leagueLayoutProvidesTitle).toBe(true);

      // `params` / `searchParams` are Promises in this Next version.
      const propTypes = source.match(/(params|searchParams):\s*([^;,\n]+)/g) ?? [];
      for (const decl of propTypes) {
        expect(decl).toMatch(/Promise</);
      }
    }
  );
});

describe("client boundaries", () => {
  it("never exports metadata from a client module", () => {
    for (const file of appFiles) {
      const source = read(file);
      if (!isClientModule(source)) continue;
      expect(source, relative(root, file)).not.toMatch(
        /export (const metadata|(async )?function generateMetadata)\b/
      );
    }
  });

  it("error.tsx is a client component using unstable_retry", () => {
    const source = read(join(appDir, "error.tsx"));
    expect(isClientModule(source)).toBe(true);
    expect(source).toMatch(/unstable_retry\(\)/);
  });

  it("global-error.tsx is a client component that renders <html> and <body>", () => {
    const source = read(join(appDir, "global-error.tsx"));
    expect(isClientModule(source)).toBe(true);
    expect(source).toMatch(/<html[\s>]/);
    expect(source).toMatch(/<body[\s>]/);
    expect(source).toMatch(/unstable_retry\(\)/);
  });

  it("uses next/link, not <a>, for internal navigation outside global-error", () => {
    for (const file of appFiles) {
      if (file.endsWith("global-error.tsx")) continue;
      const source = read(file);
      const anchors = source.match(/<a\s[^>]*href=["'][^"']*["']/g) ?? [];
      for (const anchor of anchors) {
        // Same-page fragments (skip links) and external URLs are fine.
        expect(anchor, relative(root, file)).toMatch(/href=["'](#|https?:|mailto:)/);
      }
    }
  });
});

describe("hooks lint rules are not silenced (docs section 8.2)", () => {
  it("has no eslint-disable for react-hooks rules under app/", () => {
    const offenders = appFiles.flatMap((file) =>
      read(file)
        .split("\n")
        .map((line, index) => ({ line, index }))
        .filter(({ line }) => /eslint-disable.*react-hooks\//.test(line))
        .map(({ index }) => `${relative(root, file)}:${index + 1}`)
    );

    expect(offenders).toEqual([]);
  });
});

describe("proxy.ts (docs section 3.1)", () => {
  const source = read(join(root, "proxy.ts"));

  it("exports `proxy` (not `middleware`) and the documented matcher", () => {
    expect(source).toMatch(/export (async )?function proxy\(/);
    expect(source).not.toMatch(/export (async )?function middleware\(/);
    expect(source).toContain(
      '"/((?!_next/static|_next/image|favicon.ico|.*\\\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml)$).*)"'
    );
  });

  it("uses the getAll/setAll cookie adapter and copies headers onto redirects", () => {
    expect(source).toMatch(/getAll\(\)/);
    expect(source).toMatch(/setAll\(cookiesToSet, headers\)/);
    expect(source).toMatch(/response\.cookies\.set\(cookie\)/);
  });
});

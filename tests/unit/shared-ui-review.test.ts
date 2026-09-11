import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_NEXT_PATH,
  resolveCallbackNext,
  sanitizeNextPath,
  withNextParam,
} from "@/app/lib/auth/next-path";
import { linkClassName, pokemonThemes, themeBackgrounds } from "@/app/lib/theme";

/**
 * Review findings for the shared UI (docs/release-architecture.md 8.3 to
 * 8.6): long names wrap inside a 375px viewport, the league-root live pill
 * announces its subject, inline text links draw the theme focus ring, the
 * landing page exposes banner/contentinfo landmarks, the recovery flow keeps
 * `next`, and the browser chrome follows the theme cookie. Like the other
 * ui-* suites these read the sources from disk.
 */

const root = resolve(__dirname, "../..");

function read(file: string) {
  return readFileSync(resolve(root, file), "utf8");
}

/** Attribute text of every `<Link ...>` (not `<ButtonLink>`) in a source. */
function linkTags(source: string) {
  return [...source.matchAll(/<Link\b([^>]*)>/g)].map((m) => m[1]);
}

const authLinkFiles = [
  "app/(auth)/layout.tsx",
  "app/(auth)/login/LoginForm.tsx",
  "app/(auth)/signup/SignupForm.tsx",
  "app/(auth)/forgot-password/ForgotPasswordForm.tsx",
  "app/(auth)/update-password/UpdatePasswordForm.tsx",
  "app/page.tsx",
];

describe("long words wrap inside a 375px viewport (docs 8.5)", () => {
  it("PageHeader wraps the h1 and the description anywhere", () => {
    const source = read("app/components/ui/PageHeader.tsx");
    expect(source).toMatch(/<h1 className="[^"]*\bwrap-anywhere\b/);
    expect(source).toMatch(/<p className="[^"]*\bwrap-anywhere\b[^"]*text-muted"/);
    expect(source).toMatch(/<div className="min-w-0">/);
  });

  it("Dialog wraps the title, the description and the error anywhere", () => {
    const source = read("app/components/ui/Dialog.tsx");
    expect(source).toMatch(/<h2 id=\{titleId\} className="[^"]*\bwrap-anywhere\b/);
    expect(source).toMatch(
      /<p id=\{descriptionId\} className="[^"]*\bwrap-anywhere\b/
    );
    expect(source).toMatch(/<p role="alert" className="[^"]*\bwrap-anywhere\b/);
  });

  it("Alert wraps its title and body (overflow-wrap inherits from the wrapper)", () => {
    const source = read("app/components/ui/Alert.tsx");
    expect(source).toMatch(/<div className="min-w-0 flex-1 wrap-anywhere">/);
  });
});

describe("live status pill (docs 8.4)", () => {
  const prefix = '<span className="sr-only">Live updates: </span>';

  it("announces a subject from inside the status region, not a bare state word", () => {
    const source = read("app/(app)/leagues/[leagueId]/LiveStatusPill.tsx");
    // A live region reads its changed content, so the subject must be
    // content (visually hidden), not an aria-label on the wrapper.
    expect(source).toContain('<span role="status">');
    expect(source).not.toMatch(/aria-label=/);
    const region = source.slice(source.indexOf('<span role="status">'));
    expect(region).toContain(prefix);
    expect(region.indexOf(prefix)).toBeLessThan(region.indexOf("{style.label}"));
  });

  it("uses the same prefix as the draft room's LivePill", () => {
    expect(read("app/(app)/leagues/[leagueId]/draft/DraftHeader.tsx")).toContain(
      prefix
    );
  });

  it("is the only LiveStatusPill: every league page imports the league-root copy", () => {
    // The matches page used to keep its own copy; the shared one is the file
    // the checks above cover.
    const shared = resolve(root, "app/(app)/leagues/[leagueId]/LiveStatusPill.tsx");
    expect(existsSync(shared)).toBe(true);
    expect(
      existsSync(resolve(root, "app/(app)/leagues/[leagueId]/matches/LiveStatusPill.tsx"))
    ).toBe(false);
  });
});

describe("inline text links (docs 8.4)", () => {
  it("linkClassName is the Button focus ring without a colour", () => {
    for (const token of [
      "rounded",
      "focus-visible:outline-none",
      "focus-visible:ring-2",
      "focus-visible:ring-focus",
      "focus-visible:ring-offset-2",
      "focus-visible:ring-offset-bg",
    ]) {
      expect(linkClassName.split(" "), token).toContain(token);
    }
    // Colour and weight are the caller's; the ring must be the theme token.
    expect(linkClassName).not.toMatch(/\btext-/);
    expect(linkClassName).not.toMatch(/ring-accent/);
    const button = read("app/components/ui/Button.tsx");
    for (const token of linkClassName.split(" ").filter((c) => c !== "rounded")) {
      expect(button, token).toContain(token);
    }
  });

  it.each(authLinkFiles)("%s draws the ring on every <Link>", (file) => {
    const source = read(file);
    const tags = linkTags(source);
    expect(tags.length, "expected at least one <Link>").toBeGreaterThan(0);
    for (const attrs of tags) {
      expect(attrs, `<Link${attrs}>`).toMatch(/className=\{`\$\{linkClassName\}/);
    }
    expect(source).toMatch(
      /import \{[^}]*\blinkClassName\b[^}]*\} from "@\/app\/lib\/theme"/
    );
  });
});

describe("landing page landmarks (docs 8.4)", () => {
  it("renders <header> and <footer> outside <main>", () => {
    // Element positions in JSX (comments may mention the tags in prose).
    const source = read("app/page.tsx");
    const header = source.indexOf("<header className=");
    const headerEnd = source.indexOf("</header>");
    const main = source.indexOf('<main id="main-content"');
    const mainEnd = source.lastIndexOf("</main>");
    const footer = source.indexOf("<footer className=");
    expect(header).toBeGreaterThan(-1);
    expect(headerEnd).toBeGreaterThan(header);
    expect(main).toBeGreaterThan(headerEnd);
    expect(mainEnd).toBeGreaterThan(main);
    expect(footer).toBeGreaterThan(mainEnd);
    // Exactly one of each, so the checks above describe the whole page.
    expect(source.match(/<main\b/g)).toHaveLength(1);
    expect(source.match(/<header\b/g)).toHaveLength(1);
    expect(source.match(/<footer\b/g)).toHaveLength(1);
  });
});

describe("password recovery keeps next (docs 8.3)", () => {
  it("both /forgot-password links on the login form carry next", () => {
    const source = read("app/(auth)/login/LoginForm.tsx");
    const carried =
      source.match(/withNextParam\("\/forgot-password", next\)/g) ?? [];
    expect(carried).toHaveLength(2);
    expect(source).not.toMatch(/href="\/forgot-password"/);
  });

  it("the forgot-password and update-password pages sanitize next from the URL", () => {
    for (const file of [
      "app/(auth)/forgot-password/page.tsx",
      "app/(auth)/update-password/page.tsx",
    ]) {
      const source = read(file);
      expect(source, file).toContain("sanitizeNextPath(");
      expect(source, file).toContain("firstParam(params.next)");
      expect(source, file).toMatch(/searchParams: Promise<SearchParams>/);
    }
    expect(read("app/(auth)/update-password/page.tsx")).toContain(
      "DEFAULT_NEXT_PATH"
    );
  });

  it("the recovery link carries next into /update-password and the form honours it", () => {
    const forgot = read("app/(auth)/forgot-password/ForgotPasswordForm.tsx");
    expect(forgot).toContain('withNextParam("/update-password", next)');
    expect(forgot).toMatch(/\/auth\/callback\?next=\$\{encodeURIComponent\(/);

    const update = read("app/(auth)/update-password/UpdatePasswordForm.tsx");
    expect(update).toContain("router.replace(next)");
    expect(update).not.toContain('router.replace("/dashboard")');
    expect(update).toContain('withNextParam("/forgot-password", next)');
    expect(update).toContain('withNextParam("/login", next)');
  });

  it("renders Back to log in once in every state of the update-password form", () => {
    const source = read("app/(auth)/update-password/UpdatePasswordForm.tsx");
    expect(source.match(/Back to log in/g)).toHaveLength(1);
  });

  // The value ForgotPasswordForm sends as `redirectTo`, replayed through the
  // callback route's resolver for both link styles Supabase can produce.
  function recoveryRedirectUrl(next: string) {
    const destination = withNextParam("/update-password", next);
    return `https://pokedrafts.example/auth/callback?next=${encodeURIComponent(destination)}`;
  }

  function nextOf(path: string) {
    return new URL(path, "http://localhost").searchParams.get("next");
  }

  it("survives the PKCE ?code link (redirectTo is echoed back verbatim)", () => {
    const redirect = new URL(recoveryRedirectUrl("/invite/ABC"));
    const landed = resolveCallbackNext(redirect.searchParams.get("next"));
    expect(landed).toBe("/update-password?next=%2Finvite%2FABC");
    expect(sanitizeNextPath(nextOf(landed))).toBe("/invite/ABC");
  });

  it("survives the token-hash link (next={{ .RedirectTo }} wraps the whole URL)", () => {
    const landed = resolveCallbackNext(
      recoveryRedirectUrl("/leagues/x/team?tab=1")
    );
    expect(landed).toBe("/update-password?next=%2Fleagues%2Fx%2Fteam%3Ftab%3D1");
    expect(sanitizeNextPath(nextOf(landed))).toBe("/leagues/x/team?tab=1");
  });

  it("keeps the plain /update-password link for the default destination", () => {
    const redirect = new URL(recoveryRedirectUrl(DEFAULT_NEXT_PATH));
    expect(redirect.searchParams.get("next")).toBe("/update-password");
    expect(resolveCallbackNext("/update-password")).toBe("/update-password");
    expect(sanitizeNextPath(nextOf("/update-password"))).toBe(DEFAULT_NEXT_PATH);
  });

  it("never lets an unsafe next through the chain", () => {
    const redirect = new URL(recoveryRedirectUrl("//evil.example"));
    expect(redirect.searchParams.get("next")).toBe("/update-password");
    const landed = resolveCallbackNext(
      "/update-password?next=" + encodeURIComponent("https://evil.example/x")
    );
    expect(sanitizeNextPath(nextOf(landed))).toBe(DEFAULT_NEXT_PATH);
  });
});

describe("browser chrome follows the theme (docs 8.4/8.6)", () => {
  it("the root layout derives themeColor from the cookie via themeBackgrounds", () => {
    const source = read("app/layout.tsx");
    expect(source).toMatch(
      /export async function generateViewport\(\): Promise<Viewport>/
    );
    expect(source).not.toMatch(/export const viewport\b/);
    expect(source).toContain("themeColor: themeBackgrounds[theme]");
    expect(source).toContain("cookieStore.get(THEME_COOKIE)");
    expect(source).not.toMatch(/themeColor: "#/);
  });

  it("themeBackgrounds covers every theme with a distinct dark hex", () => {
    for (const theme of pokemonThemes) {
      expect(themeBackgrounds[theme], theme).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(Object.keys(themeBackgrounds).sort()).toEqual(
      [...pokemonThemes].sort()
    );
  });
});

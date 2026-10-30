import type { SupabaseClient } from "@supabase/supabase-js";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DELETE_CONFIRM_TEXT, deletionSummary } from "@/app/(app)/account/account";
import LoginForm from "@/app/(auth)/login/LoginForm";
import SignupForm from "@/app/(auth)/signup/SignupForm";
import { LEGAL, formatLegalDate } from "@/app/(legal)/details";
import PrivacyPage from "@/app/(legal)/privacy/page";
import TermsPage from "@/app/(legal)/terms/page";
import { createRpc } from "@/app/lib/rpc";
import type { AccountDeletionPreview } from "@/app/types/account";

/**
 * Account deletion and the legal pages (docs/release-architecture.md section
 * 17): the confirm step's wording comes straight from the preview, the RPC
 * wrappers name the two functions, the privacy policy and terms carry the
 * owner's details from app/(legal)/details.ts, and the sign-up and log-in
 * pages link both documents.
 */

vi.mock("next/link", () => ({ default: "a" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/app/lib/supabase/client", () => ({ createClient: () => ({ auth: {} }) }));

/** Visible text: tags become spaces, so a space before punctuation that followed a link is dropped. */
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .replace(/ ([.,:;])/g, "$1")
    .trim();

const EMPTY: AccountDeletionPreview = {
  deleted_leagues: [],
  handed_over_leagues: [],
  removed_teams: [],
  kept_teams: [],
  draft_formats: 0,
  chat_messages: 0,
  site_admin: false,
};

describe("deletionSummary", () => {
  it("lists everything the plan removes, the leagues it hands over, then the teams it keeps", () => {
    const summary = deletionSummary(
      {
        ...EMPTY,
        deleted_leagues: [{ league_id: "l1", league_name: "Solo Cup" }],
        handed_over_leagues: [
          { league_id: "l5", league_name: "Big League", new_commissioner_team: "Firsts" },
          { league_id: "l6", league_name: "Quiet League", new_commissioner_team: null },
        ],
        removed_teams: [
          { league_id: "l2", league_name: "Spring League", team_name: "Sprouts" },
          { league_id: "l5", league_name: "Big League", team_name: "Mine" },
        ],
        kept_teams: [
          { league_id: "l3", league_name: "Winter League", team_name: "Frost" },
          { league_id: "l4", league_name: "Old League", team_name: null },
        ],
        draft_formats: 2,
        chat_messages: 1,
        site_admin: true,
      },
      "coach@example.com"
    );

    expect(summary.removed.map((line) => line.text)).toEqual([
      "Your sign-in and your email address (coach@example.com)",
      "Your site admin access (reviewing Watch listings)",
      "Solo Cup, which only you coach, with everything in it",
      "Your place in Spring League, whose draft has not started",
      "Your place in Big League, whose draft has not started",
      "2 draft formats you saved (leagues keep their own copy of their pool)",
      "1 draft chat message",
    ]);
    expect(summary.handedOver.map((line) => line.text)).toEqual([
      "Big League: Firsts, the coach who joined it first, becomes commissioner",
      "Quiet League: Unnamed team, the coach who joined it first, becomes commissioner",
    ]);
    expect(summary.kept.map((line) => line.text)).toEqual([
      "Frost in Winter League: its roster and results stay, so the other coaches keep their matches and standings",
      "Unnamed team in Old League: its roster and results stay, so the other coaches keep their matches and standings",
    ]);
    // A league handed over is listed twice (handed over, and the caller's own place), under different keys.
    const keys = [...summary.removed, ...summary.handedOver, ...summary.kept].map((line) => line.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("says only the sign-in goes for an account with nothing else, and leaves out the email it does not know", () => {
    const summary = deletionSummary(EMPTY, null);
    expect(summary.removed.map((line) => line.text)).toEqual(["Your sign-in and your email address"]);
    expect(summary.handedOver).toEqual([]);
    expect(summary.kept).toEqual([]);
  });

  it("keeps the line keys unique when two leagues share a name", () => {
    const summary = deletionSummary(
      {
        ...EMPTY,
        deleted_leagues: [
          { league_id: "a", league_name: "Test League" },
          { league_id: "b", league_name: "Test League" },
        ],
      },
      null
    );
    const keys = summary.removed.map((line) => line.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("asks for DELETE to be typed", () => {
    expect(DELETE_CONFIRM_TEXT).toBe("DELETE");
  });
});

describe("account deletion RPC wrappers", () => {
  function fakeClient(response: { data: unknown; error: unknown }) {
    const rpc = vi.fn(async () => response);
    return { client: { rpc } as unknown as SupabaseClient, rpc };
  }

  it("call account_deletion_preview and delete_account without arguments", async () => {
    const preview = fakeClient({ data: EMPTY, error: null });
    expect(await createRpc(preview.client).accountDeletionPreview()).toEqual({ data: EMPTY, error: null, code: null });
    expect(preview.rpc).toHaveBeenCalledWith("account_deletion_preview", {});

    const counts = {
      deleted_leagues: 0,
      handed_over_leagues: 1,
      removed_teams: 1,
      kept_teams: 0,
      draft_formats: 0,
      chat_messages: 0,
      site_admin: false,
      sign_in_deleted: true,
      audit_log_entries: 3,
    };
    const deletion = fakeClient({ data: counts, error: null });
    expect(await createRpc(deletion.client).deleteAccount()).toEqual({ data: counts, error: null, code: null });
    expect(deletion.rpc).toHaveBeenCalledWith("delete_account", {});
  });

  it("hands back the function's own code when the server cannot delete the sign-in", async () => {
    const message = "Account deletion is not available right now. Nothing was deleted; please try again later.";
    const { client } = fakeClient({ data: null, error: { code: "P0001", message, details: "account_deletion_unavailable" } });
    expect(await createRpc(client).deleteAccount()).toEqual({ data: null, error: message, code: "account_deletion_unavailable" });
  });
});

describe("privacy policy and terms", () => {
  it("formats the last-updated date the same in every time zone", () => {
    expect(formatLegalDate("2026-10-20")).toBe("October 20, 2026");
    expect(formatLegalDate("2027-01-01")).toBe("January 1, 2027");
  });

  it("the privacy policy names the owner, the contact address and how to delete an account", () => {
    const html = renderToStaticMarkup(createElement(PrivacyPage));
    const body = text(html);
    expect(html).toMatch(/<h1[^>]*>Privacy Policy<\/h1>/);
    expect(body).toContain(`Last updated ${formatLegalDate(LEGAL.lastUpdated)}`);
    expect(body).toContain(`run by ${LEGAL.owner}`);
    expect(html).toContain(`href="mailto:${LEGAL.contactEmail}"`);
    expect(html).toContain('href="/account"');
    expect(html).toContain('href="/terms"');
    expect(body).toContain(`children under ${LEGAL.minimumAge}`);
    for (const provider of ["Supabase", "Vercel", "Discord"]) {
      expect(body).toContain(provider);
    }
    expect(body).toContain("pokedrafts-theme");
  });

  it("the terms name the owner, the minimum age, the governing law and the contact address", () => {
    const html = renderToStaticMarkup(createElement(TermsPage));
    const body = text(html);
    expect(html).toMatch(/<h1[^>]*>Terms of Service<\/h1>/);
    expect(body).toContain(`run by ${LEGAL.owner}`);
    expect(body).toContain(`at least ${LEGAL.minimumAge} years old`);
    expect(body).toContain(`governed by the laws of ${LEGAL.governingLaw}`);
    expect(html).toContain(`href="mailto:${LEGAL.contactEmail}"`);
    expect(html).toContain('href="/privacy"');
    expect(body).toContain("not affiliated with, endorsed or sponsored by Nintendo");
  });

  it("every section has a heading the page can link to", () => {
    for (const page of [PrivacyPage, TermsPage]) {
      const html = renderToStaticMarkup(createElement(page));
      const sections = [...html.matchAll(/<section aria-labelledby="([^"]+)"/g)].map((m) => m[1]);
      expect(sections.length).toBeGreaterThan(5);
      expect(new Set(sections).size).toBe(sections.length);
      for (const id of sections) {
        expect(html).toContain(`<h2 id="${id}"`);
      }
    }
  });

  it("carry the owner's real details, not placeholders", () => {
    // The owner supplies these (app/(legal)/details.ts); nothing ships until they do.
    expect(LEGAL.owner).not.toMatch(/[[\]]/);
    expect(LEGAL.owner.trim().length).toBeGreaterThan(1);
    expect(LEGAL.contactEmail).toMatch(/^[^\s@[\]]+@[^\s@[\]]+\.[a-z]{2,}$/i);
    expect(LEGAL.governingLaw).not.toMatch(/[[\]]/);
    expect(Number.isInteger(LEGAL.minimumAge) && LEGAL.minimumAge >= 13).toBe(true);
    expect(LEGAL.lastUpdated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("sign-up and log-in pages", () => {
  it("sign-up says creating an account accepts the terms and links both documents", () => {
    const html = renderToStaticMarkup(createElement(SignupForm, { next: "/dashboard", discord: true }));
    expect(text(html)).toContain("By creating an account, you agree to the Terms of Service and acknowledge the Privacy Policy.");
    expect(html).toContain('href="/terms"');
    expect(html).toContain('href="/privacy"');
  });

  it("log-in carries the consent line only while Continue with Discord can create an account", () => {
    const withDiscord = renderToStaticMarkup(createElement(LoginForm, { next: "/dashboard", discord: true }));
    expect(text(withDiscord)).toContain("By continuing with Discord, you agree to the Terms of Service and acknowledge the Privacy Policy.");
    const emailOnly = renderToStaticMarkup(createElement(LoginForm, { next: "/dashboard" }));
    expect(emailOnly).not.toContain('href="/terms"');
  });

  it("log-in confirms a deletion the Account page just made", () => {
    const html = renderToStaticMarkup(createElement(LoginForm, { next: "/dashboard", accountDeleted: true }));
    expect(text(html)).toContain("Account deleted Your PokeDrafts account has been deleted and you are signed out.");
    expect(renderToStaticMarkup(createElement(LoginForm, { next: "/dashboard" }))).not.toContain("Account deleted");
  });
});

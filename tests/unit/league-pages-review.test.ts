import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { undoableNewsIds } from "@/app/(app)/leagues/[leagueId]/NewsFeed";

/**
 * Review findings for the league pages (dashboard, new league, overview,
 * free agents, team, pool, settings; docs/release-architecture.md sections
 * 2, 7, 8.3, 8.4 and 8.5).
 *
 * 1. The overview news feed offers Undo only on each team's newest
 *    free-agent row (`undo_free_agent_move` refuses older ones).
 * 2. Per-row buttons whose visible text repeats ("Delete", "Remove", "Make
 *    commissioner", "Leave league", "Add") carry an `aria-label` that
 *    contains the visible text (WCAG 2.5.3, label in name).
 * 3. Lists with a table and a card layout mount only one of them through
 *    `useMinWidthMd`, so per-row ids (`aria-describedby`) stay unique.
 * 4. Both invite cards confirm a regeneration with the same danger dialog;
 *    the pool's point fields are sized by a wrapper; copy is consistent
 *    ("Create League", "Free agent", "Matchup format").
 * 5. The free-agents page watches the league row and hides roster numbers
 *    when the roster load failed; the dashboard closes the delete dialog
 *    and reloads when nothing was deleted; draft-order move buttons stay
 *    rendered at the ends and hand focus over.
 */

const root = resolve(__dirname, "../..");
const leagueDir = "app/(app)/leagues/[leagueId]";

function read(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

type NewsRow = {
  id: string;
  member_id: string | null;
  news_type: string;
  created_at: string;
};

function row(
  id: string,
  member: string | null,
  type: string,
  at: string
): NewsRow {
  return { id, member_id: member, news_type: type, created_at: at };
}

describe("undoableNewsIds (overview news feed)", () => {
  const feed: NewsRow[] = [
    row("n5", "a", "match_result", "2026-09-05T10:00:00Z"),
    row("n4", "a", "free_agent", "2026-09-04T10:00:00Z"),
    row("n3", "b", "free_agent", "2026-09-03T10:00:00Z"),
    row("n2", "a", "free_agent", "2026-09-02T10:00:00Z"),
    row("n1", "b", "FREE_AGENT", "2026-09-01T10:00:00Z"),
  ];

  it("keeps only the newest free-agent row per team", () => {
    expect([...undoableNewsIds(feed)].sort()).toEqual(["n3", "n4"]);
  });

  it("ignores rows that are not free-agent moves", () => {
    const ids = undoableNewsIds(feed);
    expect(ids.has("n5")).toBe(false);
  });

  it("gives the same answer when the rows arrive unsorted", () => {
    const shuffled = [feed[2], feed[4], feed[0], feed[3], feed[1]];
    expect([...undoableNewsIds(shuffled)].sort()).toEqual(["n3", "n4"]);
  });

  it("breaks a created_at tie by id, newest id first, like the feed query", () => {
    const tied = [
      row("b", "a", "free_agent", "2026-09-04T10:00:00Z"),
      row("c", "a", "free_agent", "2026-09-04T10:00:00Z"),
      row("a", "a", "free_agent", "2026-09-04T10:00:00Z"),
    ];
    expect([...undoableNewsIds(tied)]).toEqual(["c"]);
  });

  it("skips rows without a member and tolerates unparsable dates", () => {
    const odd = [
      row("x", null, "free_agent", "2026-09-04T10:00:00Z"),
      row("y", "a", "free_agent", "not a date"),
      row("z", "a", "free_agent", "2026-09-01T10:00:00Z"),
    ];
    expect([...undoableNewsIds(odd)]).toEqual(["z"]);
  });

  it("is empty for an empty feed", () => {
    expect(undoableNewsIds([]).size).toBe(0);
  });

  it("gates the Undo button on that set in NewsFeed.tsx", () => {
    const source = read(`${leagueDir}/NewsFeed.tsx`);
    expect(source).toMatch(/undoableNewsIds\(news\)/);
    expect(source).toMatch(/canUndo=\{undoable\.has\(item\.id\)\}/);
    // The dialog still surfaces the function's own message.
    expect(source).toMatch(/error=\{undoError\}/);
  });
});

type ButtonElement = { attrs: string; inner: string; line: number };

/**
 * Every `<Button ...>...</Button>` in a source file (not `<ButtonLink>`),
 * skipping `>` inside `{...}` attribute expressions such as arrow functions.
 */
function buttonElements(source: string): ButtonElement[] {
  const found: ButtonElement[] = [];
  const tag = "<Button";
  let from = 0;
  for (;;) {
    const start = source.indexOf(tag, from);
    if (start < 0) break;
    const after = source[start + tag.length];
    if (after !== undefined && !/\s/.test(after)) {
      from = start + tag.length;
      continue;
    }
    let i = start + tag.length;
    let depth = 0;
    while (i < source.length) {
      const ch = source[i];
      if (ch === "{") depth += 1;
      else if (ch === "}") depth -= 1;
      else if (ch === ">" && depth === 0) break;
      i += 1;
    }
    const attrs = source.slice(start + tag.length, i);
    const line = source.slice(0, start).split("\n").length;
    if (attrs.trimEnd().endsWith("/")) {
      found.push({ attrs, inner: "", line });
      from = i + 1;
      continue;
    }
    const close = source.indexOf("</Button>", i);
    if (close < 0) throw new Error(`Unclosed <Button> at line ${line}`);
    found.push({ attrs, inner: source.slice(i + 1, close), line });
    from = close + "</Button>".length;
  }
  return found;
}

/** Removes balanced `{...}` blocks. */
function stripExpressions(text: string): string {
  let out = "";
  let depth = 0;
  for (const ch of text) {
    if (ch === "{") depth += 1;
    else if (ch === "}") depth -= 1;
    else if (depth === 0) out += ch;
  }
  return out;
}

/** The static text a sighted user reads on the button. */
function visibleText(inner: string): string {
  return stripExpressions(inner.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/** The literal parts of an `aria-label` (template `${}` holes removed). */
function ariaLabelLiteral(attrs: string): string | null {
  const template = attrs.match(/aria-label=\{`([^`]*)`\}/);
  if (template) return template[1].replace(/\$\{[^}]*\}/g, "");
  const literal = attrs.match(/aria-label="([^"]*)"/);
  return literal ? literal[1] : null;
}

const ROW_BUTTON_FILES: Array<{ file: string; labelled: string[] }> = [
  { file: "app/(app)/dashboard/DashboardClient.tsx", labelled: ["Delete"] },
  {
    file: `${leagueDir}/CoachesList.tsx`,
    labelled: ["Make commissioner", "Remove", "Leave league"],
  },
  {
    file: `${leagueDir}/settings/CoachesCard.tsx`,
    labelled: ["Make commissioner", "Remove"],
  },
  { file: `${leagueDir}/free-agents/FreeAgentList.tsx`, labelled: ["Add"] },
  { file: `${leagueDir}/pool/PoolTable.tsx`, labelled: ["Remove"] },
  { file: `${leagueDir}/pool/PoolCards.tsx`, labelled: ["Remove"] },
];

describe("per-row buttons keep the visible text in the accessible name (WCAG 2.5.3)", () => {
  describe.each(ROW_BUTTON_FILES)("$file", ({ file, labelled }) => {
    const buttons = buttonElements(read(file));

    it("finds buttons", () => {
      expect(buttons.length).toBeGreaterThan(0);
    });

    it.each(labelled)('gives the "%s" button a per-row aria-label', (text) => {
      const matching = buttons.filter((button) => visibleText(button.inner) === text);
      expect(matching.length, `no <Button> reading "${text}"`).toBeGreaterThan(0);
      for (const button of matching) {
        const label = ariaLabelLiteral(button.attrs);
        expect(label, `line ${button.line}: missing aria-label`).not.toBeNull();
        // A label made only of the row's name would hide the visible text.
        expect(label!.match(/\$\{/)).toBeNull();
        expect(button.attrs, `line ${button.line}`).toMatch(/aria-label=\{`[^`]*\$\{/);
      }
    });

    it("never labels a button with text that drops its visible label", () => {
      for (const button of buttons) {
        const label = ariaLabelLiteral(button.attrs);
        const text = visibleText(button.inner);
        if (label === null || text === "") continue;
        expect(label, `line ${button.line}: "${label}" lacks "${text}"`).toContain(text);
      }
    });
  });
});

describe("single-layout lists (docs section 8.5)", () => {
  const files = [
    `${leagueDir}/free-agents/FreeAgentList.tsx`,
    `${leagueDir}/team/RosterTable.tsx`,
    `${leagueDir}/pool/PoolClient.tsx`,
  ];

  it.each(files)("%s mounts the table or the cards through useMinWidthMd", (file) => {
    const source = read(file);
    expect(source).toMatch(/useMinWidthMd\(\)/);
    expect(source).not.toMatch(/hidden md:block/);
    expect(source).not.toMatch(/md:hidden/);
  });

  it("FreeAgentList links each Add button to one reason id", () => {
    const source = read(`${leagueDir}/free-agents/FreeAgentList.tsx`);
    expect(source.match(/aria-describedby=/g)).toHaveLength(1);
    expect(source.match(/id=\{reasonId\}/g)).toHaveLength(1);
  });
});

/** The `<Dialog ...>` opening tag whose attributes contain `marker`. */
function dialogWith(source: string, marker: string): string {
  const dialogs = [...source.matchAll(/<Dialog\b([\s\S]*?)\/>/g)].map((m) => m[1]);
  const found = dialogs.find((attrs) => attrs.includes(marker));
  if (!found) throw new Error(`No <Dialog> containing ${marker}`);
  return found;
}

describe("invite regeneration confirms the same way on the overview and on Settings", () => {
  it.each([
    `${leagueDir}/InviteCard.tsx`,
    `${leagueDir}/settings/InviteCard.tsx`,
  ])("%s uses a danger dialog titled 'Regenerate invite link?'", (file) => {
    const attrs = dialogWith(read(file), "Regenerate invite link?");
    expect(attrs).toMatch(/\bdanger\b/);
    expect(attrs).toMatch(/"Regenerate link"/);
    expect(attrs).toMatch(/stops working/);
  });

  it("hides the Settings share copy and link once the draft has started", () => {
    const source = read(`${leagueDir}/settings/InviteCard.tsx`);
    expect(source).toMatch(/closed\s*\?\s*`\$\{memberCount\} of \$\{league\.max_coaches\} seats are taken\.`/);
    expect(source).toMatch(/\{closed \? null : invite \? \(/);
  });
});

describe("pool point fields are sized by a wrapper", () => {
  it.each([`${leagueDir}/pool/PoolTable.tsx`, `${leagueDir}/pool/PoolCards.tsx`])(
    "%s wraps NumberInput in a w-24 element instead of passing className",
    (file) => {
      const source = read(file);
      const inputs = [...source.matchAll(/<NumberInput\b([\s\S]*?)\/>/g)].map((m) => m[1]);
      expect(inputs.length).toBeGreaterThan(0);
      for (const attrs of inputs) expect(attrs).not.toMatch(/className=/);
      expect(source).toMatch(/<div className="w-24">\s*<NumberInput/);
    }
  );
});

describe("copy consistency (docs section 2)", () => {
  it("submits the new-league form with 'Create League' and titles the page the same", () => {
    expect(read("app/(app)/leagues/new/NewLeagueClient.tsx")).toMatch(/>\s*Create League\s*</);
    expect(read("app/(app)/leagues/new/NewLeagueClient.tsx")).not.toMatch(/>\s*Create league\s*</);
    expect(read("app/(app)/leagues/new/page.tsx")).toMatch(/title: "Create League"/);
    expect(read("app/(app)/dashboard/DashboardClient.tsx")).not.toMatch(/Create league\b/);
  });

  it("spells 'Free agent' without a hyphen in labels", () => {
    for (const file of [
      `${leagueDir}/settings/SettingsForm.tsx`,
      `${leagueDir}/settings/SettingsSummary.tsx`,
      `${leagueDir}/team/TeamClient.tsx`,
      `${leagueDir}/free-agents/FreeAgentsClient.tsx`,
    ]) {
      const source = read(file);
      expect(source, file).not.toMatch(/label="Free-agent/);
      expect(source, file).not.toMatch(/help="Free-agent/);
      expect(source, file).not.toMatch(/"Free-agent swaps"/);
    }
    expect(read(`${leagueDir}/settings/SettingsForm.tsx`)).toMatch(/label="Free agent swap limit"/);
    expect(read(`${leagueDir}/settings/SettingsSummary.tsx`)).toMatch(/label="Free agent swap limit"/);
    expect(read(`${leagueDir}/team/TeamClient.tsx`)).toMatch(/label: "Free agent swaps"/);
  });

  it("labels the schedule setting 'Matchup format'", () => {
    for (const file of [
      `${leagueDir}/settings/SettingsForm.tsx`,
      `${leagueDir}/settings/SettingsSummary.tsx`,
    ]) {
      const source = read(file);
      expect(source, file).toMatch(/label="Matchup format"/);
      expect(source, file).not.toMatch(/schedule format/i);
    }
  });
});

describe("free agents page", () => {
  const source = read(`${leagueDir}/free-agents/FreeAgentsClient.tsx`);

  it("watches the league row alongside rosters and news", () => {
    const tables = source.match(/tables:\s*\[([^\]]*)\]/);
    expect(tables).not.toBeNull();
    expect(tables![1]).toMatch(/"leagues"/);
    expect(tables![1]).toMatch(/"drafted_teams"/);
    expect(tables![1]).toMatch(/"league_news"/);
  });

  it("hides the stats strip and the availability count when the roster load failed", () => {
    expect(source).toMatch(/const failed = state\.status === "error";/);
    expect(source).toMatch(/\{!failed && \(\s*<RosterStats/);
    expect(source).toMatch(/\{!failed && \(\s*<p className="mt-1 text-sm text-muted" aria-live="polite">/);
  });
});

describe("dashboard delete and draft-order focus", () => {
  it("closes the dialog and reloads when nothing was deleted", () => {
    const source = read("app/(app)/dashboard/DashboardClient.tsx");
    const start = source.indexOf("if (!data || data.length === 0) {");
    expect(start).toBeGreaterThan(-1);
    const block = source.slice(start, source.indexOf("return;", start));
    expect(block).toMatch(/setPendingDelete\(null\)/);
    expect(block).toMatch(/setState\(await load\(\)\)/);
    expect(block).toMatch(/variant: "warning"/);
    expect(block).not.toMatch(/setDeleteError/);
  });

  it("keeps the Move up / Move down buttons rendered and hands focus over", () => {
    const source = read(`${leagueDir}/settings/DraftOrderCard.tsx`);
    expect(source).toMatch(/disabled=\{pending \|\| index === 0\}/);
    expect(source).toMatch(/disabled=\{pending \|\| index === order\.length - 1\}/);
    expect(source).toMatch(/ref=\{registerMoveButton\(member\.id, "up"\)\}/);
    expect(source).toMatch(/ref=\{registerMoveButton\(member\.id, "down"\)\}/);
    expect(source).toMatch(/\(pressed && !pressed\.disabled \? pressed : sibling\)\?\.focus\(\)/);
  });
});

describe("long names cannot widen a 375px viewport", () => {
  it("lets truncated names shrink inside flex-wrap rows and breaks embedded league names", () => {
    expect(read(`${leagueDir}/CoachesList.tsx`)).toMatch(/min-w-0 truncate font-semibold/);
    expect(read(`${leagueDir}/settings/CoachesCard.tsx`)).toMatch(/min-w-0 truncate font-semibold/);
    expect(read(`${leagueDir}/team/TeamCard.tsx`)).toMatch(/<span className="min-w-0 truncate">\{name\}<\/span>/);
    // The overview title and the My Team description go through PageHeader,
    // which applies wrap-anywhere to both.
    expect(read("app/components/ui/PageHeader.tsx")).toMatch(/<h1 className="[^"]*wrap-anywhere/);
    expect(read("app/components/ui/PageHeader.tsx")).toMatch(/<p className="[^"]*wrap-anywhere/);
    expect(read("app/(app)/dashboard/DashboardClient.tsx")).toMatch(/<h3 className="wrap-anywhere/);
    expect(read("app/(app)/dashboard/DashboardClient.tsx")).toMatch(/<dd className="wrap-anywhere">/);
  });
});

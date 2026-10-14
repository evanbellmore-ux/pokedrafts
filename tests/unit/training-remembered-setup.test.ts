import { act, createElement, useEffect } from "react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createRosterState, type CalculatorRosterState } from "@/app/(app)/calculator/roster-data";
import { parseTeamImport } from "@/app/lib/battle/team-import";
import { DEFAULT_INFO, PERFECT_INFORMATION } from "@/app/(app)/training/model/info";
import type { MemberEdit, SetupDraft, SetupPicks, TeamSourceDraft, TrainingSnapshot } from "@/app/(app)/training/model/view-types";
import {
  parseStoredSetup, picksOf, RECENT_OPPONENTS, REMEMBERED_PASTE_MAX, restoredDraft, storedSetupOf, withLeague, withOpponent, withStart,
} from "@/app/(app)/training/setup/remembered-setup";
import { createSetupDraft, emptySource, pasteKey, resolveTeam, untouched } from "@/app/(app)/training/setup/team-draft";
import type TeamSetupType from "@/app/(app)/training/setup/TeamSetup";
import type { useRememberedPicks as UseRememberedPicks } from "@/app/(app)/training/setup/useRememberedPicks";
import { initialSnapshot } from "@/app/(app)/training/training-session";
import { installFakeDom, type FakeDocument } from "../fixtures/fake-dom";
import { OPPONENT_MEMBERS, OPPONENT_ROSTER, OWN_MEMBERS, OWN_ROSTER, PASTE_TEXT, rosterState, runtime } from "../fixtures/training";

// The remembered setup (localStorage per account): what the record holds, how it reads back (untrusted, part by part), how
// a side comes back, your league picks, the page's restore of the league, and the PokéPaste default without leagues.

const EDIT: MemberEdit = { build: OWN_MEMBERS[0].build, moves: OWN_MEMBERS[0].moves };
const PASTE_KEYS = [0, 1, 2, 3, 4, 5].map((index) => pasteKey(runtime, "own", "own-2", index));
const applied = (text = PASTE_TEXT) => ({ id: "own-2", title: "Sand team", url: null, text, team: parseTeamImport(text, "champions", runtime) });
/** Your team as a PokéPaste you imported (five of six chosen), its league mode's picks kept, edits on both modes' members. */
const pasteSide = (): TeamSourceDraft => ({
  ...emptySource(), mode: "paste", epoch: 2, paste: applied(), chosen: PASTE_KEYS.slice(0, 5), otherChosen: ["league-a", "league-b"],
  edits: { [PASTE_KEYS[0]]: EDIT, [PASTE_KEYS[5]]: EDIT, "league-a": EDIT, "league-c": EDIT },
});
const NO_PICKS = picksOf("user-1", null);
const roundTrip = (draft: SetupDraft, picks: SetupPicks = NO_PICKS) => parseStoredSetup(JSON.parse(JSON.stringify(storedSetupOf(draft, picks, null))))!;

describe("the remembered setup record", () => {
  it("holds the draft's choices and your picks, never the information settings or the test extras", () => {
    const draft: SetupDraft = { ...createSetupDraft({ aiKnows: PERFECT_INFORMATION, youSee: PERFECT_INFORMATION }), difficulty: "reads", showRead: false };
    const record = storedSetupOf(draft, { ...NO_PICKS, leagueId: "league-a", opponents: { "league-a": "member-other" } }, { ownKeys: OWN_MEMBERS.map((member) => member.key), order: [3, 1, 5, 2] });
    expect(JSON.stringify(record)).not.toMatch(/exactHP|brought|aiKnows|youSee|"info"/);
    expect(record).toMatchObject({
      version: 1, leagueId: "league-a", opponents: { "league-a": "member-other" }, recent: {}, difficulty: "reads", showRead: false,
      own: { mode: "league", epoch: 0, chosen: null, otherChosen: null, edits: {}, paste: null, pasteDraft: null },
      lastTeam: { order: [3, 1, 5, 2] },
    });
  });

  it("keeps each mode's set edits for its chosen members (all of them while a mode has its first six)", () => {
    const own = pasteSide();
    expect(Object.keys(storedSetupOf({ ...createSetupDraft(), own }, NO_PICKS, null).own.edits)).toEqual([PASTE_KEYS[0], "league-a"]);
    const firstSix = storedSetupOf({ ...createSetupDraft(), own: { ...own, otherChosen: null } }, NO_PICKS, null).own;
    expect(Object.keys(firstSix.edits)).toEqual([PASTE_KEYS[0], "league-a", "league-c"]);
  });

  it("keeps a set edit made after another opponent was picked, while Choose 6 still holds the last opponent's picks", () => {
    const rival = rosterState(OWN_ROSTER, OPPONENT_ROSTER);
    const rivalKeys = resolveTeam(emptySource(), rival, "opponent", { status: "idle" }, runtime).chosen.slice(0, 5);
    // Another coach of the league, picked without touching Choose 6: the picks name none of its members, so its first six show.
    const data = rival.data!;
    const third: CalculatorRosterState = {
      ...rival, opponentId: "member-third",
      data: {
        ...data, members: [...data.members, { id: "member-third", role: "coach", team_name: "Third", draft_position: 3 }],
        teams: [...data.teams, { ...data.teams[1], id: "team-third", member_id: "member-third" }],
      },
    };
    const key = resolveTeam({ ...emptySource(), chosen: rivalKeys }, third, "opponent", { status: "idle" }, runtime).chosen[0];
    expect(rivalKeys).not.toContain(key);
    const edit: MemberEdit = { build: OPPONENT_MEMBERS[0].build, moves: OPPONENT_MEMBERS[0].moves };
    // Your edit of its first member, beside one of the last opponent's chosen members and one it did not choose.
    const opponent: TeamSourceDraft = { ...emptySource(), chosen: rivalKeys, edits: { [rivalKeys[0]]: edit, [key]: edit } };
    expect(resolveTeam(opponent, third, "opponent", { status: "idle" }, runtime).members[0]?.origin).toBe("edited");
    const stale = resolveTeam(emptySource(), rival, "opponent", { status: "idle" }, runtime).chosen[5];
    const withUnchosen = { ...opponent, edits: { ...opponent.edits, [stale]: edit } };
    expect(Object.keys(storedSetupOf({ ...createSetupDraft(), opponent: withUnchosen }, NO_PICKS, null).opponent.edits)).toEqual([rivalKeys[0], key]);
    // A reload: the edit comes back and applies to the same member.
    const restored = restoredDraft(roundTrip({ ...createSetupDraft(), opponent }), DEFAULT_INFO, runtime).opponent;
    expect(Object.keys(restored.edits)).toEqual([rivalKeys[0], key]);
    expect(resolveTeam(restored, third, "opponent", { status: "idle" }, runtime).members[0]?.origin).toBe("edited");
  });

  it("keeps a PokéPaste whose title or link is past the reader's limits: the title cut, the link left out, the text kept", () => {
    const paste = { ...applied(), title: "T".repeat(201), url: `https://pokepast.es/${"a".repeat(2000)}` };
    const typed = { text: `${PASTE_TEXT}\n`, url: "x".repeat(2001), title: "D".repeat(300), format: "champions" as const };
    const restored = restoredDraft(roundTrip({ ...createSetupDraft(), own: { ...pasteSide(), paste, pasteDraft: typed } }), DEFAULT_INFO, runtime).own;
    expect(restored.mode).toBe("paste");
    expect(restored.paste).toMatchObject({ id: "own-2", text: PASTE_TEXT, title: "T".repeat(200), url: null });
    expect(restored.pasteDraft).toEqual({ text: `${PASTE_TEXT}\n`, url: "", title: "D".repeat(200), format: "champions" });
    expect(restored.chosen).toEqual(PASTE_KEYS.slice(0, 5));
  });

  it(`keeps a side's PokéPaste text up to ${REMEMBERED_PASTE_MAX} characters; the importer's own text only when it differs`, () => {
    const side = (own: TeamSourceDraft) => storedSetupOf({ ...createSetupDraft(), own }, NO_PICKS, null).own;
    const typed = { text: PASTE_TEXT, url: "", title: "Sand team", format: "champions" as const };
    expect(side({ ...pasteSide(), pasteDraft: typed })).toMatchObject({ paste: { id: "own-2", text: PASTE_TEXT, title: "Sand team", url: null, format: "champions" }, pasteDraft: null });
    const edited = { ...typed, text: `${PASTE_TEXT}\n` };
    expect(side({ ...pasteSide(), pasteDraft: edited }).pasteDraft).toEqual(edited);
    const long = "x".repeat(REMEMBERED_PASTE_MAX - PASTE_TEXT.length + 1);
    expect(side({ ...pasteSide(), pasteDraft: { ...typed, text: long } })).toMatchObject({ paste: { text: PASTE_TEXT }, pasteDraft: null });
    const huge = `${PASTE_TEXT}\n\n${"x".repeat(REMEMBERED_PASTE_MAX)}`;
    expect(side({ ...pasteSide(), paste: applied(huge) }).paste).toBeNull();
  });

  it("brings a side back as it was: the PokéPaste imported again with its keys, each mode's picks, the edits, the importer's text", () => {
    const typed = { text: `${PASTE_TEXT}\n`, url: "", title: "Sand team", format: "champions" as const };
    const own = { ...pasteSide(), pasteDraft: typed };
    const draft: SetupDraft = { ...createSetupDraft(), own, difficulty: "reads", showRead: false };
    const restored = restoredDraft(roundTrip(draft), DEFAULT_INFO, runtime);
    expect(restored.difficulty).toBe("reads");
    expect(restored.showRead).toBe(false);
    expect(restored.info).toBe(DEFAULT_INFO);
    expect(restored.own).toMatchObject({ mode: "paste", epoch: 2, chosen: PASTE_KEYS.slice(0, 5), otherChosen: ["league-a", "league-b"], pasteDraft: typed });
    expect(Object.keys(restored.own.edits)).toEqual([PASTE_KEYS[0], "league-a"]);
    expect(restored.own.paste).toEqual(own.paste);
    // The same members by the same keys: Choose 6 and the edit apply as before.
    const team = resolveTeam(restored.own, rosterState(OWN_ROSTER, OPPONENT_ROSTER), "own", { status: "idle" }, runtime);
    expect(team.chosen).toEqual(PASTE_KEYS.slice(0, 5));
    expect(team.members[0]?.origin).toBe("edited");
    expect(restored.opponent).toEqual(emptySource());
  });

  it("brings a PokéPaste side without its text back as a League team side as it started, with its league picks", () => {
    const own: TeamSourceDraft = { ...pasteSide(), paste: applied(`${PASTE_TEXT}\n\n${"x".repeat(REMEMBERED_PASTE_MAX)}`) };
    const restored = restoredDraft(roundTrip({ ...createSetupDraft(), own }), DEFAULT_INFO, runtime).own;
    expect(restored).toMatchObject({ mode: "league", epoch: 0, paste: null, pasteDraft: null, chosen: ["league-a", "league-b"], otherChosen: null });
    expect(untouched(restored)).toBe(true);
  });

  it("reads back untrusted: another version is none, a malformed part falls back by itself and the rest is kept", () => {
    for (const value of [null, "x", [], { version: 2 }, {}]) expect(parseStoredSetup(value)).toBeNull();
    const parsed = parseStoredSetup({
      version: 1, difficulty: "hard", showRead: "yes", leagueId: 5, own: "x",
      opponent: {
        mode: "paste", epoch: -1, chosen: "a", otherChosen: ["k1", 2],
        edits: { k1: { build: { speciesId: "Garchomp!" } }, k2: EDIT, k3: { ...EDIT, build: { ...EDIT.build, points: undefined } }, k4: { ...EDIT, moves: EDIT.moves.slice(0, 3) } },
        paste: { id: "evil", text: PASTE_TEXT, title: "t", url: null, format: "champions" },
        pasteDraft: { text: PASTE_TEXT, url: "", title: "t", format: "champions" },
      },
      opponents: { "league-a": "member-x", "": "member-y", "league-b": 7 },
      recent: { "league-a": ["m1", "m1", "m2"], "league-b": "m3", "league-c": ["m1", "m2", "m3", "m4", "m5"] },
      lastTeam: { ownKeys: ["a"], order: [1] },
    })!;
    expect(parsed).toMatchObject({ version: 1, difficulty: "safe", showRead: true, leagueId: null, opponents: { "league-a": "member-x" }, recent: { "league-a": ["m1", "m2"] }, lastTeam: null });
    expect(Object.keys(parsed.opponents)).toEqual(["league-a"]);
    expect(Object.keys(parsed.recent)).toEqual(["league-a"]);
    expect(parsed.own).toEqual({ mode: "league", epoch: 0, chosen: null, otherChosen: null, edits: {}, paste: null, pasteDraft: null });
    expect(parsed.opponent).toMatchObject({ mode: "paste", epoch: 0, chosen: null, otherChosen: null, paste: null, pasteDraft: { text: PASTE_TEXT } });
    expect(Object.keys(parsed.opponent.edits)).toEqual(["k2"]);
    // A team order that repeats a Pokémon is not one.
    const keys = OWN_MEMBERS.map((member) => member.key);
    expect(parseStoredSetup({ version: 1, lastTeam: { ownKeys: keys, order: [1, 1] } })!.lastTeam).toBeNull();
    expect(parseStoredSetup({ version: 1, lastTeam: { ownKeys: keys, order: [3, 1, 5, 2], extra: true } })!.lastTeam).toEqual({ ownKeys: keys, order: [3, 1, 5, 2] });
  });
});

describe("your remembered league picks", () => {
  it("keep the league you picked, each league's opponent (— included, as your pick) and the opponents of your last starts there", () => {
    expect(withLeague(NO_PICKS, "league-a").leagueId).toBe("league-a");
    expect(withLeague({ ...NO_PICKS, leagueId: "league-a" }, "").leagueId).toBe("");
    const same = { ...NO_PICKS, leagueId: "league-a" };
    expect(withLeague(same, "league-a")).toBe(same);
    const picked = withOpponent(withOpponent(NO_PICKS, "league-a", "member-other"), "league-b", "member-x");
    expect(picked.opponents).toEqual({ "league-a": "member-other", "league-b": "member-x" });
    expect(withOpponent(picked, "league-a", "member-other")).toBe(picked);
    const dash = withOpponent(picked, "league-a", "");
    expect(dash.opponents).toEqual({ "league-b": "member-x", "league-a": "" });
    expect(withOpponent(dash, "league-a", "")).toBe(dash);
    expect(withOpponent(NO_PICKS, "league-a", "").opponents).toEqual({ "league-a": "" });
    // Both come back as your picks.
    const back = parseStoredSetup(JSON.parse(JSON.stringify(storedSetupOf(createSetupDraft(), withLeague(dash, ""), null))))!;
    expect(back.leagueId).toBe("");
    expect(back.opponents).toEqual({ "league-b": "member-x", "league-a": "" });
    let played = NO_PICKS;
    for (const id of ["m1", "m2", "m1", "m3", "m4", "m5"]) played = withStart(played, "league-a", id);
    expect(played.recent["league-a"]).toEqual(["m5", "m4", "m3", "m1"].slice(0, RECENT_OPPONENTS));
    expect(withStart(played, "", "m1")).toBe(played);
    // At most 50 leagues: the latest picked stay.
    let many = NO_PICKS;
    for (let index = 0; index < 51; index++) many = withOpponent(many, `league-${index}`, "member-x");
    expect(Object.keys(many.opponents)).toHaveLength(50);
    expect(many.opponents["league-0"]).toBeUndefined();
  });
});

let document: FakeDocument;
let root: { render(node: unknown): void; unmount(): void };
let createRoot: typeof import("react-dom/client").createRoot;
let useRememberedPicks: typeof UseRememberedPicks;
let TeamSetup: typeof TeamSetupType;

beforeAll(async () => {
  document = installFakeDom();
  ({ createRoot } = await import("react-dom/client"));
  ({ useRememberedPicks } = await import("@/app/(app)/training/setup/useRememberedPicks"));
  TeamSetup = (await import("@/app/(app)/training/setup/TeamSetup")).default;
});
afterAll(async () => { await act(async () => { root?.unmount(); }); });
async function mount() {
  await act(async () => { root?.unmount(); });
  root = createRoot(document.body.appendChild(document.createElement("div")) as unknown as Element) as unknown as typeof root;
}

type Rosters = Parameters<typeof UseRememberedPicks>[0];
/** The rosters the hook returns (what the page's pickers call). */
let returned: Rosters | null = null;
const keepReturned = (rosters: Rosters) => { returned = rosters; };
function Harness({ rosters, picks, session, onRosters = keepReturned }: {
  rosters: Rosters; picks: SetupPicks | null; session: Parameters<typeof UseRememberedPicks>[2]; onRosters?: (rosters: Rosters) => void;
}) {
  const result = useRememberedPicks(rosters, picks, session);
  useEffect(() => { onRosters(result); }, [onRosters, result]);
  return null;
}
const BETA = { id: "league-b", name: "Beta", memberId: "member-own-b", teamName: "Home", draftStarted: true, draftCompleted: true };
const twoLeagues = (patch: Partial<CalculatorRosterState> = {}): CalculatorRosterState => {
  const base = rosterState(OWN_ROSTER, OPPONENT_ROSTER);
  return { ...base, leagues: [...base.leagues, BETA], opponentId: "", ...patch };
};

describe("the league Training restores", () => {
  const session = () => ({ rememberLeague: vi.fn(), rememberOpponent: vi.fn() });
  const rostersWith = (state: CalculatorRosterState) => ({ state, selectLeague: vi.fn(), selectOpponent: vi.fn(), refresh: vi.fn() });
  const remembered = (leagueId: string | null, userId = "user-1"): SetupPicks => ({ ...picksOf(userId, null), leagueId });

  it("is the league you last picked, once per mount and account, after your picks are read; one no longer yours is ignored", async () => {
    await mount();
    const actions = session();
    const rosters = rostersWith(twoLeagues());
    const show = (state: CalculatorRosterState, picks: SetupPicks | null) => act(async () => { root.render(createElement(Harness, { rosters: { ...rosters, state }, picks, session: actions })); });
    await show(twoLeagues({ status: "loading" }), remembered("league-b"));
    await show(twoLeagues(), null);
    await show(twoLeagues(), remembered("league-b", "user-2"));
    expect(rosters.selectLeague).not.toHaveBeenCalled();
    await show(twoLeagues(), remembered("league-b"));
    expect(rosters.selectLeague).toHaveBeenCalledExactlyOnceWith("league-b");
    // Back to the first league (your pick there, or the rosters'): it stays this mount.
    await show(twoLeagues(), remembered("league-b"));
    expect(rosters.selectLeague).toHaveBeenCalledOnce();
    // Another account: its own league once; a league it no longer has stays unselected.
    await show(twoLeagues({ userId: "user-2" }), remembered("league-gone", "user-2"));
    expect(rosters.selectLeague).toHaveBeenCalledOnce();
    // A new mount (a tab switch: the rosters start over) restores it again.
    await mount();
    await show(twoLeagues(), remembered("league-b"));
    expect(rosters.selectLeague).toHaveBeenCalledTimes(2);
    expect(actions.rememberLeague).not.toHaveBeenCalled();
  });

  it("restores your — league as your pick", async () => {
    await mount();
    const rosters = rostersWith(twoLeagues());
    await act(async () => { root.render(createElement(Harness, { rosters, picks: remembered(""), session: session() })); });
    expect(rosters.selectLeague).toHaveBeenCalledExactlyOnceWith("");
  });

  it("remembers your own league and opponent picks, and never restores over a league you picked first", async () => {
    await mount();
    const actions = session();
    const rosters = rostersWith(twoLeagues());
    const show = (picks: SetupPicks | null) => act(async () => { root.render(createElement(Harness, { rosters, picks, session: actions })); });
    await show(null);
    returned!.selectLeague("league-a");
    expect(actions.rememberLeague).toHaveBeenCalledExactlyOnceWith("league-a");
    expect(rosters.selectLeague).toHaveBeenCalledExactlyOnceWith("league-a");
    await show(remembered("league-b"));
    expect(rosters.selectLeague).toHaveBeenCalledOnce();
    returned!.selectOpponent("member-other");
    expect(actions.rememberOpponent).toHaveBeenCalledExactlyOnceWith("league-a", "member-other");
    expect(rosters.selectOpponent).toHaveBeenCalledExactlyOnceWith("member-other");
    returned!.selectOpponent("");
    expect(actions.rememberOpponent).toHaveBeenLastCalledWith("league-a", "");
  });
});

describe("an account without leagues", () => {
  const NO_LEAGUES: CalculatorRosterState = { ...createRosterState(), status: "ready", userId: "user-1" };
  const actions = () => new Proxy({} as Record<string | symbol, ReturnType<typeof vi.fn>>, { get: (target, key) => (target[key] ??= vi.fn()) });
  async function show(state: CalculatorRosterState, picks: SetupPicks | null, draft: SetupDraft) {
    const session = actions();
    const snapshot: TrainingSnapshot = { ...initialSnapshot(), engine: { status: "ready" }, draft, picks };
    await act(async () => {
      root.render(createElement(TeamSetup, { runtime, rosters: { state, selectLeague() {}, selectOpponent() {}, refresh() {} }, snapshot, session: session as never }));
    });
    const calls = session.updateDraft.mock.calls as [(draft: SetupDraft) => SetupDraft][];
    return calls.reduce((current, [update]) => update(current), draft);
  }

  it("opens each side as it started on PokéPaste once its remembered setup is read; a side you changed and League team stay", async () => {
    await mount();
    const draft = createSetupDraft();
    expect(await show(NO_LEAGUES, null, draft)).toBe(draft);
    expect(await show(rosterState(OWN_ROSTER, OPPONENT_ROSTER), picksOf("user-1", null), draft)).toBe(draft);
    const opened = await show(NO_LEAGUES, picksOf("user-1", null), draft);
    expect(opened.own).toMatchObject({ mode: "paste", epoch: 1, paste: null });
    expect(opened.opponent).toMatchObject({ mode: "paste", epoch: 1, paste: null });
    // Back to League team (or anything typed): the side is no longer as it started, so it stays.
    const back: SetupDraft = { ...draft, own: { ...emptySource(), epoch: 2 }, opponent: { ...emptySource(), pasteDraft: { text: "G", url: "", title: "", format: "champions" } } };
    expect(await show(NO_LEAGUES, picksOf("user-1", null), back)).toBe(back);
    await act(async () => { root.render(null); });
  });
});

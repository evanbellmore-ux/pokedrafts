import { describe, expect, it } from "vitest";
import { parseTeamImport } from "@/app/lib/battle/team-import";
import type { DoublesSlotId } from "@/app/lib/battle/doubles-types";
import { readNames } from "@/app/(app)/training/ai/engine-provider";
import { aiCandidates } from "@/app/(app)/training/ai/candidates";
import { createHabitModel } from "@/app/(app)/training/ai/habits";
import { atHitSnapshot } from "@/app/(app)/training/ai/belief/likelihood";
import { sameSpread } from "@/app/(app)/training/ai/belief/prior";
import { readFacts, readReason } from "@/app/(app)/training/ai/reveal";
import { damageRows, worthOf } from "@/app/(app)/training/ai/rows";
import { undominated } from "@/app/(app)/training/ai/solve";
import { stateValue, valueWeights } from "@/app/(app)/training/ai/value";
import { buildMoveAction, slotOptions } from "@/app/(app)/training/actions/choice-builder";
import type { DecisionProvider, SlotContext } from "@/app/(app)/training/model/decision";
import { CLOSED_TEAM_SHEETS, DEFAULT_INFO, OPEN_TEAM_SHEETS, PERFECT_INFORMATION } from "@/app/(app)/training/model/info";
import type { FromWorker } from "@/app/(app)/training/model/worker-protocol";
import type { DecisionOption, DecisionReport, ReadRefs, SlotAction, TrainingSetup } from "@/app/(app)/training/model/view-types";
import { buildBeliefBattle } from "@/app/(app)/training/sim/belief-battle";
import { toShowdownTeam } from "@/app/(app)/training/sim/showdown-set";
import { asBaseForm, emptySource, megaBase, teamCandidates } from "@/app/(app)/training/setup/team-draft";
import { createStubProvider } from "@/app/(app)/training/worker/stub-provider";
import { redactReport, type RedactContext } from "@/app/(app)/training/worker/redact-report";
import { createTrainingWorker } from "@/app/(app)/training/worker/worker-handler";
import { makeView, postOf, publicMon, publicState, runtime, type MonSpec } from "../fixtures/training-ai";
import { boardView, buildOf, moveRequest, rosterState } from "../fixtures/training";
import { AI, AI_TEAM, memberFromSet, PLAYER_TEAM, seatBattle } from "./training-sim-fixtures";

// Regressions for the review findings fixed after integration (scripts/.cache/training/review-{sim-info,ai,ui}/).

const move = (moveId: string, target: DoublesSlotId | null = null): Extract<SlotAction, { kind: "move" }> => ({ kind: "move", moveId, target });
const flush = async (times = 8) => { for (let i = 0; i < times; i++) await new Promise((resolve) => setTimeout(resolve, 0)); };
const refs = (patch: Partial<ReadRefs> = {}): ReadRefs => ({ inSlot: [], incoming: [], moves: [], stats: false, ...patch });
const report = (patch: Partial<DecisionReport>): DecisionReport => ({
  turn: 3, provider: "engine", difficulty: "safe", predicted: [], strategy: [], chosen: 0, actual: { chance: null }, reason: null, mega: null,
  assumed: [], elapsedMs: 0, evaluated: { yours: 6, its: 10 }, ...patch,
});

describe("forfeit (G5)", () => {
  it("keeps the AI's choice and read of a turn that never ran in the worker", async () => {
    const stub = createStubProvider(null);
    const provider: DecisionProvider = {
      ...stub,
      async chooseTurn(context, options) {
        const decision = await stub.chooseTurn(context, options);
        return { ...decision, report: { ...decision.report, reason: "Predicted Protect (90%).", facts: { reasons: [{ text: "Predicted Protect (90%).", refs: refs() }], mega: [] } } };
      },
    };
    const posted: FromWorker[] = [];
    let hex = 0;
    const worker = createTrainingWorker({ post: (message) => posted.push(structuredClone(message)), createProvider: () => provider, now: () => 0, randomHex: () => (++hex).toString(16).padStart(32, "0"), deadlineMs: null });
    const battles = () => posted.filter((m): m is Extract<FromWorker, { type: "battle" }> => m.type === "battle");
    const setup: TrainingSetup = { own: PLAYER_TEAM, opponent: AI_TEAM, difficulty: "safe", showRead: true, info: DEFAULT_INFO };
    worker.receive({ type: "start", battleId: 1, setup, habits: null });
    await flush();
    worker.receive({ type: "choose", battleId: 1, requestId: battles().at(-1)!.request!.id, choice: { kind: "team", order: [1, 2, 3, 4] } });
    await flush();
    const turn1 = battles().at(-1)!.request!;
    expect(turn1.kind).toBe("move");
    expect(posted.some((m) => m.type === "ai" && m.requestId === turn1.id && m.status === "locked")).toBe(true);
    worker.receive({ type: "forfeit", battleId: 1 });
    await flush();
    expect(battles().at(-1)!.ended).toMatchObject({ forfeited: true });
    const entries = battles().flatMap((m) => m.log).filter((turn) => turn.turn === 1);
    expect(entries.every((turn) => turn.read === null && turn.actions === null)).toBe(true);
  });
});

describe("the read's sentences and Mega facts as you may see them", () => {
  const state = publicState([
    publicMon("p2", "gyarados", "gyarados", 1, { status: "slp", movesUsed: { waterfall: 1 }, switchIns: 1 }),
    publicMon("p2", "charizard", "charizard", 0, { movesUsed: { heatwave: 1 }, switchIns: 1 }),
  ], 3);
  const ctx = (youSee = CLOSED_TEAM_SHEETS, shown: RedactContext["shownMembers"] = { "opponent-left": "gyarados", "opponent-right": "charizard" }): RedactContext =>
    ({ state, youSee, slotMembers: { "opponent-left": "gyarados", "opponent-right": "charizard" }, shownMembers: shown });
  const protectFact = { text: "Predicted Thunderbolt into Gyarados (100%), so Gyarados protected.", refs: refs({ inSlot: [{ memberKey: "gyarados", slot: "opponent-left" }], moves: [{ memberKey: "gyarados", moveId: "protect" }] }) };
  const topFact = { text: "Predicted Thunderbolt and Knock Off (100%).", refs: refs() };

  it("leaves out a sentence that names a move your log never showed and states the next one", () => {
    const redacted = redactReport(report({ reason: protectFact.text, facts: { reasons: [protectFact, topFact], mega: [] } }), ctx());
    expect(redacted.reason).toBe(topFact.text);
    expect(redacted.facts).toBeUndefined();
    // Moves open: Protect is on the sheet you see.
    expect(redactReport(report({ reason: protectFact.text, facts: { reasons: [protectFact, topFact], mega: [] } }), ctx(OPEN_TEAM_SHEETS)).reason).toBe(protectFact.text);
    // Without its facts a sentence is not shown.
    expect(redactReport(report({ reason: protectFact.text }), ctx(OPEN_TEAM_SHEETS)).reason).toBeNull();
  });

  it("hides a slot your log shows as another Pokémon (Illusion): its moves and the sentences naming it", () => {
    const disguised = ctx(OPEN_TEAM_SHEETS, { "opponent-left": "archaludon", "opponent-right": "charizard" });
    const strategy: DecisionOption[] = [{ action: { "opponent-left": move("waterfall", "own-left"), "opponent-right": move("heatwave") }, chance: 1 }];
    const redacted = redactReport(report({ strategy, reason: protectFact.text, facts: { reasons: [protectFact], mega: [] } }), disguised);
    expect(redacted.strategy).toEqual([{ action: null, chance: 1 }]);
    expect(redacted.reason).toBeNull();
  });

  it("states a Speed or KO-chance Mega fact only with Stat Points and Natures open", () => {
    const speed = { memberKey: "charizard", evolved: false, moves: [], text: "Kept Mega Evolution: Charizard-Mega-Y would move after Hydreigon.", refs: refs({ inSlot: [{ memberKey: "charizard", slot: "opponent-right" }], stats: true }) };
    const plain = { memberKey: "charizard", evolved: false, moves: [], text: "Kept Mega Evolution.", refs: refs({ inSlot: [{ memberKey: "charizard", slot: "opponent-right" }] }) };
    const both = report({ mega: speed, facts: { reasons: [], mega: [speed, plain] } });
    expect(redactReport(both, ctx(OPEN_TEAM_SHEETS)).mega?.text).toBe("Kept Mega Evolution.");
    const allOpen = { ...OPEN_TEAM_SHEETS, open: { ...OPEN_TEAM_SHEETS.open, statPoints: true } };
    expect(redactReport(both, ctx(allOpen)).mega?.text).toBe(speed.text);
  });

  it("puts each named move's own chance in the sentence", () => {
    const dragonite: MonSpec = { side: "opponent", species: "dragonite", slot: "opponent-left", moves: ["extremespeed", "dragonclaw", "protect", "firepunch"], ability: "multiscale", item: "lifeorb", nature: "Adamant", points: { atk: 32, spe: 32 } };
    const partner: MonSpec = { side: "opponent", species: "incineroar", slot: "opponent-right", moves: ["fakeout", "flareblitz", "knockoff", "protect"], ability: "intimidate", item: "sitrusberry", nature: "Careful", points: { hp: 32, spd: 32 } };
    const gholdengo: MonSpec = { side: "own", species: "kingambit", slot: "own-left", moves: ["kowtowcleave", "suckerpunch", "ironhead", "protect"], ability: "defiant", item: "blackglasses", nature: "Adamant", points: { hp: 32, atk: 32 } };
    const chien: MonSpec = { side: "own", species: "glimmora", slot: "own-right", moves: ["powergem", "sludgebomb", "earthpower", "protect"], ability: "toxicdebris", item: "focussash", nature: "Modest", points: { spa: 32, spe: 32 } };
    const view = makeView([dragonite, partner, gholdengo, chien]);
    const rows = damageRows(view, runtime);
    const q: DecisionOption[] = [
      { action: { "own-left": move("ironhead", "opponent-left"), "own-right": move("protect") }, chance: 0.5 },
      { action: { "own-left": move("protect"), "own-right": move("powergem", "opponent-left") }, chance: 0.5 },
    ];
    const text = readReason({ view, rows, q, chosen: { "opponent-left": { kind: "switch", to: "incineroar" }, "opponent-right": move("fakeout", "own-left") }, names: readNames(view, runtime), runtime });
    expect(text).toMatch(/^Predicted (Iron Head|Power Gem) into Dragonite \(50%\)/);
    const facts = readFacts({ view, rows, q, chosen: { "opponent-left": move("protect"), "opponent-right": move("fakeout", "own-left") }, names: readNames(view, runtime), runtime });
    expect(facts.every((fact) => fact.refs.inSlot.every((entry) => entry.slot.startsWith("opponent")))).toBe(true);
  });
});

describe("test extras", () => {
  it("exact HP covers the members the AI has seen; with brought Pokémon on, all four", () => {
    const seat = seatBattle([1, 2, 3, 4]);
    seat.step("team 1234", "team 1234");
    const exactOnly = seat.inputs({ ...OPEN_TEAM_SHEETS, exactHP: true });
    const seen = Object.values(exactOnly.public.mons).filter((mon) => mon.side === "p1" && mon.switchIns > 0).map((mon) => mon.key).sort();
    expect(Object.keys(exactOnly.reveals.exactHP ?? {}).sort()).toEqual(seen);
    expect(seen).toHaveLength(2);
    expect(Object.keys(seat.inputs(PERFECT_INFORMATION).reveals.exactHP ?? {})).toHaveLength(4);
  });

  it("exact HP fits a believed maximum other than the real one", () => {
    const seat = seatBattle([5, 6, 7, 8]);
    seat.step("team 1234", "team 1234");
    const inputs = seat.inputs(PERFECT_INFORMATION);
    const truth = seat.truthWorld();
    const world = { ...truth, sets: Object.fromEntries(Object.entries(truth.sets).map(([key, set]) => [key, { ...set, evs: { ...set.evs, hp: 0 } }])) };
    const built = buildBeliefBattle(inputs, world, runtime);
    for (const pokemon of built.battle.p1.pokemon) expect(pokemon.hp).toBeLessThanOrEqual(pokemon.maxhp);
  });
});

describe("the AI's own Zoroark (Illusion)", () => {
  it("files the disguised Pokémon's stint under its real member, by its request", () => {
    const zoroark = { name: "Zoroark", species: "Zoroark", item: "Black Glasses", ability: "Illusion", moves: ["Night Daze", "Sucker Punch", "Protect", "Flamethrower"], nature: "Timid",
      evs: { hp: 2, atk: 0, def: 0, spa: 32, spd: 0, spe: 32 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 50, gender: "" };
    const opponent = toShowdownTeam([zoroark, AI[1], AI[0], AI[3], AI[4], AI[5]].map((set) => memberFromSet(set as typeof AI[number])), runtime);
    const seat = seatBattle([1, 1, 1, 1], { opponent });
    seat.step("team 1234", "team 1234");
    const inputs = seat.inputs(OPEN_TEAM_SHEETS);
    expect(inputs.public.mons["p2:zoroark"]).toMatchObject({ position: 0, speciesId: "zoroark" });
    const imitated = Object.values(inputs.public.mons).filter((mon) => mon.side === "p2" && mon.position !== null).map((mon) => mon.key);
    expect(imitated).not.toContain(`p2:${opponent.sets[3].key}`);
  });
});

describe("Setup's Mega-form members", () => {
  it("battle and read as the base species holding the stone", () => {
    expect(megaBase("charizardmegay", runtime)).toEqual({ speciesId: "charizard", stone: "charizarditey" });
    expect(megaBase("charizard", runtime)).toBeNull();
    const build = asBaseForm({ ...buildOf("charizardmegay"), abilityId: "drought" }, runtime);
    expect(build).toMatchObject({ speciesId: "charizard", itemId: "charizarditey" });
    expect(runtime.speciesById.get("charizard")!.abilities).toContain(build.abilityId);
    const league = teamCandidates(emptySource(), rosterState(["Mega Charizard Y", "Garchomp"], ["Absol"]), "own", runtime).candidates;
    const zard = league.find((candidate) => candidate.suggest?.itemId);
    expect(zard).toMatchObject({ name: "Charizard", speciesId: "charizard", suggest: { speciesId: "charizard", itemId: "charizarditey" } });
    const text = "Charizard-Mega-Y @ Charizardite Y\nAbility: Drought\nLevel: 50\nTimid Nature\n- Heat Wave\n- Protect\n";
    const paste = teamCandidates({ ...emptySource(), mode: "paste", paste: { id: "own-1", title: "Paste", url: null, text, team: parseTeamImport(text, "champions", runtime) } }, rosterState([], []), "own", runtime).candidates;
    expect(paste[0]).toMatchObject({ name: "Charizard", speciesId: "charizard" });
    expect(paste[0].imported?.build).toMatchObject({ speciesId: "charizard", itemId: "charizarditey" });
  });

  it("shows the calculator's roster messages, which are facts", () => {
    const state = rosterState(["Garchomp", "Garchomp"], ["Absol"]);
    expect(teamCandidates(emptySource(), state, "own", runtime).candidates.map((candidate) => candidate.reason)).toEqual(["Duplicate roster name.", "Duplicate roster name."]);
    const message = (patch: Partial<typeof state>, role: "own" | "opponent" = "own") => teamCandidates(emptySource(), { ...state, ...patch }, role, runtime).message;
    expect(message({ selectedLeagueId: "" })).toBe("No team chosen.");
    expect(message({ selectedLeagueId: "", leagues: [] })).toBe("No leagues.");
    expect(message({ opponentId: "" }, "opponent")).toBe("No opponent chosen.");
    expect(message({ teamsStatus: "error" })).toBe("Could not load this league's teams.");
    expect(message({ opponentId: "member-gone" }, "opponent")).toBe("This team is no longer available.");
    expect(message({ data: { ...state.data!, teams: [...state.data!.teams, state.data!.teams[0]] } })).toBe("Multiple rosters were returned for this team.");
  });
});

describe("a locked move", () => {
  it("asks for no target (the request entry has none)", () => {
    const request = moveRequest();
    request.active[0] = { moves: [{ move: "Solar Beam", id: "solarbeam" }], trapped: true };
    const board = boardView();
    const options = slotOptions(request, board, 0, runtime);
    expect(options.moves[0]).toMatchObject({ id: "solarbeam", locked: true, rule: { kind: "none" } });
    const built = buildMoveAction(request, board, [{ choice: { kind: "move", moveId: "solarbeam" }, target: null, mega: null }, { choice: { kind: "move", moveId: "protect" }, target: null, mega: null }], runtime);
    expect(built).toEqual({ action: expect.objectContaining({ "own-left": { kind: "move", moveId: "solarbeam", target: null } }) });
  });
});

describe("AI play", () => {
  const venusaur: MonSpec = { side: "opponent", species: "talonflame", slot: "opponent-left", moves: ["tailwind", "bravebird", "protect", "roost"], ability: "galewings", item: "sharpbeak", nature: "Jolly", points: { atk: 32, spe: 32 } };
  const partner: MonSpec = { side: "opponent", species: "rotomheat", slot: "opponent-right", moves: ["overheat", "thunderbolt", "voltswitch", "willowisp"], ability: "levitate", item: "choicescarf", nature: "Timid", points: { spa: 32, spe: 32 } };
  const garchomp: MonSpec = { side: "own", species: "garchomp", slot: "own-left", moves: ["earthquake", "dragonclaw", "rockslide", "protect"], ability: "roughskin", item: "lifeorb", nature: "Jolly", points: { atk: 32, spe: 32 } };
  const kingambit: MonSpec = { side: "own", species: "kingambit", slot: "own-right", moves: ["kowtowcleave", "suckerpunch", "ironhead", "protect"], ability: "defiant", item: "blackglasses", nature: "Adamant", points: { hp: 32, atk: 32 } };

  it("scores moves that fail now below every other option (Tailwind up, Roost at full HP)", () => {
    const priors = (tailwindUp: boolean) => {
      const view = makeView([venusaur, partner, garchomp, kingambit]);
      if (tailwindUp) { view.clock.sides.opponent.tailwind = 2; view.field.defenderSide.tailwind = true; }
      const rows = damageRows(view, runtime);
      const candidates = aiCandidates(view, rows, worthOf(view, rows, runtime), runtime);
      const uses = (moveId: string) => (candidate: (typeof candidates)[number]) => candidate.action["opponent-left"]?.kind === "move" && (candidate.action["opponent-left"] as { moveId: string }).moveId === moveId;
      const top = (list: typeof candidates) => Math.max(-Infinity, ...list.map((candidate) => candidate.prior));
      return { tailwind: top(candidates.filter(uses("tailwind"))), roost: top(candidates.filter(uses("roost"))), braveBird: top(candidates.filter(uses("bravebird"))) };
    };
    const up = priors(true), down = priors(false);
    expect(up.tailwind).toBeLessThan(up.braveBird);
    expect(up.tailwind).toBeLessThan(down.tailwind);
    expect(down.roost).toBeLessThan(down.braveBird);
  });

  it("weighs a Choice Scarf holder's status move below its attacks", () => {
    const view = makeView([venusaur, partner, garchomp, kingambit]);
    const rows = damageRows(view, runtime);
    const candidates = aiCandidates(view, rows, worthOf(view, rows, runtime), runtime);
    const wisp = candidates.filter((candidate) => candidate.action["opponent-right"]?.kind === "move" && (candidate.action["opponent-right"] as { moveId: string }).moveId === "willowisp");
    const best = candidates[0];
    for (const each of wisp) expect(each.prior).toBeLessThan(best.prior);
  });

  it("values a KO above leaving a crippled foe standing", () => {
    const foe: MonSpec = { ...kingambit, hp: 0.3, boosts: { atk: -2 } };
    const view = makeView([venusaur, partner, garchomp, foe]);
    const rows = damageRows(view, runtime);
    const worth = worthOf(view, rows, runtime);
    const ctx = { weights: valueWeights(), worth, runtime, field: view.field, rows, particles: view.particles, view };
    const alive = stateValue(postOf(view), ctx);
    const ko = stateValue(postOf(view, (post) => { const mon = post.mons.find((each) => each.key === "own:kingambit")!; mon.hp = [{ hp: 0, chance: 1 }]; }), ctx);
    expect(ko).toBeGreaterThan(alive);
  });

  it("moves a dominated row's weight to the row that dominates it", () => {
    const M = [[1, 2], [1, 3], [0, 5]];
    expect(undominated(M, [0.39, 0.61, 0])).toEqual([0, 1, 0]);
    expect(undominated(M, [0, 0.5, 0.5])).toEqual([0, 0.5, 0.5]);
  });

  it("habits learn which of the AI's positions you aim at", () => {
    const habit = createHabitModel(null);
    const slots: Partial<Record<DoublesSlotId, SlotContext>> = {
      "own-left": {
        speciesId: "garchomp", features: { hp: "high", threatened: false, protectedLast: false }, canMega: false,
        classes: { "move:dragonclaw:opponent-left": { cls: "attack-other", target: "other" }, "move:dragonclaw:opponent-right": { cls: "attack-other", target: "other" } },
      },
    };
    const question = { kind: "turn" as const, turn: 1, options: [], slots };
    for (let turn = 1; turn <= 6; turn++) {
      habit.observeTurn({ turn, question, observed: { "own-left": { kind: "move", moveId: "dragonclaw", targetKey: "p2:x", spread: false } }, observedMega: null, opponent: {} },
        { targetSlot: () => "opponent-right" });
    }
    const chances = habit.slotPrediction(slots);
    expect(chances['own-left=move:dragonclaw:opponent-right']).toBeGreaterThan(2 * chances['own-left=move:dragonclaw:opponent-left']);
    // A move aimed at itself (Protect) is no aim; one into its partner is.
    habit.observeTurn({ turn: 7, question, observed: { "own-left": { kind: "move", moveId: "protect", targetKey: "p1:x", spread: false } }, observedMega: null, opponent: {} },
      { targetSlot: () => "own-left", classify: () => ({ cls: "protect", target: null }) });
    expect(JSON.stringify(habit.data().aims)).not.toContain("ally");
  });
});

describe("belief", () => {
  it("does not apply an item the log showed gone before the hit", () => {
    const build = { ...buildOf("hydreigon"), itemId: "lifeorb" };
    const snapshot = { key: "p2:hydreigon", speciesId: "hydreigon", boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, accuracy: 0, evasion: 0 }, status: "" as const, hp: { hp: 100, maxhp: 167 } };
    expect(atHitSnapshot(build, snapshot, runtime).itemId).toBe("lifeorb");
    expect(atHitSnapshot(build, { ...snapshot, itemGone: true }, runtime).itemId).toBe("");
  });
  it("treats spreads one Stat Point apart (same nature and Speed) as one", () => {
    const a = { nature: "Adamant", points: { hp: 2, atk: 32, def: 0, spa: 0, spd: 0, spe: 32 } };
    expect(sameSpread(a, { nature: "Adamant", points: { hp: 1, atk: 32, def: 1, spa: 0, spd: 0, spe: 32 } })).toBe(true);
    expect(sameSpread(a, { nature: "Jolly", points: a.points })).toBe(false);
    expect(sameSpread(a, { nature: "Adamant", points: { hp: 4, atk: 32, def: 0, spa: 0, spd: 0, spe: 30 } })).toBe(false);
  });
});

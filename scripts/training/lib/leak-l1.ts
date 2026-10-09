// SPEC §14.4 L1 (the AI's direction): pairs of battles that differ in one hidden field, replayed with the same choices.
import { createHash } from "node:crypto";
import { PRNG, type Battle } from "@pokedrafts/showdown-sim";
import { championsRuntime as runtime } from "@/app/lib/battle/runtime";
import type { BattleBuild } from "@/app/lib/battle/types";
import type { AiInputs } from "@/app/(app)/training/model/ai-inputs";
import type { CellActions, TurnServices } from "@/app/(app)/training/model/ai-view";
import type { WorkBudget } from "@/app/(app)/training/model/decision";
import { DEFAULT_INFO, OPEN_TEAM_SHEETS, type InfoSettings, type InfoView } from "@/app/(app)/training/model/info";
import type { SideID } from "@/app/(app)/training/model/showdown-types";
import type { TrainingMember, TrainingTeam } from "@/app/(app)/training/model/view-types";
import { loadTrainingUsage } from "@/app/(app)/training/usage/training-usage";
import { needsPrelude } from "@/app/(app)/training/sim/bridge";
import { fixtureById } from "@/tests/fixtures/training-teams";
import { runMatch, type DecisionRecord, type MatchResult } from "./match";
import { createSeat, ensureSeats, type SeatName } from "./providers";
import { realBattle } from "./oracle";
import { teamOf } from "./teams";

type Variant = (team: TrainingTeam) => TrainingTeam;
export type Field = {
  id: string; info: InfoSettings;
  /** Team B from team A (p1 = the player's side). */
  variant?: Variant;
  /** p1 team preview orders A and B (L1-bench). */
  preview?: { a: number[]; b: number[] };
  /** Change the real battle of B before the AI's ordinal-th decision (L1-hp, L1-dice). */
  mutate?: (battle: Battle, ordinal: number) => boolean;
  /** B's p1 choice at the decision differs (L1-choice). */
  choice?: boolean;
  /** The setting that must make A and B differ (inputs JSON) at a compared decision. */
  mustDiffer?: boolean;
  /** The player's team and the opponents' (default PLAYER, OPPONENTS). */
  player?: string;
  opponents?: readonly string[];
};

const withMember = (team: TrainingTeam, speciesId: string, change: (member: TrainingMember) => TrainingMember): TrainingTeam =>
  ({ ...team, members: team.members.map((member) => member.speciesId === speciesId ? change(structuredClone(member)) : member) });
const withBuild = (team: TrainingTeam, speciesId: string, change: (build: BattleBuild) => BattleBuild) => withMember(team, speciesId, (member) => ({ ...member, build: change(member.build) }));
const points = (hp: number, atk: number, def: number, spa: number, spd: number, spe: number) => ({ hp, atk, def, spa, spd, spe });
const closed = (field: keyof InfoView["open"]): InfoSettings => ({ aiKnows: { ...OPEN_TEAM_SHEETS, open: { ...OPEN_TEAM_SHEETS.open, [field]: false } }, youSee: OPEN_TEAM_SHEETS });

/** The player's team for L1 (V01's Garchomp holds Life Orb; Rough Skin; its fourth move is Protect). */
const PLAYER = "V01";
const OPPONENTS = ["V02", "V04", "V06", "V08", "V10", "V12", "U01", "U03", "A02", "A05", "S01", "S04"];

export function l1Fields(): Field[] {
  const garchomp = "garchomp";
  return [
    { id: "sp", info: DEFAULT_INFO, variant: (team) => withBuild(team, garchomp, (build) => ({ ...build, points: points(32, 32, 0, 0, 2, 0) } as BattleBuild)) },
    { id: "sp-open", info: { aiKnows: { ...OPEN_TEAM_SHEETS, open: { ...OPEN_TEAM_SHEETS.open, statPoints: true } }, youSee: OPEN_TEAM_SHEETS }, mustDiffer: true,
      variant: (team) => withBuild(team, garchomp, (build) => ({ ...build, points: points(32, 32, 0, 0, 2, 0) } as BattleBuild)) },
    { id: "nature", info: closed("natures"), variant: (team) => withBuild(team, garchomp, (build) => ({ ...build, nature: "Adamant" })) },
    { id: "item", info: closed("items"), variant: (team) => withBuild(team, garchomp, (build) => ({ ...build, itemId: "expertbelt" })) },
    { id: "ability", info: closed("abilities"), variant: (team) => withBuild(team, garchomp, (build) => ({ ...build, abilityId: "sandveil" })) },
    { id: "moves", info: closed("moves"), variant: (team) => withMember(team, garchomp, (member) => ({ ...member, moves: [member.moves[0], member.moves[1], member.moves[2], { moveId: "swordsdance", origin: "imported", gameType: "Doubles" }] })) },
    // Brought {1,2,3,4} vs {1,2,3,5}: the third and fourth are never sent in while the histories match.
    { id: "bench", info: DEFAULT_INFO, preview: { a: [1, 2, 3, 4], b: [1, 2, 3, 5] } },
    { id: "hp", info: DEFAULT_INFO, mutate: sameShownHP },
    { id: "hp-exact", info: { aiKnows: { ...OPEN_TEAM_SHEETS, exactHP: true }, youSee: OPEN_TEAM_SHEETS }, mutate: sameShownHP, mustDiffer: true },
    { id: "dice", info: DEFAULT_INFO, mutate: redrawDice },
    // Pool E (status-eot EOT-5): Substitutes after a hit, Binding Band traps, Ally Switch, Trick, Leech Seed, Wish, Yawn,
    // Future Sight on both sides, with the hidden counters redrawn as for "dice".
    { id: "dice-eot", info: DEFAULT_INFO, mutate: redrawDice, player: "E01", opponents: ["E02", "E02", "V02", "V04", "A08"] },
    { id: "choice", info: DEFAULT_INFO, choice: true },
  ];
}

/** A damaged p1 active gets another HP that Showdown shows the same (its getHealth().shared, sim/pokemon.ts getHealth). */
function sameShownHP(battle: Battle, ordinal: number): boolean {
  if (ordinal < 1) return false;
  for (const pokemon of battle.p1.active) {
    if (!pokemon || pokemon.fainted || pokemon.hp >= pokemon.maxhp) continue;
    const writable = pokemon as unknown as { hp: number };
    const before = pokemon.hp, shown = pokemon.getHealth().shared;
    for (const delta of [1, -1, 2, -2, 3, -3]) {
      if (before + delta <= 0 || before + delta >= pokemon.maxhp) continue;
      writable.hp = before + delta;
      if (pokemon.getHealth().shared === shown) return true;
      writable.hp = before;
    }
  }
  return false;
}
/**
 * A new PRNG and other hidden counters on every Pokémon that has them: sleep and confusion turns, Champions freeze turns,
 * a partial trap's turns left, and a Substitute's HP (no -activate line shows its HP after a hit: status-eot EOT-5).
 */
function redrawDice(battle: Battle, ordinal: number): boolean {
  if (ordinal < 1) return false;
  (battle as unknown as { prng: PRNG }).prng = new PRNG(`sodium,${"9".repeat(32)}`);
  for (const pokemon of battle.getAllActive()) {
    const writable = pokemon as unknown as { statusState: { time?: number }; volatiles: Record<string, { time?: number; duration?: number; hp?: number }> };
    if ((pokemon.status === "slp" || pokemon.status === "frz") && typeof writable.statusState.time === "number") writable.statusState.time = writable.statusState.time === 1 ? 2 : 1;
    const confusion = writable.volatiles.confusion;
    if (confusion && typeof confusion.time === "number") confusion.time = confusion.time === 1 ? 3 : 1;
    const trap = writable.volatiles.partiallytrapped;
    if (trap && typeof trap.duration === "number") trap.duration = trap.duration > 2 ? trap.duration - 1 : trap.duration + 1;
    const substitute = writable.volatiles.substitute;
    if (substitute && typeof substitute.hp === "number") substitute.hp = substitute.hp > 1 ? substitute.hp - 1 : substitute.hp + 1;
  }
  return true;
}

/**
 * The engine inputs the AI's services bridge for up to four cells that need no prelude (calculateDoublesOutcomes' input:
 * carried state, last moves, positions, Substitute HP), hashed, so L1 also compares what reaches the engine (EOT-5). The
 * services memoise each cell, so the AI's own later call returns the same object and its work (preludes) is unchanged.
 */
function bridgedHash(inputs: AiInputs, services: TurnServices): string {
  if (!("active" in inputs.request)) return "";
  const { own, opponent } = services.view.legal;
  const parts: string[] = [];
  for (let k = 0; k < opponent.length && own.length && parts.length < 4; k++) {
    const cell: CellActions = { own: own[k % own.length], opponent: opponent[k] };
    if (needsPrelude(cell)) continue;
    try {
      parts.push(JSON.stringify(services.engineWorlds(cell), (key, value) => key === "runtime" ? undefined : value));
    } catch (error) {
      parts.push(`error ${(error as Error).message}`);
    }
  }
  return createHash("sha256").update(parts.join("\n")).digest("hex");
}

type Captured = { requestId: number; kind: string; history: string; inputs: string; decision: string };
const historyHash = (lines: readonly string[]) => createHash("sha256").update(lines.filter((line) => !line.startsWith("|t:|")).join("\n")).digest("hex");
const decisionKey = (record: DecisionRecord | undefined, bridged = "") => record
  ? JSON.stringify({ choice: record.choice, report: record.report && { ...record.report, elapsedMs: 0 }, engineCalls: record.stats?.engineCalls, rolloutSamples: record.stats?.rolloutSamples, bridged })
  : "";

/** One battle of a pair: A (teamB false) records its choices; B replays them (with its one difference). */
export async function playL1(field: Field, opponentId: string, index: number, seat: SeatName, forced: Record<SideID, string[]> | null, mutateAt: number | null, choiceAt: number | null, teamB: boolean, budget?: WorkBudget): Promise<{ result: MatchResult; captured: Captured[]; appliedAt: number | null }> {
  await ensureSeats([seat]);
  const usage = loadTrainingUsage();
  const base = teamOf(fixtureById(field.player ?? PLAYER));
  const p1Team = teamB && field.variant ? field.variant(base) : base;
  const p2Team = teamOf(fixtureById(opponentId));
  const p2Lines: string[] = [];
  const captures: Omit<Captured, "decision">[] = [];
  const bridged = new Map<number, string>();
  let appliedAt: number | null = null;
  const forcedChoices = forced ? structuredClone(forced) : undefined;
  if (forcedChoices && choiceAt !== null && teamB) {
    // B's p1 choice for that request differs; the AI decides that request before any p1 choice exists (G1).
    const p1 = forcedChoices.p1;
    const at = Math.min(choiceAt, p1.length - 1);
    p1[at] = p1[at] === "default" ? "move 1, move 1" : "default";
  }
  const result = await runMatch({
    seats: { p1: createSeat("val-random", runtime, null), p2: createSeat(seat, runtime, null) },
    teams: { p1: p1Team, p2: p2Team }, info: field.info, runtime, usage, budget, seedRun: `leak:${field.id}:${opponentId}`, index,
    forced: forcedChoices,
    forcedPreview: field.preview ? { p1: teamB ? field.preview.b : field.preview.a } : undefined,
    observer: {
      drained(_host, _trackers, _keys, drain) { p2Lines.push(...drain.channel.p2); },
      before(side, _kind, host, ordinal) {
        if (side === "p2" && teamB && field.mutate && mutateAt !== null && ordinal >= mutateAt && appliedAt === null && field.mutate(realBattle(host), ordinal)) appliedAt = ordinal;
      },
      inputs(side, kind, inputs: AiInputs | null, host) {
        if (side === "p2") captures.push({ requestId: host.requestId, kind, history: historyHash(p2Lines), inputs: JSON.stringify(inputs) });
      },
      services(side, inputs, _worlds, services) {
        if (side === "p2") bridged.set(inputs.requestId, `${bridged.get(inputs.requestId) ?? ""}${bridgedHash(inputs, services)}`);
      },
    },
  });
  const byRequest = new Map<number, DecisionRecord>();
  for (const record of result.decisions) if (record.side === "p2" && !byRequest.has(record.requestId)) byRequest.set(record.requestId, record);
  return { result, captured: captures.map((capture) => ({ ...capture, decision: decisionKey(byRequest.get(capture.requestId), bridged.get(capture.requestId)) })), appliedAt };
}


export type L1Result = { field: string; compared: number; differences: number; inputDifferences: number; notes: string[] };
/** Battles A and B for each of `battles` opponents; counts the compared decisions and every difference. */
export async function runL1Field(field: Field, options: { battles: number; seat: SeatName; budget?: WorkBudget }): Promise<L1Result> {
  let compared = 0, differences = 0, inputDifferences = 0;
  const notes: string[] = [];
  for (let k = 0; k < options.battles; k++) {
    const opponents = field.opponents ?? OPPONENTS;
    const opponent = opponents[k % opponents.length];
    const a = await playL1(field, opponent, k, options.seat, null, null, null, false, options.budget);
    const mutateAt = field.mutate ? 1 + (k % 3) * 2 : null;
    const choiceAt = field.choice ? 1 + (k % 3) * 2 : null;
    const b = await playL1(field, opponent, k, options.seat, a.result.choices, mutateAt, choiceAt, true, options.budget);
    for (let i = 0; i < Math.min(a.captured.length, b.captured.length); i++) {
      const x = a.captured[i], y = b.captured[i];
      if (x.history !== y.history) continue;
      // A changed battle counts from the decision it was changed at (before it, A and B are the same battle).
      if (field.mutate && (b.appliedAt === null || i < b.appliedAt)) continue;
      compared++;
      const sameInputs = x.inputs === y.inputs, sameDecision = x.decision === y.decision;
      if (!sameInputs) inputDifferences++;
      if (!sameInputs || !sameDecision) {
        differences++;
        if (notes.length < 5) notes.push(`${opponent} #${k} decision ${i} (${x.kind}): inputs ${sameInputs ? "same" : "differ"}, decision ${sameDecision ? "same" : "differs"}`);
      }
    }
  }
  return { field: field.id, compared, differences, inputDifferences, notes };
}

// Fakes for the Training AI unit tests (SPEC §13 AI track): a usage fixture with the A1.1 shape, hand-built AiView /
// AiInputs / PostState values, and a small legal-action generator following SPEC 7.4's rules. No simulator.
import { allyOf, DOUBLES_SLOTS, foesOf, slotSide, type DoublesSideId, type DoublesSlotId } from "@/app/lib/battle/doubles-types";
import { createBuild, createConditions, defaultAbilityActive, getBuildStats } from "@/app/lib/battle/model";
import { championsRuntime, type BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions, BattleStatus } from "@/app/lib/battle/types";
import type { AiInputs } from "@/app/(app)/training/model/ai-inputs";
import type { AiView, FieldClock, MonView, PostMon, PostState } from "@/app/(app)/training/model/ai-view";
import { OPEN_TEAM_SHEETS, type InfoView } from "@/app/(app)/training/model/info";
import type { PublicMon, PublicState, TurnObservations } from "@/app/(app)/training/model/public-state";
import { redactSheet, type FullSheetMember, type StatPoints } from "@/app/(app)/training/model/sheet";
import type { ShowdownSet } from "@/app/(app)/training/model/showdown-types";
import type { TrainingUsageData } from "@/app/(app)/training/model/usage";
import type { JointAction, SlotAction, TrainingTeam } from "@/app/(app)/training/model/view-types";
import { jointActionKey } from "@/app/(app)/training/model/view-types";
import usage from "./training-ai-usage.json";

export const runtime: BattleRuntime = championsRuntime;
/** 17 species of data/champions/training-usage.json (2026-10-05), lists trimmed; each row keeps the importer's `sets`. */
export const usageFixture = usage as unknown as TrainingUsageData;

export const ZERO: StatPoints = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
export const points = (values: Partial<StatPoints>): StatPoints => ({ ...ZERO, ...values });

export type MonSpec = {
  side: DoublesSideId; member?: string; species: string; slot: DoublesSlotId | null; moves: string[];
  item?: string; ability?: string; nature?: string; points?: Partial<StatPoints>;
  /** HP share of the maximum (default 1). */
  hp?: number; boosts?: Partial<Record<"atk" | "def" | "spa" | "spd" | "spe", number>>; status?: BattleStatus;
  firstTurn?: boolean; protectStreak?: number; canMega?: boolean; lastMove?: string | null; fainted?: boolean; volatiles?: string[];
  accuracyStage?: number; evasionStage?: number;
};
export function buildOf(spec: Pick<MonSpec, "species" | "item" | "ability" | "nature" | "points" | "boosts" | "status">): BattleBuild {
  const base = createBuild(spec.species, runtime);
  const abilityId = spec.ability ?? base.abilityId;
  const build = {
    ...base, nature: spec.nature ?? "Hardy", abilityId, abilityActive: defaultAbilityActive(abilityId), itemId: spec.item ?? "",
    boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...spec.boosts }, status: spec.status ?? "",
  };
  return build.game === "champions" ? { ...build, points: points(spec.points ?? {}) } : build;
}
export function monView(spec: MonSpec): MonView {
  const build = buildOf(spec);
  const maxHp = getBuildStats(build, runtime)!.hp;
  const hp = spec.fainted ? 0 : Math.max(1, Math.round(maxHp * (spec.hp ?? 1)));
  const member = spec.member ?? spec.species;
  return {
    key: `${spec.side}:${member}`, side: spec.side, memberKey: member, slot: spec.slot, revealed: true, fainted: !!spec.fainted,
    build: { ...build, currentHP: hp >= maxHp ? null : hp }, hp, maxHp, hpExact: spec.side === "opponent",
    accuracyStage: spec.accuracyStage ?? 0, evasionStage: spec.evasionStage ?? 0, moves: spec.moves, firstTurn: spec.firstTurn ?? false,
    protectStreak: spec.protectStreak ?? 0, sleepElapsed: null, freezeElapsed: null, lastMove: spec.lastMove ?? null, volatiles: spec.volatiles ?? [],
    canMega: spec.canMega ?? false,
  };
}
export function emptyClock(): FieldClock {
  const side = { tailwind: 0, reflect: 0, lightScreen: 0, auroraVeil: 0, safeguard: 0, stealthRock: false, spikes: 0 as const, toxicSpikes: 0 as const, stickyWeb: false };
  return { weather: null, terrain: null, rooms: { trickRoom: 0, gravity: 0, magicRoom: 0, wonderRoom: 0 }, sides: { own: { ...side }, opponent: { ...side } } };
}

/** One slot's legal actions as SPEC 7.4 enumerates them (moves × living targets, Mega variants, switches, Fake Out on the first turn). */
export function slotActions(view: AiView, slot: DoublesSlotId): SlotAction[] {
  const mon = view.mons.find((each) => each.slot === slot && !each.fainted);
  if (!mon) return [{ kind: "pass" }];
  const side = slotSide(slot);
  const out: SlotAction[] = [];
  const present = (each: DoublesSlotId) => view.mons.some((other) => other.slot === each && !other.fainted);
  for (const moveId of mon.moves) {
    const move = runtime.movesById.get(moveId);
    if (!move) continue;
    if ((moveId === "fakeout" || moveId === "firstimpression") && !mon.firstTurn) continue;
    const targets: (DoublesSlotId | null)[] = ["normal", "any", "adjacentFoe"].includes(move.target) ? foesOf(slot).filter(present)
      : move.target === "adjacentAlly" ? (present(allyOf(slot)) ? [allyOf(slot)] : [])
      : move.target === "adjacentAllyOrSelf" ? [...(present(allyOf(slot)) ? [allyOf(slot)] : []), slot]
      : [null];
    for (const target of targets) {
      out.push({ kind: "move", moveId, target });
      if (mon.canMega && !view.megaUsed[side]) out.push({ kind: "move", moveId, target, mega: "mega" });
    }
  }
  for (const bench of view.mons.filter((each) => each.side === side && each.slot === null && !each.fainted)) out.push({ kind: "switch", to: bench.memberKey });
  return out.length ? out : [{ kind: "pass" }];
}
export function legalJoint(view: AiView, side: DoublesSideId): JointAction[] {
  const slots = DOUBLES_SLOTS.filter((slot) => slotSide(slot) === side);
  const [a, b] = slots.map((slot) => slotActions(view, slot));
  const out: JointAction[] = [];
  for (const x of a) for (const y of b) {
    const megas = [x, y].filter((each) => each.kind === "move" && each.mega).length;
    if (megas > 1) continue;
    if (x.kind === "switch" && y.kind === "switch" && x.to === y.to) continue;
    out.push({ [slots[0]]: x, [slots[1]]: y });
  }
  return out;
}

export type ViewOptions = { field?: Partial<BattleConditions>; clock?: Partial<FieldClock>; megaUsed?: Partial<Record<DoublesSideId, boolean>>; turn?: number; unrevealed?: number };
export function makeView(specs: MonSpec[], options: ViewOptions = {}): AiView {
  const mons = specs.map(monView);
  const view: AiView = {
    perspective: "p2", turn: options.turn ?? 1, requestId: 1,
    field: { ...createConditions(), gameType: "Doubles", ...options.field },
    clock: { ...emptyClock(), ...options.clock }, mons,
    hidden: { unrevealed: options.unrevealed ?? 0, candidates: [] },
    megaUsed: { own: false, opponent: false, ...options.megaUsed },
    request: { kind: "move", active: [] },
    legal: { opponent: [], own: [] }, particles: [], history: [],
  };
  view.legal = { opponent: legalJoint(view, "opponent"), own: legalJoint(view, "own") };
  return view;
}
export const keys = (actions: readonly JointAction[]) => actions.map(jointActionKey);

/** The view's state as a PostState (chance 1, HP as is), changed by `edit`. */
export function postOf(view: AiView, edit: (post: PostState) => void = () => {}): PostState {
  const mons: PostMon[] = view.mons.map((mon) => ({
    key: mon.key, side: mon.side, slot: mon.slot, known: true, build: { ...mon.build, boosts: { ...mon.build.boosts } }, hp: [{ hp: mon.hp, chance: 1 }], maxHp: mon.maxHp,
    volatiles: [], protected: false,
  }));
  const post: PostState = { chance: 1, mons, clock: structuredClone(view.clock), megaUsed: { ...view.megaUsed }, wiped: { own: 0, opponent: 0 }, endOfTurn: "applied" };
  edit(post);
  return post;
}

// ---------- AiInputs for the belief ----------
export type SheetSpec = { key: string; species: string; item: string; ability: string; moves: string[]; nature: string; points: Partial<StatPoints>; gender?: "M" | "F" | "N" };
export function fullSheet(specs: SheetSpec[]): FullSheetMember[] {
  return specs.map((spec) => ({
    key: spec.key, speciesId: spec.species, name: runtime.speciesById.get(spec.species)?.name ?? spec.species, gender: spec.gender ?? "M",
    nature: spec.nature, itemId: spec.item, abilityId: spec.ability, moves: spec.moves, points: points(spec.points),
  }));
}
export function showdownSet(spec: SheetSpec): ShowdownSet {
  const name = runtime.speciesById.get(spec.species)?.name ?? spec.species;
  return {
    name, species: name, item: runtime.itemsById.get(spec.item)?.name ?? "", ability: runtime.abilitiesById.get(spec.ability)?.name ?? spec.ability,
    moves: spec.moves.map((id) => runtime.movesById.get(id)?.name ?? id), nature: spec.nature, gender: spec.gender ?? "M",
    evs: points(spec.points), ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 50,
  };
}
export function publicMon(side: "p1" | "p2", key: string, speciesId: string, position: 0 | 1 | null, changes: Partial<PublicMon> = {}): PublicMon {
  return {
    key: `${side}:${key}`, side, position, speciesId, mega: false, hp: { percent: 100, color: null }, exact: null, fainted: false, status: "",
    statusElapsed: 0, boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, accuracy: 0, evasion: 0 }, volatiles: [], item: { state: "not-shown" },
    ability: null, movesUsed: {}, lastMove: null, lastMoveTarget: null, lastResult: null, actions: 0, activeTurns: 1, timesHit: 0, switchIns: 1,
    protectStreak: 0, lock: null, transformedInto: null, ...changes,
  };
}
export function publicState(mons: PublicMon[], turn = 1): PublicState {
  const side = { conditions: [], totalFainted: 0, faintedLastTurn: null, megaUsed: false };
  return {
    viewer: "p2", turn, mons: Object.fromEntries(mons.map((mon) => [mon.key, mon])),
    sides: { p1: { ...side }, p2: { ...side } }, field: { weather: null, terrain: null, rooms: [] }, lastMove: null, ended: false, winner: null,
  };
}
export function makeInputs(args: { player: SheetSpec[]; ai: SheetSpec[]; info?: InfoView; mons?: PublicMon[]; observations?: TurnObservations[]; turn?: number;
  reveals?: AiInputs["reveals"] }): AiInputs {
  const info = args.info ?? OPEN_TEAM_SHEETS;
  return {
    perspective: "p2", requestId: 1,
    request: { wait: true, side: { name: "Training", id: "p2", pokemon: [] } },
    own: args.ai.map((spec) => ({ key: spec.key, set: showdownSet(spec) })),
    sheet: redactSheet(fullSheet(args.player), info),
    public: publicState(args.mons ?? [], args.turn ?? 1),
    observations: args.observations ?? [],
    reveals: args.reveals ?? { exactHP: null, brought: null },
    info,
  };
}
export function observations(turn: number, parts: Partial<TurnObservations> = {}): TurnObservations {
  return { turn, order: [], damage: [], reveals: [], entries: [], actions: [], ...parts };
}

/** A TrainingTeam of sheet specs (the AI side of a team preview). */
export function trainingTeam(specs: SheetSpec[]): TrainingTeam {
  return {
    label: "AI",
    members: specs.map((spec) => ({
      key: spec.key, name: runtime.speciesById.get(spec.species)?.name ?? spec.species, speciesId: spec.species, origin: "imported" as const,
      build: buildOf({ species: spec.species, item: spec.item, ability: spec.ability, nature: spec.nature, points: spec.points }),
      moves: [0, 1, 2, 3].map((i) => ({ moveId: spec.moves[i] ?? null, origin: "imported" as const, gameType: "Doubles" as const })) as TrainingTeam["members"][number]["moves"],
    })),
  };
}

/** The design probe teams (scripts/.cache/training/design/probe/teams.mjs), true sets. */
export const PROBE_PLAYER: SheetSpec[] = [
  { key: "incineroar", species: "incineroar", item: "sitrusberry", ability: "intimidate", moves: ["fakeout", "flareblitz", "partingshot", "protect"], nature: "Careful", points: { hp: 32, atk: 2, def: 16, spd: 16 } },
  { key: "charizard", species: "charizard", item: "charizarditey", ability: "blaze", moves: ["heatwave", "airslash", "solarbeam", "protect"], nature: "Modest", points: { hp: 2, spa: 32, spe: 32 } },
  { key: "whimsicott", species: "whimsicott", item: "focussash", ability: "prankster", moves: ["tailwind", "moonblast", "encore", "protect"], nature: "Timid", points: { hp: 2, spa: 32, spe: 32 } },
  { key: "garchomp", species: "garchomp", item: "lifeorb", ability: "roughskin", moves: ["earthquake", "dragonclaw", "rockslide", "protect"], nature: "Jolly", points: { hp: 2, atk: 32, spe: 32 } },
  { key: "rotomwash", species: "rotomwash", item: "leftovers", ability: "levitate", moves: ["hydropump", "thunderbolt", "willowisp", "protect"], nature: "Modest", points: { hp: 32, def: 2, spa: 32 } },
  { key: "kingambit", species: "kingambit", item: "blackglasses", ability: "defiant", moves: ["kowtowcleave", "suckerpunch", "ironhead", "protect"], nature: "Adamant", points: { hp: 32, atk: 32, spd: 2 } },
];
export const PROBE_AI: SheetSpec[] = [
  { key: "gyarados", species: "gyarados", item: "gyaradosite", ability: "intimidate", moves: ["waterfall", "crunch", "dragondance", "protect"], nature: "Adamant", points: { hp: 2, atk: 32, spe: 32 } },
  { key: "pelipper", species: "pelipper", item: "mysticwater", ability: "drizzle", moves: ["hurricane", "weatherball", "tailwind", "protect"], nature: "Modest", points: { hp: 32, spa: 32, spd: 2 } },
  { key: "sneasler", species: "sneasler", item: "whiteherb", ability: "unburden", moves: ["fakeout", "closecombat", "direclaw", "protect"], nature: "Jolly", points: { hp: 2, atk: 32, spe: 32 } },
  { key: "archaludon", species: "archaludon", item: "expertbelt", ability: "stamina", moves: ["electroshot", "flashcannon", "dracometeor", "protect"], nature: "Modest", points: { hp: 32, spa: 32, spd: 2 } },
  { key: "farigiraf", species: "farigiraf", item: "lumberry", ability: "armortail", moves: ["trickroom", "psychic", "hypervoice", "protect"], nature: "Quiet", points: { hp: 32, def: 2, spa: 32 } },
  { key: "dragonite", species: "dragonite", item: "choicescarf", ability: "multiscale", moves: ["extremespeed", "outrage", "ironhead", "firepunch"], nature: "Adamant", points: { hp: 2, atk: 32, spe: 32 } },
];

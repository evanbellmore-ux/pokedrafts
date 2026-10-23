// Situations (model/situation.ts), worker side: the ready-made teams and the dealt position. A ready-made team is six Reg M-B
// usage Pokémon drawn by usage (Species Clause, at most two Mega forms) with Training's usage sets (usage/suggested-sets.ts:
// Item Clause in order, the Protect rule); a Mega form keeps its own row's moves and spread and battles as its base holding the
// stone, as a drafted one does. The position follows the request: a named situation's recipe, a custom one's counts, HP and
// stat stages, or one fully random draw (the worker rates those with the AI's engine and keeps one it rates ahead).
import { megaEntries } from "@/app/lib/battle/mega-forms";
import { usualAbility } from "@/app/lib/battle/move-defaults";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { AIRandom } from "../model/decision";
import {
  SITUATION_BROUGHT, SITUATION_SPOTS, SITUATION_STATS, spotInfo, type CustomSide, type SideRecipe, type SituationLevel, type SituationMember,
  type SituationRequest, type SituationSide, type SituationStat, type SituationStatus, type TrainingSituation,
} from "../model/situation";
import type { SetLegality, SuggestedSet, SuggestMember, TrainingUsageData } from "../model/usage";
import type { TeamProblems, TrainingMember, TrainingTeam } from "../model/view-types";
import { suggestedMember } from "../usage/suggested-member";
import { suggestTrainingSets } from "../usage/suggested-sets";

export type DealDeps = {
  usage: TrainingUsageData; legality: SetLegality; runtime: BattleRuntime;
  /** Showdown's validator on one team (Species Clause, Item Clause, every set). */
  validate(team: TrainingTeam): TeamProblems;
};

export const TEAM_SIZE = 6;
/** At most two Mega forms per ready-made team (one Mega Evolution per battle, PS/data/mods/champions). */
export const MAX_MEGAS = 2;
/** Usage weight → draw weight: the most used Pokémon stay the most likely, the long tail a little less rare. */
const DRAW_POWER = 0.8;
/** A team the validator refuses is drawn again without the refused Pokémon, this many times at most. */
const TEAM_TRIES = 8;
/**
 * A fully random position is kept once the AI's engine rates it at least this (DecisionStats.value, about 1 per Pokémon of
 * worth). An even 4-vs-4 at full HP rates about +0.9 for the AI; the named situations' medians are +1.1 to +2.2 at Hard and
 * +2.1 to +3.1 at Very hard (8 deals each, ready-made teams, Plays safe, the default budget).
 */
export const RANDOM_MARGIN: Readonly<Record<SituationLevel, number>> = { hard: 1.6, "very-hard": 2.5 };
/** Fully random positions rated before the most AI-favoured one is kept. */
export const RANDOM_TRIES = 8;
/** A fully random side's HP range by level: yours drawn lower at Very hard, the AI's higher. */
const RANDOM_HP: Readonly<Record<SituationLevel, { own: readonly [number, number]; opponent: readonly [number, number] }>> = {
  hard: { own: [10, 100], opponent: [30, 100] }, "very-hard": { own: [10, 80], opponent: [50, 100] },
};

const toID = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "");
function weighted<T extends { weight: number }>(entries: readonly T[], random: AIRandom): number {
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = random.float() * total;
  for (const [index, entry] of entries.entries()) { roll -= entry.weight; if (roll < 0) return index; }
  return entries.length - 1;
}
function shuffled<T>(items: readonly T[], random: AIRandom): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) { const j = random.int(i + 1); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

// ---------- ready-made teams ----------
type Drawn = { rowId: string; speciesId: string; stone: string | null };

/** One team's six from the usage rows, skipping `refused` rows; Species Clause by base species. */
function drawSix(random: AIRandom, deps: DealDeps, refused: ReadonlySet<string>): Drawn[] {
  const { runtime, usage } = deps;
  const pool = Object.entries(usage.species)
    .filter(([id]) => runtime.speciesById.has(id) && !refused.has(id))
    .map(([id, row]) => ({ id, weight: row.sets ** DRAW_POWER }));
  const drawn: Drawn[] = [];
  const bases = new Set<string>();
  let megas = 0;
  while (drawn.length < TEAM_SIZE && pool.length) {
    const [entry] = pool.splice(weighted(pool, random), 1);
    const mega = megaEntries(entry.id, runtime).find((each) => each.formId === entry.id) ?? null;
    const speciesId = mega?.baseSpeciesId ?? entry.id;
    const base = toID(runtime.speciesById.get(speciesId)?.baseSpecies ?? speciesId);
    if (bases.has(base) || (mega && megas >= MAX_MEGAS)) continue;
    bases.add(base);
    if (mega) megas++;
    drawn.push({ rowId: entry.id, speciesId, stone: mega?.itemId ?? null });
  }
  return drawn;
}

/** The drawn six with usage sets: a Mega form's own row, then sent as its base species holding the stone. */
function membersOf(drawn: readonly Drawn[], deps: DealDeps, prefix: string): TrainingMember[] {
  const { runtime } = deps;
  const requests: SuggestMember[] = drawn.map((each) => ({ key: `${prefix}-${each.speciesId}`, speciesId: each.rowId, abilityId: null }));
  return suggestTrainingSets(requests, deps).map((set, index): TrainingMember => {
    const { speciesId, stone } = drawn[index];
    const sent: SuggestedSet = stone
      ? { ...set, speciesId, itemId: stone, abilityId: usualAbility(speciesId, "Doubles", runtime) ?? runtime.speciesById.get(speciesId)?.abilities[0] ?? set.abilityId }
      : set;
    return suggestedMember(sent, { name: runtime.speciesById.get(speciesId)?.name ?? speciesId }, runtime);
  });
}

/** Six random Reg M-B usage Pokémon with Training's usage sets, legal as a team for the format. */
export function readyMadeTeam(random: AIRandom, deps: DealDeps, label: string, prefix: string): TrainingTeam {
  const refused = new Set<string>();
  let last: TrainingTeam | null = null;
  for (let attempt = 0; attempt < TEAM_TRIES; attempt++) {
    const drawn = drawSix(random, deps, refused);
    const team: TrainingTeam = { label, members: membersOf(drawn, deps, prefix) };
    last = team;
    const problems = deps.validate(team);
    const bad = team.members.map((member, index) => (problems.members[member.key]?.length ? drawn[index].rowId : null)).filter((id): id is string => !!id);
    if (team.members.length === TEAM_SIZE && !problems.team.length && !bad.length) return team;
    for (const id of bad) refused.add(id);
  }
  throw new Error(`No legal ready-made team after ${TEAM_TRIES} draws${last ? ` (${last.members.map((member) => member.name).join(", ")})` : ""}.`);
}

// ---------- the position ----------
const STATUS_IMMUNE_TYPES: Readonly<Record<SituationStatus, readonly string[]>> = { brn: ["Fire"], par: ["Electric"], psn: ["Poison", "Steel"], tox: ["Poison", "Steel"] };
/** Abilities that prevent, cure or profit from the status (a dealt status should hurt). */
const STATUS_SAFE_ABILITIES: Readonly<Record<SituationStatus, readonly string[]>> = {
  brn: ["waterveil", "waterbubble", "thermalexchange", "flareboost", "guts", "marvelscale", "quickfeet", "magicguard"],
  par: ["limber", "guts", "marvelscale", "quickfeet"],
  psn: ["immunity", "pastelveil", "poisonheal", "toxicboost", "guts", "marvelscale", "quickfeet", "magicguard"],
  tox: ["immunity", "pastelveil", "poisonheal", "toxicboost", "guts", "marvelscale", "quickfeet", "magicguard"],
};
const ANY_STATUS_SAFE = ["comatose", "purifyingsalt", "shieldsdown", "naturalcure", "shedskin", "synchronize"];
/** Items that cure it at once or give the holder its own status. */
const STATUS_ITEMS: Readonly<Record<SituationStatus, readonly string[]>> = {
  brn: ["lumberry", "rawstberry", "flameorb", "toxicorb"], par: ["lumberry", "cheriberry", "flameorb", "toxicorb"],
  psn: ["lumberry", "pechaberry", "flameorb", "toxicorb"], tox: ["lumberry", "pechaberry", "flameorb", "toxicorb"],
};

/** The member can be dealt this status and it holds it (types, abilities and items that would refuse, cure or want it). */
export function canHold(member: TrainingMember, status: SituationStatus, runtime: BattleRuntime): boolean {
  const types = runtime.speciesById.get(member.speciesId)?.types ?? [];
  if (types.some((type) => STATUS_IMMUNE_TYPES[status].includes(type))) return false;
  const ability = member.build.abilityId;
  if (STATUS_SAFE_ABILITIES[status].includes(ability) || ANY_STATUS_SAFE.includes(ability)) return false;
  return !STATUS_ITEMS[status].includes(member.build.itemId);
}

/** Physical or special by the member's damaging moves (its base stats break a tie). */
export function attackStat(member: TrainingMember, runtime: BattleRuntime): "atk" | "spa" {
  let physical = 0, special = 0;
  for (const slot of member.moves) {
    const move = slot.moveId ? runtime.movesById.get(slot.moveId) : undefined;
    if (move?.category === "Physical" && move.power > 0) physical++;
    else if (move?.category === "Special" && move.power > 0) special++;
  }
  if (physical !== special) return physical > special ? "atk" : "spa";
  const stats = runtime.speciesById.get(member.speciesId)?.baseStats;
  return stats && stats.spa > stats.atk ? "spa" : "atk";
}

/** A share of HP in [low, high], in steps of 5 (both ends kept). */
function drawHP([low, high]: readonly [number, number], random: AIRandom): number {
  if (high <= low) return low;
  const steps = Math.floor((high - low) / 5);
  const value = low + 5 * random.int(steps + 1);
  return value > high ? high : value;
}

/** The brought four in a random order: `left` standing (the first two lead), the rest fainted. */
function brought(team: TrainingTeam, left: number, random: AIRandom): { member: TrainingMember; standing: boolean }[] {
  return shuffled(team.members, random).slice(0, SITUATION_BROUGHT).map((member, index) => ({ member, standing: index < left }));
}
const cleanBoosts = (boosts: Partial<Record<SituationStat, number>>) => {
  const kept = Object.fromEntries(SITUATION_STATS.flatMap((stat) => {
    const value = Math.max(-6, Math.min(6, Math.trunc(boosts[stat] ?? 0)));
    return value ? [[stat, value]] : [];
  }));
  return Object.keys(kept).length ? kept as Partial<Record<SituationStat, number>> : undefined;
};

/** One side of a named situation: its four, HP, a crippled lead's status, a sweeper's stages, Tailwind. */
function recipeSide(recipe: SideRecipe, team: TrainingTeam, random: AIRandom, runtime: BattleRuntime): SituationSide {
  // A crippled lead needs a Pokémon that can hold the status: the four are dealt again (a few times) until enough leads can.
  let picks = brought(team, recipe.left, random);
  const statusOf = (member: TrainingMember): SituationStatus | null =>
    attackStat(member, runtime) === "atk" && canHold(member, "brn", runtime) ? "brn" : canHold(member, "par", runtime) ? "par" : null;
  const leads = () => picks.slice(0, Math.min(2, recipe.left));
  for (let attempt = 0; recipe.statusLeads && attempt < 12 && leads().filter(({ member }) => statusOf(member)).length < Math.min(recipe.statusLeads, leads().length); attempt++) {
    picks = brought(team, recipe.left, random);
  }
  const members: SituationMember[] = picks.map(({ member, standing }) => ({ key: member.key, hp: standing ? drawHP(recipe.hp, random) : 0 }));
  if (recipe.statusLeads) {
    let given = 0;
    leads().forEach(({ member }, index) => {
      const status = given < recipe.statusLeads! ? statusOf(member) : null;
      if (status) { members[index].status = status; given++; }
    });
  }
  if (recipe.sweeper) {
    const best = leads().map(({ member }, index) => ({ index, stat: attackStat(member, runtime), base: runtime.speciesById.get(member.speciesId)?.baseStats }))
      .sort((a, b) => Math.max(b.base?.atk ?? 0, b.base?.spa ?? 0) - Math.max(a.base?.atk ?? 0, a.base?.spa ?? 0))[0];
    if (best) members[best.index].boosts = { [best.stat]: 2, ...(recipe.sweeper === "attack-speed" ? { spe: 1 } : {}) };
  }
  return { members, ...(recipe.tailwind ? { tailwind: true } : {}) };
}

function customSide(custom: CustomSide, team: TrainingTeam, random: AIRandom): SituationSide {
  const left = Math.max(1, Math.min(SITUATION_BROUGHT, Math.trunc(custom.left)));
  const hp = Math.max(1, Math.min(100, Math.trunc(custom.hp)));
  const members = brought(team, left, random).map(({ member, standing }, index): SituationMember => {
    const boosts = standing && index < 2 ? cleanBoosts(custom.leads[index] ?? {}) : undefined;
    return { key: member.key, hp: standing ? hp : 0, ...(boosts ? { boosts } : {}) };
  });
  return { members };
}

/** Pokémon left for a fully random side (1–4; the AI's at least yours, so it is rarely behind on count). */
const LEFT_WEIGHTS = [{ left: 1, weight: 1 }, { left: 2, weight: 2.5 }, { left: 3, weight: 3.5 }, { left: 4, weight: 3 }];
function randomSide(team: TrainingTeam, minLeft: number, hp: readonly [number, number], random: AIRandom, runtime: BattleRuntime): SituationSide {
  const options = LEFT_WEIGHTS.filter((each) => each.left >= minLeft);
  const left = options[weighted(options, random)].left;
  const picks = brought(team, left, random);
  const members = picks.map(({ member, standing }, index): SituationMember => {
    if (!standing) return { key: member.key, hp: 0 };
    const out: SituationMember = { key: member.key, hp: drawHP(hp, random) };
    if (random.float() < 0.15) {
      const statuses = (["brn", "par", "psn"] as const).filter((status) => canHold(member, status, runtime));
      if (statuses.length) out.status = statuses[random.int(statuses.length)];
    }
    if (index < 2 && random.float() < 0.2) {
      const stat = SITUATION_STATS[random.int(SITUATION_STATS.length)];
      out.boosts = { [stat]: [-2, -1, 1, 2][random.int(4)] };
    }
    return out;
  });
  return { members, ...(random.float() < 0.1 ? { tailwind: true } : {}) };
}

/** Random situation: one of the named situations, or (one time in nine) a fully random one. */
export function drawAny(level: SituationLevel, random: AIRandom): Exclude<SituationRequest, { kind: "any" | "custom" }> {
  const pick = random.int(SITUATION_SPOTS.length + 1);
  return pick < SITUATION_SPOTS.length ? { kind: "spot", spot: SITUATION_SPOTS[pick], level } : { kind: "random", level };
}

/**
 * The position for a concrete request (a named situation, a custom one, or one fully random draw), recorded under `asked`
 * (what the page asked for: a Random situation stays one, so New situation draws again).
 */
export function dealPosition(
  request: Exclude<SituationRequest, { kind: "any" }>, asked: SituationRequest, teams: { own: TrainingTeam; opponent: TrainingTeam },
  random: AIRandom, runtime: BattleRuntime,
): TrainingSituation {
  if (request.kind === "spot") {
    const recipe = spotInfo(request.spot).recipes[request.level];
    return { request: asked, spot: request.spot, own: recipeSide(recipe.own, teams.own, random, runtime), opponent: recipeSide(recipe.opponent, teams.opponent, random, runtime) };
  }
  if (request.kind === "custom") {
    return { request: asked, spot: null, own: customSide(request.custom.own, teams.own, random), opponent: customSide(request.custom.opponent, teams.opponent, random) };
  }
  const range = RANDOM_HP[request.level];
  const own = randomSide(teams.own, 1, range.own, random, runtime);
  const opponent = randomSide(teams.opponent, own.members.filter((member) => member.hp > 0).length, range.opponent, random, runtime);
  return { request: asked, spot: null, own, opponent };
}

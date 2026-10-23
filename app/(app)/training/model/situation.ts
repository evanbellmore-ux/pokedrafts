// Situations (docs/training.md "Situations"): a practice battle dealt partway through, with ready-made teams. The page asks
// for one (SituationRequest); the worker deals both teams and the position (TrainingSituation, carried in TrainingSetup and so
// in every saved battle, its replay and Rematch) and starts the battle there (sim/situation-start.ts). Types, the named
// situations' recipes, their facts and labels, and the dealt position's checks: no engine or simulator imports.
import type { TrainingSetup } from "./view-types";

export const SITUATION_SPOTS = ["down-one", "down-two", "last-one", "half-health", "sweeper", "tailwind", "crippled", "endgame"] as const;
export type SituationSpotId = (typeof SITUATION_SPOTS)[number];
export const SITUATION_LEVELS = ["hard", "very-hard"] as const;
export type SituationLevel = (typeof SITUATION_LEVELS)[number];
export const LEVEL_LABEL: Readonly<Record<SituationLevel, string>> = { hard: "Hard", "very-hard": "Very hard" };
/** The stats a situation sets stages on (a custom situation's leads, a set-up sweeper). */
export const SITUATION_STATS = ["atk", "def", "spa", "spd", "spe"] as const;
export type SituationStat = (typeof SITUATION_STATS)[number];
export const STAT_LABEL: Readonly<Record<SituationStat, string>> = { atk: "Attack", def: "Defense", spa: "Sp. Atk", spd: "Sp. Def", spe: "Speed" };
export const SITUATION_STATUSES = ["brn", "par", "psn", "tox"] as const;
export type SituationStatus = (typeof SITUATION_STATUSES)[number];
/** Every brought Pokémon is listed: team preview picks exactly four (pinned sim/side.ts pickedTeamSize). */
export const SITUATION_BROUGHT = 4;
/** A custom side's HP choices (share of each Pokémon's maximum). */
export const CUSTOM_HP = [100, 75, 50, 25, 10] as const;

// ---------- what the page asks for ----------
export type CustomSide = {
  /** Pokémon left, 1–4: the first two lead (one alone with one left), the rest wait in the back; the others have fainted. */
  left: number;
  /** Each Pokémon left at this share of its HP (one of CUSTOM_HP). */
  hp: number;
  /** The left and right lead's stat stages (−6 to +6; a missing stat is 0). */
  leads: [Partial<Record<SituationStat, number>>, Partial<Record<SituationStat, number>>];
};
export type CustomSituation = { own: CustomSide; opponent: CustomSide };
export type SituationRequest =
  /** Random situation: one of the named ones or a fully random position, at this level. */
  | { kind: "any"; level: SituationLevel }
  | { kind: "spot"; spot: SituationSpotId; level: SituationLevel }
  /** Fully random: dealt again until the AI's engine rates the AI ahead by the level's margin (worker/situation-deal.ts). */
  | { kind: "random"; level: SituationLevel }
  | { kind: "custom"; custom: CustomSituation };

// ---------- Setup's Situations choices (remembered per browser and account) and the deal in progress ----------
/** Setup shows the full battle's teams (team preview, sets) or Situations (dealt teams and positions). */
export type SetupMode = "battle" | "situations";
export type SituationSettings = { mode: SetupMode; level: SituationLevel; custom: CustomSituation };
/** "Down 3-4": your three left against the AI's four, at full HP. */
export const DEFAULT_CUSTOM: CustomSituation = { own: { left: 3, hp: 100, leads: [{}, {}] }, opponent: { left: 4, hp: 100, leads: [{}, {}] } };
export const DEFAULT_SITUATION_SETTINGS: SituationSettings = { mode: "battle", level: "hard", custom: DEFAULT_CUSTOM };
export type SituationDeal =
  | { status: "idle" }
  | { status: "dealing"; key: string; request: SituationRequest }
  | { status: "error"; request: SituationRequest; message: string };

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const whole = (value: unknown, min: number, max: number, fallback: number) =>
  (Number.isInteger(value) && (value as number) >= min && (value as number) <= max ? value as number : fallback);
function stagesOf(value: unknown): Partial<Record<SituationStat, number>> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(SITUATION_STATS.flatMap((stat) => {
    const stage = whole(value[stat], -6, 6, 0);
    return stage ? [[stat, stage]] : [];
  }));
}
function customSideOf(value: unknown, fallback: CustomSide): CustomSide {
  if (!isRecord(value)) return fallback;
  const leads = Array.isArray(value.leads) ? value.leads : [];
  return {
    left: whole(value.left, 1, SITUATION_BROUGHT, fallback.left),
    hp: (CUSTOM_HP as readonly number[]).includes(value.hp as number) ? value.hp as number : fallback.hp,
    leads: [stagesOf(leads[0]), stagesOf(leads[1])],
  };
}
/** Stored settings back, untrusted: each part that does not read falls back to its default by itself. */
export function parseSituationSettings(value: unknown): SituationSettings {
  if (!isRecord(value)) return DEFAULT_SITUATION_SETTINGS;
  const custom = isRecord(value.custom) ? value.custom : {};
  return {
    mode: value.mode === "situations" ? "situations" : "battle",
    level: (SITUATION_LEVELS as readonly unknown[]).includes(value.level) ? value.level as SituationLevel : DEFAULT_SITUATION_SETTINGS.level,
    custom: { own: customSideOf(custom.own, DEFAULT_CUSTOM.own), opponent: customSideOf(custom.opponent, DEFAULT_CUSTOM.opponent) },
  };
}

// ---------- what the worker dealt ----------
export type SituationMember = {
  /** TrainingMember.key of its team. */
  key: string;
  /** Share of its maximum HP, 1–100; 0: it has fainted. */
  hp: number;
  status?: SituationStatus;
  /** Its stat stages; only a lead's (the first two Pokémon left). */
  boosts?: Partial<Record<SituationStat, number>>;
};
/** The four brought, in battle order: the leads, the back, then the fainted ones. */
export type SituationSide = { members: SituationMember[]; tailwind?: boolean };
export type TrainingSituation = {
  /** What was asked for: Rematch plays this position again, New situation asks for another one. */
  request: SituationRequest;
  /** The named situation dealt (a Random situation picks one; null for Fully random and Custom). */
  spot: SituationSpotId | null;
  own: SituationSide;
  opponent: SituationSide;
};

// ---------- the named situations ----------
/** One side of a recipe: Pokémon left, the HP range each is dealt in, and its trouble. */
export type SideRecipe = {
  left: number; hp: readonly [number, number];
  /** Leads dealt a burn (a physical attacker) or paralysis, where the Pokémon can have it. */
  statusLeads?: 1 | 2;
  /** Its strongest lead's attacking stat at +2 (and Speed +1). */
  sweeper?: "attack" | "attack-speed";
  tailwind?: boolean;
};
export type SpotRecipe = { own: SideRecipe; opponent: SideRecipe };
export type SpotInfo = { id: SituationSpotId; label: string; recipes: Readonly<Record<SituationLevel, SpotRecipe>> };

const side = (left: number, low: number, high = low, trouble: Omit<SideRecipe, "left" | "hp"> = {}): SideRecipe => ({ left, hp: [low, high], ...trouble });
export const SPOTS: readonly SpotInfo[] = [
  { id: "down-one", label: "Down one", recipes: { hard: { own: side(3, 70, 100), opponent: side(4, 70, 100) }, "very-hard": { own: side(3, 40, 80), opponent: side(4, 80, 100) } } },
  { id: "down-two", label: "Down two", recipes: { hard: { own: side(2, 80, 100), opponent: side(4, 50, 90) }, "very-hard": { own: side(2, 60, 100), opponent: side(4, 80, 100) } } },
  { id: "last-one", label: "Last one standing", recipes: { hard: { own: side(1, 90, 100), opponent: side(2, 30, 60) }, "very-hard": { own: side(1, 70, 100), opponent: side(2, 50, 90) } } },
  { id: "half-health", label: "Half health", recipes: { hard: { own: side(4, 50), opponent: side(4, 75) }, "very-hard": { own: side(4, 50), opponent: side(4, 100) } } },
  {
    id: "sweeper", label: "Set-up sweeper",
    recipes: { hard: { own: side(4, 80, 100), opponent: side(4, 80, 100, { sweeper: "attack" }) }, "very-hard": { own: side(4, 70, 100), opponent: side(4, 90, 100, { sweeper: "attack-speed" }) } },
  },
  {
    id: "tailwind", label: "Tailwind against you",
    recipes: { hard: { own: side(4, 80, 100), opponent: side(4, 80, 100, { tailwind: true }) }, "very-hard": { own: side(3, 80, 100), opponent: side(4, 80, 100, { tailwind: true }) } },
  },
  {
    id: "crippled", label: "Crippled leads",
    recipes: { hard: { own: side(4, 80, 100, { statusLeads: 1 }), opponent: side(4, 80, 100) }, "very-hard": { own: side(4, 60, 90, { statusLeads: 2 }), opponent: side(4, 90, 100) } },
  },
  { id: "endgame", label: "Endgame", recipes: { hard: { own: side(2, 20, 50), opponent: side(2, 30, 60) }, "very-hard": { own: side(2, 20, 50), opponent: side(3, 40, 80) } } },
];
export const spotInfo = (id: SituationSpotId): SpotInfo => SPOTS.find((each) => each.id === id)!;

const range = ([low, high]: readonly [number, number]) => (low === high ? `${low}%` : `${low}–${high}%`);
/** "3 left, 70–100% HP, one lead burned or paralyzed". */
function sideFact(recipe: SideRecipe): string {
  const parts = [`${recipe.left} left`, `${range(recipe.hp)} HP`];
  if (recipe.statusLeads) parts.push(recipe.statusLeads === 1 ? "one lead burned or paralyzed" : "both leads burned or paralyzed");
  if (recipe.sweeper) parts.push(recipe.sweeper === "attack" ? "a lead at +2 in its attacking stat" : "a lead at +2 in its attacking stat and +1 Speed");
  if (recipe.tailwind) parts.push("Tailwind (4 turns)");
  return parts.join(", ");
}
/** "You: 3 left, 70–100% HP. AI: 4 left, 70–100% HP." */
export function spotFact(id: SituationSpotId, level: SituationLevel): string {
  const recipe = spotInfo(id).recipes[level];
  return `You: ${sideFact(recipe.own)}. AI: ${sideFact(recipe.opponent)}.`;
}
export const RANDOM_FACT = "Pokémon left, HP, status, stat stages and Tailwind at random, dealt again until the AI's engine rates the AI ahead.";
export const ANY_FACT = "One of the named situations or a fully random one.";

// ---------- labels ----------
export function requestLabel(request: SituationRequest): string {
  switch (request.kind) {
    case "any": return `Random situation · ${LEVEL_LABEL[request.level]}`;
    case "spot": return `${spotInfo(request.spot).label} · ${LEVEL_LABEL[request.level]}`;
    case "random": return `Fully random · ${LEVEL_LABEL[request.level]}`;
    case "custom": return "Custom situation";
  }
}
/** The situation as the battle, the log and Saved battles name it: "Down one · Hard", "Fully random · Very hard", "Custom situation". */
export function situationLabel(situation: Pick<TrainingSituation, "request" | "spot">): string {
  const { request, spot } = situation;
  if (request.kind === "custom") return "Custom situation";
  if (spot) return `${spotInfo(spot).label} · ${LEVEL_LABEL[request.level]}`;
  return `Fully random · ${LEVEL_LABEL[request.level]}`;
}
const left = (side: SituationSide) => side.members.filter((member) => member.hp > 0).length;
/** "You have 3 Pokémon left, the opponent 4." */
export function leftFact(situation: Pick<TrainingSituation, "own" | "opponent">): string {
  return `You have ${left(situation.own)} Pokémon left, the opponent ${left(situation.opponent)}.`;
}
/** The log's first line: "Situation: Down one (Hard). You have 3 Pokémon left, the opponent 4.", "Situation: Custom. …". */
export function situationIntro(situation: TrainingSituation): string {
  const name = situation.request.kind === "custom" ? "Custom" : situationLabel(situation).replace(/ · (.+)$/, " ($1)");
  return `Situation: ${name}. ${leftFact(situation)}`;
}
/** "Down one · Hard" for a battle that began from a situation, else "Home vs Rival". */
export function matchupText(setup: Pick<TrainingSetup, "own" | "opponent" | "situation">): string {
  return setup.situation ? situationLabel(setup.situation) : `${setup.own.label} vs ${setup.opponent.label}`;
}

// ---------- checks (a saved battle's or an import file's situation; the schema itself is saved-battle.ts's) ----------
/** The first problem with a dealt situation against its setup's teams, or null. */
export function situationProblem(situation: TrainingSituation, setup: Pick<TrainingSetup, "own" | "opponent">): string | null {
  for (const role of ["own", "opponent"] as const) {
    const name = role === "own" ? "Your side" : "The opponent's side";
    const members = situation[role].members;
    const keys = new Set(setup[role].members.map((member) => member.key));
    if (members.length !== SITUATION_BROUGHT) return `${name} does not list ${SITUATION_BROUGHT} Pokémon.`;
    if (new Set(members.map((member) => member.key)).size !== members.length) return `${name} lists a Pokémon twice.`;
    if (members.some((member) => !keys.has(member.key))) return `${name} lists a Pokémon its team does not have.`;
    const fainted = members.findIndex((member) => member.hp <= 0);
    if (fainted === 0) return `${name} has no Pokémon left.`;
    if (fainted > 0 && members.slice(fainted).some((member) => member.hp > 0)) return `${name} lists a fainted Pokémon before one still standing.`;
    const standing = fainted < 0 ? members.length : fainted;
    for (const [index, member] of members.entries()) {
      if (member.hp <= 0 && (member.status || member.boosts)) return `${name} gives a fainted Pokémon a status or stat stages.`;
      if (member.boosts && index >= Math.min(2, standing)) return `${name} gives stat stages to a Pokémon not in play.`;
    }
  }
  return null;
}

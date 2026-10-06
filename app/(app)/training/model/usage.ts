// Addendum A1.1–A1.3 (new file): the shape of data/champions/training-usage.json, Training suggested sets, the set editor's move list, and the DATA helpers' signatures.
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { StatPoints } from "./sheet";

// Types, constants and signatures only: the JSON itself is imported by the Training worker alone (usage/training-usage.ts).

/** The usage source as a format fact (A1.1): Reg M-B statistics are used for Reg M-C battles. */
export const USAGE_SOURCE_FACT = "Smogon 2026-08 VGC Reg M-B";

// ---------- data/champions/training-usage.json (A1.1) ----------
/**
 * weight: the share of the species' weighted sets that carry it, i.e. its raw archive weight ÷ the sum of the species'
 * `Abilities` raw weights (every set has one ability). Rounded; > 0.
 */
export type UsageEntry = { id: string; weight: number };
/** A Smogon `Spreads` key `Nature:hp/atk/def/spa/spd/spe` (Stat Points) with its weight. */
export type UsageSpread = { nature: string; points: StatPoints; weight: number };
/** One exact-matched catalog species (move-usage.json identity rules). Every list in descending weight, canonical id breaking ties. */
export type SpeciesUsage = {
  /** Moves of every category in the species' proven Champions learnset (A1.1: the top 24, or every move above 0.5%); weights sum to at most 4. */
  moves: readonly UsageEntry[];
  /** Catalog-legal items, the top 12; id "" = no item (the archive's "nothing"). */
  items: readonly UsageEntry[];
  /**
   * The top 12 spreads valid under the Champions Stat Point rules: at most 32 per stat (PS/sim/team-validator.ts:1306-1311)
   * and 66 in total (PS/sim/dex-formats.ts:343-345). Nature names as Showdown spells them.
   */
  spreads: readonly UsageSpread[];
  /** The form's legal catalog abilities with a positive weight. */
  abilities: readonly UsageEntry[];
  /** The species' summed raw `Abilities` weight (its weighted set count); weight × sets = the raw archive weight. */
  sets: number;
};
export type TrainingUsageData = {
  version: 1;
  game: "champions";
  /** The catalog the identities and legality were checked against (as move-usage.json). */
  catalogSha256: string;
  /** Copied from move-usage.json. */
  attribution: { name: string; url: string; note: string };
  policy: Readonly<Record<string, string>>;
  /** The hash-checked Doubles archive, as move-usage.json formats.Doubles.source (format "gen9championsvgc2026regmb", month "2026-08"). */
  source: { url: string; format: string; month: string; cutoff: number; battles: number; archiveBytes: number; archiveSha256: string };
  /** Importer counts, for reports only. */
  coverage: Readonly<Record<string, unknown>>;
  /** By catalog species id. */
  species: Readonly<Record<string, SpeciesUsage>>;
};

// ---------- Training suggested sets (A1.2) ----------
/** "usage": from the species' usage row. "no-usage": the calculator's suggestion (damaging moves) + the Protect rule + Hardy, 0 Stat Points. */
export type SuggestionSource = "usage" | "no-usage";
export const SUGGESTION_LABEL: Readonly<Record<SuggestionSource, string>> = {
  usage: "Suggested set", "no-usage": "Suggested set (no usage data)",
};
/** The row fact when the Protect rule changed a suggested set. */
export const PROTECT_ADDED_FACT = "Protect added";
/** A league-roster member to suggest a set for. */
export type SuggestMember = {
  key: string;                      // TrainingMember.key (RosterSource.key)
  speciesId: string;
  /** The ability the league's Pool Builder row names (RosterSource.abilityId, e.g. Power Construct): kept when set. */
  abilityId: string | null;
  /** A held item the set must have: the stone of a Mega form drafted as its own entry (setup/team-draft.ts megaBase). */
  itemId?: string;
};
export type SuggestedSet = {
  key: string;
  speciesId: string;
  source: SuggestionSource;
  /** 1–4 distinct move ids, legal together; usage order, with Protect in the place of the move it replaced. */
  moves: string[];
  /** "" = no item. Item Clause: never an item an earlier member of the same request took. A form's required item (Mega Stone) always. */
  itemId: string;
  abilityId: string;
  /** Never Serious with 0 Stat Points (SPEC C15: Hardy). */
  nature: string;
  points: StatPoints;
  /**
   * The species learns Protect, the set lacked it and its item is not a Choice item or Assault Vest: Protect took the place of
   * the lowest-weight non-Protect move (without usage: the last suggested move; an empty slot when the set had fewer than four).
   */
  protectAdded: boolean;
};

// ---------- The set editor's move list (A1.3) ----------
/** weight: the species' usage share (UsageEntry.weight); null when the move is not in its usage row. */
export type EditorMoveOption = { id: string; weight: number | null };

// ---------- Signatures between the DATA helpers (usage/*) and the worker (sim/*, worker/*) ----------
/**
 * What the worker's bundled TeamValidator answers (the SIM track supplies it; the DATA helpers never import the simulator).
 * speciesId is the catalog id as on TrainingMember; a Mega or battle form answers as the set it is sent as (SPEC 7.5: its base
 * species holding its stone, or `changesFrom`).
 */
export type SetLegality = {
  /** Every move the species can legally use in Reg M-C, any category (one-move validator checks over its move pool). */
  legalMoves(speciesId: string): readonly string[];
  /** The validator's problems for this one set on its own (fixed gender, IVs 31, level 50), verbatim; empty when legal. */
  problems(set: { speciesId: string; moves: readonly string[]; itemId: string; abilityId: string; nature: string; points: StatPoints }): readonly string[];
};
export type UsageDeps = { usage: TrainingUsageData; legality: SetLegality; runtime: BattleRuntime };
/** usage/training-usage.ts: the row a form reads, by move-usage's identity rules (a cosmetic form reads its family's, Maushold-Four reads Maushold's: move-defaults.ts usageRow); null without one. */
export type SpeciesUsageLookup = (usage: TrainingUsageData, speciesId: string, runtime: BattleRuntime) => SpeciesUsage | null;
/** usage/suggested-sets.ts: one set per member, in the members' order; items are taken in that order (Item Clause). */
export type SuggestTrainingSets = (members: readonly SuggestMember[], deps: UsageDeps) => SuggestedSet[];
/** usage/move-options.ts: every legal move of the species, usage weight order first, then A–Z by catalog name. */
export type EditorMoveOptions = (speciesId: string, deps: UsageDeps) => EditorMoveOption[];

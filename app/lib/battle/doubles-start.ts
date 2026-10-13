import {
  cap, clampStage, COMBAT_STATS, GAS_PROOF_ABILITIES, GAS_STAND_IN, gasSuppresses, klutzActive, PARADOX_FIELDS, settleAbilities, settleItems, STAGE_NAMES,
  type SettledItems, type SettleReads,
} from "./calculate";
import { REASONS } from "./doubles-actions";
import {
  allyOf, DOUBLES_SLOTS, foesOf, SHOWDOWN_POSITION, slotSide, turnNames, type DoublesSlotId, type DoublesStartRow, type DoublesTurnInput,
} from "./doubles-types";
import type { World } from "./doubles-world";
import type { TurnKernel } from "./doubles-turn";
import { BERSERK_BERRIES, HEALING_BERRIES, OWN_STATUS_CURES } from "./hit-loop";
import { NO_TRACE_ABILITIES } from "./imposter";
import { applyIntimidateToFoes, atLead, entryBoosts, intimidatedKey, leadSpeed, unknownLeadForms, type EntryBoost, type IntimidateBattle } from "./intimidate";
import { buildTypes } from "./mechanics";
import { megaEntries } from "./mega-forms";
import { getBuildStats, PARADOX_FIELD_SETTERS } from "./model";
import { entryStagesOf } from "./uses-to-ko";
import type { BattleBuild, BattleConditions, CombatStat } from "./types";

// The start of a doubles turn (status2 ADDENDUM2 §3.5, Step 0b.3: settleDoublesStart moved here from calculate.ts) and its
// hooks (doubles-turn.ts rootWorlds: variants; presenceGuards: custapGuard; turnFacts: turnFacts; the start rows:
// rowsByVariant). Track ST (wave 1b; ADDENDUM2 §4.3, T2P §4, SPEC2 D's start items) models what the start stopped at:
// - start variants (T2P §4.0): the weighted alternative starts a turn begins from, each a settle of its own;
// - Trace with two different copyable foe abilities: one start per foe, 1/2 each (PS/data/abilities.ts:5118-5150 trace samples
//   the adjacent foes at its Start); Trace or Imposter copying Intimidate: its Start against both foes with their reactions
//   (intimidate.ts applyIntimidateToFoes, the calculator's apply action), unless its drops are stored (copiedIntimidateStored);
// - two Pokémon acting on one (T2P §4.2): each start effect read from the Pokémon that has it (calculate.ts SettleReads);
// - Download at the lead (T2P §4.3): each foe's Defense and Sp. Def at Download's Start, in the leads' Start order (switch-in
//   handlers by priority, then Speed: PS/sim/battle.ts:994-1013) or the entry order the input gives; a Speed tie is a start
//   per order;
// - a Custap Berry with Quick Draw or Mycelium Might (T2P §4.5; PS/data/items.ts:1235-1256, FractionalPriority from 0);
// - Imposter (USER-DECISIONS Q8): transformed into the foe across from it as both entered, by the 1v1's rules;
// - a Starf Berry eaten at the turn's first Update (one start per stat it can raise) and the start copies (a foe's Opportunist
//   or Mirror Herb copying a rise at that Update: pending in MonState.copy until the first action's end, D's afterMoveCopies).
// A hook module: it imports the kernel's type only (tests/source/status2-hooks.test.ts).

/** One present slot's start of the doubles turn (settleDoublesStart). */
export type DoublesStartSlot = {
  /** Settled as calculateMatchup settles a side (abilities and forms, Download against both foes, items); the engine still adds its entry rises. */
  build: BattleBuild;
  /** `build` with its entry rises in the stages and a terrain Seed used up (entryStagesOf), for the turn's calculations (calculateTurnMove). */
  folded: BattleBuild;
  items: SettledItems;
  /** The settle lines, as start facts. */
  lines: string[];
  /** The other Pokémon its settle read as "the other battler" (SPEC §4.2 step 2). */
  representative: DoublesSlotId;
  /**
   * ST (T2P §4.5): the fractional priority outcomes its action has in this start, in place of the kernel's fractionalOutcomes
   * (doubles-turn.ts rootWorldsOf): Quick Draw against a Custap Berry at its line, whose 30% is a start of its own.
   */
  fractional?: { value: number; chance: number; fact?: string }[];
  /**
   * ST (SPEC2 §4.5): an Opportunist or Mirror Herb copy pending as the turn starts (a foe's rise at the turn's first Update, on
   * top of a carried copy), applied at the first action's end (doubles-turn.ts startWorld; doubles-guards.ts afterMoveCopies).
   */
  copy?: { stages: Partial<Record<CombatStat, number>>; by: "opportunist" | "mirrorherb" };
};
/**
 * Neutralizing Gas on the field as the doubles turn starts (settleDoublesStart), suppressing every other ability it can
 * from the start (as the 1v1 assumes the gas was out first): each such ability stands in as Run Away for the whole
 * turn, and so does each holder's own, which does nothing else. doubles-turn.ts guards the events that would end the
 * gas or change what it suppresses.
 */
export type DoublesGas = {
  holders: DoublesSlotId[];
  /** The other Pokémon whose ability it suppresses (abilities other than Run Away). */
  suppressed: DoublesSlotId[];
  /** Ability Shield holders with an ability the gas can suppress: the Shield keeps it, except under Magic Room. */
  shielded: DoublesSlotId[];
  /** The ability each stand-in replaced, the holders' Neutralizing Gas included (for calculateDoublesOutcomes' builds). */
  abilities: Partial<Record<DoublesSlotId, string>>;
};
type Slots = Record<DoublesSlotId, DoublesStartSlot | null>;
/** One start of the turn (T2P §4.0) at its weight; `label` tells it from the others as a fact ("If Gardevoir's Trace copied Levitate."). */
export type DoublesStartVariant = { weight: number; slots: Slots; label: string | null };
export type DoublesSettle = {
  slots: Slots;
  reason: string | null;
  gas?: DoublesGas | null;
  /** ST: the starts the walk begins from (weights summing to 1) when there is more than one; `slots` is then the first of the rows'. */
  variants?: DoublesStartVariant[];
  /**
   * ST: the starts the rows differ by, when more than one (the walk's without a Starf Berry's random stat, which the rows' own
   * Starf outcomes cover: calculate.ts matchupRows).
   */
  rowVariants?: DoublesStartVariant[];
  /** ST: the turn facts the start gives (doubles-turn.ts turnFacts, through the turnFacts hook). */
  facts?: string[];
};

const UNNERVE_ABILITIES = new Set(["unnerve", "asoneglastrier", "asonespectrier"]);
const WEATHER_NEGATORS = new Set(["cloudnine", "airlock"]);
/**
 * Abilities whose Start changes the field or a Pokémon's HP or stages as they enter (a weather or terrain setter, Hospitality,
 * Screen Cleaner, Curious Medicine, Costar, Supersweet Syrup): copied by a Trace that could have copied something else, the
 * input's field, HP and stages (after the entry effects) cannot be those of both starts (T2P §4.1's kept reason).
 */
const TRACE_CHANGES_ON_ENTRY = new Set([
  "drizzle", "drought", "sandstream", "snowwarning", "orichalcumpulse", "desolateland", "primordialsea", "deltastream",
  "electricsurge", "grassysurge", "mistysurge", "psychicsurge", "hadronengine", "hospitality", "screencleaner", "curiousmedicine",
  "costar", "supersweetsyrup",
]);
const TRACE_RANDOM = "Trace copies a random foe's ability.";
/**
 * Abilities that change what a foe's Intimidate does to their holder (intimidate.ts intimidateAll: ChangeBoost, TryBoost,
 * AfterEachBoost and AfterBoost): copied by a random Trace before a foe's Intimidate at the lead, the input's stages (after the
 * entry effects) cannot be those of both starts either.
 */
const REACTS_TO_INTIMIDATE = new Set([
  "contrary", "simple", "guarddog", "clearbody", "whitesmoke", "fullmetalbody", "flowerveil", "hypercutter", "innerfocus", "owntempo",
  "oblivious", "scrappy", "mirrorarmor", "defiant", "competitive", "rattled",
]);
/** The terrain Seeds, used at switch-in priority −1: after the priority-0 Starts at a shared lead. */
const SEEDS = new Set(["grassyseed", "electricseed", "psychicseed", "mistyseed"]);

/** status2 (U1's apply button): a Trace holder's copied Intimidate already applied to every foe (copiedIntimidateStored lists their intimidatedKey). */
function copiedIntimidateStored(build: BattleBuild, foes: BattleBuild[], runtime: DoublesTurnInput["runtime"]) {
  const keys = build.copiedIntimidateStored?.split(",") ?? [];
  return foes.length > 0 && foes.every((foe) => keys.includes(intimidatedKey(foe, runtime)));
}

/** What one Pokémon's start reads of "the other battler" (SPEC §4.2 step 2), with the Pokémon that would supply it. */
type Need = { kind: "negator" | "trace" | "imposter" | "unnerve" | "setter"; slots: DoublesSlotId[] };
/** A Download holder's foe's effect on its Defense or Sp. Def at the lead, which Download's Start can come before or after. */
type Effect = { foe: DoublesSlotId; kind: "shield" | "seed" | "embody" | "imposter"; entry?: EntryBoost };
/** One start before its items' random parts: its weight, labels, the slots' settled builds, lines and reads. */
type Run = {
  weight: number; labels: string[]; entered: Record<DoublesSlotId, BattleBuild>; lines: Record<DoublesSlotId, string[]>;
  reps: Record<DoublesSlotId, DoublesSlotId>; itemReads: Partial<Record<DoublesSlotId, SettleReads>>; entryUsed: Partial<Record<DoublesSlotId, string>>;
};
type Part = { weight: number; labels: string[]; slots: Slots };

/** getStat with the stages in and the modifiers out (intimidate.ts downloadStat's arithmetic). */
const staged = (stat: number, stage: number) => (stage >= 0 ? Math.floor(stat * (2 + stage) / 2) : Math.floor(stat * 2 / (2 - stage)));

/**
 * The start of a doubles turn (SPEC §4.2; status2 track ST). The 1v1 settle reads "the other battler" for Unnerve and As One,
 * Cloud Nine and Air Lock (Forecast, Ice Face, Protosynthesis), the paradox field setters, the Trace source and Imposter's
 * target; each slot takes as that other the one Pokémon that supplies all it needs, or else reads each need from the Pokémon
 * that has it (SettleReads; an Imposter's other is the foe across, which it copies). Download reads both foes at the lead
 * (pinned Showdown data/abilities.ts download: the sum of their Defense and Sp. Def at its Start) and is always settled into
 * the stages, since the engine would read only the target. The random parts of the start (Trace's copy, a Speed tie at the
 * lead, Quick Draw against a Custap Berry, a Starf Berry) are start variants; a confused Pokémon with a move and a stopped
 * part keep `reason`.
 */
export function settleDoublesStart(input: DoublesTurnInput): DoublesSettle {
  const { runtime } = input;
  const field: BattleConditions = { ...input.field, gameType: "Doubles" };
  const present = DOUBLES_SLOTS.filter((slot) => input.pokemon[slot]);
  const shown = Object.fromEntries(DOUBLES_SLOTS.map((slot) => [slot, input.pokemon[slot]?.build ?? null])) as Record<DoublesSlotId, BattleBuild | null>;
  const names = Object.fromEntries(DOUBLES_SLOTS.map((slot) => [slot, shown[slot] ? runtime.speciesById.get(shown[slot]!.speciesId)?.name ?? shown[slot]!.speciesId : ""])) as Record<DoublesSlotId, string>;
  const labels = turnNames(input);
  const tailwind = (slot: DoublesSlotId) => (slotSide(slot) === "own" ? field.attackerSide : field.defenderSide).tailwind;
  const empty = Object.fromEntries(DOUBLES_SLOTS.map((slot) => [slot, null])) as Slots;
  // Neutralizing Gas (pinned Showdown data/abilities.ts neutralizinggas onSwitchIn, priority 2, before any other
  // switch-in or start ability; sim/pokemon.ts:858-877 ignoringAbility while a holder is active): from the turn's start,
  // each ability it suppresses stands in as Run Away (gasSuppresses: not a cantsuppress one, not another holder's, not
  // one an Ability Shield keeps outside Magic Room), and each holder's own does nothing else, so no calculation reads a gas.
  const holders = present.filter((slot) => shown[slot]!.abilityId === "neutralizinggas");
  const gas: DoublesGas | null = holders.length ? { holders, suppressed: [], shielded: [], abilities: {} } : null;
  const gasLines = Object.fromEntries(DOUBLES_SLOTS.map((slot) => [slot, [] as string[]])) as Record<DoublesSlotId, string[]>;
  const abilityName = (id: string) => runtime.abilitiesById.get(id)?.name ?? id;
  const itemName = (id: string) => runtime.itemsById.get(id)?.name ?? id;
  // `tera`: the ability a Tera form gives, which its Terastallization line already says is suppressed (it replaces the one entered with).
  const gassed = (slot: DoublesSlotId, abilityId: string, tera = false) => {
    gas!.abilities[slot] = abilityId;
    if (tera) gasLines[slot] = [];
    if (holders.includes(slot) || abilityId === GAS_STAND_IN) return;
    if (!gas!.suppressed.includes(slot)) gas!.suppressed.push(slot);
    if (!tera) gasLines[slot] = [`${cap(labels[slot])}'s ${abilityName(abilityId)} is suppressed by Neutralizing Gas.`];
  };
  if (gas) {
    for (const slot of present) {
      const build = shown[slot]!;
      const holder = holders.includes(slot);
      if (!holder && build.itemId === "abilityshield" && !GAS_PROOF_ABILITIES.has(build.abilityId)) gas.shielded.push(slot);
      if (!holder && !gasSuppresses(build, field)) continue;
      gassed(slot, build.abilityId);
      shown[slot] = { ...build, abilityId: GAS_STAND_IN };
    }
  }
  const others = (slot: DoublesSlotId) => present.filter((other) => other !== slot);
  const foes = (slot: DoublesSlotId) => present.filter((other) => slotSide(other) !== slotSide(slot));
  // The slot across (pinned Showdown side.foe.active[active.length − 1 − position]; SHOWDOWN_POSITION mirrors the far side).
  const facing = (slot: DoublesSlotId): DoublesSlotId => (slot.endsWith("left") ? foesOf(slot)[0] : foesOf(slot)[1]);
  // The foe across, else any other.
  const across = (slot: DoublesSlotId): DoublesSlotId => (shown[facing(slot)] ? facing(slot) : foes(slot)[0] ?? others(slot)[0] ?? slot);
  const facts = new Set<string>();

  // Imposter (Q8) transforms into the Pokémon across from it as it enters (data/abilities.ts:2115-2128): with that slot empty
  // what it copied is not known.
  const imposters = present.filter((slot) => shown[slot]!.abilityId === "imposter" && shown[slot]!.abilityActive);
  for (const slot of imposters) if (!shown[facing(slot)]) return { slots: empty, reason: REASONS.imposterAcross(labels[slot]) };

  // Trace (T2P §4.1): unset, against two foes whose copyable abilities differ, it copies either, 1/2 each: one start each.
  const tracer = (slot: DoublesSlotId) => shown[slot]!.abilityId === "trace" && !(shown[slot]!.itemId === "abilityshield" && !field.magicRoom);
  const tracing: { slot: DoublesSlotId; sources: DoublesSlotId[] }[] = [];
  for (const slot of present) {
    if (!tracer(slot) || shown[slot]!.tracedAbility) continue;
    // A foe's own Trace that may copy before this one (not slower at the lead) could be copied in turn: not followed.
    if (foes(slot).some((foe) => tracer(foe) && leadSpeed(shown[foe]!, runtime) >= leadSpeed(shown[slot]!, runtime))) return { slots: empty, reason: TRACE_RANDOM };
    const copyable = foes(slot).filter((foe) => !NO_TRACE_ABILITIES.has(shown[foe]!.abilityId));
    if (new Set(copyable.map((foe) => shown[foe]!.abilityId)).size < 2) continue;
    if (copyable.some((foe) => TRACE_CHANGES_ON_ENTRY.has(shown[foe]!.abilityId))) return { slots: empty, reason: TRACE_RANDOM };
    // A foe's Intimidate whose Start comes after this Trace's at the lead (not faster) meets the copy.
    const intimidatedAfter = foes(slot).some((foe) => shown[foe]!.abilityId === "intimidate" && leadSpeed(shown[foe]!, runtime) <= leadSpeed(shown[slot]!, runtime));
    if (intimidatedAfter && copyable.some((foe) => REACTS_TO_INTIMIDATE.has(shown[foe]!.abilityId))) return { slots: empty, reason: TRACE_RANDOM };
    tracing.push({ slot, sources: copyable });
    const [a, b] = copyable;
    facts.add(`Assumes ${labels[slot]}'s Trace copied as it came in: ${abilityName(shown[a]!.abilityId)} from ${labels[a]} or ${abilityName(shown[b]!.abilityId)} from ${labels[b]}, 1/2 each.`);
  }
  let combos: { weight: number; labels: string[]; picks: Partial<Record<DoublesSlotId, DoublesSlotId>> }[] = [{ weight: 1, labels: [], picks: {} }];
  for (const { slot, sources } of tracing) {
    combos = combos.flatMap((combo) => sources.map((source) => ({
      weight: combo.weight / sources.length, labels: [...combo.labels, `If ${labels[slot]}'s Trace copied ${abilityName(shown[source]!.abilityId)}.`],
      picks: { ...combo.picks, [slot]: source },
    })));
  }

  /** The order of two Pokémon's entries the input gives (entryOrder: the smaller rank came in first), or null. */
  const ranked = (a: DoublesSlotId, b: DoublesSlotId): boolean | null => {
    const first = input.entryOrder?.[a], second = input.entryOrder?.[b];
    return first !== undefined && second !== undefined && first !== second ? first < second : null;
  };

  const rowVariants: DoublesStartVariant[] = [];
  const walkVariants: DoublesStartVariant[] = [];
  for (const combo of combos) {
    const runs = settleRun(combo.picks);
    if (!Array.isArray(runs)) return { slots: empty, reason: runs };
    for (const run of runs) {
      for (const part of itemsOf(run)) {
        const weight = combo.weight * run.weight * part.weight;
        const label = [...combo.labels, ...run.labels, ...part.labels];
        rowVariants.push({ weight, slots: part.slots, label: label.length ? label.join(" ") : null });
        for (const walk of starfOf(part.slots)) {
          const copies = startCopies(walk.slots);
          // A copy not followed: the turn is not estimated; its start rows are this start's.
          if (typeof copies === "string") return { slots: part.slots, reason: copies, gas };
          const walkLabel = [...label, ...walk.labels];
          walkVariants.push({ weight: weight * walk.weight, slots: copies, label: walkLabel.length ? walkLabel.join(" ") : null });
        }
      }
    }
  }
  const result: DoublesSettle = { slots: walkVariants.length === 1 ? walkVariants[0].slots : rowVariants[0].slots, reason: null, gas };
  if (walkVariants.length > 1) result.variants = walkVariants;
  if (rowVariants.length > 1) {
    result.rowVariants = rowVariants;
    // The reads of one start (the moves pane's rows: doubles-turn.ts calculateDoublesMoves) take the first: each slot whose
    // start differs between them says which start that is.
    const [first] = rowVariants;
    const own = (slots: Slots, slot: DoublesSlotId) => JSON.stringify([slots[slot]!.folded, slots[slot]!.lines, slots[slot]!.items.settledHP ?? null]);
    result.slots = { ...first.slots };
    for (const slot of present) {
      if (first.label && rowVariants.some((variant) => own(variant.slots, slot) !== own(first.slots, slot))) {
        result.slots[slot] = { ...first.slots[slot]!, lines: [...first.slots[slot]!.lines, first.label] };
      }
    }
  }
  // A start copy waits for the first action's end, or for a Terastallization or Mega Evolution before it (data/abilities.ts
  // opportunist, data/items.ts mirrorherb onAnyAfterTerastallization, onAnyAfterMega), which the input does not set this turn.
  const startCopy = walkVariants.some((variant) => present.some((slot) => variant.slots[slot]!.copy && !input.pokemon[slot]!.carried?.copy));
  const changes = present.some((slot) => (runtime.profile.tera && shown[slot]!.mechanic === "tera") || megaEntries(shown[slot]!.speciesId, runtime).some((entry) => entry.label.startsWith("Mega")));
  if (startCopy && changes) facts.add("Assumes no Pokémon Terastallizes or Mega Evolves this turn.");
  if (facts.size) result.facts = [...facts];
  return result;

  // ---- abilities, the copied Intimidate and Download: one run per lead order, for one Trace pick ----
  function settleRun(picks: Partial<Record<DoublesSlotId, DoublesSlotId>>): Run[] | string {
    const traceReads = (slot: DoublesSlotId): SettleReads => (picks[slot] ? { traceSource: { build: shown[picks[slot]!]!, name: labels[picks[slot]!] } } : {});
    /**
     * Each need read from the Pokémon that has it, all four looked at (T2P §4.2: two Pokémon act on this one as the turn
     * starts). The representative is the Pokémon an Imposter copies, or the field's setter (the settle names it), else the
     * foe across. `items`: the item reads (Unnerve, the field's setter) besides the ability ones.
     */
    const readAll = (slot: DoublesSlotId, needs: Need[], view: (slot: DoublesSlotId) => BattleBuild, items: boolean): { rep: DoublesSlotId; reads: SettleReads } => {
      const negator = present.find((each) => WEATHER_NEGATORS.has(view(each).abilityId));
      const reads: SettleReads = { ...traceReads(slot), weatherNegated: negator ? abilityName(view(negator).abilityId) : null };
      let rep = across(slot);
      const trace = needs.find((need) => need.kind === "trace");
      if (trace) {
        const source = trace.slots.includes(across(slot)) ? across(slot) : trace.slots[0];
        reads.traceSource = { build: shown[source]!, name: labels[source] };
      }
      if (items) {
        reads.unnerved = foes(slot).some((foe) => UNNERVE_ABILITIES.has(view(foe).abilityId));
        const setter = needs.find((need) => need.kind === "setter")?.slots[0];
        reads.fieldSetter = setter ? view(setter).abilityId : null;
        if (setter) rep = setter;
      }
      const imposter = needs.find((need) => need.kind === "imposter");
      if (imposter) rep = imposter.slots[0];
      return { rep, reads };
    };
    /** The one Pokémon that meets every need (each a list of Pokémon that would do), or else readAll. */
    const pick = (slot: DoublesSlotId, needs: Need[], view: (slot: DoublesSlotId) => BattleBuild, items: boolean): { rep: DoublesSlotId; reads?: SettleReads } => {
      if (!needs.length) return { rep: across(slot) };
      const fits = others(slot).filter((other) => needs.every((need) => need.slots.includes(other)));
      if (fits.length) return { rep: fits.includes(across(slot)) ? across(slot) : fits[0] };
      return readAll(slot, needs, view, items);
    };
    const shownOf = (slot: DoublesSlotId) => shown[slot]!;
    // Phase 1: abilities and forms (Trace, Imposter, Forecast and Ice Face read the other battler).
    const needsA = Object.fromEntries(present.map((slot) => {
      const build = shown[slot]!;
      const needs: Need[] = [];
      const negators = others(slot).filter((other) => WEATHER_NEGATORS.has(shown[other]!.abilityId));
      const readsWeather = (build.abilityId === "forecast" && build.speciesId.startsWith("castform"))
        || (build.abilityId === "iceface" && build.speciesId === "eiscuenoice" && ["Snow", "Hail"].includes(field.weather));
      if (readsWeather && negators.length) needs.push({ kind: "negator", slots: negators });
      if (tracer(slot) && !build.tracedAbility && !picks[slot]) {
        const copyable = foes(slot).filter((foe) => !NO_TRACE_ABILITIES.has(shown[foe]!.abilityId));
        if (copyable.length) needs.push({ kind: "trace", slots: copyable });
      }
      if (imposters.includes(slot)) needs.push({ kind: "imposter", slots: [facing(slot)] });
      return [slot, needs];
    })) as Record<DoublesSlotId, Need[]>;
    const settleA = (slot: DoublesSlotId, rep: DoublesSlotId, reads?: SettleReads) => {
      const merged: SettleReads = { ...traceReads(slot), ...reads };
      const settled = settleAbilities(shown[slot]!, shown[rep]!, field, runtime, { label: labels[slot], otherLabel: labels[rep] }, tailwind(rep), !!gas && !holders.includes(slot),
        Object.keys(merged).length ? merged : undefined);
      // A Tera form's ability the gas suppresses (Embody Aspect, Tera Shell, Teraform Zero) stands in too.
      if (settled.suppressed && gas) gassed(slot, settled.suppressed, true);
      return settled;
    };
    const firstPick = Object.fromEntries(present.map((slot) => [slot, pick(slot, needsA[slot], shownOf, false)])) as Record<DoublesSlotId, ReturnType<typeof pick>>;
    const abilities = Object.fromEntries(present.map((slot) => [slot, settleA(slot, firstPick[slot].rep, firstPick[slot].reads)])) as Record<DoublesSlotId, ReturnType<typeof settleAbilities>>;
    for (const slot of present) if (abilities[slot].withheld) return abilities[slot].withheld!;
    // Phase 2: items (Unnerve and As One, Cloud Nine and Air Lock, the paradox field setters read the other battler).
    const settledA = (slot: DoublesSlotId) => abilities[slot].build;
    const reps = {} as Record<DoublesSlotId, DoublesSlotId>;
    const itemReads: Partial<Record<DoublesSlotId, SettleReads>> = {};
    for (const slot of present) {
      const build = settledA(slot);
      const needs: Need[] = [...needsA[slot]];
      const unnervers = foes(slot).filter((foe) => UNNERVE_ABILITIES.has(settledA(foe).abilityId));
      if (build.itemId.endsWith("berry") && unnervers.length) needs.push({ kind: "unnerve", slots: unnervers });
      const paradox = PARADOX_FIELDS[build.abilityId];
      if (paradox === "sun" && field.weather === "Sun") {
        const negators = others(slot).filter((other) => WEATHER_NEGATORS.has(settledA(other).abilityId));
        if (negators.length) needs.push({ kind: "negator", slots: negators });
      }
      const fieldOn = paradox === "sun" ? field.weather === "Sun" : paradox === "terrain" && field.terrain === "Electric";
      const setters = paradox && fieldOn ? others(slot).filter((other) => PARADOX_FIELD_SETTERS[paradox].includes(settledA(other).abilityId)) : [];
      if (setters.length) needs.push({ kind: "setter", slots: setters });
      const { rep, reads } = pick(slot, needs, settledA, true);
      reps[slot] = rep;
      if (reads) {
        // Two act on it: its items read each from its own Pokémon, and so do its abilities (from the Pokémon as shown).
        itemReads[slot] = reads;
        abilities[slot] = settleA(slot, rep, readAll(slot, needsA[slot], shownOf, false).reads);
      } else if (rep !== firstPick[slot].rep) {
        abilities[slot] = settleA(slot, rep);
      }
      if (abilities[slot].withheld) return abilities[slot].withheld!;
    }
    const lines = Object.fromEntries(present.map((slot) => [slot, [...abilities[slot].lines]])) as Record<DoublesSlotId, string[]>;
    const entered = Object.fromEntries(present.map((slot) => [slot, settledA(slot)])) as Record<DoublesSlotId, BattleBuild>;
    for (const slot of imposters) {
      if (entered[slot].transformedFrom) facts.add(`Assumes ${labels[slot]} transformed into ${labels[facing(slot)]} as both entered.`);
    }
    // Trace or Imposter copying Intimidate (T2P §4.1; the 1v1's settleEntry rule): its Start drops both foes in adjacentFoes()
    // order (foe position 0, then 1) with their reactions, unless its drops are stored (copiedIntimidateStored). An item it
    // used up was used as the Pokémon came in, not this turn (entryUsed).
    const entryUsed: Partial<Record<DoublesSlotId, string>> = {};
    for (const slot of present) {
      const copiedBy = shown[slot]!.abilityId === "trace" ? "Trace" : shown[slot]!.abilityId === "imposter" ? "Imposter" : null;
      if (!copiedBy || entered[slot].abilityId !== "intimidate") continue;
      const targets = foes(slot).sort((a, b) => SHOWDOWN_POSITION[a].position - SHOWDOWN_POSITION[b].position);
      if (!targets.length || copiedIntimidateStored(shown[slot]!, targets.map((foe) => shown[foe]!), runtime)) continue;
      // A Flower Veil partner guards a Grass-type foe (data/abilities.ts flowerveil onAllyTryBoost): the drops' model has no partner.
      if (targets.some((foe) => !!input.pokemon[allyOf(foe)] && entered[allyOf(foe)].abilityId === "flowerveil" && buildTypes(entered[foe], runtime).includes("Grass"))) {
        return REASONS.notIn2v2(`${copiedBy} copying Intimidate beside Flower Veil`);
      }
      const result = applyIntimidateToFoes(entered[slot], targets.map((foe) => ({ build: entered[foe], tailwind: tailwind(foe), name: labels[foe] })), {
        magicRoom: field.magicRoom, wonderRoom: field.wonderRoom, terrain: field.terrain, gameType: "Doubles", sourceTailwind: tailwind(slot), sourceName: labels[slot],
      }, runtime);
      const after = (each: DoublesSlotId, build: BattleBuild) => {
        if (entered[each].itemId && !build.itemId) entryUsed[each] = entered[each].itemId;
        entered[each] = build;
      };
      after(slot, result.source);
      targets.forEach((foe, index) => after(foe, result.foes[index]));
      // The engine's entry rises are in the folded stages here, and each foe's partner is known (no Flower Veil).
      lines[slot].push(`${cap(labels[slot])}'s Intimidate (copied by ${copiedBy}) is applied.`,
        ...result.lines.slice(1).filter((line) => !/\(added at calculation\)\.$|^Assumes Tailwind started|assumes no partner with Flower Veil\.$/.test(line)).map(cap));
    }
    const runs = downloadOf(entered, lines);
    return typeof runs === "string" ? runs : runs.map((run) => ({ ...run, reps, itemReads, entryUsed }));
  }

  // ---- Download at the lead (T2P §4.3) ----
  function downloadOf(entered: Record<DoublesSlotId, BattleBuild>, lines: Record<DoublesSlotId, string[]>): Pick<Run, "weight" | "labels" | "entered" | "lines">[] | string {
    const battle: IntimidateBattle = { magicRoom: field.magicRoom, wonderRoom: field.wonderRoom, terrain: field.terrain, gameType: "Doubles" };
    const downloads = present.filter((slot) => entered[slot].abilityId === "download");
    if (!downloads.length) return [{ weight: 1, labels: [], entered, lines }];
    const downloadNeeds = (foe: DoublesSlotId) => `Download needs ${labels[foe]}'s Defense and Sp. Def as it came in.`;
    // Each holder's foes' effects on their Defense and Sp. Def at the lead that its Start can come before or after.
    const effects = new Map<DoublesSlotId, Effect[]>();
    for (const slot of downloads) {
      const list: Effect[] = [];
      for (const foe of foes(slot)) {
        const build = entered[foe];
        if (imposters.includes(foe) && build.transformedFrom) { list.push({ foe, kind: "imposter" }); continue; }
        // A Pokémon transformed before this turn (Transform, or an Imposter the input gives transformed): which it was at
        // Download's Start is not known.
        if (build.transformedFrom) return downloadNeeds(foe);
        for (const entry of entryBoosts(build, entered[slot], null, tailwind(foe), { ...battle, tailwind: { source: tailwind(foe), target: tailwind(slot) } }, runtime)) {
          if (entry.stat !== "def" && entry.stat !== "spd") continue;
          list.push({ foe, entry, kind: SEEDS.has(entry.id) ? "seed" : entry.id === "dauntlessshield" ? "shield" : "embody" });
        }
      }
      effects.set(slot, list);
    }
    // Its own Speed at the lead (an Imposter's before it transformed).
    const speedOf = (slot: DoublesSlotId) => leadSpeed(imposters.includes(slot) ? shown[slot]! : entered[slot], runtime);
    // An effect whose order against the holder's Start is set by Speed: not a Seed (switch-in priority −1) or an Embody Aspect
    // (at Terastallization), both after it, and not an Imposter's transformation into the holder (the 1v1's rule: it came after).
    const bySpeed = (effect: Effect, slot: DoublesSlotId) => ranked(effect.foe, slot) === null && (effect.kind === "shield" || (effect.kind === "imposter" && facing(effect.foe) !== slot));
    const tied = new Set<DoublesSlotId>();
    for (const [slot, list] of effects) {
      for (const effect of list) if (bySpeed(effect, slot) && speedOf(effect.foe) === speedOf(slot)) { tied.add(slot); tied.add(effect.foe); }
    }
    // Every order of each group of tied Pokémon, 1/k! each (sim/battle.ts speedSort's shuffle of the leads: speedOrder).
    let orders: { weight: number; place: Map<DoublesSlotId, number> }[] = [{ weight: 1, place: new Map() }];
    for (const speed of new Set([...tied].map(speedOf))) {
      const perms = permutations([...tied].filter((slot) => speedOf(slot) === speed));
      orders = orders.flatMap((order) => perms.map((perm) => ({ weight: order.weight / perms.length, place: new Map([...order.place, ...perm.map((slot, at) => [slot, at] as const)]) })));
    }
    const before = (effect: Effect, slot: DoublesSlotId, place: Map<DoublesSlotId, number>): boolean => {
      const given = ranked(effect.foe, slot);
      if (effect.kind === "embody" || (effect.kind === "imposter" && facing(effect.foe) === slot)) return false;
      if (given !== null) return given;
      if (effect.kind === "seed") return false;
      const mine = speedOf(slot), theirs = speedOf(effect.foe);
      return theirs !== mine ? theirs > mine : place.get(effect.foe)! < place.get(slot)!;
    };
    const runs = new Map<string, Pick<Run, "weight" | "labels" | "entered" | "lines">>();
    for (const { weight, place } of orders) {
      const builds = { ...entered };
      const out = Object.fromEntries(present.map((slot) => [slot, [...lines[slot]]])) as Record<DoublesSlotId, string[]>;
      const key: string[] = [];
      const runLabels: string[] = [];
      for (const slot of downloads) {
        const holder = entered[slot];
        const list = effects.get(slot)!;
        let def = 0, spd = 0;
        const read: string[] = [];
        for (const foe of foes(slot)) {
          const own = list.filter((effect) => effect.foe === foe);
          let build: BattleBuild;
          const stages: Partial<Record<CombatStat, number>> = {};
          const imposter = own.find((effect) => effect.kind === "imposter");
          if (imposter) {
            const transformed = before(imposter, slot, place);
            key.push(`${slot}<${foe}:${transformed}`);
            if (transformed) {
              // Its stats then were its target's, its stages the target's entry rises then (the 1v1's rule: the target first).
              build = { ...entered[foe], boosts: { ...entered[foe].boosts, def: 0, spd: 0 } };
              const target = shown[facing(foe)]!;
              const zero = Object.fromEntries(COMBAT_STATS.map((stat) => [stat, 0])) as BattleBuild["boosts"];
              for (const entry of entryBoosts(target, { ...shown[foe]!, boosts: zero }, [], tailwind(facing(foe)), battle, runtime)) {
                if (!SEEDS.has(entry.id) && (entry.stat === "def" || entry.stat === "spd")) stages[entry.stat] = (stages[entry.stat] ?? 0) + entry.amount;
              }
              read.push(`${labels[foe]}'s Defense and Sp. Def after it transformed into ${labels[facing(foe)]}`);
            } else {
              build = { ...shown[foe]!, boosts: { ...shown[foe]!.boosts, def: 0, spd: 0 } };
              read.push(`${labels[foe]}'s Defense and Sp. Def before it transformed`);
            }
          } else {
            const lead = atLead(entered[foe], battle, runtime).foe;
            const forms = unknownLeadForms(entered[foe], runtime)?.speciesIds ?? [lead.speciesId];
            const reads = forms.map((speciesId) => getBuildStats({ ...lead, speciesId }, runtime));
            // Necrozma-Ultra or Zygarde-Complete, which could have come in as either of two forms with different defenses.
            if (reads.some((stats) => !stats || stats.def !== reads[0]!.def || stats.spd !== reads[0]!.spd)) return downloadNeeds(foe);
            build = { ...lead, speciesId: forms[0] };
            for (const effect of own) {
              const first = before(effect, slot, place);
              const entry = effect.entry!;
              key.push(`${slot}<${foe}.${entry.id}:${first}`);
              const what = effect.kind === "seed" ? `its ${entry.cause} was used` : effect.kind === "embody" ? "it Terastallized" : `its ${entry.cause} rise`;
              if (first) stages[entry.stat] = (stages[entry.stat] ?? 0) + entry.amount;
              read.push(`${labels[foe]}'s ${STAGE_NAMES[entry.stat]} ${first ? "after" : "before"} ${what}`);
            }
          }
          const stats = getBuildStats(build, runtime);
          if (!stats) continue;
          def += staged(stats.def, clampStage((build.boosts.def ?? 0) + (stages.def ?? 0)));
          spd += staged(stats.spd, clampStage((build.boosts.spd ?? 0) + (stages.spd ?? 0)));
        }
        // Pinned Showdown download onStart: Sp. Atk when the foes' Defense total is at least their Sp. Def total, else Attack.
        const stat: CombatStat | null = def && def >= spd ? "spa" : spd ? "atk" : null;
        if (!stat) continue;
        builds[slot] = { ...holder, boosts: { ...holder.boosts, [stat]: clampStage((holder.boosts[stat] ?? 0) + 1) }, settledDownload: stat };
        key.push(`${slot}=${stat}`);
        if (!list.length) {
          out[slot].push(`${cap(labels[slot])}'s Download raised its ${STAGE_NAMES[stat]}.`);
          continue;
        }
        // What the read rests on: the entry order given, else all four leading together and their Speeds at the lead.
        const shared: string[] = [], given: string[] = [];
        let together = false;
        for (const effect of list) {
          const order = ranked(effect.foe, slot);
          if (effect.kind === "imposter" && facing(effect.foe) === slot) { together = true; shared.push(`${labels[effect.foe]} transforming after ${labels[slot]}'s Start`); continue; }
          if (order !== null && effect.kind !== "embody") { given.push(`${labels[order ? effect.foe : slot]} came in first`); continue; }
          together = true;
          if (!bySpeed(effect, slot)) continue;
          const mine = speedOf(slot), theirs = speedOf(effect.foe);
          if (mine !== theirs) { shared.push(`${labels[theirs > mine ? effect.foe : slot]} first: ${Math.max(mine, theirs)} Speed against ${Math.min(mine, theirs)}`); continue; }
          const first = place.get(effect.foe)! < place.get(slot)! ? effect.foe : slot;
          runLabels.push(`If ${labels[first]} came in first.`);
          shared.push(`Speed tie at ${mine}`);
        }
        const why = [...(together ? [`assumes all four led together${shared.length ? `, ${[...new Set(shared)].join("; ")}` : ""}`] : []), ...new Set(given)].join("; ");
        out[slot].push(`${cap(labels[slot])}'s Download raised its ${STAGE_NAMES[stat]}: it read ${read.join(" and ")} (${why}).`);
      }
      const id = key.join("|");
      const known = runs.get(id);
      if (known) known.weight += weight;
      else runs.set(id, { weight, labels: [...new Set(runLabels)], entered: builds, lines: out });
    }
    return [...runs.values()];
  }

  // ---- the turn's first Update: items, the Custap Berry's FractionalPriority ----
  /**
   * The items of each slot of a run (settleItems), with the Custap Berry's FractionalPriority before the Update
   * (sim/battle-queue.ts:249, from 0; data/items.ts:1235-1256): Quick Draw (priority −1) first, 30% of attacks; a Custap Berry
   * at its line is eaten only while the value is at most 0 (Quick Draw's 0.1 keeps it), and never for a Mycelium Might
   * holder's status move. With Quick Draw, one start each way: the Berry kept at 0.3 (Quick Draw's 0.1), eaten at 0.7.
   */
  function itemsOf(run: Run): Part[] {
    const one = (slot: DoublesSlotId, keepCustap: boolean): DoublesStartSlot => {
      const entered = run.entered;
      // A status its own ability cures at the turn's first Update (OWN_STATUS_CURES) is the walk's: its Berry stays.
      const ownCure = !!OWN_STATUS_CURES[entered[slot].abilityId]?.includes(entered[slot].status);
      // status2 (E1): a carried Embargo ignores the item at this Update (ignoringItem); a carried Heal Block stops an HP Berry;
      // a carried Berserk or Anger Shell lock fails the holder's TryEatItem for its healing Berry (PS/data/abilities.ts berserk,
      // angershell onTryEatItem: checkedBerserk false; Berry Juice is used, not eaten). Not under Neutralizing Gas (its stand-in)
      // or a carried Gastro Acid (applied later, in the kernel): a suppressed ability runs no onTryEatItem (sim/pokemon.ts ignoringAbility).
      const carried = input.pokemon[slot]!.carried;
      const held = entered[slot].itemId;
      const embargoed = carried?.embargo !== undefined;
      const locked = !!carried?.berryLocked && !carried.gastroAcid && (entered[slot].abilityId === "berserk" || entered[slot].abilityId === "angershell") && BERSERK_BERRIES.has(held);
      const hidden = keepCustap || (carried?.healBlock !== undefined && HEALING_BERRIES.has(held)) || locked;
      const settling = embargoed ? { ...entered[slot], itemSuppressed: true as const } : hidden ? { ...entered[slot], itemId: "" } : entered[slot];
      const settledItems = settleItems(settling, entered[run.reps[slot]] ?? entered[slot], field, runtime, { label: labels[slot] }, names[slot], ownCure, run.itemReads[slot]);
      const items = hidden ? { ...settledItems, build: { ...settledItems.build, itemId: held } } : settledItems;
      const build = items.build;
      const itemOn = !field.magicRoom && !klutzActive(build, build) && !embargoed;
      const entry = entryStagesOf(build, build.abilityId, itemOn, field.terrain, tailwind(slot), runtime);
      const boosts = Object.fromEntries(COMBAT_STATS.map((stat) => [stat, clampStage((build.boosts[stat] ?? 0) + (entry.stages[stat] ?? 0))])) as BattleBuild["boosts"];
      const folded: BattleBuild = { ...build, boosts, ...(entry.seed ? { itemId: "" } : {}) };
      // An item the copied Intimidate used up as the Pokémon came in: gone from the start, but not used this turn (doubles-turn.ts
      // startWorld reads a use this turn from items.build, which keeps it).
      const used = run.entryUsed[slot];
      return { build, folded, items: used ? { ...items, build: { ...build, itemId: used } } : items, lines: [...gasLines[slot], ...run.lines[slot], ...items.lines], representative: run.reps[slot] };
    };
    const base = Object.fromEntries(DOUBLES_SLOTS.map((slot) => [slot, input.pokemon[slot] ? one(slot, false) : null])) as Slots;
    let parts: Part[] = [{ weight: 1, labels: [], slots: base }];
    for (const slot of present) {
      if (!base[slot]!.items.build.settledCustap) continue;
      const moveId = input.pokemon[slot]!.action.moveId;
      const status = !moveId || runtime.movesById.get(moveId)?.category === "Status";
      const ability = run.entered[slot].abilityId;
      // Mycelium Might's status move (or No move): the Custap Berry is not eaten (its handler returns first).
      if (ability === "myceliummight" && status) {
        const keep = one(slot, true);
        parts = parts.map((part) => ({ ...part, slots: { ...part.slots, [slot]: keep } }));
        continue;
      }
      if (ability !== "quickdraw" || status) continue;
      const keep: DoublesStartSlot = { ...one(slot, true), fractional: [{ value: 0.1, chance: 1, fact: "Quick Draw" }] };
      const eat: DoublesStartSlot = { ...base[slot]!, fractional: [{ value: 0.1, chance: 1 }] };
      parts = parts.flatMap((part) => [
        { weight: part.weight * 0.3, labels: [...part.labels, `If ${labels[slot]}'s Quick Draw activated.`], slots: { ...part.slots, [slot]: keep } },
        { weight: part.weight * 0.7, labels: [...part.labels, `If ${labels[slot]} ate its Custap Berry.`], slots: { ...part.slots, [slot]: eat } },
      ]);
    }
    return parts;
  }

  /**
   * A Starf Berry eaten at the turn's first Update (data/items.ts starfberry onEat: this.sample over the five stats below +6,
   * its +2 through boost()): one start per stat, the rise in the stages (generation 7 orders the turn from the Speed before it).
   */
  function starfOf(slots: Slots): Part[] {
    let parts: Part[] = [{ weight: 1, labels: [], slots }];
    for (const slot of present) {
      const start = slots[slot]!;
      const starf = start.items.starf;
      if (!starf) continue;
      const open = COMBAT_STATS.filter((stat) => (start.folded.boosts[stat] ?? 0) < 6);
      if (!open.length) continue;
      const options = open.map((stat) => {
        const raise = (build: BattleBuild): BattleBuild => {
          const was = build.boosts[stat] ?? 0;
          const next: BattleBuild = { ...build, boosts: { ...build.boosts, [stat]: clampStage(was + starf.amount) } };
          if (stat === "spe" && runtime.profile.generation === 7 && !build.firstTurnSpeed) next.firstTurnSpeed = { spe: was, unburden: false, item: itemName("starfberry") };
          return next;
        };
        const rise = clampStage((start.folded.boosts[stat] ?? 0) + starf.amount) - (start.folded.boosts[stat] ?? 0);
        const { starf: pending, ...rest } = start.items;
        void pending;
        const items: SettledItems = { ...rest, build: raise(start.items.build), ...(rise > 0 ? { raised: { ...rest.raised, [stat]: (rest.raised?.[stat] ?? 0) + rise } } : {}) };
        return { stat, start: { ...start, build: raise(start.build), folded: raise(start.folded), items } as DoublesStartSlot };
      });
      parts = parts.flatMap((part) => options.map(({ stat, start: one }) => ({
        weight: part.weight / options.length, labels: [...part.labels, `If ${labels[slot]}'s Starf Berry raised its ${STAGE_NAMES[stat]}.`], slots: { ...part.slots, [slot]: one },
      })));
    }
    return parts;
  }

  /**
   * The start copies (SPEC2 §4.5, F4 §4.1): a rise at the turn's first Update (a pinch Berry's, a Starf Berry's) reaches each
   * foe's Opportunist (an ability in effect) and working Mirror Herb (data/abilities.ts opportunist, data/items.ts mirrorherb
   * onFoeAfterBoost: the positive parts, summed), pending with a copy carried from the last turn until the first action's end.
   * A Pokémon with both is not followed (two effect states).
   */
  function startCopies(slots: Slots): Slots | string {
    let out: Slots | null = null;
    const both = REASONS.copiesRise(`${abilityName("opportunist")} with ${itemName("mirrorherb")}`);
    for (const slot of present) {
      const raised = slots[slot]!.items.raised;
      if (!raised || !Object.values(raised).some((amount) => amount! > 0)) continue;
      for (const foe of foes(slot)) {
        const copier = slots[foe]!.folded;
        const carried = input.pokemon[foe]!.carried;
        const opportunist = copier.abilityId === "opportunist";
        const herb = copier.itemId === "mirrorherb" && !field.magicRoom && !klutzActive(copier, copier) && carried?.embargo === undefined;
        if (!opportunist && !herb) continue;
        if (opportunist && herb) return both;
        const by = opportunist ? "opportunist" : "mirrorherb";
        out ??= { ...slots };
        const kept = carried?.copy && Object.keys(carried.copy).length
          ? { stages: { ...carried.copy } as Partial<Record<CombatStat, number>>, by: (copier.abilityId === "opportunist" ? "opportunist" : "mirrorherb") as typeof by } : undefined;
        const pending = out[foe]!.copy ?? kept;
        if (pending && pending.by !== by) return both;
        const stages: Partial<Record<CombatStat, number>> = { ...pending?.stages };
        for (const [stat, amount] of Object.entries(raised) as [CombatStat, number][]) if (amount > 0) stages[stat] = (stages[stat] ?? 0) + amount;
        out[foe] = { ...out[foe]!, copy: { stages, by } };
      }
    }
    return out ?? slots;
  }
}

/** Every order of the list (k! of them). */
function permutations<T>(list: readonly T[]): T[][] {
  if (list.length < 2) return [[...list]];
  return list.flatMap((item, at) => permutations([...list.slice(0, at), ...list.slice(at + 1)]).map((rest) => [item, ...rest]));
}

const VARIANT_SETTLES = new WeakMap<DoublesSettle, { weight: number; settle: DoublesSettle }[]>();
/**
 * The start variants of a turn (T2P §4.0; doubles-turn.ts rootWorlds): each a settle and its weight, the weights summing to
 * 1. One settle when the start has no random part. The guards known before the walk (presenceGuards) read the first start:
 * none of them reads what the starts differ by (a traceable ability, stages, a Custap Berry held or eaten).
 */
export function variants(kernel: TurnKernel, settle: DoublesSettle): { weight: number; settle: DoublesSettle }[] {
  void kernel;
  let list = VARIANT_SETTLES.get(settle);
  if (!list) {
    list = settle.variants?.length ? settle.variants.map((variant) => ({ weight: variant.weight, settle: { slots: variant.slots, reason: settle.reason, gas: settle.gas } })) : [{ weight: 1, settle }];
    VARIANT_SETTLES.set(settle, list);
  }
  return list;
}

/** The turn facts the start gives (doubles-turn.ts turnFacts): Trace's copy, Imposter's transformation, a start copy's wait. */
export function turnFacts(settle: DoublesSettle): string[] {
  return settle.facts ?? [];
}

/**
 * The start rows over the starts the rows differ by (T2P §4.0; doubles-turn.ts calculateDoublesTurn, `rows` its startRows of
 * one settle): a pair's row once when every start gives it alike (with the assumptions all of them give), else each start's
 * own with that start's label as its fact.
 */
export function rowsByVariant(settle: DoublesSettle, rows: (one: DoublesSettle) => DoublesStartRow[]): DoublesStartRow[] {
  const list = settle.rowVariants;
  if (!list || list.length < 2) return rows(settle);
  const each = list.map((variant) => {
    const seen = new Map<string, number>();
    return rows({ slots: variant.slots, reason: settle.reason, gas: settle.gas }).map((row) => {
      const pair = `${row.slot}>${row.target}`;
      const n = seen.get(pair) ?? 0;
      seen.set(pair, n + 1);
      return { key: `${pair}#${n}`, row };
    });
  });
  const keys: string[] = [];
  for (const rowsOf of each) for (const { key } of rowsOf) if (!keys.includes(key)) keys.push(key);
  const bare = (row: DoublesStartRow) => JSON.stringify({ ...row, row: { ...row.row, assumptions: [] } });
  const out: DoublesStartRow[] = [];
  for (const key of keys) {
    const found = each.map((rowsOf) => rowsOf.find((entry) => entry.key === key)?.row);
    const first = found[0];
    if (first && found.every((row) => row && bare(row) === bare(first))) {
      out.push({ ...first, row: { ...first.row, assumptions: first.row.assumptions.filter((line) => found.every((row) => row!.row.assumptions.includes(line))) } });
      continue;
    }
    found.forEach((row, at) => {
      if (!row) return;
      const fact = [list[at].label, row.fact].filter(Boolean).join(" ");
      out.push({ ...row, ...(fact ? { fact } : {}) });
    });
  }
  return out;
}

/**
 * Custap Berry with Quick Draw or Mycelium Might (doubles-turn.ts presenceGuards): modelled at the start (settleDoublesStart:
 * the Berry kept for a Mycelium Might status move, Quick Draw's 30% a start of its own), so nothing stops the turn here.
 */
export function custapGuard(kernel: TurnKernel, w: World, slot: DoublesSlotId) {
  void kernel; void w; void slot;
}

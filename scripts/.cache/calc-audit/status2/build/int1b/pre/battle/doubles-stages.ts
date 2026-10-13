import { DOUBLES_SLOTS, foesOf, slotSide, type DoublesSlotId } from "./doubles-types";
import type { PendingAction, Stage, World } from "./doubles-world";
import type { TurnKernel } from "./doubles-turn";
import * as fieldNs from "./doubles-field";
import * as guardNs from "./doubles-guards";
import { breaks, canSwitch, generation, hitFact, setVol, STAGE_NAMES, stageFact, STATS, type Use } from "./doubles-use";
import type { StatusStages } from "./status-table";
import type { BattleBuild, CombatStat } from "./types";

// The hook namespaces are copied once into plain objects: under tsx (the bench and the verify harness) a namespace
// import's member is a getter over the module's own export getter, while a plain object keeps each hook call one property
// load. No runtime import of these modules is in a cycle (tests/source/status2-hooks.test.ts), so each namespace is
// complete when this module runs, and every export is a function or a const.
const fieldHooks = { ...fieldNs };
const guardHooks = { ...guardNs };

// Stat stages (status2 SPEC2 §3.5, §4.2): Track A1's file. applyBoosts, selfBoost, foeDrop and foesLeft are moved verbatim
// from doubles-status.ts (status-eot's Track A); the ledger write is D's guards.noteRise and Mist is A3's field.mistBlocks
// (both hooks inserted here). writeStages (F1 §3.1's direct write) and whiteHerbAfterMove (applyBoosts' White Herb block,
// extracted) are A1's direct writes. Wave 1a (A1) adds Intimidate's own TryBoost and AfterBoost handlers for an Intimidate
// that starts mid-turn (`intimidate`, F1 §3.4.7, SA27), a White Herb the caller runs at the move's end (`herb: false`) and the
// active move's suppression read as it started (`breakHolder`); with none of the three, applyBoosts is today's.

/** The options of one boost() (applyBoosts). */
export type BoostOptions = {
  use?: Use; effect?: "move" | "ability" | "item" | null; reflected?: boolean; broken?: boolean; report?: boolean; by?: string;
  /**
   * status2 A1: Intimidate's Attack drop (data/abilities.ts intimidate onStart: boost({atk: −1}, target, holder, null, true),
   * the effect named Intimidate): Guard Dog's TryBoost (priority 2, before Clear Amulet: no drop, +1 Attack), from generation 8
   * Inner Focus, Oblivious, Own Tempo and Scrappy's (no drop), then the AfterBoost of Rattled (generation 8 on: +1 Speed) and
   * Adrenaline Orb (used unless its holder's Speed is +6 or the drop was capped at −6: +1 Speed). PS/data/mods/gen7/abilities.ts
   * has none of the generation 8 handlers (SA27).
   */
  intimidate?: boolean;
  /** status2 A1: false: White Herb is the caller's (whiteHerbAfterMove at the move's end: more than one stage change before its AfterMove). */
  herb?: false;
  /**
   * status2 A1: whether the active move suppresses `holder`'s breakable ability (sim/battle.ts suppressingAbility: the
   * activeMove's ignoreAbility, set by its user's Mold Breaker as the move started), in place of `use`'s or `broken`'s.
   */
  breakHolder?: (holder: DoublesSlotId) => boolean;
};

/** Intimidate's TryBoost from generation 8 (data/abilities.ts innerfocus, oblivious, owntempo, scrappy onTryBoost; Scrappy is not breakable). */
const INTIMIDATE_BLOCKERS: Readonly<Record<string, { breakable: boolean }>> = {
  innerfocus: { breakable: true }, oblivious: { breakable: true }, owntempo: { breakable: true }, scrappy: { breakable: false },
};

/**
 * Stages on `slot` from `source` (sim/battle.ts boost): none while the target's foes have no Pokémon left (generation 6+);
 * ChangeBoost (Contrary, Simple; breakable), the ±6 cap, TryBoost on a change from another Pokémon (Clear Amulet first;
 * Clear Body, White Smoke, Hyper Cutter, Big Pecks, Keen Eye, Mind's Eye, Flower Veil on a Grass type of its side, all
 * breakable; Full Metal Body; Mirror Armor turning each drop not already at −6 back onto a living source, once); then per
 * stat that changed, AfterEachBoost: Defiant (+2 Attack) and Competitive (+2 Sp. Atk) for a drop from a foe; then White
 * Herb (after the move: data/items.ts whiteherb onAnyAfterMove), which restores accuracy and evasion too. Accuracy and evasion
 * are this turn's stages (MoveVolatiles.stages, from 0); no calculation reads them (Stored Power, Power Trip and Punishment are
 * guarded where one is positive: doubles-turn.ts applyStep). `report`: each stat's fact on the use, before its reactions ("−2 Attack.",
 * "Its Attack cannot go higher."; `by`, the ability that raised it: "Defiant: +2 Attack."). The stages that changed, by how much.
 */
export function applyBoosts(kernel: TurnKernel, w: World, slot: DoublesSlotId, changes: StatusStages, source: DoublesSlotId | null,
  opts: BoostOptions = {}): Partial<Record<Stage, number>> {
  const mon = w.mons[slot]!;
  if (mon.fainted) return {};
  if (generation(kernel) > 5 && !foesLeft(kernel, w, slot)) return {};
  const use = opts.use;
  const breaksHolder = (holder: DoublesSlotId) => opts.breakHolder ? opts.breakHolder(holder)
    : opts.broken !== undefined ? opts.broken && holder !== source : !!use && breaks(kernel, w, use, holder);
  const ability = mon.build.abilityId;
  const suppressed = breaksHolder(slot);
  // The options a boost this one sets off passes on (no longer Intimidate's).
  const inner = { use, broken: false, breakHolder: opts.breakHolder, report: true, ...(opts.herb === false ? { herb: false as const } : {}) };
  let boost: Partial<Record<Stage, number>> = { ...changes };
  // ChangeBoost: Contrary, Simple.
  if (!suppressed && ability === "contrary") for (const stat of Object.keys(boost) as Stage[]) boost[stat] = -boost[stat]!;
  if (!suppressed && ability === "simple") for (const stat of Object.keys(boost) as Stage[]) boost[stat] = boost[stat]! * 2;
  const wanted = { ...boost };
  // getCappedBoost (accuracy and evasion: this turn's stages, MoveVolatiles.stages).
  const current = (stat: Stage) => (stat === "accuracy" || stat === "evasion" ? mon.vol.stages?.[stat] ?? 0 : mon.build.boosts[stat as CombatStat] ?? 0);
  const capped: Partial<Record<Stage, number>> = {};
  for (const [stat, amount] of Object.entries(boost) as [Stage, number][]) {
    if (!amount) continue;
    capped[stat] = Math.max(-6, Math.min(6, current(stat) + amount)) - current(stat);
  }
  boost = capped;
  // TryBoost from another Pokémon.
  const other = !!source && source !== slot;
  const facts: string[] = [];
  const dropAll = (by: string) => { if (Object.values(boost).some((amount) => amount! < 0)) facts.push(`${by}: its stats are not lowered.`); for (const stat of Object.keys(boost) as Stage[]) if (boost[stat]! < 0) delete boost[stat]; };
  if (other) {
    // status2 A1: Guard Dog against Intimidate (data/abilities.ts guarddog onTryBoost, priority 2: before Clear Amulet's 1;
    // breakable): the drop is gone and it raises its own Attack at once (boost({atk: 1}, target, target, null, false, true)).
    if (opts.intimidate && ability === "guarddog" && !suppressed && boost.atk) {
      delete boost.atk;
      applyBoosts(kernel, w, slot, { atk: 1 }, slot, { ...inner, effect: "ability", by: kernel.abilityName("guarddog") });
    }
    if (mon.build.itemId === "clearamulet" && kernel.itemWorks(w, mon.build)) dropAll(kernel.itemName("clearamulet"));
    // status2 A1: Inner Focus, Oblivious, Own Tempo and Scrappy keep Intimidate's drop off from generation 8 (priority 0).
    const blocker = opts.intimidate && generation(kernel) >= 8 ? INTIMIDATE_BLOCKERS[ability] : undefined;
    if (blocker && boost.atk && !(blocker.breakable && suppressed)) {
      delete boost.atk;
      facts.push(`${kernel.abilityName(ability)}: its Attack is not lowered.`);
    }
    if ((ability === "clearbody" || ability === "whitesmoke") && !suppressed) dropAll(kernel.abilityName(ability));
    if (ability === "fullmetalbody") dropAll(kernel.abilityName(ability));
    const single = (stat: Stage, held: string) => { if (ability === held && !suppressed && (boost[stat] ?? 0) < 0) { delete boost[stat]; facts.push(`${kernel.abilityName(held)}: its ${STAGE_NAMES[stat]} is not lowered.`); } };
    single("atk", "hypercutter"); single("def", "bigpecks"); single("accuracy", "keeneye"); single("accuracy", "mindseye");
    // Illuminate's onTryBoost keeps accuracy from falling from generation 9 (data/abilities.ts illuminate; data/mods/gen8 has none).
    if (generation(kernel) >= 9) single("accuracy", "illuminate");
    if (kernel.typesOf(mon.build).includes("Grass")) {
      const veil = DOUBLES_SLOTS.find((holder) => slotSide(holder) === slotSide(slot) && kernel.alive(w, holder) && holder !== w.ghost && w.mons[holder]!.build.abilityId === "flowerveil" && !breaksHolder(holder));
      if (veil) dropAll(kernel.abilityName("flowerveil"));
    }
    if (ability === "mirrorarmor" && !suppressed && !opts.reflected) {
      const back: Partial<Record<Stage, number>> = {};
      for (const [stat, amount] of Object.entries(boost) as [Stage, number][]) {
        if (amount >= 0 || current(stat) === -6) continue;
        back[stat] = amount;
        delete boost[stat];
      }
      if (Object.keys(back).length && source && w.mons[source] && !w.mons[source]!.fainted) {
        facts.push(`${kernel.abilityName("mirrorarmor")}: the drop goes back to ${kernel.names[source]}.`);
        applyBoosts(kernel, w, source, back, slot, { ...opts, intimidate: false, reflected: true, effect: "ability", broken: false, report: true, by: undefined });
      }
    }
    // Mist (A3, status2 SPEC2 §4.1 step 5: a side condition, no Speed: last, after Mirror Armor; F40, CR06). Step 0: never.
    if (fieldHooks.mistBlocks(kernel, w, slot, source!, opts)) dropAll(kernel.moveName("mist"));
  }
  if (use) for (const text of facts) hitFact(kernel, use, slot, text, w);
  // The table AfterBoost reads (after ChangeBoost, the cap and TryBoost): a rise for a foe's Opportunist or Mirror Herb, a
  // drop for Eject Pack, recorded for the action's eventGuards (doubles-turn.ts) whatever the stages end at (D's ledger:
  // doubles-guards.ts noteRise, the rises summed by stat).
  guardHooks.noteRise(kernel, w, slot, boost);
  // Apply, stat by stat, with AfterEachBoost.
  const boosts = { ...mon.build.boosts };
  const hidden = { ...mon.vol.stages };
  const changed: Partial<Record<Stage, number>> = {};
  let raised = false, lowered = false;
  for (const [stat, amount] of Object.entries(boost) as [Stage, number][]) {
    changed[stat] = amount;
    if (!amount) continue;
    if (stat !== "accuracy" && stat !== "evasion") boosts[stat as CombatStat] = current(stat) + amount;
    else hidden[stat] = current(stat) + amount;
    if (amount > 0) raised = true; else lowered = true;
  }
  mon.build = { ...mon.build, boosts };
  if (Object.keys(hidden).length) setVol(w, slot, { stages: hidden });
  if (raised) mon.statsRaised = true;
  if (lowered) mon.statsLowered = true;
  // Each stat's message (`by`: the ability or item that raised it), then its reactions (sim/battle.ts boost: AfterEachBoost).
  if (use && opts.report) {
    for (const [stat, amount] of Object.entries(changed) as [Stage, number][]) {
      const text = amount ? stageFact(stat, amount) : `its ${STAGE_NAMES[stat]} cannot go ${(wanted[stat] ?? 0) > 0 ? "higher" : "lower"}.`;
      hitFact(kernel, use, slot, opts.by ? `${opts.by}: ${text}` : amount ? text : `I${text.slice(1)}`, w);
    }
  }
  // Defiant and Competitive (data/abilities.ts defiant, competitive onAfterEachBoost: each stat a foe lowered).
  if (source && kernel.isFoe(source, slot)) {
    for (const amount of Object.values(changed)) {
      if (!(amount! < 0)) continue;
      const rise = ability === "defiant" ? { atk: 2 } : ability === "competitive" ? { spa: 2 } : null;
      if (!rise) continue;
      applyBoosts(kernel, w, slot, rise, slot, { ...opts, intimidate: false, effect: "ability", broken: false, report: true, by: kernel.abilityName(ability) });
    }
  }
  // status2 A1: Intimidate's AfterBoost on its target (the table after TryBoost and the cap): Rattled from generation 8
  // (onAfterBoost: boost.atk not 0), then Adrenaline Orb (an item: after the ability; onAfterBoost: not at +6 Speed and the drop
  // not capped to 0: useItem, its boosts {spe: 1} from itself, the event's target: PS/sim/pokemon.ts useItem), then the item gone.
  if (opts.intimidate) {
    if (generation(kernel) >= 8 && mon.build.abilityId === "rattled" && boost.atk) {
      applyBoosts(kernel, w, slot, { spe: 1 }, slot, { ...inner, effect: "ability", by: kernel.abilityName("rattled") });
    }
    if (mon.build.itemId === "adrenalineorb" && kernel.itemWorks(w, mon.build) && !mon.fainted && (mon.build.boosts.spe ?? 0) !== 6 && boost.atk !== 0) {
      applyBoosts(kernel, w, slot, { spe: 1 }, slot, { ...inner, effect: "item", by: kernel.itemName("adrenalineorb") });
      mon.build = { ...mon.build, itemId: "", ...(mon.build.abilityId === "unburden" ? { abilityActive: true } : {}) };
      kernel.noteItemUse(w, slot, "adrenalineorb");
    }
  }
  // White Herb (after the move: data/items.ts whiteherb onStart reads every stage, accuracy and evasion included).
  if (opts.herb !== false) whiteHerbAfterMove(kernel, w, slot, use);
  return changed;
}

/**
 * White Herb after the move (data/items.ts whiteherb onAnyAfterMove: onStart reads every stage, accuracy and evasion
 * included): a working White Herb on `slot` with a stage below 0 is used (item gone, Unburden active), those stages to 0;
 * the hit fact on the use. Moved out of applyBoosts (its last block); writeStages calls it too.
 */
export function whiteHerbAfterMove(kernel: TurnKernel, w: World, slot: DoublesSlotId, use: Use | undefined) {
  const mon = w.mons[slot]!;
  const lowHidden = (["accuracy", "evasion"] as const).filter((stat) => (mon.vol.stages?.[stat] ?? 0) < 0);
  if (mon.build.itemId === "whiteherb" && kernel.itemWorks(w, mon.build) && (STATS.some((stat) => (mon.build.boosts[stat] ?? 0) < 0) || lowHidden.length)) {
    mon.build = { ...mon.build, itemId: "", ...(mon.build.abilityId === "unburden" ? { abilityActive: true } : {}), boosts: Object.fromEntries(STATS.map((stat) => [stat, Math.max(0, mon.build.boosts[stat] ?? 0)])) as BattleBuild["boosts"] };
    if (lowHidden.length) setVol(w, slot, { stages: Object.fromEntries(Object.entries(mon.vol.stages ?? {}).map(([stat, stage]) => [stat, Math.max(0, stage!)])) });
    kernel.noteItemUse(w, slot, "whiteherb");
    if (use) hitFact(kernel, use, slot, `${kernel.itemName("whiteherb")}: its lowered stats are restored.`, w);
  }
}

/**
 * A direct stage write (status2 F1 §3.1: Psych Up, the swaps, Topsy-Turvy, Transform's copy, Costar, Curious Medicine):
 * `build.boosts` and `vol.stages` (accuracy, evasion) set as given; no World.boosted entry, no TryBoost, no Defiant, no
 * statsRaised or statsLowered (Showdown sets them only in boost()); then White Herb at the action's AfterMove (`herb: false`:
 * the caller runs whiteHerbAfterMove at the move's end, after the move's other stage changes).
 */
export function writeStages(kernel: TurnKernel, w: World, slot: DoublesSlotId, stages: Partial<Record<Stage, number>>, use?: Use, opts: { herb?: false } = {}) {
  const mon = w.mons[slot]!;
  const boosts = { ...mon.build.boosts };
  const hidden = { ...mon.vol.stages };
  for (const [stat, value] of Object.entries(stages) as [Stage, number][]) {
    if (stat === "accuracy" || stat === "evasion") hidden[stat] = Math.max(-6, Math.min(6, value));
    else boosts[stat as CombatStat] = Math.max(-6, Math.min(6, value));
  }
  mon.build = { ...mon.build, boosts };
  const kept = Object.fromEntries(Object.entries(hidden).filter(([, value]) => value !== undefined && value !== 0));
  setVol(w, slot, { stages: Object.keys(kept).length ? kept : undefined });
  if (opts.herb !== false) whiteHerbAfterMove(kernel, w, slot, use);
}

/** Whether `slot`'s foes have a Pokémon left (sim/side.ts foePokemonLeft): one in, or a bench (an empty slot means none, DoublesTurnInput.pokemon). */
export function foesLeft(kernel: TurnKernel, w: World, slot: DoublesSlotId): boolean {
  const foes = foesOf(slot);
  if (foes.some((foe) => kernel.alive(w, foe))) return true;
  if (foes.some((foe) => !kernel.input.pokemon[foe])) return false;
  return canSwitch(kernel, slotSide(foes[0]));
}

/** A boost the Pokémon gives itself (sim/battle.ts boost: Contrary, Simple, the ±6 cap): an ability's or an item's (no facts). */
export function selfBoost(kernel: TurnKernel, w: World, slot: DoublesSlotId, changes: Partial<Record<CombatStat, number>>, action: PendingAction | null) {
  void action;
  applyBoosts(kernel, w, slot, changes, slot, { effect: null, broken: false });
}

/**
 * A drop on `slot` from `source` from a damaging path (a protecting move's contact effect, a Max Move, Mud-Slap's accuracy
 * drop): applyBoosts with `broken` the source's Mold Breaker passing the target's breakable abilities; `reflected`: a drop
 * Mirror Armor sent back.
 */
export function foeDrop(kernel: TurnKernel, w: World, slot: DoublesSlotId, changes: StatusStages, source: DoublesSlotId | null, broken = false, reflected = false) {
  applyBoosts(kernel, w, slot, changes, source, { effect: "move", broken, reflected });
}

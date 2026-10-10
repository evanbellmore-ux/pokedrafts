import { megaEntries } from "./mega-forms";
import { getBuildStats } from "./model";
import type { BattleRuntime } from "./runtime";
import type { BattleBuild, BattleConditions, CombatStat } from "./types";

const STATS: CombatStat[] = ["atk", "def", "spa", "spd", "spe"];
const STAT_NAMES: Record<CombatStat, string> = { atk: "Attack", def: "Defense", spa: "Sp. Atk", spd: "Sp. Def", spe: "Speed" };

type Change = Partial<Record<CombatStat, number>>;
type Effect = "Intimidate" | "Mirror Armor" | "Mirror Herb" | "item" | "self";
/** `id` is the ability or item behind the boost, `cause` its name. */
export type EntryBoost = { stat: CombatStat; amount: number; id: string; cause: string };
type Mon = {
  build: BattleBuild; boosts: Record<CombatStat, number>; start: Record<CombatStat, number>; item: string; name: string;
  herb: Change | null; lowered: boolean; entry: EntryBoost[];
};

export type IntimidateBattle = {
  magicRoom: boolean;
  wonderRoom?: boolean;
  terrain?: BattleConditions["terrain"];
  /** Tailwind on the Intimidate user's side and on the target's side (Wind Rider). */
  tailwind?: { source: boolean; target: boolean };
  gameType?: BattleConditions["gameType"];
  /**
   * The name each Pokémon goes by in the lines, as its caller names it (a 1v1 mirror's "Incineroar (yours)" and
   * "Incineroar (opponent's)"); absent, its species name.
   */
  names?: { source: string; target: string };
};
export type IntimidateResult = { source: BattleBuild; target: BattleBuild; lines: string[] };

const SEED_TERRAIN: Record<string, { terrain: BattleConditions["terrain"]; stat: CombatStat }> = {
  grassyseed: { terrain: "Grassy", stat: "def" }, electricseed: { terrain: "Electric", stat: "def" },
  psychicseed: { terrain: "Psychic", stat: "spd" }, mistyseed: { terrain: "Misty", stat: "spd" },
};
const EMBODY_STAT: Record<string, CombatStat> = {
  embodyaspectcornerstone: "def", embodyaspecthearthflame: "atk", embodyaspectteal: "spe", embodyaspectwellspring: "spd",
};

const staged = (stat: number, stage: number) => stage >= 0 ? Math.floor(stat * (2 + stage) / 2) : Math.floor(stat * 2 / (2 - stage));
const clampStage = (stage: number) => Math.max(-6, Math.min(6, stage));
/** Held items that change Speed on entry (pinned Showdown onModifySpe): Choice Scarf 1.5x; Iron Ball, Macho Brace and the Power items 0.5x. */
const ENTRY_SPEED_ITEMS: Record<string, number> = {
  choicescarf: 6144, ironball: 2048, machobrace: 2048, poweranklet: 2048, powerband: 2048, powerbelt: 2048, powerbracer: 2048, powerlens: 2048, powerweight: 2048,
};

/**
 * A Pokémon's Speed as the leads enter (pinned Showdown getActionSpeed, taken when its runSwitch is
 * queued): its stat and held item only, since no stage, status, Tailwind or Trick Room is up yet. It
 * orders Download against Dauntless Shield, and neither ability changes Speed or suppresses items.
 */
export function leadSpeed(build: BattleBuild, runtime: BattleRuntime): number {
  const speed = getBuildStats(build, runtime)?.spe ?? 0;
  return Math.trunc((speed * (ENTRY_SPEED_ITEMS[build.itemId] ?? 4096) + 2047) / 4096);
}

/**
 * The foe's entry boosts already on it when Download reads it at a shared lead (pinned Showdown
 * runSwitch: switch-in effects by priority, then Speed): Dauntless Shield (priority 0) only from a
 * faster holder (a Speed tie is random; this counts it, as the engine does), never a terrain Seed
 * (priority -1), and never Embody Aspect, which acts when Ogerpon Terastallizes during the turn.
 */
export function beforeDownload(holder: BattleBuild, foe: BattleBuild, foeEntry: EntryBoost[], runtime: BattleRuntime): EntryBoost[] {
  const shieldFirst = leadSpeed(foe, runtime) >= leadSpeed(holder, runtime);
  return foeEntry.filter((entry) => entry.id === "dauntlessshield" ? shieldFirst : !SEED_TERRAIN[entry.id] && !EMBODY_STAT[entry.id]);
}

/**
 * Battle forms taken after Download acts at a shared lead, with how: Schooling and Shields Down (switch-in
 * priority -1), Relic Song, Ice Face breaking, Stance Change (when it attacks), Zen Mode (end of the turn)
 * and Zero to Hero (after switching out).
 */
const AFTER_LEAD_FORMS: Record<string, string> = {
  wishiwashischool: "formed a school", miniormeteor: "became Minior-Meteor", meloettapirouette: "became Meloetta-Pirouette",
  eiscuenoice: "lost its Ice Face", aegislashblade: "changed to Blade Forme", darmanitanzen: "entered Zen Mode",
  darmanitangalarzen: "entered Zen Mode", palafinhero: "became Palafin-Hero",
};

/**
 * The form a Pokémon had when Download read it at a shared lead, if it has changed since, and how:
 * Mega Evolution and Ultra Burst (turn actions), Primal Reversion, Schooling and Shields Down (switch-in
 * priority -1, after Download's 0), Relic Song and a broken Ice Face; and Ogerpon's Terastallization,
 * whose Tera form has the same stats (`change` is then null). The Crowned forms and Terapagos-Terastal
 * take their form before Download acts; Necrozma-Ultra and Zygarde-Complete, whose entry form is not
 * known, keep theirs (unknownLeadForms).
 */
export function leadForm(build: BattleBuild, runtime: BattleRuntime): { speciesId: string; change: string | null } | null {
  const species = runtime.speciesById.get(build.speciesId);
  if (!species || build.transformedFrom) return null;
  const megas = megaEntries(build.speciesId, runtime);
  const bases = [...new Set(megas.map((entry) => entry.baseSpeciesId))];
  if (bases.length === 1) {
    const label = megas[0].label;
    return { speciesId: bases[0], change: label.startsWith("Mega") ? "Mega Evolved" : label === "Primal" ? "underwent Primal Reversion" : "used Ultra Burst" };
  }
  if (bases.length || !species.changesFrom || !runtime.speciesById.has(species.changesFrom)) return null;
  if (AFTER_LEAD_FORMS[species.id]) return { speciesId: species.changesFrom, change: AFTER_LEAD_FORMS[species.id] };
  return species.baseSpecies === "ogerpon" && species.battleForm ? { speciesId: species.changesFrom, change: null } : null;
}

/**
 * The possible lead forms of a form that changed after Download acted but could have led as either of two
 * (Necrozma-Ultra from Dusk Mane or Dawn Wings by Ultra Burst, Zygarde-Complete from Zygarde or Zygarde-10%
 * by Power Construct at the end of the turn), with the base species that changed and how, or null.
 */
export function unknownLeadForms(build: BattleBuild, runtime: BattleRuntime): { speciesIds: string[]; base: string; change: string } | null {
  const species = runtime.speciesById.get(build.speciesId);
  if (!species || build.transformedFrom) return null;
  const bases = [...new Set(megaEntries(build.speciesId, runtime).map((entry) => entry.baseSpeciesId))];
  const base = runtime.speciesById.get(species.baseSpecies)?.name ?? species.baseSpecies;
  if (bases.length > 1) return { speciesIds: bases, base, change: "used Ultra Burst" };
  const forms = build.speciesId === "zygardecomplete" ? (species.battleOnly ?? []).filter((id) => runtime.speciesById.has(id)) : [];
  return forms.length > 1 ? { speciesIds: forms, base, change: "became Zygarde-Complete" } : null;
}

/**
 * The foe as Download read it at a shared lead: in its lead form, with no Defense or Sp. Def stages yet
 * (beforeDownload adds the entry boosts that came first) and no room up.
 */
export function atLead(foe: BattleBuild, battle: IntimidateBattle, runtime: BattleRuntime): { foe: BattleBuild; battle: IntimidateBattle } {
  const lead = leadForm(foe, runtime);
  return { foe: { ...foe, ...(lead ? { speciesId: lead.speciesId } : {}), boosts: { ...foe.boosts, def: 0, spd: 0 } }, battle: { ...battle, wonderRoom: false } };
}

/** The stat Download raises against the foe's stages plus these entry boosts (pinned Showdown download onStart). */
export function downloadStat(foe: BattleBuild, foeEntry: EntryBoost[], battle: IntimidateBattle, runtime: BattleRuntime): CombatStat | null {
  const stats = getBuildStats(foe, runtime);
  if (!stats) return null;
  const stage = (stat: CombatStat) => clampStage((foe.boosts[stat] ?? 0) + foeEntry.filter((entry) => entry.stat === stat).reduce((sum, entry) => sum + entry.amount, 0));
  // Download ignores Wonder Room, but the stages then apply to the other defensive stat.
  const def = staged(stats.def, stage(battle.wonderRoom ? "spd" : "def"));
  const spd = staged(stats.spd, stage(battle.wonderRoom ? "def" : "spd"));
  return spd <= def ? "spa" : "atk";
}

/**
 * Stage changes the engine adds on every calculation for entry effects it models itself (gen789.js
 * and champions.js: checkSeedBoost, checkDauntlessShield, checkEmbody, checkDownload,
 * checkIntrepidSword, checkWindRider; Champions runs only the Seeds). In Showdown they are already
 * on the Pokémon when Intimidate resolves, and White Herb (switch-in priority -2) acts after them.
 * Download counts only the foe's boosts that came before it at a shared lead (beforeDownload), and
 * reads the foe's form then with no room up yet (atLead); when the engine's pick differs, the
 * calculation bakes this one in (settleEntry, settledDownload).
 */
/** Without `foeEntry`, Download (which reads the foe's stages after its own entry boosts) is left out. */
export function entryBoosts(build: BattleBuild, foe: BattleBuild, foeEntry: EntryBoost[] | null, tailwind: boolean, battle: IntimidateBattle, runtime: BattleRuntime): EntryBoost[] {
  const out: EntryBoost[] = [];
  // Magic Room holds back a Seed unless it was used before the room was set (itemUsedBeforeRoom);
  // settleItems then adds that stage itself, since the engine drops a Magic Room item first.
  // A Klutz the foe's Neutralizing Gas suppresses lets items work, unless an Ability Shield keeps it.
  const klutz = build.abilityId === "klutz" && !(foe.abilityId === "neutralizinggas" && build.itemId !== "abilityshield");
  // (It stays held after the room ends, so the switch counts without Magic Room too.)
  const itemOn = !klutz && build.itemUsedBeforeRoom !== false;
  const seed = SEED_TERRAIN[build.itemId];
  if (seed && itemOn && battle.terrain === seed.terrain) {
    // Showdown's boost(): Contrary inverts it and Simple doubles it.
    const amount = (build.abilityId === "contrary" ? -1 : 1) * (build.abilityId === "simple" ? 2 : 1);
    out.push({ stat: seed.stat, amount, id: build.itemId, cause: runtime.itemsById.get(build.itemId)?.name ?? build.itemId });
  }
  if (runtime.profile.id === "champions") return out;
  const own = (stat: CombatStat) => ({ stat, amount: 1, id: build.abilityId, cause: runtime.abilitiesById.get(build.abilityId)?.name ?? build.abilityId });
  const gen8 = runtime.profile.id === "sword_shield";
  if (build.abilityId === "dauntlessshield" && (gen8 || build.abilityActive)) out.push(own("def"));
  if (runtime.profile.id === "scarlet_violet" && EMBODY_STAT[build.abilityId]) out.push(own(EMBODY_STAT[build.abilityId]));
  if (build.abilityId === "download" && foeEntry) {
    const lead = atLead(foe, battle, runtime);
    const stat = downloadStat(lead.foe, beforeDownload(build, foe, foeEntry, runtime), lead.battle, runtime);
    if (stat) out.push(own(stat));
  }
  if (build.abilityId === "intrepidsword" && (gen8 || build.abilityActive)) out.push(own("atk"));
  if (build.abilityId === "windrider" && tailwind) out.push(own("atk"));
  return out;
}

/**
 * Intimidate from `source` against `target`, as pinned Showdown resolves it on entry (data/abilities.ts
 * intimidate, sim/battle.ts boost: ChangeBoost, the stage cap, TryBoost, AfterEachBoost, AfterBoost,
 * then the switch-in White Herb and Mirror Herb). The result is stored in both builds' stages and
 * items, so later form changes (Mega Evolution) keep it and each calculation never re-applies it.
 * Covers Contrary, Simple, Guard Dog, Clear Body and its kin, Hyper Cutter, Inner Focus / Own Tempo /
 * Oblivious / Scrappy (from Sword/Shield on), Flower Veil on a Grass-type holder, Mirror Armor,
 * Defiant, Competitive, Rattled, Clear Amulet, Adrenaline Orb, White Herb and Mirror Herb. It works
 * on the stages the Pokémon really have, counting the entry boosts the engine adds at calculation
 * time, and stores the result without them so the engine does not add them twice.
 */
/**
 * Who a stored Intimidate drop belongs to: the base species of the Pokémon whose stages hold it (a
 * Mega keeps its base species), so a later copy against that Pokémon is not applied again.
 */
export function intimidatedKey(build: BattleBuild, runtime: BattleRuntime): string {
  return runtime.speciesById.get(build.speciesId)?.baseSpecies ?? build.speciesId;
}

export function applyIntimidate(source: BattleBuild, target: BattleBuild, battle: IntimidateBattle, runtime: BattleRuntime): IntimidateResult {
  const result = intimidateAll(source, [{ build: target, tailwind: battle.tailwind?.target ?? false, name: battle.names?.target }], {
    ...battle, sourceTailwind: battle.tailwind?.source ?? false, sourceName: battle.names?.source,
  }, runtime);
  return { source: result.source, target: result.foes[0], lines: result.lines };
}

/**
 * Intimidate from `source` into each foe in order (pinned Showdown data/abilities.ts intimidate onStart: for each of
 * adjacentFoes(), position 0 then 1, boost({ atk: -1 })), the source updated after each (a Mirror Armor drop is
 * reflected onto it, and its Defiant or Competitive reacts). The switch-in White Herb (priority -2) and Mirror Herb
 * (-3) act once, after both drops; the rises the source's Mirror Herb stores come from every foe. Each Pokémon is named
 * in the lines by the name its caller gives (`name`, `sourceName`: 2v2's doublesNames).
 */
export function applyIntimidateToFoes(
  source: BattleBuild,
  foes: readonly { build: BattleBuild; tailwind: boolean; name: string }[],
  battle: Omit<IntimidateBattle, "tailwind" | "names"> & { sourceTailwind: boolean; sourceName: string },
  runtime: BattleRuntime,
): { source: BattleBuild; foes: BattleBuild[]; lines: string[] } {
  return intimidateAll(source, foes, battle, runtime);
}

function intimidateAll(
  source: BattleBuild,
  foes: readonly { build: BattleBuild; tailwind: boolean; name: string | undefined }[],
  battle: Omit<IntimidateBattle, "tailwind" | "names"> & { sourceTailwind: boolean; sourceName: string | undefined },
  runtime: BattleRuntime,
): { source: BattleBuild; foes: BattleBuild[]; lines: string[] } {
  const gen7 = runtime.profile.id === "ultra_sun_ultra_moon";
  const gen9 = runtime.profile.id === "champions" || runtime.profile.id === "scarlet_violet";
  const speciesName = (build: BattleBuild) => runtime.speciesById.get(build.speciesId)?.name ?? build.speciesId;
  // Each Pokémon goes by the name its caller gives, else its species name (index 0 is the source).
  const builds = [source, ...foes.map((foe) => foe.build)];
  const name = (index: number, given: string | undefined) => given ?? speciesName(builds[index]);
  const itemName = (id: string) => runtime.itemsById.get(id)?.name ?? id;
  const lines: string[] = [];
  const first = foes[0]?.build ?? source;
  const mon = (index: number, given: string | undefined, entry: EntryBoost[]): Mon => {
    const build = builds[index];
    const boosts = Object.fromEntries(STATS.map((stat) => [stat,
      clampStage((build.boosts[stat] ?? 0) + entry.filter((boost) => boost.stat === stat).reduce((sum, boost) => sum + boost.amount, 0))])) as Record<CombatStat, number>;
    return { build, item: build.itemId, name: name(index, given), herb: null, lowered: false, entry, boosts, start: { ...boosts } };
  };
  const src = mon(0, battle.sourceName, entryBoosts(source, first, entryBoosts(first, source, null, foes[0]?.tailwind ?? false, battle, runtime), battle.sourceTailwind, battle, runtime));
  const tgts = foes.map((foe, index) => mon(index + 1, foe.name, entryBoosts(foe.build, source, entryBoosts(source, foe.build, null, battle.sourceTailwind, battle, runtime), foe.tailwind, battle, runtime)));
  // The foe whose drop is being resolved: a rise of the source is stored by its Mirror Herb; a target's rise by the source's.
  let tgt = tgts[0];
  // Showdown ignores held items under Magic Room and for a Klutz holder.
  const holds = (m: Mon, id: string) => m.item === id && !battle.magicRoom && m.build.abilityId !== "klutz";
  const ability = (m: Mon) => m.build.abilityId;
  const consumeItem = (m: Mon, what: string) => { lines.push(`${m.name}'s ${itemName(m.item)} ${what} (used up).`); m.item = ""; };
  // A Terastallized Pokémon has only its Tera type; Stellar keeps the original types.
  const types = (m: Mon) => {
    const tera = runtime.profile.tera && m.build.mechanic === "tera" ? m.build.configuration?.teraType : undefined;
    return tera && tera !== "Stellar" ? [tera] : runtime.speciesById.get(m.build.speciesId)?.types ?? [];
  };

  function boost(m: Mon, other: Mon, input: Change, effect: Effect): void {
    const change: Change = { ...input };
    // ChangeBoost
    for (const stat of STATS) {
      if (change[stat] === undefined) continue;
      if (ability(m) === "contrary") change[stat] = -change[stat]!;
      else if (ability(m) === "simple") change[stat] = change[stat]! * 2;
    }
    // getCappedBoost: a drop at -6 (or a rise at +6) becomes 0.
    for (const stat of STATS) {
      if (change[stat] === undefined) continue;
      change[stat] = clampStage(m.boosts[stat] + change[stat]!) - m.boosts[stat];
    }
    // TryBoost, for changes caused by another Pokémon.
    if (effect !== "self" && effect !== "item") {
      if (gen9 && ability(m) === "guarddog" && effect === "Intimidate" && change.atk) {
        delete change.atk;
        lines.push(`${m.name}'s Guard Dog turns Intimidate into a boost.`);
        boost(m, m, { atk: 1 }, "self");
      }
      const negatives = STATS.filter((stat) => (change[stat] ?? 0) < 0);
      if (negatives.length && gen9 && holds(m, "clearamulet")) {
        negatives.forEach((stat) => delete change[stat]);
        lines.push(`${m.name}'s Clear Amulet blocks the drop.`);
      } else if (negatives.length && ["clearbody", "whitesmoke", "fullmetalbody"].includes(ability(m))) {
        negatives.forEach((stat) => delete change[stat]);
        lines.push(`${m.name}'s ${runtime.abilitiesById.get(ability(m))?.name} blocks the drop.`);
      } else if (negatives.length && ability(m) === "flowerveil" && types(m).includes("Grass")) {
        // Flower Veil (onAllyTryBoost, which includes the holder) guards a Grass-type Pokémon.
        negatives.forEach((stat) => delete change[stat]);
        lines.push(`${m.name}'s Flower Veil blocks the drop.`);
      } else if ((change.atk ?? 0) < 0 && ability(m) === "hypercutter") {
        delete change.atk;
        lines.push(`${m.name}'s Hyper Cutter blocks the drop.`);
      } else if (!gen7 && effect === "Intimidate" && change.atk && ["innerfocus", "owntempo", "oblivious", "scrappy"].includes(ability(m))) {
        delete change.atk;
        lines.push(`${m.name}'s ${runtime.abilitiesById.get(ability(m))?.name} blocks Intimidate.`);
      } else if (!gen7 && ability(m) === "mirrorarmor" && effect !== "Mirror Armor") {
        for (const stat of STATS.filter((entry) => (change[entry] ?? 0) < 0)) {
          const reflected = change[stat]!;
          delete change[stat];
          lines.push(`${m.name}'s Mirror Armor reflects the drop back to ${other.name}.`);
          boost(other, m, { [stat]: reflected }, "Mirror Armor");
        }
      }
    }
    // Apply each stat, then AfterEachBoost (Defiant, Competitive) for a real change.
    for (const stat of STATS) {
      if (change[stat] === undefined) continue;
      const before = m.boosts[stat];
      m.boosts[stat] = clampStage(before + change[stat]!);
      const by = m.boosts[stat] - before;
      if (!by) {
        if (effect === "Intimidate" || effect === "Mirror Armor") lines.push(`${m.name}'s ${STAT_NAMES[stat]} ${before <= -6 ? "won't go lower" : "won't go higher"}.`);
        continue;
      }
      lines.push(`${m.name}'s ${STAT_NAMES[stat]} ${by > 0 ? "rises" : "falls"} to ${m.boosts[stat] > 0 ? "+" : ""}${m.boosts[stat]}.`);
      if (by < 0) m.lowered = true;
      if (by < 0 && effect !== "self" && effect !== "item" && m !== other) {
        if (ability(m) === "defiant") { lines.push(`${m.name}'s Defiant reacts.`); boost(m, m, { atk: 2 }, "self"); }
        if (ability(m) === "competitive") { lines.push(`${m.name}'s Competitive reacts.`); boost(m, m, { spa: 2 }, "self"); }
      }
    }
    // AfterBoost
    if (effect === "Intimidate") {
      if (!gen7 && ability(m) === "rattled" && change.atk) { lines.push(`${m.name}'s Rattled reacts.`); boost(m, m, { spe: 1 }, "self"); }
      // Adrenaline Orb also works when an ability blocks the drop, but not when the stage cap stops it.
      if (holds(m, "adrenalineorb") && m.boosts.spe !== 6 && change.atk !== 0) {
        consumeItem(m, "activates");
        boost(m, m, { spe: 1 }, "item");
      }
    }
    // The foe's Mirror Herb (Scarlet/Violet) stores this Pokémon's rises.
    if (effect !== "Mirror Herb") {
      const foe = m === src ? tgt : src;
      if (gen9 && holds(foe, "mirrorherb")) {
        for (const stat of STATS) {
          if ((change[stat] ?? 0) > 0) foe.herb = { ...foe.herb, [stat]: (foe.herb?.[stat] ?? 0) + change[stat]! };
        }
      }
    }
  }

  lines.push(`${src.name}'s Intimidate:`);
  for (const [index, foe] of foes.entries()) {
    tgt = tgts[index];
    // The target's Neutralizing Gas suppresses Intimidate unless Ability Shield (not under Magic Room)
    // keeps it; the switch-in items below still act.
    if (foe.build.abilityId === "neutralizinggas" && !(source.itemId === "abilityshield" && !battle.magicRoom)) {
      lines.push(`${tgt.name}'s Neutralizing Gas suppresses it.`);
    } else {
      boost(tgt, src, { atk: -1 }, "Intimidate");
    }
  }
  // Switch-in items: White Herb (priority -2), then Mirror Herb (-3). The Intimidate user's own
  // rises are never stored for the target's Mirror Herb (Intimidate raises nothing on its user).
  for (const m of [...tgts, src]) {
    if (holds(m, "whiteherb") && STATS.some((stat) => m.boosts[stat] < 0)) {
      for (const stat of STATS) if (m.boosts[stat] < 0) m.boosts[stat] = 0;
      consumeItem(m, "restores its lowered stats");
    }
  }
  if (src.herb && holds(src, "mirrorherb")) {
    const copied = src.herb;
    consumeItem(src, "copies the rises");
    boost(src, src, copied, "Mirror Herb");
  }
  for (const m of [...tgts, src]) {
    if (m.lowered && holds(m, "ejectpack")) lines.push(`${m.name}'s Eject Pack: assumes it stays in.`);
    if (m.item !== m.build.itemId && m.build.abilityId === "unburden") lines.push(`${m.name}'s Unburden activates.`);
  }
  // A Flower Veil partner (Doubles) guards a Grass-type Pokémon; there is no slot for it.
  for (const m of tgts) {
    if (battle.gameType === "Doubles" && m.lowered && types(m).includes("Grass") && runtime.abilitiesById.has("flowerveil")) {
      lines.push(`${m.name}: assumes no partner with Flower Veil.`);
    }
  }
  for (const m of [src, ...tgts]) {
    if (!m.entry.length) continue;
    const list = m.entry.map((entry) => `${entry.cause} (${entry.amount > 0 ? "+" : ""}${entry.amount} ${STAT_NAMES[entry.stat]})`).join(" and ");
    lines.push(`${m.name}'s stored stages leave out its ${list} (added at calculation).`);
    if (m.entry.some((entry) => entry.id === "windrider")) lines.push("Assumes Tailwind started before Intimidate.");
  }
  const finish = (m: Mon): BattleBuild => {
    const consumed = m.item !== m.build.itemId;
    const bonus = (stat: CombatStat) => m.entry.filter((entry) => entry.stat === stat).reduce((sum, entry) => sum + entry.amount, 0);
    return {
      ...m.build, itemId: m.item,
      // An unchanged stage keeps its stored value, since the calculator's own cap can hide the entry boost.
      boosts: Object.fromEntries(STATS.map((stat) => [stat, m.boosts[stat] === m.start[stat] ? m.build.boosts[stat] ?? 0 : clampStage(m.boosts[stat] - bonus(stat))])) as BattleBuild["boosts"],
      // Unburden activates once its holder's item is used up.
      ...(consumed && m.build.abilityId === "unburden" ? { abilityActive: true } : {}),
    };
  };
  if (lines.length === 1) lines.push(tgts.length === 1 ? `${tgts[0].name} is unaffected.` : `${tgts.map((m) => m.name).join(" and ")} are unaffected.`);
  return { source: finish(src), foes: tgts.map(finish), lines };
}

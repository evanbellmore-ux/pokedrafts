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
  /** Where each Pokémon stands ("left" / "right"), to tell apart two of the same species. */
  positions?: { source: string; target: string };
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

/**
 * Stage changes the engine adds on every calculation for entry effects it models itself (gen789.js
 * and champions.js: checkSeedBoost, checkDauntlessShield, checkEmbody, checkDownload,
 * checkIntrepidSword, checkWindRider; Champions runs only the Seeds). In Showdown they are already
 * on the Pokémon when Intimidate resolves, and White Herb (switch-in priority -2) acts after them.
 */
/** Without `foeEntry`, Download (which reads the foe's stages after its own entry boosts) is left out. */
export function entryBoosts(build: BattleBuild, foe: BattleBuild, foeEntry: EntryBoost[] | null, tailwind: boolean, battle: IntimidateBattle, runtime: BattleRuntime): EntryBoost[] {
  const out: EntryBoost[] = [];
  const itemOn = !battle.magicRoom && build.abilityId !== "klutz";
  const seed = SEED_TERRAIN[build.itemId];
  if (seed && itemOn && battle.terrain === seed.terrain) {
    out.push({ stat: seed.stat, amount: build.abilityId === "contrary" ? -1 : 1, id: build.itemId, cause: runtime.itemsById.get(build.itemId)?.name ?? build.itemId });
  }
  if (runtime.profile.id === "champions") return out;
  const own = (stat: CombatStat) => ({ stat, amount: 1, id: build.abilityId, cause: runtime.abilitiesById.get(build.abilityId)?.name ?? build.abilityId });
  const gen8 = runtime.profile.id === "sword_shield";
  if (build.abilityId === "dauntlessshield" && (gen8 || build.abilityActive)) out.push(own("def"));
  if (runtime.profile.id === "scarlet_violet" && EMBODY_STAT[build.abilityId]) out.push(own(EMBODY_STAT[build.abilityId]));
  if (build.abilityId === "download" && foeEntry) {
    const stats = getBuildStats(foe, runtime);
    if (stats) {
      const stage = (stat: CombatStat) => clampStage((foe.boosts[stat] ?? 0) + foeEntry.filter((entry) => entry.stat === stat).reduce((sum, entry) => sum + entry.amount, 0));
      // Download ignores Wonder Room, but the stages then apply to the other defensive stat.
      const def = staged(stats.def, stage(battle.wonderRoom ? "spd" : "def"));
      const spd = staged(stats.spd, stage(battle.wonderRoom ? "def" : "spd"));
      out.push(own(spd <= def ? "spa" : "atk"));
    }
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
  const gen7 = runtime.profile.id === "ultra_sun_ultra_moon";
  const gen9 = runtime.profile.id === "champions" || runtime.profile.id === "scarlet_violet";
  const speciesName = (build: BattleBuild) => runtime.speciesById.get(build.speciesId)?.name ?? build.speciesId;
  const sameName = speciesName(source) === speciesName(target);
  const name = (build: BattleBuild, position: string | undefined) => sameName && position ? `${speciesName(build)} (${position})` : speciesName(build);
  const itemName = (id: string) => runtime.itemsById.get(id)?.name ?? id;
  const lines: string[] = [];
  const sourcePlain = entryBoosts(source, target, null, battle.tailwind?.source ?? false, battle, runtime);
  const targetPlain = entryBoosts(target, source, null, battle.tailwind?.target ?? false, battle, runtime);
  const mon = (build: BattleBuild, position: string | undefined, entry: EntryBoost[]): Mon => {
    const boosts = Object.fromEntries(STATS.map((stat) => [stat,
      clampStage((build.boosts[stat] ?? 0) + entry.filter((boost) => boost.stat === stat).reduce((sum, boost) => sum + boost.amount, 0))])) as Record<CombatStat, number>;
    return { build, item: build.itemId, name: name(build, position), herb: null, lowered: false, entry, boosts, start: { ...boosts } };
  };
  const src = mon(source, battle.positions?.source, entryBoosts(source, target, targetPlain, battle.tailwind?.source ?? false, battle, runtime));
  const tgt = mon(target, battle.positions?.target, entryBoosts(target, source, sourcePlain, battle.tailwind?.target ?? false, battle, runtime));
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
        if (effect === "Intimidate" || effect === "Mirror Armor") lines.push(`${m.name}'s ${STAT_NAMES[stat]} ${before <= -6 ? "won't go lower" : "won't go higher"}, so nothing reacts.`);
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
      const foe = m === tgt ? src : tgt;
      if (gen9 && holds(foe, "mirrorherb")) {
        for (const stat of STATS) {
          if ((change[stat] ?? 0) > 0) foe.herb = { ...foe.herb, [stat]: (foe.herb?.[stat] ?? 0) + change[stat]! };
        }
      }
    }
  }

  lines.push(`${src.name}'s Intimidate:`);
  // The target's Neutralizing Gas suppresses Intimidate unless Ability Shield (not under Magic Room)
  // keeps it; the switch-in items below still act.
  if (target.abilityId === "neutralizinggas" && !(source.itemId === "abilityshield" && !battle.magicRoom)) {
    lines.push(`${tgt.name}'s Neutralizing Gas suppresses it.`);
  } else {
    boost(tgt, src, { atk: -1 }, "Intimidate");
  }
  // Switch-in items: White Herb (priority -2), then Mirror Herb (-3). The Intimidate user's own
  // rises are never stored for the target's Mirror Herb (Intimidate raises nothing on its user).
  for (const m of [tgt, src]) {
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
  for (const m of [tgt, src]) {
    if (m.lowered && holds(m, "ejectpack")) lines.push(`${m.name}'s Eject Pack would switch it out; results assume it stays in.`);
    if (m.item !== m.build.itemId && m.build.abilityId === "unburden") lines.push(`${m.name}'s Unburden activates.`);
  }
  // A Flower Veil partner (Doubles) guards a Grass-type Pokémon; there is no slot for it.
  if (battle.gameType === "Doubles" && tgt.lowered && types(tgt).includes("Grass") && runtime.abilitiesById.has("flowerveil")) {
    lines.push(`${tgt.name} is Grass type: a partner with Flower Veil would block this drop in Doubles. Edit the stages if one is there.`);
  }
  for (const m of [src, tgt]) {
    if (!m.entry.length) continue;
    const list = m.entry.map((entry) => `${entry.cause} (${entry.amount > 0 ? "+" : ""}${entry.amount} ${STAT_NAMES[entry.stat]})`).join(" and ");
    lines.push(`${m.name}'s stages count its ${list}, which the calculator adds when it calculates, so the stored stages leave it out.`);
    if (m.entry.some((entry) => entry.id === "windrider")) lines.push("This assumes Tailwind started before the Intimidate.");
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
  if (lines.length === 1) lines.push(`${tgt.name} is unaffected.`);
  return { source: finish(src), target: finish(tgt), lines };
}

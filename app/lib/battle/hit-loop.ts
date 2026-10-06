import type { CombatStat } from "./types";

/**
 * The attacker's side of one use's hits into one target, in pinned Showdown's order (sim/battle-actions.ts
 * hitStepMoveHitLoop and spreadMoveHit, sim/battle.ts spreadDamage and heal): what each hit's draining
 * heals, what the target deals back in the hit's DamagingHit handlers, the berry the attacker eats at the
 * Update after it, and the hit on which it faints. hitStepMoveHitLoop stops a single-target move's hits
 * once the user has fainted (`if (!pokemon.hp && targets.length === 1) break`), so no later hit lands.
 * Shared by the calculation's rows (calculate.ts) and Uses to KO (uses-to-ko.ts).
 */

/** An HP berry as arithmetic: at or below `line` HP (any HP for Enigma, after a super-effective hit), then `heal` and Cheek Pouch's `pouch`. */
export type Berry = { line: number; heal: number; pouch: number; max: number; enigma: boolean };

export const HEALING_BERRIES = new Set(["sitrusberry", "oranberry", "berryjuice", "figyberry", "wikiberry", "magoberry", "aguavberry", "iapapaberry", "enigmaberry"]);
export const PINCH_HEAL_BERRIES = new Set(["figyberry", "wikiberry", "magoberry", "aguavberry", "iapapaberry"]);
export const PINCH_STAT_BERRIES: Record<string, CombatStat> = { liechiberry: "atk", ganlonberry: "def", petayaberry: "spa", apicotberry: "spd", salacberry: "spe" };
export const UNNERVES = new Set(["unnerve", "asoneglastrier", "asonespectrier"]);
/** Abilities that power up their type at a third of the user's HP or less (pinned Showdown blaze, torrent, overgrow, swarm onModifyAtk / onModifySpA). */
export const PINCH_TYPES: Record<string, string> = { blaze: "Fire", torrent: "Water", overgrow: "Grass", swarm: "Bug" };
/** Pinned Showdown data/abilities.ts flags.cantsuppress: setAbility never replaces these, nor sets them. */
export const CANT_SUPPRESS = new Set(["asoneglastrier", "asonespectrier", "battlebond", "comatose", "disguise", "gulpmissile", "iceface", "multitype", "powerconstruct",
  "rkssystem", "schooling", "shieldsdown", "stancechange", "terashift", "zenmode", "zerotohero"]);
/** Pinned Showdown data/abilities.ts flags.failskillswap: skillSwap (Wandering Spirit) fails with either side's. */
export const FAIL_SKILL_SWAP = new Set([...CANT_SUPPRESS, "commander", "embodyaspectcornerstone", "embodyaspecthearthflame", "embodyaspectteal", "embodyaspectwellspring",
  "hungerswitch", "illusion", "neutralizinggas", "poisonpuppeteer", "protosynthesis", "quarkdrive", "teraformzero", "terashell", "wonderguard"]);

/** Items Klutz never suppresses (pinned Showdown data/items.ts ignoreKlutz; sim/pokemon.ts ignoringItem). */
export const KLUTZ_IGNORED_ITEMS: ReadonlySet<string> = new Set(["abilityshield", "machobrace", "poweranklet", "powerband", "powerbelt", "powerbracer", "powerlens", "powerweight"]);

/** The Berries whose onEat (pinned Showdown data/items.ts) heals: Sitrus a quarter of the base maximum HP, Oran 10, the Figy family a third (a half in generation 7). */
const EATEN_HEALS = new Set(["sitrusberry", "oranberry", ...PINCH_HEAL_BERRIES]);
/** The Berries whose onEat raises a stat by 1 (this.boost): the pinch Berries, Kee (Defense) and Maranga (Sp. Def). */
const EATEN_STAGES: Readonly<Record<string, CombatStat>> = { ...PINCH_STAT_BERRIES, keeberry: "def", marangaberry: "spd" };
/** The Berries whose onEat cures a status (cureStatus) and the statuses each cures; Lum cures any. */
const EATEN_CURES: Readonly<Record<string, readonly string[]>> = {
  lumberry: ["brn", "par", "psn", "tox", "slp", "frz"], cheriberry: ["par"], chestoberry: ["slp"], pechaberry: ["psn", "tox"], rawstberry: ["brn"], aspearberry: ["frz"],
};
/** The resist Berries (data/items.ts onSourceModifyDamage with eatItem, onEat() {}): Ripen records one eaten (onEatItem berryWeaken). */
export const RESIST_BERRIES: ReadonlySet<string> = new Set(["babiriberry", "chartiberry", "chilanberry", "chopleberry", "cobaberry", "colburberry", "habanberry", "kasibberry",
  "kebiaberry", "occaberry", "passhoberry", "payapaberry", "rindoberry", "roseliberry", "shucaberry", "tangaberry", "wacanberry", "yacheberry"]);
/** The Berries whose onEat does nothing (onEat() {}): the resist Berries, Custap, Enigma, Jaboca, Rowap. Micle Berry's onEat gives a volatile for accuracy, which no count reads. */
const EATEN_EMPTY = new Set([...RESIST_BERRIES, "custapberry", "enigmaberry", "jabocaberry", "rowapberry", "micleberry"]);
/** The Berries with onEat: false (Pomeg and its kin, the Past flavour Berries): singleEvent('Eat') returns false, so no EatItem runs. */
export const UNEATEN_BERRIES: ReadonlySet<string> = new Set(["pomegberry", "kelpsyberry", "qualotberry", "hondewberry", "grepaberry", "tamatoberry", "razzberry", "blukberry",
  "nanabberry", "wepearberry", "pinapberry", "cornnberry", "magostberry", "rabutaberry", "nomelberry", "spelonberry", "pamtreberry", "watmelberry", "durinberry", "belueberry"]);

/**
 * What Bug Bite's or Pluck's user gets from the target's Berry it takes (pinned Showdown data/moves.ts bugbite and pluck
 * onHit: `if (source.hp && item.isBerry && target.takeItem(source))`, then singleEvent('Eat', item, ..., source) and, when
 * that returns truthy, runEvent('EatItem', source)). The Eat runs no TryEatItem, so neither an HP line nor the target's
 * Unnerve or As One applies. sim/battle.ts singleEvent suppresses it when the user ignores its own items (`ignoresItem`:
 * Magic Room, or Klutz but for an ignoreKlutz item it holds) and returns true, so the EatItem still runs; a Berry with
 * onEat: false (UNEATEN_BERRIES) returns false and runs none.
 * - heal: Sitrus a quarter of the base maximum HP (at least 1), Oran 10, the Figy family a third (a half in generation 7,
 *   data/mods/gen7/items.ts), doubled by Ripen (onTryHeal chainModify(2) on a Berry); battle.heal heals none at full HP.
 * - pouch: Cheek Pouch's third of the base maximum HP (onEatItem; not a Berry's heal, so not doubled).
 * - stages: the pinch Berries, Kee (Defense) and Maranga (Sp. Def) +1, Ripen doubling (onChangeBoost); Contrary, Simple
 *   and the ±6 cap are boost()'s. `starf`: Starf Berry's +2 to a stat below +6 at random (this.sample), +4 with Ripen.
 * - cures: the statuses its cureStatus clears (Lum any, Cheri paralysis, Chesto sleep, Pecha poison, Rawst burn, Aspear
 *   freeze); `curesConfusion`: Lum and Persim (removeVolatile('confusion')).
 * - confuses: the stat whose lowering Nature makes a Figy-family Berry confuse its eater (addVolatile('confusion')).
 * - focusEnergy: Lansat Berry (addVolatile('focusenergy'): +2 critical-hit ratio); leppa: the PP Leppa Berry restores
 *   (10, 20 with Ripen) to the first move with none left, else the first one short of its maximum.
 * - weakens: Ripen's onEatItem marks a resist Berry (berryWeaken): the next damage its holder takes from a move is halved.
 */
export type StolenEat = {
  heal: number; pouch: number; stages: Partial<Record<CombatStat, number>>; cures: readonly string[]; curesConfusion: boolean;
  confuses?: CombatStat; focusEnergy?: true; starf?: number; leppa?: number; weakens?: true;
};

/** The Figy family (data/items.ts figyberry and its kin onEat): the stat whose lowering Nature confuses the eater. */
export const CONFUSING_BERRIES: Readonly<Record<string, CombatStat>> = { figyberry: "atk", wikiberry: "spa", magoberry: "spe", aguavberry: "spd", iapapaberry: "def" };

/** stolenEat's Berry `item` eaten by a user with base maximum HP `baseMaxHP` and ability `ability` (in effect). */
export function stolenEat(item: string, eater: { baseMaxHP: number; ability: string; ignoresItem: boolean }, generation: number): StolenEat {
  const { baseMaxHP, ability, ignoresItem } = eater;
  const ripen = ability === "ripen" ? 2 : 1;
  const runs = ignoresItem || !UNEATEN_BERRIES.has(item);
  const pouch = ability === "cheekpouch" && runs ? Math.max(1, Math.floor(baseMaxHP / 3)) : 0;
  const weakens = ability === "ripen" && RESIST_BERRIES.has(item) ? { weakens: true as const } : {};
  const none: StolenEat = { heal: 0, pouch, stages: {}, cures: [], curesConfusion: false, ...weakens };
  if (ignoresItem) return none;
  const heal = EATEN_HEALS.has(item) ? berryArithmetic(item, { maxHP: baseMaxHP, baseMaxHP, ability }, generation).heal : 0;
  const stat = EATEN_STAGES[item];
  return {
    ...none, heal, stages: stat ? { [stat]: ripen } : {}, cures: EATEN_CURES[item] ?? [], curesConfusion: item === "lumberry" || item === "persimberry",
    ...(CONFUSING_BERRIES[item] ? { confuses: CONFUSING_BERRIES[item] } : {}), ...(item === "lansatberry" ? { focusEnergy: true as const } : {}),
    ...(item === "starfberry" ? { starf: 2 * ripen } : {}), ...(item === "leppaberry" ? { leppa: 10 * ripen } : {}),
  };
}

/** Whether stolenEat knows `item` (every Berry of the catalogs; tests/source/stolen-berries.test.ts checks them against pinned Showdown). */
export function knownStolenBerry(item: string): boolean {
  return EATEN_HEALS.has(item) || !!EATEN_STAGES[item] || !!EATEN_CURES[item] || EATEN_EMPTY.has(item) || UNEATEN_BERRIES.has(item)
    || ["lansatberry", "starfberry", "leppaberry", "persimberry"].includes(item);
}

/** The HP after eating a berry: its heal, then Cheek Pouch's, each capped at the maximum. */
export function eatBerry(berry: Berry, hp: number): number {
  let left = berry.heal ? Math.min(berry.max, hp + berry.heal) : hp;
  if (berry.pouch) left = Math.min(berry.max, left + berry.pouch);
  return left;
}

/**
 * A held HP or pinch berry as arithmetic for its holder (pinned Showdown data/items.ts onUpdate and onEat):
 * Sitrus, Oran and Berry Juice at half HP or less, the Figy family and the stat berries at a quarter (half
 * with Gluttony), Enigma only after a super-effective hit; Ripen doubles the heal (onTryHeal chainModify(2))
 * and Cheek Pouch heals a third more. `item` is one of HEALING_BERRIES or PINCH_STAT_BERRIES.
 */
export function berryArithmetic(item: string, holder: { maxHP: number; baseMaxHP: number; ability: string }, generation: number): Berry {
  const { maxHP, baseMaxHP, ability } = holder;
  const ripen = ability === "ripen" ? 2 : 1;
  const part = (divisor: number) => Math.max(1, Math.floor(baseMaxHP / divisor)) * ripen;
  const quarter = Math.floor(maxHP / (ability === "gluttony" ? 2 : 4)), half = Math.floor(maxHP / 2);
  const pouch = ability === "cheekpouch" && item !== "berryjuice" ? Math.max(1, Math.floor(baseMaxHP / 3)) : 0;
  const berry = (line: number, heal: number, enigma = false): Berry => ({ line, heal, pouch, max: maxHP, enigma });
  if (item === "sitrusberry") return berry(half, part(4));
  if (item === "oranberry") return berry(half, 10 * ripen);
  if (item === "berryjuice") return berry(half, 20);
  if (item === "enigmaberry") return berry(maxHP, part(4), true);
  if (PINCH_HEAL_BERRIES.has(item)) return berry(quarter, part(generation === 7 ? 2 : 3));
  return berry(quarter, 0);
}

/**
 * What a use's hits read of the attacker, the target and the move. Abilities are the ones in effect ("" when
 * the other's Neutralizing Gas suppresses them; Mold Breaker stops none of these, as none is breakable),
 * items the ones that work ("" under Magic Room or an active Klutz).
 */
export type HitLoopInput = {
  /** The attacker's HP before the move, its maximum and its base maximum (pinned Showdown hp, maxhp, baseMaxhp). */
  hp: number; maxHP: number; baseMaxHP: number;
  attackerAbility: string; attackerItem: string;
  targetAbility: string; targetItem: string;
  /** An Ability Shield that works on either side (not under Magic Room) blocks setAbility and skillSwap (abilityshield onSetAbility). */
  attackerShielded: boolean; targetShielded: boolean;
  /** A Dynamaxed target: skillSwap fails (Wandering Spirit). */
  targetDynamaxed: boolean;
  /** The move makes contact (its flag, after Long Reach, Protective Pads and a Punching Glove on a punch). */
  contact: boolean;
  category: "Physical" | "Special";
  /** The move's drain fraction (pinned Showdown spreadDamage, gen 5 on). */
  drain: [number, number] | null;
  /** Bug Bite, Pluck and Incinerate take the target's Berry in their onHit, before its DamagingHit handlers. */
  takesBerry: boolean;
  /**
   * The Berry their onHit finds (target.getItem()): the target's held one whether or not it works for its holder (takeItem
   * reads no Klutz or Magic Room), none once the hit's damage ate it (a resist Berry). Unset: `targetItem`.
   */
  targetBerry?: string;
  /** Bug Bite and Pluck: their user eats the Berry they take (stolenEat), its own items ignored (`ignoresItem`) under Magic Room or Klutz. */
  eats?: { ignoresItem: boolean };
  /**
   * The target is Cramorant in its Gulping or Gorging form with its own Gulp Missile (gulpingTarget;
   * cantsuppress, so Neutralizing Gas does not stop it; notransform, so a transformed copy's does nothing).
   */
  targetGulping: boolean;
  /** The engine's generation (0 for Champions), for the Figy family's heal. */
  generation: number;
  /** A doubles turn's Unnerve and As One (TurnUnnerve); unset, each side's own stops the other's Berries. */
  unnerve?: TurnUnnerve;
};

/**
 * A doubles turn's Unnerve and As One for one pair (data/abilities.ts unnerve, asoneglastrier onFoeTryEatItem: a foe
 * still in): `foes` whether the two are foes (each one's own then stops the other's Berries), `target` and
 * `attacker` whether another Pokémon's stops that one's Berries.
 */
export type TurnUnnerve = { foes: boolean; target: boolean; attacker: boolean };

/** Whether a Berry of the target (`who` "target") or of the attacker is stopped, the other one's ability being `other`. */
export function berryUnnerved(unnerve: TurnUnnerve | undefined, who: "target" | "attacker", other: string): boolean {
  return (UNNERVES.has(other) && (unnerve?.foes ?? true)) || !!unnerve?.[who];
}

/**
 * The attacker and target between hits: the attacker's HP, the abilities and items as the hits left them, the
 * stat stages its eaten pinch berries gave, and whether the target is still in its Gulping or Gorging form.
 */
export type HitState = {
  hp: number; attackerAbility: string; attackerItem: string; targetAbility: string; targetItem: string;
  stages: Partial<Record<CombatStat, number>>; gulping: boolean;
  /** The Berry Bug Bite, Pluck or Incinerate took (once), and the HP its eating gave the user: the Berry's heal and Cheek Pouch's. */
  stolen?: { item: string; heal: number; pouch: number };
};

/** The HP one source took from the attacker in a hit. */
export type HitLoss = { source: string; amount: number };
export type HitOutcome = { state: HitState; losses: HitLoss[]; ate: string | null; fainted: boolean };

const ROUGH_SKIN: Record<string, string> = { roughskin: "Rough Skin", ironbarbs: "Iron Barbs" };
/** Cramorant's forms whose Gulp Missile hits back (pinned Showdown data/abilities.ts gulpmissile onDamagingHit). */
const GULPING_FORMS = new Set(["cramorantgulping", "cramorantgorging"]);

/** A Cramorant in its Gulping or Gorging form with its own Gulp Missile (HitLoopInput targetGulping). */
export function gulpingTarget(target: { speciesId: string; abilityId: string; transformed: boolean }): boolean {
  return GULPING_FORMS.has(target.speciesId) && target.abilityId === "gulpmissile" && !target.transformed;
}
const BERRY_NAMES: Record<string, string> = { jabocaberry: "Jaboca Berry", rowapberry: "Rowap Berry" };

export function startHits(input: HitLoopInput): HitState {
  return {
    hp: input.hp, attackerAbility: input.attackerAbility, attackerItem: input.attackerItem, targetAbility: input.targetAbility, targetItem: input.targetItem,
    stages: {}, gulping: input.targetGulping,
  };
}

/** Pinned Showdown battle.modify: a 4096-based modifier, rounded half down. */
function modify(value: number, numerator: number, denominator: number): number {
  const modifier = Math.trunc(numerator * 4096 / denominator);
  return Math.trunc((Math.trunc(value * modifier) + 2048 - 1) / 4096);
}

/**
 * One hit, from the state `prev` leaves, of a hit that dealt `dealt` (read only for draining), in pinned
 * Showdown's order:
 * 1. spreadDamage: draining heals Math.round(dealt x the fraction), at least 1, then Big Root (onTryHeal
 *    5324/4096); the target's Liquid Ooze (onSourceTryHeal) deals that unboosted amount instead, even at full HP.
 * 2. runMoveEffects: Bug Bite, Pluck and Incinerate take the target's Berry (not through Sticky Hold, which lets go once its
 *    holder has fainted: `knocked`, this hit knocked the target out; data/abilities.ts stickyhold onTakeItem `!pokemon.hp`),
 *    and Bug Bite's and Pluck's living user eats it (stolenEat): its heal and Cheek Pouch's, each at most to the maximum
 *    and none at full HP (battle.heal), and its stages (Contrary reverses, Simple doubles), before the DamagingHit.
 * 3. DamagingHit, by handler order: Rough Skin and Iron Barbs (order 1, 1/8 of base max HP on contact), Rocky
 *    Helmet (order 2, 1/6 on contact), then abilities (subOrder 7: Mummy and Lingering Aroma replace the
 *    attacker's ability on contact, Wandering Spirit swaps them; Gulp Missile in the Gulping or Gorging form
 *    deals 1/4 on any hit, contact or not, once, and the form changes back, through Magic Guard too, unless
 *    the attacker has already fainted, when its handler returns first), then items (subOrder 8: a Jaboca Berry on a
 *    physical hit, a Rowap Berry on a special one, 1/8, 1/4 with Ripen, once, unless the attacker has Magic
 *    Guard or its Unnerve stops the eating). Each damage is battle.damage's: at least 1, rounded down, none
 *    through the attacker's Magic Guard (onDamage), none once it has fainted.
 * 4. The Update: the attacker eats its HP or pinch berry at its line (the target's Unnerve stops a Berry, not
 *    Berry Juice); a pinch berry raises its stat (Ripen doubles, Contrary reverses, Simple doubles).
 * Pickpocket (onAfterMoveSecondary) and Shell Bell, recoil and Life Orb act only after the hits.
 */
export function hitStep(input: HitLoopInput, prev: HitState, dealt: number, knocked = false): HitOutcome {
  const state: HitState = { ...prev, stages: { ...prev.stages } };
  const losses: HitLoss[] = [];
  const lose = (source: string, amount: number) => {
    if (state.hp <= 0 || state.attackerAbility === "magicguard") return;
    const taken = Math.min(state.hp, Math.max(1, Math.floor(amount)));
    state.hp -= taken;
    losses.push({ source, amount: taken });
  };
  if (input.drain && dealt > 0) {
    let amount = Math.round(dealt * input.drain[0] / input.drain[1]);
    if (amount && amount <= 1) amount = 1;
    if (state.targetAbility === "liquidooze") {
      if (amount) lose("Liquid Ooze", amount);
    } else if (amount && state.hp < input.maxHP) {
      if (state.attackerItem === "bigroot") amount = modify(amount, 5324, 4096);
      state.hp = Math.min(input.maxHP, state.hp + amount);
    }
  }
  // Their takeItem fails through Sticky Hold while its holder stands; the one attacker that can hit twice with them (Parental
  // Bond) has no Mold Breaker. A Berry the target's own item effects hold (`targetItem`) is still there; one that does not work
  // for it (`targetBerry`) stays until taken.
  if (input.takesBerry && !state.stolen) {
    const berry = input.targetBerry ?? state.targetItem;
    const there = berry.endsWith("berry") && (input.targetItem !== berry || state.targetItem === berry);
    if (there && (state.targetAbility !== "stickyhold" || knocked)) {
      if (state.targetItem === berry) state.targetItem = "";
      let heal = 0, pouch = 0;
      if (input.eats && state.hp > 0) {
        const eat = stolenEat(berry, { baseMaxHP: input.baseMaxHP, ability: state.attackerAbility, ignoresItem: input.eats.ignoresItem }, input.generation);
        const gain = (amount: number) => {
          if (!amount || state.hp >= input.maxHP) return 0;
          const before = state.hp;
          state.hp = Math.min(input.maxHP, state.hp + amount);
          return state.hp - before;
        };
        heal = gain(eat.heal);
        pouch = gain(eat.pouch);
        const ability = state.attackerAbility;
        for (const [stat, amount] of Object.entries(eat.stages) as [CombatStat, number][]) {
          state.stages[stat] = (state.stages[stat] ?? 0) + amount * (ability === "contrary" ? -1 : 1) * (ability === "simple" ? 2 : 1);
        }
      }
      state.stolen = { item: berry, heal, pouch };
    }
  }
  const rough = ROUGH_SKIN[state.targetAbility];
  if (input.contact && rough) lose(rough, input.baseMaxHP / 8);
  if (input.contact && state.targetItem === "rockyhelmet") lose("Rocky Helmet", input.baseMaxHP / 6);
  if (input.contact && state.hp > 0 && (state.targetAbility === "mummy" || state.targetAbility === "lingeringaroma")) {
    if (!CANT_SUPPRESS.has(state.attackerAbility) && state.attackerAbility !== state.targetAbility && !input.attackerShielded) state.attackerAbility = state.targetAbility;
  } else if (input.contact && state.hp > 0 && state.targetAbility === "wanderingspirit") {
    if (!FAIL_SKILL_SWAP.has(state.attackerAbility) && !input.attackerShielded && !input.targetShielded && !input.targetDynamaxed) {
      [state.attackerAbility, state.targetAbility] = [state.targetAbility, state.attackerAbility];
    }
  }
  if (state.gulping && state.hp > 0) {
    lose("Gulp Missile", input.baseMaxHP / 4);
    state.gulping = false;
  }
  const retaliating = BERRY_NAMES[state.targetItem];
  if (retaliating && (state.targetItem === "jabocaberry" ? input.category === "Physical" : input.category === "Special")
    && state.hp > 0 && state.attackerAbility !== "magicguard" && !berryUnnerved(input.unnerve, "target", state.attackerAbility)) {
    state.targetItem = "";
    lose(retaliating, input.baseMaxHP / (state.targetAbility === "ripen" ? 4 : 8));
  }
  let ate: string | null = null;
  const item = state.attackerItem;
  if (state.hp > 0 && item && item !== "enigmaberry" && (HEALING_BERRIES.has(item) || PINCH_STAT_BERRIES[item])
    && (item === "berryjuice" || !berryUnnerved(input.unnerve, "attacker", state.targetAbility))) {
    const berry = berryArithmetic(item, { maxHP: input.maxHP, baseMaxHP: input.baseMaxHP, ability: state.attackerAbility }, input.generation);
    if (state.hp <= berry.line) {
      state.hp = eatBerry(berry, state.hp);
      state.attackerItem = "";
      ate = item;
      const stat = PINCH_STAT_BERRIES[item];
      if (stat) {
        const ability = state.attackerAbility;
        const amount = (ability === "contrary" ? -1 : 1) * (ability === "simple" ? 2 : 1) * (ability === "ripen" ? 2 : 1);
        state.stages[stat] = (state.stages[stat] ?? 0) + amount;
      }
    }
  }
  return { state, losses, ate, fainted: state.hp <= 0 };
}

/**
 * The attacker through `hits` hits that dealt `dealt(hit)` (read only for draining): the state before each hit
 * that lands, the state after the last one, and the hit it faints on with the sources that took its HP by
 * then, in the order they first did.
 */
export type HitWalk = { before: HitState[]; after: HitState; faint: { hit: number; by: string[] } | null };

export function walkHits(input: HitLoopInput, hits: number, dealt: (hit: number) => number = () => 0): HitWalk {
  let state = startHits(input);
  const before: HitState[] = [];
  const by: string[] = [];
  for (let hit = 1; hit <= hits; hit++) {
    before.push(state);
    const outcome = hitStep(input, state, dealt(hit));
    for (const loss of outcome.losses) if (!by.includes(loss.source)) by.push(loss.source);
    state = outcome.state;
    if (outcome.fainted) return { before, after: state, faint: { hit, by } };
  }
  return { before, after: state, faint: null };
}

/** Whether anything can take the attacker's HP during the hits; otherwise it stands through every one. */
export function hitsCanFaint(input: HitLoopInput): boolean {
  const { attackerAbility, targetAbility, targetItem, contact } = input;
  const contactSource = contact && (!!ROUGH_SKIN[targetAbility] || targetItem === "rockyhelmet");
  // Wandering Spirit can hand the target the attacker's own Rough Skin or Iron Barbs.
  const handed = contact && targetAbility === "wanderingspirit" && !!ROUGH_SKIN[attackerAbility];
  return contactSource || handed || !!BERRY_NAMES[targetItem] || (!!input.drain && targetAbility === "liquidooze") || input.targetGulping;
}

/**
 * Every roll path of `rolls` (each hit's rolls, equally likely, in hit order), when the hit it faints on hangs
 * on the rolls (draining): the chance it faints on each hit, and the least and most damage the hits that land
 * deal. A dynamic programme over the attacker's states, so equal states share their paths.
 */
export function hitPaths(input: HitLoopInput, rolls: number[][]): { faints: number[]; min: number; max: number } {
  type Path = { state: HitState; mass: number; min: number; max: number };
  let paths = new Map<string, Path>([["", { state: startHits(input), mass: 1, min: 0, max: 0 }]]);
  const faints = rolls.map(() => 0);
  let min = Infinity, max = -Infinity;
  for (let hit = 0; hit < rolls.length; hit++) {
    const counts = new Map<number, number>();
    for (const roll of rolls[hit]) counts.set(roll, (counts.get(roll) ?? 0) + 1);
    const next = new Map<string, Path>();
    for (const path of paths.values()) {
      for (const [roll, count] of counts) {
        const mass = path.mass * count / rolls[hit].length;
        const outcome = hitStep(input, path.state, roll);
        const low = path.min + roll, high = path.max + roll;
        if (outcome.fainted) {
          faints[hit] += mass;
          min = Math.min(min, low); max = Math.max(max, high);
          continue;
        }
        const key = JSON.stringify(outcome.state);
        const known = next.get(key);
        if (known) { known.mass += mass; known.min = Math.min(known.min, low); known.max = Math.max(known.max, high); }
        else next.set(key, { state: outcome.state, mass, min: low, max: high });
      }
    }
    paths = next;
  }
  for (const path of paths.values()) { min = Math.min(min, path.min); max = Math.max(max, path.max); }
  return { faints, min, max };
}

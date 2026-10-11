import { MOLD_BREAKERS, REASONS } from "./doubles-actions";
import { abilityFlag } from "./ability-table";
import { settleDoublesStart } from "./doubles-start";
import { DOUBLES_SLOTS, slotSide, type DoublesSideId, type DoublesSlotId, type DoublesTurnInput } from "./doubles-types";
import { withSpecies, type FieldState, type PendingAction, type SideState, type Stage, type World } from "./doubles-world";
import type { TurnKernel } from "./doubles-turn";
import * as typingNs from "./doubles-typing";
import { gameOf, generation, signed, STAGE_NAMES, type Use } from "./doubles-use";
import { paradoxBestStat } from "./model";
import type { BattleBuild, ChampionsMove, CombatStat } from "./types";

// The hook namespaces are copied once into plain objects (as the other hook modules do): under tsx a namespace import's
// member is a getter over the module's own export getter, while a plain object keeps each hook call one property load.
const typingHooks = { ...typingNs };

// Field changes (status2 ADDENDUM2 §2.3 #45, #53, #54, §4.3 FC; tier2-presence.md §5.2-§5.3): Track FC's file (wave 1b).
//
// Pinned Showdown c23d2e94 (PS/ = node_modules/.cache/champions/pokemon-showdown-c23d2e942c9c0daadb13a7162a385bf78e3c9353):
// a weather change (sim/field.ts setWeather / clearWeather: eachEvent('WeatherChange')), an effective-weather change (Cloud
// Nine and Air Lock: data/abilities.ts cloudnine onStart / onEnd, eachEvent('WeatherChange', the ability)) and a terrain
// change (setTerrain / clearTerrain: eachEvent('TerrainChange')) run on every active Pokémon in Speed order:
// - Protosynthesis (PS/data/abilities.ts:3513-3576) and Quark Drive (:3650-3713): their field up (isWeather('sunnyday'):
//   Harsh Sunshine is not; isTerrain('electricterrain')) adds the volatile with getBestStat(false, true), unless it is up
//   already (addVolatile has no restart); their field down removes one that did not come from Booster Energy;
// - Forecast (:1470-1505) and Flower Gift (:1382-1416): Castform's and Cherrim's form by the holder's effectiveWeather
//   (Utility Umbrella takes sun and rain away); Ice Face (:1969-2034): an Eiscue-Noice in hail or snow gets its face back,
//   but not when the change is a Cloud Nine or Air Lock (sourceEffect.suppressWeather);
// - Mimicry (:2581-2612): the raw terrain's type, or its base species' types without one (setType; nothing when equal);
// - the Terrain Seeds (PS/data/items.ts:1795-1815 and kin): useItem in their terrain (the boost from the holder itself);
// then, at the Update after the change, Booster Energy (PS/data/items.ts:622-648) for a holder whose field is down.
// Breakable abilities (Flower Gift, Ice Face, Wind Rider) do not run during a move that ignores abilities (sim/battle.ts:836-
// 840 suppressingAbility: Mold Breaker, Teravolt, Turboblaze; Mycelium Might on a status move), but for its own user from
// generation 8 or behind a working Ability Shield. Item handlers do not run while the item is ignored (Magic Room, Embargo,
// Klutz: sim/battle.ts:875-881). A suppressed ability (its stand-in id) runs nothing. The handlers of different Pokémon
// read and write only their own holder (the copies of a Seed's rise wait for AfterMove: D's ledger), so their Speed order
// changes no number; it orders the facts.
// Also: a pseudo-weather starting (sim/field.ts addPseudoWeather: runEvent('PseudoWeatherChange')) uses a held Room Service
// while Trick Room is up (PS/data/items.ts:5306-5326: any pseudo-weather, not one removed; probes w1b-fc/probes-1 RS3); a
// side condition starting (sim/side.ts addSideCondition: runEvent('SideConditionStart')) runs Wind Rider (+1 Attack from
// itself) and Wind Power (Charge) on that side for Tailwind (PS/data/abilities.ts:5509-5545).
//
// The callers: A3's fieldMove (before / afterFieldMove), A3's sport and room (pseudoWeatherChanged), A3's Magic Room end
// (itemsAfterField), A3's Defog, A1's ability changes and S's hits into a Substitute (changed), A1's Forecast and Flower
// Gift Starts (settleHolder), the kernel's faint (stepField for a strong weather ending; fainted for Cloud Nine and Air
// Lock), the kernel's step (stepEnv, stepField), and the end of turn (eotField; itemsAfterField at the final Update: E2).
// A caller that does not pass the field as it was before the change keeps today's guard (REASONS.fieldChange) for it.

/** The field as it was before a change: A1's fieldKey text ("weather|effective weather|terrain"), or the parts. */
export type FieldBefore = string | { weather: string; terrain: string; effective?: string };
/**
 * Where a change's facts go and who made it: an action (its Pokémon made the change), a status use (its user; a reflected
 * or stolen use's statistics are its action's), or the end of turn's sink. Absent: no facts, no active move.
 */
export type FieldSource = PendingAction | Use | { fact: (w: World, slot: DoublesSlotId, text: string) => void };

/** The Terrain Seeds, the terrain each is used in and its boost (PS/data/items.ts electricseed, grassyseed, mistyseed, psychicseed). */
const SEEDS: Readonly<Record<string, { terrain: string; stat: CombatStat }>> = {
  electricseed: { terrain: "Electric", stat: "def" }, grassyseed: { terrain: "Grassy", stat: "def" }, mistyseed: { terrain: "Misty", stat: "spd" }, psychicseed: { terrain: "Psychic", stat: "spd" },
};
/** Mimicry's type on each terrain (PS/data/abilities.ts:2588-2602). */
const MIMICRY: Readonly<Record<string, string>> = { Electric: "Electric", Grassy: "Grass", Misty: "Fairy", Psychic: "Psychic" };
/** Cloud Nine and Air Lock (suppressWeather). */
const NEGATORS = new Set(["cloudnine", "airlock"]);
/** The weathers Utility Umbrella takes away from its holder's effectiveWeather (sim/pokemon.ts effectiveWeather). */
const UMBRELLA_WEATHERS = new Set(["Sun", "Harsh Sunshine", "Rain", "Heavy Rain"]);

const nameOf = (kernel: TurnKernel, slot: DoublesSlotId) => kernel.names[slot];
const transformed = (w: World, slot: DoublesSlotId) => !!w.mons[slot]!.build.transformedFrom || !!w.mons[slot]!.vol.transform;
const living = (kernel: TurnKernel, w: World, slot: DoublesSlotId) => kernel.alive(w, slot) && slot !== w.ghost;
/** The Pokémon still in, fastest first (eachEvent's speedSort; equal Speeds keep the slot order: no number depends on it). */
function bySpeed(kernel: TurnKernel, w: World): DoublesSlotId[] {
  return DOUBLES_SLOTS.filter((slot) => living(kernel, w, slot)).map((slot, index) => ({ slot, index, speed: kernel.speedOf(w, slot) }))
    .sort((a, b) => b.speed - a.speed || a.index - b.index).map((entry) => entry.slot);
}
const isUse = (source: FieldSource): source is Use => "entry" in source && "user" in source;
const isAction = (source: FieldSource): source is PendingAction => "fractional" in source;

/** A fact about `slot` (its Pokémon named): on the action's hit entry for it where it has one, else a step fact; or the sink's. */
function say(kernel: TurnKernel, source: FieldSource | undefined, w: World, slot: DoublesSlotId, text: string) {
  if (!source) return;
  if (!isUse(source) && !isAction(source)) { source.fact(w, slot, text); return; }
  const action = isUse(source) ? source.action : source;
  if (kernel.step(action)?.hits.has(slot)) kernel.hitFact(action, slot, text, w.mass);
  else kernel.stepFact(action, text, w.mass);
}

/**
 * The move running as the field changes, for its ignoreAbility (sim/battle.ts suppressingAbility): its user and whether it
 * is a status move; null: none (the end of turn); "unknown": a change during the moves whose caller did not say (a faint).
 */
type Active = { user: DoublesSlotId; status: boolean } | null | "unknown";
function activeOf(kernel: TurnKernel, source: FieldSource | undefined, user?: DoublesSlotId, move?: ChampionsMove): Active {
  if (kernel.inEndOfTurn) return null;
  if (user && move) return { user, status: move.category === "Status" };
  if (source && isUse(source)) return { user: user ?? source.user, status: source.move.category === "Status" };
  if (source && isAction(source)) return { user: user ?? source.slot, status: kernel.runtime.movesById.get(source.moveId ?? "")?.category === "Status" };
  return "unknown";
}
/**
 * Whether the active move suppresses `holder`'s breakable abilities (sim/battle.ts suppressingAbility): its user's Mold
 * Breaker, Teravolt or Turboblaze, or Mycelium Might for a status move; not the user's own from generation 8, not behind
 * a working Ability Shield. With the move unknown, a breakable holder whose handler would act while such an ability is in
 * is not followed (REASONS.fieldChange): `true` is returned only as "may be suppressed".
 */
function breakerOf(kernel: TurnKernel, w: World, active: Active): (holder: DoublesSlotId) => boolean {
  if (!active) return () => false;
  const shielded = (holder: DoublesSlotId) => w.mons[holder]!.build.itemId === "abilityshield" && !w.field.magicRoom;
  if (active === "unknown") {
    const breakers = DOUBLES_SLOTS.filter((slot) => kernel.alive(w, slot) && (MOLD_BREAKERS.has(w.mons[slot]!.build.abilityId) || w.mons[slot]!.build.abilityId === "myceliummight"));
    return (holder) => breakers.some((by) => by !== holder || generation(kernel) < 8) && !shielded(holder);
  }
  const mon = w.mons[active.user];
  if (!mon) return () => false;
  const ability = mon.build.abilityId;
  if (!MOLD_BREAKERS.has(ability) && !(active.status && ability === "myceliummight")) return () => false;
  const own = generation(kernel) < 8;
  return (holder) => (holder !== active.user || own) && !shielded(holder);
}
/**
 * `slot`'s ability runs its handler now: not a breakable one the active move suppresses. With the active move unknown and
 * a breaker in, `acts` (whether the handler would change anything) decides: not followed when it would.
 */
function runs(kernel: TurnKernel, w: World, slot: DoublesSlotId, active: Active, broken: (holder: DoublesSlotId) => boolean, acts: () => boolean = () => true): boolean {
  const ability = w.mons[slot]!.build.abilityId;
  if (!abilityFlag(ability, gameOf(kernel), "breakable") || !broken(slot)) return true;
  if (active === "unknown" && acts()) kernel.notEstimated(REASONS.fieldChange(kernel.abilityName(ability)));
  return false;
}
/** applyBoosts' ChangeBoost (Contrary, Simple: breakable) under the active move; an unknown move with a breaker in: not followed. */
function boostOptions(kernel: TurnKernel, w: World, slot: DoublesSlotId, active: Active, broken: (holder: DoublesSlotId) => boolean, effect: "item" | "ability", label: string) {
  const ability = w.mons[slot]!.build.abilityId;
  if (active === "unknown" && (ability === "contrary" || ability === "simple") && broken(slot)) kernel.notEstimated(REASONS.fieldChange(label));
  return { effect, breakHolder: active === "unknown" ? () => false : broken } as NonNullable<Parameters<TurnKernel["applyBoosts"]>[4]>;
}

/** The stages that changed, as a fact's list ("+1 Defense, −1 Speed"), or "". */
const stageText = (changed: Partial<Record<Stage, number>>) =>
  (Object.entries(changed) as [Stage, number][]).filter(([, by]) => by).map(([stat, by]) => `${signed(by)} ${STAGE_NAMES[stat]}`).join(", ");

// ------------------------------------------------------------------------------------------------------------------
// What the turn started with (the start settle: calculate.ts settleDoublesStart's folded builds)
// ------------------------------------------------------------------------------------------------------------------

const starts = new WeakMap<DoublesTurnInput, Partial<Record<DoublesSlotId, BattleBuild>>>();
/** `slot`'s settled build as the turn started (its item after the items used then, its paradox stat). */
function startBuild(kernel: TurnKernel, slot: DoublesSlotId): BattleBuild | undefined {
  let builds = starts.get(kernel.input);
  if (!builds) {
    const settle = settleDoublesStart(kernel.input);
    builds = Object.fromEntries(DOUBLES_SLOTS.flatMap((each) => settle.slots[each] ? [[each, settle.slots[each]!.folded]] : []));
    starts.set(kernel.input, builds);
  }
  return builds[slot];
}

// ------------------------------------------------------------------------------------------------------------------
// Protosynthesis, Quark Drive and Booster Energy
// ------------------------------------------------------------------------------------------------------------------

/** The paradox abilities and the field each reads. */
const PARADOX: Readonly<Record<string, "sun" | "terrain">> = { protosynthesis: "sun", quarkdrive: "terrain" };
/** Its paradox field is up (isWeather('sunnyday') through the effective weather; isTerrain('electricterrain')). */
function paradoxField(kernel: TurnKernel, w: World, ability: string): boolean {
  return PARADOX[ability] === "sun" ? kernel.effectiveWeather(w) === "Sun" : w.field.terrain === "Electric";
}
/**
 * Whether `slot`'s paradox boost came from its Booster Energy (the volatile's fromBooster): a Paradox Pokémon's Booster
 * Energy cannot be taken, moved or flung (PS/data/items.ts boosterenergy onTakeItem), so it is gone only once used, and its
 * use always starts the boost (its field is down then, so no other boost stands). Used by the start settle (held in the
 * input, gone after the settle with the boost on), or during this turn (held as the turn started, gone now).
 */
function fromBooster(kernel: TurnKernel, w: World, slot: DoublesSlotId): boolean {
  const build = w.mons[slot]!.build;
  if (!build.settledBoostedStat || build.itemId === "boosterenergy") return false;
  const start = startBuild(kernel, slot);
  if (!start) return false;
  if (start.itemId === "boosterenergy") return true;
  return kernel.input.pokemon[slot]?.build.itemId === "boosterenergy" && !!start.settledBoostedStat;
}
/** getBestStat(false, true): the stored stats with their stages, no other modifier, Wonder Room swapping the defensive stages (model.ts paradoxBestStat). */
function bestStat(kernel: TurnKernel, w: World, slot: DoublesSlotId): CombatStat {
  const build = w.mons[slot]!.build;
  const stats = kernel.buildStats(build);
  if (!stats) return "atk";
  return paradoxBestStat(stats, (stat) => build.boosts[stat] ?? 0, w.field.wonderRoom);
}
/** The paradox volatile added (onStart: getBestStat at once). */
function activate(kernel: TurnKernel, w: World, slot: DoublesSlotId, source: FieldSource | undefined, booster: boolean) {
  const mon = w.mons[slot]!;
  const stat = bestStat(kernel, w, slot);
  mon.build = { ...mon.build, settledBoostedStat: stat };
  const ability = kernel.abilityName(mon.build.abilityId);
  say(kernel, source, w, slot, booster
    ? `${nameOf(kernel, slot)}'s ${kernel.itemName("boosterenergy")} is used up: ${ability} boosts its ${STAGE_NAMES[stat]}.`
    : `${nameOf(kernel, slot)}'s ${ability} boosts its ${STAGE_NAMES[stat]}.`);
}
/** Protosynthesis or Quark Drive on its field's change (onWeatherChange / onTerrainChange). */
function paradox(kernel: TurnKernel, w: World, slot: DoublesSlotId, source: FieldSource | undefined) {
  const mon = w.mons[slot]!;
  const ability = mon.build.abilityId;
  if (paradoxField(kernel, w, ability)) {
    if (!mon.build.settledBoostedStat) activate(kernel, w, slot, source, false);
    return;
  }
  if (!mon.build.settledBoostedStat || fromBooster(kernel, w, slot)) return;
  const next = { ...mon.build };
  delete next.settledBoostedStat;
  mon.build = next;
  say(kernel, source, w, slot, `${nameOf(kernel, slot)}'s ${kernel.abilityName(ability)} ends.`);
}
/**
 * Booster Energy at an Update (PS/data/items.ts:633-643 onUpdate): a Protosynthesis or Quark Drive holder whose field is
 * down, not transformed, its item working, uses it (useItem: the item gone, lastItem, usedItemThisTurn; its AfterUseItem
 * reaches a partner's Symbiosis: D's guard at the action's end), then the boost (fromBooster). A Booster Energy it did not
 * hold as the turn started (Recycle after the start settle used one up with no effect) is not followed. Whether it was used.
 */
function booster(kernel: TurnKernel, w: World, slot: DoublesSlotId, source: FieldSource | undefined): boolean {
  if (!living(kernel, w, slot)) return false;
  const mon = w.mons[slot]!;
  const build = mon.build;
  if (build.itemId !== "boosterenergy" || !PARADOX[build.abilityId] || transformed(w, slot) || !kernel.itemWorks(w, build)) return false;
  if (paradoxField(kernel, w, build.abilityId)) return false;
  if (startBuild(kernel, slot)?.itemId !== "boosterenergy") kernel.notEstimated(REASONS.received(kernel.itemName("boosterenergy"), nameOf(kernel, slot)));
  const active = !!build.settledBoostedStat;
  mon.build = { ...build, itemId: "" };
  kernel.noteItemUse(w, slot, "boosterenergy");
  if (!active) activate(kernel, w, slot, source, true);
  return true;
}


// ------------------------------------------------------------------------------------------------------------------
// The form abilities, Mimicry and the Seeds
// ------------------------------------------------------------------------------------------------------------------

/** `slot`'s own weather (sim/pokemon.ts effectiveWeather) for the field's `weather`: a working Utility Umbrella takes sun and rain away. */
function ownWeather(kernel: TurnKernel, w: World, slot: DoublesSlotId, weather: string = kernel.effectiveWeather(w)): string {
  const build = w.mons[slot]!.build;
  return UMBRELLA_WEATHERS.has(weather) && build.itemId === "utilityumbrella" && kernel.itemWorks(w, build) ? "" : weather;
}
/** Castform's form for its own weather (PS/data/abilities.ts:1478-1496). */
function castformFor(weather: string): string {
  if (weather === "Sun" || weather === "Harsh Sunshine") return "castformsunny";
  if (weather === "Rain" || weather === "Heavy Rain") return "castformrainy";
  if (weather === "Hail" || weather === "Snow") return "castformsnowy";
  return "castform";
}
/** A form change (formeChange through setSpecies: withSpecies, its world types gone), with its fact; a form the game lacks: not followed. */
function becomes(kernel: TurnKernel, w: World, slot: DoublesSlotId, speciesId: string, label: string, source: FieldSource | undefined) {
  const species = kernel.runtime.speciesById.get(speciesId);
  if (!species) kernel.notEstimated(REASONS.fieldChange(label));
  const mon = w.mons[slot]!;
  mon.build = withSpecies(mon.build, speciesId);
  say(kernel, source, w, slot, `${label}: ${nameOf(kernel, slot)} becomes ${species!.name}.`);
}
/**
 * Forecast's form after the change (onWeatherChange), or null for none: Castform's form by its own weather. The start
 * settle keeps a Castform as its base form and the calculations read the form from the field (calculate.ts makePokemon:
 * the engine's Forecast), so a base Castform stands for the form its own weather before the change (`before`, the effective
 * weather; null: not known, a Forecast just gained) gave it.
 */
function forecastForm(kernel: TurnKernel, w: World, slot: DoublesSlotId, before: string | null): string | null {
  const build = w.mons[slot]!.build;
  if (kernel.runtime.speciesById.get(build.speciesId)?.baseSpecies !== "castform" || transformed(w, slot)) return null;
  const now = build.speciesId === "castform" && before !== null ? castformFor(ownWeather(kernel, w, slot, before)) : build.speciesId;
  const form = castformFor(ownWeather(kernel, w, slot));
  return form === now ? null : form;
}
/** Flower Gift's form after the change (onWeatherChange), or null for none: Cherrim-Sunshine in its own sun or Harsh Sunshine, else Cherrim. */
function flowerGiftForm(kernel: TurnKernel, w: World, slot: DoublesSlotId): string | null {
  const build = w.mons[slot]!.build;
  if (kernel.runtime.speciesById.get(build.speciesId)?.baseSpecies !== "cherrim" || transformed(w, slot)) return null;
  const weather = ownWeather(kernel, w, slot);
  const form = weather === "Sun" || weather === "Harsh Sunshine" ? "cherrimsunshine" : "cherrim";
  return form === build.speciesId ? null : form;
}
/** Ice Face (onWeatherChange) restores the face: an Eiscue-Noice in hail or snow, not on a Cloud Nine or Air Lock change (sourceEffect.suppressWeather). */
function iceFaceActs(kernel: TurnKernel, w: World, slot: DoublesSlotId, negator: boolean): boolean {
  if (negator || w.mons[slot]!.build.speciesId !== "eiscuenoice") return false;
  const weather = kernel.effectiveWeather(w);
  return weather === "Hail" || weather === "Snow";
}
/**
 * Mimicry's types after the change (onTerrainChange), or null for none: the raw terrain's type, or its base species' types,
 * when they differ from its types now. A Mimicry holder with no world types stands for its terrain's type before the change
 * (the calculations read Mimicry from the field: calculate.ts mimicryTypes).
 */
function mimicryTypes(kernel: TurnKernel, w: World, slot: DoublesSlotId, beforeTerrain: string): string[] | null {
  const build = w.mons[slot]!.build;
  const base = kernel.runtime.speciesById.get(build.transformedFrom?.speciesId ?? build.speciesId)?.types ?? [];
  const terrain = MIMICRY[w.field.terrain];
  const types = terrain ? [terrain] : [...base];
  const old = !build.types && !build.addedType && MIMICRY[beforeTerrain] && build.mechanic !== "tera" ? [MIMICRY[beforeTerrain]] : kernel.typesIn(w, slot);
  return old.join() === types.join() ? null : types;
}
/** Mimicry's setType (A2's setTypes: none while Terastallized), with its fact. */
function mimicry(kernel: TurnKernel, w: World, slot: DoublesSlotId, types: string[], source: FieldSource | undefined) {
  if (!typingHooks.setTypes(kernel, w, slot, types)) return;
  const name = kernel.abilityName("mimicry");
  say(kernel, source, w, slot, w.field.terrain ? `${name}: ${nameOf(kernel, slot)} becomes ${types.join("/")} type.` : `${name}: ${nameOf(kernel, slot)}'s types return.`);
}
/** A Terrain Seed in its terrain (onTerrainChange: useItem; the boost from the holder itself, then the item gone and Unburden). */
function seed(kernel: TurnKernel, w: World, slot: DoublesSlotId, active: Active, broken: (holder: DoublesSlotId) => boolean, source: FieldSource | undefined) {
  const mon = w.mons[slot]!;
  const item = mon.build.itemId;
  const used = SEEDS[item];
  if (!used || used.terrain !== w.field.terrain || !kernel.itemWorks(w, mon.build)) return;
  const name = kernel.itemName(item);
  const changed = kernel.applyBoosts(w, slot, { [used.stat]: 1 }, slot, boostOptions(kernel, w, slot, active, broken, "item", name));
  mon.build = { ...mon.build, itemId: "", ...(mon.build.abilityId === "unburden" ? { abilityActive: true } : {}) };
  kernel.noteItemUse(w, slot, item);
  const text = stageText(changed);
  say(kernel, source, w, slot, `${nameOf(kernel, slot)}'s ${name} is used up on ${w.field.terrain} Terrain${text ? `: ${text}` : ""}.`);
}

// ------------------------------------------------------------------------------------------------------------------
// The re-settle
// ------------------------------------------------------------------------------------------------------------------

/** The field before a change, its effective weather filled in (the negators standing now) when the caller did not give it. */
function readBefore(kernel: TurnKernel, w: World, before: FieldBefore): { weather: string; effective: string; terrain: string } {
  if (typeof before === "string") {
    const [weather = "", effective = "", terrain = ""] = before.split("|");
    return { weather, effective, terrain };
  }
  const negated = DOUBLES_SLOTS.some((slot) => kernel.alive(w, slot) && NEGATORS.has(w.mons[slot]!.build.abilityId));
  return { weather: before.weather, terrain: before.terrain, effective: before.effective ?? (negated ? "" : before.weather) };
}

/**
 * Every Pokémon still in on a weather, effective-weather or terrain change, in Speed order: WeatherChange's handlers
 * (Protosynthesis, Forecast, Flower Gift, Ice Face), TerrainChange's (Quark Drive, Mimicry, then its Seed: an ability's
 * handler before an item's), then, outside the end of turn, the Update's Booster Energy (the end of turn's final Update
 * calls itemsAfterField: E2). `update` false: the caller's own Update follows.
 */
function resettle(kernel: TurnKernel, w: World, before: FieldBefore, source: FieldSource | undefined, active: Active, update = true) {
  const was = readBefore(kernel, w, before);
  const weather = was.weather !== w.field.weather || was.effective !== kernel.effectiveWeather(w);
  const terrain = was.terrain !== w.field.terrain;
  if (!weather && !terrain) return;
  // Only a Cloud Nine or Air Lock changed the weather the Pokémon see (Ice Face's suppressWeather check).
  const negator = weather && was.weather === w.field.weather;
  const broken = breakerOf(kernel, w, active);
  const order = bySpeed(kernel, w);
  for (const slot of order) {
    if (!living(kernel, w, slot)) continue;
    const ability = w.mons[slot]!.build.abilityId;
    if (weather) {
      if (ability === "protosynthesis") paradox(kernel, w, slot, source);
      else if (ability === "forecast") {
        const form = forecastForm(kernel, w, slot, was.effective);
        if (form) becomes(kernel, w, slot, form, kernel.abilityName(ability), source);
      } else if (ability === "flowergift") {
        const form = flowerGiftForm(kernel, w, slot);
        if (form && runs(kernel, w, slot, active, broken)) becomes(kernel, w, slot, form, kernel.abilityName(ability), source);
      } else if (ability === "iceface" && iceFaceActs(kernel, w, slot, negator) && runs(kernel, w, slot, active, broken)) {
        w.mons[slot]!.build = withSpecies(w.mons[slot]!.build, "eiscue");
        say(kernel, source, w, slot, `${kernel.abilityName(ability)}: ${nameOf(kernel, slot)}'s face is restored.`);
      }
    }
    if (terrain) {
      if (ability === "quarkdrive") paradox(kernel, w, slot, source);
      else if (ability === "mimicry") {
        const types = mimicryTypes(kernel, w, slot, was.terrain);
        if (types) mimicry(kernel, w, slot, types, source);
      }
      seed(kernel, w, slot, active, broken, source);
    }
  }
  if (update && !kernel.inEndOfTurn) for (const slot of order) booster(kernel, w, slot, source);
}

/** The guard for a caller that does not say what the field was (today's: a field-settled ability or item is in). */
function guard(kernel: TurnKernel, w: World) {
  for (const slot of DOUBLES_SLOTS) {
    if (!kernel.alive(w, slot)) continue;
    const build = w.mons[slot]!.build;
    if (kernel.fieldSettledAbilities.has(build.abilityId)) kernel.notEstimated(REASONS.fieldChange(kernel.abilityName(build.abilityId)));
    if (kernel.fieldSettledItems.has(build.itemId) && kernel.itemWorks(w, build)) kernel.notEstimated(REASONS.fieldChange(kernel.itemName(build.itemId)));
  }
}

// ------------------------------------------------------------------------------------------------------------------
// The hooks
// ------------------------------------------------------------------------------------------------------------------

/**
 * Before a field move sets the side or the field (A3's fieldMove). Today's guards (a weather or terrain with a field-settled
 * holder in, Tailwind with Wind Rider or Wind Power, Trick Room with Room Service) are FC's model now (afterFieldMove):
 * nothing is left to stop before the change.
 */
export function beforeFieldMove(kernel: TurnKernel, w: World, slot: DoublesSlotId, move: ChampionsMove) {
  void kernel; void w; void slot; void move;
}

/**
 * After a field move set the side or the field (`before`: the field and the user's side before it; `action`: its step,
 * for the facts): a weather or terrain it changed re-settles every holder (and the Update's Booster Energy); Tailwind
 * starting runs the side's Wind Rider and Wind Power; Trick Room and Gravity starting are pseudo-weathers (Room Service).
 * `slot` is the move's user (a Snatch user's for a stolen Tailwind). True (fieldMove's own result: called after its fact, so
 * the holders' facts follow the move's).
 */
export function afterFieldMove(kernel: TurnKernel, w: World, slot: DoublesSlotId, move: ChampionsMove, before: { field: FieldState; side: SideState }, action?: PendingAction): true {
  const active = activeOf(kernel, action, slot, move);
  if (before.field.weather !== w.field.weather || before.field.terrain !== w.field.terrain) {
    resettle(kernel, w, { weather: before.field.weather, terrain: before.field.terrain }, action, active);
    return true;
  }
  const side = slotSide(slot);
  if (move.id === "tailwind" && !before.side.tailwind && w.sides[side].tailwind) sideChange(kernel, w, side, action, active);
  if ((move.id === "trickroom" && w.field.trickRoom && !before.field.trickRoom) || (move.id === "gravity" && w.field.gravity && !before.field.gravity)) {
    roomService(kernel, w, action, active);
  }
  return true;
}

/**
 * A weather, effective-weather or terrain change outside a field move (A1's ability changes, A3's Defog, S's hits into a
 * Substitute). `before`: the field before it (A1's fieldKey text, or its parts); absent: today's guard. `source`: the
 * change's use or action (its facts; the move whose Mold Breaker suppresses breakable holders).
 */
export function changed(kernel: TurnKernel, w: World, before?: FieldBefore, source?: FieldSource) {
  if (before === undefined) { guard(kernel, w); return; }
  resettle(kernel, w, before, source, activeOf(kernel, source));
}

/**
 * The end of turn's field changes (doubles-eot.ts: a strong weather ending with a faint, the weather ending at order 1, and
 * E2's terrain end at 27.7). `before` absent: today's guard. The Booster Energy those leave due is used at the final Update
 * (itemsAfterField, E2's updateSlot), whose stages may differ from the change's. `source`: the end of turn's fact sink.
 */
export function eotField(kernel: TurnKernel, w: World, before?: FieldBefore, source?: FieldSource) {
  if (before === undefined) { guard(kernel, w); return; }
  resettle(kernel, w, before, source, null, false);
}

/**
 * A field change during the moves outside a field move: a strong weather ending with its last holder's faint (the kernel's
 * faint: `before` the field before it), a step's weather or terrain after the move's last hit (applyStep, with the action).
 */
export function stepField(kernel: TurnKernel, w: World, before: FieldState, action?: PendingAction) {
  resettle(kernel, w, { weather: before.weather, terrain: before.terrain }, action, activeOf(kernel, action));
}

/**
 * The kernel's faint of `slot` (faintMessages: its ability's End): a Cloud Nine or Air Lock holder's End runs WeatherChange
 * (PS/data/abilities.ts cloudnine onEnd: abilityState.ending, eachEvent('WeatherChange', the ability)), so the weather the
 * Pokémon see may come back.
 */
export function fainted(kernel: TurnKernel, w: World, slot: DoublesSlotId) {
  const mon = w.mons[slot];
  if (!mon || !NEGATORS.has(mon.build.abilityId) || !w.field.weather) return;
  if (DOUBLES_SLOTS.some((other) => other !== slot && kernel.alive(w, other) && NEGATORS.has(w.mons[other]!.build.abilityId))) return;
  resettle(kernel, w, { weather: w.field.weather, effective: "", terrain: w.field.terrain }, undefined, activeOf(kernel, undefined));
}

/** The target abilities that change the field at a hit (PS/data/abilities.ts seedsower, sandspit onDamagingHit). */
const HIT_FIELD_ABILITIES = new Set(["seedsower", "sandspit"]);
/**
 * The step's environment (searchFor, with K's and W's): with a Pokémon in whose ability or item a field change re-settles,
 * the kernel follows a weather or terrain the move changes after its last hit (UsesEnv.fieldFollowed: stepField after
 * applyStep's field), so the step does not stop there. Not for a change the step cannot place after its last hit, which
 * keeps the step's own stop (uses-to-ko.ts staleField: REASONS.fieldChange's text): a spread move (each target's step is
 * planned on the field the move started with), or a move that can hit more than once into a Seed Sower or Sand Spit
 * holder (the field changes at its first hit, between two hits).
 */
export function stepEnv(kernel: TurnKernel, w: World, attacker: DoublesSlotId | null, target: DoublesSlotId, moveId: string, spread: boolean): { fieldFollowed?: true } {
  if (spread) return {};
  const holder = DOUBLES_SLOTS.some((slot) => {
    if (!kernel.alive(w, slot)) return false;
    const build = w.mons[slot]!.build;
    return kernel.fieldSettledAbilities.has(build.abilityId) || kernel.fieldSettledItems.has(build.itemId);
  });
  if (!holder) return {};
  const move = kernel.runtime.movesById.get(moveId);
  const repeats = !!move?.multihit || moveId === "beatup" || (!!attacker && w.mons[attacker]?.build.abilityId === "parentalbond");
  if (repeats && HIT_FIELD_ABILITIES.has(w.mons[target]?.build.abilityId ?? "")) return {};
  return { fieldFollowed: true };
}

/** Tailwind starting on `side`: its Wind Rider and Wind Power holders, by Speed (sideStarted). */
function sideChange(kernel: TurnKernel, w: World, side: DoublesSideId, source: FieldSource | undefined, active: Active) {
  const broken = breakerOf(kernel, w, active);
  for (const slot of bySpeed(kernel, w)) {
    if (slotSide(slot) !== side) continue;
    const mon = w.mons[slot]!;
    const ability = mon.build.abilityId;
    if (ability !== "windrider" && ability !== "windpower") continue;
    if (!runs(kernel, w, slot, active, broken)) continue;
    const label = kernel.abilityName(ability);
    if (ability === "windrider") {
      const changed = kernel.applyBoosts(w, slot, { atk: 1 }, slot, boostOptions(kernel, w, slot, active, broken, "ability", label));
      const text = stageText(changed);
      say(kernel, source, w, slot, text ? `${nameOf(kernel, slot)}'s ${label}: ${text}.` : `${nameOf(kernel, slot)}'s ${label}: its Attack cannot go higher.`);
    } else {
      mon.charged = true;
      say(kernel, source, w, slot, `${label}: ${nameOf(kernel, slot)} is charged.`);
    }
  }
}

/**
 * A side condition starting on `side` (sim/side.ts addSideCondition: SideConditionStart): Tailwind runs each Wind Rider
 * (boost({atk: 1}) from itself: Contrary and Simple read it) and Wind Power (the Charge volatile: its next Electric move
 * doubled) of that side, by Speed. Wind Rider is breakable (a Mold Breaker user's Tailwind skips its partner's). `source`:
 * the move that set it (its user, its facts).
 */
export function sideStarted(kernel: TurnKernel, w: World, side: DoublesSideId, flag: string, source?: FieldSource) {
  if (flag === "tailwind") sideChange(kernel, w, side, source, activeOf(kernel, source));
}

/** With Trick Room up, each held Room Service that works, by Speed (pseudoWeatherChanged). */
function roomService(kernel: TurnKernel, w: World, source: FieldSource | undefined, active: Active) {
  if (!w.field.trickRoom) return;
  const broken = breakerOf(kernel, w, active);
  for (const slot of bySpeed(kernel, w)) {
    const mon = w.mons[slot]!;
    if (mon.build.itemId !== "roomservice" || !kernel.itemWorks(w, mon.build)) continue;
    const name = kernel.itemName("roomservice");
    const changed = kernel.applyBoosts(w, slot, { spe: -1 }, slot, boostOptions(kernel, w, slot, active, broken, "item", name));
    mon.build = { ...mon.build, itemId: "", ...(mon.build.abilityId === "unburden" ? { abilityActive: true } : {}) };
    kernel.noteItemUse(w, slot, "roomservice");
    const text = stageText(changed);
    say(kernel, source, w, slot, `${nameOf(kernel, slot)}'s ${name} is used up under ${kernel.moveName("trickroom")}${text ? `: ${text}` : ""}.`);
  }
}

/**
 * A pseudo-weather starting (sim/field.ts addPseudoWeather: PseudoWeatherChange; Trick Room, Gravity, Magic Room, Wonder
 * Room, Mud Sport, Water Sport, Echoed Voice's, Ion Deluge's; a removal runs none): with Trick Room up, each held Room
 * Service whose item works uses it (useItem: −1 Speed from the holder itself, the item gone, Unburden), by Speed (probes
 * w1b-fc/probes-1 RS3). `source`: the move that set it.
 */
export function pseudoWeatherChanged(kernel: TurnKernel, w: World, id: string, source?: FieldSource) {
  void id;
  roomService(kernel, w, source, activeOf(kernel, source));
}

/**
 * A field-settled item at an Update after its field is off or its item works again (A3's Magic Room end, the end of turn's
 * final Update: E2): Booster Energy for a Protosynthesis or Quark Drive holder whose field is down (else nothing).
 */
export function itemsAfterField(kernel: TurnKernel, w: World, slot: DoublesSlotId, source?: FieldSource): World[] {
  booster(kernel, w, slot, source);
  return [w];
}

/**
 * Forecast or Flower Gift gained mid-turn on Castform or Cherrim (A1's Start table: the ability's onStart runs its
 * WeatherChange handler on the holder alone). `source`: the move that gave it.
 */
export function settleHolder(kernel: TurnKernel, w: World, slot: DoublesSlotId, source?: FieldSource): World[] {
  if (!living(kernel, w, slot)) return [w];
  const ability = w.mons[slot]!.build.abilityId;
  const active = activeOf(kernel, source);
  const form = ability === "forecast" ? forecastForm(kernel, w, slot, null) : ability === "flowergift" ? flowerGiftForm(kernel, w, slot) : null;
  if (form && runs(kernel, w, slot, active, breakerOf(kernel, w, active))) becomes(kernel, w, slot, form, kernel.abilityName(ability), source);
  return [w];
}

// A battle rebuilt from scratch from the AI's seat (SPEC §9.2, I5): a new Battle with its own exact team and one belief
// world for the other side, then every field written from AiInputs (the public state, its own request) and the world,
// then Showdown's own endTurn(). The real battle is never read or cloned here (boundary test). Prototype:
// scripts/.cache/training/design/spec/seat-probe.mjs buildFromPublic; truth-copy check: scripts/lib/showdown-sim/gate.mjs.
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { AiInputs, BeliefWorld } from "../model/ai-inputs";
import type { PublicCondition, PublicMon, ShownHP } from "../model/public-state";
import { createRandom } from "../model/random";
import type { ShowdownSet, SideID } from "../model/showdown-types";
import { identName, type MemberKeys } from "./choices";
import { volatileStates } from "./effects";
import { Battle, Dex, FORMAT, State, toID, type ClonedBattle, type ModdedDex, type WritablePokemon, type WritableSide } from "./sim";
import { countsOf, shownPercent, type StoredEvent } from "./tracker";

export type BeliefBattle = { battle: ClonedBattle; json: string; keys: MemberKeys; approximations: string[] };

/** Base turns and the setter's item that makes them 8 (pinned data/moves.ts durationCallback; rocks, Light Clay, Terrain Extender). */
const DURATION: Record<string, { base: number; item?: string }> = {
  sunnyday: { base: 5, item: "heatrock" }, raindance: { base: 5, item: "damprock" }, sandstorm: { base: 5, item: "smoothrock" },
  snowscape: { base: 5, item: "icyrock" }, hail: { base: 5, item: "icyrock" },
  electricterrain: { base: 5, item: "terrainextender" }, grassyterrain: { base: 5, item: "terrainextender" },
  mistyterrain: { base: 5, item: "terrainextender" }, psychicterrain: { base: 5, item: "terrainextender" },
  reflect: { base: 5, item: "lightclay" }, lightscreen: { base: 5, item: "lightclay" }, auroraveil: { base: 5, item: "lightclay" },
  tailwind: { base: 4 }, trickroom: { base: 5 }, gravity: { base: 5 }, magicroom: { base: 5 }, wonderroom: { base: 5 },
  safeguard: { base: 5 }, mist: { base: 5 }, luckychant: { base: 5 }, fairylock: { base: 2 },
};
const LAYERED: ReadonlySet<string> = new Set(["spikes", "toxicspikes"]);
/** Tracked as side conditions with layers = slot position + 1; slot conditions in the simulator (sim/side.ts slotConditions). */
const SLOT_CONDITIONS: ReadonlySet<string> = new Set(["wish", "futuresight", "doomdesire", "healingwish", "lunardance"]);
/** Future Sight's stored move data (pinned data/moves.ts futuresight onTry). */
const FUTURE_SIGHT_DATA = {
  id: "futuresight", name: "Future Sight", accuracy: 100, basePower: 120, category: "Special", priority: 0,
  flags: { allyanim: 1, metronome: 1, futuremove: 1 }, ignoreImmunity: false, effectType: "Move", type: "Psychic",
};
/** Forms a Pokémon leaves when it switches out (non-permanent formeChange; pinned sim/pokemon.ts clearVolatile setSpecies). */
const TEMPORARY_FORMS: ReadonlySet<string> = new Set([
  "aegislash", "aegislashblade", "morpeko", "morpekohangry", "cramorantgulping", "cramorantgorging", "castformsunny", "castformrainy",
  "castformsnowy", "cherrimsunshine", "eiscuenoice", "wishiwashischool", "miniormeteor", "darmanitanzen", "darmanitangalarzen", "meloettapirouette",
]);

let formatDex: ModdedDex | null = null;
const dex = () => (formatDex ??= Dex.forFormat(FORMAT));
const speciesOfDetails = (details: string) => toID(details.split(",")[0]);

/** HP values a Pokémon with `maxhp` can have while it shows `shown` (pinned Champions shared formula, sim/pokemon.ts:2060-2073). */
export function hpBand(shown: ShownHP, maxhp: number): number[] {
  const out: number[] = [];
  for (let hp = 1; hp <= maxhp; hp++) {
    const each = shownPercent(hp, maxhp);
    if (each.percent === shown.percent && (shown.color === null || each.color === shown.color || each.color === null)) out.push(hp);
  }
  return out;
}

function nameKeys(entries: { key: string; set: ShowdownSet }[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const { key, set } of entries) {
    // A set named as its species battles under its base species' name (pinned sim/pokemon.ts:329-334).
    for (const name of [set.name, set.species, dex().species.get(set.species).baseSpecies]) { map.set(name, key); map.set(toID(name), key); }
  }
  return map;
}

type StatId = "atk" | "def" | "spa" | "spd" | "spe";
type Stats = Record<StatId, number>;
const STAT_IDS: readonly StatId[] = ["atk", "def", "spa", "spd", "spe"];

/** A Pokémon's stored stats in `speciesId`'s form with no change (pinned sim/pokemon.ts setSpecies: battle.spreadModify). */
function formStats(battle: ClonedBattle, speciesId: string, set: object): Stats {
  const stats = (battle as unknown as { spreadModify(base: object, set: object): Stats }).spreadModify(battle.dex.species.get(speciesId).baseStats, set);
  return Object.fromEntries(STAT_IDS.map((stat) => [stat, stats[stat]])) as Stats;
}
/**
 * status2 T1: stored stats after a stint's changes in log order (pinned data/moves.ts powersplit / guardsplit floor averages,
 * speedswap, powertrick / powershift swaps, sim/pokemon.ts transformInto's copy), each partner's own as they stood then (its
 * form then and its changes before). null when a partner is not in the battle.
 */
function replayStored(battle: ClonedBattle, start: Stats, events: readonly StoredEvent[], monOf: (key: string) => WritablePokemon | null): Stats | null {
  const out = { ...start };
  for (const event of events) {
    if (event.move === "powertrick" || event.move === "powershift") { [out.atk, out.def] = [out.def, out.atk]; continue; }
    const partner = event.partner ? monOf(event.partner.key) : null;
    if (!event.partner || !partner) return null;
    const theirs = replayStored(battle, formStats(battle, event.partner.speciesId, partner.set), event.partner.stored, monOf);
    if (!theirs) return null;
    if (event.move === "transform") Object.assign(out, theirs);
    else if (event.move === "speedswap") out.spe = theirs.spe;
    else for (const stat of event.move === "powersplit" ? ["atk", "spa"] as const : ["def", "spd"] as const) out[stat] = Math.floor((out[stat] + theirs[stat]) / 2);
  }
  return out;
}
/**
 * status2 T1: the ability state the public lines decide (tracker.ts PublicCounts), on the active Pokémon's fresh one:
 * Champions' Berserk / Anger Shell lock (checkedBerserk / checkedAngerShell false after a confusion self-hit, or after a
 * single hit with secondaries from a Sheer Force user: data/mods/champions/abilities.ts, PS/sim/battle-actions.ts
 * afterMoveSecondaryEvent), Ripen's weakened Berry (berryWeaken), Opportunist's pending copy (boosts). A lock the lines
 * cannot decide (`unknown`) stays off here; the bridge rolls the cell out.
 */
function abilityStateOf(battle: ClonedBattle, bp: WritablePokemon, mon: PublicMon, monOf: (key: string) => WritablePokemon | null) {
  const counts = countsOf(mon);
  const state = bp.abilityState as Record<string, unknown>;
  // Protean and Libero's once-per-entry flag only from their own type change (tracker.ts typeChanger), not a Soak or Reflect
  // Type on the holder.
  if ((bp.ability === "protean" || bp.ability === "libero") && counts.typeChanger) state[bp.ability] = true;
  // Gastro Acid suppresses the ability's handlers (pinned sim/pokemon.ts ignoringAbility): none of the rest is written then.
  if (mon.volatiles.some((each) => each.id === "gastroacid")) return;
  const flag = bp.ability === "berserk" ? "checkedBerserk" : bp.ability === "angershell" ? "checkedAngerShell" : null;
  const mark = counts.berserk;
  if (flag && mark && mark.kind !== "unknown") {
    const data = mark.kind === "move" ? battle.dex.moves.get(mark.move) as unknown as { secondaries?: readonly unknown[] | null; hasSheerForceBoost?: boolean } : null;
    const sheerForce = mark.kind === "move" && monOf(mark.by)?.ability === "sheerforce" && !!data?.secondaries?.length && !data.hasSheerForceBoost;
    if (mark.kind === "confusion" || sheerForce) state[flag] = false;
  }
  if (bp.ability === "ripen" && counts.ripen === "weaken") state.berryWeaken = true;
  const rises = Object.entries(counts.copyRises ?? {}).filter(([, amount]) => (amount ?? 0) > 0);
  if (bp.ability === "opportunist" && rises.length) state.boosts = Object.fromEntries(rises);
}

export function buildBeliefBattle(inputs: AiInputs, world: BeliefWorld, runtime: BattleRuntime): BeliefBattle {
  void runtime;   // SPEC 9.2 signature; the sets arrive as Showdown sets, so the catalog is not read here
  const ai = inputs.perspective;
  const other: SideID = ai === "p1" ? "p2" : "p1";
  const approximations = new Set<string>();
  const random = createRandom("belief", world.seed);
  const pub = inputs.public;

  // 1. Sides: the AI's brought four in its request's side order (exact sets); the other side's brought four of this world.
  const ownNames = nameKeys([...inputs.own]);
  const aiOrder = inputs.request.side.pokemon.map((pokemon) => {
    const key = ownNames.get(identName(pokemon.ident)) ?? ownNames.get(toID(identName(pokemon.ident)));
    const entry = inputs.own.find((each) => each.key === key);
    if (!entry) throw new Error(`Own member not found: ${pokemon.ident}`);
    return { key: entry.key, set: entry.set, request: pokemon };
  });
  const playerOrder = world.brought.filter((key) => world.sets[key]).map((key) => ({ key, set: world.sets[key], request: null }));
  const order = { [ai]: aiOrder, [other]: playerOrder } as Record<SideID, { key: string; set: ShowdownSet; request: AiInputs["request"]["side"]["pokemon"][number] | null }[]>;
  const sideNames = { p1: nameKeys(order.p1), p2: nameKeys(order.p2) };
  const keys: MemberKeys = {
    keyOf: (side, name) => sideNames[side].get(name) ?? sideNames[side].get(toID(name)) ?? `?${name}`,
    speciesOf: (side, key) => order[side].find((each) => each.key === key)?.set.species ?? key,
  };

  // 2. A fresh battle through team preview; entry effects that fire here are overwritten below.
  const battle = new Battle({ formatid: FORMAT, seed: [7, 7, 7, 7] }) as unknown as ClonedBattle;
  battle.setPlayer("p1", { name: "You", team: order.p1.map((each) => structuredClone(each.set)) });
  battle.setPlayer("p2", { name: "Training", team: order.p2.map((each) => structuredClone(each.set)) });
  const team = (n: number) => `team ${Array.from({ length: n }, (_, i) => i + 1).join("")}`;
  battle.makeChoices(team(order.p1.length), team(order.p2.length));

  const monOfKey = new Map<string, WritablePokemon>();
  for (const side of ["p1", "p2"] as const) order[side].forEach((each, i) => monOfKey.set(`${side}:${each.key}`, battle[side].pokemon[i]));
  const monOf = (key: string | undefined | null) => (key ? monOfKey.get(key) ?? null : null);
  const turn = pub.turn;

  // 3. Every field, per Pokémon.
  const transforms: [WritablePokemon, string][] = [];
  const reflected: [WritablePokemon, string][] = [];
  for (const side of ["p1", "p2"] as const) {
    const isAI = side === ai;
    order[side].forEach((entry, index) => {
      const bp = battle[side].pokemon[index];
      const key = `${side}:${entry.key}`;
      const mon: PublicMon | undefined = pub.mons[key];
      const request = entry.request;
      const active = index < battle[side].active.length;
      // status2 T1: an Imposter that transformed as this battle's leads entered is untransformed first (pinned sim/pokemon.ts
      // clearVolatile); the public -transform line, if any, transforms it again below, into its real target.
      if (bp.transformed) (bp as unknown as { clearVolatile(includeSwitchFlags?: boolean): void }).clearVolatile(false);
      // Form: as shown (temporary forms such as Aegislash-Blade keep the details' name), else its own request's details;
      // formeChange, permanent for Megas.
      const shownSpecies = mon?.speciesId ?? (request ? speciesOfDetails(request.details) : undefined);
      let formChanged = false;
      if (shownSpecies && shownSpecies !== bp.species.id) {
        const mega = request ? /-Mega/.test(request.details) : !!mon?.mega;
        try {
          bp.formeChange(shownSpecies, mega ? bp.getItem() : null, mega || !TEMPORARY_FORMS.has(shownSpecies));
          formChanged = true;
        } catch {
          approximations.add(`Form not rebuilt: ${shownSpecies}.`);
        }
      }
      // HP: exact for its own side (request condition); the other side's from the test reveal, else inside the shown band.
      const condition = request?.condition ?? null;
      const fainted = condition ? condition.endsWith(" fnt") : !!mon?.fainted;
      let hp = bp.maxhp;
      if (fainted) hp = 0;
      else if (condition) hp = Math.min(bp.maxhp, Number(condition.split("/")[0]) || bp.maxhp);
      else if (inputs.reveals.exactHP?.[key]) {
        // Exact under the test setting; a believed maximum other than the real one keeps the real share of it.
        const real = inputs.reveals.exactHP[key];
        hp = real.maxhp === bp.maxhp ? real.hp : Math.min(bp.maxhp, Math.max(real.hp > 0 ? 1 : 0, Math.round((real.hp * bp.maxhp) / Math.max(1, real.maxhp))));
      }
      else if (mon) {
        const band = hpBand(mon.hp, bp.maxhp);
        hp = band.length ? (world.hp === "midpoint" ? band[Math.floor(band.length / 2)] : band[random.int(band.length)]) : Math.max(1, Math.round((bp.maxhp * mon.hp.percent) / 100));
      }
      bp.hp = hp;
      bp.fainted = fainted;
      if (fainted) { bp.isActive = false; bp.switchFlag = false; }

      // Status: sleep and freeze counters redrawn from the public attempts (champions/conditions.ts slp, frz).
      const status = fainted ? "" : (mon?.status ?? (condition?.split(" ")[1] as PublicMon["status"] | undefined) ?? "");
      bp.status = status;
      bp.statusState = battle.initEffectState({ id: status, target: bp });
      const elapsed = mon?.statusElapsed ?? 0;
      if (status === "slp") {
        const step = bp.ability === "earlybird" ? 2 : 1;
        const start = [2, 3, 3].filter((each) => each > elapsed * step);
        const startTime = start.length ? start[random.int(start.length)] : elapsed * step + 1;
        Object.assign(bp.statusState, { startTime, time: startTime - elapsed * step });
      } else if (status === "frz") {
        Object.assign(bp.statusState, { startTime: 3, time: Math.max(1, 3 - elapsed) });
      } else if (status === "tox") {
        Object.assign(bp.statusState, { stage: Math.min(15, elapsed) });
      }
      bp.boosts = mon ? { ...mon.boosts } : { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, accuracy: 0, evasion: 0 };

      // Item: its own side's from the request; the other side's as shown, else the world's set (construction may have used it).
      // status2 T1: the item it last used or ate (pinned pokemon.lastItem) from the public lines (tracker.ts PublicCounts.lastItem).
      const setItem = toID(entry.set.item);
      bp.lastItem = mon ? countsOf(mon).lastItem ?? "" : "";
      if (request) bp.item = request.item;
      else if (mon?.item.state === "gone") bp.item = "";
      else bp.item = mon?.item.state === "held" ? mon.item.itemId : setItem;
      bp.itemKnockedOff = false;
      bp.itemState = battle.initEffectState({ id: bp.item, target: bp });
      bp.usedItemThisTurn = false;
      bp.ateBerry = false;

      // Ability: its own current one; the other side's as shown, else the form's (after a Mega Evolution) or the set's.
      const ability = request ? toID(request.ability ?? request.baseAbility) : mon?.ability?.abilityId ?? (formChanged ? bp.ability : toID(entry.set.ability));
      bp.ability = ability;
      if (request) bp.baseAbility = toID(request.baseAbility);
      else if (mon?.ability?.how === "announced") bp.baseAbility = ability;
      bp.abilityState = battle.initEffectState({ id: ability, target: bp });
      const fallen = mon?.volatiles.find((each) => each.id === "fallen");
      if (fallen) bp.abilityState.fallen = fallen.layers ?? 0;
      // status2 Step 1 #16 (T2E finding 3): Cud Chew's Berry from the public eat line (tracker PublicCounts.cudChew), due at
      // this turn's 28.2 (PS/data/abilities.ts cudchew: counter 1 as a turn starts after the eat), so rollouts re-eat it.
      const chewed = mon ? countsOf(mon).cudChew : undefined;
      if (ability === "cudchew" && chewed && active && !fainted) Object.assign(bp.abilityState, { berry: battle.dex.items.get(chewed.berry), counter: 1 });

      // PP: its own actives from the request; everyone else maxpp − shown uses (R4).
      const requestMoves = isAI && active && !fainted && "active" in inputs.request ? inputs.request.active[index]?.moves ?? [] : [];
      for (const slot of bp.moveSlots) {
        const fromRequest = requestMoves.find((each) => each.id === slot.id && each.pp !== undefined);
        slot.pp = fromRequest?.pp ?? Math.max(0, slot.maxpp - (mon?.movesUsed[slot.id] ?? 0));
        slot.used = (mon?.movesUsed[slot.id] ?? 0) > 0;
      }
      // Moves, results and counters (endTurn moves moveThisTurnResult to moveLastTurnResult and adds 1 to activeTurns).
      bp.lastMove = mon?.lastMove ? battle.dex.getActiveMove(mon.lastMove) : null;
      bp.lastMoveUsed = bp.lastMove;
      bp.lastMoveEncore = null;
      bp.lastMoveTargetLoc = mon?.lastMoveTarget
        ? (mon.lastMoveTarget.side === side ? -(mon.lastMoveTarget.position + 1) : mon.lastMoveTarget.position + 1)
        : undefined;
      bp.moveThisTurnResult = mon?.lastResult ?? undefined;
      bp.timesAttacked = mon?.timesHit ?? 0;
      bp.activeMoveActions = mon?.actions ?? 0;
      bp.previouslySwitchedIn = mon?.switchIns ?? 0;
      bp.isStarted = active && !fainted;
      bp.activeTurns = Math.max(0, (mon?.activeTurns ?? 0) - (active && !fainted ? 1 : 0));
      bp.attackedBy = [];
      if (pub.sides[side].megaUsed) { bp.canMegaEvo = null; bp.canMegaEvoX = null; bp.canMegaEvoY = null; }
      // Once-per-battle entry abilities have fired if it entered before (pinned data/abilities.ts zerotohero's flag on the
      // Pokémon). status2 T2: Supersweet Syrup, Battle Bond, Intrepid Sword and Dauntless Shield's flags from their public lines
      // (tracker.ts PublicCounts.onceUsed): a Pokémon that never had the ability has not used it, whatever its entries.
      const entered = bp.previouslySwitchedIn > 0;
      const once = mon ? countsOf(mon).onceUsed ?? [] : [];
      Object.assign(bp, {
        syrupTriggered: once.includes("supersweetsyrup"), heroMessageDisplayed: entered, bondTriggered: once.includes("battlebond"),
        swordBoost: once.includes("intrepidsword"), shieldBoost: once.includes("dauntlessshield"),
      });
      // Public type changes (Protean, Soak, Reflect Type, Forest's Curse); Protean and Libero act once per entry.
      const typechange = mon?.volatiles.find((each) => each.id === "typechange");
      const typeadd = mon?.volatiles.find((each) => each.id === "typeadd");
      if (typechange && active && !fainted) {
        if (typechange.moveId) {
          bp.types = typechange.moveId.split("/");
          bp.addedType = "";
          bp.apparentType = bp.types.join("/");
          bp.knownType = true;
        } else if (typechange.speciesId) reflected.push([bp, typechange.speciesId]);
        else approximations.add("Type change not rebuilt.");
      }
      // (status2 T1: Protean and Libero's flag is abilityStateOf's, from their own type change only.)
      if (typeadd?.moveId && active && !fainted) bp.addedType = typeadd.moveId;
      if (mon?.transformedInto) transforms.push([bp, mon.transformedInto]);
    });
  }
  // Volatiles once every Pokémon exists (sources and linked volatiles refer to others).
  for (const side of ["p1", "p2"] as const) {
    order[side].forEach((entry, index) => {
      const bp = battle[side].pokemon[index];
      const mon = pub.mons[`${side}:${entry.key}`];
      bp.volatiles = {};
      if (!mon || bp.fainted || index >= battle[side].active.length) return;
      Object.assign(bp.volatiles, volatileStates({ battle, mon: bp, pub: mon, turn, random, monOf, own: side === ai, approximations }));
      abilityStateOf(battle, bp, mon, monOf);
    });
  }
  // Transform, in log order, after everything else. Its public stages and crit volatiles are the tracker's (copied at the
  // -transform line, then changed by later lines), and so are the type changes after it (status2 T1).
  for (const [bp, targetKey] of transforms) {
    const target = monOf(targetKey);
    if (!target || bp.fainted) continue;
    const keep = { boosts: { ...bp.boosts }, volatiles: { ...bp.volatiles }, ability: bp.ability };
    // A target that fainted (or left) since still gave it its form: transformInto refuses a fainted one, so it is up for the call.
    const down = target.fainted;
    if (down) target.fainted = false;
    let done = false;
    try { done = bp.transformInto(target, null); } catch { done = false; }
    if (down) target.fainted = true;
    if (!done) { approximations.add("Transform not rebuilt."); continue; }
    bp.boosts = keep.boosts;
    bp.volatiles = keep.volatiles;
    const key = [...monOfKey].find(([, each]) => each === bp)?.[0] ?? "";
    const mon = pub.mons[key];
    // The ability it copied then (its own request's for the AI's side; the target's as shown at the -transform line), not
    // one the target got since (Skill Swap).
    const copied = mon ? countsOf(mon).stored?.find((event) => event.move === "transform")?.partner : undefined;
    if (key.startsWith(`${ai}:`)) bp.ability = keep.ability;
    else if (copied) bp.ability = copied.ability ?? target.baseAbility;
    // transformInto gave it a fresh ability state: the public lines since rebuild it (Protean's flag, the Berserk lock...).
    if (mon) abilityStateOf(battle, bp, mon, monOf);
    // Its copied moves' PP (5 each, sim/pokemon.ts transformInto): its own request's, else less the public uses since.
    const requestMoves = key.startsWith(`${ai}:`) && "active" in inputs.request ? inputs.request.active[bp.position]?.moves ?? [] : [];
    for (const slot of bp.moveSlots) {
      const fromRequest = requestMoves.find((each) => each.id === slot.id && each.pp !== undefined);
      slot.pp = fromRequest?.pp ?? Math.max(0, slot.pp - (mon?.movesUsed[slot.id] ?? 0));
      slot.used = (mon?.movesUsed[slot.id] ?? 0) > 0;
    }
    // Its types: the target's then (its public change, copied at the -transform line, or after; else the target's form then).
    const typechange = mon?.volatiles.find((each) => each.id === "typechange");
    const typeadd = mon?.volatiles.find((each) => each.id === "typeadd");
    const then = mon ? countsOf(mon).stored?.find((event) => event.move === "transform")?.partner : undefined;
    const form = then ? battle.dex.species.get(then.speciesId) : null;
    if (typechange?.moveId) bp.types = typechange.moveId.split("/");
    else if (form?.exists) bp.types = [...form.types];
    bp.apparentType = bp.types.join("/");
    bp.addedType = typeadd?.moveId ?? "";
  }
  // status2 T1: Reflect Type's copy of its target's form's types then (the line names none: tracker.ts speciesId), set after
  // the transforms as a transformed copier's own change.
  for (const [bp, speciesId] of reflected) {
    const form = battle.dex.species.get(speciesId);
    if (!form.exists) { approximations.add("Type change not rebuilt."); continue; }
    bp.types = [...form.types];
    bp.apparentType = bp.types.join("/");
    bp.knownType = true;
  }
  // status2 T1: the stored-stat changes of each active Pokémon's stint (Power Split, Guard Split, Speed Swap, Power Trick,
  // Transform) replayed in log order on its own form's stats (tracker.ts PublicCounts.stored).
  for (const [key, bp] of monOfKey) {
    const mon = pub.mons[key];
    const events = mon ? countsOf(mon).stored : undefined;
    if (!events?.length || bp.fainted || !bp.isActive) continue;
    const stats = replayStored(battle, formStats(battle, bp.species.id, bp.set), events, monOf);
    if (!stats) { approximations.add("Stored stats not rebuilt."); continue; }
    Object.assign(bp.storedStats as Record<StatId, number>, stats);
    (bp as unknown as { speed: number }).speed = stats.spe;
  }

  // Sides and field.
  // The setter's item when the effect started: what it holds, else what it battled with (Knock Off later does not shorten it).
  const setItemOf = new Map<string, string>();
  for (const side of ["p1", "p2"] as const) for (const each of order[side]) setItemOf.set(`${side}:${each.key}`, toID(each.set.item));
  const itemOf = (setterKey: string | null) => { const setter = monOf(setterKey); return setter ? setter.item || setter.lastItem || (setterKey ? setItemOf.get(setterKey) ?? "" : "") : ""; };
  const turnsLeft = (condition: PublicCondition) => {
    const rule = DURATION[condition.id];
    if (!rule) return undefined;
    const base = rule.item && itemOf(condition.setterKey) === rule.item ? 8 : rule.base;
    return Math.max(1, base - (turn - condition.since));
  };
  for (const side of ["p1", "p2"] as const) {
    const s: WritableSide = battle[side];
    s.sideConditions = {};
    s.slotConditions = s.slotConditions.map(() => ({}));
    for (const condition of pub.sides[side].conditions.filter((each) => SLOT_CONDITIONS.has(each.id))) {
      const setter = monOf(condition.setterKey);
      const slot = s.slotConditions[condition.layers - 1];
      if (!slot || !setter) continue;
      if (condition.id === "wish") {
        // data/moves.ts wish condition: startingTurn is the overflowed turn count at use (turn - 1, sim/battle.ts
        // getOverflowedTurnCount); it heals source.maxhp / 2 at the end of the next turn.
        slot.wish = battle.initEffectState({ id: "wish", target: s, isSlotCondition: true, source: setter, sourceSlot: setter.getSlot(), hp: setter.maxhp / 2, startingTurn: condition.since - 1 });
      } else if (condition.id === "healingwish" || condition.id === "lunardance") {
        // status2 gap fix: a Healing Wish or Lunar Dance waiting for a hurt or statused Pokémon at this position (pinned
        // data/moves.ts healingwish, lunardance condition onSwap: no duration).
        slot[condition.id] = battle.initEffectState({ id: condition.id, target: s, isSlotCondition: true, source: setter, sourceSlot: setter.getSlot() });
      } else {
        // data/conditions.ts futuremove: hits at the end of endingTurn = use turn + 1 (onStart (turn - 1) + 2).
        slot.futuremove = battle.initEffectState({ id: "futuremove", target: s, isSlotCondition: true, source: setter, sourceSlot: setter.getSlot(), targetSlot: `${side}${"ab"[condition.layers - 1]}`, endingTurn: condition.since + 1, move: condition.id, moveData: { ...FUTURE_SIGHT_DATA } });
      }
    }
    for (const condition of pub.sides[side].conditions.filter((each) => !SLOT_CONDITIONS.has(each.id))) {
      const setter = monOf(condition.setterKey);
      const duration = turnsLeft(condition);
      s.sideConditions[condition.id] = battle.initEffectState({
        id: condition.id, target: s, ...(setter ? { source: setter, sourceSlot: setter.getSlot() } : {}),
        ...(duration !== undefined ? { duration } : {}), ...(LAYERED.has(condition.id) ? { layers: condition.layers } : {}),
      });
    }
    s.totalFainted = pub.sides[side].totalFainted;
    s.pokemonLeft = s.pokemon.filter((pokemon) => !pokemon.fainted).length;
    s.faintedThisTurn = monOf(pub.sides[side].faintedLastTurn);
    s.faintedLastTurn = null;
  }
  const weather = pub.field.weather;
  if (weather) {
    const setter = monOf(weather.setterKey);
    const duration = ["desolateland", "primordialsea", "deltastream"].includes(weather.id) ? undefined : turnsLeft(weather);
    battle.field.weather = weather.id;
    battle.field.weatherState = battle.initEffectState({ id: weather.id, ...(setter ? { source: setter, sourceSlot: setter.getSlot() } : {}), ...(duration !== undefined ? { duration } : {}) });
  } else {
    battle.field.weather = "";
    battle.field.weatherState = battle.initEffectState({ id: "" });
  }
  const terrain = pub.field.terrain;
  if (terrain) {
    const setter = monOf(terrain.setterKey);
    battle.field.terrain = terrain.id;
    battle.field.terrainState = battle.initEffectState({ id: terrain.id, ...(setter ? { source: setter, sourceSlot: setter.getSlot() } : {}), duration: turnsLeft(terrain) ?? 5 });
  } else {
    battle.field.terrain = "";
    battle.field.terrainState = battle.initEffectState({ id: "" });
  }
  battle.field.pseudoWeather = {};
  for (const room of pub.field.rooms) {
    const setter = monOf(room.setterKey);
    battle.field.pseudoWeather[room.id] = battle.initEffectState({ id: room.id, ...(setter ? { source: setter, sourceSlot: setter.getSlot() } : {}), duration: turnsLeft(room) ?? 5 });
  }
  battle.lastMove = pub.lastMove ? battle.dex.getActiveMove(pub.lastMove) : null;
  // status2 T2 (ADDENDUM2 §6 entryOrder): the active Pokémon's ability states in the order they began (tracker.ts
  // PublicCounts.entry: switch-ins, Mega Evolutions, ability changes), newer than every state built above (pinned
  // initEffectState's effectOrder orders the RedirectTarget and SwitchIn ties among abilities, and Dancer's); one with no
  // public record keeps its place after them (the bridge passes no rank for it).
  const counter = battle as unknown as { effectOrder: number };
  const actives = (["p1", "p2"] as const).flatMap((side) => order[side].map((entry, index) => ({ bp: battle[side].pokemon[index], mon: pub.mons[`${side}:${entry.key}`] })))
    .filter(({ bp }) => bp.isActive && !bp.fainted)
    .map(({ bp, mon }) => ({ bp, entry: mon ? countsOf(mon).entry : undefined, built: Number(bp.abilityState.effectOrder ?? 0) }))
    .sort((a, b) => (a.entry ?? Infinity) - (b.entry ?? Infinity) || a.built - b.built);
  for (const { bp } of actives) bp.abilityState.effectOrder = counter.effectOrder++;

  // 4. Showdown's own upkeep recomputes disabled moves, Choice lock, trapping and both requests (pinned sim/battle.ts:1623).
  // Replacements. Fainted Pokémon are flagged only once the turn's queue is empty, after the residual phase (pinned
  // sim/battle.ts runAction "switching"), and turnLoop keeps midTurn true at that request, so the commit runs the
  // switches and then endTurn() with no second residual (sim/battle.ts:2943-2956). A request that flags only living
  // Pokémon (U-turn, Parting Shot, Baton Pass, Eject Button/Pack) comes mid-turn: the turn's remaining actions are not
  // public, so the belief battle runs the residual phase after the switches (midTurn false).
  let midTurn = false;
  if ("forceSwitch" in inputs.request) {
    battle.turn = turn;
    inputs.request.forceSwitch.forEach((flag, position) => {
      const bp = battle[ai].active[position];
      if (!bp || !flag) return;
      if (bp.fainted) { midTurn = true; bp.switchFlag = true; return; }
      // A self-switch move flags its user with the move id, which the switch takes as its source (Baton Pass and Shed
      // Tail copy, the line's [from] tag): sim/battle-actions.ts:1311-1312, sim/battle-queue.ts:251-254, battle-actions.ts:77-81.
      const last = pub.mons[`${ai}:${order[ai][position].key}`]?.lastMove ?? null;
      const selfSwitch = last ? (battle.dex.getActiveMove(last) as { selfSwitch?: unknown }).selfSwitch : undefined;
      bp.switchFlag = last && selfSwitch ? last : true;
    });
    const otherSide = battle[other];
    const bench = otherSide.pokemon.slice(otherSide.active.length).some((pokemon) => !pokemon.fainted);
    for (const bp of otherSide.active) if (bp?.fainted && bench) bp.switchFlag = true;
    try { battle.makeRequest("switch"); } catch { approximations.add("Replacement request not rebuilt."); }
  } else {
    battle.turn = turn - 1;
    battle.endTurn();
  }
  battle.midTurn = midTurn;

  // 5. Serialized once for preludes, rollouts and the residual pass.
  const json = JSON.stringify(State.serializeBattle(battle));
  return { battle, json, keys, approximations: [...approximations] };
}

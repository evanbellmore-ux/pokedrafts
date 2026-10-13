import { CALLS_MOVE, DANCE_MOVES, GRAVITY_MOVES, PROTECT_MOVES, REASONS, REDIRECT_ABILITIES } from "./doubles-actions";
import { allyOf, DOUBLES_SLOTS, foesOf, slotSide, type DoublesSlotId } from "./doubles-types";
import { cloneWorld, type PendingAction, type World } from "./doubles-world";
import type { StepStats, TurnKernel, TurnMoveInfo } from "./doubles-turn";
import * as fieldNs from "./doubles-field";
import * as hiddenNs from "./doubles-hidden";
import * as presenceNs from "./doubles-presence";
import { breaks, gameOf, generation, setEot, setVol, tableEntry, type Use } from "./doubles-use";
import { isMaxActive } from "./mechanics";
import type { BattleGame, ChampionsMove, MoveContext } from "./types";
import type { TurnStepOutcome } from "./uses-to-ko";

// The calling moves (status2 ADDENDUM2 §2.3 #28, #49, #51, §4.3 CL; T2P §3.9-§3.15; T2M §3.26, §3.28): Track CL's file (wave
// 1b). Nature Power, Copycat, Mirror Move, Me First, Instruct and Sleep Talk use another move, each through kernel.useCalled
// (the one calling path: no BeforeMove, no PP, the caller's priority and Prankster flag) or, for Instruct, a queued action;
// Uproar wakes every sleeper at its hit and keeps sleep off while it is up; a second Helping Hand (only through Instruct, C26)
// is the kernel's (MonState.helpingHand, MoveContext.helpingHands). Assist (status2 wave 2, R-E) calls from its party's
// moves, the ally's and the bench's (DoublesTurnInput.bench); Metronome stays guarded (ADDENDUM2 §2.3 #28's justification:
// its 553-607-move pool against the budget).
// Every number follows pinned Showdown c23d2e94 (PS/data/moves.ts naturepower, copycat, mirrormove, mefirst, instruct,
// sleeptalk, uproar, helpinghand; PS/sim/battle-actions.ts runMove, useMove, useMoveInner, trySpreadMoveHit, spreadMoveHit;
// PS/sim/battle.ts getRandomTarget, clearActiveMove; PS/sim/battle-queue.ts prioritizeAction); what this file does not follow
// is not estimated with a fact reason. The hook modules' rule holds: the kernel's type only (never doubles-turn.ts at run time).

const hiddenHooks = { ...hiddenNs };
const presenceHooks = { ...presenceNs };
const fieldHooks = { ...fieldNs };


// ------------------------------------------------------------------------------------------------------------------
// Pinned move flags (PS/data/moves.ts with each game's mod), over each game's catalog moves
// (scripts/.cache/calc-audit/status2/build/cl/gen-flags.ts writes them). nomirror and failmefirst: USUM only (Mirror Move and
// Me First are USUM's). mustpressure: getMoveTargets' pressureTargets (sim/pokemon.ts:846-853), the catalog's moves with the flag.
// ------------------------------------------------------------------------------------------------------------------

type FlagKey = "nosleeptalk" | "charge" | "failcopycat" | "failinstruct" | "recharge" | "beforeturn" | "heal" | "sound" | "nomirror" | "failmefirst" | "mustpressure";
const FLAG_TEXT: Record<BattleGame, Partial<Record<FlagKey, string>>> = {
  scarlet_violet: {
    mustpressure: `imprison spikes stealthrock terablast toxicspikes`,
    nosleeptalk: `beakblast belch bounce celebrate copycat dig dive dynamaxcannon fly focuspunch freezeshock iceburn metronome mimic
      phantomforce shadowforce sketch skyattack sleeptalk solarbeam solarblade struggle uproar`,
    charge: `bounce dig dive electroshot fly freezeshock iceburn meteorbeam phantomforce shadowforce skyattack solarbeam solarblade`,
    failcopycat: `banefulbunker beakblast behemothbash behemothblade belch burningbulwark celebrate circlethrow copycat counter
      covet destinybond detect dragontail dynamaxcannon endure feint focuspunch followme helpinghand metronome mimic protect
      ragepowder roar sketch sleeptalk spikyshield struggle switcheroo terastarstorm thief transform trick whirlwind`,
    failinstruct: `beakblast belch bounce celebrate copycat dig dive dynamaxcannon fly focuspunch freezeshock iceburn instruct
      metronome mimic outrage petaldance phantomforce rollout shadowforce sketch skyattack sleeptalk solarbeam solarblade struggle
      thrash transform uproar`,
    recharge: `blastburn frenzyplant gigaimpact hydrocannon hyperbeam prismaticlaser roaroftime rockwrecker`,
    beforeturn: `beakblast chillyreception counter focuspunch mirrorcoat`,
    heal: `absorb bitterblade drainingkiss drainpunch dreameater floralhealing gigadrain healingwish healpulse hornleech
      junglehealing leechlife lifedew lunarblessing lunardance matchagotcha megadrain milkdrink moonlight morningsun
      paraboliccharge recover rest revivalblessing roost shoreup slackoff softboiled strengthsap swallow synthesis wish`,
    sound: `alluringvoice boomburst bugbuzz clangingscales clangoroussoul confide disarmingvoice echoedvoice eeriespell growl
      healbell howl hypervoice metalsound nobleroar overdrive partingshot perishsong psychicnoise relicsong roar round screech
      sing snarl snore sparklingaria supersonic torchsong uproar`,
  },
  champions: {
    mustpressure: `imprison spikes stealthrock toxicspikes`,
    nosleeptalk: `beakblast belch bounce copycat dig dive fly focuspunch phantomforce skyattack sleeptalk solarbeam solarblade
      struggle uproar`,
    charge: `bounce dig dive electroshot fly meteorbeam phantomforce skyattack solarbeam solarblade`,
    failcopycat: `banefulbunker beakblast belch circlethrow copycat counter covet destinybond detect dragontail endure feint
      focuspunch followme helpinghand kingsshield protect ragepowder roar sleeptalk spikyshield struggle switcheroo thief
      transform trick whirlwind`,
    failinstruct: `beakblast belch bounce copycat dig dive fly focuspunch instruct kingsshield meteorassault outrage petaldance
      phantomforce skyattack sleeptalk solarbeam solarblade struggle thrash transform uproar`,
    recharge: `blastburn frenzyplant gigaimpact hydrocannon hyperbeam meteorassault rockwrecker`,
    beforeturn: `beakblast chillyreception counter focuspunch mirrorcoat`,
    heal: `absorb bitterblade drainingkiss drainpunch floralhealing gigadrain healpulse hornleech leechlife lifedew
      lunarblessing matchagotcha megadrain milkdrink moonlight morningsun paraboliccharge recover rest roost shoreup slackoff
      softboiled strengthsap synthesis wish`,
    sound: `alluringvoice boomburst bugbuzz clangingscales clangoroussoul confide disarmingvoice echoedvoice growl healbell howl
      hypervoice metalsound nobleroar overdrive partingshot perishsong psychicnoise relicsong roar round screech sing snarl snore
      sparklingaria supersonic torchsong uproar`,
  },
  sword_shield: {
    mustpressure: `imprison spikes stealthrock toxicspikes`,
    nosleeptalk: `belch bounce celebrate copycat dig dive dynamaxcannon fly focuspunch freezeshock geomancy holdhands iceburn
      metronome mimic naturepower phantomforce shadowforce shelltrap skullbash skyattack sleeptalk solarbeam solarblade struggle
      uproar`,
    charge: `bounce dig dive fly freezeshock geomancy iceburn meteorbeam phantomforce shadowforce skullbash skyattack solarbeam
      solarblade`,
    failcopycat: `banefulbunker behemothbash behemothblade belch celebrate circlethrow copycat counter covet destinybond detect
      dragontail dynamaxcannon endure feint focuspunch followme helpinghand holdhands kingsshield matblock metronome mimic
      mirrorcoat naturepower protect ragepowder roar shelltrap sleeptalk spikyshield struggle switcheroo thief transform trick
      whirlwind`,
    failinstruct: `belch bounce celebrate copycat dig dive dynamaxcannon eternabeam fly focuspunch freezeshock geomancy holdhands
      iceburn instruct kingsshield meteorassault metronome mimic naturepower obstruct outrage petaldance phantomforce rollout
      shadowforce shelltrap skullbash skyattack sleeptalk solarbeam solarblade struggle thrash transform uproar`,
    recharge: `blastburn eternabeam frenzyplant gigaimpact hydrocannon hyperbeam meteorassault prismaticlaser roaroftime
      rockwrecker`,
    beforeturn: `counter focuspunch mirrorcoat shelltrap`,
    heal: `absorb drainingkiss drainpunch dreameater floralhealing gigadrain healingwish healpulse hornleech junglehealing
      leechlife lifedew lunardance megadrain milkdrink moonlight morningsun oblivionwing paraboliccharge purify recover rest roost
      shoreup slackoff softboiled strengthsap swallow synthesis wish`,
    sound: `boomburst bugbuzz clangingscales clangoroussoul confide disarmingvoice echoedvoice eeriespell growl healbell howl
      hypervoice metalsound nobleroar overdrive partingshot perishsong roar round screech sing snarl snore sparklingaria
      supersonic uproar`,
  },
  ultra_sun_ultra_moon: {
    mustpressure: `imprison snatch spikes stealthrock toxicspikes`,
    nosleeptalk: `assist beakblast belch bide bounce celebrate chatter copycat dig dive fly focuspunch freezeshock geomancy holdhands
      iceburn mefirst metronome mimic mirrormove naturepower phantomforce razorwind shadowforce shelltrap sketch skullbash
      skyattack skydrop sleeptalk solarbeam solarblade struggle uproar`,
    charge: `bounce dig dive fly freezeshock geomancy iceburn phantomforce razorwind shadowforce skullbash skyattack skydrop
      solarbeam solarblade`,
    failcopycat: `assist banefulbunker beakblast belch bestow celebrate chatter circlethrow copycat counter covet destinybond
      detect dragontail endure feint focuspunch followme helpinghand holdhands kingsshield matblock mefirst metronome mimic
      mirrorcoat mirrormove naturepower protect ragepowder roar shelltrap sketch sleeptalk snatch spikyshield spotlight struggle
      switcheroo thief transform trick whirlwind`,
    failinstruct: `assist beakblast belch bide bounce celebrate chatter copycat dig dive fly focuspunch freezeshock geomancy
      holdhands iceball iceburn instruct kingsshield mefirst metronome mimic mirrormove naturepower outrage petaldance
      phantomforce razorwind rollout shadowforce shelltrap sketch skullbash skyattack skydrop sleeptalk solarbeam solarblade
      struggle thrash transform uproar`,
    recharge: `blastburn frenzyplant gigaimpact hydrocannon hyperbeam prismaticlaser roaroftime rockwrecker`,
    beforeturn: `beakblast counter focuspunch mirrorcoat pursuit shelltrap`,
    heal: `absorb drainingkiss drainpunch dreameater floralhealing gigadrain healingwish healorder healpulse hornleech leechlife
      lunardance megadrain milkdrink moonlight morningsun oblivionwing paraboliccharge purify recover rest roost shoreup
      slackoff softboiled strengthsap swallow synthesis wish`,
    sound: `boomburst bugbuzz chatter clangingscales clangoroussoulblaze confide disarmingvoice echoedvoice grasswhistle growl
      healbell hypervoice metalsound nobleroar partingshot perishsong relicsong roar round screech sing snarl snore
      sparklingaria supersonic uproar`,
    nomirror: `10000000voltthunderbolt acidarmor aciddownpour acupressure afteryou agility alloutpummeling allyswitch amnesia
      aquaring aromatherapy aromaticmist assist auroraveil autotomize banefulbunker barrier batonpass beakblast belch bellydrum
      bide blackholeeclipse bloomdoom breakneckblitz bulkup calmmind camouflage catastropika celebrate charge
      clangoroussoulblaze coil continentalcrush conversion conversion2 copycat corkscrewcrash cosmicpower cottonguard counter
      craftyshield curse defendorder defensecurl destinybond detect devastatingdrake doomdesire doubleteam dragondance
      electricterrain endure extremeevoboost finalgambit floralhealing flowershield focusenergy focuspunch followme futuresight
      gearup genesissupernova geomancy gigavolthavoc grassyterrain gravity growth grudge guardianofalola guardsplit hail
      happyhour harden haze healbell healingwish healorder healpulse helpinghand holdhands honeclaws howl hydrovortex imprison
      infernooverdrive ingrain instruct iondeluge irondefense kingsshield laserfocus letssnuggleforever lightscreen
      lightthatburnsthesky luckychant lunardance magiccoat magneticflux magnetrise maliciousmoonsault matblock meditate mefirst
      menacingmoonrazemaelstrom metronome milkdrink mimic minimize mirrorcoat mirrormove mist mistyterrain moonlight morningsun
      mudsport nastyplot naturepower neverendingnightmare oceanicoperetta perishsong powersplit powertrick protect
      psychicterrain psychup pulverizingpancake purify quickguard quiverdance ragepowder raindance recover recycle reflect
      reflecttype refresh rest rockpolish roleplay roost rototiller safeguard sandstorm savagespinout searingsunrazesmash
      sharpen shatteredpsyche shellsmash shelltrap shiftgear shoreup sinisterarrowraid sketch slackoff sleeptalk snatch
      softboiled soulstealing7starstrike spikes spikyshield spitup splash splinteredstormshards spotlight stealthrock stickyweb
      stockpile stokedsparksurfer struggle substitute subzeroslammer sunnyday supersonicskystrike swallow swordsdance synthesis
      tailglow tailwind tectonicrage teleport toxicspikes transform twinkletackle watersport wideguard wish withdraw workup`,
    failmefirst: `beakblast belch chatter counter covet focuspunch mefirst metalburst mirrorcoat shelltrap struggle thief`,
  },
};
const FLAGS = Object.fromEntries(Object.entries(FLAG_TEXT).map(([game, keys]) => [game,
  Object.fromEntries(Object.entries(keys).map(([key, text]) => [key, new Set(text!.split(/\s+/).filter(Boolean))])),
])) as unknown as Record<BattleGame, Partial<Record<FlagKey, ReadonlySet<string>>>>;
const has = (kernel: TurnKernel, key: FlagKey, moveId: string) => !!FLAGS[gameOf(kernel)][key]?.has(moveId);

/** The calling moves this file follows (their user moves no other way this action). Assist: from the bench (wave 2); Metronome: kept. */
const CALLERS: ReadonlySet<string> = new Set(["naturepower", "copycat", "mirrormove", "mefirst", "sleeptalk", "assist"]);
/**
 * status2 R-E: the noassist moves of Ultra Sun/Ultra Moon, the one game of the four with Assist (pinned PS/data/moves.ts flags with
 * data/mods/gen7; scripts/.cache/calc-audit/status2/build/w2-re/noassist.ts lists them).
 */
const NO_ASSIST: ReadonlySet<string> = new Set(`assist banefulbunker beakblast belch bestow bounce celebrate chatter circlethrow copycat counter covet destinybond
  detect dig dive dragontail endure feint fly focuspunch followme helpinghand holdhands kingsshield matblock mefirst metronome mimic mirrorcoat mirrormove
  naturepower phantomforce protect ragepowder roar shadowforce shelltrap sketch skydrop sleeptalk snatch spikyshield spotlight struggle switcheroo thief
  transform trick whirlwind`.split(/\s+/).filter(Boolean));
/** Pinned Showdown's callsMove moves (doubles-actions.ts CALLS_MOVE: Protean and Libero wait for the called move's PrepareHit). */
export { CALLS_MOVE };
/** Nature Power's move by terrain (PS/data/moves.ts naturepower onTryHit; SwSh and USUM alike). */
const NATURE_POWER: Record<string, string> = { Electric: "thunderbolt", Grassy: "energyball", Misty: "moonblast", Psychic: "psychic", "": "triattack" };
/** The -ate abilities (a Normal move, a status one too, becomes their type: PS/data/abilities.ts aerilate and its kin onModifyType). */
const ATE: Record<string, string> = { aerilate: "Flying", pixilate: "Fairy", refrigerate: "Ice", galvanize: "Electric", dragonize: "Dragon" };
/** Target types getRandomTarget answers with the user (PS/sim/battle.ts:2490-2520). */
const USER_TARGETS = new Set(["self", "all", "allySide", "allyTeam", "adjacentAllyOrSelf"]);
/** Target types whose sampled foe nothing reads (spread, side and field moves; the random move picks once in resolveTargets). */
const UNREAD_TARGETS = new Set(["allAdjacent", "allAdjacentFoes", "foeSide", "allies", "randomNormal", "scripted"]);
/** Single-target types: an instructed move from an earlier turn needs where it was aimed (lastMoveTargetLoc). */
const PICKED_TARGETS = new Set(["normal", "any", "adjacentFoe", "adjacentAllyOrSelf"]);
/** The charging moves whose volatile Instruct reads (PS/data/moves.ts instruct onHit: beakblast, focuspunch, shelltrap). */
const CHARGING_VOLATILES = new Set(["beakblast", "focuspunch", "shelltrap"]);
/** Moves read by the Counter family's records (PR's MonState.taken), which a called use does not have. */
const RECORD_MOVES = new Set(["metalburst", "comeuppance"]);

// ------------------------------------------------------------------------------------------------------------------
// presenceGuards' lines (before the walk)
// ------------------------------------------------------------------------------------------------------------------

/**
 * A move that uses another move (doubles-turn.ts presenceGuards): Metronome (kept: a uniform pick over 553-607 moves, 366-402
 * of them damaging, needs a calculation per damaging move and target, beyond the 160 of the budget on every turn) and Assist
 * without its side's bench (its party's moves are the bench's). The other callers are followed (statusMove); the guards below
 * keep the parts the turn does not follow where Showdown's state is not the app's.
 */
export function callingGuard(kernel: TurnKernel, w: World, slot: DoublesSlotId) {
  const moveId = kernel.input.pokemon[slot]!.action.moveId!;
  if (moveId === "metronome") kernel.notEstimated(REASONS.notIn2v2(kernel.moveName("metronome")));
  // status2 R-E: Assist reads its party's moves from the side's bench (assist); without a bench the party is not known. The
  // party is every member of side.pokemon, a fainted one too, and the bench lists the living ones: the turn assumes none fainted.
  if (moveId === "assist") {
    if (!kernel.baseInput.bench?.[slotSide(slot)]) kernel.notEstimated(REASONS.needsParty(kernel.moveName("assist"), kernel.names[slot]));
    kernel.turnFact(`Assumes no Pokémon of ${kernel.names[slot]}'s party fainted before this turn.`);
  }
  // Me First's 1.5x lasts the turn (its volatile, duration 1): a Dancer holder's later copy of a damaging dance reads it too.
  if (moveId === "mefirst" && w.mons[slot]!.build.abilityId === "dancer" && DOUBLES_SLOTS.some((other) => {
    const id = kernel.input.pokemon[other]?.action.moveId;
    return other !== slot && !!id && DANCE_MOVES.has(id) && kernel.runtime.movesById.get(id)?.category !== "Status";
  })) kernel.notEstimated(REASONS.combo(kernel.moveName("mefirst"), kernel.abilityName("dancer")));
  if (CALLERS.has(moveId)) {
    // The move a caller calls is the action's active move after it (PS/sim/battle-actions.ts runMove: `move =
    // this.battle.activeMove`): a Dancer copies a called dance and a later Fusion move reads a called Fusion move, which the
    // turn's history keeps as the caller's. Read only where the caller can call one (callablePool; null: not known).
    const actions = DOUBLES_SLOTS.map((other) => kernel.input.pokemon[other]?.action.moveId).filter((id): id is string => !!id);
    const dancer = DOUBLES_SLOTS.some((other) => other !== slot && w.mons[other]?.build.abilityId === "dancer");
    const pool = callablePool(kernel, w, slot, moveId);
    const can = (test: (id: string) => boolean) => pool === null || pool.some(test);
    if (dancer && can((id) => DANCE_MOVES.has(id))) kernel.notEstimated(REASONS.combo(kernel.moveName(moveId), kernel.abilityName("dancer")));
    const fusion = actions.find((id) => id === "fusionbolt" || id === "fusionflare");
    if (fusion && can((id) => id === "fusionbolt" || id === "fusionflare")) kernel.notEstimated(REASONS.combo(kernel.moveName(moveId), kernel.moveName(fusion)));
  }
  if (moveId !== "copycat") return;
  const others = DOUBLES_SLOTS.filter((other) => other !== slot && w.mons[other] && !kernel.input.pokemon[other]?.switchedIn);
  // A Z-Move's use is the battle's last move as the Z-Move (PS/data/moves.ts copycat: isZ fails), while the turn's history
  // writes its base move.
  for (const other of others) {
    const id = kernel.input.pokemon[other]!.action.moveId;
    if (id && kernel.input.pokemon[other]!.contexts[id]?.useZ) kernel.notEstimated(REASONS.combo(kernel.moveName("copycat"), "a Z-Move"));
  }
}

/**
 * The moves `slot`'s caller `moveId` can call this turn (callingGuard's pool), or null where they are not known. Sleep Talk:
 * its own moves but the nosleeptalk and charge ones (sleepTalk). Nature Power: its terrain moves (NATURE_POWER: no dance, no
 * Fusion move). Assist: its party's moves (assist: the ally's and the bench's). Copycat: the battle's last move before the
 * turn (given) and any move another Pokémon uses this turn (its action, or its last move again by Instruct). Mirror Move: another
 * Pokémon's last move, this turn's or the input's. Me First: a foe's queued damaging move without failmefirst.
 */
function callablePool(kernel: TurnKernel, w: World, slot: DoublesSlotId, moveId: string): readonly string[] | null {
  const others = DOUBLES_SLOTS.filter((other) => other !== slot && kernel.input.pokemon[other]);
  const actionsOf = (slots: DoublesSlotId[]) => slots.map((other) => kernel.input.pokemon[other]!.action.moveId).filter((id): id is string => !!id);
  const lastOf = (slots: DoublesSlotId[]) => slots.map((other) => kernel.input.pokemon[other]!.lastMove).filter((id): id is string => !!id);
  switch (moveId) {
    case "sleeptalk": {
      const moves = kernel.input.pokemon[slot]!.moves;
      return moves ? moves.filter((id) => id !== "sleeptalk" && !has(kernel, "nosleeptalk", id) && !has(kernel, "charge", id)) : null;
    }
    case "naturepower": return Object.values(NATURE_POWER);
    case "assist": {
      const side = slotSide(slot);
      const party = [kernel.input.pokemon[allyOf(slot)]?.moves, ...(kernel.baseInput.bench?.[side] ?? []).map((each) => each.moves)];
      if (!kernel.input.pokemon[allyOf(slot)] || !kernel.baseInput.bench?.[side] || party.some((moves) => !moves)) return null;
      return party.flatMap((moves) => moves!);
    }
    // Not given, the battle's last move before the turn is copycat's own reason where Copycat reads it (before any action).
    case "copycat": return [...(kernel.input.battleLastMove ? [kernel.input.battleLastMove] : []), ...actionsOf(others), ...lastOf(others)];
    case "mirrormove": return [...actionsOf(others), ...lastOf(others)];
    // Me First calls only a damaging move without failmefirst (data/moves.ts:11542-11551 mefirst onTryHit; meFirst below).
    case "mefirst": return actionsOf(others.filter((other) => kernel.isFoe(slot, other)))
      .filter((id) => kernel.runtime.movesById.get(id)?.category !== "Status" && !has(kernel, "failmefirst", id));
  }
  void w;
  return null;
}

/**
 * doubles-status.ts presenceGuards' Sleep Talk and Uproar lines: Uproar's assumption (an Uproar from last turn stops every
 * sleep from the turn's start, a new one only from its hit).
 */
export function presence(kernel: TurnKernel, w: World, slot: DoublesSlotId) {
  const entry = kernel.input.pokemon[slot]!;
  const moveId = entry.action.moveId!;
  if (moveId !== "uproar") return;
  void w;
  if (entry.carried?.uproar === undefined) kernel.turnFact(`Assumes ${kernel.names[slot]} did not use Uproar last turn.`);
}

// ------------------------------------------------------------------------------------------------------------------
// The callers' own use (doubles-status.ts statusMove calls statusMove first)
// ------------------------------------------------------------------------------------------------------------------

/**
 * Nature Power, Copycat, Mirror Move, Me First, Instruct and Sleep Talk used as the action's own move (after its BeforeMove):
 * their worlds, or null for another move.
 */
export function statusMove(kernel: TurnKernel, w: World, action: PendingAction, move: ChampionsMove): World[] | null {
  if (!CALLERS.has(move.id) && move.id !== "instruct") return null;
  // The battle's last move (Copycat's) read before this action changes it: the caller's own, unless it calls a move (useCalled
  // writes that one: PS/sim/battle.ts clearActiveMove keeps the active move, the called one).
  const last = w.lastMove !== undefined ? w.lastMove : kernel.input.battleLastMove;
  if (CALLERS.has(move.id)) noteLast(kernel, w, move.id);
  switch (move.id) {
    case "sleeptalk": return sleepTalk(kernel, w, action, move);
    case "assist": return assist(kernel, w, action, move);
    case "copycat": return copycat(kernel, w, action, move, last);
    case "naturepower": return aimed(kernel, w, action, move, (world, use, target) => naturePower(kernel, world, use, target));
    case "mirrormove": return aimed(kernel, w, action, move, (world, use, target) => mirrorMove(kernel, world, use, target));
    case "mefirst": return aimed(kernel, w, action, move, (world, use, target) => meFirst(kernel, world, use, target));
    case "instruct": return aimed(kernel, w, action, move, (world, use, target) => instruct(kernel, world, use, target));
    default: return null;
  }
}

/** A Helping Hand on `ally` this turn (doubles-status.ts earlyBranch, after the count): a second one is the kernel's (C26: MoveContext.helpingHands, round(4096 × 1.5^n)). */
export function helpingHand(kernel: TurnKernel, w: World, action: PendingAction, ally: DoublesSlotId) {
  void kernel; void w; void action; void ally;
}

/** Uproar keeps `slot` from falling asleep (data/moves.ts uproar condition onAnySetStatus): any Pokémon in battle with the uproar volatile (this turn's or carried). */
export function uproarSleep(kernel: TurnKernel, w: World, slot: DoublesSlotId): boolean {
  void slot;
  return DOUBLES_SLOTS.some((holder) => kernel.alive(w, holder) && w.mons[holder]!.vol.uproar !== undefined && !w.leaving?.includes(holder));
}

/**
 * After a damaging hit (doubles-turn.ts afterHit, CL-1): Uproar's own TryHit (data/moves.ts uproar onTryHit, after the
 * protections and immunities: the hit landed or met a Substitute) wakes every sleeping Pokémon in battle, then its self
 * volatile starts (duration 3: two turns left after this one). Neither reads anything the hit's damage reads.
 */
export function afterHit(kernel: TurnKernel, w: World, action: PendingAction, target: DoublesSlotId, outcome: TurnStepOutcome, info: TurnMoveInfo) {
  if (action.moveId !== "uproar" || info.transformed || outcome.landed + outcome.subHits <= 0) return;
  for (const slot of DOUBLES_SLOTS) {
    const mon = w.mons[slot];
    if (!mon || mon.fainted || mon.build.status !== "slp" || w.leaving?.includes(slot)) continue;
    mon.build = { ...mon.build, status: "" };
    setVol(w, slot, { sleep: undefined });
    // sim/pokemon.ts cureStatus: a sleep's end takes Nightmare with it.
    if (mon.eot.nightmare) setEot(w, slot, { nightmare: undefined });
    const text = `Uproar: ${kernel.names[slot]} wakes up.`;
    if (slot === target) kernel.hitFact(action, slot, text, w.mass);
    else kernel.stepFact(action, text, w.mass);
  }
  const user = w.mons[action.slot]!;
  if (!user.fainted && user.vol.uproar === undefined) setVol(w, action.slot, { uproar: 2 });
}

/** Me First's 1.5x for the move it calls (data/moves.ts mefirst condition onBasePower, priority 12: chainModify(1.5)). */
export function context(kernel: TurnKernel, w: World, action: PendingAction, target: DoublesSlotId, info: TurnMoveInfo): MoveContext | undefined {
  void w; void target;
  if (info.transformed || action.source === "instruct" || action.external) return undefined;
  if (kernel.input.pokemon[action.slot]?.action.moveId !== "mefirst" || action.moveId === "mefirst") return undefined;
  return { powerMods: [6144] };
}

// ------------------------------------------------------------------------------------------------------------------
// Sleep Talk and Copycat (target: the user)
// ------------------------------------------------------------------------------------------------------------------

/**
 * Sleep Talk (PS/data/moves.ts sleeptalk): its onTry fails it awake (Comatose counts as asleep); asleep it picks uniformly
 * among its move slots but nosleeptalk and charge moves (no Z-Move or Max Move is a slot), and uses the pick with no target
 * (getRandomTarget); none: it fails.
 */
function sleepTalk(kernel: TurnKernel, w: World, action: PendingAction, move: ChampionsMove): World[] {
  const mon = w.mons[action.slot]!;
  const name = kernel.names[action.slot];
  if (mon.build.status !== "slp" && mon.build.abilityId !== "comatose") {
    kernel.stepFact(action, `${move.name} fails: ${name} is awake.`, w.mass);
    return [w];
  }
  const moves = kernel.input.pokemon[action.slot]!.moves;
  if (!moves) kernel.notEstimated(REASONS.needsMoves(move.name, name));
  const callable = [...new Set(moves)].filter((id) => !!id && id !== "sleeptalk" && !has(kernel, "nosleeptalk", id) && !has(kernel, "charge", id));
  // A called protecting move or Endure rolls last turn's counter (carried.stall: carriedState keeps it for a Sleep Talk user
  // with one among its moves, doubles-turn.ts calledStall), in doubles-status.ts earlyBranch's stallPrepare.
  return own(kernel, w, action, () => {
    if (!callable.length) { kernel.stepFact(action, `${move.name} fails: ${name} has no move it can call.`, w.mass); return [w]; }
    const share = w.mass / callable.length;
    return callable.flatMap((id, index) => {
      const world = index === callable.length - 1 ? w : cloneWorld(w, share);
      if (index === callable.length - 1) w.mass = share;
      return callRandom(kernel, world, action, move, id);
    });
  });
}

/**
 * status2 R-E: Assist (PS/data/moves.ts assist onHit; Ultra Sun/Ultra Moon): a move of the user's party at random, the multiset
 * of every other party member's move slots but the noassist moves, Z-Moves and Max Moves (sample): its partner's (in play or
 * fainted there) and its side's bench's (the input's bench Pokémon and those that left this turn), each called with no target
 * (getRandomTarget). A party member whose moves are not given (an empty slot: its Pokémon fainted on an earlier turn; a bench
 * Pokémon without `moves`) leaves the pool unknown: not estimated (REASONS.needsParty). None: it fails.
 */
function assist(kernel: TurnKernel, w: World, action: PendingAction, move: ChampionsMove): World[] {
  const user = action.slot;
  const side = slotSide(user);
  const unknown = () => kernel.notEstimated(REASONS.needsParty(move.name, kernel.names[user]));
  const pool: string[] = [];
  const add = (moves: readonly string[] | undefined) => {
    if (!moves) unknown();
    for (const id of moves!) {
      const called = kernel.runtime.movesById.get(id);
      if (!called || called.isZ || called.isMax || NO_ASSIST.has(id)) continue;
      pool.push(id);
    }
  };
  const partner = kernel.input.pokemon[allyOf(user)];
  if (!partner) unknown();
  add(partner!.moves);
  const bench = kernel.baseInput.bench?.[side];
  if (!bench) unknown();
  for (const id of w.bench?.[side] ?? bench!.map((each) => each.id)) {
    if (id.startsWith("slot:")) add(kernel.baseInput.pokemon[id.slice(5) as DoublesSlotId]?.moves);
    else add(bench!.find((each) => each.id === id)?.moves);
  }
  return own(kernel, w, action, () => {
    if (!pool.length) { kernel.stepFact(action, `${move.name} fails: no move of the party can be called.`, w.mass); return [w]; }
    const counts = new Map<string, number>();
    for (const id of pool) counts.set(id, (counts.get(id) ?? 0) + 1);
    const picks = [...counts];
    return picks.flatMap(([id, count], index) => {
      const share = w.mass * count / pool.length;
      const world = index === picks.length - 1 ? w : cloneWorld(w, share);
      if (index === picks.length - 1) w.mass = share;
      return callRandom(kernel, world, action, move, id);
    });
  });
}

/**
 * Copycat (PS/data/moves.ts copycat): the battle's last move (PS/sim/battle.ts clearActiveMove: the active move at the end of
 * the last action that was not stopped before its move; this turn's, else the input's battleLastMove), its Max Move's base
 * move; none: nothing happens; a failcopycat move or a Z-Move: it fails. The move is used with no target (getRandomTarget).
 */
function copycat(kernel: TurnKernel, w: World, action: PendingAction, move: ChampionsMove, last: string | null | undefined): World[] {
  if (last === undefined) kernel.notEstimated(REASONS.needsLastMoveUsed(move.name));
  return own(kernel, w, action, () => {
    if (last === null) { kernel.stepFact(action, `${move.name} fails: no move has been used.`, w.mass); return [w]; }
    // A No move is Splash (SPEC C13), which does nothing (Champions has no Splash of its own).
    if (last === "splash") { kernel.stepFact(action, `${move.name} calls Splash.`, w.mass); return [w]; }
    const used = kernel.runtime.movesById.get(last);
    if (used?.isMax) kernel.notEstimated(REASONS.needsLastMoveUsed(move.name));
    if (!used || used.isZ || has(kernel, "failcopycat", last)) {
      kernel.stepFact(action, `${move.name} fails: it cannot copy ${used?.name ?? kernel.moveName(last)}.`, w.mass);
      return [w];
    }
    return callRandom(kernel, w, action, move, last);
  });
}

/**
 * The caller's own hit on its user (a self-target status move: trySpreadMoveHit's steps reach it, PS/sim/battle-actions.ts
 * hitStepInvulnerabilityEvent): the user's hit entry is reached once (the action's reach is the union of the caller's and
 * the called move's), an effect where no called move reached it.
 */
function own(kernel: TurnKernel, w: World, action: PendingAction, run: () => World[]): World[] {
  const stats = kernel.hitStats(action, action.slot);
  const mass = w.mass;
  const before = stats?.reached ?? 0;
  const out = run();
  if (stats) {
    const called = stats.reached - before;
    stats.reached = before + mass;
    if (called < mass) stats.effect += mass - called;
  }
  return out;
}

// ------------------------------------------------------------------------------------------------------------------
// Nature Power, Mirror Move, Me First, Instruct (a chosen target)
// ------------------------------------------------------------------------------------------------------------------

/**
 * A targeted caller's own use (useMoveInner, trySpreadMoveHit): its targets (redirection included), TryMove (the priority
 * shields), then the hit steps at its one target: the invulnerability step, the TryHit event (Quick Guard, Psychic Terrain,
 * the protecting moves for one with the protect flag, Crafty Shield, Good as Gold), TryImmunity (Prankster into a Dark foe);
 * then its own TryHit or onHit (`effect`) in the hit loop, before a Substitute (none of them is stopped by one: Nature Power's
 * and Mirror Move's run first, Me First and Instruct bypass it). No PrepareHit of its own: Protean waits for the called move
 * (callsMove), and none of them is snatchable.
 */
function aimed(kernel: TurnKernel, w: World, action: PendingAction, move: ChampionsMove, effect: (w: World, use: Use, target: DoublesSlotId) => World[],
  called?: { priority: number; prankster?: boolean }): World[] {
  const user = action.slot;
  const entry = tableEntry(kernel, move.id);
  if (!entry) kernel.notEstimated(REASONS.notIn2v2(move.name));
  const build = w.mons[user]!.build;
  // A Normal caller's type changes with an -ate ability, Electrify or Ion Deluge (an absorber or a Lightning Rod would read it).
  if (move.type === "Normal" && ATE[build.abilityId]) kernel.notEstimated(REASONS.combo(move.name, kernel.abilityName(build.abilityId)));
  if (w.mons[user]!.vol.electrify) kernel.notEstimated(REASONS.combo(move.name, kernel.moveName("electrify")));
  if (move.type === "Normal" && w.field.ionDeluge) kernel.notEstimated(REASONS.combo(move.name, kernel.moveName("iondeluge")));
  const info: TurnMoveInfo = {
    kind: "move", effective: move, transformed: false, isZ: false, isMax: false, contact: false,
    flags: Object.fromEntries(Object.keys(entry!.flags).map((flag) => [flag, 1])), drain: false, secondaries: false, recoil: false,
  };
  // A called one is used with its caller's priority and Prankster flag (useMoveInner: the active move's).
  const priority = called ? called.priority : action.frozen ? action.frozen.priority - action.fractional : kernel.priorityOf(w, action);
  const prankster = called?.prankster ?? (build.abilityId === "prankster" && generation(kernel) >= 7);
  const out: World[] = [];
  for (const resolution of kernel.resolveTargets(w, action, info, move.type)) {
    const world = resolution.world;
    for (const fact of resolution.facts) kernel.stepFact(action, fact, world.mass);
    if (!resolution.targets.length) {
      if (!resolution.failed) kernel.stepFact(action, `${move.name} fails: no target.`, world.mass);
      out.push(world);
      continue;
    }
    const target = resolution.targets[resolution.targets.length - 1];
    const shield = kernel.priorityShield(world, action, move, target, priority, info);
    if (shield) { kernel.stepFact(action, shield, world.mass); out.push(world); continue; }
    if (resolution.swap) kernel.stepFact(action, resolution.swap, world.mass);
    const use: Use = {
      action, user, move, entry: entry!, info, type: move.type, priority, prankster, bounced: false,
      infiltrates: build.abilityId === "infiltrator", targetType: entry!.target, reached: new Set(),
    };
    const stats = kernel.hitStats(action, target);
    use.reached.add(target);
    if (stats) stats.reached += world.mass;
    const passed = hitSteps(kernel, world, use, target);
    if (!passed.pass) { out.push(...passed.worlds); continue; }
    // The union of the caller's reach and the called move's: the called move's reach of the same Pokémon adds nothing.
    const before = stats?.reached ?? 0;
    const mass = world.mass;
    const worlds = effect(world, use, target);
    if (stats) {
      const called = stats.reached - before;
      stats.reached = before;
      if (called < mass) stats.effect += mass - called;
    }
    out.push(...worlds);
  }
  return out;
}

/** The hit steps before a targeted caller's own effect at `slot` (aimed): `pass` false with the worlds where it stopped (their facts written). */
function hitSteps(kernel: TurnKernel, w: World, use: Use, slot: DoublesSlotId): { pass: boolean; worlds: World[] } {
  const { user, move } = use;
  const stats = kernel.hitStats(use.action, slot);
  const name = kernel.names[slot];
  const stop = (text: string, immune = false) => {
    if (stats) { if (immune) stats.noDamage += w.mass; else stats.blocked += w.mass; }
    kernel.hitFact(use.action, slot, text, w.mass);
    return { pass: false, worlds: [w] };
  };
  // 0. The invulnerability step (C27): a commanding Tatsugiri (PR), then a hidden Pokémon (H).
  const missed = presenceHooks.invulnerable(kernel, w, user, slot) ?? hiddenHooks.missesStatus(kernel, w, use, slot);
  if (missed) return stop(`${move.name} misses ${name} (${missed}).`);
  // 1. The TryHit event, by handler priority (doubles-status.ts tryHit's order).
  const flags = use.entry.flags;
  const side = w.sides[slotSide(slot)];
  if (side.quickGuard && use.priority > 0.1 && flags.protect) return stop(`Quick Guard blocks ${move.name}.`);
  if (w.field.terrain === "Psychic" && use.priority > 0.1 && kernel.isFoe(user, slot) && kernel.grounded(w, slot) && !w.mons[slot]!.eot.hidden) {
    return stop(`Psychic Terrain: ${name} is not affected.`);
  }
  const mon = w.mons[slot]!;
  if (mon.protect && flags.protect && ["protect", "spikyshield", "banefulbunker"].includes(mon.protect)) {
    const by = kernel.moveName(Object.entries(PROTECT_MOVES).find(([, kind]) => kind === mon.protect)![0]);
    return stop(`${by} blocks ${move.name}.`);
  }
  // Crafty Shield (Magic Coat: none of these is reflectable).
  const sided = fieldHooks.tryHitSide(kernel, w, use, slot);
  if (sided && !sided.pass) return { pass: false, worlds: sided.worlds };
  if (mon.build.abilityId === "goodasgold" && slot !== user && !breaks(kernel, w, use, slot)) return stop(`${kernel.abilityName("goodasgold")}: ${name} is not affected.`);
  // 3. TryImmunity: Prankster into a Dark foe (generation 7 on; PS/sim/battle-actions.ts hitStepTryImmunity).
  if (use.prankster && kernel.isFoe(user, slot) && kernel.typesIn(w, slot).includes("Dark")) return stop(`Prankster: ${name} is not affected.`, true);
  return { pass: true, worlds: [w] };
}

/** Nature Power (PS/data/moves.ts naturepower onTryHit): the terrain's move at its target. */
function naturePower(kernel: TurnKernel, w: World, use: Use, target: DoublesSlotId): World[] {
  const called = NATURE_POWER[w.field.terrain || ""] ?? "triattack";
  return call(kernel, w, use.action, use.move, called, target);
}

/** The move `slot` used last (sim/pokemon.ts moveUsed: lastMove): this turn's (vol.usedMove), else the input's; undefined: not known. */
function lastMoveOf(kernel: TurnKernel, w: World, caller: ChampionsMove, slot: DoublesSlotId): { id: string | null; thisTurn: boolean } {
  const entry = kernel.input.pokemon[slot]!;
  // A Pokémon that switched in this turn has used no move since it came in.
  if (entry.switchedIn) return { id: null, thisTurn: false };
  const used = w.mons[slot]!.vol.usedMove;
  if (used !== undefined) return { id: used, thisTurn: true };
  // A No move that was picked is Splash (SPEC C13) where it passed its BeforeMove, which vol.usedMove does not keep.
  if (entry.action.moveId === null && w.mons[slot]!.moved) kernel.notEstimated(REASONS.combo(caller.name, "No move"));
  const input = entry.lastMove;
  if (input === undefined) kernel.notEstimated(REASONS.needsLastMove(caller.name, kernel.names[slot]));
  return { id: input, thisTurn: false };
}

/** Mirror Move (USUM; PS/data/moves.ts mirrormove onTryHit): the target's last move with the mirror flag (no Z-Move or Max Move), at the target. */
function mirrorMove(kernel: TurnKernel, w: World, use: Use, target: DoublesSlotId): World[] {
  const last = lastMoveOf(kernel, w, use.move, target).id;
  const name = kernel.names[target];
  if (last === null) { kernel.hitFact(use.action, target, `${use.move.name} fails: ${name} has used no move.`, w.mass); return [w]; }
  const used = kernel.runtime.movesById.get(last);
  if (!used || used.isZ || used.isMax || has(kernel, "nomirror", last)) {
    kernel.hitFact(use.action, target, `${use.move.name} fails: it cannot copy ${used?.name ?? kernel.moveName(last)}.`, w.mass);
    return [w];
  }
  return call(kernel, w, use.action, use.move, last, target);
}

/**
 * Me First (USUM; PS/data/moves.ts mefirst onTryHit): the target's queued move (queue.willMove), if it is a damaging move
 * that is not a Z-Move, a Max Move or failmefirst, and the target does not have to recharge; used at the target with 1.5x
 * power (context).
 */
function meFirst(kernel: TurnKernel, w: World, use: Use, target: DoublesSlotId): World[] {
  const name = kernel.names[target];
  const fail = (text: string) => { kernel.hitFact(use.action, target, `${use.move.name} fails: ${text}.`, w.mass); return [w]; };
  const queued = w.remaining.find((entry) => entry.slot === target);
  if (!queued) return fail(`${name} has moved`);
  // No move is Splash (SPEC C13): a status move.
  const id = queued.moveId;
  const move = id ? kernel.runtime.movesById.get(id) : undefined;
  const mon = w.mons[target]!;
  if (!id || !move || move.category === "Status") return fail(`${name}'s move is not an attack`);
  if (kernel.input.pokemon[target]!.contexts[id]?.useZ || move.isZ || move.isMax || isMaxActive(mon.build) || mon.vol.mustRecharge || has(kernel, "failmefirst", id)) {
    return fail(`it cannot copy ${name}'s move`);
  }
  return call(kernel, w, use.action, use.move, id, target);
}

/**
 * Instruct (PS/data/moves.ts instruct onHit): the target's last move again, at once, as a new action prioritized next
 * (queue.prioritizeAction: order 3; generation 7's unsorted queue runs it next too), aimed where that move was aimed
 * (lastMoveTargetLoc). It fails with no last move, a Dynamaxed target, a failinstruct, charge or recharge move, a Z-Move or
 * Max Move, or while the target charges Beak Blast, Focus Punch or Shell Trap. A move with a beforeTurnCallback (Counter,
 * Mirror Coat, Pursuit, Chilly Reception) is queued as that callback alone (resolveAction's first action): the target uses
 * nothing more.
 */
function instruct(kernel: TurnKernel, w: World, use: Use, target: DoublesSlotId): World[] {
  const name = kernel.names[target];
  const mon = w.mons[target]!;
  const fail = (text: string) => { kernel.hitFact(use.action, target, `${use.move.name} fails: ${text}.`, w.mass); return [w]; };
  const { id: last, thisTurn } = lastMoveOf(kernel, w, use.move, target);
  if (last === null) return fail(`${name} has used no move`);
  const move = kernel.runtime.movesById.get(last);
  if (isMaxActive(mon.build)) return fail(`${name} is Dynamaxed`);
  if (!move || move.isZ || move.isMax || has(kernel, "failinstruct", last) || has(kernel, "charge", last) || has(kernel, "recharge", last)) {
    return fail(`${name} cannot use ${move?.name ?? kernel.moveName(last)} again`);
  }
  if (w.remaining.some((entry) => entry.slot === target && entry.moveId !== null && CHARGING_VOLATILES.has(entry.moveId) && !kernel.input.pokemon[target]!.contexts[entry.moveId]?.useZ)) {
    return fail(`${name} is focusing on its move`);
  }
  // The move slot's PP now (moveSlot.pp <= 0 fails): the given PP less what it spent this turn (spendPP).
  const ppLeft = kernel.input.pokemon[target]!.carried?.ppLeft?.[last];
  if (ppLeft !== undefined && ppLeft - (mon.vol.ppSpent?.[last] ?? 0) <= 0) return fail(`${name}'s ${move.name} has no PP left`);
  // Where that move was aimed: this turn's action (the input's target, unless an Encore changed the move), else the input's.
  let aim: DoublesSlotId | null;
  if (thisTurn) {
    const own = kernel.input.pokemon[target]!.action;
    if (own.moveId !== last) kernel.notEstimated(REASONS.combo(use.move.name, kernel.moveName("encore")));
    aim = own.target;
  } else {
    const given = kernel.input.pokemon[target]!.lastMoveTarget;
    const picks = PICKED_TARGETS.has(move.target);
    if (picks && (given === undefined || given === null)) kernel.notEstimated(REASONS.needsLastTarget(use.move.name, name));
    aim = picks ? given! : null;
  }
  if (move.target === "adjacentAlly") aim = null;
  if (has(kernel, "beforeturn", last)) {
    kernel.hitFact(use.action, target, `Instruct: ${name}'s ${move.name} is not used again.`, w.mass);
    return [w];
  }
  // Generation 7: the inserted action is next whatever the frozen order (prioritize's rule); later generations sort it at order 3.
  const orders = w.remaining.map((entry) => entry.order ?? 200).filter((order) => order < 200);
  const order = kernel.gen7 ? Math.min(3, ...orders.map((each) => each - 0.001)) : 3;
  const index = kernel.extraStep("Instruct", target, last, undefined, w.mons[target]!.id);
  const inserted: PendingAction = { index, slot: target, moveId: last, target: aim, fractional: 0, order, source: "instruct" };
  kernel.insertAction(w, inserted);
  kernel.stepFact(inserted, `Instruct: ${name} uses ${move.name} again.`, w.mass);
  if (ppLeft === undefined) kernel.turnFact(`Assumes ${name}'s ${move.name} has PP left.`);
  return [w];
}

/**
 * A called Instruct (Copycat, Sleep Talk, Assist: kernel.useCalled, doubles-status.ts runCalledStatus): the direct one's
 * handling (aimed, instruct) at `action.target`, the foe its caller's getRandomTarget gave (callRandom), with the caller's
 * priority and Prankster flag (PS/data/moves.ts instruct has no failcopycat or nosleeptalk flag).
 */
export function calledInstruct(kernel: TurnKernel, w: World, action: PendingAction, move: ChampionsMove, opts: { priority: number; prankster?: boolean }): World[] {
  return aimed(kernel, w, action, move, (world, use, target) => instruct(kernel, world, use, target), opts);
}

/** The moves that can bring an Instruct this turn: Instruct, or a calling move that can call it. */
const INSTRUCTING: ReadonlySet<string> = new Set(["instruct", "copycat", "sleeptalk", "assist"]);
/**
 * The PP `slot` spends on `moveId` this turn (MoveVolatiles.ppSpent), kept only where an Instruct reads it (its PP is given,
 * DoublesCarried.ppLeft, and an Instruct can come): with `targets` null, the one its own or an instructed use deducts as it
 * passes BeforeMove (sim/battle-actions.ts:281 deductPP; not a Dancer's copy or a called move: :278, 473); with `targets`, one
 * more for each foe with Pressure among the Pokémon the use is aimed at after redirection (:467-482, getMoveTargets'
 * pressureTargets; data/abilities.ts pressure onDeductPP: not for an ally), every living foe for a mustpressure move
 * (sim/pokemon.ts:846-853: Imprison, Snatch, Spikes, Stealth Rock, Tera Blast, Toxic Spikes; a foeSide move passes none).
 */
export function spendPP(kernel: TurnKernel, w: World, slot: DoublesSlotId, moveId: string, targets: readonly DoublesSlotId[] | null) {
  if (kernel.input.pokemon[slot]?.carried?.ppLeft?.[moveId] === undefined) return;
  if (!DOUBLES_SLOTS.some((each) => INSTRUCTING.has(kernel.input.pokemon[each]?.action.moveId ?? ""))) return;
  const aimed = targets && has(kernel, "mustpressure", moveId) ? DOUBLES_SLOTS.filter((each) => kernel.isFoe(slot, each)) : targets;
  const spent = aimed ? aimed.filter((target) => kernel.isFoe(slot, target) && kernel.alive(w, target) && w.mons[target]!.build.abilityId === "pressure").length : 1;
  if (!spent) return;
  const was = w.mons[slot]!.vol.ppSpent;
  setVol(w, slot, { ppSpent: { ...was, [moveId]: (was?.[moveId] ?? 0) + spent } });
}

// ------------------------------------------------------------------------------------------------------------------
// The call (kernel.useCalled)
// ------------------------------------------------------------------------------------------------------------------

/** The called move with no chosen target (Sleep Talk, Copycat): one call per target getRandomTarget can give (PS/sim/battle.ts:2490-2520). */
function callRandom(kernel: TurnKernel, w: World, action: PendingAction, caller: ChampionsMove, moveId: string): World[] {
  const move = kernel.runtime.movesById.get(moveId);
  if (!move) kernel.notEstimated(REASONS.notIn2v2(kernel.moveName(moveId)));
  const user = action.slot;
  if (USER_TARGETS.has(move!.target)) return call(kernel, w, action, caller, moveId, user, true);
  if (move!.target === "adjacentAlly") {
    const ally = allyOf(user);
    return call(kernel, w, action, caller, moveId, kernel.alive(w, ally) ? ally : null, true);
  }
  if (UNREAD_TARGETS.has(move!.target)) return call(kernel, w, action, caller, moveId, null, true);
  // A single-target move: a random living adjacent foe (every foe is adjacent in doubles); none: the foe across, which has
  // fainted (no target).
  const foes = foesOf(user).filter((slot) => kernel.alive(w, slot));
  if (!foes.length) return call(kernel, w, action, caller, moveId, foesOf(user)[0], true);
  const share = w.mass / foes.length;
  return foes.flatMap((foe, index) => {
    const world = index === foes.length - 1 ? w : cloneWorld(w, share);
    if (index === foes.length - 1) w.mass = share;
    return call(kernel, world, action, caller, moveId, foe, true);
  });
}

/** The step's statistics' called move (DoublesStep.effectiveName), kept only while every call of the step is one move. */
const CALLED = new WeakMap<StepStats, string | null>();

/**
 * One call of `moveId` by `action`'s user at the Pokémon `target` (or none): ModifyMove first (Gravity, Heal Block and Throat
 * Chop stop a called move there: PS/data/moves.ts gravity, healblock, throatchop onModifyMove), then kernel.useCalled with the
 * caller's priority and Prankster flag. A target is passed as the position it stands at (a tracking move's as the Pokémon).
 */
function call(kernel: TurnKernel, w: World, action: PendingAction, caller: ChampionsMove, moveId: string, target: DoublesSlotId | null, random = false): World[] {
  const move = kernel.runtime.movesById.get(moveId);
  if (!move) kernel.notEstimated(REASONS.notIn2v2(kernel.moveName(moveId)));
  const user = action.slot;
  const mon = w.mons[user]!;
  kernel.stepFact(action, `${caller.name} calls ${move!.name}.`, w.mass);
  noteCalled(kernel, action, move!);
  // From here the called move is the active move (useMoveInner's setActiveMove): the battle's last move whatever follows.
  const done = () => { noteLast(kernel, w, moveId); return [w]; };
  const blocked = w.field.gravity && GRAVITY_MOVES.has(moveId) ? "Gravity"
    : mon.eot.healBlock && has(kernel, "heal", moveId) ? kernel.moveName("healblock")
    : mon.throatChopped && has(kernel, "sound", moveId) ? kernel.moveName("throatchop") : null;
  if (blocked) { kernel.stepFact(action, `${blocked}: ${move!.name} cannot be used.`, w.mass); return done(); }
  // The Counter family's own state: Counter and Mirror Coat fail with no volatile of their beforeTurnCallback (a called use
  // never has one); Metal Burst and Comeuppance read a record only their own action keeps.
  if (moveId === "counter" || moveId === "mirrorcoat") { kernel.stepFact(action, `${move!.name} fails.`, w.mass); return done(); }
  if (RECORD_MOVES.has(moveId)) kernel.notEstimated(REASONS.combo(caller.name, move!.name));
  // A random-target move given its caller's target (Me First's, Mirror Move's) keeps it; the turn's own random pick would not.
  if (!random && move!.target === "randomNormal") kernel.notEstimated(REASONS.combo(caller.name, move!.name));
  // A Prankster caller's priority boost goes with a called damaging move (useMoveInner: pranksterBoosted): a Dark foe it
  // reaches is immune (hitStepTryImmunity), which the damaging path does not read. A caller with its own target met that
  // target's immunity itself; a random pick that is a Dark foe is immune here, unless a redirection could move the move first.
  const damaging = move!.category !== "Status";
  const dark = damaging && mon.build.abilityId === "prankster" && generation(kernel) >= 7
    ? foesOf(user).filter((foe) => kernel.alive(w, foe) && kernel.typesIn(w, foe).includes("Dark")) : [];
  if (dark.length) {
    const several = move!.target === "allAdjacent" || move!.target === "allAdjacentFoes" || move!.target === "randomNormal";
    const redirects = DOUBLES_SLOTS.some((slot) => kernel.alive(w, slot) && (!!w.mons[slot]!.centre || !!REDIRECT_ABILITIES[w.mons[slot]!.build.abilityId]));
    if (several || (random && redirects)) kernel.notEstimated(REASONS.combo(caller.name, kernel.abilityName("prankster")));
    if (random && target !== null && dark.includes(target)) {
      const stats = kernel.hitStats(action, target);
      if (stats) { stats.reached += w.mass; stats.noDamage += w.mass; }
      kernel.hitFact(action, target, `Prankster: ${kernel.names[target]} is not affected.`, w.mass);
      return done();
    }
  }
  let at: DoublesSlotId | null = null;
  if (target !== null) {
    const info = damaging ? kernel.moveInfo(w, user, moveId, kernel.input.pokemon[user]!.contexts[moveId]) : null;
    const tracks = info?.kind === "move" && kernel.tracksTarget(w, user, move!, info);
    at = tracks ? target : kernel.positionOf(w, target);
  }
  return kernel.useCalled(w, action, moveId, at);
}

/**
 * The battle's last move (World.lastMove, Copycat's: only with a Copycat user in the turn, the kernel's readers rule): a
 * caller writes its own id as its action starts and a called move's where the call stops before kernel.useCalled (which
 * writes the called id itself).
 */
function noteLast(kernel: TurnKernel, w: World, moveId: string) {
  if (DOUBLES_SLOTS.some((slot) => kernel.input.pokemon[slot]?.action.moveId === "copycat")) w.lastMove = moveId;
}

/** CL-4: the moves whose action writes the battle's last move itself (doubles-turn.ts noteHistory leaves World.lastMove to this file for them). */
export function ownsLastMove(moveId: string): boolean {
  return CALLERS.has(moveId);
}

/** DoublesStep.effectiveName and effectiveType: the called move's while it is the only one this step has called (as for a Z-Move). */
function noteCalled(kernel: TurnKernel, action: PendingAction, move: ChampionsMove) {
  const step = kernel.step(action);
  if (!step) return;
  const known = CALLED.get(step);
  if (known === undefined) {
    CALLED.set(step, move.id);
    step.effectiveName = move.name;
    step.effectiveType = move.type;
  } else if (known !== null && known !== move.id) {
    CALLED.set(step, null);
    delete step.effectiveName;
    delete step.effectiveType;
  }
}

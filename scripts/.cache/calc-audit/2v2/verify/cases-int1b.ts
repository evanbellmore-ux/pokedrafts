// status2 integration 1b: the cases for the integrator's own lines (status2/build/INTEGRATION-1B.md), each against pinned
// Showdown c23d2e94 as every other case: Symbiosis after a Fling took its user's item (G4-FLG-09's family: doubles-guards.ts
// symbiosisPass), and Smack Down landing a Fly user already on the ground (H's guard gone: doubles-typing.ts
// groundingAfterHit). Showdown names; level 50, 31 IVs, Serious nature, 0 EVs unless set. Wired into cases-wave1b.ts.
import type { Case } from "./case-types";
import { OL, OR, PL, PR, act, carried, idle, lax, mon, slots } from "./case-kit";

const sneasler = (item: string, extra: Record<string, unknown> = {}) => mon("Sneasler", "Unburden", { item, nature: "Jolly", evs: { atk: 252, spe: 252 }, ...extra });
const oranguru = (item: string) => mon("Oranguru", "Symbiosis", { item });
const hatterene = mon("Hatterene", "Magic Bounce", { nature: "Modest", evs: { spa: 252 } });
const alakazam = mon("Alakazam", "Inner Focus", { nature: "Modest", evs: { spa: 252 } });

export const INT1B_CASES: Case[] = [
  {
    id: "INT-SYM-01-sv", game: "sv", outcomes: true,
    title: "Sneasler flings its Iron Ball; Oranguru's Symbiosis passes it a Sitrus Berry, which it eats after Snorlax's Body Slam",
    slots: slots(act(sneasler("Iron Ball"), "Fling", PR), idle(oranguru("Sitrus Berry")), act(lax(8), "Body Slam", OL), idle(lax(16))),
    checks: "abilities.ts symbiosis onAllyAfterUseItem at the fling volatile's AfterUseItem; the Sitrus at the Update after the later hit (155 - 79..93 <= 77).",
  },
  {
    id: "INT-SYM-02-sv", game: "sv",
    title: "Sneasler at 60 HP flings its Iron Ball: the Sitrus Berry Symbiosis passes is due at once (the narrow reason)",
    notEstimated: "Fling with Symbiosis is not modelled in 2v2.",
    slots: slots(act(sneasler("Iron Ball", { hp: 60 }), "Fling", PR), idle(oranguru("Sitrus Berry")), idle(lax(8)), idle(lax(16))),
    checks: "The passed Berry would be eaten at the hit's Update (doubles-guards.ts symbiosisPass keeps it narrow).",
  },
  // D's ask 2 (W1A-D.md): Fling's thrown item is gone at the hit's Update, before recoil and onAfterMoveSecondarySelf.
  {
    id: "INT-FLG-01-sv", game: "sv", outcomes: true,
    title: "Sneasler at 100 HP flings its Shell Bell into Snorlax: no Shell Bell heal",
    slots: slots(act(sneasler("Shell Bell", { hp: 100 }), "Fling", PR), idle(lax(0)), idle(lax(8)), idle(lax(16))),
    checks: "items.ts shellbell onAfterMoveSecondarySelf: the item is gone (fling condition onUpdate at the hit's Update).",
  },
  {
    id: "INT-FLG-02-sv", game: "sv", outcomes: true,
    title: "Sneasler flings its Life Orb into a Substitute: no Life Orb recoil; the Orb is used up",
    slots: slots(act(sneasler("Life Orb"), "Fling", PR), idle(lax(0)), idle(lax(8)), idle(lax(16, { substitute: 60 }))),
    checks: "A hit into a Substitute: the fling volatile's Update still takes the item; no recoil.",
  },
  {
    id: "INT-FLG-03-sv", game: "sv", outcomes: true,
    title: "Sneasler flings its Life Orb into Mimikyu's Disguise: no Life Orb recoil; Disguise is busted",
    slots: slots(act(sneasler("Life Orb"), "Fling", PR), idle(lax(0)), idle(lax(8)), idle(mon("Mimikyu", "Disguise"))),
    checks: "The face takes the hit (doubles-faces.ts): no recoil from a flung Life Orb.",
  },
  {
    id: "INT-FLG-04-sv", game: "sv", outcomes: true,
    title: "Sneasler at 10 HP flings its Life Orb: no recoil, it keeps its 10 HP; a slower Snorlax's Body Slam then hits it",
    slots: slots(act(sneasler("Life Orb", { hp: 10 }), "Fling", PR), idle(lax(0)), act(lax(8), "Body Slam", OL), idle(lax(16))),
    checks: "No Life Orb after Fling: the user is not knocked out by it.",
  },
  // K's "Innards Out with earlier damage this turn" (W1B-K.md K-IO-06): the holder's HP differs between entries after a spread
  // hit; the later single hit that knocks it out is stepped once per HP (doubles-turn.ts singleStep's split).
  {
    id: "INT-IO-01-swsh", game: "swsh", outcomes: true,
    title: "Garchomp's Rock Slide, then a slower Dragonite's Dragon Claw knocks out the hurt Pyukumuku: Innards Out from each HP it had",
    slots: slots(act(mon("Garchomp", "Rough Skin", { evs: { spe: 252 } }), "Rock Slide"), act(mon("Dragonite", "Inner Focus", { ivs: { spe: 0 }, nature: "Brave" }), "Dragon Claw", PL),
      idle(mon("Pyukumuku", "Innards Out", { hp: 60 })), idle(lax(16))),
    checks: "abilities.ts innardsout onDamagingHit: this.damage(target.getUndynamaxedHP(damage), source): the HP before the knocking hit.",
  },
  // A spread move's user whose stages one target changes (census: spreadEffect beyond ADDENDUM2 §2.3 #4): Mirror Armor's
  // reflected drop and Gulp Missile's Def -1, replayed in target order (doubles-reactions.ts stageReaction).
  {
    id: "INT-SPE-01-sv", game: "sv", outcomes: true,
    title: "Flutter Mane's Icy Wind into Corviknight (Mirror Armor) and Snorlax: Corviknight reflects the Speed drop onto Flutter Mane",
    slots: slots(act(mon("Flutter Mane", "Protosynthesis"), "Icy Wind"), idle(lax(0)), idle(mon("Corviknight", "Mirror Armor")), idle(lax(8))),
    checks: "abilities.ts mirrorarmor onTryBoost: the negative boost goes to the source (boost from the holder).",
  },
  {
    id: "INT-SPE-02-sv", game: "sv", outcomes: true,
    title: "Kilowattrel (Competitive)'s Electroweb into two Mirror Armor Corviknight: two reflected drops with no target to compose from (the narrow reason)",
    notEstimated: "Electroweb's effect on Kilowattrel from more than one target is not modelled.",
    slots: slots(act(mon("Kilowattrel", "Competitive"), "Electroweb"), idle(lax(0)), idle(mon("Corviknight", "Mirror Armor")), idle(mon("Corviknight", "Mirror Armor", { evs: { hp: 4 } }))),
    checks: "Two Mirror Armor holders: each reflects; Competitive +2 Sp. Atk per drop (onAfterEachBoost), Speed -2.",
  },
  {
    id: "INT-SPE-03-sv", game: "sv", outcomes: true,
    title: "Garchomp's Rock Slide into Cramorant (Gulping) and Snorlax: Gulp Missile hits Garchomp for a quarter and lowers its Defense",
    slots: slots(act(mon("Garchomp", "Rough Skin", { evs: { spe: 252 } }), "Rock Slide"), idle(lax(0)), idle(mon("Cramorant-Gulping", "Gulp Missile")), idle(lax(8))),
    checks: "abilities.ts gulpmissile onDamagingHit: damage baseMaxhp / 4, boost({def: -1}, source, target), then formeChange('cramorant').",
  },
  {
    id: "INT-SPE-04-champions", game: "champions", outcomes: true,
    title: "Garchomp's Rock Slide into Mirror Armor Corviknight (no certain drop to reflect) and Spicy Spray Scovillain-Mega: burned once",
    slots: slots(act(mon("Garchomp", "Rough Skin", { evs: { spe: 32 } }), "Rock Slide"), idle(lax(0)), idle(mon("Corviknight", "Mirror Armor")), idle(mon("Scovillain-Mega", "Spicy Spray", { item: "Scovillainite" }))),
    checks: "A Mirror Armor holder with nothing to reflect is a target with no reaction (the reference state).",
  },
  {
    id: "INT-SPE-05-sv", game: "sv", outcomes: true,
    title: "Magmar's Heat Wave into Cramorant and Cramorant-Gulping: only the Gulping one hits back (a quarter, Def -1)",
    slots: slots(act(mon("Magmar", "Flame Body"), "Heat Wave"), idle(lax(0)), idle(mon("Cramorant", "Gulp Missile")), idle(mon("Cramorant-Gulping", "Gulp Missile"))),
    checks: "gulpmissile onDamagingHit acts only for the Gulping and Gorging forms.",
  },
  {
    id: "INT-SMK-01-sv", game: "sv", outcomes: true,
    title: "Tyranitar's Smack Down into an Iron Ball Dragonite releasing Fly: it lands, its Fly is cancelled; Snorlax's Body Slam hits it",
    slots: slots(act(mon("Dragonite", "Inner Focus", { item: "Iron Ball", carried: { charging: "Fly" } }), "Fly", PL), idle(lax(8)),
      act(mon("Tyranitar", "Unnerve"), "Smack Down", OL), act(lax(0), "Body Slam", OL)),
    checks: "moves.ts smackdown condition onStart: removeVolatile('fly') sets applies before the grounding check; queue.cancelMove.",
  },
  // A landing whose user is not in battle (conditions.ts futuremove onEnd: trySpreadMoveHit from data.source, no ModifyType;
  // Normalize only for an active source): residualHit's action only names the user's side (PendingAction.userless), whose
  // first slot may be empty (t2-fuzz seed 101: Training after the user fainted and nothing came in) or hold another Pokémon.
  {
    id: "INT-FUT-01-sv", game: "sv", outcomes: true,
    title: "Future Sight from a fainted Hatterene lands on Snorlax; the first slot of Hatterene's side is empty",
    slots: slots({ ...lax(2), absent: true, action: { move: null } }, idle(lax(0)),
      idle(lax(12)), idle(carried(lax(8, { item: "Leftovers" }), { futureMove: { move: "futuresight", bench: hatterene, benchSide: "own", fainted: true } }))),
    checks: "futuremove onEnd with data.source fainted: its ability and item do not count; Leftovers after the landing (order 5.4).",
  },
  {
    id: "INT-FUT-02-usum", game: "usum", outcomes: true,
    title: "Future Sight from Alakazam on the bench lands on Kecleon; the first slot of its side is empty: Color Change makes Kecleon Psychic",
    slots: slots({ ...lax(2), absent: true, action: { move: null } }, idle(lax(4)),
      idle(lax(12)), idle(carried(mon("Kecleon", "Color Change"), { futureMove: { move: "futuresight", bench: alakazam, benchSide: "own" } }))),
    checks: "abilities.ts colorchange onAfterMoveSecondary: the landing's type, Psychic.",
  },
  {
    id: "INT-FUT-03-usum", game: "usum", outcomes: true,
    title: "Future Sight from Alakazam on the bench lands on Kecleon beside a Normalize Delcatty on Alakazam's side: Kecleon becomes Psychic",
    slots: slots(idle(mon("Delcatty", "Normalize")), idle(lax(4)),
      idle(lax(12)), idle(carried(mon("Kecleon", "Color Change"), { futureMove: { move: "futuresight", bench: alakazam, benchSide: "own" } }))),
    checks: "futuremove onEnd: data.source.hasAbility('normalize') is the bench Alakazam's (false); Delcatty is not the user.",
  },
];
void OR;

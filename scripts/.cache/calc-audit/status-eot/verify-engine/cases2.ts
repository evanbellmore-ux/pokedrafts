// Verification cases, batch 2: the H2-H8 neighbourhoods. Same conventions as cases.ts.
import type { Case, CaseAction, CaseMon, SlotId } from "../../2v2/verify/case-types";
import { chomp, jolt, lax, saur, toise } from "../../2v2/verify/cases-s";

type Slot = CaseMon & { action: CaseAction };
const mon = (species: string, ability: string, extra: Partial<CaseMon> = {}): CaseMon => ({ species, ability, ...extra });
const act = (m: CaseMon, move: string | null, target?: SlotId, context?: Record<string, unknown>): Slot =>
  ({ ...m, action: { move, ...(target ? { target } : {}), ...(context ? { context } : {}) } });
const idle = (m: CaseMon): Slot => act(m, null);
const empty = (m: CaseMon): Slot => ({ ...m, absent: true, action: { move: null } });
const slots = (ownLeft: Slot, ownRight: Slot, oppLeft: Slot, oppRight: Slot): Case["slots"] =>
  ({ "own-left": ownLeft, "own-right": ownRight, "opponent-left": oppLeft, "opponent-right": oppRight });
const OL: SlotId = "own-left", OR: SlotId = "own-right", PL: SlotId = "opponent-left", PR: SlotId = "opponent-right";
void PR;

export const VERIFY_CASES_2: Case[] = [
  // ---- H2 / M3 / H8 neighbourhood: drops to accuracy and evasion, and what reads them.
  {
    id: "VE-H2-1", title: "Sand Attack into a Keen Eye Eject Pack holder that attacks later", game: "sv",
    slots: slots(act(chomp(), "Sand Attack", PL), idle(saur()), act(mon("Skarmory", "Keen Eye", { item: "Eject Pack" }), "Brave Bird", OL), idle(toise())),
    checks: "Keen Eye keeps accuracy: no drop, no Eject Pack; Brave Bird comes.",
  },
  {
    id: "VE-H2-2", title: "Sand Attack into a Contrary Eject Pack holder that attacks later", game: "sv",
    slots: slots(act(chomp(), "Sand Attack", PL), idle(saur()), act(mon("Malamar", "Contrary", { item: "Eject Pack" }), "Psycho Cut", OL), idle(toise())),
    checks: "Contrary: +1 accuracy, a rise: no Eject Pack.",
  },
  {
    id: "VE-H2-3", title: "Sand Attack into a Mirror Armor Eject Pack holder (Gravity)", game: "sv", field: { gravity: true },
    slots: slots(act(chomp(), "Sand Attack", PL), idle(saur()), act(mon("Corviknight", "Mirror Armor", { item: "Eject Pack" }), "Body Press", OL), idle(toise())),
    checks: "The drop goes back to Garchomp: Corviknight's stats did not fall, no Eject Pack.",
  },
  {
    id: "VE-H2-4", title: "Sand Attack into an Eject Pack holder under Magic Room", game: "sv", field: { magicRoom: true },
    slots: slots(act(chomp(), "Sand Attack", PL), idle(saur()), act(lax({ item: "Eject Pack" }), "Body Slam", OL), idle(toise())),
    checks: "Items do not work: no Eject Pack.",
  },
  {
    id: "VE-H2-5", title: "Trick Room Sweet Scent into a Defiant foe and a Competitive foe that attack later", game: "sv", field: { trickRoom: true },
    slots: slots(act(mon("Amoonguss", "Regenerator"), "Sweet Scent"), idle(saur()), act(mon("Kingambit", "Defiant"), "Iron Head", OL), act(mon("Milotic", "Competitive"), "Scald", OL)),
    checks: "Evasion −2 on each: Defiant +2 Attack, Competitive +2 Sp. Atk.",
  },
  {
    id: "VE-H2-6", title: "USUM: Kinesis into a Competitive foe that attacks later", game: "usum",
    slots: slots(act(mon("Alakazam", "Magic Guard"), "Kinesis", PL), idle(saur()), act(mon("Milotic", "Competitive"), "Scald", OL), idle(toise())),
    checks: "Accuracy −1: Competitive +2 Sp. Atk for Scald.",
  },
  {
    id: "VE-H2-7", title: "SwSh: Smokescreen into Illuminate (no TryBoost before generation 9)", game: "swsh",
    slots: slots(act(mon("Charizard", "Blaze"), "Smokescreen", PL), idle(saur()), idle(mon("Lanturn", "Illuminate")), idle(toise())),
    checks: "Generation 8 Illuminate has no onTryBoost: accuracy −1.",
  },
  {
    id: "VE-H2-8", title: "Champions: Mud-Slap into Illuminate", game: "champions",
    slots: slots(act(mon("Excadrill", "Sand Rush"), "Mud-Slap", PL), idle(saur()), idle(mon("Starmie", "Illuminate")), idle(toise())),
    checks: "Champions (gen 9) Illuminate keeps accuracy.",
  },
  {
    id: "VE-H2-9", title: "Sand Attack into a White Herb holder", game: "sv", outcomes: true,
    slots: slots(act(chomp(), "Sand Attack", PL), idle(saur()), idle(lax({ item: "White Herb" })), idle(toise())),
    checks: "White Herb (onAnyAfterMove: every stage below 0, accuracy included) is used: the accuracy is restored.",
  },
  {
    id: "VE-H2-10", title: "Mud-Slap into a White Herb holder", game: "sv", outcomes: true,
    slots: slots(act(mon("Excadrill", "Sand Rush"), "Mud-Slap", PL), idle(saur()), idle(lax({ item: "White Herb" })), idle(toise())),
    checks: "The accuracy drop uses White Herb after the move.",
  },
  {
    id: "VE-H2-11", title: "Mud-Slap into a White Herb Unburden Hitmonlee, which then outspeeds Gengar", game: "sv", outcomes: true,
    slots: slots(act(mon("Excadrill", "Sand Rush", { evs: { spe: 252 }, nature: "Jolly" }), "Mud-Slap", PL), act(mon("Gengar", "Cursed Body", { hp: 60 }), "Shadow Ball", PL), act(mon("Hitmonlee", "Unburden", { item: "White Herb" }), "Knock Off", OR), idle(toise())),
    checks: "White Herb used after Mud-Slap: Unburden doubles Hitmonlee's Speed (107 → 214), so it moves before Gengar (130).",
  },
  {
    id: "VE-H2-12", notEstimated: "Punishment with Jolteon's accuracy or evasion stage from this turn is not modelled in 2v2.", title: "USUM: Double Team, then a foe's Punishment into its user", game: "usum",
    slots: slots(act(jolt(), "Double Team"), idle(saur()), act(mon("Weavile", "Pressure"), "Punishment", OL), idle(toise())),
    checks: "Punishment counts every positive stage, evasion included: 80 power.",
  },
  {
    id: "VE-H2-13", notEstimated: "Opportunist copying a stat rise is not modelled in 2v2.", title: "Double Team with an Opportunist foe", game: "sv",
    slots: slots(act(mon("Dragapult", "Clear Body"), "Double Team"), idle(saur()), act(mon("Espathra", "Opportunist"), "Stored Power", OL), idle(toise())),
    checks: "Opportunist copies +1 evasion: Stored Power 40 power (not modelled: guard expected).",
  },
  // ---- H3 neighbourhood: a capped rise is not a rise.
  {
    id: "VE-H3-1", title: "Swords Dance at +6 with an Opportunist foe", game: "sv",
    slots: slots(act(mon("Kingambit", "Defiant", { boosts: { atk: 6 } }), "Swords Dance"), idle(saur()), act(mon("Espathra", "Opportunist"), "Stored Power", OL), idle(toise())),
    checks: "+6 already: the rise is 0, no copy; Stored Power 20.",
  },
  // ---- H4 neighbourhood: Mycelium Might on other breakable abilities.
  {
    id: "VE-H4-1", title: "Mycelium Might Toxic into Magic Bounce", game: "sv", outcomes: true,
    slots: slots(act(mon("Toedscruel", "Mycelium Might"), "Toxic", PL), idle(saur()), idle(mon("Hatterene", "Magic Bounce")), idle(toise())),
    checks: "Magic Bounce is ignored: Hatterene is badly poisoned.",
  },
  {
    id: "VE-H4-2", title: "Mycelium Might Spore into Overcoat Forretress", game: "sv",
    slots: slots(act(mon("Toedscruel", "Mycelium Might"), "Spore", PL), idle(saur()), idle(mon("Forretress", "Overcoat")), idle(toise())),
    checks: "Overcoat is ignored: Forretress falls asleep.",
  },
  {
    id: "VE-H4-3", title: "Mycelium Might Spore into a Vital Spirit Ability Shield holder", game: "sv",
    slots: slots(act(mon("Toedscruel", "Mycelium Might"), "Spore", PL), idle(saur()), idle(mon("Annihilape", "Vital Spirit", { item: "Ability Shield" })), idle(toise())),
    checks: "Ability Shield keeps Vital Spirit: not affected.",
  },
  {
    id: "VE-H4-4", title: "Mycelium Might Spore into Sweet Veil's ally", game: "sv",
    slots: slots(act(mon("Toedscruel", "Mycelium Might"), "Spore", PL), idle(saur()), idle(lax()), idle(mon("Ribombee", "Sweet Veil"))),
    checks: "Sweet Veil (ally, breakable) is ignored: Snorlax falls asleep.",
  },
  {
    id: "VE-H4-5", title: "Mycelium Might Spore into a Grass type (powder immunity is not an ability)", game: "sv",
    slots: slots(act(mon("Toedscruel", "Mycelium Might"), "Spore", PL), idle(lax()), idle(saur()), idle(toise())),
    checks: "Venusaur is immune to powder.",
  },
  // ---- H5 neighbourhood: Sparkling Aria.
  {
    id: "VE-H5-1", title: "Sparkling Aria: Storm Drain absorbs, the other target is a burned Shield Dust holder", game: "sv",
    slots: slots(act(mon("Primarina", "Torrent"), "Sparkling Aria"), empty(saur()), idle(mon("Vivillon", "Shield Dust", { status: "brn" })), idle(mon("Gastrodon", "Storm Drain"))),
    checks: "Only Vivillon is hit: one target, Shield Dust keeps the volatile off, the burn stays.",
  },
  {
    id: "VE-H5-2", title: "Sparkling Aria into a burned Covert Cloak holder beside another foe", game: "sv",
    slots: slots(act(mon("Primarina", "Torrent"), "Sparkling Aria"), empty(saur()), act(lax({ status: "brn", item: "Covert Cloak" }), "Body Slam", OL), idle(toise())),
    checks: "Two targets hit: the burn is cured though Covert Cloak stops the secondary.",
  },
  {
    id: "VE-H5-3", title: "Sparkling Aria into a burned Covert Cloak holder alone", game: "sv",
    slots: slots(act(mon("Primarina", "Torrent"), "Sparkling Aria"), empty(saur()), act(lax({ status: "brn", item: "Covert Cloak" }), "Body Slam", OL), empty(toise())),
    checks: "One target: Covert Cloak stops the secondary: the burn stays.",
  },
  {
    id: "VE-H5-4", title: "Sparkling Aria cures a burned ally", game: "sv",
    slots: slots(act(mon("Primarina", "Torrent"), "Sparkling Aria"), act(lax({ status: "brn" }), "Body Slam", PL), idle(chomp()), idle(toise())),
    checks: "The ally is hit (allAdjacent): its burn is cured before its Body Slam.",
  },
  {
    id: "VE-H5-5", title: "USUM: Sparkling Aria into a burned Pokémon behind a Substitute", game: "usum",
    slots: slots(act(mon("Primarina", "Torrent"), "Sparkling Aria"), empty(saur()), act(lax({ status: "brn", substitute: 58 }), "Body Slam", OL), idle(toise())),
    checks: "A sound move passes the Substitute: two targets, cured.",
  },
  {
    id: "VE-H5-6", notEstimated: "Sparkling Aria's burn cure after Primarina faints in the move is not modelled in 2v2.", title: "Sparkling Aria with Life Orb at low HP: the user faints from Life Orb", game: "sv",
    slots: slots(act(mon("Primarina", "Torrent", { item: "Life Orb", hp: 5 }), "Sparkling Aria"), empty(saur()), act(lax({ status: "brn" }), "Body Slam", OL), idle(toise())),
    checks: "Life Orb (AfterMoveSecondarySelf) knocks Primarina out before AfterMove: no cure?",
  },
  // ---- H6 neighbourhood: Champions Milk Drink.

  {
    id: "VE-H6-2", title: "Champions: Milk Drink aimed at an ally behind a Substitute", game: "champions",
    slots: slots(act(mon("Gogoat", "Sap Sipper", { hp: 100 }), "Milk Drink", OR), idle(lax({ hp: 100, substitute: 50 })), idle(mon("Dragapult", "Clear Body")), idle(toise())),
    checks: "Milk Drink has no bypasssub: the ally's Substitute blocks it.",
  },
  {
    id: "VE-H6-3", title: "Champions: Milk Drink aimed at an ally at full HP", game: "champions",
    slots: slots(act(mon("Gogoat", "Sap Sipper", { hp: 100 }), "Milk Drink", OR), idle(lax()), idle(mon("Dragapult", "Clear Body")), idle(toise())),
    checks: "Fails: the ally is at full HP.",
  },
  {
    id: "VE-H6-4", title: "Champions: Milk Drink aimed at itself after its ally fainted", game: "champions",
    slots: slots(act(mon("Gogoat", "Sap Sipper", { hp: 100 }), "Milk Drink", OL), idle(lax({ hp: 1 })), act(mon("Dragapult", "Clear Body"), "Dragon Pulse", OR), idle(toise())),
    checks: "Aimed at itself: heals itself.",
  },
  // ---- H7 neighbourhood: Ring Target.
  {
    id: "VE-H7-1", title: "Thunder Wave into a Ring Target Ground type under Magic Room", game: "sv", field: { magicRoom: true },
    slots: slots(act(jolt(), "Thunder Wave", PL), idle(saur()), act(chomp({ item: "Ring Target" }), "Dragon Claw", OL), idle(toise())),
    checks: "Magic Room: Ring Target does nothing; Garchomp is immune.",
  },
  {
    id: "VE-H7-2", title: "USUM: Normalize Thunder Wave into a Ghost type holding Ring Target", game: "usum",
    slots: slots(act(mon("Delcatty", "Normalize"), "Thunder Wave", PL), idle(saur()), act(mon("Gengar", "Cursed Body", { item: "Ring Target" }), "Shadow Ball", OL), idle(toise())),
    checks: "Normal-type Thunder Wave: the Ghost immunity is negated by Ring Target: paralysed.",
  },
  {
    id: "VE-H7-3", title: "USUM: Normalize Thunder Wave into a Ghost type", game: "usum",
    slots: slots(act(mon("Delcatty", "Normalize"), "Thunder Wave", PL), idle(saur()), act(mon("Gengar", "Cursed Body"), "Shadow Ball", OL), idle(toise())),
    checks: "Ghost is immune to the Normal-type Thunder Wave.",
  },
  {
    id: "VE-H7-4", title: "SwSh: Thunder Wave into a Ring Target Gastrodon", game: "swsh",
    slots: slots(act(jolt(), "Thunder Wave", PL), idle(saur()), act(mon("Gastrodon", "Sticky Hold", { item: "Ring Target" }), "Earth Power", OL), idle(toise())),
    checks: "Gastrodon (Water/Ground) holding Ring Target is paralysed.",
  },
  // ---- H8 neighbourhood: accuracy drops from damaging moves.
  {
    id: "VE-H8-1", title: "Sheer Force Mud-Slap into Defiant Kingambit", game: "sv",
    slots: slots(act(mon("Landorus", "Sheer Force"), "Mud-Slap", PL), idle(saur()), act(mon("Kingambit", "Defiant"), "Iron Head", OL), idle(toise())),
    checks: "Sheer Force removes the drop: no Defiant.",
  },
  {
    id: "VE-H8-2", title: "Mud-Slap into a Covert Cloak Defiant Kingambit", game: "sv",
    slots: slots(act(mon("Excadrill", "Sand Rush"), "Mud-Slap", PL), idle(saur()), act(mon("Kingambit", "Defiant", { item: "Covert Cloak" }), "Iron Head", OL), idle(toise())),
    checks: "Covert Cloak stops the drop: no Defiant.",
  },
  {
    id: "VE-H8-3", title: "SwSh: Mud-Slap into Defiant Bisharp", game: "swsh",
    slots: slots(act(mon("Excadrill", "Sand Rush"), "Mud-Slap", PL), idle(saur()), act(mon("Bisharp", "Defiant"), "Iron Head", OL), idle(toise())),
    checks: "SwSh Bisharp Defiant: +2 Attack.",
  },
  {
    id: "VE-H8-4", title: "USUM: Mud-Slap into Competitive Milotic", game: "usum",
    slots: slots(act(mon("Excadrill", "Sand Rush"), "Mud-Slap", PL), idle(saur()), act(mon("Milotic", "Competitive"), "Scald", OL), idle(toise())),
    checks: "Competitive +2 Sp. Atk for Scald.",
  },
  {
    id: "VE-H8-5", title: "Mud-Slap into a Disguise holder with White Herb", game: "sv", outcomes: true,
    slots: slots(act(mon("Excadrill", "Sand Rush"), "Mud-Slap", PL), idle(saur()), idle(mon("Mimikyu", "Disguise", { item: "White Herb" })), idle(toise())),
    checks: "The face takes the hit; the drop still lands; White Herb is used.",
  },
  {
    id: "VE-H8-7", title: "Mud-Slap into Clear Body with Eject Pack", game: "sv",
    slots: slots(act(mon("Excadrill", "Sand Rush"), "Mud-Slap", PL), idle(saur()), act(mon("Metagross", "Clear Body", { item: "Eject Pack" }), "Zen Headbutt", OL), idle(toise())),
    checks: "Clear Body stops the drop: no Eject Pack.",
  },
  {
    id: "VE-H8-8", title: "Mud-Slap into a Mirror Armor Corviknight (SwSh) whose drop goes to an Eject Pack user? user holds nothing", game: "swsh", field: { gravity: true },
    slots: slots(act(mon("Excadrill", "Sand Rush"), "Mud-Slap", PL), idle(saur()), act(mon("Corviknight", "Mirror Armor"), "Body Press", OL), idle(toise())),
    checks: "Mirror Armor sends −1 accuracy to Excadrill.",
  },
];

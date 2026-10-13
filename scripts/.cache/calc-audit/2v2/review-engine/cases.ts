// Engine review probes (same shape as verify/cases.ts). Showdown names; level 50, 31 IVs, Serious, 0 EVs unless set.
// `sdTarget: false` on a slot: Showdown gets no target (a Z-Move whose own target is a spread one), the app the case target.
import type { Case, CaseAction, CaseMon, SlotId } from "../verify/case-types";

type Slot = CaseMon & { action: CaseAction };
const mon = (species: string, ability: string, extra: Partial<CaseMon> = {}): CaseMon => ({ species, ability, ...extra });
const act = (m: CaseMon, move: string | null, target?: SlotId, context?: Record<string, unknown>): Slot =>
  ({ ...m, action: { move, ...(target ? { target } : {}), ...(context ? { context } : {}) } });
const idle = (m: CaseMon): Slot => act(m, null);
const slots = (ownLeft: Slot, ownRight: Slot, oppLeft: Slot, oppRight: Slot): Case["slots"] =>
  ({ "own-left": ownLeft, "own-right": ownRight, "opponent-left": oppLeft, "opponent-right": oppRight });

const chomp = mon("Garchomp", "Rough Skin", { nature: "Jolly", evs: { atk: 252, spe: 252 } });
const venusaur = mon("Venusaur", "Overgrow");
const blastoise = mon("Blastoise", "Torrent");
const zard0 = mon("Charizard", "Blaze");

export const REVIEW_CASES: (Case & { sdNoTarget?: SlotId[] })[] = [
  {
    id: "R01", title: "Figy Berry eaten mid-turn confuses a later attacker", game: "sv",
    slots: slots(
      act(chomp, "Dragon Claw", "opponent-left"), idle(venusaur),
      act(mon("Snorlax", "Thick Fat", { nature: "Modest", item: "Figy Berry", hp: 150 }), "Body Slam", "own-right"), idle(blastoise)),
    checks: "Dragon Claw leaves Snorlax at 35-53; Figy (1/3) and confusion (Modest dislikes Spicy); Body Slam then 33% self-hit.",
  },
  {
    id: "R02", title: "Protean changes the user's type before a later hit into it", game: "sv",
    slots: slots(
      act(mon("Greninja", "Protean", { nature: "Timid", evs: { spa: 252, spe: 252 } }), "Ice Beam", "opponent-right"), idle(venusaur),
      act(zard0, "Flamethrower", "own-left"), idle(blastoise)),
    checks: "Greninja becomes pure Ice with Ice Beam; Flamethrower into it is then 2x (Showdown) instead of 0.5x.",
  },
  {
    id: "R03", title: "Double Shock removes the user's Electric type before a later Ground hit", game: "sv",
    slots: slots(
      act(mon("Pawmot", "Natural Cure", { nature: "Jolly", evs: { atk: 252, spe: 252 } }), "Double Shock", "opponent-right"), idle(venusaur),
      act(mon("Garchomp", "Rough Skin"), "Earth Power", "own-left"), idle(blastoise)),
    checks: "Pawmot is ???/Fighting after Double Shock: Earth Power is neutral, not 2x.",
  },
  {
    id: "R04", title: "A move aimed at a fainted ally goes to a foe's Follow Me", game: "sv",
    slots: slots(
      act(mon("Snorlax", "Thick Fat"), "Body Slam", "own-right"), idle(mon("Venusaur", "Overgrow", { hp: 1 })),
      act(mon("Clefable", "Magic Guard"), "Follow Me"), act(chomp, "Dragon Claw", "own-right")),
    checks: "Garchomp KOs Venusaur; Snorlax's Body Slam at its fainted ally is redirected to Clefable (getMoveTargets RedirectTarget).",
  },
  {
    id: "R05", title: "Flower Gift raises its partner's Sp. Def in sun", game: "swsh", field: { weather: "Sun" },
    slots: slots(
      idle(mon("Cherrim", "Flower Gift")), idle(venusaur),
      act(mon("Charizard", "Blaze", { nature: "Timid", evs: { spa: 252, spe: 252 } }), "Air Slash", "own-right"), idle(blastoise)),
    checks: "Air Slash into Venusaur, Cherrim's partner, in sun: Flower Gift onAllyModifySpD 1.5x.",
  },
  {
    id: "R05u", title: "Flower Gift raises its partner's Sp. Def in sun (USUM)", game: "usum", field: { weather: "Sun" },
    slots: slots(
      idle(mon("Cherrim", "Flower Gift")), idle(venusaur),
      act(mon("Charizard", "Blaze", { nature: "Timid", evs: { spa: 252, spe: 252 } }), "Air Slash", "own-right"), idle(blastoise)),
    checks: "As R05 in generation 7.",
  },
  {
    id: "R06", title: "Clangorous Soulblaze hits both foes", game: "usum",
    slots: slots(
      act(mon("Kommo-o", "Bulletproof", { item: "Kommonium Z", nature: "Timid", evs: { spa: 252, spe: 252 }, choice: "zmove" }), "Clanging Scales", "opponent-left"), idle(venusaur),
      idle(blastoise), idle(zard0)),
    sdNoTarget: ["own-left"],
    checks: "The Z-Move's own target is allAdjacentFoes: both foes, spread 0.75.",
  },
  {
    id: "R07", title: "Burn Up removes the user's Fire type before a later Water hit", game: "swsh",
    slots: slots(
      act(mon("Arcanine", "Flash Fire", { nature: "Jolly", evs: { atk: 252, spe: 252 } }), "Burn Up", "opponent-right"), idle(venusaur),
      act(mon("Blastoise", "Torrent"), "Water Pulse", "own-left"), idle(mon("Snorlax", "Thick Fat"))),
    checks: "Arcanine is ??? after Burn Up: Water Pulse is neutral, not 2x.",
  },
  {
    id: "R08", title: "Unburden after a Sitrus Berry: the re-sort reads the doubled Speed", game: "sv",
    slots: slots(
      act(chomp, "Dragon Claw", "opponent-left"), act(mon("Charizard", "Blaze", { nature: "Timid", evs: { spa: 252, spe: 252 } }), "Air Slash", "opponent-left"),
      act(mon("Hawlucha", "Unburden", { item: "Sitrus Berry" }), "Close Combat", "own-right"), idle(mon("Snorlax", "Thick Fat"))),
    checks: "Hawlucha (138) eats Sitrus after Dragon Claw, Unburden 276 > Charizard 167: Close Combat before Air Slash.",
  },
  {
    id: "R09", title: "Fire Pledge and Grass Pledge from partners combine", game: "sv",
    slots: slots(
      act(mon("Charizard", "Blaze"), "Fire Pledge", "opponent-left"), act(venusaur, "Grass Pledge", "opponent-left"),
      idle(mon("Snorlax", "Thick Fat")), idle(blastoise)),
    checks: "Charizard waits; Venusaur's Grass Pledge becomes the 150-power Fire combination into Snorlax.",
  },
  {
    id: "R10", title: "Copycat used last copies the move before it", game: "sv",
    slots: slots(
      idle(chomp), act(mon("Clefable", "Magic Guard"), "Copycat"),
      idle(zard0), act(blastoise, "Water Pulse", "own-left")),
    checks: "Order Garchomp, Charizard, Blastoise, Clefable: Copycat uses Water Pulse at a random foe.",
  },
  {
    id: "R13", title: "Dragon Tail forces its target out before a second -6 move into that slot", game: "sv",
    slots: slots(
      act(chomp, "Dragon Tail", "opponent-left"), act(mon("Dragonite", "Inner Focus"), "Dragon Tail", "opponent-left"),
      idle(blastoise), idle(venusaur)),
    checks: "Garchomp's Dragon Tail drags in the bench Pokémon; Dragonite's Dragon Tail hits it, not Blastoise.",
  },
  {
    id: "R14", title: "Glaive Rush doubles the damage its user takes later in the turn", game: "sv",
    slots: slots(
      act(mon("Baxcalibur", "Thermal Exchange", { nature: "Jolly", evs: { atk: 252, spe: 252 } }), "Glaive Rush", "opponent-right"), idle(venusaur),
      act(zard0, "Air Slash", "own-left"), idle(blastoise)),
    checks: "Air Slash into Baxcalibur after its Glaive Rush: glaiverush onSourceModifyDamage 2x.",
  },
  {
    id: "R15", title: "Dynamic Punch confuses a target that moves later", game: "swsh",
    slots: slots(
      act(mon("Machamp", "No Guard", { nature: "Jolly", evs: { spe: 252 } }), "Dynamic Punch", "opponent-left"), idle(venusaur),
      act(blastoise, "Water Pulse", "own-right"), idle(mon("Snorlax", "Thick Fat"))),
    checks: "Blastoise is confused (100% secondary): Water Pulse 67%, a self-hit 33%.",
  },
  {
    id: "R16", title: "Z-Protect (a status Z-Move) blocks like Protect", game: "usum",
    slots: slots(
      act(mon("Snorlax", "Thick Fat", { item: "Normalium Z", choice: "zmove" }), "Protect"), idle(venusaur),
      act(chomp, "Dragon Claw", "own-left"), idle(blastoise)),
    checks: "Z-Protect protects (and resets lowered stats): Dragon Claw is blocked.",
  },
  {
    id: "R17", title: "Champions Speeds above 999 are not tied", game: "champions", field: { own: { tailwind: true }, opponent: { tailwind: true } },
    slots: slots(
      act(mon("Dragapult", "Clear Body", { nature: "Jolly", evs: { spe: 32 }, hp: 1, boosts: { spe: 6 } }), "Dragon Claw", "opponent-left"), idle(mon("Venusaur", "Overgrow")),
      act(mon("Garchomp", "Sand Veil", { nature: "Jolly", evs: { spe: 32 }, hp: 1, boosts: { spe: 6 } }), "Dragon Claw", "own-left"), idle(mon("Blastoise", "Torrent"))),
    checks: "Dragapult and Garchomp at +6 under Tailwind are both above 999: Dragapult is faster and moves first (no 999 cap in Showdown).",
  },
];

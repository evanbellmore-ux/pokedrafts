// forms-iceface-fling fix: 2v2 oracle cases. FI01-FI09: the hit an intact Ice Face or Disguise takes is calculated at a neutral
// type effectiveness (pinned Showdown c23d2e94 data/abilities.ts iceface / disguise onEffectiveness return 0 for each type the
// move does not miss; onDamage then gives the hit 0), which the turn shows as that hit's damage. IF01-IF08: the held-item forms
// Showdown's validator gives a base-species set (data/items.ts forcedForme): the form's types, stats and ability. Level 50,
// 31 IVs, Serious, 0 EVs unless set. Speeds (0 EVs: base + 20): Blissey 75, Conkeldurr 65, Eiscue 70 (Noice 150), Venusaur 100
// (101 with 4 EVs), Snorlax 50 (51), Tyranitar 81, Lucario 110, Metagross 90, Mimikyu 116, Weavile 145, Yanmega 115,
// Giratina-Origin 110, Garchomp 122, Dialga-Origin 110, Palkia-Origin 140, Ogerpon 130, Blastoise 98, Genesect 119, Gengar 130.
import type { Case, CaseAction, CaseMon, SlotId } from "../../2v2/verify/case-types";

type Slot = CaseMon & { action: CaseAction };
const mon = (species: string, ability: string, extra: Partial<CaseMon> = {}): CaseMon => ({ species, ability, ...extra });
const act = (m: CaseMon, move: string | null, target?: SlotId): Slot => ({ ...m, action: { move, ...(target ? { target } : {}) } });
const idle = (m: CaseMon): Slot => act(m, null);
const S = (a: Slot, b: Slot, c: Slot, d: Slot): Case["slots"] => ({ "own-left": a, "own-right": b, "opponent-left": c, "opponent-right": d });
const venusaur = mon("Venusaur", "Overgrow", { evs: { spe: 4 } });
const snorlax = mon("Snorlax", "Thick Fat", { evs: { spe: 4 } });
const eiscue = mon("Eiscue", "Ice Face");
const mimikyu = mon("Mimikyu", "Disguise");

export const FIF_CASES: Case[] = [
  // Ice Face (generation 8 and 9).
  {
    id: "FI01", title: "Ice Face takes Serene Grace Rock Smash (neutral: 5-6), the drop still lands for Hammer Arm (SwSh; was SA13)", game: "swsh",
    slots: S(act(mon("Blissey", "Serene Grace"), "Rock Smash", "opponent-left"), act(mon("Conkeldurr", "Guts"), "Hammer Arm", "opponent-left"), idle(eiscue), idle(venusaur)),
    checks: "Rock Smash (2x into Ice) is calculated neutral: 5-6, not 10-14; Eiscue becomes Noice at -1 Defense for Hammer Arm.",
  },
  {
    id: "FI02", title: "Rock Slide into an intact Eiscue and Snorlax: the face's hit neutral at the spread modifier (SwSh)", game: "swsh",
    slots: S(act(mon("Tyranitar", "Unnerve"), "Rock Slide"), idle(venusaur), idle(eiscue), idle(snorlax)),
    checks: "Rock (2x into Ice) neutral, 0.75 spread, STAB; Snorlax takes its ordinary spread hit.",
  },
  {
    id: "FI03", title: "Expert Belt Lucario's Close Combat into an intact Eiscue: neutral, so no Expert Belt (SwSh)", game: "swsh",
    slots: S(act(mon("Lucario", "Inner Focus", { item: "Expert Belt" }), "Close Combat", "opponent-left"), idle(venusaur), idle(eiscue), idle(snorlax)),
    checks: "Expert Belt reads the hit's typeMod (0): no boost.",
  },
  {
    id: "FI04", title: "Close Combat into an intact Eiscue in Snow: neutral, with the Ice type's 1.5x Defense (SV)", game: "sv",
    field: { weather: "Snow" },
    slots: S(act(mon("Lucario", "Inner Focus"), "Close Combat", "opponent-left"), idle(venusaur), idle(eiscue), idle(snorlax)),
    checks: "Snow's Defense boost reads Eiscue's Ice type; the effectiveness is neutral.",
  },
  {
    id: "FI05", title: "Ice Shard into an intact Eiscue: resisted made neutral (SV)", game: "sv",
    slots: S(act(mon("Weavile", "Pressure"), "Ice Shard", "opponent-left"), idle(venusaur), idle(eiscue), idle(snorlax)),
    checks: "Ice (0.5x into Ice) is neutral for the face's hit.",
  },
  // Disguise (Champions, generation 7 and 9).
  {
    id: "FI06", title: "Iron Head into an intact Mimikyu: neutral, then the busted form's 1/8 (Champions)", game: "champions",
    slots: S(act(mon("Metagross", "Clear Body"), "Iron Head", "opponent-left"), idle(venusaur), idle(mimikyu), idle(snorlax)),
    checks: "Steel (2x into Fairy) neutral; Disguise's 1/8 of its maximum HP once busted.",
  },
  {
    id: "FI07", title: "Shadow Ball into an intact Mimikyu: super effective made neutral, no chip in generation 7 (USUM)", game: "usum",
    slots: S(act(mon("Gengar", "Cursed Body"), "Shadow Ball", "opponent-left"), idle(venusaur), idle(mimikyu), idle(snorlax)),
    checks: "Ghost (2x into Ghost) neutral; data/mods/gen7/abilities.ts disguise: no 1/8 damage.",
  },
  {
    id: "FI08", title: "Tinted Lens Bug Buzz into an intact Mimikyu: 0.25x made neutral, so no Tinted Lens (SV)", game: "sv",
    slots: S(act(mon("Yanmega", "Tinted Lens"), "Bug Buzz", "opponent-left"), idle(venusaur), idle(mimikyu), idle(snorlax)),
    checks: "Bug (0.25x into Ghost/Fairy) neutral; Tinted Lens reads the hit's typeMod (0): no doubling.",
  },
  {
    id: "FI09", title: "Control: a neutral Body Slam into an intact Eiscue is unchanged (SwSh)", game: "swsh",
    slots: S(act(mon("Snorlax", "Thick Fat"), "Body Slam", "opponent-left"), idle(venusaur), idle(eiscue), idle(snorlax)),
    checks: "Normal into Ice is already neutral.",
  },
  {
    id: "FI10", title: "Max Knuckle into an intact Eiscue: neutral, and the Max Move still raises its side's Attack (SwSh)", game: "swsh",
    slots: S(act(mon("Conkeldurr", "Guts", { choice: "dynamax" }), "Close Combat", "opponent-left"), act(mon("Snorlax", "Thick Fat"), "Body Slam", "opponent-left"), idle(eiscue), idle(venusaur)),
    checks: "Fighting (2x into Ice) neutral for the face's hit; Snorlax's Body Slam into Eiscue-Noice with +1 Attack.",
  },
  {
    id: "FI11", title: "Close Combat into a Dynamaxed intact Eiscue: neutral (SwSh)", game: "swsh",
    slots: S(act(mon("Lucario", "Inner Focus"), "Close Combat", "opponent-left"), idle(venusaur), act(mon("Eiscue", "Ice Face", { choice: "dynamax" }), "Headbutt", "own-right"), idle(snorlax)),
    checks: "Lucario (110) before Eiscue (90): the face's hit at its doubled HP; Eiscue-Noice's Max Strike then hits Venusaur. Before this fix a Dynamaxed face kept the busted form's 2x figure.",
  },
  // The held-item forms.
  {
    id: "IF01", title: "Giratina-Origin holding a Griseous Core: Shadow Ball 1.2x with STAB into Garchomp; Dragon Claw 2x into it (SV)", game: "sv",
    slots: S(act(mon("Giratina-Origin", "Levitate", { item: "Griseous Core" }), "Shadow Ball", "opponent-right"), idle(venusaur), idle(snorlax), act(mon("Garchomp", "Rough Skin"), "Dragon Claw", "own-left")),
    checks: "Giratina-Origin's 120 Sp. Atk and 100 Sp. Def; Garchomp (122) moves first.",
  },
  {
    id: "IF02", title: "Giratina-Origin holding a Griseous Orb: Dragon Claw, and Levitate takes no Earthquake (SwSh)", game: "swsh",
    slots: S(act(mon("Giratina-Origin", "Levitate", { item: "Griseous Orb" }), "Dragon Claw", "opponent-left"), idle(venusaur), idle(snorlax), act(mon("Garchomp", "Rough Skin"), "Earthquake")),
    checks: "Origin Attack 120 with the Orb's 1.2x; Earthquake misses the Levitate Giratina, hits Venusaur and Snorlax.",
  },
  {
    id: "IF03", title: "Dialga-Origin holding an Adamant Crystal: Flash Cannon 1.2x with STAB into Snorlax (SV)", game: "sv",
    slots: S(act(mon("Dialga-Origin", "Pressure", { item: "Adamant Crystal" }), "Flash Cannon", "opponent-left"), idle(venusaur), idle(snorlax), act(mon("Garchomp", "Rough Skin"), "Dragon Claw", "own-left")),
    checks: "Dialga-Origin's 150 Sp. Atk, 100 Defense for Dragon Claw (2x).",
  },
  {
    id: "IF04", title: "Palkia-Origin holding a Lustrous Globe: Hydro Pump 1.2x with STAB into Snorlax (SV)", game: "sv",
    slots: S(act(mon("Palkia-Origin", "Pressure", { item: "Lustrous Globe" }), "Hydro Pump", "opponent-left"), idle(venusaur), idle(snorlax), act(mon("Garchomp", "Rough Skin"), "Dragon Claw", "own-left")),
    checks: "Palkia-Origin's 120 Speed moves before Garchomp; Dragon Claw 2x into its 100 Defense.",
  },
  {
    id: "IF05", title: "Ogerpon-Wellspring holding its mask: Water Ivy Cudgel 1.2x; Flamethrower neutral into its Grass/Water (SV)", game: "sv",
    slots: S(act(mon("Ogerpon-Wellspring", "Water Absorb", { item: "Wellspring Mask" }), "Ivy Cudgel", "opponent-left"), idle(venusaur), idle(snorlax), act(mon("Charizard", "Blaze"), "Flamethrower", "own-left")),
    checks: "data/moves.ts ivycudgel onModifyType by the form; Ogerpon (130) moves before Charizard (120).",
  },
  {
    id: "IF06", title: "Ogerpon-Hearthflame holding its mask: Fire Ivy Cudgel into Venusaur (SV)", game: "sv",
    slots: S(act(mon("Ogerpon-Hearthflame", "Mold Breaker", { item: "Hearthflame Mask" }), "Ivy Cudgel", "opponent-left"), idle(snorlax), idle(venusaur), idle(mon("Blastoise", "Torrent"))),
    checks: "Fire Ivy Cudgel 2x into Venusaur with the mask's 1.2x.",
  },
  {
    id: "IF07", title: "Genesect-Douse holding a Douse Drive: Water Techno Blast into Snorlax, Water Pulse into it (SwSh)", game: "swsh",
    slots: S(act(mon("Genesect-Douse", "Download", { item: "Douse Drive", boosts: { atk: 1 } }), "Techno Blast", "opponent-left"), idle(venusaur), idle(snorlax), act(mon("Blastoise", "Torrent"), "Water Pulse", "own-left")),
    checks: "data/moves.ts technoblast onModifyType: the Drive's type (Water, no STAB); Water Pulse neutral into Genesect's Bug/Steel. Download's +1 Attack at the start (the foes' Defense total is lower).",
  },
  {
    id: "IF08", title: "Genesect-Shock holding a Shock Drive: Electric Techno Blast into Blastoise (USUM)", game: "usum",
    slots: S(act(mon("Genesect-Shock", "Download", { item: "Shock Drive", boosts: { atk: 1 } }), "Techno Blast", "opponent-left"), idle(venusaur), idle(mon("Blastoise", "Torrent")), idle(snorlax)),
    checks: "Electric Techno Blast 2x into Blastoise; Download's +1 Attack at the start (the foes' Defense total is lower).",
  },
];

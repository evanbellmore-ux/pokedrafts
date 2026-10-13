// forms-iceface-fling VERIFY (independent): 2v2 cases for the hit an intact Ice Face / Disguise takes and for the held-item forms,
// run through the pinned Showdown oracle (2v2/verify/sim-dfs.ts) and the app (2v2/verify/app-turn.ts) by run-2v2-v.ts.
// Pinned Showdown c23d2e94 data/abilities.ts iceface / disguise: onEffectiveness returns 0 for each type the move does not
// miss (runImmunity), onCriticalHit returns false (the hit cannot be critical, even willCrit or a +3 stage), onDamage returns 0.
// Level 50, 31 IVs, Serious, 0 EVs unless set. Speeds at 0 EVs are base + 20.
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

export const V_CASES: Case[] = [
  // Critical hits: the face's onCriticalHit gives false, so the hit it takes is never critical.
  { id: "VF01", title: "Critical hit field on: Close Combat into an intact Eiscue is neutral and not critical (SV)", game: "sv", field: { critical: true },
    slots: S(act(mon("Lucario", "Inner Focus"), "Close Combat", "opponent-left"), idle(venusaur), idle(eiscue), idle(snorlax)), checks: "no crit on the face hit" },
  { id: "VF02", title: "Flower Trick (always critical) into an intact Eiscue: not critical (SV)", game: "sv",
    slots: S(act(mon("Meowscarada", "Overgrow"), "Flower Trick", "opponent-left"), idle(venusaur), idle(eiscue), idle(snorlax)), checks: "willCrit blocked" },
  { id: "VF03", title: "Wicked Blow (always critical) into an intact Mimikyu: not critical (SwSh)", game: "swsh",
    slots: S(act(mon("Urshifu", "Unseen Fist"), "Wicked Blow", "opponent-left"), idle(venusaur), idle(mimikyu), idle(snorlax)), checks: "willCrit blocked" },
  { id: "VF04", title: "Super Luck + Scope Lens Night Slash (+3, certain) into an intact Mimikyu: neutral, not critical (SV)", game: "sv", field: {},
    slots: S(act(mon("Honchkrow", "Super Luck", { item: "Scope Lens" }), "Night Slash", "opponent-left"), idle(venusaur), idle(mimikyu), idle(snorlax)), checks: "certain ratio blocked" },
  { id: "VF05", title: "Critical hit field on: Shadow Ball into an intact Mimikyu (USUM, no chip)", game: "usum", field: { critical: true },
    slots: S(act(mon("Gengar", "Cursed Body"), "Shadow Ball", "opponent-left"), idle(venusaur), idle(mimikyu), idle(snorlax)), checks: "gen 7 crit blocked" },
  { id: "VF06", title: "Critical hit field on: Rock Slide into an intact Eiscue and Snorlax: the face's hit is not critical, Snorlax's is (SwSh)", game: "swsh", field: { critical: true },
    slots: S(act(mon("Tyranitar", "Unnerve"), "Rock Slide"), idle(venusaur), idle(eiscue), idle(snorlax)), checks: "spread + crit" },
  // A Chilan Berry halves a Normal hit and is eaten inside getDamage (onSourceModifyDamage), before onDamage gives 0.
  { id: "VF07", title: "Chilan Berry Eiscue: Tauros's Body Slam into the face eats it, then Snorlax's Body Slam into Eiscue-Noice (SV)", game: "sv",
    slots: S(act(mon("Tauros", "Anger Point"), "Body Slam", "opponent-left"), act(mon("Snorlax", "Thick Fat"), "Body Slam", "opponent-left"), idle(mon("Eiscue", "Ice Face", { item: "Chilan Berry" })), idle(venusaur)),
    checks: "Chilan eaten on the face hit" },
  { id: "VF08", title: "Chilan Berry Mimikyu: Hyper Voice (spread, special) into the disguise eats it (SV)", game: "sv",
    slots: S(act(mon("Sylveon", "Pixilate"), "Hyper Voice"), act(mon("Snorlax", "Thick Fat"), "Body Slam", "opponent-left"), idle(mon("Mimikyu", "Disguise", { item: "Chilan Berry" })), idle(venusaur)),
    checks: "Pixilate makes Hyper Voice Fairy, so Chilan does not act; Body Slam then into Mimikyu-Busted" },
  // Tera types: the face makes each of the Tera type's matchups neutral, unless immune.
  { id: "VF09", title: "Tera Fire Eiscue takes Rock Slide: neutral; Snorlax takes its spread hit (SV)", game: "sv",
    slots: S(act(mon("Tyranitar", "Unnerve"), "Rock Slide"), idle(venusaur), idle(mon("Eiscue", "Ice Face", { teraType: "Fire", choice: "terastallize" })), idle(snorlax)), checks: "tera neutral" },
  { id: "VF10", title: "Tera Ghost Eiscue: Crunch (2x) is neutral, then Snorlax's Body Slam does not affect Eiscue-Noice (SV)", game: "sv",
    slots: S(act(mon("Tyranitar", "Unnerve"), "Crunch", "opponent-left"), act(mon("Snorlax", "Thick Fat"), "Body Slam", "opponent-left"), idle(mon("Eiscue", "Ice Face", { teraType: "Ghost", choice: "terastallize" })), idle(venusaur)), checks: "tera immunity kept" },
  // Max Moves and Z-Moves.
  { id: "VF11", title: "Dynamax Conkeldurr's Max Knuckle into an intact Eiscue: neutral; +1 Attack for Snorlax's Body Slam into Eiscue-Noice (SwSh)", game: "swsh",
    slots: S(act(mon("Conkeldurr", "Guts", { choice: "dynamax" }), "Close Combat", "opponent-left"), act(mon("Snorlax", "Thick Fat"), "Body Slam", "opponent-left"), idle(eiscue), idle(venusaur)), checks: "Max Move face hit" },
  { id: "VF12", title: "Never-Ending Nightmare (Ghostium Z) into an intact Mimikyu: neutral (USUM)", game: "usum",
    slots: S(act(mon("Gengar", "Cursed Body", { item: "Ghostium Z", choice: "zmove" }), "Shadow Ball", "opponent-left"), idle(venusaur), idle(mimikyu), idle(snorlax)), checks: "Z-Move face hit" },
  // Mold Breaker, Scrappy, Collision Course, multi-hit, two faces.
  { id: "VF13", title: "Mold Breaker Excadrill's Iron Head breaks through an intact Disguise: full 2x damage (SV)", game: "sv",
    slots: S(act(mon("Excadrill", "Mold Breaker"), "Iron Head", "opponent-left"), idle(venusaur), idle(mimikyu), idle(snorlax)), checks: "Mold Breaker ignores Disguise" },
  { id: "VF14", title: "Collision Course into an intact Eiscue: no super-effective boost, neutral (SV)", game: "sv", field: { weather: "Sun" },
    slots: S(act(mon("Koraidon", "Orichalcum Pulse"), "Collision Course", "opponent-left"), idle(venusaur), idle(eiscue), idle(snorlax)), checks: "runEffectiveness 0" },
  { id: "VF15", title: "Rock Slide into an intact Eiscue and an intact Mimikyu (SV)", game: "sv",
    slots: S(act(mon("Tyranitar", "Unnerve"), "Rock Slide"), idle(venusaur), idle(eiscue), idle(mimikyu)), checks: "two faces in one spread hit" },
  { id: "VF16", title: "Bullet Seed into an intact Mimikyu: not modelled", game: "sv", notEstimated: "Disguise against a multi-hit move is not modelled in 2v2.",
    slots: S(act(mon("Breloom", "Technician"), "Bullet Seed", "opponent-left"), idle(venusaur), idle(mimikyu), idle(snorlax)), checks: "reason" },
  { id: "VF17", title: "Life Orb Gengar's Shadow Ball into an intact Mimikyu: neutral with Life Orb, then its recoil (SwSh)", game: "swsh",
    slots: S(act(mon("Gengar", "Cursed Body", { item: "Life Orb" }), "Shadow Ball", "opponent-left"), idle(venusaur), idle(mimikyu), idle(snorlax)), checks: "Life Orb on face hit" },
  { id: "VF18", title: "Critical hit field on, Snow: Icicle Crash into an intact Eiscue: resisted made neutral, Snow's Defense, no crit (SV)", game: "sv", field: { critical: true, weather: "Snow" },
    slots: S(act(mon("Weavile", "Pressure"), "Icicle Crash", "opponent-left"), idle(venusaur), idle(eiscue), idle(snorlax)), checks: "snow + crit" },
  { id: "VF19", title: "Chilan Berry Eiscue and an Unnerve attacker: the berry is not eaten, so the face hit is not halved (SV)", game: "sv",
    slots: S(act(mon("Tyranitar", "Unnerve"), "Body Slam", "opponent-left"), idle(mon("Snorlax", "Thick Fat")), idle(mon("Eiscue", "Ice Face", { item: "Chilan Berry" })), idle(venusaur)),
    checks: "Unnerve stops eatItem" },
  { id: "VF20", title: "Scrappy Kangaskhan's Body Slam into a Chilan Berry Mimikyu: neutral, halved, eaten; Tauros's Body Slam into Mimikyu-Busted is immune (USUM)", game: "usum",
    slots: S(act(mon("Kangaskhan", "Scrappy"), "Body Slam", "opponent-left"), act(mon("Snorlax", "Thick Fat"), "Body Slam", "opponent-left"), idle(mon("Mimikyu", "Disguise", { item: "Chilan Berry" })), idle(venusaur)),
    checks: "Scrappy + Chilan" },
  { id: "VF21", title: "Merciless Toxapex's Liquidation into a poisoned intact Mimikyu: not critical (SV)", game: "sv",
    slots: S(act(mon("Toxapex", "Merciless"), "Liquidation", "opponent-left"), idle(venusaur), idle(mon("Mimikyu", "Disguise", { status: "psn" })), idle(snorlax)), checks: "Merciless blocked" },
  { id: "VF22", title: "Critical hit field on: Neutralizing Gas Weezing's Sludge Bomb into an intact Mimikyu: the face still acts, not critical (SV)", game: "sv", field: { critical: true },
    slots: S(act(mon("Weezing-Galar", "Neutralizing Gas"), "Sludge Bomb", "opponent-left"), idle(venusaur), idle(mimikyu), idle(snorlax)), checks: "gas + crit" },
  { id: "VF23", title: "Occa Berry Eiscue: Fire Punch into the face (neutral, berry kept), then Fire Punch into Eiscue-Noice (super effective, berry eaten) (SV)", game: "sv",
    slots: S(act(mon("Annihilape", "Defiant"), "Fire Punch", "opponent-left"), act(mon("Snorlax", "Thick Fat"), "Fire Punch", "opponent-left"), idle(mon("Eiscue", "Ice Face", { item: "Occa Berry" })), idle(venusaur)),
    checks: "resist berry kept on the face hit" },
  // Crush Grip and Hard Press in the 2v2 turn, after a partner's hit spreads the target's HP (uses-to-ko.ts hpCode: one
  // calculation per power).
  { id: "VH01", title: "Rock Slide, then Regigigas's Crush Grip into Snorlax at every HP the slide leaves (SV)", game: "sv",
    slots: S(act(mon("Tyranitar", "Unnerve"), "Rock Slide"), act(mon("Regigigas", "Slow Start"), "Crush Grip", "opponent-left"), idle(snorlax), idle(venusaur)), checks: "HP-read power per HP" },
  { id: "VH02", title: "Earthquake, then Metagross's Hard Press into Snorlax (Champions)", game: "champions",
    slots: S(act(mon("Garchomp", "Rough Skin"), "Earthquake"), act(mon("Metagross", "Clear Body"), "Hard Press", "opponent-left"), idle(snorlax), idle(venusaur)), checks: "Hard Press after spread" },
  { id: "VH03", title: "Body Slam, then Crush Grip into a Sitrus Berry Snorlax (SV)", game: "sv",
    slots: S(act(mon("Tauros", "Anger Point"), "Body Slam", "opponent-left"), act(mon("Regigigas", "Slow Start"), "Crush Grip", "opponent-left"), idle(mon("Snorlax", "Thick Fat", { item: "Sitrus Berry", evs: { spe: 4 } })), idle(venusaur)),
    checks: "the Berry between the hits" },
  // Held-item forms in 2v2 (the form selected with its item): types, stats and ability.
  { id: "VI08", title: "Control: Surf into Water Absorb Vaporeon (harness kind for an absorbing ability) (SV)", game: "sv",
    slots: S(act(mon("Blastoise", "Torrent"), "Surf"), idle(venusaur), idle(mon("Vaporeon", "Water Absorb")), idle(snorlax)), checks: "blocked vs no-damage convention" },
  { id: "VI01", title: "Giratina-Origin (Griseous Core, Levitate) takes Earthquake: immune; Shadow Force is not used (SV)", game: "sv",
    slots: S(act(mon("Garchomp", "Rough Skin"), "Earthquake"), idle(venusaur), idle(mon("Giratina-Origin", "Levitate", { item: "Griseous Core" })), idle(snorlax)), checks: "Levitate" },
  { id: "VI02", title: "Giratina-Origin's Dragon Pulse with the Griseous Orb (SwSh)", game: "swsh",
    slots: S(act(mon("Giratina-Origin", "Levitate", { item: "Griseous Orb" }), "Dragon Pulse", "opponent-left"), idle(venusaur), idle(mon("Garchomp", "Rough Skin")), idle(snorlax)), checks: "Griseous Orb 1.2x" },
  { id: "VI03", title: "Dialga-Origin's Roar of Time and Palkia-Origin's Spacial Rend (SV)", game: "sv",
    slots: S(act(mon("Dialga-Origin", "Pressure", { item: "Adamant Crystal" }), "Flash Cannon", "opponent-left"), act(mon("Palkia-Origin", "Pressure", { item: "Lustrous Globe" }), "Spacial Rend", "opponent-left"), idle(mon("Garchomp", "Rough Skin")), idle(snorlax)), checks: "crystal and globe" },
  { id: "VI04", title: "Ogerpon-Hearthflame's Ivy Cudgel (Fire) into Venusaur and Ogerpon-Wellspring taking Surf (Water Absorb) (SV)", game: "sv",
    slots: S(act(mon("Ogerpon-Hearthflame", "Mold Breaker", { item: "Hearthflame Mask" }), "Ivy Cudgel", "opponent-left"), act(mon("Blastoise", "Torrent"), "Surf"), idle(mon("Venusaur", "Overgrow")), idle(mon("Ogerpon-Wellspring", "Water Absorb", { item: "Wellspring Mask" }))), checks: "masks" },
  { id: "VI05", title: "Ogerpon-Cornerstone (Sturdy) at full HP takes a Flare Blitz that would knock it out (SV)", game: "sv",
    slots: S(act(mon("Cinderace", "Blaze", { evs: { atk: 252 }, nature: "Adamant", item: "Choice Band" }), "Flare Blitz", "opponent-left"), idle(venusaur), idle(mon("Ogerpon-Cornerstone", "Sturdy", { item: "Cornerstone Mask" })), idle(snorlax)), checks: "Sturdy" },
  { id: "VI06", title: "Genesect-Burn's Techno Blast (Fire) into Venusaur, Genesect-Douse's into Blissey (SwSh; Download raises Attack)", game: "swsh",
    slots: S(act(mon("Genesect-Burn", "Download", { item: "Burn Drive", boosts: { atk: 1 } }), "Techno Blast", "opponent-left"), act(mon("Genesect-Douse", "Download", { item: "Douse Drive", boosts: { atk: 1 } }), "Techno Blast", "opponent-right"), idle(mon("Venusaur", "Overgrow")), idle(mon("Blissey", "Natural Cure"))), checks: "drives" },
  { id: "VI07", title: "Genesect-Chill (Bug/Steel) takes Fire Blast (USUM)", game: "usum",
    slots: S(act(mon("Arcanine", "Flash Fire"), "Flamethrower", "opponent-left"), idle(venusaur), idle(mon("Genesect-Chill", "Download", { item: "Chill Drive", boosts: { atk: 1 } })), idle(snorlax)), checks: "Genesect types stay" },
];

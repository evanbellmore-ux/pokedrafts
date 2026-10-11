// Track A's extra status-move probes (beyond Track D's S cases), in the 2v2 verify Case form: run in pinned Showdown by
// sim-dfs.ts's oracle() and against the app by track-a-compare-s.ts --extra.
import type { Case, CaseAction, CaseMon, SlotId } from "../../2v2/verify/case-types";
import { chomp, clef, gengar, jolt, lax, saur, sm, toise, zard } from "../../2v2/verify/cases-s";

type Slot = CaseMon & { action: CaseAction };
const mon = (species: string, ability: string, extra: Partial<CaseMon> = {}): CaseMon => ({ species, ability, ...extra });
const act = (m: CaseMon, move: string | null, target?: SlotId): Slot => ({ ...m, action: { move, ...(target ? { target } : {}) } });
const idle = (m: CaseMon): Slot => act(m, null);
const empty = (m: CaseMon): Slot => ({ ...m, absent: true, action: { move: null } });
const slots = (ownLeft: Slot, ownRight: Slot, oppLeft: Slot, oppRight: Slot): Case["slots"] =>
  ({ "own-left": ownLeft, "own-right": ownRight, "opponent-left": oppLeft, "opponent-right": oppRight });
const OL: SlotId = "own-left", PL: SlotId = "opponent-left";
const kingambit = (extra: Partial<CaseMon> = {}) => mon("Kingambit", "Defiant", extra);

export const TRACK_A_CASES: Case[] = [
  {
    id: "TA01", title: "Tickle into Defiant (two stats lowered: +2 twice)", game: "sv",
    slots: slots(act(clef(), "Tickle", PL), idle(lax()), idle(kingambit()), idle(toise())),
    checks: "Defiant onAfterEachBoost: Atk −1 then +2, Def −1 then +2: Attack +3.",
  },
  {
    id: "TA02", title: "Parting Shot into Defiant, no Pokémon to switch in", game: "sv", field: { trickRoom: true }, canSwitch: { own: false, opponent: false },
    slots: slots(act(mon("Incineroar", "Blaze"), "Parting Shot", PL), empty(lax()), idle(kingambit()), empty(toise())),
    checks: "Atk −1 and Sp. Atk −1 from a foe: Defiant +2 twice; no bench, so no switch.",
  },
  {
    id: "TA03", title: "Mold Breaker Thunder Wave into Limber", game: "sv",
    slots: slots(act(mon("Tinkaton", "Mold Breaker"), "Thunder Wave", PL), idle(lax()), idle(mon("Hawlucha", "Limber")), idle(toise())),
    checks: "Mold Breaker passes Limber's onSetStatus; Limber's onUpdate cures it at the action's final Update (the active move cleared).",
  },
  {
    id: "TA04", title: "Parting Shot into Magic Bounce, no Pokémon to switch in", game: "sv", field: { trickRoom: true }, canSwitch: { own: false, opponent: false },
    slots: slots(act(mon("Incineroar", "Blaze"), "Parting Shot", PL), empty(lax()), idle(mon("Hatterene", "Magic Bounce")), empty(toise())),
    checks: "Hatterene uses Parting Shot back at Incineroar: its Atk −1 and Sp. Atk −1.",
  },
  {
    id: "TA05", title: "Teeter Dance into the ally's Wide Guard", game: "sv",
    slots: slots(act(mon("Bellossom", "Chlorophyll"), "Teeter Dance"), act(mon("Araquanid", "Water Bubble"), "Wide Guard"), idle(chomp()), idle(toise())),
    checks: "Wide Guard on its side blocks the spread move into the ally; both foes confused.",
  },
  {
    id: "TA06", title: "Scary Face into Mirror Armor: the drop goes back to a Defiant user", game: "sv",
    slots: slots(act(kingambit(), "Scary Face", PL), idle(lax()), idle(mon("Corviknight", "Mirror Armor")), idle(toise())),
    checks: "Speed −2 goes back onto Kingambit (from a foe): Defiant +2 Attack.",
  },
  {
    id: "TA07", title: "Thunder Wave into Synchronize, the user holding a Lum Berry", game: "sv",
    slots: slots(act(clef({ item: "Lum Berry" }), "Thunder Wave", PL), idle(lax()), idle(mon("Espeon", "Synchronize")), idle(toise())),
    checks: "Synchronize paralyses Clefable too; its Lum Berry cures it.",
  },
  {
    id: "TA08", title: "Rest on Electric Terrain", game: "sv", field: { terrain: "Electric" },
    slots: slots(act(lax({ hp: 100 }), "Rest"), idle(toise()), idle(chomp()), idle(clef())),
    checks: "Electric Terrain's onSetStatus stops a grounded Pokémon's sleep: Rest fails, no heal.",
  },
  {
    id: "TA09", title: "Whirlwind into Wind Rider", game: "sv",
    slots: slots(act(mon("Braviary", "Keen Eye"), "Whirlwind", PL), idle(lax()), idle(mon("Brambleghast", "Wind Rider")), idle(toise())),
    checks: "Wind Rider absorbs the wind move: +1 Attack, no switch.",
  },
  {
    id: "TA10", title: "Roar into Suction Cups", game: "sv",
    slots: slots(act(mon("Arcanine", "Flash Fire"), "Roar", PL), idle(lax()), idle(mon("Malamar", "Suction Cups")), idle(toise())),
    checks: "Suction Cups keeps Malamar in.",
  },
  {
    id: "TA11", title: "Roar drags the target out as the last action", game: "sv", endNotEstimated: "Snorlax switches out: the replacement is not known.",
    slots: slots(act(mon("Arcanine", "Flash Fire"), "Roar", PL), idle(toise()), idle(lax()), idle(clef())),
    checks: "Roar (−6) is last: Snorlax is dragged out; the moves are estimated.",
  },
  {
    id: "TA12", title: "Chilly Reception as the last action", game: "sv", endNotEstimated: "Slowking-Galar switches out: the replacement is not known.",
    slots: slots(act(mon("Slowking-Galar", "Regenerator"), "Chilly Reception"), idle(toise()), idle(lax()), idle(clef())),
    checks: "Slowking (50) is slowest: snow starts, then it switches out.",
  },
  {
    id: "TA13", title: "Shed Tail as the last action (Trick Room)", game: "sv", field: { trickRoom: true }, endNotEstimated: "Smeargle switches out: the replacement is not known.",
    slots: slots(act(sm(252, { nature: "Jolly" }), "Shed Tail"), idle(lax()), idle(toise()), idle(clef())),
    checks: "Smeargle (139) is last under Trick Room: it loses ceil(maxhp/2) and switches out.",
  },
  {
    id: "TA14", title: "Baton Pass with no Pokémon to switch in", game: "sv", canSwitch: { own: false },
    slots: slots(act(sm(252, { nature: "Jolly" }), "Baton Pass"), idle(lax()), idle(toise()), idle(clef())),
    checks: "Baton Pass fails with no bench: no switch.",
  },
  {
    id: "TA15", title: "Howl into an ally behind a Substitute (SV)", game: "sv",
    slots: slots(act(mon("Arcanine", "Flash Fire"), "Howl"), idle(lax({ substitute: 50 })), idle(chomp()), idle(toise())),
    checks: "SV Howl has no bypasssub: the ally behind its Substitute is not raised; Arcanine +1.",
  },
  {
    id: "TA16", title: "Howl into an ally behind a Substitute (Champions)", game: "champions",
    slots: slots(act(mon("Arcanine", "Flash Fire"), "Howl"), idle(lax({ substitute: 50 })), idle(chomp()), idle(toise())),
    checks: "Champions Howl has bypasssub: both +1.",
  },
  {
    id: "TA17", title: "Coil under Contrary", game: "sv",
    slots: slots(act(mon("Serperior", "Contrary"), "Coil"), idle(lax()), idle(chomp()), idle(toise())),
    checks: "Contrary: Attack, Defense and accuracy −1.",
  },
  {
    id: "TA18", title: "Strength Sap at full HP", game: "sv",
    slots: slots(act(mon("Bellossom", "Chlorophyll"), "Strength Sap", PL), idle(lax()), idle(chomp()), idle(toise())),
    checks: "Garchomp Attack −1; Bellossom at full HP heals nothing.",
  },
  {
    id: "TA19", title: "Yawn into a statused target; Yawn into Sweet Veil's ally", game: "sv",
    slots: slots(act(toise(), "Yawn", PL), act(mon("Dondozo", "Oblivious"), "Yawn", "opponent-right"), idle(chomp({ status: "brn" })), idle(mon("Alcremie", "Sweet Veil"))),
    checks: "Yawn fails on a burned target (onTryHit); Sweet Veil blocks it on its side.",
  },
  {
    id: "TA21", title: "Encore on a different queued move, held off by Mental Herb", game: "sv",
    slots: slots(act(clef(), "Encore", PL), idle(lax()), act(chomp({ item: "Mental Herb", lastMove: "Earthquake" }), "Dragon Claw", "own-right"), idle(toise())),
    checks: "Encore lands on Garchomp (still to act), Mental Herb ends it at the Update: Dragon Claw is used as chosen.",
  },
  {
    id: "TA22", title: "Swagger into a Persim Berry holder that attacks later", game: "sv",
    slots: slots(act(sm(252, { nature: "Jolly" }), "Swagger", PL), idle(lax()), act(chomp({ item: "Persim Berry" }), "Dragon Claw", "own-right"), idle(toise())),
    checks: "+2 Attack stays; Persim cures the confusion at the Update; Dragon Claw at +2.",
  },
  {
    id: "TA23", title: "Memento into a Substitute", game: "sv",
    slots: slots(act(sm(252, { nature: "Jolly" }), "Memento", PL), idle(lax()), idle(chomp({ substitute: 40 })), idle(toise())),
    checks: "A Substitute stops Memento (no bypasssub): no drops, and the user does not faint.",
  },
  {
    id: "TA24", title: "Ghost Curse aimed at its ally goes to a random foe", game: "sv",
    slots: slots(act(mon("Gengar", "Cursed Body"), "Curse", "own-right"), idle(lax()), idle(chomp()), idle(toise())),
    checks: "SV: aimed at the ally, a Ghost's Curse picks a random foe (1/2 each); Gengar loses half.",
  },
  {
    id: "TA25", title: "Spore into a Grass-type Sap Sipper", game: "sv",
    slots: slots(act(mon("Breloom", "Technician"), "Spore", PL), idle(lax()), idle(mon("Gogoat", "Sap Sipper")), idle(toise())),
    checks: "Sap Sipper (TryHit) comes before the Grass powder immunity (TryImmunity): +1 Attack.",
  },
  {
    id: "TA26", title: "Heal Pulse into a Magic Bounce ally", game: "sv",
    slots: slots(act(sm(0, { hp: 60 }), "Heal Pulse", "own-right"), idle(mon("Hatterene", "Magic Bounce", { hp: 100 })), idle(chomp()), idle(toise())),
    checks: "Hatterene bounces the reflectable Heal Pulse back: Smeargle heals ceil(maxhp/2).",
  },
  {
    id: "TA27", title: "Yawn on Electric Terrain: a grounded and a Flying target", game: "sv", field: { terrain: "Electric" },
    slots: slots(act(toise(), "Yawn", PL), act(mon("Dondozo", "Oblivious"), "Yawn", "opponent-right"), idle(lax()), idle(mon("Charizard", "Blaze"))),
    checks: "Electric Terrain's onTryAddVolatile stops Yawn on the grounded Snorlax; Charizard becomes drowsy.",
  },
  {
    id: "TA20", title: "Confide into Soundproof and a Substitute", game: "sv",
    slots: slots(act(sm(252, { nature: "Jolly" }), "Confide", PL), act(sm(), "Confide", "opponent-right"), idle(mon("Kommo-o", "Soundproof")), idle(lax({ substitute: 50 }))),
    checks: "Soundproof immune; Confide (sound, bypasssub) passes the Substitute: Sp. Atk −1.",
  },
  // ---- The unit tests' scenarios (tests/unit/doubles-status.test.ts), checked here against the oracle first.
  {
    id: "TA28", title: "Confusion self-hit, No move (Champions Snorlax)", game: "champions",
    slots: slots(idle(lax({ carried: { confusion: { attempts: 0 } } })), idle(toise()), idle(chomp()), idle(clef())),
    checks: "Self-hit 1/3 (0.33 in the pinned chance): 23–28.",
  },
  {
    id: "TA29", title: "Confusion self-hit at +2 Attack", game: "champions",
    slots: slots(idle(lax({ boosts: { atk: 2 }, carried: { confusion: { attempts: 0 } } })), idle(toise()), idle(chomp()), idle(clef())),
    checks: "Stored Attack with its stages: 46–55.",
  },
  {
    id: "TA30", title: "Confusion self-hit under Wonder Room", game: "champions", field: { wonderRoom: true },
    slots: slots(idle(lax({ carried: { confusion: { attempts: 0 } } })), idle(toise()), idle(chomp()), idle(clef())),
    checks: "Wonder Room: the stored Sp. Def stands in for Defense.",
  },
  {
    id: "TA31", title: "Clangorous Soul at maxhp 301 (100 HP works, 99 fails)", game: "sv",
    slots: slots(act(mon("Kommo-o", "Bulletproof", { level: 100, evs: { hp: 40 }, hp: 100 }), "Clangorous Soul"), act(mon("Kommo-o", "Bulletproof", { level: 100, evs: { hp: 40 }, hp: 99 }), "Clangorous Soul"), idle(chomp()), idle(toise())),
    checks: "onTry hp <= maxhp*33/100 (99.33); directDamage floor(99.33) = 99.",
  },
  {
    id: "TA32", title: "Moonlight and Heal Pulse at an odd maximum HP", game: "sv",
    slots: slots(act(clef({ evs: { hp: 4 }, hp: 1 }), "Moonlight"), idle(lax()), act(mon("Clawitzer", "Mega Launcher"), "Heal Pulse", "opponent-right"), idle(clef({ evs: { hp: 4 }, hp: 1 }))),
    checks: "Moonlight modify(171, 0.5) = 85; Mega Launcher Heal Pulse modify(171, 0.75) = 128.",
  },
  {
    id: "TA33", title: "Moonlight in sun, Heal Pulse ceil", game: "sv", field: { weather: "Sun" },
    slots: slots(act(clef({ evs: { hp: 4 }, hp: 1 }), "Moonlight"), idle(lax()), act(sm(), "Heal Pulse", "opponent-right"), idle(clef({ evs: { hp: 4 }, hp: 1 }))),
    checks: "Sun: modify(171, 0.667) = 114; Heal Pulse ceil(171 / 2) = 86.",
  },
  {
    id: "TA34", title: "Moonlight in rain; Roost rounds", game: "sv", field: { weather: "Rain" },
    slots: slots(act(clef({ evs: { hp: 4 }, hp: 1 }), "Moonlight"), act(mon("Corviknight", "Pressure", { hp: 1 }), "Roost"), idle(chomp()), idle(toise())),
    checks: "Rain: modify(171, 0.25) = 43; Roost round(173 / 2) = 87.",
  },
  {
    id: "TA35", title: "Shore Up in sand; Floral Healing in Grassy Terrain; Lunar Blessing", game: "sv", field: { weather: "Sand", terrain: "Grassy" },
    slots: slots(act(mon("Palossand", "Water Compaction", { evs: { hp: 4 }, hp: 1 }), "Shore Up"), act(mon("Cresselia", "Levitate", { hp: 1, status: "brn" }), "Lunar Blessing"), act(mon("Comfey", "Triage"), "Floral Healing", "opponent-right"), idle(clef({ evs: { hp: 4 }, hp: 2 }))),
    checks: "Comfey (Triage) first: Floral Healing modify(171, 0.667) = 114; Cresselia: Lunar Blessing modify(maxhp, 0.25): 40 and 49, the burn cured; Palossand last: Shore Up modify(161, 0.667) = 107.",
  },
  {
    id: "TA36", title: "Spore into Insomnia and Vital Spirit", game: "sv",
    slots: slots(act(mon("Amoonguss", "Regenerator"), "Spore", "opponent-left"), act(mon("Breloom", "Technician"), "Spore", "opponent-right"), idle(mon("Honchkrow", "Insomnia")), idle(mon("Annihilape", "Vital Spirit"))),
    checks: "Insomnia and Vital Spirit onSetStatus.",
  },
  {
    id: "TA37", title: "Will-O-Wisp into Thermal Exchange and Water Bubble", game: "sv",
    slots: slots(act(mon("Dragapult", "Clear Body"), "Will-O-Wisp", "opponent-left"), act(gengar(), "Will-O-Wisp", "opponent-right"), idle(mon("Baxcalibur", "Thermal Exchange")), idle(mon("Araquanid", "Water Bubble"))),
    checks: "Thermal Exchange and Water Bubble onSetStatus.",
  },
  {
    id: "TA38", title: "Toxic into Immunity; Glare into an Electric type", game: "sv",
    slots: slots(act(gengar(), "Toxic", "opponent-left"), act(mon("Arbok", "Intimidate"), "Glare", "opponent-right"), idle(mon("Snorlax", "Immunity")), idle(jolt())),
    checks: "Immunity; Electric types cannot be paralysed (generation 6+).",
  },
  {
    id: "TA39", title: "Spore into a plain Snorlax; Thunder Wave into Comatose", game: "sv",
    slots: slots(act(mon("Breloom", "Technician"), "Spore", "opponent-left"), act(mon("Dragapult", "Clear Body"), "Thunder Wave", "opponent-right"), idle(lax()), idle(mon("Komala", "Comatose"))),
    checks: "Snorlax falls asleep; Comatose blocks every status.",
  },
  {
    id: "TA40", title: "Thunder Wave into a Grass type beside Flower Veil, and into Flower Veil", game: "sv",
    slots: slots(act(mon("Dragapult", "Clear Body"), "Thunder Wave", "opponent-left"), act(jolt(), "Thunder Wave", "opponent-right"), idle(saur()), idle(mon("Florges", "Flower Veil"))),
    checks: "Flower Veil protects a Grass type on its side, not Florges (Fairy).",
  },
  {
    id: "TA41", title: "Thunder Wave into Leaf Guard in sun; Toxic into Shields Down (Meteor)", game: "sv", field: { weather: "Sun" },
    slots: slots(act(mon("Dragapult", "Clear Body"), "Thunder Wave", "opponent-left"), act(gengar(), "Toxic", "opponent-right"), idle(mon("Leafeon", "Leaf Guard")), idle(mon("Minior", "Shields Down", { appSpecies: "miniormeteor" }))),
    checks: "Leaf Guard in sun; Shields Down in Meteor Form.",
  },
  {
    id: "TA42", title: "Mold Breaker Thunder Wave into Limber with Ability Shield", game: "sv",
    slots: slots(act(mon("Tinkaton", "Mold Breaker"), "Thunder Wave", "opponent-left"), idle(lax()), idle(mon("Hawlucha", "Limber", { item: "Ability Shield" })), idle(toise())),
    checks: "Ability Shield: Mold Breaker does not pass Limber.",
  },
  {
    id: "TA43", title: "Swords Dance to the cap; Amnesia under Simple; Sand Attack and Double Team", game: "sv",
    slots: slots(act(chomp({ boosts: { atk: 5 } }), "Swords Dance"), act(mon("Numel", "Simple"), "Amnesia"), act(mon("Sandaconda", "Shed Skin"), "Sand Attack", "own-left"), act(sm(), "Double Team")),
    checks: "+5 → +6 (+1); Simple doubles +2 to +4; accuracy −1; evasion +1.",
  },
  {
    id: "TA44", title: "Charm into the ally Kingambit (no Defiant from an ally)", game: "sv",
    slots: slots(act(clef(), "Charm", "own-right"), idle(kingambit()), idle(chomp()), idle(toise())),
    checks: "Defiant reacts to a foe's drop only.",
  },
  {
    id: "TA45", title: "Two Quashes (SV): the quashed move by Speed", game: "sv",
    slots: slots(act(mon("Murkrow", "Prankster"), "Quash", "opponent-right"), act(mon("Sableye", "Prankster"), "Quash", "opponent-left"), act(jolt(), "Thunderbolt", "own-left"), act(chomp(), "Dragon Claw", "own-right")),
    checks: "Generation 8+: both at order 201, then by Speed: Jolteon (150) before Garchomp (122).",
  },
  {
    id: "TA46", title: "Two Quashes (USUM): the quashed move in the order of the Quashes", game: "usum",
    slots: slots(act(mon("Murkrow", "Prankster"), "Quash", "opponent-right"), act(mon("Sableye", "Prankster"), "Quash", "opponent-left"), act(jolt(), "Thunderbolt", "own-left"), act(chomp(), "Dragon Claw", "own-right")),
    checks: "Generation 7: Murkrow (111) quashes Garchomp first, Sableye (70) Jolteon second: Garchomp, then Jolteon.",
  },
  {
    id: "TA47", title: "Asleep and confused: sleep stops it first", game: "sv",
    slots: slots(act(lax({ status: "slp", carried: { sleep: { attempts: 0, rest: false }, confusion: { attempts: 0 } } }), "Body Slam", "opponent-left"), idle(toise()), idle(chomp()), idle(saur())),
    checks: "slp onBeforeMove (10) returns false before confusion (3): no self-hit, the confusion counter unchanged.",
  },
  {
    id: "TA48", title: "Confused and paralysed: confusion before paralysis", game: "sv",
    slots: slots(act(lax({ status: "par", carried: { confusion: { attempts: 0 } } }), "Body Slam", "opponent-left"), idle(toise()), idle(chomp()), idle(saur())),
    checks: "Self-hit 0.33, then full paralysis 1/4 of the rest.",
  },
  {
    id: "TA49", title: "Fake Out into a confused Pokémon: the flinch first", game: "sv",
    slots: slots(act(mon("Incineroar", "Blaze", { evs: { spe: 252 } }), "Fake Out", "opponent-left"), idle(toise()), act(chomp({ carried: { confusion: { attempts: 0 } } }), "Dragon Claw", "own-right"), idle(saur())),
    checks: "flinch onBeforeMove (8) before confusion (3).",
  },
  {
    id: "TA50", title: "A confused No move under Gravity", game: "sv", field: { gravity: true },
    slots: slots(idle(lax({ carried: { confusion: { attempts: 0 } } })), idle(toise()), idle(chomp()), idle(saur())),
    checks: "Gravity (6) stops Splash before confusion (3): no self-hit.",
  },
  {
    id: "TA51", title: "Spore into a Pokémon beside Sweet Veil", game: "sv",
    slots: slots(act(mon("Breloom", "Technician"), "Spore", "opponent-left"), idle(toise()), idle(lax()), idle(mon("Alcremie", "Sweet Veil"))),
    checks: "Sweet Veil (onAllySetStatus) keeps sleep off its side.",
  },
  {
    id: "TA52", title: "Toxic into a Pokémon beside Pastel Veil (SwSh)", game: "swsh",
    slots: slots(act(gengar(), "Toxic", "opponent-left"), idle(toise()), idle(lax()), idle(mon("Rapidash-Galar", "Pastel Veil"))),
    checks: "Pastel Veil (onAllySetStatus) keeps poison off its side.",
  },
  {
    id: "TA53", title: "Will-O-Wisp into a Fire type; Swords Dance at +6", game: "sv",
    slots: slots(act(gengar(), "Will-O-Wisp", "opponent-left"), act(chomp({ boosts: { atk: 6 } }), "Swords Dance"), idle(zard()), idle(toise())),
    checks: "Fire types cannot be burned; at +6 Attack cannot go higher.",
  },
  {
    id: "TA54", title: "Thunder Wave into a side with Safeguard", game: "sv",
    slots: slots(act(clef(), "Thunder Wave", "opponent-right"), idle(lax()), act(mon("Milotic", "Competitive", { evs: { spe: 252 }, nature: "Timid" }), "Safeguard"), idle(toise())),
    checks: "Milotic (146) sets Safeguard first; Thunder Wave from a foe without Infiltrator fails.",
  },
  {
    id: "TA55", title: "Psychic Noise, then a draining move and a heal under Heal Block", game: "sv", notEstimated: "Psychic Noise is not modelled in 2v2.",
    slots: slots(act(mon("Espeon", "Magic Bounce"), "Psychic Noise", "opponent-left"), act(mon("Gardevoir", "Synchronize"), "Psychic Noise", "opponent-right"), act(saur(), "Giga Drain", "own-right"), act(clef({ hp: 100 }), "Moonlight")),
    checks: "The kernel guards Psychic Noise before a later action (volatileGuard: a Berry's heal under Heal Block is not followed); doubles-status.ts healBlockCheck is ready for when it is lifted.",
  },
  {
    id: "TA56", title: "Champions: Prankster Thunder Wave into a Dark type; Glare into an Electric type", game: "champions",
    slots: slots(act(mon("Klefki", "Prankster"), "Thunder Wave", "opponent-left"), act(mon("Arbok", "Intimidate"), "Glare", "opponent-right"), idle(kingambit()), idle(jolt())),
    checks: "Champions runs generation 9's rules: Prankster vs Dark (hitStepTryImmunity) and Electric types cannot be paralysed.",
  },
];

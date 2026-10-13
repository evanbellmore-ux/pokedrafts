// zmove-status fix: 2v2 oracle cases ZS01-ZS20, a damaging move's Z-Move (USUM) or Max Move (SwSh) runs none of its base
// move's own effects (pinned Showdown c23d2e94 sim/battle-actions.ts getActiveZMove / getActiveMaxMove), only the Z-Move's
// own (data/moves.ts: Genesis Supernova's Psychic Terrain, Splintered Stormshards' terrain clear, Clangorous Soulblaze's
// selfBoost). Level 50, 31 IVs, Serious, 0 EVs unless set. Speeds (USUM, 0 EVs: base + 20): Heracross 105, Toxapex 55,
// Snorlax 50, Typhlosion 120, Pikachu 110, Breloom 90, Charizard 120, Hariyama 70, Garchomp 122, Kangaskhan 110, Kommo-o
// 105, Venusaur 100 (101 with 4 EVs), Mew 120, Slowbro 50, Lycanroc 132, Blacephalon 127, Tyranitar 81, Swampert 80,
// Skarmory 90, Scizor 85, Blissey 75, Blastoise 98.
import type { Case, CaseAction, CaseMon, SlotId } from "../../2v2/verify/case-types";

type Slot = CaseMon & { action: CaseAction };
const mon = (species: string, ability: string, extra: Partial<CaseMon> = {}): CaseMon => ({ species, ability, ...extra });
const act = (m: CaseMon, move: string | null, target?: SlotId): Slot => ({ ...m, action: { move, ...(target ? { target } : {}) } });
const idle = (m: CaseMon): Slot => act(m, null);
const S = (a: Slot, b: Slot, c: Slot, d: Slot): Case["slots"] => ({ "own-left": a, "own-right": b, "opponent-left": c, "opponent-right": d });
const z = (species: string, ability: string, item: string, extra: Partial<CaseMon> = {}) => mon(species, ability, { item, choice: "zmove", ...extra });
const venusaur = mon("Venusaur", "Overgrow", { evs: { spe: 4 } });
const blastoise = mon("Blastoise", "Torrent");
const snorlax = mon("Snorlax", "Thick Fat");
const blissey = mon("Blissey", "Natural Cure");

export const ZS_CASES: Case[] = [
  {
    id: "ZS01", title: "Z-Inferno (Inferno Overdrive) burns nothing: the target's later Body Slam at full power (USUM)", game: "usum",
    slots: S(act(z("Typhlosion", "Blaze", "Firium Z"), "Inferno", "opponent-left"), idle(venusaur), act(snorlax, "Body Slam", "own-left"), idle(blastoise)),
    checks: "Snorlax is not burned: Body Slam 64-76 into Typhlosion (the bug halved it: 32-38).",
  },
  {
    id: "ZS02", title: "Z-Close Combat (All-Out Pummeling) lowers nothing: a slower foe's Body Slam into the user (USUM)", game: "usum",
    slots: S(act(z("Heracross", "Guts", "Fightinium Z"), "Close Combat", "opponent-left"), idle(venusaur), idle(mon("Toxapex", "Regenerator")), act(snorlax, "Body Slam", "own-left")),
    checks: "Toxapex survives; Heracross keeps its Defense for Snorlax's Body Slam.",
  },
  {
    id: "ZS03", title: "Z-Nuzzle (Gigavolt Havoc) paralyses nothing: the slower target always moves (USUM)", game: "usum",
    slots: S(act(z("Pikachu", "Static", "Electrium Z"), "Nuzzle", "opponent-left"), idle(venusaur), act(snorlax, "Body Slam", "own-left"), idle(blastoise)),
    checks: "No full paralysis chance for Snorlax.",
  },
  {
    id: "ZS04", title: "Z-Drain Punch (All-Out Pummeling) heals nothing (USUM)", game: "usum",
    slots: S(act(z("Breloom", "Technician", "Fightinium Z", { hp: 60 }), "Drain Punch", "opponent-left"), idle(venusaur), idle(snorlax), idle(blastoise)),
    checks: "Breloom stays at 60.",
  },
  {
    id: "ZS05", title: "Z-Flare Blitz (Inferno Overdrive) takes no recoil (USUM)", game: "usum",
    slots: S(act(z("Charizard", "Blaze", "Firium Z"), "Flare Blitz", "opponent-left"), idle(venusaur), idle(snorlax), idle(blastoise)),
    checks: "Charizard stays at full HP.",
  },
  {
    id: "ZS06", title: "Z-Close Combat makes no contact: no Rough Skin or Rocky Helmet (USUM)", game: "usum",
    slots: S(act(z("Heracross", "Guts", "Fightinium Z"), "Close Combat", "opponent-left"), idle(venusaur), idle(mon("Garchomp", "Rough Skin", { item: "Rocky Helmet" })), idle(blastoise)),
    checks: "Heracross stays at full HP.",
  },
  {
    id: "ZS07", title: "Z-Focus Punch (All-Out Pummeling, -3) is used after the user is hit: no focus to lose (USUM)", game: "usum",
    slots: S(act(z("Hariyama", "Thick Fat", "Fightinium Z"), "Focus Punch", "opponent-left"), idle(venusaur), act(mon("Garchomp", "Rough Skin"), "Dragon Claw", "own-left"), idle(blastoise)),
    checks: "Garchomp's Dragon Claw first, then All-Out Pummeling into Garchomp.",
  },
  {
    id: "ZS08", title: "Z-Fake Out (Breakneck Blitz, +3) flinches nothing: the target still moves (USUM)", game: "usum",
    slots: S(act(z("Kangaskhan", "Scrappy", "Normalium Z"), "Fake Out", "opponent-left"), idle(venusaur), act(snorlax, "Body Slam", "own-left"), idle(blastoise)),
    checks: "Snorlax's Body Slam lands on Kangaskhan.",
  },
  {
    id: "ZS09", title: "Clangorous Soulblaze raises every stat: a slower foe's Sludge Bomb meets +1 Sp. Def (USUM)", game: "usum",
    slots: S(act(z("Kommo-o", "Overcoat", "Kommonium Z"), "Clanging Scales"), idle(snorlax), act(mon("Venusaur", "Overgrow"), "Sludge Bomb", "own-left"), idle(blissey)),
    checks: "Kommo-o +1 all after its move (selfBoost), so Venusaur's Sludge Bomb deals the +1 damage.",
  },
  {
    id: "ZS10", title: "Genesis Supernova sets Psychic Terrain: the partner's later Psychic is boosted (USUM)", game: "usum",
    slots: S(act(z("Mew", "Synchronize", "Mewnium Z"), "Psychic", "opponent-left"), act(mon("Slowbro", "Oblivious"), "Psychic", "opponent-right"), idle(blissey), idle(snorlax)),
    checks: "Slowbro's Psychic into Snorlax at 1.5x (gen 7 Psychic Terrain).",
  },
  {
    id: "ZS11", title: "Splintered Stormshards ends Psychic Terrain: the partner's later Psychic is not boosted (USUM)", game: "usum",
    slots: S(act(z("Lycanroc", "Keen Eye", "Lycanium Z"), "Stone Edge", "opponent-left"), act(mon("Slowbro", "Oblivious"), "Psychic", "opponent-right"), idle(mon("Toxapex", "Regenerator")), idle(snorlax)),
    field: { terrain: "Psychic" },
    checks: "The terrain is gone before Slowbro's Psychic.",
  },
  {
    id: "ZS12", title: "Z-Mind Blown (Inferno Overdrive) costs no HP (USUM)", game: "usum",
    slots: S(act(z("Blacephalon", "Beast Boost", "Firium Z", { hp: 60 }), "Mind Blown", "opponent-left"), idle(venusaur), idle(blissey), idle(snorlax)),
    checks: "Blacephalon stays at 60.",
  },
  {
    id: "ZS13", title: "Z-Smack Down (Continental Crush) grounds nothing: the partner's later Earth Power misses Skarmory (USUM)", game: "usum",
    slots: S(act(z("Tyranitar", "Unnerve", "Rockium Z"), "Smack Down", "opponent-left"), act(mon("Swampert", "Torrent"), "Earth Power", "opponent-left"), idle(mon("Skarmory", "Keen Eye")), idle(snorlax)),
    checks: "Skarmory keeps its Ground immunity: Earth Power deals nothing.",
  },
  {
    id: "ZS14", title: "Max Flare from Inferno burns nothing: the target's later Body Slam at full power (SwSh)", game: "swsh",
    slots: S(act(mon("Charizard", "Blaze", { choice: "dynamax" }), "Inferno", "opponent-left"), idle(venusaur), act(snorlax, "Body Slam", "own-left"), idle(blastoise)),
    checks: "Snorlax is not burned (the sun Max Flare sets is in the turn).",
  },
  {
    id: "ZS15", title: "Z-U-turn (Savage Spin-Out) switches nothing out: later moves still meet the user (USUM)", game: "usum",
    slots: S(act(z("Scizor", "Technician", "Buginium Z"), "U-turn", "opponent-left"), idle(venusaur), idle(blissey), act(snorlax, "Body Slam", "own-left")),
    checks: "Scizor stays in; Snorlax's Body Slam lands on it.",
  },
  {
    id: "ZS16", title: "Z-Dragon Tail (Devastating Drake) drags nothing out (USUM)", game: "usum",
    slots: S(act(z("Garchomp", "Rough Skin", "Dragonium Z"), "Dragon Tail", "opponent-left"), idle(venusaur), act(blissey, "Seismic Toss", "own-left"), idle(snorlax)),
    checks: "Blissey stays in and uses Seismic Toss.",
  },
  {
    id: "ZS17", title: "Z-Focus Punch into a faster Fake Out: no focus, so the flinch stops it (USUM)", game: "usum",
    slots: S(act(z("Hariyama", "Thick Fat", "Fightinium Z"), "Focus Punch", "opponent-left"), idle(venusaur), act(mon("Kangaskhan", "Scrappy"), "Fake Out", "own-left"), idle(blastoise)),
    checks: "Focus Punch's focus (its priorityChargeCallback) would stop the flinch; the Z-Move has none: Hariyama flinches.",
  },
  {
    id: "ZS18", title: "Genesis Supernova knocking its target out still sets Psychic Terrain (USUM)", game: "usum",
    slots: S(act(z("Mew", "Synchronize", "Mewnium Z"), "Psychic", "opponent-left"), act(mon("Slowbro", "Oblivious"), "Psychic", "opponent-right"), idle(mon("Venusaur", "Overgrow", { hp: 40 })), idle(snorlax)),
    checks: "Venusaur is knocked out by the Z-Move; Slowbro's Psychic is still boosted.",
  },
  {
    id: "ZS19", title: "Genesis Supernova replaces Grassy Terrain: the partner's later Giga Drain is not boosted (USUM)", game: "usum",
    slots: S(act(z("Mew", "Synchronize", "Mewnium Z"), "Psychic", "opponent-left"), act(mon("Venusaur", "Overgrow"), "Giga Drain", "opponent-right"), idle(blissey), idle(blastoise)),
    field: { terrain: "Grassy" },
    checks: "Psychic Terrain replaces Grassy Terrain before Venusaur's Giga Drain.",
  },
  {
    id: "ZS20", title: "Clangorous Soulblaze into a lone foe, then that foe's Sludge Bomb (USUM)", game: "usum",
    slots: S(act(z("Kommo-o", "Overcoat", "Kommonium Z"), "Clanging Scales"), idle(snorlax), act(mon("Venusaur", "Overgrow"), "Sludge Bomb", "own-left"), { ...blissey, absent: true, action: { move: null } }),
    checks: "One target (no spread modifier); Kommo-o +1 Sp. Def for the Sludge Bomb.",
  },
  {
    id: "ZS21", title: "Stoked Sparksurfer's own paralysis: the slower target is fully paralysed a quarter of the time (USUM)", game: "usum",
    slots: S(act(z("Raichu-Alola", "Surge Surfer", "Aloraichium Z"), "Thunderbolt", "opponent-left"), idle(venusaur), act(snorlax, "Body Slam", "own-left"), idle(blastoise)),
    checks: "The signature Z-Move keeps its 100% paralysis (data/moves.ts stokedsparksurfer secondary).",
  },
  {
    id: "ZS22", title: "Z-Sucker Punch (Black Hole Eclipse) has no onTry: it hits a target that does not attack (USUM)", game: "usum",
    slots: S(act(z("Absol", "Pressure", "Darkinium Z"), "Sucker Punch", "opponent-left"), idle(venusaur), idle(mon("Slowbro", "Oblivious")), idle(snorlax)),
    checks: "Black Hole Eclipse lands on the idle Slowbro.",
  },
  {
    id: "ZS23", title: "Max Darkness from Sucker Punch has no onTry: it hits a target that does not attack (SwSh)", game: "swsh",
    slots: S(act(mon("Absol", "Pressure", { choice: "dynamax" }), "Sucker Punch", "opponent-left"), idle(venusaur), idle(mon("Slowbro", "Oblivious")), idle(snorlax)),
    checks: "Max Darkness lands on the idle Slowbro (and lowers its Sp. Def).",
  },
  {
    id: "ZS24", title: "Max Geyser from Snipe Shot does not track its target: Storm Drain takes it (SwSh)", game: "swsh",
    slots: S(act(mon("Inteleon", "Torrent", { choice: "dynamax" }), "Snipe Shot", "opponent-left"), idle(venusaur), idle(snorlax), idle(mon("Gastrodon", "Storm Drain"))),
    checks: "Gastrodon's Storm Drain redirects Max Geyser (no tracksTarget), which it absorbs.",
  },
];

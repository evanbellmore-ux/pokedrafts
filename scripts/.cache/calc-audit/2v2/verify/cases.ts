// SPEC §8.2 validation cases. Showdown names; the app maps them with toID (app-turn.ts). Level 50, 31 IVs, Serious nature and
// 0 EVs / Stat Points unless set. Leads carry no entry ability that changes the start unless the case states the start it leaves
// (boosts), which sim-dfs.ts checks against Showdown's own start. Species, abilities, items and moves are the app catalogs' own
// (app-turn.ts --preflight), so some probes are moved to the game whose catalog has the species (noted per case).
import type { Case, CaseAction, CaseMon, SlotId } from "./case-types";
import { EXPECT, FIX_CASES } from "../fix-engine/cases3";
import { REVIEW_CASES } from "../review-engine/cases";
import { FAINTED_CASES } from "../fainted-engine/cases-fainted";
import { ZS_CASES } from "../../zmove-status/fix/cases-zs";
import { ZV_CASES } from "../../zmove-status/verify/cases-zv";
import { SA_CASES } from "../../serene-arceus/fix/cases-sa";
import { FIF_CASES } from "../../forms-iceface-fling/fix/cases-fif";
import { V_CASES } from "../../forms-iceface-fling/verify/cases-v";
import { NG_CASES } from "../../ngas-pp/fix/cases-ng";
import { VG_CASES } from "../../ngas-pp/verify/cases-vg";
import { VGX_CASES } from "../../ngas-pp/verify/cases-vgx";
import { STATUS_EOT_CASES, STATUS_EOT_REEXPECT } from "./cases-se";
import { WAVE1A_CASES } from "./cases-wave1a";
import { WAVE2_CASES } from "./cases-wave2";
import { REEXPECT_TO, removalOf } from "./status2-removed";

type Slot = CaseMon & { action: CaseAction };
const mon = (species: string, ability: string, extra: Partial<CaseMon> = {}): CaseMon => ({ species, ability, ...extra });
const act = (m: CaseMon, move: string | null, target?: SlotId, context?: Record<string, unknown>): Slot =>
  ({ ...m, action: { move, ...(target ? { target } : {}), ...(context ? { context } : {}) } });
const idle = (m: CaseMon): Slot => act(m, null);
const empty = (m: CaseMon): Slot => ({ ...m, absent: true, action: { move: null } });
const slots = (ownLeft: Slot, ownRight: Slot, oppLeft: Slot, oppRight: Slot): Case["slots"] =>
  ({ "own-left": ownLeft, "own-right": ownRight, "opponent-left": oppLeft, "opponent-right": oppRight });
const with_ = (m: CaseMon, extra: Partial<CaseMon>): CaseMon => ({ ...m, ...extra });

// Native sets (EVs). Speeds at level 50: Garchomp Jolly 252 169, Serious 0 EVs 122; Charizard Timid 252 152, Serious 120;
// Snorlax 50; Venusaur 100; Blastoise 98; Dragapult 162; Weavile 145; Kingambit 70.
const chomp = mon("Garchomp", "Rough Skin", { nature: "Jolly", evs: { atk: 252, spe: 252 } });
const chomp0 = mon("Garchomp", "Rough Skin");
const zard = mon("Charizard", "Blaze", { nature: "Timid", evs: { spa: 252, spe: 252 } });
const zard0 = mon("Charizard", "Blaze");
// Snorlax and Venusaur carry 4 Speed (EVs or Stat Points) so they never tie with an 0-EV Pokémon of the same base Speed.
const snorlax = (extra: Partial<CaseMon> = {}) => mon("Snorlax", "Thick Fat", { evs: { spe: 4 }, ...extra });
const venusaur = mon("Venusaur", "Overgrow", { evs: { spe: 4 } });
const blastoise = mon("Blastoise", "Torrent");
// Champions (Stat Points; no EVs): Garchomp 122, Charizard 120, Venusaur 100, Blastoise 98, Snorlax 50, Weavile 145, Gengar 130.
const cChomp = mon("Garchomp", "Sand Veil");
const cZard = mon("Charizard", "Blaze");

export const CASES: Case[] = [
  // V01: two attacks into one slot with a Sitrus Berry between them.
  {
    id: "V01a", title: "Sitrus between two attacks into one slot (200/235)", game: "sv",
    slots: slots(act(chomp, "Dragon Claw", "opponent-right"), act(zard, "Flamethrower", "opponent-right"), idle(venusaur), idle(snorlax({ item: "Sitrus Berry", hp: 200 }))),
    checks: "Snorlax 200 → Dragon Claw → Sitrus +58 at the Update after it → Flamethrower (probe c1b: 115 then 39 at max rolls, 104 left).",
  },
  {
    id: "V01b", title: "Sitrus after the second attack (full HP)", game: "sv",
    slots: slots(act(chomp, "Dragon Claw", "opponent-right"), act(zard, "Flamethrower", "opponent-right"), idle(venusaur), idle(snorlax({ item: "Sitrus Berry" }))),
    checks: "At 235 the Sitrus is eaten only once the second hit takes it under half (probe c1: 235 → 120 → 81 → 139).",
  },
  {
    id: "V02", title: "Focus Sash broken by the first attack", game: "sv",
    slots: slots(act(chomp, "Dragon Claw", "opponent-right"), act(zard, "Air Slash", "opponent-right"), idle(venusaur), idle(mon("Dragapult", "Clear Body", { item: "Focus Sash" }))),
    checks: "Dragapult 163: Dragon Claw would OHKO, Sash leaves 1, Air Slash KOs (probe c2b). KO chance 1; min 0.",
  },
  {
    id: "V03", title: "Multiscale broken by a spread move", game: "sv",
    slots: slots(act(chomp, "Rock Slide"), act(zard, "Flamethrower", "opponent-right"), idle(venusaur), idle(mon("Dragonite", "Multiscale"))),
    checks: "Rock Slide at 0.75 into both foes, halved on Dragonite; Flamethrower not halved after (probe c3: min rolls 166 → 132 → 98; Venusaur 155 → 117).",
  },
  // V04-V05: retargeting.
  {
    id: "V04", title: "Retarget after the chosen foe faints", game: "champions",
    slots: slots(act(cChomp, "Dragon Claw", "opponent-left"), act(cZard, "Flamethrower", "opponent-left"), idle(with_(venusaur, { hp: 1 })), idle(blastoise)),
    checks: "Garchomp KOs Venusaur at 1 HP; Charizard's Flamethrower goes to Blastoise (probe 2: 154 → 128 at the lowest roll).",
  },
  {
    id: "V05", title: "A move aimed at a fainted ally fails", game: "champions",
    slots: slots(act(snorlax(), "Body Slam", "own-right"), idle(mon("Gengar", "Cursed Body", { hp: 1 })), idle(venusaur), act(mon("Weavile", "Pressure"), "Night Slash", "own-right")),
    checks: "Weavile KOs Gengar first; Snorlax's Body Slam has no target and fails (probe 2b).",
  },
  // V06: Helping Hand.
  {
    id: "V06a", title: "Helping Hand then Flamethrower", game: "champions",
    slots: slots(act(mon("Clefable", "Magic Guard"), "Helping Hand"), act(cZard, "Flamethrower", "opponent-right"), idle(venusaur), idle(blastoise)),
    checks: "Flamethrower ×1.5: 26 → 39 at the lowest roll (probes 4a/4b).",
  },
  {
    id: "V06b", title: "Helping Hand after the partner has moved fails", game: "champions",
    slots: slots(act(mon("Clefable", "Magic Guard"), "Helping Hand"), act(cZard, "Helping Hand"), idle(venusaur), idle(blastoise)),
    checks: "Both +5: the faster Charizard's Helping Hand works; Clefable's fails, Charizard has moved (data/moves.ts helpinghand onTryHit).",
  },
  {
    id: "V06c", title: "Helping Hand with no partner fails", game: "champions",
    slots: slots(act(mon("Clefable", "Magic Guard"), "Helping Hand"), empty(cZard), act(cChomp, "Dragon Claw", "own-left"), idle(blastoise)),
    checks: "The ally slot is empty (fainted in Showdown): Helping Hand has no target and fails (|-fail|, [notarget]).",
  },
  // V07: redirection.
  {
    id: "V07a", title: "Follow Me takes a move aimed at its partner", game: "champions",
    slots: slots(idle(snorlax()), act(cZard, "Flamethrower", "opponent-left"), idle(venusaur), act(mon("Clefable", "Magic Guard"), "Follow Me")),
    checks: "Flamethrower aimed at Venusaur hits Clefable: 170 → 110 at the lowest roll (probe 3a).",
  },
  {
    id: "V07b", title: "Follow Me takes a move aimed at the attacker's own partner", game: "champions",
    slots: slots(act(snorlax(), "Body Slam", "own-right"), idle(mon("Gengar", "Cursed Body")), idle(venusaur), act(mon("Clefable", "Magic Guard"), "Follow Me")),
    checks: "Body Slam aimed at Gengar goes to Clefable: 170 → 103 at the lowest roll (probe 17).",
  },
  {
    id: "V07c", title: "Rage Powder does not redirect a Grass attacker", game: "sv",
    slots: slots(act(venusaur, "Energy Ball", "opponent-left"), idle(snorlax()), idle(blastoise), act(mon("Amoonguss", "Regenerator"), "Rage Powder")),
    checks: "Energy Ball still hits Blastoise (probe 3b; SV: Amoonguss is not in the Champions catalog).",
  },
  {
    id: "V07d", title: "Rage Powder redirects a non-Grass attacker", game: "sv",
    slots: slots(idle(snorlax()), act(zard, "Flamethrower", "opponent-left"), idle(blastoise), act(mon("Amoonguss", "Regenerator"), "Rage Powder")),
    checks: "Flamethrower aimed at Blastoise hits Amoonguss.",
  },
  {
    id: "V07e", title: "Lightning Rod takes the ally's Electric move", game: "champions",
    slots: slots(idle(mon("Raichu", "Lightning Rod")), act(cZard, "Thunder Punch", "opponent-right"), idle(venusaur), idle(blastoise)),
    checks: "Thunder Punch aimed at Blastoise goes to Raichu: no damage, +1 Sp. Atk (probe 3c).",
  },
  // V08: Wide Guard.
  {
    id: "V08a", title: "Wide Guard against Rock Slide", game: "sv",
    slots: slots(act(with_(chomp, { boosts: { atk: -1 } }), "Rock Slide"), act(with_(zard, { boosts: { atk: -1 } }), "Flamethrower", "opponent-left"), idle(venusaur),
      act(mon("Hitmontop", "Intimidate"), "Wide Guard")),
    checks: "Both foes take nothing from Rock Slide; Flamethrower takes Venusaur 155 → 17 at the lowest roll (probe c4; Hitmontop's Intimidate gives both -1 Atk).",
  },
  {
    id: "V08b", title: "Wide Guard against the partner's own Earthquake", game: "sv",
    slots: slots(act(chomp, "Earthquake"), act(mon("Hitmontop", "Intimidate"), "Wide Guard"), idle(with_(venusaur, { boosts: { atk: -1 } })), idle(with_(blastoise, { boosts: { atk: -1 } }))),
    checks: "Earthquake does not hit the Wide Guard user; both foes at 0.75 (probe 7a; Intimidate gives both foes -1 Atk).",
  },
  // V09-V10: the spread modifier.
  {
    id: "V09a", title: "Earthquake into the ally and both foes", game: "champions",
    slots: slots(act(cChomp, "Earthquake"), idle(snorlax()), idle(venusaur), idle(blastoise)),
    checks: "0.75 on all three: Snorlax 75, Blastoise 54, Venusaur 61 at the lowest roll (probe 1a).",
  },
  {
    id: "V09b", title: "Earthquake with an immune ally still counts it", game: "sv",
    slots: slots(act(chomp, "Earthquake"), act(zard, "Flamethrower", "opponent-right"), idle(venusaur), idle(snorlax())),
    checks: "Charizard is immune but counted: Snorlax 91, Venusaur 75 at the lowest roll (probe c5).",
  },
  {
    id: "V10a", title: "A Protecting foe still counts for the spread modifier", game: "champions",
    slots: slots(act(cChomp, "Earthquake"), idle(snorlax()), idle(venusaur), act(blastoise, "Protect")),
    checks: "Blastoise protects; Snorlax 75 and Venusaur 61 at 0.75 (probe 1b).",
  },
  {
    id: "V10b", title: "A lone target takes no spread modifier", game: "champions",
    slots: slots(act(cChomp, "Earthquake"), empty(snorlax()), empty(venusaur), idle(blastoise)),
    checks: "The ally and one foe empty: Blastoise 154 → 82 at the lowest roll (probe 1c).",
  },
  {
    id: "V10c", title: "Two targets, one Protecting: 0.75 on the other", game: "champions",
    slots: slots(act(cChomp, "Earthquake"), empty(snorlax()), idle(venusaur), act(blastoise, "Protect")),
    checks: "The ally empty, Blastoise protects, Venusaur 61 at 0.75 (probe 11).",
  },
  // V11: speed tie.
  {
    id: "V11", title: "Speed tie: Choice Band Garchomp mirror", game: "sv",
    slots: slots(act(with_(chomp, { ability: "Sand Veil", item: "Choice Band" }), "Dragon Claw", "opponent-right"), idle(snorlax()), idle(venusaur),
      act(with_(chomp, { ability: "Sand Veil", item: "Choice Band" }), "Dragon Claw", "own-left")),
    checks: "Each Garchomp KOs the other 50% of the time; the other stays at full HP and does not move (probes c8a/c8b).",
  },
  // V12: Trick Room.
  {
    id: "V12a", title: "Trick Room: the slower attacker first, Sitrus between", game: "sv", field: { trickRoom: true },
    slots: slots(act(chomp, "Dragon Claw", "opponent-right"), act(zard, "Flamethrower", "opponent-right"), idle(venusaur), idle(snorlax({ item: "Sitrus Berry", hp: 200 }))),
    checks: "Charizard first: 200 → 161 → Dragon Claw → 46 → Sitrus → 104 at the highest rolls (probe c6).",
  },
  {
    id: "V12b", title: "Trick Room: Multiscale halves the slower attacker's hit", game: "sv", field: { trickRoom: true },
    slots: slots(act(chomp, "Dragon Claw", "opponent-right"), act(zard, "Air Slash", "opponent-right"), idle(venusaur), idle(mon("Dragonite", "Multiscale"))),
    checks: "Air Slash first, halved by Multiscale; Dragon Claw full.",
  },
  {
    id: "V12c", title: "No Trick Room: Multiscale halves the faster attacker's hit", game: "sv",
    slots: slots(act(chomp, "Dragon Claw", "opponent-right"), act(zard, "Air Slash", "opponent-right"), idle(venusaur), idle(mon("Dragonite", "Multiscale"))),
    checks: "Dragon Claw first, halved; Air Slash full: a different result from V12b.",
  },
  // V13-V15: re-sorting from gen 8.
  ...(["sv", "usum"] as const).map((game): Case => ({
    id: `V13-${game}`, title: `Prankster Tailwind then the re-sort (${game})`, game,
    slots: slots(act(mon("Whimsicott", "Prankster"), "Tailwind"), act(zard0, "Air Slash", "opponent-right"), idle(venusaur), act(chomp0, "Dragon Claw", "own-right")),
    checks: game === "sv" ? "Charizard (240 under Tailwind) moves before Garchomp (122) (probe c7)." : "Gen 7 keeps the order of the turn's start: Garchomp (122) before Charizard (120).",
  })),
  ...(["sv", "usum"] as const).map((game): Case => ({
    id: `V14-${game}`, title: `Gale Wings lost after damage (${game})`, game,
    slots: slots(act(mon("Talonflame", "Gale Wings"), "Brave Bird", "opponent-left"), idle(snorlax()),
      act(with_(chomp, { ability: "Sand Veil" }), "Dragon Claw", "own-left"), act(mon("Azumarill", "Thick Fat", { boosts: { spe: 6 } }), "Aqua Jet", "own-left")),
    checks: game === "sv" ? "Aqua Jet first; Talonflame is no longer at full HP, so Brave Bird drops behind Garchomp's Dragon Claw (probe 6). Recoil ties Talonflame's HP to its damage." : "Gen 7: Brave Bird keeps its +1 from the turn's start (probe 6).",
  })),
  ...(["sv", "champions", "usum"] as const).map((game): Case => ({
    id: `V15-${game}`, title: `Icy Wind then the re-sort (${game})`, game,
    slots: slots(act(mon("Weavile", "Pressure"), "Icy Wind"), act(mon("Golurk", "Iron Fist", { nature: "Jolly", evs: { spe: game === "champions" ? 32 : 252 } }), "Shadow Punch", "opponent-right"),
      idle(snorlax()), act(mon("Garchomp", "Sand Veil", { evs: { spe: 4 } }), "Dragon Claw", "own-right")),
    checks: game === "usum" ? "Gen 7: Garchomp keeps its place before Golurk (probe 5)." : "After Icy Wind, Golurk moves before Garchomp (probes 5, 12).",
  })),
  // V16: Fake Out and its blocks.
  {
    id: "V16a", title: "Psychic Terrain blocks Fake Out", game: "champions", field: { terrain: "Psychic" },
    slots: slots(act(mon("Incineroar", "Blaze"), "Fake Out", "opponent-right"), idle(cZard), idle(venusaur), act(cChomp, "Dragon Claw", "own-right")),
    checks: "Fake Out into grounded Garchomp fails; Garchomp attacks (probe 13a).",
  },
  {
    id: "V16b", title: "Armor Tail partner blocks Fake Out", game: "champions",
    slots: slots(act(mon("Incineroar", "Blaze"), "Fake Out", "opponent-right"), idle(cZard), idle(mon("Farigiraf", "Armor Tail", { evs: { spe: 4 } })), act(cChomp, "Dragon Claw", "own-right")),
    checks: "Farigiraf's Armor Tail stops Fake Out into its ally (probe 13b).",
  },
  {
    id: "V16c", title: "Inner Focus: no flinch", game: "champions",
    slots: slots(act(mon("Incineroar", "Blaze"), "Fake Out", "opponent-right"), idle(cZard), idle(venusaur), act(mon("Dragonite", "Inner Focus"), "Dragon Claw", "own-right")),
    checks: "Dragonite takes Fake Out and still attacks.",
  },
  {
    id: "V16d", title: "Covert Cloak: no flinch", game: "sv",
    slots: slots(act(mon("Incineroar", "Blaze"), "Fake Out", "opponent-right"), idle(zard0), idle(venusaur), act(with_(chomp0, { item: "Covert Cloak" }), "Dragon Claw", "own-right")),
    checks: "Covert Cloak blocks the flinch (SV: not in the Champions catalog).",
  },
  {
    id: "V16e", title: "Fake Out into a Ghost", game: "champions",
    slots: slots(act(mon("Incineroar", "Blaze"), "Fake Out", "opponent-right"), idle(cZard), idle(venusaur), act(mon("Gengar", "Cursed Body"), "Shadow Ball", "own-right")),
    checks: "Gengar is immune and attacks.",
  },
  {
    id: "V16f", title: "Steadfast: flinch and +1 Speed", game: "champions",
    slots: slots(act(mon("Incineroar", "Blaze"), "Fake Out", "opponent-right"), idle(cZard), idle(venusaur), act(mon("Lucario", "Steadfast"), "Aura Sphere", "own-right")),
    checks: "Lucario flinches (no Aura Sphere) and gains +1 Speed.",
  },
  {
    id: "V16g", title: "Fake Out flinches a slower attacker", game: "champions",
    slots: slots(act(mon("Incineroar", "Blaze"), "Fake Out", "opponent-right"), idle(cZard), idle(venusaur), act(cChomp, "Dragon Claw", "own-right")),
    checks: "Garchomp flinches: Charizard takes nothing.",
  },
  {
    id: "V16h", title: "Shield Dust: no flinch", game: "champions",
    slots: slots(act(mon("Incineroar", "Blaze"), "Fake Out", "opponent-right"), idle(cZard), idle(venusaur), act(mon("Vivillon", "Shield Dust"), "Bug Buzz", "own-right")),
    checks: "Shield Dust blocks Fake Out's flinch.",
  },
  // V17: Sucker Punch against the target's queued move.
  {
    id: "V17a", title: "Sucker Punch into an attacker", game: "champions",
    slots: slots(act(mon("Kingambit", "Defiant"), "Sucker Punch", "opponent-right"), idle(cZard), idle(venusaur), act(cChomp, "Dragon Claw", "own-right")),
    checks: "Garchomp has a damaging move queued: Sucker Punch hits (probe 10b).",
  },
  {
    id: "V17b", title: "Sucker Punch into No move", game: "champions",
    slots: slots(act(mon("Kingambit", "Defiant"), "Sucker Punch", "opponent-right"), idle(cZard), idle(venusaur), idle(cChomp)),
    checks: "No move is a pass: Sucker Punch fails (probe 10a, SPEC C13).",
  },
  {
    id: "V17c", title: "Sucker Punch into a target that has moved", game: "champions",
    slots: slots(act(mon("Kingambit", "Defiant"), "Sucker Punch", "opponent-right"), idle(cZard), idle(venusaur), act(mon("Weavile", "Pressure"), "Ice Shard", "own-right")),
    checks: "Weavile's +1 Ice Shard goes first (145 > 70): Sucker Punch fails.",
  },
  {
    id: "V17d", title: "Sucker Punch into a status move", game: "champions",
    slots: slots(act(mon("Kingambit", "Defiant"), "Sucker Punch", "opponent-right"), idle(cZard), idle(venusaur), act(cChomp, "Stealth Rock")),
    checks: "Stealth Rock is a status move: Sucker Punch fails.",
  },
  // V18: Quick Claw and Quick Draw.
  {
    id: "V18a", title: "Quick Claw on the slower attacker", game: "sv",
    slots: slots(act(snorlax({ item: "Quick Claw", hp: 100 }), "Body Slam", "opponent-right"), idle(venusaur), idle(zard), act(chomp, "Dragon Claw", "own-left")),
    checks: "Dragon Claw KOs Snorlax at 100 HP unless Quick Claw (20%) lets Body Slam go first: faintsBeforeMoving 0.8.",
  },
  {
    id: "V18b", title: "Quick Draw on the slower attacker", game: "sv",
    slots: slots(act(mon("Slowbro-Galar", "Quick Draw", { hp: 60 }), "Sludge Bomb", "opponent-right"), idle(venusaur), idle(zard), act(chomp, "Dragon Claw", "own-left")),
    checks: "Quick Draw (30%) for an attacking move.",
  },
  // V19: paralysis.
  {
    id: "V19a", title: "Full paralysis 1/8 (Champions)", game: "champions",
    slots: slots(act(with_(cChomp, { status: "par" }), "Dragon Claw", "opponent-right"), idle(snorlax()), idle(venusaur), idle(blastoise)),
    checks: "Champions full paralysis is 1/8 (data/mods/champions/conditions.ts:2-10).",
  },
  {
    id: "V19b", title: "Full paralysis 1/4 (SV)", game: "sv",
    slots: slots(act(with_(chomp, { status: "par" }), "Dragon Claw", "opponent-right"), idle(snorlax()), idle(venusaur), idle(blastoise)),
    checks: "SV full paralysis is 1/4.",
  },
  {
    id: "V19c", title: "Nuzzle paralyses a slower foe before it moves", game: "sv",
    slots: slots(act(mon("Raichu", "Lightning Rod"), "Nuzzle", "opponent-right"), idle(venusaur), idle(blastoise), act(snorlax(), "Body Slam", "own-left")),
    checks: "Snorlax is paralysed by Nuzzle, then fully paralysed 1/4 of the time.",
  },
  // V20: Friend Guard.
  {
    id: "V20a", title: "Friend Guard partner", game: "champions",
    slots: slots(act(cChomp, "Earthquake"), idle(snorlax()), idle(mon("Vivillon", "Friend Guard")), idle(blastoise)),
    checks: "Blastoise's partner has Friend Guard: 54 → 40 at the lowest roll (probe 14a; Vivillon: Clefable has no Friend Guard in the Champions catalog).",
  },
  {
    id: "V20b", title: "The Friend Guard user's own spread move into its partner", game: "sv",
    slots: slots(act(mon("Clefairy", "Friend Guard"), "Misty Explosion"), idle(snorlax()), idle(venusaur), idle(blastoise)),
    checks: "The user's Friend Guard cuts its own hit on its partner (probe 14b; Clefairy Misty Explosion: Clefable does not learn Earthquake).",
  },
  {
    id: "V20c", title: "Mold Breaker passes Friend Guard", game: "champions",
    slots: slots(act(mon("Excadrill", "Mold Breaker"), "Earthquake"), idle(snorlax()), idle(mon("Vivillon", "Friend Guard")), idle(blastoise)),
    checks: "Friend Guard is breakable: Blastoise takes the full 0.75 hit.",
  },
  {
    id: "V21", title: "Life Orb Heat Wave: one Life Orb hit", game: "champions",
    slots: slots(act(with_(cZard, { item: "Life Orb" }), "Heat Wave"), idle(snorlax()), idle(venusaur), idle(cChomp)),
    checks: "Life Orb recoil once for a spread move (probe 15).",
  },
  // V22: Dragon Darts.
  {
    id: "V22a", title: "Dragon Darts: one dart each", game: "sv",
    slots: slots(act(mon("Dragapult", "Clear Body"), "Dragon Darts", "opponent-right"), idle(snorlax()), idle(mon("Salamence", "Moxie")), idle(mon("Garchomp", "Sand Veil"))),
    checks: "Smart targets: one dart into each foe (probe 9a).",
  },
  {
    id: "V22b", title: "Dragon Darts into a Protecting foe", game: "sv",
    slots: slots(act(mon("Dragapult", "Clear Body"), "Dragon Darts", "opponent-right"), idle(snorlax()), idle(mon("Salamence", "Moxie")), act(mon("Garchomp", "Sand Veil"), "Protect")),
    checks: "Both darts hit Salamence (probe 9b).",
  },
  {
    id: "V22c", title: "Dragon Darts with a Fairy foe", game: "sv",
    slots: slots(act(mon("Dragapult", "Clear Body"), "Dragon Darts", "opponent-right"), idle(snorlax()), idle(mon("Clefable", "Magic Guard")), idle(mon("Garchomp", "Sand Veil"))),
    checks: "Clefable is immune: both darts hit Garchomp.",
  },
  {
    id: "V22d", title: "Dragon Darts with Life Orb", game: "sv",
    slots: slots(act(mon("Dragapult", "Clear Body", { item: "Life Orb" }), "Dragon Darts", "opponent-right"), idle(snorlax()), idle(mon("Salamence", "Moxie")), idle(mon("Garchomp", "Sand Veil"))),
    checks: "Life Orb recoil once.",
  },
  {
    id: "V23", title: "A multi-hit attacker faints mid-move; a later move aimed at it retargets", game: "champions",
    slots: slots(act(mon("Aerodactyl", "Pressure", { hp: 50 }), "Rock Blast", "opponent-right"), idle(snorlax()), act(venusaur, "Energy Ball", "own-left"),
      idle(with_(cChomp, { ability: "Rough Skin", item: "Rocky Helmet" }))),
    checks: "Rough Skin + Rocky Helmet (44 a hit) KO Aerodactyl on hit 2; Venusaur's Energy Ball aimed at it goes to Snorlax.",
  },
  {
    id: "V24a", title: "Coupling: recoil, a spread hit on both, drain and a retarget", game: "sv",
    slots: slots(act(mon("Incineroar", "Blaze", { nature: "Jolly", evs: { spe: 252 } }), "Flare Blitz", "opponent-right"), idle(snorlax()),
      act(chomp0, "Earthquake"), act(mon("Conkeldurr", "Iron Fist"), "Drain Punch", "own-left")),
    checks: "Incineroar's recoil and Conkeldurr's drain tie their HP to the damage; Earthquake hits Incineroar, Snorlax and Conkeldurr; Drain Punch retargets to Snorlax if Incineroar fainted.",
  },
  {
    id: "V24b", title: "Shell Bell (single target)", game: "sv",
    slots: slots(act(with_(chomp, { item: "Shell Bell", hp: 100 }), "Dragon Claw", "opponent-right"), idle(zard), idle(venusaur), act(snorlax(), "Body Slam", "own-left")),
    checks: "Shell Bell heals 1/8 of the damage dealt before Snorlax's Body Slam.",
  },
  {
    id: "V25a", title: "Weakness Policy, then the holder attacks at +2", game: "sv",
    slots: slots(act(mon("Lucario", "Inner Focus"), "Aura Sphere", "opponent-right"), idle(zard0), idle(venusaur), act(snorlax({ item: "Weakness Policy" }), "Body Slam", "own-right")),
    checks: "Aura Sphere triggers Snorlax's Weakness Policy; its Body Slam into Charizard is at +2 Atk.",
  },
  {
    id: "V25b", title: "A resist Berry used by the first attack", game: "sv",
    slots: slots(act(zard, "Flamethrower", "opponent-right"), act(mon("Arcanine", "Justified"), "Flamethrower", "opponent-right"), idle(blastoise), idle(with_(venusaur, { item: "Occa Berry" }))),
    checks: "Occa halves the first Flamethrower; the second is full.",
  },
  {
    id: "V26", title: "Storm Drain ally takes Surf, then attacks at +1", game: "sv",
    slots: slots(act(mon("Gastrodon", "Storm Drain"), "Earth Power", "opponent-right"), act(blastoise, "Surf"), idle(venusaur), idle(chomp0)),
    checks: "Surf is absorbed by Gastrodon (+1 Sp. Atk); its Earth Power after is at +1 (SV: Gastrodon is not in the Champions catalog).",
  },
  // V27: power that depends on the turn.
  {
    id: "V27a", title: "Payback after the target moved", game: "sv",
    slots: slots(act(mon("Dusknoir", "Pressure"), "Payback", "opponent-right"), idle(snorlax()), idle(venusaur), act(chomp0, "Dragon Claw", "own-right")),
    checks: "Garchomp moves first: Payback doubles.",
  },
  {
    id: "V27b", title: "Analytic moving last", game: "sv",
    slots: slots(act(mon("Magnezone", "Analytic"), "Flash Cannon", "opponent-right"), idle(chomp), idle(mon("Weavile", "Pressure")), idle(zard)),
    checks: "Magnezone (80) acts after every other Pokémon: ×1.3.",
  },
  {
    id: "V27c", title: "Assurance into a target hurt this turn", game: "sv",
    slots: slots(act(chomp, "Dragon Claw", "opponent-right"), act(mon("Kingambit", "Defiant"), "Assurance", "opponent-right"), idle(venusaur), idle(snorlax())),
    checks: "Snorlax was hurt by Dragon Claw: Assurance doubles.",
  },
  {
    id: "V27d", title: "Avalanche after being hit by the target", game: "sv",
    slots: slots(act(mon("Mamoswine", "Thick Fat"), "Avalanche", "opponent-right"), idle(snorlax()), idle(venusaur), act(chomp0, "Dragon Claw", "own-left")),
    checks: "Garchomp hit Mamoswine first: Avalanche doubles.",
  },
  {
    id: "V27e", title: "Lash Out after Icy Wind", game: "sv",
    slots: slots(act(mon("Incineroar", "Blaze"), "Lash Out", "opponent-right"), idle(snorlax()), idle(venusaur), act(mon("Weavile", "Pressure"), "Icy Wind")),
    checks: "Icy Wind lowered Incineroar's Speed: Lash Out doubles.",
  },
  {
    id: "V27f", title: "Last Respects after the ally faints this turn", game: "sv",
    slots: slots(act(mon("Houndstone", "Fluffy"), "Last Respects", "opponent-right"), idle(snorlax({ hp: 1 })), idle(venusaur), act(chomp, "Dragon Claw", "own-right")),
    checks: "Snorlax faints first: Last Respects at 100 power.",
  },
  {
    id: "V27g", title: "Rage Fist after two hits", game: "sv",
    slots: slots(act(mon("Annihilape", "Inner Focus"), "Rage Fist", "opponent-right"), idle(snorlax()), act(mon("Weavile", "Pressure"), "Ice Shard", "own-left"), act(chomp0, "Dragon Claw", "own-left")),
    checks: "Hit twice before it moves: Rage Fist at 150 power.",
  },
  {
    id: "V28a", title: "Sword of Ruin from the field; the holder exempt", game: "sv",
    slots: slots(idle(mon("Chien-Pao", "Sword of Ruin")), act(chomp0, "Earthquake"), idle(venusaur), idle(blastoise)),
    checks: "Earthquake: the foes' Defense ×0.75; Chien-Pao's own is not lowered.",
  },
  {
    id: "V28b", title: "Sword of Ruin stops when its holder faints", game: "sv",
    slots: slots(idle(mon("Chien-Pao", "Sword of Ruin", { hp: 1 })), act(chomp0, "Earthquake"), idle(venusaur), act(mon("Dragapult", "Clear Body"), "Shadow Ball", "own-left")),
    checks: "Dragapult KOs Chien-Pao first: Earthquake without Sword of Ruin.",
  },
  {
    id: "V29a", title: "Explosion into the ally and both foes", game: "champions",
    slots: slots(act(mon("Glalie", "Inner Focus"), "Explosion"), idle(snorlax()), idle(venusaur), idle(cChomp)),
    checks: "The user faints; three targets at 0.75.",
  },
  {
    id: "V29b", title: "Damp stops Explosion", game: "champions",
    slots: slots(act(mon("Glalie", "Inner Focus"), "Explosion"), idle(snorlax()), idle(mon("Politoed", "Damp")), idle(cChomp)),
    checks: "Explosion fails; the user stays in.",
  },
  {
    id: "V30a", title: "Expanding Force spreads on Psychic Terrain", game: "champions", field: { terrain: "Psychic" },
    slots: slots(act(mon("Gardevoir", "Synchronize"), "Expanding Force", "opponent-right"), idle(snorlax()), idle(blastoise), idle(cChomp)),
    checks: "Both foes at ×1.5 power and 0.75.",
  },
  {
    id: "V30b", title: "Expanding Force with one foe", game: "champions", field: { terrain: "Psychic" },
    slots: slots(act(mon("Gardevoir", "Synchronize"), "Expanding Force", "opponent-right"), idle(snorlax()), empty(blastoise), idle(cChomp)),
    checks: "One foe: no 0.75.",
  },
  {
    id: "V31a", title: "Max Airstream raises both allies' Speed (re-sort)", game: "swsh",
    slots: slots(act(with_(zard, { choice: "dynamax" }), "Air Slash", "opponent-right"), act(chomp0, "Dragon Claw", "opponent-left"), act(mon("Weavile", "Pressure"), "Night Slash", "own-right"), idle(snorlax())),
    checks: "Garchomp +1 (183) moves before Weavile (145) after Max Airstream.",
  },
  {
    id: "V31b", title: "Max Strike lowers both foes' Speed", game: "swsh",
    slots: slots(act(with_(zard, { choice: "dynamax" }), "Body Slam", "opponent-right"), act(chomp0, "Dragon Claw", "opponent-left"), act(mon("Weavile", "Pressure"), "Night Slash", "own-right"), idle(snorlax())),
    checks: "Weavile -1 (97) moves after Garchomp (122).",
  },
  {
    id: "V32a", title: "A Z-Move into Protect at 1/4", game: "usum",
    slots: slots(act(with_(chomp, { item: "Dragonium Z", choice: "zmove" }), "Dragon Claw", "opponent-right"), idle(zard), idle(venusaur), act(snorlax(), "Protect")),
    checks: "Devastating Drake through Protect at 1/4.",
  },
  {
    id: "V32b", title: "Mega Evolution speed in gen 7", game: "usum",
    slots: slots(act(mon("Gengar", "Cursed Body", { item: "Gengarite", choice: "mega", appSpecies: "gengarmega", appBuild: { abilityId: "shadowtag" } }), "Shadow Ball", "opponent-right"),
      idle(snorlax()), idle(venusaur), act(mon("Weavile", "Pressure"), "Night Slash", "own-left")),
    checks: "Mega Gengar (150) moves before Weavile (145); Gengar (130) would not.",
  },
  {
    id: "V33", title: "Disguise broken by Fake Out, then a second attack", game: "champions",
    slots: slots(act(mon("Kangaskhan", "Scrappy"), "Fake Out", "opponent-right"), act(cZard, "Flamethrower", "opponent-right"), idle(venusaur), act(mon("Mimikyu", "Disguise"), "Shadow Claw", "own-right")),
    checks: "Scrappy Fake Out breaks Disguise (1/8 of its HP) and flinches Mimikyu; Flamethrower is not blocked.",
  },
  {
    id: "V34-champions", title: "Trick Room with Speed 2556 (Champions real format: no wrap)", game: "champions", format: "gen9championsvgc2026regmc",
    field: { trickRoom: true, own: { tailwind: true } },
    slots: slots(act(mon("Dragapult", "Clear Body", { item: "Choice Scarf", nature: "Jolly", evs: { spe: 32 }, hp: 1, boosts: { spe: 6 } }), "Dragon Claw", "opponent-right"),
      idle(cZard), idle(venusaur), act(snorlax(), "Crunch", "own-left")),
    checks: "Champions Trick Room is -speed with no 13-bit wrap (data/mods/champions/scripts.ts getActionSpeed): Snorlax first, Dragapult at 1 HP faints before moving.",
  },
  {
    id: "V34-sv", title: "Trick Room with Speed 3324 (SV real format: 13-bit wrap)", game: "sv", format: "gen9vgc2025regi",
    field: { trickRoom: true, own: { tailwind: true } },
    slots: slots(act(mon("Regieleki", "Transistor", { item: "Choice Scarf", nature: "Jolly", evs: { spe: 252 }, hp: 1, boosts: { spe: 6 } }), "Thunderbolt", "opponent-right"),
      idle(zard), idle(venusaur), act(snorlax(), "Body Slam", "own-left")),
    checks: "10000 - 3324 = 6676 against Snorlax's 9950 % 8192 = 1758 (sim/pokemon.ts:641-649): Regieleki moves first despite Trick Room.",
  },
  // V37+: more of SPEC §2.2 "In", one mechanic each.
  {
    id: "V37", title: "Telepathy against the partner's Earthquake", game: "champions",
    slots: slots(act(cChomp, "Earthquake"), idle(mon("Gardevoir", "Telepathy")), idle(venusaur), idle(blastoise)),
    checks: "Gardevoir takes nothing; it still counts for the 0.75 on both foes (probe 7b).",
  },
  {
    id: "V38", title: "Quick Guard blocks Fake Out", game: "champions",
    slots: slots(act(mon("Incineroar", "Blaze"), "Fake Out", "opponent-right"), idle(cZard), act(mon("Chesnaught", "Overgrow"), "Quick Guard"), act(cChomp, "Dragon Claw", "own-right")),
    checks: "Chesnaught (84) uses Quick Guard before Incineroar's Fake Out (80), both +3: no flinch, Garchomp attacks.",
  },
  {
    id: "V39", title: "Spiky Shield hurts a contact attacker", game: "sv",
    slots: slots(act(chomp, "Dragon Claw", "opponent-right"), idle(zard), idle(venusaur), act(mon("Chesnaught", "Overgrow"), "Spiky Shield")),
    checks: "Dragon Claw is blocked; Garchomp loses 1/8 of its HP.",
  },
  {
    id: "V40", title: "Stance Change: Blade Forme after attacking, then hit", game: "champions",
    slots: slots(idle(cZard), act(mon("Kingambit", "Defiant"), "Iron Head", "opponent-right"), idle(venusaur), act(mon("Aegislash", "Stance Change"), "Shadow Ball", "own-left")),
    checks: "Aegislash (80) attacks first and becomes Blade Forme; Kingambit's (70) Iron Head meets the Blade Forme's Defense.",
  },
  {
    id: "V41", title: "Volt Absorb takes the ally's Electric move", game: "champions",
    slots: slots(idle(mon("Jolteon", "Volt Absorb", { hp: 50 })), act(cZard, "Thunder Punch", "own-left"), idle(venusaur), idle(blastoise)),
    checks: "Thunder Punch into Jolteon heals it 1/4 (50 → 85).",
  },
  {
    id: "V42", title: "Grassy Glide's priority in Grassy Terrain", game: "sv", field: { terrain: "Grassy" },
    slots: slots(act(mon("Rillaboom", "Overgrow"), "Grassy Glide", "opponent-right"), idle(snorlax()), idle(venusaur), act(mon("Weavile", "Pressure"), "Night Slash", "own-left")),
    checks: "Grassy Glide +1 on Grassy Terrain: Rillaboom (105) before Weavile (145).",
  },
  {
    id: "V43", title: "Triage: +3 for a draining move", game: "sv",
    slots: slots(act(mon("Comfey", "Triage", { hp: 60 }), "Draining Kiss", "opponent-right"), idle(snorlax()), idle(venusaur), act(mon("Weavile", "Pressure"), "Ice Shard", "own-left")),
    checks: "Draining Kiss (+3) before Weavile's Ice Shard (+1); Comfey drains 3/4 first.",
  },
  {
    id: "V44", title: "Custap Berry at a quarter HP", game: "sv",
    slots: slots(act(snorlax({ item: "Custap Berry", hp: 50 }), "Body Slam", "opponent-right"), idle(venusaur), idle(zard), act(chomp, "Dragon Claw", "own-left")),
    checks: "Snorlax eats the Custap Berry as the moves are chosen and moves first in its bracket.",
  },
  {
    id: "V45", title: "Lagging Tail moves last in its bracket", game: "sv",
    slots: slots(act(mon("Weavile", "Pressure", { item: "Lagging Tail" }), "Night Slash", "opponent-right"), idle(venusaur), idle(zard), act(snorlax(), "Body Slam", "own-left")),
    checks: "Weavile (145) moves after Snorlax (51) and every pass.",
  },
  {
    id: "V46", title: "Stall moves last in its bracket", game: "sv",
    slots: slots(act(mon("Sableye", "Stall"), "Foul Play", "opponent-right"), idle(venusaur), idle(zard), act(snorlax(), "Crunch", "own-left")),
    checks: "Sableye (70) moves after Snorlax (51).",
  },
  {
    id: "V47a", title: "Upper Hand into a priority move", game: "sv",
    slots: slots(act(mon("Medicham", "Pure Power"), "Upper Hand", "opponent-right"), idle(snorlax()), idle(venusaur), act(mon("Azumarill", "Thick Fat"), "Aqua Jet", "own-left")),
    checks: "Azumarill chose Aqua Jet (+1): Upper Hand (+3) hits and flinches it.",
  },
  {
    id: "V47b", title: "Upper Hand into a 0-priority move fails", game: "sv",
    slots: slots(act(mon("Medicham", "Pure Power"), "Upper Hand", "opponent-right"), idle(snorlax()), idle(venusaur), act(mon("Weavile", "Pressure"), "Night Slash", "own-left")),
    checks: "Night Slash has priority 0: Upper Hand fails.",
  },
  {
    id: "V48", title: "Focus Punch fails after a damaging hit", game: "sv",
    slots: slots(act(mon("Conkeldurr", "Iron Fist"), "Focus Punch", "opponent-right"), idle(snorlax()), idle(venusaur), act(mon("Weavile", "Pressure"), "Night Slash", "own-left")),
    checks: "Weavile hits Conkeldurr first: Focus Punch fails.",
  },
  {
    id: "V49", title: "Eruption after being hit", game: "sv",
    slots: slots(act(mon("Typhlosion", "Blaze"), "Eruption"), idle(snorlax()), idle(venusaur), act(mon("Weavile", "Pressure"), "Night Slash", "own-left")),
    checks: "Eruption's power follows Typhlosion's HP after Night Slash.",
  },
  {
    id: "V50", title: "Electromorphosis charges the next Electric move", game: "sv",
    slots: slots(act(mon("Bellibolt", "Electromorphosis"), "Thunderbolt", "opponent-right"), idle(snorlax()), idle(venusaur), act(mon("Weavile", "Pressure"), "Night Slash", "own-left")),
    checks: "Hit by Night Slash first, Bellibolt's Thunderbolt doubles.",
  },
  {
    id: "V51", title: "Bolt Beak moving first", game: "swsh",
    slots: slots(act(mon("Dracozolt", "Volt Absorb"), "Bolt Beak", "opponent-right"), idle(venusaur), idle(zard), act(snorlax(), "Body Slam", "own-left")),
    checks: "Dracozolt (95) moves before Snorlax (51): Bolt Beak doubles.",
  },
  {
    id: "V52", title: "Unseen Fist through Protect", game: "sv",
    slots: slots(act(mon("Urshifu", "Unseen Fist"), "Wicked Blow", "opponent-right"), idle(venusaur), idle(zard), act(snorlax(), "Protect")),
    checks: "Wicked Blow makes contact: Protect does not stop it; it is always critical.",
  },
  {
    id: "V53", title: "Ice Face broken by the first physical hit", game: "sv",
    slots: slots(act(chomp, "Dragon Claw", "opponent-right"), act(mon("Weavile", "Pressure"), "Night Slash", "opponent-right"), idle(venusaur), idle(mon("Eiscue", "Ice Face"))),
    checks: "Ice Face takes Dragon Claw; Night Slash hits Eiscue-Noice in full.",
  },
  {
    id: "V54", title: "Wind Power charges after a wind move", game: "sv",
    slots: slots(act(mon("Kilowattrel", "Wind Power"), "Thunderbolt", "opponent-right"), idle(snorlax()), idle(venusaur), act(mon("Weavile", "Pressure", { nature: "Jolly", evs: { spe: 252 } }), "Icy Wind")),
    checks: "Icy Wind (wind) charges Kilowattrel: its Thunderbolt doubles.",
  },
  {
    id: "V55", title: "Sturdy at full HP, then a second hit", game: "champions",
    slots: slots(act(mon("Lucario", "Inner Focus"), "Aura Sphere", "opponent-right"), act(cChomp, "Earthquake"), idle(venusaur), idle(mon("Aggron", "Sturdy"))),
    checks: "Earthquake (Garchomp 122 first) leaves Aggron at 1 at most; Aura Sphere finishes it.",
  },
  {
    id: "V56", title: "Super Fang after the target was hit", game: "sv",
    slots: slots(act(chomp, "Dragon Claw", "opponent-right"), act(mon("Granbull", "Quick Feet"), "Super Fang", "opponent-right"), idle(venusaur), idle(snorlax())),
    checks: "Super Fang halves Snorlax's HP after Dragon Claw (sim data/moves.ts superfang damageCallback: target.getUndynamaxedHP() / 2).",
  },
  // V35/V36: not estimated (the reason text; no Showdown run).
  {
    id: "V36a", title: "A modelled status move last", game: "champions",
    slots: slots(act(cZard, "Flamethrower", "opponent-right"), idle(cChomp), act(mon("Alakazam", "Inner Focus"), "Trick Room"), idle(blastoise)),
    checks: "Trick Room (-7) is set after every other action: the turn is estimated and the moves keep their Speed order.",
  },
  {
    id: "V36e", title: "Protect blocks a single-target move", game: "champions",
    slots: slots(act(cZard, "Flamethrower", "opponent-right"), idle(cChomp), idle(venusaur), act(snorlax(), "Protect")),
    checks: "Protect (+4) goes first and blocks Flamethrower.",
  },
  {
    id: "V36f", title: "No move keeps the last Protect working", game: "champions",
    slots: slots(act(cZard, "Protect"), idle(cChomp), act(venusaur, "Protect"), act(blastoise, "Protect")),
    checks: "Garchomp's No move is still queued (priority 0), so Blastoise's Protect, the last of the three, still has an action after it (SPEC C13).",
  },
  {
    id: "V36g", title: "The last Protect of the turn fails", game: "champions",
    slots: slots(act(cZard, "Protect"), act(cChomp, "Protect"), act(venusaur, "Protect"), act(blastoise, "Protect")),
    checks: "Four Protects: the slowest (Blastoise, 98) has no action left after it and fails (data/moves.ts protect onPrepareHit queue.willAct()).",
  },
  {
    id: "V36b", title: "An unmodelled status move last is harmless", game: "champions",
    slots: slots(act(cZard, "Flamethrower", "opponent-right"), idle(mon("Weavile", "Pressure")), idle(venusaur), act(mon("Kingambit", "Defiant"), "Taunt", "own-left")),
    checks: "Taunt is the last action (Kingambit 70 is the slowest... after every pass): no later move, so the turn is estimated.",
  },
  {
    id: "V36c", title: "An unmodelled status move before another move", game: "champions",
    slots: slots(act(mon("Weavile", "Pressure"), "Taunt", "opponent-right"), act(cZard, "Flamethrower", "opponent-right"), idle(venusaur), idle(blastoise)),
    checks: "Taunt comes before Flamethrower.", notEstimated: "Taunt is not modelled and comes before another move.",
  },
  {
    id: "V36d", title: "An HP-changing status move anywhere", game: "champions",
    slots: slots(act(cZard, "Flamethrower", "opponent-right"), idle(cChomp), idle(venusaur), act(mon("Dragonite", "Multiscale"), "Roost")),
    checks: "Roost changes HP.", notEstimated: "Roost is not modelled.",
  },
];

// ------------------------------------------------------------------------------------------------------------------
// Round 2 (validation builder): the user's case, two Pokémon doubling into one foe slot, in every game (C01-C10), then
// one case or more per mechanic the engine models without a simulator case (round1/mech-status.md, M01-M27).
// ------------------------------------------------------------------------------------------------------------------

type Game = Case["game"];
/** Full training: 252 EVs in the native games, 32 Stat Points in Champions (the same stat at level 50). */
const full = (game: Game) => (game === "champions" ? 32 : 252);
const speedy = (game: Game, species: string, ability: string, stat: "atk" | "spa", extra: Partial<CaseMon> = {}) =>
  mon(species, ability, { nature: stat === "atk" ? "Jolly" : "Timid", evs: { [stat]: full(game), spe: full(game) }, ...extra });
/** 4 Speed EVs (1 Stat Point in Champions) keep a Pokémon off a 0-EV one of the same base Speed. */
const nudge = (game: Game) => (game === "champions" ? 1 : 4);

function coreCases(game: Game): Case[] {
  const g = game.toUpperCase();
  const chompJ = speedy(game, "Garchomp", "Rough Skin", "atk");
  const zardT = speedy(game, "Charizard", "Blaze", "spa");
  const weavJ = speedy(game, "Weavile", "Pressure", "atk");
  const lax = (extra: Partial<CaseMon> = {}) => mon("Snorlax", "Thick Fat", { evs: { spe: nudge(game) }, ...extra });
  const saur = mon("Venusaur", "Overgrow", { evs: { spe: nudge(game) } });
  const toise = mon("Blastoise", "Torrent");
  const nite = mon("Dragonite", "Multiscale");
  return [
    {
      id: `C01-${g}`, title: `Sitrus Berry between two attacks into one slot (${game})`, game,
      slots: slots(act(chompJ, "Dragon Claw", "opponent-left"), act(zardT, "Flamethrower", "opponent-left"),
        idle(lax({ item: "Sitrus Berry", hp: 200 })), act(toise, "Ice Beam", "own-left")),
      checks: "Snorlax at 200: Dragon Claw takes it under half, Sitrus at the Update after it, then Flamethrower (Thick Fat); Ice Beam into Garchomp.",
    },
    {
      id: `C02-${g}`, title: `Focus Sash broken by the first attack, KO by the second (${game})`, game,
      slots: slots(act(weavJ, "Night Slash", "opponent-left"), act(mon("Garchomp", "Rough Skin"), "Dragon Claw", "opponent-left"),
        act(mon("Gengar", "Cursed Body", { item: "Focus Sash" }), "Shadow Ball", "own-right"), idle(toise)),
      checks: "Weavile's Night Slash would OHKO Gengar: Sash leaves 1; Gengar's Shadow Ball, then Garchomp's Dragon Claw KOs it.",
    },
    {
      id: `C03-${g}`, title: `Multiscale halves only the first of two attacks (${game})`, game,
      slots: slots(act(chompJ, "Iron Head", "opponent-left"), act(weavJ, "Ice Shard", "opponent-left"), idle(nite), idle(lax())),
      checks: "Ice Shard (+1) first, halved by Multiscale; Iron Head full.",
    },
    {
      id: `C04-${g}`, title: `A resist Berry eaten by the first of two attacks of its type (${game})`, game,
      slots: slots(act(weavJ, "Ice Shard", "opponent-left"), act(mon("Mamoswine", "Oblivious"), "Ice Shard", "opponent-left"),
        act(with_(saur, { item: "Yache Berry" }), "Sludge Bomb", "own-right"), idle(toise)),
      checks: "Weavile's Ice Shard is halved by Venusaur's Yache Berry; Mamoswine's is not; Venusaur's Sludge Bomb into Mamoswine.",
    },
    {
      id: `C05-${g}`, title: `Intimidate applied before two attacks into one slot (${game})`, game,
      slots: slots(act(with_(chompJ, { boosts: { atk: -1 } }), "Dragon Claw", "opponent-left"), act(mon("Metagross", "Clear Body"), "Iron Head", "opponent-left"),
        act(toise, "Ice Beam", "own-left"), idle(mon("Incineroar", "Intimidate"))),
      checks: "Incineroar's Intimidate leaves Garchomp at -1 Atk; Metagross's Clear Body keeps it at 0.",
    },
    {
      id: `C06-${g}`, title: `A speed tie between the two attackers into Multiscale (${game})`, game,
      slots: slots(act(chompJ, "Dragon Claw", "opponent-left"), act(chompJ, "Iron Head", "opponent-left"), idle(nite), idle(lax())),
      checks: "Both Garchomp at the same Speed: each goes first half the time, and Multiscale halves whichever does.",
    },
    {
      id: `C07-${g}`, title: `Trick Room: the slower attacker breaks Multiscale (${game})`, game, field: { trickRoom: true },
      slots: slots(act(lax(), "Body Slam", "opponent-left"), act(chompJ, "Iron Head", "opponent-left"), idle(nite), idle(saur)),
      checks: "Snorlax first under Trick Room: Body Slam halved, Iron Head full.",
    },
    {
      id: `C08-${g}`, title: `Tailwind: both attackers before the target moves (${game})`, game, field: { own: { tailwind: true } },
      slots: slots(act(lax(), "Body Slam", "opponent-left"), act(chompJ, "Dragon Claw", "opponent-left"),
        act(mon("Blastoise", "Torrent", { hp: 140 }), "Water Pulse", "own-left"), idle(saur)),
      checks: "Snorlax doubled past Blastoise (98): Blastoise at 140 may faint before its Water Pulse.",
    },
    {
      id: `C09-${g}`, title: `Helping Hand on the target, which hits back (${game})`, game,
      slots: slots(act(mon("Garchomp", "Rough Skin"), "Dragon Claw", "opponent-left"), act(zardT, "Air Slash", "opponent-left"),
        act(toise, "Ice Beam", "own-left"), act(mon("Clefable", "Magic Guard"), "Helping Hand")),
      checks: "Helping Hand (+5) first; Charizard and Garchomp into Blastoise; Blastoise's Ice Beam at 1.5x into Garchomp.",
    },
    {
      id: `C10-${g}`, title: `A spread move and a single-target move into one slot (${game})`, game,
      slots: slots(act(chompJ, "Rock Slide"), act(zardT, "Dragon Pulse", "opponent-left"),
        act(with_(saur, { item: "Sitrus Berry" }), "Sludge Bomb", "own-left"), idle(mon("Salamence", "Moxie"))),
      checks: "Rock Slide at 0.75 into both foes, then Dragon Pulse into Venusaur; its Sitrus Berry at the Update after the hit that takes it under half.",
    },
  ];
}
for (const game of ["sv", "swsh", "usum", "champions"] as const) CASES.push(...coreCases(game));

const svChompJ = speedy("sv", "Garchomp", "Rough Skin", "atk");
const svZardT = speedy("sv", "Charizard", "Blaze", "spa");
const svWeavJ = speedy("sv", "Weavile", "Pressure", "atk");
const lax4 = (extra: Partial<CaseMon> = {}) => snorlax(extra);
CASES.push(
  // Targets.
  {
    id: "M01a", title: "Outrage picks a random foe", game: "sv",
    slots: slots(act(svChompJ, "Outrage"), idle(lax4()), idle(venusaur), idle(blastoise)),
    checks: "randomNormal (sim/battle.ts getRandomTarget: sample(adjacentFoes())): each foe half the time.",
  },
  {
    id: "M01b", title: "Outrage into Rage Powder", game: "sv",
    slots: slots(act(svChompJ, "Outrage"), idle(lax4()), idle(venusaur), act(mon("Amoonguss", "Regenerator"), "Rage Powder")),
    checks: "Rage Powder takes the random target (validTarget for randomNormal: adjacent).",
  },
  {
    id: "M01c", title: "Outrage after the partner KOs one foe", game: "sv",
    slots: slots(act(svChompJ, "Outrage"), act(svWeavJ, "Ice Shard", "opponent-left"), idle(with_(venusaur, { hp: 1 })), idle(blastoise)),
    checks: "Ice Shard KOs Venusaur first; Outrage's random foe is Blastoise.",
  },
  {
    id: "M01d", title: "Outrage with one foe protecting (Champions)", game: "champions",
    slots: slots(act(speedy("champions", "Garchomp", "Rough Skin", "atk"), "Outrage"), idle(mon("Snorlax", "Thick Fat", { evs: { spe: 1 } })), act(blastoise, "Protect"), idle(venusaur)),
    checks: "Half the time Outrage picks the protecting Blastoise and is blocked.",
  },
  {
    id: "M02a", title: "Stalwart ignores Follow Me", game: "sv",
    slots: slots(act(mon("Duraludon", "Stalwart"), "Flash Cannon", "opponent-left"), idle(lax4()), idle(venusaur), act(mon("Clefable", "Magic Guard"), "Follow Me")),
    checks: "Stalwart's tracksTarget (data/abilities.ts stalwart; sim/pokemon.ts getMoveTargets skips RedirectTarget): Flash Cannon stays on Venusaur.",
  },
  {
    id: "M02b", title: "Stalwart ignores Rage Powder", game: "swsh",
    slots: slots(act(mon("Duraludon", "Stalwart"), "Dragon Pulse", "opponent-left"), idle(lax4()), idle(venusaur), act(mon("Amoonguss", "Regenerator"), "Rage Powder")),
    checks: "Dragon Pulse stays on Venusaur.",
  },
  {
    id: "M03", title: "Propeller Tail ignores Storm Drain", game: "sv",
    slots: slots(act(mon("Barraskewda", "Propeller Tail"), "Liquidation", "opponent-left"), idle(lax4()), idle(svZardT), idle(mon("Gastrodon", "Storm Drain"))),
    checks: "Liquidation stays on Charizard: no Storm Drain redirection or absorption.",
  },
  {
    id: "M04a", title: "Snipe Shot ignores Follow Me", game: "sv",
    slots: slots(act(mon("Inteleon", "Torrent"), "Snipe Shot", "opponent-left"), idle(lax4()), idle(venusaur), act(mon("Clefable", "Magic Guard"), "Follow Me")),
    checks: "Snipe Shot's own tracksTarget: it stays on Venusaur.",
  },
  {
    id: "M04b", title: "Snipe Shot ignores Follow Me (Champions)", game: "champions",
    slots: slots(act(mon("Inteleon", "Torrent"), "Snipe Shot", "opponent-left"), idle(mon("Snorlax", "Thick Fat", { evs: { spe: 1 } })), idle(venusaur), act(mon("Clefable", "Magic Guard"), "Follow Me")),
    checks: "As M04a in Champions.",
  },
  {
    id: "M04c", title: "Snipe Shot ignores Storm Drain", game: "sv",
    slots: slots(act(mon("Inteleon", "Torrent"), "Snipe Shot", "opponent-left"), idle(lax4()), idle(svZardT), idle(mon("Gastrodon", "Storm Drain"))),
    checks: "Snipe Shot stays on Charizard.",
  },
  {
    id: "M05a", title: "Tera Starstorm hits both foes from Terapagos-Stellar", game: "sv",
    slots: slots(act(mon("Terapagos", "Tera Shift", { teraType: "Stellar", choice: "terastallize" }), "Tera Starstorm", "opponent-left"), idle(lax4()), idle(venusaur), idle(blastoise)),
    checks: "terastarstorm onModifyMove: allAdjacentFoes for Terapagos-Stellar, at 0.75 into each foe.",
  },
  {
    id: "M05b", title: "Tera Starstorm from Terapagos-Terastal is single-target", game: "sv",
    slots: slots(act(mon("Terapagos", "Tera Shift"), "Tera Starstorm", "opponent-left"), idle(lax4()), idle(venusaur), idle(blastoise)),
    checks: "Not Terastallized: one target, Normal type.",
  },
  // Blocks.
  {
    id: "M06", title: "Baneful Bunker poisons a contact attacker; Venoshock doubles", game: "sv",
    slots: slots(act(svChompJ, "Dragon Claw", "opponent-left"), act(svZardT, "Flamethrower", "opponent-left"),
      act(mon("Toxapex", "Regenerator"), "Baneful Bunker"), act(mon("Gengar", "Cursed Body"), "Venoshock", "own-left")),
    checks: "Dragon Claw is blocked and Garchomp poisoned (contact); Flamethrower is blocked; Gengar's Venoshock into the poisoned Garchomp at 130.",
  },
  {
    id: "M07", title: "Obstruct lowers a contact attacker's Defense by 2", game: "swsh",
    slots: slots(act(speedy("swsh", "Garchomp", "Rough Skin", "atk"), "Dragon Claw", "opponent-left"), act(speedy("swsh", "Charizard", "Blaze", "spa"), "Air Slash", "opponent-left"),
      act(mon("Obstagoon", "Guts"), "Obstruct"), act(lax4(), "Body Slam", "own-left")),
    checks: "Garchomp at -2 Def takes Snorlax's Body Slam.",
  },
  {
    id: "M08", title: "Silk Trap lowers a contact attacker's Speed; Gyro Ball reads it", game: "sv",
    slots: slots(act(svChompJ, "Dragon Claw", "opponent-left"), act(svZardT, "Flamethrower", "opponent-left"),
      act(mon("Spidops", "Insomnia"), "Silk Trap"), act(mon("Bronzong", "Levitate"), "Gyro Ball", "own-left")),
    checks: "Garchomp at -1 Speed: Gyro Ball's power 25 x its Speed / Bronzong's falls.",
  },
  {
    id: "M09", title: "Burning Bulwark burns both contact attackers; Hex doubles", game: "sv",
    slots: slots(act(svChompJ, "Dragon Claw", "opponent-left"), act(svWeavJ, "Night Slash", "opponent-left"),
      act(mon("Gouging Fire", "Protosynthesis"), "Burning Bulwark"), act(mon("Gengar", "Cursed Body"), "Hex", "own-left")),
    checks: "Both contact moves are blocked and burn their users; Hex into the burned Garchomp at 130.",
  },
  {
    id: "M10a", title: "Piercing Drill: a contact move through Protect at 1/4", game: "champions",
    slots: slots(act(mon("Excadrill", "Sand Force", { item: "Excadrite", choice: "mega", appSpecies: "excadrillmega", appBuild: { abilityId: "piercingdrill" } }), "Iron Head", "opponent-left"),
      act(cChomp, "Dragon Claw", "opponent-left"), act(snorlax({ evs: { spe: 1 } }), "Protect"), idle(venusaur)),
    checks: "Mega Excadrill's Iron Head gets through Snorlax's Protect at 1/4 (data/abilities.ts piercingdrill onHitProtect); Garchomp's Dragon Claw is blocked.",
  },
  {
    id: "M10b", title: "Piercing Drill does not pass Protect with Earthquake", game: "champions",
    slots: slots(act(mon("Excadrill", "Sand Force", { item: "Excadrite", choice: "mega", appSpecies: "excadrillmega", appBuild: { abilityId: "piercingdrill" } }), "Earthquake"),
      idle(cZard), act(snorlax({ evs: { spe: 1 } }), "Protect"), idle(venusaur)),
    checks: "Earthquake makes no contact: Snorlax is protected; Venusaur takes 0.75; Charizard is immune.",
  },
  {
    id: "M11a", title: "Thunderclap into an attacker breaks Multiscale first", game: "sv",
    slots: slots(act(mon("Raging Bolt", "Protosynthesis"), "Thunderclap", "opponent-left"), act(svZardT, "Air Slash", "opponent-left"),
      act(mon("Dragonite", "Multiscale"), "Dragon Claw", "own-left"), idle(lax4())),
    checks: "Thunderclap (+1) hits Dragonite, which has an attack queued: halved by Multiscale; Air Slash full.",
  },
  {
    id: "M11b", title: "Thunderclap into a status move fails", game: "sv",
    slots: slots(act(mon("Raging Bolt", "Protosynthesis"), "Thunderclap", "opponent-left"), idle(svWeavJ),
      act(mon("Dragonite", "Multiscale"), "Dragon Dance"), idle(mon("Gengar", "Cursed Body"))),
    checks: "Dragon Dance is a status move: Thunderclap fails (onTry); Dragon Dance is the last action.",
  },
  // Damage inputs.
  {
    id: "M12a", title: "Plus and Minus partners both at 1.5x Sp. Atk", game: "sv",
    slots: slots(act(mon("Toxtricity", "Plus", { nature: "Timid", evs: { spa: 252, spe: 252 } }), "Overdrive"),
      act(mon("Toxtricity-Low-Key", "Minus", { nature: "Modest", evs: { spa: 252 } }), "Thunderbolt", "opponent-left"), idle(venusaur), idle(blastoise)),
    checks: "Overdrive (both foes, 0.75) and Thunderbolt into Blastoise, each at 1.5x Sp. Atk (data/abilities.ts plus, minus).",
  },
  {
    id: "M12b", title: "Plus after its Minus partner faints", game: "sv",
    slots: slots(act(mon("Toxtricity", "Plus", { nature: "Timid", evs: { spa: 252, spe: 252 } }), "Overdrive"),
      idle(mon("Toxtricity-Low-Key", "Minus", { hp: 1 })), act(svWeavJ, "Ice Shard", "own-right"), idle(blastoise)),
    checks: "Ice Shard KOs the Minus partner first: Overdrive without the boost.",
  },
  {
    id: "M12c", title: "Plusle and Minun (USUM)", game: "usum",
    slots: slots(act(mon("Plusle", "Plus", { nature: "Timid", evs: { spa: 252, spe: 252 } }), "Thunderbolt", "opponent-left"),
      act(mon("Minun", "Minus"), "Thunderbolt", "opponent-left"), idle(snorlax()), idle(venusaur)),
    checks: "Both Thunderbolts into Snorlax at 1.5x Sp. Atk.",
  },
  {
    id: "M13a", title: "Fairy Aura boosts both Fairy moves into one slot", game: "usum",
    slots: slots(act(mon("Xerneas", "Fairy Aura"), "Moonblast", "opponent-left"), act(mon("Clefable", "Magic Guard"), "Moonblast", "opponent-left"),
      idle(snorlax()), idle(mon("Garchomp", "Rough Skin"))),
    checks: "Fairy Aura (onAnyBasePower 5448/4096) on both Moonblasts into Snorlax.",
  },
  {
    id: "M13b", title: "Aura Break reverses Dark Aura", game: "usum",
    slots: slots(idle(mon("Zygarde", "Aura Break")), act(mon("Clefable", "Magic Guard"), "Moonblast", "opponent-left"),
      idle(mon("Garchomp", "Rough Skin")), act(mon("Yveltal", "Dark Aura"), "Dark Pulse", "own-right")),
    checks: "Dark Pulse into Clefable at 3072/4096 (Aura Break); Moonblast plain.",
  },
  {
    id: "M13c", title: "Fairy Aura ends when its holder faints", game: "swsh",
    slots: slots(idle(mon("Xerneas", "Fairy Aura", { hp: 1 })), act(mon("Clefable", "Magic Guard"), "Moonblast", "opponent-left"),
      idle(mon("Garchomp", "Rough Skin")), act(speedy("swsh", "Weavile", "Pressure", "atk"), "Ice Shard", "own-left")),
    checks: "Ice Shard KOs Xerneas first: Moonblast without Fairy Aura.",
  },
  {
    id: "M14a", title: "Cloud Nine in rain (USUM)", game: "usum", field: { weather: "Rain" },
    slots: slots(idle(mon("Golduck", "Cloud Nine")), act(blastoise, "Water Pulse", "opponent-left"),
      act(speedy("usum", "Charizard", "Blaze", "spa"), "Flamethrower", "own-right"), idle(snorlax())),
    checks: "No rain boost on Water Pulse, no rain cut on Flamethrower.",
  },
  {
    id: "M14b", title: "Cloud Nine's holder faints: the rain works again", game: "sv", field: { weather: "Rain" },
    slots: slots(idle(mon("Golduck", "Cloud Nine", { hp: 1 })), act(blastoise, "Water Pulse", "opponent-left"),
      act(mon("Charizard", "Blaze"), "Flamethrower", "own-right"), act(svWeavJ, "Ice Shard", "own-left")),
    checks: "Ice Shard KOs Golduck: Charizard's Flamethrower (120) and Water Pulse (98) are in rain.",
  },
  {
    id: "M14c", title: "Air Lock in sun", game: "swsh", field: { weather: "Sun" },
    slots: slots(idle(mon("Rayquaza", "Air Lock")), act(speedy("swsh", "Charizard", "Blaze", "spa"), "Flamethrower", "opponent-left"),
      idle(mon("Venusaur", "Chlorophyll", { evs: { spe: 4 } })), act(blastoise, "Water Pulse", "own-right")),
    checks: "No sun: Flamethrower plain, Water Pulse plain, Chlorophyll off.",
  },
  {
    id: "M15a", title: "Shadow Shield halves the first hit, Mold Breaker or not", game: "usum",
    slots: slots(act(mon("Haxorus", "Mold Breaker", { nature: "Jolly", evs: { atk: 252, spe: 252 } }), "Dragon Claw", "opponent-left"),
      act(mon("Weavile", "Pressure"), "Night Slash", "opponent-left"), idle(mon("Lunala", "Shadow Shield")), idle(snorlax())),
    checks: "Shadow Shield is not breakable: Dragon Claw halved; Night Slash full.",
  },
  {
    id: "M15b", title: "Shadow Shield against a spread move then a single hit", game: "sv",
    slots: slots(act(svChompJ, "Rock Slide"), act(mon("Weavile", "Pressure"), "Night Slash", "opponent-left"), idle(mon("Lunala", "Shadow Shield")), idle(blastoise)),
    checks: "Rock Slide halved on Lunala; Night Slash full.",
  },
  {
    id: "M16a", title: "Tera Shell resists the first of two hits", game: "sv",
    slots: slots(act(svChompJ, "Dragon Claw", "opponent-left"), act(mon("Lucario", "Inner Focus", { nature: "Jolly", evs: { atk: 252, spe: 252 } }), "Close Combat", "opponent-left"),
      idle(mon("Terapagos", "Tera Shift")), idle(blastoise)),
    checks: "Terapagos-Terastal at full HP: Dragon Claw not very effective (data/abilities.ts terashell); Close Combat super effective.",
  },
  {
    id: "M16b", title: "Tera Shell against a spread move then a single hit", game: "sv",
    slots: slots(act(svChompJ, "Rock Slide"), act(mon("Lucario", "Inner Focus", { nature: "Jolly", evs: { atk: 252, spe: 252 } }), "Close Combat", "opponent-left"),
      idle(mon("Terapagos", "Tera Shift")), idle(blastoise)),
    checks: "Rock Slide resisted on Terapagos only; Close Combat super effective.",
  },
  // Order.
  {
    id: "M17", title: "Mycelium Might: a status move after a slower Earthquake", game: "sv",
    slots: slots(act(mon("Toedscruel", "Mycelium Might"), "Grassy Terrain"), idle(mon("Weavile", "Pressure")), act(lax4(), "Earthquake"), idle(venusaur)),
    checks: "Grassy Terrain (-0.1) after Snorlax's Earthquake: Earthquake not halved.",
  },
  {
    id: "M18a", title: "Full Incense moves last in its bracket", game: "swsh",
    slots: slots(act(mon("Weavile", "Pressure", { item: "Full Incense" }), "Night Slash", "opponent-left"), idle(venusaur), act(lax4(), "Body Slam", "own-left"), idle(blastoise)),
    checks: "Weavile (145) after Snorlax (51).",
  },
  {
    id: "M18b", title: "Full Incense moves last in its bracket (USUM)", game: "usum",
    slots: slots(act(mon("Weavile", "Pressure", { item: "Full Incense" }), "Night Slash", "opponent-left"), idle(venusaur), act(lax4(), "Body Slam", "own-left"), idle(blastoise)),
    checks: "As M18a in generation 7.",
  },
  // Reactions and power.
  {
    id: "M19", title: "Chilling Neigh after a KO; Foul Play reads it", game: "swsh", field: { trickRoom: true },
    slots: slots(act(mon("Glastrier", "Chilling Neigh"), "Icicle Crash", "opponent-left"), idle(lax4()),
      idle(with_(venusaur, { hp: 1 })), act(mon("Sableye", "Keen Eye"), "Foul Play", "own-left")),
    checks: "Glastrier (50) first under Trick Room KOs Venusaur: +1 Atk, which Sableye's Foul Play reads.",
  },
  {
    id: "M20", title: "Grim Neigh after a KO", game: "swsh",
    slots: slots(act(mon("Spectrier", "Grim Neigh"), "Shadow Ball", "opponent-left"), act(mon("Gengar", "Cursed Body"), "Shadow Ball", "opponent-right"),
      idle(with_(venusaur, { hp: 1 })), idle(lax4())),
    checks: "Spectrier KOs Venusaur (+1 Sp. Atk); Gengar's Shadow Ball into Snorlax is not affected.",
  },
  {
    id: "M21a", title: "As One (Glastrier): spread KO and a foe's Sitrus Berry stopped", game: "swsh", field: { trickRoom: true },
    slots: slots(act(mon("Calyrex-Ice", "As One (Glastrier)", { nature: "Quiet" }), "Glacial Lance"), idle(lax4()),
      idle(with_(venusaur, { hp: 1 })), act(mon("Sableye", "Keen Eye", { item: "Sitrus Berry" }), "Foul Play", "own-left")),
    checks: "Glacial Lance KOs Venusaur (+1 Atk) and takes Sableye under half: As One stops its Sitrus Berry; Foul Play reads +1.",
  },
  {
    id: "M21b", title: "A third Pokémon's As One (Spectrier) stops the target's Sitrus Berry", game: "sv",
    slots: slots(idle(mon("Calyrex-Shadow", "As One (Spectrier)")), act(svChompJ, "Dragon Claw", "opponent-left"),
      idle(snorlax({ item: "Sitrus Berry", hp: 200 })), idle(blastoise)),
    checks: "Calyrex-Shadow is Snorlax's foe: no Sitrus Berry after Dragon Claw.",
  },
  {
    id: "M22a", title: "Revenge doubles after the target hit its user", game: "swsh",
    slots: slots(act(mon("Conkeldurr", "Iron Fist"), "Revenge", "opponent-left"), act(speedy("swsh", "Garchomp", "Rough Skin", "atk"), "Dragon Claw", "opponent-left"),
      act(speedy("swsh", "Weavile", "Pressure", "atk"), "Night Slash", "own-left"), idle(lax4())),
    checks: "Weavile hits Conkeldurr first; Revenge (-4) into Weavile at 120.",
  },
  {
    id: "M22b", title: "Revenge after the other foe hit its user (USUM)", game: "usum",
    slots: slots(act(mon("Hariyama", "Thick Fat"), "Revenge", "opponent-left"), idle(speedy("usum", "Garchomp", "Rough Skin", "atk")),
      idle(venusaur), act(speedy("usum", "Weavile", "Pressure", "atk"), "Night Slash", "own-left")),
    checks: "Weavile (the other foe) hit Hariyama: Revenge into Venusaur is not doubled.",
  },
  {
    id: "M23a", title: "Fishious Rend before its target moves", game: "swsh",
    slots: slots(act(mon("Dracovish", "Strong Jaw"), "Fishious Rend", "opponent-left"), idle(venusaur), act(lax4(), "Body Slam", "own-left"), idle(blastoise)),
    checks: "Dracovish (95) before Snorlax (51): Fishious Rend doubles.",
  },
  {
    id: "M23b", title: "Fishious Rend after its target moved", game: "swsh",
    slots: slots(act(mon("Dracovish", "Strong Jaw"), "Fishious Rend", "opponent-left"), idle(venusaur), act(mon("Weavile", "Pressure"), "Night Slash", "own-right"), idle(blastoise)),
    checks: "Weavile (145) moves first: Fishious Rend is not doubled.",
  },
  // Field.
  {
    id: "M24a", title: "Max Flare sets sun: Chlorophyll re-sort, Fire up, Water down", game: "swsh",
    slots: slots(act(with_(speedy("swsh", "Charizard", "Blaze", "spa"), { choice: "dynamax" }), "Flamethrower", "opponent-right"), act(mon("Arcanine", "Justified"), "Flamethrower", "opponent-right"),
      act(mon("Venusaur", "Chlorophyll", { evs: { spe: 4 } }), "Sludge Bomb", "own-right"), act(blastoise, "Water Pulse", "own-right")),
    checks: "After Max Flare, Venusaur (202) moves before Arcanine (115); Arcanine's Flamethrower at 1.5x, Blastoise's Water Pulse at 0.5x.",
  },
  {
    id: "M24b", title: "Max Geyser sets rain: a later Fire move halved", game: "swsh",
    slots: slots(act(mon("Barraskewda", "Propeller Tail", { nature: "Jolly", evs: { atk: 252, spe: 252 }, choice: "dynamax" }), "Liquidation", "opponent-left"),
      act(mon("Arcanine", "Justified"), "Flamethrower", "opponent-right"), act(speedy("swsh", "Charizard", "Blaze", "spa"), "Air Slash", "own-left"), idle(venusaur)),
    checks: "Charizard (167) first; Max Geyser's rain halves Arcanine's Flamethrower into Venusaur.",
  },
  {
    id: "M24c", title: "Max Overgrowth sets Grassy Terrain: a later Earthquake halved", game: "swsh",
    slots: slots(act(mon("Venusaur", "Overgrow", { nature: "Timid", evs: { spa: 252, spe: 252 }, choice: "dynamax" }), "Energy Ball", "opponent-left"), idle(lax4()),
      idle(blastoise), act(mon("Garchomp", "Rough Skin"), "Earthquake")),
    checks: "Venusaur (145) first; Garchomp's Earthquake into Venusaur, Snorlax and Blastoise at 0.5 (grounded).",
  },
  {
    id: "M24d", title: "Max Lightning sets Electric Terrain: a later Electric move up", game: "swsh",
    slots: slots(act(mon("Jolteon", "Volt Absorb", { choice: "dynamax" }), "Thunderbolt", "opponent-left"), act(mon("Toxtricity", "Punk Rock"), "Thunderbolt", "opponent-left"),
      idle(blastoise), idle(lax4())),
    checks: "Jolteon (150) first; Toxtricity's Thunderbolt at 1.3x (gen 8 terrain).",
  },
  {
    id: "M24e", title: "Max Mindstorm sets Psychic Terrain: a later Psychic move up", game: "swsh",
    slots: slots(act(mon("Gardevoir", "Synchronize", { choice: "dynamax" }), "Psychic", "opponent-left"), act(mon("Hatterene", "Magic Bounce"), "Psychic", "opponent-left"),
      idle(venusaur), idle(lax4())),
    checks: "Gardevoir (100) first; Hatterene's Psychic at 1.3x.",
  },
  {
    id: "M24f", title: "Max Hailstorm sets hail: Slush Rush re-sort and Bolt Beak", game: "swsh",
    slots: slots(act(with_(speedy("swsh", "Weavile", "Pressure", "atk"), { choice: "dynamax" }), "Icicle Crash", "opponent-right"), act(mon("Arctozolt", "Slush Rush"), "Bolt Beak", "opponent-left"),
      act(mon("Dragonite", "Inner Focus"), "Dragon Claw", "own-left"), idle(lax4())),
    checks: "In hail Arctozolt (150) moves before Dragonite (100): Bolt Beak doubles (gen 8 re-sort).",
  },
  {
    id: "M25a", title: "Hail used in generation 7: no Slush Rush re-sort", game: "usum",
    slots: slots(act(mon("Froslass", "Cursed Body"), "Hail"), act(mon("Beartic", "Slush Rush"), "Icicle Crash", "opponent-left"),
      act(venusaur, "Sludge Bomb", "own-right"), idle(lax4())),
    checks: "Gen 7 keeps the order of the turn's start: Venusaur (101) before Beartic (70, 140 in hail).",
  },
  {
    id: "M25b", title: "Hail used in generation 8: Slush Rush re-sort", game: "swsh",
    slots: slots(act(mon("Froslass", "Cursed Body"), "Hail"), act(mon("Beartic", "Slush Rush"), "Icicle Crash", "opponent-left"),
      act(venusaur, "Sludge Bomb", "own-right"), idle(lax4())),
    checks: "After Hail, Beartic (140) moves before Venusaur (101).",
  },
  {
    id: "M25c", title: "Hail up: Weather Ball, then Aurora Veil before a slower hit", game: "usum", field: { weather: "Hail" },
    slots: slots(act(mon("Froslass", "Cursed Body"), "Weather Ball", "opponent-left"), act(lax4(), "Body Slam", "opponent-left"),
      idle(mon("Garchomp", "Rough Skin")), act(mon("Ninetales-Alola", "Snow Cloak"), "Aurora Veil")),
    checks: "Weather Ball is Ice at 100 into Garchomp; Aurora Veil (hail) then cuts Body Slam to 2732/4096.",
  },
  // Items the engine fixer modelled: the attacker's own HP Berry and Cheek Pouch after recoil.
  {
    id: "M26a", title: "The attacker eats its Sitrus Berry after recoil", game: "sv",
    slots: slots(act(with_(svChompJ, { item: "Sitrus Berry", hp: 100 }), "Double-Edge", "opponent-left"), idle(venusaur), idle(lax4()), idle(blastoise)),
    checks: "Double-Edge's recoil takes Garchomp under half: Sitrus +45.",
  },
  {
    id: "M26b", title: "Cheek Pouch with the attacker's Sitrus Berry after recoil", game: "sv",
    slots: slots(act(mon("Greedent", "Cheek Pouch", { item: "Sitrus Berry", hp: 110 }), "Double-Edge", "opponent-left"), idle(venusaur), idle(mon("Clefable", "Magic Guard")), idle(blastoise)),
    checks: "Recoil takes Greedent under half: Sitrus 1/4 and Cheek Pouch 1/3.",
  },
  {
    id: "M27", title: "Mirror Armor turns Obstruct's drop back on its user", game: "swsh",
    slots: slots(act(mon("Corviknight", "Mirror Armor"), "Brave Bird", "opponent-left"), idle(lax4()), act(mon("Obstagoon", "Defiant"), "Obstruct"), idle(blastoise)),
    checks: "Brave Bird is blocked; Mirror Armor turns -2 Def on Obstagoon, whose Defiant gives +2 Atk.",
  },
  // Combinations of the above that read the turn's state.
  {
    id: "M05c", title: "Tera Starstorm is physical when Terapagos-Stellar's Attack is higher", game: "sv",
    slots: slots(act(mon("Terapagos", "Tera Shift", { teraType: "Stellar", choice: "terastallize", nature: "Adamant", evs: { atk: 252 } }), "Tera Starstorm", "opponent-left"),
      idle(lax4()), idle(venusaur), idle(blastoise)),
    checks: "terastarstorm onModifyMove: Physical when getStat('atk') > getStat('spa'); both foes at 0.75.",
  },
  {
    id: "M05d", title: "Tera Starstorm into a Terastallized foe", game: "sv",
    slots: slots(act(mon("Terapagos", "Tera Shift", { teraType: "Stellar", choice: "terastallize" }), "Tera Starstorm", "opponent-left"), idle(lax4()),
      idle(with_(venusaur, { teraType: "Water", choice: "terastallize" })), idle(blastoise)),
    checks: "A Stellar move is super effective on a Terastallized Pokémon: Venusaur (Tera Water) at 2x, Blastoise neutral.",
  },
  {
    id: "M16d", title: "Mold Breaker passes Tera Shell", game: "sv",
    slots: slots(act(mon("Haxorus", "Mold Breaker", { nature: "Jolly", evs: { atk: 252, spe: 252 } }), "Dragon Claw", "opponent-left"),
      act(mon("Lucario", "Inner Focus"), "Close Combat", "opponent-left"), idle(mon("Terapagos", "Tera Shift")), idle(blastoise)),
    checks: "Tera Shell is breakable: Dragon Claw neutral at full HP; Close Combat super effective.",
  },
  {
    id: "M24k", title: "Max Flare's sun under Cloud Nine", game: "swsh",
    slots: slots(act(with_(speedy("swsh", "Charizard", "Blaze", "spa"), { choice: "dynamax" }), "Flamethrower", "opponent-right"), idle(mon("Golduck", "Cloud Nine")),
      act(blastoise, "Water Pulse", "own-left"), idle(mon("Venusaur", "Chlorophyll", { evs: { spe: 4 } }))),
    checks: "The sun is set but suppressed: Water Pulse into Charizard at full power; Chlorophyll off.",
  },
  {
    id: "M14d", title: "Cloud Nine's holder faints: Swift Swim re-sort in rain", game: "sv", field: { weather: "Rain" },
    slots: slots(idle(mon("Golduck", "Cloud Nine", { hp: 1 })), act(mon("Floatzel", "Swift Swim"), "Waterfall", "opponent-left"),
      act(mon("Dragapult", "Clear Body"), "Shadow Ball", "own-right"), act(svWeavJ, "Ice Shard", "own-left")),
    checks: "Ice Shard KOs Golduck; the re-sort reads Swift Swim: Floatzel (270) before Dragapult (162), Waterfall in rain.",
  },
  {
    id: "M16c", title: "Tera Shell resists every hit of a multi-hit move", game: "sv",
    slots: slots(act(svChompJ, "Scale Shot", "opponent-left"), act(mon("Lucario", "Inner Focus", { nature: "Jolly", evs: { atk: 252, spe: 252 } }), "Close Combat", "opponent-left"),
      idle(mon("Terapagos", "Tera Shift")), idle(blastoise)),
    checks: "terashell effectState.resisted keeps every Scale Shot hit not very effective; Close Combat after it super effective.",
  },
  {
    id: "M17b", title: "Mycelium Might stops Quick Claw for a status move", game: "sv",
    slots: slots(act(mon("Toedscruel", "Mycelium Might", { item: "Quick Claw" }), "Grassy Terrain"), idle(mon("Weavile", "Pressure")), act(lax4(), "Earthquake"), idle(venusaur)),
    checks: "data/items.ts quickclaw onFractionalPriority returns for a Mycelium Might status move: no 20% branch.",
  },
  {
    id: "M17c", title: "Mycelium Might holder's Quick Claw works for an attack", game: "sv",
    slots: slots(act(mon("Toedscruel", "Mycelium Might", { item: "Quick Claw" }), "Earth Power", "opponent-left"), idle(mon("Weavile", "Pressure")),
      act(mon("Dragapult", "Clear Body"), "Shadow Ball", "own-left"), idle(lax4())),
    checks: "Quick Claw 20%: Toedscruel (120) before Dragapult (162).",
  },
  {
    id: "M22c", title: "Revenge into the ally whose Earthquake hit it (USUM)", game: "usum",
    slots: slots(act(mon("Hariyama", "Thick Fat"), "Revenge", "own-right"), act(mon("Garchomp", "Sand Veil"), "Earthquake"), idle(venusaur), idle(lax4())),
    checks: "attackedBy holds the ally's damaging hit: Revenge into Garchomp at 120.",
  },
  {
    id: "M24g", title: "A Dynamaxed Ice Shard has priority 0", game: "swsh",
    slots: slots(act(with_(speedy("swsh", "Weavile", "Pressure", "atk"), { choice: "dynamax" }), "Ice Shard", "opponent-left"), idle(lax4()),
      act(speedy("swsh", "Dragapult", "Clear Body", "atk"), "Dragon Darts", "own-left"), idle(venusaur)),
    checks: "Max Hailstorm keeps no +1: Dragapult (213) moves before Weavile (194).",
  },
  {
    id: "M24h", title: "Max Geyser's rain: a Swift Swim foe re-sorts ahead", game: "swsh",
    slots: slots(act(with_(speedy("swsh", "Inteleon", "Torrent", "spa"), { choice: "dynamax" }), "Surf", "opponent-right"), act(speedy("swsh", "Charizard", "Blaze", "spa"), "Flamethrower", "opponent-left"),
      act(mon("Barraskewda", "Swift Swim"), "Liquidation", "own-right"), idle(lax4())),
    checks: "After Max Geyser Barraskewda (312) moves before Charizard (167): Liquidation in rain, then Flamethrower halved.",
  },
  {
    id: "M24i", title: "Max Lightning's Electric Terrain changes a Mimicry holder's type", game: "swsh",
    slots: slots(act(mon("Jolteon", "Volt Absorb", { choice: "dynamax" }), "Thunderbolt", "opponent-right"), act(mon("Toxtricity", "Punk Rock"), "Thunderbolt", "opponent-left"),
      idle(mon("Stunfisk-Galar", "Mimicry")), idle(lax4())),
    checks: "Mimicry (onTerrainChange): Stunfisk-Galar is Electric, so Thunderbolt hits it at 0.5 instead of failing.",
    notEstimated: "A weather or terrain change this turn would change Mimicry.",
  },
  {
    id: "M24j", title: "Max Lightning's Electric Terrain and a third Pokémon's Electric Seed", game: "swsh",
    slots: slots(act(mon("Jolteon", "Volt Absorb", { choice: "dynamax" }), "Thunderbolt", "opponent-right"), act(lax4(), "Body Slam", "opponent-left"),
      idle(mon("Blastoise", "Torrent", { item: "Electric Seed" })), idle(venusaur)),
    checks: "Electric Seed (onTerrainChange: useItem, +1 Def): Body Slam into Blastoise at +1 Def.",
    notEstimated: "A weather or terrain change this turn would change Electric Seed.",
  },
  {
    id: "M25d", title: "Solar Beam with Power Herb in hail", game: "usum", field: { weather: "Hail" },
    slots: slots(act(mon("Venusaur", "Overgrow", { item: "Power Herb" }), "Solar Beam", "opponent-left"), idle(lax4()), idle(blastoise), idle(mon("Garchomp", "Rough Skin"))),
    checks: "Power Herb skips the charge; solarbeam onBasePower halves it in hail.",
  },
  {
    id: "M28a", title: "A spread contact move into Spiky Shield, then the user's Sitrus Berry", game: "sv",
    slots: slots(act(mon("Sandaconda", "Shed Skin", { item: "Sitrus Berry", hp: 90 }), "Brutal Swing"), idle(lax4()),
      act(mon("Chesnaught", "Bulletproof"), "Spiky Shield"), idle(venusaur)),
    checks: "Brutal Swing (allAdjacent) hits Snorlax and Venusaur; Spiky Shield takes 1/8 from Sandaconda, which eats its Sitrus Berry.",
  },
  {
    id: "M28b", title: "A spread contact move into Baneful Bunker poisons its user", game: "sv",
    slots: slots(act(mon("Sandaconda", "Shed Skin"), "Brutal Swing"), idle(lax4()), act(mon("Toxapex", "Regenerator"), "Baneful Bunker"), act(mon("Amoonguss", "Regenerator"), "Venoshock", "own-left")),
    checks: "Sandaconda is poisoned by the blocked hit: Amoonguss's later Venoshock into it at 130.",
  },
  {
    id: "M28c", title: "Spiky Shield's damage makes a Liechi Berry due only after the hits", game: "sv",
    slots: slots(act(mon("Sandaconda", "Shed Skin", { item: "Liechi Berry", hp: 50 }), "Brutal Swing"), idle(lax4()),
      act(mon("Chesnaught", "Bulletproof"), "Spiky Shield"), idle(venusaur)),
    checks: "Spiky Shield (18) in TryHit takes Sandaconda to 32, under a quarter, with no Update before the hits: Brutal Swing at +0, the Liechi Berry after it.",
  },
  {
    id: "M28d", title: "King's Shield lowers a spread contact attacker's Attack before its hits", game: "swsh",
    slots: slots(act(mon("Conkeldurr", "Iron Fist"), "Brutal Swing"), idle(lax4()), act(mon("Aegislash", "Stance Change"), "King's Shield"), idle(blastoise)),
    checks: "King's Shield's -1 Atk comes in TryHit, before the hit loop: Brutal Swing into Snorlax and Blastoise at -1.",
  },
  {
    id: "M28e", title: "Burning Bulwark burns a spread contact attacker before its hits", game: "sv",
    slots: slots(act(mon("Sandaconda", "Shed Skin"), "Brutal Swing"), idle(lax4()), act(mon("Gouging Fire", "Protosynthesis"), "Burning Bulwark"), idle(venusaur)),
    checks: "The burn comes in TryHit: Brutal Swing into Snorlax and Venusaur at half damage.",
  },
  // Unnerve and As One end with their holder's HP (sim/side.ts allies()): a Berry they stopped is eaten at the next Update.
  {
    id: "M29a", title: "A third Pokémon's Unnerve ends with its HP: the target eats its Sitrus Berry", game: "sv",
    slots: slots(act(svChompJ, "Dragon Claw", "opponent-left"), idle(mon("Tyranitar", "Unnerve", { hp: 1 })),
      idle(snorlax({ item: "Sitrus Berry", hp: 120 })), act(venusaur, "Energy Ball", "own-right")),
    checks: "Dragon Claw takes Snorlax under half while Tyranitar's Unnerve stops the Sitrus Berry; Energy Ball KOs Tyranitar, and Snorlax eats it then.",
  },
  {
    id: "M29b", title: "A spread move KOs the Unnerve holder: the other target eats its Sitrus Berry", game: "sv",
    slots: slots(act(svChompJ, "Rock Slide"), idle(lax4()), idle(mon("Tyranitar", "Unnerve", { hp: 1 })), idle(snorlax({ item: "Sitrus Berry", hp: 140 }))),
    checks: "Rock Slide KOs Tyranitar and takes Snorlax under half: the Update after the hits finds no Unnerve.",
  },
  {
    id: "M29c", title: "A recoil move KOs the Unnerve target: the attacker's Sitrus Berry", game: "sv",
    slots: slots(act(with_(svChompJ, { item: "Sitrus Berry", hp: 80 }), "Double-Edge", "opponent-left"), idle(venusaur), idle(mon("Tyranitar", "Unnerve", { hp: 30 })), idle(blastoise)),
    checks: "Garchomp under half could not eat while Tyranitar was in: it eats at the Update after the KO, before Double-Edge's recoil.",
    notEstimated: "Unnerve is not modelled in 2v2.",
  },
  {
    id: "M29d", title: "The Unnerve user faints from its own recoil: the target eats its Sitrus Berry", game: "sv",
    slots: slots(act(mon("Tyranitar", "Unnerve", { hp: 10 }), "Double-Edge", "opponent-left"), idle(venusaur), idle(snorlax({ item: "Sitrus Berry", hp: 200 })), idle(blastoise)),
    checks: "Double-Edge takes Snorlax under half; the recoil KOs Tyranitar, and Snorlax eats at the next Update.",
  },
  {
    id: "M29e", title: "An attacker KOs the Unnerve target and eats its own Sitrus Berry", game: "sv",
    slots: slots(act(with_(svChompJ, { item: "Sitrus Berry", hp: 80 }), "Dragon Claw", "opponent-left"), idle(venusaur), idle(mon("Tyranitar", "Unnerve", { hp: 1 })), idle(blastoise)),
    checks: "No recoil: Garchomp eats its Sitrus Berry at the Update after the hit.",
  },
  {
    id: "M29f", title: "Rocky Helmet on the KO'd Unnerve target, then the attacker's Sitrus Berry", game: "sv",
    slots: slots(act(with_(svChompJ, { item: "Sitrus Berry", hp: 100 }), "Dragon Claw", "opponent-left"), idle(venusaur),
      idle(mon("Tyranitar", "Unnerve", { hp: 1, item: "Rocky Helmet" })), idle(blastoise)),
    checks: "Rocky Helmet's 1/6 comes in the hit, before the Update after it: Garchomp at 70 eats its Sitrus Berry there.",
  },
);

// More of the user's case, two Pokémon into one foe slot, with the turn's other parts around it.
CASES.push(
  {
    id: "X01", title: "Mega Metagross and Garchomp into Multiscale (Champions)", game: "champions",
    slots: slots(act(mon("Metagross", "Clear Body", { item: "Metagrossite", choice: "mega", appSpecies: "metagrossmega", appBuild: { abilityId: "toughclaws" } }), "Iron Head", "opponent-left"),
      act(cChomp, "Dragon Claw", "opponent-left"), idle(mon("Dragonite", "Multiscale")), idle(snorlax({ evs: { spe: 1 } }))),
    checks: "Mega Metagross (Tough Claws) moves first at its Mega Speed and breaks Multiscale; Dragon Claw full.",
  },
  {
    id: "X02", title: "Follow Me takes both attacks aimed at its partner", game: "sv",
    slots: slots(act(svChompJ, "Dragon Claw", "opponent-left"), act(svZardT, "Air Slash", "opponent-left"), idle(venusaur), act(mon("Clefable", "Magic Guard"), "Follow Me")),
    checks: "Dragon Claw (Clefable is immune) and Air Slash both go to Clefable.",
  },
  {
    id: "X03", title: "Wide Guard stops the spread move, not the single-target one", game: "sv",
    slots: slots(act(svChompJ, "Rock Slide"), act(svZardT, "Flamethrower", "opponent-left"), idle(venusaur), act(mon("Hitmontop", "Technician"), "Wide Guard")),
    checks: "Rock Slide blocked on both foes; Flamethrower into Venusaur.",
  },
  {
    id: "X04", title: "Weakness Policy from the first attack, then the target hits back at +2", game: "swsh",
    slots: slots(act(speedy("swsh", "Weavile", "Pressure", "atk"), "Ice Shard", "opponent-left"), act(mon("Garchomp", "Rough Skin"), "Iron Head", "opponent-left"),
      act(mon("Dragonite", "Inner Focus", { item: "Weakness Policy" }), "Dragon Claw", "own-right"), idle(lax4())),
    checks: "Ice Shard (4x) triggers Weakness Policy; Garchomp's Iron Head; Dragonite's Dragon Claw into Garchomp at +2.",
  },
  {
    id: "X05", title: "Focus Sash broken, then a multi-hit move finishes it", game: "sv",
    slots: slots(act(svWeavJ, "Night Slash", "opponent-left"), act(mon("Garchomp", "Rough Skin"), "Scale Shot", "opponent-left"),
      idle(mon("Gengar", "Cursed Body", { item: "Focus Sash" })), idle(blastoise)),
    checks: "Night Slash leaves Gengar at 1; Scale Shot's first hit KOs it.",
  },
  {
    id: "X06", title: "Choice Scarf attacker and a Quick Claw partner into one slot", game: "sv",
    slots: slots(act(with_(svChompJ, { item: "Choice Scarf" }), "Dragon Claw", "opponent-left"), act(lax4({ item: "Quick Claw" }), "Body Slam", "opponent-left"),
      act(mon("Blastoise", "Torrent", { hp: 120 }), "Water Pulse", "own-right"), idle(venusaur)),
    checks: "Quick Claw (20%) lets Snorlax move before Blastoise; else Blastoise's Water Pulse first.",
  },
  {
    id: "X07", title: "Trick Room and Tailwind together", game: "sv", field: { trickRoom: true, own: { tailwind: true } },
    slots: slots(act(lax4(), "Body Slam", "opponent-left"), act(svChompJ, "Dragon Claw", "opponent-left"), act(blastoise, "Water Pulse", "own-left"), idle(venusaur)),
    checks: "Under Trick Room Blastoise (98) first, Snorlax (102 in Tailwind) next, Garchomp (338) last.",
  },
  {
    id: "X08", title: "Intimidate into a Defiant attacker and its partner", game: "sv",
    slots: slots(act(mon("Kingambit", "Defiant", { boosts: { atk: 1 } }), "Kowtow Cleave", "opponent-left"), act(with_(svChompJ, { boosts: { atk: -1 } }), "Dragon Claw", "opponent-left"),
      idle(mon("Dragonite", "Multiscale")), idle(mon("Incineroar", "Intimidate"))),
    checks: "Intimidate leaves Kingambit at +1 (Defiant +2) and Garchomp at -1.",
  },
  {
    id: "X09", title: "Sucker Punch first, Sitrus Berry, then a second attack (Champions)", game: "champions",
    slots: slots(act(mon("Kingambit", "Defiant"), "Sucker Punch", "opponent-left"), act(cZard, "Flamethrower", "opponent-left"),
      act(mon("Garchomp", "Sand Veil", { item: "Sitrus Berry", hp: 120 }), "Dragon Claw", "own-right"), idle(blastoise)),
    checks: "Sucker Punch (+1) into the attacking Garchomp, its Sitrus Berry at the Update, then Dragon Claw and Flamethrower.",
  },
  {
    id: "X10", title: "A Z-Move and a single move into one slot (USUM)", game: "usum",
    slots: slots(act(with_(speedy("usum", "Garchomp", "Rough Skin", "atk"), { item: "Dragonium Z", choice: "zmove" }), "Dragon Claw", "opponent-left"),
      act(speedy("usum", "Charizard", "Blaze", "spa"), "Flamethrower", "opponent-left"), idle(mon("Blastoise", "Torrent", { item: "Sitrus Berry" })), idle(venusaur)),
    checks: "Devastating Drake, then Blastoise's Sitrus Berry, then Flamethrower.",
  },
  {
    id: "X11", title: "Max Airstream from the doubled target re-sorts its partner (SwSh)", game: "swsh",
    slots: slots(act(mon("Garchomp", "Rough Skin"), "Dragon Claw", "opponent-left"), act(mon("Weavile", "Pressure"), "Icicle Crash", "opponent-left"),
      act(with_(speedy("swsh", "Charizard", "Blaze", "spa"), { choice: "dynamax" }), "Air Slash", "own-left"), act(mon("Venusaur", "Overgrow", { evs: { spe: 4 } }), "Sludge Bomb", "own-right")),
    checks: "Max Airstream raises Venusaur to 151: it moves before Weavile (145); both attackers into Dynamax Charizard.",
  },
);

// Bug Bite and Pluck eat the target's Berry for their user (data/moves.ts bugbite, pluck onHit: singleEvent('Eat') on the
// source, then runEvent('EatItem')): scripts/.cache/calc-audit/bugbite/fix/sd-probe.ts has the singles probes behind these.
const scizor = (extra: Partial<CaseMon> = {}) => mon("Scizor", "Technician", extra);
const toed = (item: string, extra: Partial<CaseMon> = {}) => mon("Politoed", "Water Absorb", { item, ...extra });
CASES.push(
  {
    id: "BB01", title: "Bug Bite into a foe's Sitrus Berry heals the user (Champions)", game: "champions",
    slots: slots(act(scizor({ hp: 60 }), "Bug Bite", "opponent-left"), idle(venusaur), idle(toed("Sitrus Berry")), idle(blastoise)),
    checks: "Scizor 60/145 eats Politoed's Sitrus Berry in Bug Bite's onHit: +36 (sd-probe sitrus60: 96).",
  },
  {
    id: "BB02", title: "Bug Bite into the ally's Sitrus Berry (Champions)", game: "champions",
    slots: slots(act(scizor({ hp: 60 }), "Bug Bite", "own-right"), idle(toed("Sitrus Berry")), idle(cChomp), idle(blastoise)),
    checks: "The ally loses its Sitrus Berry to Bug Bite; Scizor heals 36.",
  },
  {
    id: "BB03", title: "The stolen Sitrus Berry heals before Rough Skin (Champions)", game: "champions",
    slots: slots(act(scizor({ hp: 10 }), "Bug Bite", "opponent-left"), idle(venusaur), idle(mon("Garchomp", "Rough Skin", { item: "Sitrus Berry" })), idle(blastoise)),
    checks: "Scizor 10 → 46 (Sitrus, onHit) → 28 (Rough Skin, DamagingHit): it does not faint (sd-probe roughskin).",
  },
  {
    id: "BB04", title: "Stolen Sitrus, Rough Skin, then the user's own Sitrus Berry (Champions)", game: "champions",
    slots: slots(act(scizor({ hp: 30, item: "Sitrus Berry" }), "Bug Bite", "opponent-left"), idle(venusaur), idle(mon("Garchomp", "Rough Skin", { item: "Sitrus Berry" })), idle(blastoise)),
    checks: "30 → 66 → 48 → its own Sitrus at the hit's Update: 84 (sd-probe roughskin-own).",
  },
  {
    id: "BB05", title: "Life Orb after the stolen Sitrus Berry and Rough Skin (Champions)", game: "champions",
    slots: slots(act(scizor({ hp: 20, item: "Life Orb" }), "Bug Bite", "opponent-left"), idle(venusaur), idle(mon("Garchomp", "Rough Skin", { item: "Sitrus Berry" })), idle(blastoise)),
    checks: "20 → 56 → 38 (Rough Skin) → 24 (Life Orb).",
  },
  {
    id: "BB06", title: "A stolen Lum Berry cures the user's burn before a later Hex (Champions, Trick Room)", game: "champions", field: { trickRoom: true },
    slots: slots(act(scizor({ status: "brn" }), "Bug Bite", "opponent-left"), idle(venusaur), idle(toed("Lum Berry")), act(mon("Gengar", "Cursed Body"), "Hex", "own-left")),
    checks: "Scizor (65) moves before Gengar (110) under Trick Room; its burn is cured, so Hex is not doubled.",
  },
  {
    id: "BB07", title: "A stolen Kee Berry raises the user's Defense before a later Dragon Claw (SV, Trick Room)", game: "sv", field: { trickRoom: true },
    slots: slots(act(scizor(), "Bug Bite", "opponent-left"), idle(venusaur), idle(toed("Kee Berry")), act(chomp0, "Dragon Claw", "own-left")),
    checks: "Scizor eats the Kee Berry (+1 Defense) before Garchomp's Dragon Claw hits it.",
  },
  {
    id: "BB08", title: "Sticky Hold keeps its Kee Berry against Bug Bite (SV, Trick Room)", game: "sv", field: { trickRoom: true },
    slots: slots(act(scizor(), "Bug Bite", "opponent-left"), idle(venusaur), idle(mon("Gastrodon", "Sticky Hold", { item: "Kee Berry" })), act(chomp0, "Dragon Claw", "own-left")),
    checks: "Sticky Hold keeps the Berry: Gastrodon's own Kee Berry acts on the physical hit; Scizor's Defense stays.",
  },
  {
    id: "BB09", title: "Sticky Hold lets go of its Kee Berry as Bug Bite knocks its holder out (SV, Trick Room)", game: "sv", field: { trickRoom: true },
    slots: slots(act(scizor(), "Bug Bite", "opponent-left"), idle(venusaur), idle(mon("Gastrodon", "Sticky Hold", { item: "Kee Berry", hp: 1 })), act(chomp0, "Dragon Claw", "own-left")),
    checks: "stickyhold onTakeItem returns for a fainted holder: Scizor eats the Kee Berry (+1 Defense) before Dragon Claw.",
  },
  {
    id: "BB10", title: "Bug Bite that may knock the Sitrus holder out still heals the user (Champions)", game: "champions",
    slots: slots(act(scizor({ hp: 60 }), "Bug Bite", "opponent-left"), idle(venusaur), idle(toed("Sitrus Berry", { hp: 90 })), idle(blastoise)),
    checks: "Politoed at 90/165 faints at the higher rolls; either way Scizor eats the Sitrus Berry: 96 (sd-probe ko-sitrus).",
  },
  {
    id: "BB11", title: "Klutz: Pluck takes the Sitrus Berry but its user gets nothing (SwSh)", game: "swsh",
    slots: slots(act(mon("Swoobat", "Klutz", { hp: 60 }), "Pluck", "opponent-left"), idle(venusaur), idle(toed("Sitrus Berry")), idle(blastoise)),
    checks: "singleEvent('Eat') is suppressed for a Klutz user (sd-probe klutz-user): Swoobat stays at 60.",
  },
  {
    id: "BB12", title: "A stolen Figy Berry heals half in USUM", game: "usum",
    slots: slots(act(scizor({ hp: 60, nature: "Modest" }), "Bug Bite", "opponent-left"), idle(venusaur), idle(toed("Figy Berry")), idle(blastoise)),
    checks: "data/mods/gen7/items.ts figyberry heals baseMaxhp / 2: 60 → 132 (sd-probe figy60-modest-usum); its confusion has no later move to act on.",
  },
  {
    id: "BB13", title: "The target's Unnerve does not stop the user eating its Berry (Champions)", game: "champions",
    slots: slots(act(scizor({ hp: 60 }), "Bug Bite", "opponent-left"), idle(venusaur), idle(mon("Corviknight", "Unnerve", { item: "Sitrus Berry" })), idle(blastoise)),
    checks: "The Eat runs no TryEatItem, so Unnerve (onFoeTryEatItem) stops nothing (sd-probe unnerve-target): 96.",
  },
  {
    id: "BB14", title: "Magic Room: Bug Bite takes the Sitrus Berry, its user gets nothing (Champions)", game: "champions", field: { magicRoom: true },
    slots: slots(act(scizor({ hp: 60 }), "Bug Bite", "opponent-left"), idle(venusaur), idle(toed("Sitrus Berry")), idle(blastoise)),
    checks: "ignoringItem suppresses the Eat (sd-probe magicroom): Scizor stays at 60.",
  },
  {
    id: "BB15", title: "Bug Bite at full HP: the Sitrus Berry heals nothing (Champions)", game: "champions",
    slots: slots(act(scizor(), "Bug Bite", "opponent-left"), idle(venusaur), idle(toed("Sitrus Berry")), idle(blastoise)),
    checks: "battle.heal returns false at full HP (sd-probe sitrusFull).",
  },
  {
    id: "BB16", title: "Pluck eats an Oran Berry (SV)", game: "sv",
    slots: slots(act(mon("Toucannon", "Keen Eye", { hp: 60 }), "Pluck", "opponent-left"), idle(venusaur), idle(toed("Oran Berry")), idle(blastoise)),
    checks: "Oran heals 10 in the onHit.",
  },
  {
    id: "BB17", title: "A stolen Starf Berry raises a random stat (SV)", game: "sv", notEstimated: "Starf Berry raises a random stat",
    slots: slots(act(scizor(), "Bug Bite", "opponent-left"), idle(venusaur), idle(toed("Starf Berry")), idle(blastoise)),
    checks: "starfberry onEat: this.sample(stats) +2: not estimated.",
  },
  {
    id: "BB18", title: "Opportunist on the target's side copies the stolen Liechi Berry's rise (SV)", game: "sv",
    notEstimated: "Opportunist copying a stat rise is not modelled in 2v2.",
    slots: slots(act(scizor(), "Bug Bite", "opponent-left"), idle(venusaur), idle(toed("Liechi Berry")), idle(mon("Espathra", "Opportunist"))),
    checks: "The user's +1 Attack from the stolen Liechi Berry is a foe's rise Espathra's Opportunist copies (onFoeAfterBoost).",
  },
);

// Z-Moves and Max Moves of item moves (zmove fix B1): pinned Showdown sim/battle-actions.ts getActiveZMove / getActiveMaxMove make
// them the generic move of their type, which runs none of Knock Off's, Thief's or Covet's handlers.
const weavileZ = (extra: Partial<CaseMon> = {}) => mon("Weavile", "Pressure", { item: "Darkinium Z", choice: "zmove", ...extra });
const chompBerry = (item: string, extra: Partial<CaseMon> = {}) => mon("Garchomp", "Rough Skin", { item, ...extra });
CASES.push(
  {
    id: "ZI01", title: "Z-Knock Off (Black Hole Eclipse) takes nothing: the holder eats its Sitrus Berry (USUM)", game: "usum",
    slots: slots(act(weavileZ(), "Knock Off", "opponent-left"), idle(venusaur), idle(chompBerry("Sitrus Berry")), idle(blastoise)),
    checks: "Garchomp 183 takes 84-99 and eats its Sitrus Berry at half HP or less (+45): 92-135 (verifier probe P01).",
  },
  {
    id: "ZI02", title: "Z-Knock Off leaves a Figy Berry its holder eats at a quarter (USUM)", game: "usum",
    slots: slots(act(weavileZ(), "Knock Off", "opponent-left"), idle(venusaur), idle(chompBerry("Figy Berry", { hp: 120 })), idle(blastoise)),
    checks: "Garchomp 120/183 takes 84-99, then eats its Figy Berry (+91, a half in generation 7): 112-127.",
  },
  {
    id: "ZI03", title: "Z-Knock Off, then the partner's Dragon Claw into the healed holder (USUM)", game: "usum",
    slots: slots(act(weavileZ(), "Knock Off", "opponent-left"), act(with_(chomp0, { evs: { spe: 4 } }), "Dragon Claw", "opponent-left"), idle(chompBerry("Sitrus Berry")), idle(blastoise)),
    checks: "Weavile (145) moves before Garchomp (123): the Sitrus Berry heals Garchomp before the Dragon Claw lands.",
  },
  {
    id: "ZI04", title: "Z-Knock Off into a Kee Berry: eaten by its holder, then a physical hit at +1 Defense (USUM)", game: "usum",
    slots: slots(act(weavileZ(), "Knock Off", "opponent-left"), act(chomp0, "Dragon Claw", "opponent-left"), idle(snorlax({ item: "Kee Berry" })), idle(blastoise)),
    checks: "Black Hole Eclipse is physical: Snorlax eats its Kee Berry (+1 Defense) before Garchomp's Dragon Claw.",
  },
  {
    id: "ZI05", title: "Z-Knock Off keeps the Eviolite for the partner's later Dragon Claw (USUM)", game: "usum",
    slots: slots(act(weavileZ(), "Knock Off", "opponent-left"), act(with_(chomp0, { evs: { spe: 4 } }), "Dragon Claw", "opponent-left"), idle(mon("Munchlax", "Thick Fat", { item: "Eviolite" })), idle(blastoise)),
    checks: "No onAfterHit: Munchlax keeps its Eviolite, so Garchomp's Dragon Claw meets 1.5x Defense (Knock Off would take it).",
  },
  {
    id: "ZI06", title: "Z-Thief takes nothing: the holder eats its Sitrus Berry (USUM)", game: "usum",
    slots: slots(act(weavileZ(), "Thief", "opponent-left"), idle(venusaur), idle(chompBerry("Sitrus Berry")), idle(blastoise)),
    checks: "Black Hole Eclipse from Thief: Garchomp keeps and eats its Sitrus Berry.",
  },
  {
    id: "ZI07", title: "Knock Off (no Z) takes the Sitrus Berry before its holder can eat it (USUM)", game: "usum",
    slots: slots(act(mon("Weavile", "Pressure"), "Knock Off", "opponent-left"), idle(venusaur), idle(chompBerry("Sitrus Berry")), idle(blastoise)),
    checks: "Control: Knock Off's onAfterHit removes the Sitrus Berry (1.5x power, 97).",
  },
  {
    id: "ZI08", title: "Max Darkness from Knock Off takes nothing: the holder eats its Sitrus Berry (SwSh)", game: "swsh",
    slots: slots(act(mon("Weavile", "Pressure", { choice: "dynamax" }), "Knock Off", "opponent-left"), idle(venusaur), idle(chompBerry("Sitrus Berry")), idle(blastoise)),
    checks: "Max Darkness (getActiveMaxMove): no Knock Off handlers; its Sp. Def drop lands on both foes.",
  },
);

// The attacker's own Berry eaten during or right after its move (zmove fix B2): its HP after the turn and its heals list.
const heracross = (extra: Partial<CaseMon> = {}) => mon("Heracross", "Swarm", extra);
CASES.push(
  {
    id: "HL01", title: "Close Combat into Rough Skin: the attacker eats its own Sitrus Berry (SV)", game: "sv",
    slots: slots(act(heracross({ item: "Sitrus Berry", hp: 93 }), "Close Combat", "opponent-left"), idle(venusaur), idle(chomp0), idle(blastoise)),
    checks: "Heracross 93/155 - 19 (Rough Skin) = 74, then its Sitrus Berry +38: 112 (verifier E01).",
  },
  {
    id: "HL02", title: "Double Hit into Rough Skin: the Sitrus Berry is eaten between the hits (SV)", game: "sv",
    slots: slots(act(mon("Weavile", "Pressure", { item: "Sitrus Berry", hp: 80 }), "Double Hit", "opponent-left"), idle(venusaur), idle(chomp0), idle(blastoise)),
    checks: "Weavile 80/145: 62 after the first hit's Rough Skin, +36: 98, then 80 after the second.",
  },
  {
    id: "HL03", title: "Brave Bird's recoil takes the attacker to its Sitrus Berry (SV)", game: "sv",
    slots: slots(act(mon("Braviary", "Keen Eye", { item: "Sitrus Berry", hp: 95 }), "Brave Bird", "opponent-left"), idle(venusaur), idle(blastoise), idle(snorlax())),
    checks: "Recoil (a third of the damage) at the Update after the move, then the Sitrus Berry (+43).",
  },
  {
    id: "HL04", title: "Cheek Pouch with its own Sitrus Berry after Rough Skin, capped at the maximum (SV)", game: "sv",
    slots: slots(act(mon("Dedenne", "Cheek Pouch", { item: "Sitrus Berry", hp: 80 }), "Play Rough", "opponent-left"), idle(venusaur), idle(chomp0), idle(blastoise)),
    checks: "Dedenne 80/142 - 17 = 63, Sitrus +35 = 98, Cheek Pouch +47 capped: 142.",
  },
  {
    id: "HL05", title: "Cheek Pouch heals as the attacker eats its Liechi Berry after Rough Skin (SV)", game: "sv",
    slots: slots(act(mon("Dedenne", "Cheek Pouch", { item: "Liechi Berry", hp: 40 }), "Play Rough", "opponent-left"), idle(venusaur), idle(chomp0), idle(blastoise)),
    checks: "Dedenne 40 - 17 = 23 (a quarter: 35): Liechi +1 Attack, Cheek Pouch +47: 70.",
  },
  {
    id: "HL06", title: "Double Hit into Rough Skin and Rocky Helmet: the attacker eats its Oran Berry, then faints (SV)", game: "sv",
    slots: slots(act(mon("Weavile", "Pressure", { item: "Oran Berry", hp: 73 }), "Double Hit", "opponent-left"), idle(venusaur), idle(chompBerry("Rocky Helmet")), idle(blastoise)),
    checks: "73 - 18 - 24 = 31, Oran +10: 41, then Rough Skin and Rocky Helmet on the second hit knock it out.",
  },
  {
    id: "HL07", title: "Drain Punch into Rough Skin and Rocky Helmet: the attacker's Sitrus Berry on some rolls (SV)", game: "sv",
    slots: slots(act(mon("Breloom", "Technician", { item: "Sitrus Berry", hp: 75 }), "Drain Punch", "opponent-left"), idle(venusaur), idle(chompBerry("Rocky Helmet")), idle(blastoise)),
    checks: "Drain heals half the damage first (not a listed heal), then Rough Skin 16 and Rocky Helmet 22: the Sitrus Berry (+33) at 67 or less.",
  },
  {
    id: "HL08", title: "Close Combat knocks out a Rough Skin Garchomp and the attacker eats its Sitrus Berry (SV)", game: "sv",
    slots: slots(act(heracross({ item: "Sitrus Berry", hp: 93 }), "Close Combat", "opponent-left"), idle(venusaur), idle(mon("Garchomp", "Rough Skin", { hp: 60 })), idle(blastoise)),
    checks: "Rough Skin acts on the knocking-out hit: 74, then +38: 112.",
  },
  {
    id: "HL09", title: "A foe's Unnerve stops the attacker's own Sitrus Berry after Rough Skin (SV)", game: "sv",
    slots: slots(act(heracross({ item: "Sitrus Berry", hp: 93 }), "Close Combat", "opponent-left"), idle(venusaur), idle(chomp0), idle(mon("Tyranitar", "Unnerve"))),
    checks: "Control: Tyranitar's Unnerve: Heracross stays at 74 and lists no heal.",
  },
  {
    id: "HL10", title: "Dragon Claw into Rough Skin with the attacker's own Oran Berry (Champions)", game: "champions",
    slots: slots(act(mon("Garchomp", "Sand Veil", { item: "Oran Berry", hp: 98, evs: { spe: 1 } }), "Dragon Claw", "opponent-left"), idle(cZard), idle(mon("Garchomp", "Rough Skin")), idle(mon("Blastoise", "Torrent"))),
    checks: "Garchomp 98/183 - 22 (Rough Skin) = 76 at half or less (91): its Oran Berry +10: 86.",
  },
  {
    id: "HL11", title: "A Gluttony Snorlax eats its Figy Berry at half HP after Rough Skin (USUM)", game: "usum",
    slots: slots(act(mon("Snorlax", "Gluttony", { item: "Figy Berry", hp: 130 }), "Body Slam", "opponent-left"), idle(venusaur), idle(chomp0), idle(blastoise)),
    checks: "Snorlax 130/235 - 29 = 101 (Gluttony: half, 117), Figy Berry +117 (a half in generation 7): 218.",
  },
  {
    id: "HL12", title: "The attacker's own Sitrus Berry after Rough Skin, then a slower foe's Body Slam into it (SV)", game: "sv",
    slots: slots(act(heracross({ item: "Sitrus Berry", hp: 93 }), "Close Combat", "opponent-left"), idle(venusaur), idle(chomp0), act(snorlax(), "Body Slam", "own-left")),
    checks: "Heracross (105) moves before Snorlax (50): 112 after its move, then Body Slam into it.",
  },
);

// The engine fixer's cases (fix-engine/cases3.ts) and the engine review's probes (review-engine/cases.ts), with the
// app's expected result after the fixes (EXPECT: a not-estimated reason, or Showdown's numbers). A Z-Move whose own
// target is a spread one takes no target in Showdown or the app (doubles-targets.ts).
for (const c of REVIEW_CASES) {
  const expected = EXPECT[c.id];
  const { sdNoTarget, ...rest } = c;
  const plain: Case = sdNoTarget ? { ...rest, slots: Object.fromEntries(Object.entries(rest.slots).map(([slot, m]) =>
    [slot, sdNoTarget.includes(slot as SlotId) ? { ...m, action: { ...m.action, target: undefined } } : m])) as Case["slots"] } : rest;
  CASES.push(expected ? { ...plain, notEstimated: expected } : plain);
}
CASES.push(...FIX_CASES);
// Pokémon fainted before the turn with no replacement (fainted-engine/cases-fainted.ts).
CASES.push(...FAINTED_CASES);
// A damaging move's Z-Move or Max Move runs none of its base move's own effects, only its own (zmove-status/fix/cases-zs.ts).
CASES.push(...ZS_CASES);
CASES.push(...ZV_CASES);
// Serene Grace's doubled added effects and Arceus / Silvally in their item's type (serene-arceus/fix/cases-sa.ts).
CASES.push(...SA_CASES);
// The hit an intact Ice Face or Disguise takes at a neutral effectiveness (FI01 is SA13), and the other held-item forms
// (forms-iceface-fling/fix/cases-fif.ts).
CASES.push(...FIF_CASES);
// The face's hit is never critical and eats a Chilan Berry; Crush Grip and Hard Press per power; the item forms
// (forms-iceface-fling/verify/cases-v.ts). VI04 and VI08 are left out: an absorbing ability at full HP logs -immune, which the
// harness reads as a type immunity ("no-damage") where the app says "blocked". VF22 (Neutralizing Gas) is in since the
// ngas-pp fix, which models the gas from the turn's start.
CASES.push(...V_CASES.filter((c) => !["VI04", "VI08"].includes(c.id)));
// Neutralizing Gas from the turn's start, and the events that end it or change what it suppresses (ngas-pp/fix/cases-ng.ts).
CASES.push(...NG_CASES);
// The ngas-pp verifier's own Neutralizing Gas cases (ngas-pp/verify/cases-vg.ts).
CASES.push(...VG_CASES);
CASES.push(...VGX_CASES);

// status-eot (SPEC §7.1, ADDENDUM §7.1): the S, R (here ER: R ids are taken by review-engine) and E cases, and the earlier
// cases whose app expectation changed by design (SPEC §7 step 7): an M or C move that was not estimated is now modelled.
for (const c of CASES) {
  if (!(c.id in STATUS_EOT_REEXPECT)) continue;
  const expected = STATUS_EOT_REEXPECT[c.id];
  if (expected === null) delete c.notEstimated;
  else c.notEstimated = expected;
}
CASES.push(...STATUS_EOT_CASES);

// status2 (Track V1, changed-cases.ts): at an integration, the stored cases whose reason that wave's tracks remove are
// compared as estimated (their fresh oracle results): STATUS2_REEXPECT="1a" (or "1a,1b"). Off by default during the waves.
{
  const waves = (process.env.STATUS2_REEXPECT ?? "").split(",").map((w) => w.trim()).filter(Boolean);
  if (waves.length) {
    const wave1a = new Set(WAVE1A_CASES.map((c) => c.id));
    // A wave 2 case states wave 2's expectations (its kept reasons too: G4-SWX-20's Commander), so no removal applies to it.
    const wave2 = new Set(WAVE2_CASES.map((c) => c.id));
    for (const c of CASES) {
      if (wave2.has(c.id)) continue;
      for (const key of ["notEstimated", "endNotEstimated"] as const) {
        const r = c[key] ? removalOf(c[key]!) : null;
        // A wave 1a case states 1a's expectations; from 1b's view it is stored (Track V2: FS08e, G4-WHR-01).
        if (wave1a.has(c.id) && r?.wave !== "1b") continue;
        if (r && waves.includes(r.wave)) {
          if (REEXPECT_TO[c.id]?.[key]) c[key] = REEXPECT_TO[c.id][key];
          else delete c[key];
        }
      }
    }
  }
}

export const CASE_BY_ID = new Map(CASES.map((c) => [c.id, c]));
{
  const seen = new Set<string>();
  for (const c of CASES) {
    if (seen.has(c.id)) throw new Error(`duplicate case id ${c.id}`);
    seen.add(c.id);
  }
}

// serene-arceus fix: 2v2 oracle cases SA01-SA12 (no SA05: a foe's Neutralizing Gas is not estimated in the 2v2, before any start row;
// the unit test checks that reason and the 1v1 cross-check covers Neutralizing Gas). Serene Grace doubles every secondary's chance (pinned Showdown c23d2e94
// data/abilities.ts serenegrace onModifyMove), so a 50% or 70% added effect happens on every use (random(100) < chance:
// the harness's 99 passes a doubled 50%); one below 100% even doubled (Air Slash's 60% flinch) still does not. Arceus holding
// a Plate and Silvally holding a Memory battle as that type (data/conditions.ts arceus / silvally onType; the app selects the
// item's form). Level 50, 31 IVs, Serious, 0 EVs unless set. Speeds (0 EVs: base + 20): Blissey 75, Togekiss 100,
// Snorlax 50 (51 with 4 EVs), Venusaur 100 (101), Corviknight 87, Frosmoth 85,
// Conkeldurr 65, Eiscue 70, Weezing-Galar 80, Arceus 140, Silvally 115, Blastoise 98, Lapras 80.
import type { Case, CaseAction, CaseMon, SlotId } from "../../2v2/verify/case-types";

type Slot = CaseMon & { action: CaseAction };
const mon = (species: string, ability: string, extra: Partial<CaseMon> = {}): CaseMon => ({ species, ability, ...extra });
const act = (m: CaseMon, move: string | null, target?: SlotId): Slot => ({ ...m, action: { move, ...(target ? { target } : {}) } });
const idle = (m: CaseMon): Slot => act(m, null);
const S = (a: Slot, b: Slot, c: Slot, d: Slot): Case["slots"] => ({ "own-left": a, "own-right": b, "opponent-left": c, "opponent-right": d });
const venusaur = mon("Venusaur", "Overgrow", { evs: { spe: 4 } });
const snorlax = mon("Snorlax", "Thick Fat", { evs: { spe: 4 } });
const blissey = mon("Blissey", "Serene Grace");
const conkeldurr = mon("Conkeldurr", "Guts");

export const SA_CASES: Case[] = [
  {
    id: "SA01", title: "Serene Grace Rock Smash lowers Snorlax's Defense before the slower partner's Hammer Arm (SwSh)", game: "swsh",
    slots: S(act(blissey, "Rock Smash", "opponent-left"), act(conkeldurr, "Hammer Arm", "opponent-left"), idle(snorlax), idle(venusaur)),
    checks: "Rock Smash's 50% Defense drop doubled to 100%: Hammer Arm hits Snorlax at -1 Defense.",
  },
  {
    id: "SA02", title: "Control: Natural Cure Blissey's Rock Smash lowers nothing (SwSh)", game: "swsh",
    slots: S(act(mon("Blissey", "Natural Cure"), "Rock Smash", "opponent-left"), act(conkeldurr, "Hammer Arm", "opponent-left"), idle(snorlax), idle(venusaur)),
    checks: "50% stays below 100%: Hammer Arm hits Snorlax at its full Defense.",
  },
  {
    id: "SA03", title: "Shield Dust stops the Serene Grace drop (SwSh)", game: "swsh",
    slots: S(act(blissey, "Rock Smash", "opponent-left"), act(conkeldurr, "Hammer Arm", "opponent-left"), idle(mon("Frosmoth", "Shield Dust")), idle(venusaur)),
    checks: "Frosmoth's Shield Dust filters the secondary: Hammer Arm at its full Defense.",
  },
  {
    id: "SA04", title: "Mirror Armor turns the Serene Grace drop on Blissey before the foe's Body Slam (SwSh)", game: "swsh",
    slots: S(act(blissey, "Rock Smash", "opponent-left"), idle(conkeldurr), idle(mon("Corviknight", "Mirror Armor")), act(snorlax, "Body Slam", "own-left")),
    checks: "Blissey at -1 Defense for the slower Snorlax's Body Slam.",
  },
  {
    id: "SA06", title: "Serene Grace Togekiss's Rock Smash, then its partner's Body Slam (USUM)", game: "usum",
    slots: S(act(mon("Togekiss", "Serene Grace"), "Rock Smash", "opponent-left"), act(mon("Snorlax", "Thick Fat"), "Body Slam", "opponent-left"), idle(snorlax), idle(venusaur)),
    checks: "Togekiss (100) first: Body Slam into Snorlax at -1 Defense.",
  },
  {
    id: "SA07", title: "Serene Grace Air Slash's flinch is still 60%: the slower target moves (USUM)", game: "usum",
    slots: S(act(mon("Togekiss", "Serene Grace"), "Air Slash", "opponent-left"), idle(venusaur), act(snorlax, "Body Slam", "own-left"), idle(mon("Lapras", "Shell Armor"))),
    checks: "30% doubled to 60% stays below 100%: Snorlax is not flinched.",
  },
  {
    id: "SA08", title: "Clear Body stops the Serene Grace drop (USUM)", game: "usum",
    slots: S(act(blissey, "Rock Smash", "opponent-left"), act(mon("Snorlax", "Thick Fat"), "Body Slam", "opponent-left"), idle(mon("Metagross", "Clear Body")), idle(venusaur)),
    checks: "Metagross keeps its Defense for Body Slam.",
  },
  {
    id: "SA09", title: "Arceus-Fire holding a Flame Plate: Fire Judgment with STAB, Water Pulse super effective into it (SV)", game: "sv",
    slots: S(act(mon("Arceus-Fire", "Multitype", { item: "Flame Plate" }), "Judgment", "opponent-left"), idle(venusaur), idle(snorlax), act(mon("Blastoise", "Torrent"), "Water Pulse", "own-left")),
    checks: "Judgment is Fire (plate 1.2x, STAB); Water Pulse 2x into the Fire-type Arceus.",
  },
  {
    id: "SA10", title: "Arceus-Fire holding a Firium Z: Fire type, Judgment stays Normal (USUM)", game: "usum",
    slots: S(act(mon("Arceus-Fire", "Multitype", { item: "Firium Z" }), "Judgment", "opponent-left"), idle(venusaur), idle(snorlax), act(mon("Blastoise", "Torrent"), "Water Pulse", "own-left")),
    checks: "data/moves.ts judgment: a Z-Crystal's onPlate does not change Judgment (no STAB); Water Pulse 2x into Arceus-Fire.",
  },
  {
    id: "SA11", title: "Silvally-Fire holding a Fire Memory: Fire Multi-Attack with STAB, Water Pulse super effective (USUM)", game: "usum",
    slots: S(act(mon("Silvally-Fire", "RKS System", { item: "Fire Memory" }), "Multi-Attack", "opponent-left"), idle(venusaur), idle(snorlax), act(mon("Blastoise", "Torrent"), "Water Pulse", "own-left")),
    checks: "Multi-Attack is Fire with STAB; Water Pulse 2x into Silvally-Fire.",
  },
  {
    id: "SA12", title: "Silvally-Water holding a Water Memory: Multi-Attack Water, a Grass foe's Energy Ball super effective (SwSh)", game: "swsh",
    slots: S(act(mon("Silvally-Water", "RKS System", { item: "Water Memory" }), "Multi-Attack", "opponent-left"), idle(conkeldurr), idle(snorlax), act(venusaur, "Energy Ball", "own-left")),
    checks: "Multi-Attack is Water with STAB; Energy Ball 2x into Silvally-Water.",
  },
];

/**
 * SA13, outside CASES: the Ice Face hit's own damage figure differed from Showdown's in generation 8 (the app kept the busted
 * form's calculation where the move is not neutral, doubles-turn.ts neutralRow: 10-14 against getDamage's 5-6). The
 * forms-iceface-fling fix calculates that hit at a neutral effectiveness in every generation; the same case is FI01 in CASES
 * (forms-iceface-fling/fix/cases-fif.ts), and matches.
 */
export const SA_FACE_CASES: Case[] = [
  {
    id: "SA13", title: "Ice Face takes Serene Grace Rock Smash and still drops its Defense for the partner's Hammer Arm (SwSh)", game: "swsh",
    slots: S(act(blissey, "Rock Smash", "opponent-left"), act(conkeldurr, "Hammer Arm", "opponent-left"), idle(mon("Eiscue", "Ice Face")), idle(venusaur)),
    checks: "The intact face takes no damage and Eiscue becomes Noice; the doubled drop lands (doubles-turn.ts faceHit): Hammer Arm at -1 Defense.",
  },
];

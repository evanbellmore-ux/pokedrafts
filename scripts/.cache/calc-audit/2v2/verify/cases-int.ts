// status-eot integration cases (build/INTEGRATION.md): one per engine fix the integrator made, each against pinned Showdown.
// Showdown names; level 50, 31 IVs, Serious nature and 0 EVs unless set (Speed at level 50 with 0 EVs is base + 20).
import type { Case, CaseAction, CaseMon, SlotId } from "./case-types";
import { chomp, lax, saur, toise, zard } from "./cases-s";

type Slot = CaseMon & { action: CaseAction };
const mon = (species: string, ability: string, extra: Partial<CaseMon> = {}): CaseMon => ({ species, ability, ...extra });
const act = (m: CaseMon, move: string | null, target?: SlotId): Slot => ({ ...m, action: { move, ...(target ? { target } : {}) } });
const idle = (m: CaseMon): Slot => act(m, null);
const slots = (ownLeft: Slot, ownRight: Slot, oppLeft: Slot, oppRight: Slot): Case["slots"] =>
  ({ "own-left": ownLeft, "own-right": ownRight, "opponent-left": oppLeft, "opponent-right": oppRight });
const PL: SlotId = "opponent-left", PR: SlotId = "opponent-right", OR: SlotId = "own-right";

export const INT_CASES: Case[] = [
  {
    id: "INT01", title: "A Figy Berry eaten as the turn starts confuses its holder before its move", game: "sv",
    slots: slots(act(zard({ nature: "Timid", item: "Figy Berry", hp: 30 }), "Flamethrower", PL), idle(toise()), idle(saur()), idle(lax())),
    checks: "Charizard 30/153 eats the Figy Berry at the turn's first Update (+51 = 81) and, Timid, is confused: its BeforeMove hurts it 33%.",
  },
  {
    id: "INT02", title: "A side with no Pokémon left is wiped out during the moves: the battle ends", game: "sv", canSwitch: { opponent: false }, outcomes: true,
    slots: slots(act(chomp({ nature: "Jolly", evs: { atk: 252, spe: 252 } }), "Rock Slide"), act(lax(), "Earthquake"), idle(mon("Gengar", "Cursed Body", { hp: 1 })), idle(mon("Jolteon", "Volt Absorb", { hp: 1 }))),
    checks: "Rock Slide knocks out both foes, whose side has no bench: checkWin ends the battle, so Snorlax's Earthquake never hits Garchomp.",
  },
  {
    id: "INT03", title: "Parting Shot's drops set off no Eject Pack (a later action follows)", game: "sv", canSwitch: { own: false }, outcomes: true,
    slots: slots(act(mon("Incineroar", "Blaze"), "Parting Shot", PL), idle(saur()), idle(chomp({ item: "Eject Pack" })), act(lax(), "Body Slam", OR)),
    checks: "Incineroar (80) cannot switch (no bench); Garchomp's Attack and Sp. Atk fall but its Eject Pack stays (onAfterBoost: activeMove partingshot); Snorlax's Body Slam follows.",
  },
  {
    id: "INT04a", title: "Electric Terrain does not stop a carried Yawn's sleep on a Dig user underground", game: "sv", field: { terrain: "Electric" }, outcomes: true,
    slots: slots(act(chomp({ hp: 150, carried: { yawn: true } }), "Dig", PL), idle(mon("Jolteon", "Volt Absorb")), idle(mon("Dragapult", "Clear Body")), idle(mon("Weavile", "Pressure"))),
    checks: "Garchomp (122, the last action) is semi-invulnerable on Dig's charge turn: electricterrain onSetStatus returns for it, so Yawn's sleep lands at order 23.",
  },
  {
    id: "INT04b", title: "Misty Terrain does not stop a carried Yawn's sleep on a Dig user underground", game: "sv", field: { terrain: "Misty" }, outcomes: true,
    slots: slots(act(chomp({ hp: 150, carried: { yawn: true } }), "Dig", PL), idle(mon("Jolteon", "Volt Absorb")), idle(mon("Dragapult", "Clear Body")), idle(mon("Weavile", "Pressure"))),
    checks: "As INT04a under Misty Terrain (mistyterrain onSetStatus: isSemiInvulnerable returns).",
  },
  {
    id: "INT05", title: "A Pokémon that faints loses its Substitute (E2)", game: "sv", outcomes: true,
    slots: slots(act(mon("Sylveon", "Pixilate"), "Hyper Voice"), idle(mon("Blissey", "Natural Cure")), idle(mon("Torkoal", "White Smoke")), idle(chomp({ hp: 1, substitute: 40 }))),
    checks: "Hyper Voice (sound) passes Garchomp's Substitute and knocks it out: faintMessages clears its volatiles, the Substitute too.",
  },
  {
    id: "INT06", title: "A carried Whirlpool trap: the residual is Whirlpool's", game: "sv",
    slots: slots(idle(mon("Milotic", "Marvel Scale")), idle(saur()), idle(lax({ hp: 150, carried: { trap: { source: "own-left", bindingBand: false, move: "Whirlpool" } } })), idle(toise())),
    checks: "Snorlax loses 1/8 (29) to Whirlpool at order 13 while Milotic is in.",
  },
];

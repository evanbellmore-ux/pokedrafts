// Engine fix cases (status-eot review fixes), in the 2v2 verify Case form. Showdown names; level 50, 31 IVs, Serious
// nature and 0 EVs unless set (Speed at level 50 with 0 EVs is base + 20).
import type { Case, CaseAction, CaseMon, SlotId } from "../../2v2/verify/case-types";
import { chomp, jolt, lax, saur, toise } from "../../2v2/verify/cases-s";

type Slot = CaseMon & { action: CaseAction };
const mon = (species: string, ability: string, extra: Partial<CaseMon> = {}): CaseMon => ({ species, ability, ...extra });
const act = (m: CaseMon, move: string | null, target?: SlotId): Slot => ({ ...m, action: { move, ...(target ? { target } : {}) } });
const idle = (m: CaseMon): Slot => act(m, null);
const slots = (ownLeft: Slot, ownRight: Slot, oppLeft: Slot, oppRight: Slot): Case["slots"] =>
  ({ "own-left": ownLeft, "own-right": ownRight, "opponent-left": oppLeft, "opponent-right": oppRight });
const OL: SlotId = "own-left", OR: SlotId = "own-right", PL: SlotId = "opponent-left", PR: SlotId = "opponent-right";
void OR; void PR; void jolt; void chomp;

export const FIX_CASES: Case[] = [
  // ---- One Pokémon's ability handlers come before its item's at an Update (ability subOrder 7, item 8): Teravolt's
  // Thunder Wave passes Limber's SetStatus, then Limber's onUpdate cures it before the Cheri Berry's onUpdate.
  {
    id: "FX01", title: "Teravolt Thunder Wave into a Limber Cheri Berry holder", game: "sv", outcomes: true,
    slots: slots(act(mon("Zekrom", "Teravolt"), "Thunder Wave", PL), idle(saur()), idle(mon("Hitmonlee", "Limber", { item: "Cheri Berry" })), idle(toise())),
    checks: "Limber cures the paralysis at the Update; the Cheri Berry stays.",
  },
  // ---- At the turn's first Update no move is active: Limber's onUpdate (an ability, subOrder 7) cures a carried
  // paralysis before the Cheri Berry's (an item, subOrder 8) can.
  {
    id: "FX01b", title: "A paralysed Limber Hitmonlee with a Cheri Berry starts the turn", game: "sv", outcomes: true,
    slots: slots(idle(saur()), idle(lax()), act(mon("Hitmonlee", "Limber", { item: "Cheri Berry", status: "par" }), "Close Combat", OL), idle(toise())),
    checks: "Limber cures the paralysis as the turn starts; the Cheri Berry stays; Close Combat always comes.",
  },
  // ---- The turn's first Update comes before generation 8+ sorts the first move: a Lum Berry curing paralysis there
  // gives the Pokémon its full Speed for the whole order.
  {
    id: "FX02", title: "Paralysed Garchomp with a Lum Berry against a faster-than-paralysed Venusaur", game: "sv",
    slots: slots(act(chomp({ status: "par", item: "Lum Berry", silentStatus: true }), "Dragon Claw", PL), idle(lax()), act(saur({ hp: 60 }), "Giga Drain", OL), idle(toise())),
    checks: "Lum cures Garchomp (122 Speed) before the sort: it moves before Venusaur (101) and knocks it out first.",
  },
  // ---- The same in generation 7: the queue was sorted at the turn's start with the paralysed Speed.
  // status2 Step 1 #9: both set the paralysis silently (silentStatus), so the oracle starts with the Lum held as the case says (its
  // setStatus had eaten the Lum at the setup: "Showdown item (none) at the start"); the Lum is eaten at the turn's first Update.
  {
    id: "FX02b", title: "USUM: paralysed Garchomp with a Lum Berry against Venusaur", game: "usum",
    slots: slots(act(chomp({ status: "par", item: "Lum Berry", silentStatus: true }), "Dragon Claw", PL), idle(lax()), act(saur({ hp: 60 }), "Giga Drain", OL), idle(toise())),
    checks: "Generation 7 sorts once with the paralysed Speed (61): Venusaur moves first.",
  },
  // ---- Immunity cures a carried bad poison at the turn's first Update (no residual).
  {
    id: "FX04", title: "Badly poisoned Immunity Snorlax uses Body Slam", game: "sv",
    slots: slots(act(lax({ ability: "Immunity", status: "tox", carried: { toxic: 3 } }), "Body Slam", PL), idle(saur()), idle(chomp()), idle(toise())),
    checks: "Immunity cures the poison as the turn starts: no bad poison at the end of turn.",
  },
  // ---- A Defiant foe's drop of Attack offset by Defiant's +2: the drop happened (Lash Out doubles).
  {
    id: "FX05", title: "Lunge into Defiant Kingambit, then Kingambit's Lash Out", game: "sv",
    slots: slots(act(mon("Hitmonlee", "Limber"), "Lunge", PL), idle(saur()), act(mon("Kingambit", "Defiant"), "Lash Out", OL), idle(toise())),
    checks: "Kingambit −1 then +2 Attack (net +1); its stats fell this turn: Lash Out has double power.",
  },
  // ---- adjacentAllyOrSelf aimed at the user's own position after its ally's Ally Switch: the ally stands there now.
  {
    id: "FX06", title: "Champions: Milk Drink at its own position after the ally's Ally Switch", game: "champions",
    slots: slots(act(mon("Gogoat", "Sap Sipper", { hp: 100 }), "Milk Drink", OL), act(mon("Alakazam", "Magic Guard", { hp: 100 }), "Ally Switch"), idle(lax()), idle(toise())),
    checks: "Alakazam (faster) stands at Gogoat's position: Milk Drink heals Alakazam.",
  },
  // ---- Perish Song with every Pokémon already counting fails (no new count, no block).
  {
    id: "FX07", title: "Perish Song with every Pokémon counting", game: "sv", outcomes: true,
    slots: slots(act(mon("Gengar", "Cursed Body", { carried: { perish: 2 } }), "Perish Song"), idle(saur({ carried: { perish: 2 } })), idle(lax({ carried: { perish: 3 } })), idle(toise({ carried: { perish: 3 } }))),
    checks: "Every Pokémon keeps its count; the move fails.",
  },
  // ---- Sparkling Aria with one target: Shield Dust keeps the secondary off, so no cure.
  {
    id: "FX08", title: "Sparkling Aria into a burned Shield Dust Pokémon alone", game: "sv",
    slots: slots(act(mon("Primarina", "Torrent"), "Sparkling Aria"), { ...idle(saur()), absent: true }, act(mon("Vivillon", "Shield Dust", { status: "brn" }), "Struggle Bug"), { ...idle(toise()), absent: true }),
    checks: "One target hit: the volatile needs the secondary; Shield Dust stops it, the burn stays.",
  },
  // ---- Sparkling Aria with two targets: the Shield Dust holder is cured anyway.
  {
    id: "FX08b", title: "Sparkling Aria into a burned Shield Dust Pokémon beside a foe", game: "sv",
    slots: slots(act(mon("Primarina", "Torrent"), "Sparkling Aria"), idle(saur()), act(mon("Vivillon", "Shield Dust", { status: "brn" }), "Struggle Bug"), idle(toise())),
    checks: "More than one target hit: the burn is cured whatever Shield Dust does.",
  },
  // ---- Mud-Slap into a Mirror Armor holder: the accuracy drop goes back to its user, whose Competitive rises.
  {
    id: "FX09", title: "Competitive Empoleon's Mud-Slap into Corviknight's Mirror Armor (Gravity grounds it)", game: "sv", outcomes: true, field: { gravity: true },
    slots: slots(act(mon("Empoleon", "Competitive"), "Mud-Slap", PL), idle(saur()), idle(mon("Corviknight", "Mirror Armor")), idle(toise())),
    checks: "Mirror Armor sends the accuracy drop back: Empoleon's Competitive +2 Sp. Atk (E2 builds).",
  },
  // ---- G-Max Tartness lowers every foe's evasion: a Defiant foe gets +2 Attack before it attacks.
  {
    id: "FX10", title: "SwSh: G-Max Tartness into Defiant Bisharp, which attacks later", game: "swsh",
    slots: slots(act(mon("Flapple", "Hustle", { choice: "dynamax", gigantamax: true, appBuild: { mechanic: "gigantamax", configuration: { dynamaxLevel: 10, gigantamax: true } } }), "Grav Apple", PL), idle(saur()), act(mon("Bisharp", "Defiant"), "Iron Head", OL), idle(toise())),
    checks: "Evasion −1 on each foe: Bisharp's Defiant +2 Attack for Iron Head.",
  },
];

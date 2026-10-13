// Review cases (lens: status-move engine), in the 2v2 verify Case form. Showdown names; level 50, 31 IVs, Serious nature
// and 0 EVs unless set (Speed at level 50 with 0 EVs is base + 20).
import type { Case, CaseAction, CaseMon, SlotId } from "../../../2v2/verify/case-types";
import { chomp, clef, gengar, jolt, lax, saur, toise, zard } from "../../../2v2/verify/cases-s";

type Slot = CaseMon & { action: CaseAction };
const mon = (species: string, ability: string, extra: Partial<CaseMon> = {}): CaseMon => ({ species, ability, ...extra });
const act = (m: CaseMon, move: string | null, target?: SlotId, context?: Record<string, unknown>): Slot =>
  ({ ...m, action: { move, ...(target ? { target } : {}), ...(context ? { context } : {}) } });
const idle = (m: CaseMon): Slot => act(m, null);
const slots = (ownLeft: Slot, ownRight: Slot, oppLeft: Slot, oppRight: Slot): Case["slots"] =>
  ({ "own-left": ownLeft, "own-right": ownRight, "opponent-left": oppLeft, "opponent-right": oppRight });
const OL: SlotId = "own-left", OR: SlotId = "own-right", PL: SlotId = "opponent-left", PR: SlotId = "opponent-right";
void OL; void OR; void PR; void chomp; void clef; void gengar; void jolt; void saur; void toise; void zard;

export const REVIEW_CASES: Case[] = [
  // ---- Berserk / Anger Shell: a confusion self-hit sets checkedBerserk false (onDamage, effectType Move), so the
  // healing Berry's TryEatItem fails at the action's Update (data/abilities.ts berserk onTryEatItem).
  {
    id: "RV01", title: "Confused Berserk Drampa with a Sitrus Berry hurts itself below half (No move)", game: "swsh",
    slots: slots(idle(mon("Drampa", "Berserk", { item: "Sitrus Berry", hp: 85, carried: { confusion: { attempts: 0 } } })), idle(lax()), idle(toise()), idle(saur())),
    checks: "Self-hit 12–15 from 85/153: below half; Berserk's TryEatItem stops the Sitrus at the Update.",
  },
  {
    id: "RV02", title: "Confused Anger Shell Klawf with a Sitrus Berry hurts itself below half (with a move)", game: "sv",
    slots: slots(act(mon("Klawf", "Anger Shell", { item: "Sitrus Berry", hp: 80, carried: { confusion: { attempts: 0 } } }), "Rock Slide"), idle(lax()), idle(toise()), idle(saur())),
    checks: "Self-hit from 80/140: below half; Anger Shell's TryEatItem stops the Sitrus.",
  },
  // ---- Eject Pack and accuracy drops: data/items.ts ejectpack onAfterBoost reads every lowered stat, accuracy included.
  {
    id: "RV03", title: "Sand Attack into an Eject Pack holder that attacks later", game: "sv",
    slots: slots(act(chomp(), "Sand Attack", PL), idle(saur()), act(lax({ item: "Eject Pack" }), "Body Slam", OL), idle(toise())),
    checks: "Snorlax's accuracy −1 sets off Eject Pack after Sand Attack: it switches out, so its Body Slam never comes.",
  },
  {
    id: "RV03b", title: "Sand Attack into an Eject Pack holder as the last action", game: "sv",
    slots: slots(act(chomp(), "Sand Attack", PL), idle(saur()), idle(lax({ item: "Eject Pack" })), idle(toise())),
    checks: "Snorlax switches out after the move: the end of turn has its replacement.",
  },
  // ---- Haze clears stages with no boost event: no Eject Pack.
  {
    id: "RV04", title: "Haze with a +1 Eject Pack holder that attacks later", game: "sv",
    slots: slots(act(mon("Milotic", "Marvel Scale"), "Haze"), idle(saur()), act(lax({ item: "Eject Pack", boosts: { atk: 1 } }), "Body Slam", OL), idle(toise())),
    checks: "clearBoosts runs no AfterBoost: Snorlax stays in and Body Slams at +0.",
  },
  // ---- Opportunist copies Defiant's +2 after Charm, though the target's net change is 0.
  {
    id: "RV05", title: "Charm into Defiant with an Opportunist foe: Stored Power after", game: "sv",
    slots: slots(act(jolt(), "Charm", PL), act(mon("Espathra", "Opportunist"), "Stored Power", PR), idle(mon("Kingambit", "Defiant")), idle(lax())),
    checks: "Kingambit −2 then Defiant +2 (net 0); Espathra's Opportunist copies +2 Attack at AfterMove: Stored Power 60.",
  },
  // ---- Illuminate (gen 9) keeps accuracy from falling.
  {
    id: "RV06", title: "Sand Attack into Illuminate", game: "sv",
    slots: slots(act(chomp(), "Sand Attack", PL), idle(saur()), idle(mon("Lanturn", "Illuminate")), idle(toise())),
    checks: "Illuminate onTryBoost deletes the accuracy drop.",
  },
];

REVIEW_CASES.push(
  // ---- Yawn into Comatose: yawn onTryHit reads target.status and runStatusImmunity('slp'), neither of which Comatose fails.
  {
    id: "RV07", title: "Yawn into a Comatose Komala", game: "sv", outcomes: true,
    slots: slots(act(lax(), "Yawn", PL), idle(saur()), idle(mon("Komala", "Comatose")), idle(toise())),
    checks: "Yawn starts on Komala (-start yawn); its sleep would fail at the next end of turn.",
  },
  // ---- Life Dew (allies, Water) into a Storm Drain ally: the ally's TryHit takes it.
  {
    id: "RV08", title: "Life Dew with a Storm Drain ally", game: "sv",
    slots: slots(act(mon("Primarina", "Torrent", { hp: 100 }), "Life Dew"), idle(mon("Gastrodon", "Storm Drain", { hp: 150 })), idle(lax()), idle(toise())),
    checks: "Gastrodon's Storm Drain: +1 Sp. Atk, no heal; Primarina heals round(maxhp/4).",
  },
  // ---- A bounced move has its dex priority (sim/battle-actions.ts useMove: dex.getActiveMove(move.id)), not Prankster's +1.
  {
    id: "RV09", title: "Prankster Taunt bounced by Magic Bounce at a user beside Armor Tail", game: "sv", outcomes: true,
    slots: slots(act(mon("Grimmsnarl", "Prankster"), "Taunt", PL), idle(mon("Farigiraf", "Armor Tail")), idle(mon("Hatterene", "Magic Bounce")), idle(lax())),
    checks: "The bounced Taunt has priority 0: Armor Tail does not stop it, Grimmsnarl is taunted.",
  },
  {
    id: "RV09b", title: "Prankster Taunt bounced by Magic Bounce into its user's side's Quick Guard", game: "sv", outcomes: true,
    slots: slots(act(mon("Grimmsnarl", "Prankster"), "Taunt", PL), act(mon("Hitmontop", "Intimidate"), "Quick Guard"), idle(mon("Hatterene", "Magic Bounce")), idle(lax())),
    checks: "Quick Guard (+3) first; the bounced Taunt has priority 0, so Quick Guard does not block it: Grimmsnarl is taunted.",
  },
  {
    id: "RV09c", title: "Prankster Taunt bounced by a Flying Magic Bounce holder under Psychic Terrain (SwSh)", game: "swsh", field: { terrain: "Psychic" }, outcomes: true,
    slots: slots(act(mon("Whimsicott", "Prankster"), "Taunt", PL), idle(saur()), idle(mon("Xatu", "Magic Bounce")), idle(lax())),
    checks: "Xatu is not grounded, so it bounces the Taunt; the bounced Taunt (priority 0) taunts grounded Whimsicott.",
  },
);

REVIEW_CASES.push(
  // ---- calculate.ts: Champions certain crits (critRatio 4: critMult[4] = 1, data/mods/champions inherits gen 9 getDamage).
  {
    id: "RV10", title: "Champions: Super Luck + Scope Lens Night Slash always crits", game: "champions",
    slots: slots(act(mon("Absol", "Super Luck", { item: "Scope Lens" }), "Night Slash", PL), idle(saur()), idle(lax()), idle(toise())),
    checks: "ratio 2 + 1 + 1 = 4: every hit critical.",
  },
  {
    id: "RV10b", title: "Champions: Focus Energy then Night Slash crits (+2 + 2 = 4)", game: "champions",
    slots: slots(act(mon("Absol", "Pressure"), "Focus Energy"), idle(saur()), idle(lax()), idle(toise())),
    checks: "Focus Energy only: no damage this turn (sanity).",
  },
);

REVIEW_CASES.push(
  {
    id: "RV10c", title: "SV: Super Luck + Scope Lens Night Slash always crits (text check)", game: "sv",
    slots: slots(act(mon("Honchkrow", "Super Luck", { item: "Scope Lens" }), "Night Slash", PL), idle(saur()), idle(lax()), idle(toise())),
    checks: "ratio 4: every hit critical; what does the turn say?",
  },
  {
    id: "RV10d", title: "Champions: Focus Energy, then the same Pokémon's ally... Dragon Cheer into a Dragon ally then Dragon Claw? (crit ratio 1+2=3, no crit)", game: "champions",
    slots: slots(act(mon("Absol", "Super Luck", { item: "Scope Lens" }), "Night Slash", PL), act(mon("Dragapult", "Clear Body"), "Dragon Cheer"), idle(lax()), idle(toise())),
    checks: "Dragon Cheer comes after Absol (Dragapult is faster? Dragapult 162 > Absol 95): no change for Absol's crit (already 4).",
  },
);

REVIEW_CASES.push(
  // ---- USUM Teleport (data/mods/gen7/moves.ts teleport: priority 0, selfSwitch false, onTry false): it always fails.
  {
    id: "RV11", title: "USUM: Teleport before a slower attacker", game: "usum",
    slots: slots(act(mon("Alakazam", "Magic Guard"), "Teleport"), idle(saur()), act(lax(), "Body Slam", OL), idle(toise())),
    checks: "Teleport fails in gen 7 (onTry false): Alakazam stays in and takes Body Slam.",
  },
  {
    id: "RV11b", title: "USUM: Teleport as the last action", game: "usum", field: { trickRoom: true },
    slots: slots(act(mon("Alakazam", "Magic Guard"), "Teleport"), idle(saur()), act(lax(), "Body Slam", OL), idle(toise())),
    checks: "Under Trick Room Snorlax moves first; Teleport fails; the end of turn is Alakazam's.",
  },
);

REVIEW_CASES.push(
  // ---- Mycelium Might (data/abilities.ts myceliummight onModifyMove: a status move gets ignoreAbility, as Mold Breaker's).
  {
    id: "RV12", title: "Mycelium Might Spore into Sap Sipper", game: "sv",
    slots: slots(act(mon("Toedscruel", "Mycelium Might"), "Spore", PL), idle(saur()), idle(mon("Azumarill", "Sap Sipper")), idle(toise())),
    checks: "Sap Sipper is ignored: Azumarill falls asleep.",
  },
  {
    id: "RV12b", title: "Mycelium Might Spore into Vital Spirit, and Thunder Wave... (Spore only)", game: "sv",
    slots: slots(act(mon("Toedscruel", "Mycelium Might"), "Spore", PL), idle(saur()), idle(mon("Annihilape", "Vital Spirit")), idle(toise())),
    checks: "Vital Spirit is ignored at SetStatus; at the action's final Update its onUpdate wakes it (as TA03's Limber).",
  },
);

REVIEW_CASES.push(
  // ---- Sparkling Aria cures the burn of each Pokémon it hit after the move (data/moves.ts sparklingaria onAfterMove).
  {
    id: "RV13", title: "Sparkling Aria into a burned Snorlax that attacks later", game: "sv",
    slots: slots(act(mon("Primarina", "Torrent"), "Sparkling Aria"), idle(chomp()), act(lax({ status: "brn" }), "Body Slam", OL), idle(toise())),
    checks: "Snorlax's burn is cured after Sparkling Aria: its Body Slam is not halved; no burn damage at the end of turn.",
  },
  {
    id: "RV13b", title: "Will-O-Wisp, then Sparkling Aria, then the burned Pokémon's physical move", game: "sv",
    slots: slots(act(mon("Primarina", "Torrent"), "Sparkling Aria"), act(mon("Gengar", "Cursed Body"), "Will-O-Wisp", PL), act(lax(), "Body Slam", OL), idle(toise())),
    checks: "Gengar (130) burns Snorlax, Primarina (100) cures it, Snorlax (52) Body Slams unhalved.",
  },
);

REVIEW_CASES.push(
  // ---- USUM Wake-Up Slap and Smelling Salts cure their target's status on a hit (data/moves.ts wakeupslap, smellingsalts onHit).
  {
    id: "RV14", title: "USUM: Wake-Up Slap into a sleeping Snorlax that attacks later", game: "usum",
    slots: slots(act(mon("Machamp", "Guts"), "Wake-Up Slap", PL), idle(saur()), act(lax({ status: "slp", hp: 235, carried: { sleep: { attempts: 0, rest: false } } }), "Body Slam", OL), idle(toise())),
    checks: "Wake-Up Slap (double power on a sleeper) wakes Snorlax: its Body Slam comes.",
  },
  {
    id: "RV14b", title: "USUM: Smelling Salts into a paralysed Snorlax that attacks later", game: "usum",
    slots: slots(act(mon("Machamp", "Guts"), "Smelling Salts", PL), idle(saur()), act(lax({ status: "par" }), "Body Slam", OL), idle(toise())),
    checks: "Smelling Salts cures the paralysis: no full paralysis for Snorlax's Body Slam.",
  },
);

REVIEW_CASES.push(
  // ---- Champions Milk Drink (adjacentAllyOrSelf) aimed at an ally that fainted this turn: sim/battle.ts getTarget returns
  // the user itself for adjacentAllyOrSelf at a fainted ally (gen != 5).
  {
    id: "RV15", title: "Champions: Milk Drink aimed at an ally that fainted earlier this turn", game: "champions",
    slots: slots(act(mon("Gogoat", "Sap Sipper", { hp: 100 }), "Milk Drink", OR), idle(lax({ hp: 1 })), act(mon("Dragapult", "Clear Body"), "Dragon Pulse", OR), idle(toise())),
    checks: "Dragapult knocks Snorlax out; Gogoat's Milk Drink then targets Gogoat and heals half its HP.",
  },
);

REVIEW_CASES.push(
  {
    id: "RV15b", title: "Champions: Milk Drink aimed at the ally's position after the ally's Ally Switch", game: "champions",
    slots: slots(act(mon("Gogoat", "Sap Sipper", { hp: 100 }), "Milk Drink", OR), act(mon("Alakazam", "Magic Guard", { hp: 100 }), "Ally Switch"), idle(lax()), idle(toise())),
    checks: "After Ally Switch Gogoat stands at the aimed position: adjacentAllyOrSelf there is the user itself (getAtLoc), so it heals Gogoat.",
  },
);

REVIEW_CASES.push(
  // ---- Performance: four confused, paralysed Pokémon with spread moves and Sitrus Berries (app timing only).
  {
    id: "RVP1", title: "Perf: four confused and paralysed Pokémon using spread moves", game: "sv", oracle: "modes",
    slots: slots(
      act(chomp({ status: "par", item: "Sitrus Berry", carried: { confusion: { attempts: 1 } } }), "Rock Slide"),
      act(lax({ status: "par", item: "Sitrus Berry", carried: { confusion: { attempts: 0 } } }), "Hyper Voice"),
      act(mon("Kingambit", "Defiant", { status: "par", item: "Sitrus Berry", carried: { confusion: { attempts: 2 } } }), "Snarl"),
      act(toise({ status: "par", item: "Sitrus Berry", carried: { confusion: { attempts: 0 } } }), "Water Spout")),
    checks: "timing",
  },
);

REVIEW_CASES.push(
  {
    id: "RV16", title: "Dynamic Punch into a Substitute, then the target attacks", game: "sv", outcomes: true,
    slots: slots(act(mon("Conkeldurr", "Guts"), "Dynamic Punch", PL), idle(saur()), act(lax({ substitute: 58 }), "Body Slam", OL), idle(toise())),
    checks: "The Substitute takes the hit: no confusion on Snorlax (secondaries need the Pokémon hit).",
  },
  {
    id: "RV16b", title: "Fire Punch into a frozen Pokémon behind a Substitute (SV)", game: "sv",
    slots: slots(act(mon("Hariyama", "Thick Fat"), "Fire Punch", PL), idle(saur()), act(lax({ status: "frz", substitute: 100 }), "Body Slam", OL), idle(toise())),
    checks: "frz onDamagingHit needs a hit on the Pokémon: behind the Substitute it stays frozen (1/5 thaw at its BeforeMove).",
  },
);

REVIEW_CASES.push(
  {
    id: "RV17", title: "Mud-Slap (100% accuracy −1) into Defiant Kingambit, which attacks later", game: "sv",
    slots: slots(act(mon("Excadrill", "Sand Rush"), "Mud-Slap", PL), idle(saur()), act(mon("Kingambit", "Defiant"), "Iron Head", OL), idle(toise())),
    checks: "The accuracy drop from a foe sets off Defiant: +2 Attack for Iron Head.",
  },
  {
    id: "RV17b", title: "Mud-Slap into an Eject Pack holder that attacks later", game: "sv",
    slots: slots(act(mon("Excadrill", "Sand Rush"), "Mud-Slap", PL), idle(saur()), act(lax({ item: "Eject Pack" }), "Body Slam", OL), idle(toise())),
    checks: "Eject Pack after the accuracy drop: Snorlax switches out (mid-turn switch; the oracle cannot run it).",
  },
);

REVIEW_CASES.push(
  {
    id: "RV18", title: "Axe Kick confusion carried with 2 attempts; Early Bird sleeper with 1 attempt (Champions)", game: "champions",
    slots: slots(act(chomp({ carried: { confusion: { attempts: 2, axeKick: true } } }), "Earthquake"), idle(saur()),
      act(mon("Houndoom", "Early Bird", { status: "slp", carried: { sleep: { attempts: 1, rest: false } } }), "Dark Pulse", OL), idle(toise())),
    checks: "Garchomp snaps out 1/3 at attempt 3; Dodrio (Early Bird, 1 attempt = 2 counted) wakes surely in Champions ({2,3,3}: S≤4).",
  },
  {
    id: "RV18b", title: "Rest sleep carried with 1 attempt, Early Bird (SV)", game: "sv",
    slots: slots(act(chomp({ status: "slp", ability: "Rough Skin", carried: { sleep: { attempts: 1, rest: true } } }), "Earthquake"), idle(saur()),
      act(mon("Dodrio", "Early Bird", { status: "slp", carried: { sleep: { attempts: 0, rest: true } } }), "Brave Bird", OL), idle(toise())),
    checks: "Garchomp Rest 3, e=1: wakes 1/2? (S=3: e=1 → after this BeforeMove 2 < 3: no; the hazard is 0); Dodrio Rest, Early Bird e=0 d=2: 3 ≤ 2 no.",
  },
);

REVIEW_CASES.push(
  // ---- Ring Target negates the Ground type's Electric immunity (sim/pokemon.ts runImmunity: NegateImmunity).
  {
    id: "RV19", title: "Thunder Wave into a Ground type holding Ring Target, which attacks later", game: "sv",
    slots: slots(act(jolt(), "Thunder Wave", PL), idle(saur()), act(chomp({ item: "Ring Target" }), "Dragon Claw", OL), idle(toise())),
    checks: "Garchomp is paralysed (Ring Target): its Dragon Claw is fully paralysed 1/4.",
  },
);

// status2 CR- cases (SPEC2 §1.1's critic probes critic-probes-1.ts, §7.2): CR-01 … CR-11 with the games SPEC2 §7.2 names.
// Where a probe's move is not in a game's app catalog the scenario keeps its point with another Pokémon or move (the checks
// say which). Wave 1a (Track V1); owners: A2 (CR-03, CR-07, CR-11), A1 (CR-04, CR-06, CR-08), D (CR-10), E1 (CR-01, CR-02,
// CR-05, CR-09). Showdown names; level 50, 31 IVs, Serious nature, 0 EVs unless set (Champions: Stat Points).
import type { Case, CaseMon, Game } from "./case-types";
import { OL, OR, PL, PR, act, carried, idle, lax, mon, slots } from "./case-kit";

const k = (game: Game, n: number) => (game === "champions" ? n : n * 8);
const fastSpe = (game: Game) => (game === "champions" ? 32 : 252);
const cases: Case[] = [];
const add = (id: string, game: Game, c: Omit<Case, "id" | "game">) => cases.push({ id: `${id}-${game}`, game, ...c });

// CR-01 (CR01, C3): Heal Block's turns left decide the end of turn. CR-02 (CR02, C4): Embargo's.
for (const [suffix, item, left] of [["a", "Sitrus Berry", 1], ["b", "Sitrus Berry", 2], ["c", "Leftovers", 1]] as const) {
  add(`CR-01${suffix}`, "sv", {
    title: `Snorlax at 100 HP holding ${item} under Heal Block with ${left} turn${left > 1 ? "s" : ""} left; everyone idle`, outcomes: true,
    slots: slots(idle(lax(8)), idle(lax(0)), idle(lax(16)), idle(carried(lax(24, { item, hp: 100 }), { healBlock: left }))),
    checks: "CR01: 1 left ends at residual 20, then the Sitrus is eaten at the final Update (+58); 2 left: nothing; Leftovers (5.4) before 20: no heal.",
  });
  add(`CR-02${suffix}`, "usum", {
    title: `USUM: Snorlax at 100 HP holding ${item} under Embargo with ${left} turn${left > 1 ? "s" : ""} left; everyone idle`, outcomes: true,
    slots: slots(idle(lax(8)), idle(lax(0)), idle(lax(16)), idle(carried(lax(24, { item, hp: 100 }), { embargo: left }))),
    checks: "CR02: the same for Embargo at residual 21.",
  });
}
// CR-03 (CR03, C2): Transform copies the set types and the added type, and the weight.
for (const game of ["sv", "champions"] as Game[]) {
  add("CR-03", game, {
    title: "Ditto Transforms into a Garchomp whose types were set to Water with an added Grass (earlier turns)", outcomes: true,
    slots: slots(act(mon("Ditto", "Limber", { evs: { spe: fastSpe(game) } }), "Transform", PR), idle(lax(k(game, 0))), idle(lax(k(game, 1))),
      idle(mon("Garchomp", "Rough Skin", { types: ["Water"], addedType: "Grass", moves: ["Dragon Claw"] }))),
    checks: "CR03: transformInto copies getTypes(true, true) and addedType: Ditto is Water/Grass, weight 950.",
  });
}
// CR-04 (CR04, C1): a snatched Swallow heals by the Snatch user's own layers and removes its Stockpile.
add("CR-04", "usum", {
  title: "USUM: Absol (2 Stockpile layers, 100 HP) Snatches Swalot's Swallow (1 layer, 100 HP)", outcomes: true,
  slots: slots(act(carried(mon("Absol", "Pressure", { evs: { spe: 252 }, hp: 100, boosts: { def: 2, spd: 2 } }), { stockpile: { layers: 2, def: -2, spd: -2 } }), "Snatch"), idle(lax(0)),
    idle(lax(8)), act(carried(mon("Swalot", "Sticky Hold", { hp: 100, boosts: { def: 1, spd: 1 } }), { stockpile: { layers: 1, def: -1, spd: -1 } }), "Swallow")),
  checks: "CR04: Absol heals half (to full), −2 Def −2 SpD, its Stockpile ends; Swalot keeps 1 layer and heals nothing.",
});
// CR-05 (CR05, C9): Octolock's drops set off Defiant per stat; the Octolock user's ally Opportunist copies the rise at 29.
add("CR-05", "champions", {
  title: "Champions: Grapploct's Octolock into a Defiant Kingambit; Grapploct's ally Espathra (Opportunist)", outcomes: true,
  slots: slots(act(mon("Grapploct", "Technician"), "Octolock", PR), idle(mon("Espathra", "Opportunist")), idle(lax(1)), idle(mon("Kingambit", "Defiant"))),
  checks: "CR05: −1/−1 at 14, Defiant +2 twice (+4 Atk); Espathra copies +4 Atk at 29.",
});
add("CR-05", "swsh", {
  title: "SwSh: Grapploct's Octolock into a Defiant Bisharp (no Opportunist in SwSh)", outcomes: true,
  slots: slots(act(mon("Grapploct", "Technician"), "Octolock", PR), idle(lax(0)), idle(lax(8)), idle(mon("Bisharp", "Defiant"))),
  checks: "CR05 without the copy: Defiant +2 per stat at 14.",
});
// CR-06 (CR06, C10): a mid-turn Intimidate's drop is stopped by Mist; Mirror Armor reflects it first.
add("CR-06", "sv", {
  title: "Wyrdeer's Skill Swap gives Snorlax Intimidate mid-turn: its drop on Wyrdeer is stopped by Wyrdeer's side's Mist; Corviknight's Mirror Armor reflects its drop", outcomes: true,
  field: { own: { mist: true } },
  slots: slots(act(mon("Wyrdeer", "Intimidate", { evs: { spe: 252 } }), "Skill Swap", PR), idle(mon("Corviknight", "Mirror Armor")), idle(lax(8)), idle(lax(0))),
  checks: "CR06 (Skill Swap in place of Entrainment, which no Intimidate holder learns in SV): Mist holds for an ability's drop; Snorlax −1 Atk from the reflection.",
});
add("CR-06", "swsh", {
  title: "SwSh: Alakazam Role Plays the foe Incineroar's Intimidate mid-turn: its drop on Incineroar is stopped by Mist; Corviknight's Mirror Armor reflects it", outcomes: true,
  field: { opponent: { mist: true } },
  slots: slots(act(mon("Alakazam", "Inner Focus", { evs: { spe: 252 } }), "Role Play", PR), idle(lax(0)), idle(mon("Corviknight", "Mirror Armor")), idle(mon("Incineroar", "Intimidate"))),
  checks: "CR06's point in SwSh (Role Play): Mist stops the drop on Incineroar, Mirror Armor sends Corviknight's back to Alakazam.",
});
// CR-07 (CR07, C11): grounding: Smack Down, Ingrain, Magnet Rise before an Earthquake.
for (const game of ["sv", "usum"] as Game[]) {
  add("CR-07a", game, {
    title: "Smeargle's Smack Down into Skarmory, then Skarmory's ally Garchomp's Earthquake hits it",
    slots: slots(act(mon("Smeargle", "Own Tempo", { evs: { spe: 252 } }), "Smack Down", PR), idle(lax(0)), act(mon("Garchomp", "Rough Skin"), "Earthquake"), idle(mon("Skarmory", "Sturdy"))),
    checks: "CR07: grounded by Smack Down: Earthquake 2x into Skarmory (80).",
  });
  add("CR-07b", game, {
    title: "Control: Smeargle idle; Garchomp's Earthquake: Skarmory immune",
    slots: slots(idle(mon("Smeargle", "Own Tempo", { evs: { spe: 252 } })), idle(lax(0)), act(mon("Garchomp", "Rough Skin"), "Earthquake"), idle(mon("Skarmory", "Sturdy"))),
    checks: "The control: a Flying type is immune.",
  });
  add("CR-07d", game, {
    title: "Magnezone's Magnet Rise, then its ally Hippowdon's Earthquake: immune",
    slots: slots(idle(lax(8)), idle(lax(0)), act(mon("Hippowdon", "Sand Force"), "Earthquake"), act(mon("Magnezone", "Sturdy", { evs: { spe: 252 } }), "Magnet Rise")),
    checks: "CR07: Magnet Rise lifts it before the Earthquake (otherwise 4x).",
  });
}
add("CR-07c", "usum", {
  title: "USUM: Celesteela's Ingrain, then its ally Hippowdon's Earthquake hits it (no Flying Ingrain user in SV)",
  slots: slots(idle(lax(8)), idle(lax(0)), act(mon("Hippowdon", "Sand Force"), "Earthquake"), act(mon("Celesteela", "Beast Boost", { evs: { spe: 252 } }), "Ingrain")),
  checks: "CR07: Ingrain grounds a Flying type: Earthquake hits.",
});
// CR-08 (CR08, C7): a foe's start Liechi; Opportunist's copy and Opportunist's End deleting it (Gastro Acid, Skill Swap).
for (const [suffix, move] of [["a", null], ["b", "Gastro Acid"], ["c", "Skill Swap"]] as const) {
  add(`CR-08${suffix}`, "sv", {
    title: `A foe Garchomp eats its Liechi Berry at the turn's first Update; Espathra (Opportunist, slow)${move ? ` after its partner's ${move} on it` : ""}`, outcomes: true,
    slots: slots(idle(mon("Espathra", "Opportunist", { ivs: { spe: 0 }, nature: "Brave" })), move ? act(mon("Smeargle", "Own Tempo", { evs: { spe: 252 } }), move, OL) : idle(mon("Smeargle", "Own Tempo", { evs: { spe: 252 } })),
      idle(lax(8)), idle(mon("Garchomp", "Rough Skin", { item: "Liechi Berry", hp: 40 }))),
    checks: move ? "CR08: Opportunist's End deletes the pending copy: no +1 Atk." : "CR08 control: the copy (+1 Atk) at the first AfterMove.",
  });
}
// CR-09 (CR09, C8): Teatime in sun, Harvest, and a faster Pickup taking the Berry first.
for (const [suffix, partner] of [["a", mon("Ambipom", "Pickup")], ["b", lax(8)]] as [string, CaseMon][]) {
  add(`CR-09${suffix}`, "sv", {
    title: `Polteageist's Teatime in sun; Trevenant (Harvest, Sitrus) at 120 HP; ${suffix === "a" ? "a faster Ambipom (Pickup) beside it" : "a Snorlax beside it (control)"}`, outcomes: true,
    field: { weather: "Sun" },
    slots: slots(act(mon("Polteageist", "Cursed Body", { evs: { spe: 252 } }), "Teatime"), idle(lax(0)), idle(partner), idle(mon("Trevenant", "Harvest", { item: "Sitrus Berry", hp: 120 }))),
    checks: suffix === "a" ? "CR09: one Speed-sorted 28.2 group: Pickup takes the Sitrus first, Harvest then fails." : "CR09 control: Harvest restores the Sitrus in sun.",
  });
}
add("CR-09a", "champions", {
  title: "Champions: the same with Dedenne (Pickup) beside Trevenant", outcomes: true,
  field: { weather: "Sun" },
  slots: slots(act(mon("Polteageist", "Cursed Body", { evs: { spe: 32 } }), "Teatime"), idle(lax(0)), idle(mon("Dedenne", "Pickup")), idle(mon("Trevenant", "Harvest", { item: "Sitrus Berry", hp: 120 }))),
  checks: "CR09 in Champions (Trevenant and Dedenne).",
});
// CR-10 (CR10, C5, C6): Minimize and Glaive Rush ×2 each under Reflect; CR10b: the drawback ends at the holder's BeforeMove.
for (const game of ["sv", "champions"] as Game[]) {
  for (const [suffix, extra] of [["a", { minimize: true, glaiveRush: true }], ["b", { minimize: true }], ["c", { glaiveRush: true }], ["d", {}]] as const) {
    add(`CR-10${suffix}`, game, {
      title: `Snorlax's Body Slam into a slower Snorlax under Reflect, the target with ${suffix === "a" ? "Minimize and Glaive Rush" : suffix === "b" ? "Minimize" : suffix === "c" ? "Glaive Rush" : "neither"} from last turn`,
      field: { opponent: { reflect: true } },
      slots: slots(act(lax(fastSpe(game), { evs: { atk: fastSpe(game), spe: fastSpe(game) } }), "Body Slam", PL), idle(lax(0)), idle(carried(lax(k(game, 2)), extra)), idle(lax(k(game, 1)))),
      checks: "CR10: takenMods: Minimize ×2 and Glaive Rush ×2 stack (×4) in the final chain.",
    });
  }
  add("CR-10e", game, {
    title: "The Glaive Rush holder (faster) uses No move before Snorlax's Body Slam: the drawback is gone",
    slots: slots(act(lax(0, { evs: { atk: fastSpe(game) } }), "Body Slam", PR), idle(lax(k(game, 1))), idle(lax(k(game, 2))), idle(carried(mon("Garchomp", "Sand Veil", { evs: { hp: fastSpe(game) } }), { glaiveRush: true }))),
    checks: "CR10b: glaiverush onBeforeMovePriority 100 removes it, for No move too.",
  });
}
// CR-11 (CR11): Heal Bell cures a sleeping ally whose Nightmare then ends silently.
for (const [suffix, move] of [["a", "Heal Bell"], ["b", null]] as const) {
  add(`CR-11${suffix}`, "usum", {
    title: `USUM: Snorlax asleep with Nightmare; its ally Blissey ${move ? "uses Heal Bell first" : "idle (control)"}`, outcomes: true,
    slots: slots(idle(lax(8)), idle(lax(0)), act(carried(lax(16, { status: "slp" }), { nightmare: true }), "Tackle", OR), move ? act(mon("Blissey", "Natural Cure", { evs: { spe: 252 } }), move) : idle(mon("Blissey", "Natural Cure", { evs: { spe: 252 } }))),
    checks: move ? "CR11: cured, Nightmare ends silently, it then moves." : "CR11 control: −58 at residual 11.",
  });
}

/** SPEC2's CR- cases. */
export const CR_CASES: Case[] = cases;
void OR; void PL;

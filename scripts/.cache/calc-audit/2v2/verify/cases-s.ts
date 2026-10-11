// status-eot SPEC §7.1 "Status (S)" cases, with ADDENDUM §8's S48 change. Showdown names; level 50, 31 IVs, Serious nature
// and 0 EVs unless set (Speed at level 50 with 0 EVs is base + 20). Smeargle (Technician, which changes no status move)
// stands in for a user that has to learn a rare move. Every case runs through the end of the turn (sim-dfs.ts), so each also
// checks its end of turn. Ids: S<row><variant>[-<game>].
import type { Case, CaseAction, CaseMon, SlotId } from "./case-types";

type Slot = CaseMon & { action: CaseAction };
type Game = Case["game"];
const mon = (species: string, ability: string, extra: Partial<CaseMon> = {}): CaseMon => ({ species, ability, ...extra });
const act = (m: CaseMon, move: string | null, target?: SlotId, context?: Record<string, unknown>): Slot =>
  ({ ...m, action: { move, ...(target ? { target } : {}), ...(context ? { context } : {}) } });
const idle = (m: CaseMon): Slot => act(m, null);
const slots = (ownLeft: Slot, ownRight: Slot, oppLeft: Slot, oppRight: Slot): Case["slots"] =>
  ({ "own-left": ownLeft, "own-right": ownRight, "opponent-left": oppLeft, "opponent-right": oppRight });
const w = (m: CaseMon, extra: Partial<CaseMon>): CaseMon => ({ ...m, ...extra });
const OL: SlotId = "own-left", OR: SlotId = "own-right", PL: SlotId = "opponent-left", PR: SlotId = "opponent-right";

/** Smeargle with `spe` Speed EVs (0: 95, 4: 96, 252: 127; Jolly 252: 139). */
export const sm = (spe = 0, extra: Partial<CaseMon> = {}) => mon("Smeargle", "Technician", { evs: { spe }, ...extra });
const fastSm = (extra: Partial<CaseMon> = {}) => sm(252, { nature: "Jolly", ...extra });
// Speeds with 0 EVs: Snorlax 51 (4 EVs; 12 EVs: 52), Venusaur 101 (4 EVs; 12 EVs: 102), Blastoise 98, Garchomp 122,
// Charizard 120, Gengar 130, Jolteon 150, Clefable 80, Kingambit 70, Amoonguss 50, Breloom 90, Dragonite 100, Milotic Timid 252 146.
export const lax = (extra: Partial<CaseMon> = {}) => mon("Snorlax", "Thick Fat", { evs: { spe: 4 }, ...extra });
export const saur = (extra: Partial<CaseMon> = {}) => mon("Venusaur", "Overgrow", { evs: { spe: 4 }, ...extra });
export const toise = (extra: Partial<CaseMon> = {}) => mon("Blastoise", "Torrent", extra);
export const chomp = (extra: Partial<CaseMon> = {}) => mon("Garchomp", "Rough Skin", extra);
export const zard = (extra: Partial<CaseMon> = {}) => mon("Charizard", "Blaze", extra);
export const gengar = (extra: Partial<CaseMon> = {}) => mon("Gengar", "Cursed Body", extra);
export const jolt = (extra: Partial<CaseMon> = {}) => mon("Jolteon", "Volt Absorb", extra);
export const clef = (extra: Partial<CaseMon> = {}) => mon("Clefable", "Magic Guard", extra);
const guard = (extra: Partial<CaseMon> = {}) => mon("Milotic", "Competitive", { evs: { spe: 252 }, nature: "Timid", ...extra });
const games = <T,>(list: readonly Game[], f: (g: Game) => T): T[] => list.map(f);

export const S_CASES: Case[] = [
  // ---- S01: sleep from a move this turn: no wake at the first BeforeMove; Early Bird wakes 1/3.
  ...games(["sv", "champions", "usum", "swsh"], (game) => ({
    id: `S01a-${game}`, title: `Hypnosis into a slower attacker (${game})`, game,
    slots: slots(act(gengar(), "Hypnosis", PL), idle(saur()), act(lax(), "Body Slam", OR), idle(toise())),
    checks: "Gengar (130) puts Snorlax to sleep; a sleep from this turn lasts 2+ BeforeMoves, so Body Slam never comes (cant slp). End of turn: asleep.",
  })),
  ...games(["sv", "champions", "usum", "swsh"], (game) => ({
    id: `S01b-${game}`, title: `Hypnosis into an Early Bird attacker (${game})`, game,
    slots: slots(act(gengar(), "Hypnosis", PL), idle(saur()),
      act(game === "sv" ? mon("Houndoom", "Early Bird") : mon("Kangaskhan", "Early Bird"), game === "sv" ? "Dark Pulse" : "Body Slam", OR), idle(toise())),
    checks: "Early Bird spends 2 per BeforeMove: S = 2 wakes at once (1/3: native {2,3,4}, Champions {2,3,3}), then it attacks Venusaur.",
  })),
  // ---- S02: powder and terrain blocks.
  {
    id: "S02a", title: "Spore into Grass and Overcoat", game: "sv",
    slots: slots(act(mon("Amoonguss", "Regenerator"), "Spore", PL), act(mon("Breloom", "Technician"), "Spore", PR), idle(saur()), idle(mon("Cloyster", "Overcoat", { evs: { spe: 4 } }))),
    checks: "Grass types and Overcoat are immune to powder (gen 6+): -immune, no sleep.",
  },
  {
    id: "S02b", title: "Spore into Safety Goggles and onto Electric Terrain", game: "sv", field: { terrain: "Electric" },
    slots: slots(act(mon("Amoonguss", "Regenerator"), "Spore", PL), act(mon("Breloom", "Technician"), "Spore", PR), idle(lax({ item: "Safety Goggles" })), idle(toise())),
    checks: "Safety Goggles: immune. Electric Terrain: a grounded Blastoise cannot fall asleep.",
  },
  {
    id: "S02c", title: "Spore under Electric Terrain into a Flying foe", game: "sv", field: { terrain: "Electric" },
    slots: slots(act(mon("Amoonguss", "Regenerator"), "Spore", PL), idle(lax()), act(zard(), "Flamethrower", OR), idle(toise())),
    checks: "Charizard (120) uses Flamethrower first; it is not grounded, so Electric Terrain does not stop the Spore: it falls asleep.",
  },
  {
    id: "S02d", title: "Spore under Misty Terrain, grounded and Flying", game: "sv", field: { terrain: "Misty" },
    slots: slots(act(mon("Amoonguss", "Regenerator"), "Spore", PL), act(mon("Breloom", "Technician"), "Spore", PR), act(mon("Dragonite", "Inner Focus"), "Dragon Claw", OL), idle(toise())),
    checks: "Misty Terrain stops status on grounded Blastoise; Dragonite (Flying) falls asleep after its Dragon Claw (100 > 90 > 50).",
  },
  {
    id: "S02e-champions", title: "Sleep Powder into Grass and Overcoat (Champions)", game: "champions",
    slots: slots(act(saur(), "Sleep Powder", PL), act(mon("Vileplume", "Chlorophyll"), "Sleep Powder", PR), idle(mon("Venusaur", "Chlorophyll", { evs: { spe: 12 } })), idle(mon("Forretress", "Overcoat"))),
    checks: "Champions: powder immunity of a Grass type and of Overcoat.",
  },
  // ---- S03: curing Berries at the action's Update; Unnerve.
  {
    id: "S03a", title: "Sleep Powder into a Chesto Berry holder that moves later", game: "sv",
    slots: slots(act(saur(), "Sleep Powder", PL), idle(toise()), act(lax({ item: "Chesto Berry" }), "Body Slam", OR), idle(chomp())),
    checks: "Chesto Berry cures the sleep at the Update after Sleep Powder; Snorlax's Body Slam then hits Blastoise.",
  },
  {
    id: "S03b", title: "Thunder Wave into a Lum Berry holder", game: "sv",
    slots: slots(act(jolt(), "Thunder Wave", PL), idle(toise()), act(lax({ item: "Lum Berry" }), "Body Slam", OR), idle(chomp())),
    checks: "Lum Berry cures the paralysis at once: no full paralysis, Body Slam always.",
  },
  {
    id: "S03c", title: "Thunder Wave into a Lum Berry holder, a foe's Unnerve", game: "sv",
    slots: slots(act(jolt(), "Thunder Wave", PL), idle(mon("Tyranitar", "Unnerve")), act(lax({ item: "Lum Berry" }), "Body Slam", OR), idle(chomp())),
    checks: "Tyranitar's Unnerve stops the Lum Berry: Snorlax stays paralysed, Body Slam 3/4; end of turn: still paralysed, Lum kept.",
  },
  // ---- S04: Yawn this turn; carried Yawn → sleep at 23 → Bad Dreams → Lum at the final Update.
  {
    id: "S04a", outcomes: true, title: "Yawn this turn", game: "sv",
    slots: slots(act(lax(), "Yawn", PL), idle(toise()), act(chomp(), "Dragon Claw", OR), idle(saur())),
    checks: "Garchomp drowsy: no sleep at this end of turn (yawn volatile after the turn).",
  },
  {
    id: "S04b", title: "A Yawn from last turn, Bad Dreams, then Lum Berry", game: "sv",
    slots: slots(idle(mon("Darkrai", "Bad Dreams")), idle(toise()), idle(lax({ item: "Lum Berry", carried: { yawn: true } })), idle(saur())),
    checks: "Yawn ends at 23: Snorlax falls asleep and its Lum Berry cures it at once (AfterSetStatus), before Bad Dreams (28.2): no Bad Dreams damage.",
  },
  {
    id: "S04c", title: "A Yawn from last turn, then Bad Dreams", game: "sv",
    slots: slots(idle(mon("Darkrai", "Bad Dreams")), idle(toise()), idle(lax({ carried: { yawn: true } })), idle(saur())),
    checks: "Yawn ends at 23: Snorlax falls asleep; Bad Dreams (28.2) takes 1/8 of the new sleeper.",
  },
  // ---- S05: Thunder Wave on a faster foe: re-sort from gen 8, frozen gen 7; 1/4 vs 1/8.
  ...games(["sv", "champions", "usum", "swsh"], (game) => ({
    id: `S05-${game}`, title: `Thunder Wave on a faster foe (${game})`, game,
    slots: slots(act(jolt(), "Thunder Wave", PL), act(saur(), "Giga Drain", PL), act(gengar(), "Shadow Ball", OR), idle(lax())),
    checks: "Gengar 130 → 65 paralysed: Venusaur (101) moves before it from gen 8; gen 7 keeps the start order. Full paralysis 1/4 (Champions 1/8).",
  })),
  // ---- S06: Thunder Wave immunities, absorption, redirection.
  {
    id: "S06a", title: "Thunder Wave into Ground and Electric", game: "sv",
    slots: slots(act(jolt(), "Thunder Wave", PL), act(clef(), "Thunder Wave", PR), idle(chomp()), idle(mon("Magnezone", "Sturdy", { evs: { spe: 12 } }))),
    checks: "Ground: immune (ignoreImmunity false). Electric: immune from gen 6.",
  },
  {
    id: "S06b", title: "Thunder Wave into Limber and Volt Absorb", game: "sv",
    slots: slots(act(clef(), "Thunder Wave", PL), act(mon("Magnezone", "Sturdy", { evs: { spe: 12 } }), "Thunder Wave", PR), idle(mon("Hawlucha", "Limber")), idle(jolt({ hp: 100 }))),
    checks: "Limber: no paralysis. Volt Absorb: Jolteon at 100 heals a quarter.",
  },
  {
    id: "S06c", title: "Thunder Wave into Motor Drive", game: "sv",
    slots: slots(act(clef(), "Thunder Wave", PL), idle(lax()), idle(mon("Electivire", "Motor Drive")), idle(toise())),
    checks: "Motor Drive absorbs it: Speed +1.",
  },
  {
    id: "S06d", title: "Thunder Wave redirected by a Lightning Rod partner", game: "sv",
    slots: slots(act(clef(), "Thunder Wave", PL), idle(lax()), idle(toise()), idle(mon("Raichu", "Lightning Rod"))),
    checks: "Raichu's Lightning Rod takes the Thunder Wave aimed at Blastoise: Sp. Atk +1, Blastoise unharmed.",
  },
  // ---- S07: type rules.
  {
    id: "S07a", title: "Glare into a Ghost, Stun Spore into a Grass type", game: "sv",
    slots: slots(act(mon("Dudunsparce", "Run Away"), "Glare", PL), act(mon("Amoonguss", "Regenerator"), "Stun Spore", PR), idle(gengar()), idle(saur())),
    checks: "Glare paralyses Gengar (no type immunity); Stun Spore is powder: Venusaur is immune.",
  },
  {
    id: "S07b", title: "Poison Powder into Steel; Corrosion Toxic into Steel", game: "sv",
    slots: slots(act(mon("Vileplume", "Chlorophyll"), "Poison Powder", PL), act(mon("Salazzle", "Corrosion"), "Toxic", PR), idle(mon("Magnezone", "Sturdy")), idle(mon("Kingambit", "Defiant", { evs: { spe: 4 } }))),
    checks: "Steel is immune to poison; Corrosion badly poisons Kingambit (stage 0 → 1/16 at the end of turn).",
  },
  // ---- S08: burn halving; absorbers.
  {
    id: "S08a", title: "Will-O-Wisp, then the burned attacker hits", game: "sv",
    slots: slots(act(gengar(), "Will-O-Wisp", PL), idle(lax()), act(chomp(), "Dragon Claw", OR), idle(toise())),
    checks: "Burned Garchomp's Dragon Claw is halved; burn 1/16 at the end of turn.",
  },
  {
    id: "S08b", title: "Will-O-Wisp into Guts and Facade users", game: "sv",
    slots: slots(act(gengar(), "Will-O-Wisp", PR), idle(mon("Corviknight", "Pressure")), act(mon("Ursaluna", "Guts", { status: "brn" }), "Facade", OR), act(lax(), "Facade", OR)),
    checks: "Burned Ursaluna (from before the turn): Guts ×1.5 and Facade's double power, no halving; Snorlax burned by Will-O-Wisp: Facade doubles and ignores the halving (gen 6+). Both into Corviknight; burn 1/16 each.",
  },
  {
    id: "S08c", title: "Will-O-Wisp into Flash Fire and Well-Baked Body", game: "sv",
    slots: slots(act(gengar(), "Will-O-Wisp", PL), act(zard(), "Will-O-Wisp", PR), idle(mon("Arcanine", "Flash Fire")), idle(mon("Dachsbun", "Well-Baked Body", { evs: { spe: 4 } }))),
    checks: "Flash Fire absorbs it (flash fire volatile); Well-Baked Body: Defense +2.",
  },
  {
    id: "S08d", title: "Will-O-Wisp into Water Veil", game: "sv",
    slots: slots(act(gengar(), "Will-O-Wisp", PL), idle(lax()), idle(mon("Floatzel", "Water Veil")), idle(toise())),
    checks: "Water Veil: no burn.",
  },
  // ---- S09: setStatus rules.
  {
    id: "S09a", outcomes: true, title: "Toxic and Toxic Thread", game: "sv",
    slots: slots(act(gengar(), "Toxic", PL), act(mon("Ariados", "Insomnia"), "Toxic Thread", PR), idle(lax()), idle(chomp())),
    checks: "Toxic: badly poisoned, 1/16 at this end of turn; Toxic Thread: Speed −1 and poison 1/8.",
  },
  {
    id: "S09b", title: "Poison Gas into Purifying Salt and Immunity", game: "sv",
    slots: slots(act(sm(), "Poison Gas"), idle(saur()), idle(mon("Garganacl", "Purifying Salt")), idle(mon("Snorlax", "Immunity", { evs: { spe: 12 } }))),
    checks: "Purifying Salt and Immunity: no poison on either foe.",
  },
  {
    id: "S09c", title: "Thunder Wave into Synchronize", game: "sv",
    slots: slots(act(clef(), "Thunder Wave", PL), idle(lax()), idle(mon("Espeon", "Synchronize")), idle(toise())),
    checks: "Synchronize passes the paralysis back to Clefable.",
  },
  {
    id: "S09d-champions", title: "Toxic Thread and Toxic (Champions)", game: "champions",
    slots: slots(act(mon("Ariados", "Insomnia"), "Toxic Thread", PL), act(gengar(), "Toxic", PR), idle(chomp()), idle(lax())),
    checks: "Champions Toxic Thread and Toxic; end of turn poison and bad poison.",
  },
  {
    id: "S09e-swsh", title: "Toxic into a Pastel Veil ally (SwSh)", game: "swsh",
    slots: slots(act(gengar(), "Toxic", PL), idle(lax()), idle(saur()), idle(mon("Rapidash-Galar", "Pastel Veil"))),
    checks: "Pastel Veil protects its ally from poison.",
  },
  // ---- S10: confusion from this turn, the self-hit's 16 rolls.
  ...games(["sv", "champions", "usum"], (game) => ({
    id: `S10-${game}`, title: `Confuse Ray, then the target attacks (${game})`, game,
    slots: slots(act(gengar(), "Confuse Ray", PL), idle(lax()), act(chomp(), "Dragon Claw", OR), idle(toise())),
    checks: "A fresh confusion cannot end at its first BeforeMove: 33% self-hit (16 rolls; lowest/highest walks), 67% Dragon Claw.",
  })),
  // ---- S11: Swagger, Flatter; Own Tempo, Safeguard, Misty Terrain.
  {
    id: "S11a", title: "Swagger, then the target attacks", game: "sv",
    slots: slots(act(fastSm(), "Swagger", PL), idle(lax()), act(chomp(), "Dragon Claw", OR), idle(toise())),
    checks: "Smeargle (139) first: Attack +2 then confusion; the self-hit and Dragon Claw both at +2.",
  },
  {
    id: "S11b", title: "Flatter; Swagger into Own Tempo", game: "sv",
    slots: slots(act(fastSm(), "Flatter", PL), act(sm(), "Swagger", PR), act(zard(), "Ember", OR), idle(mon("Indeedee-F", "Own Tempo"))),
    checks: "Flatter: Sp. Atk +1 and confusion on Charizard (its Ember +1); Own Tempo: Indeedee gets Attack +2, no confusion.",
  },
  {
    id: "S11c", title: "Swagger into Safeguard", game: "sv",
    slots: slots(act(sm(), "Swagger", PL), idle(lax()), act(chomp(), "Dragon Claw", OR), act(guard(), "Safeguard")),
    checks: "Milotic's Safeguard (146) first: Swagger's Attack +2 lands, the confusion does not.",
  },
  {
    id: "S11d", title: "Swagger on Misty Terrain", game: "sv", field: { terrain: "Misty" },
    slots: slots(act(fastSm(), "Swagger", PL), idle(lax()), act(chomp(), "Dragon Claw", OR), idle(toise())),
    checks: "Misty Terrain: no confusion on grounded Garchomp; Attack +2 lands.",
  },
  // ---- S12: the self-hit's Damage event.
  {
    id: "S12a", title: "Confusion self-hit into Sturdy and Focus Sash", game: "sv",
    slots: slots(act(gengar(), "Confuse Ray", PL), act(mon("Dragapult", "Clear Body"), "Confuse Ray", PR),
      act(mon("Donphan", "Sturdy", { boosts: { atk: 6, def: -6 } }), "Defense Curl"), act(chomp({ item: "Focus Sash", boosts: { atk: 6, def: -6 } }), "Swords Dance")),
    checks: "+6 Attack, −6 Defense: a self-hit would knock either out from full HP; Sturdy leaves Donphan at 1, the Focus Sash leaves Garchomp at 1 and is used.",
  },
  {
    id: "S12b", title: "Confusion self-hit with Magic Guard and a Sitrus Berry", game: "sv",
    slots: slots(act(gengar(), "Confuse Ray", PL), idle(lax()), act(clef({ item: "Sitrus Berry", hp: 110, boosts: { atk: 6 } }), "Moonblast", OL), idle(toise())),
    checks: "Magic Guard does not stop the self-hit; Sitrus Berry at the Update after it when at half or less.",
  },
  {
    id: "S12c", title: "Assurance after a confusion self-hit", game: "sv",
    slots: slots(act(gengar(), "Confuse Ray", PL), act(mon("Kingambit", "Defiant"), "Assurance", PL), act(chomp(), "Dragon Claw", OR), idle(toise())),
    checks: "The self-hit hurts Garchomp: Kingambit's Assurance (70) doubles on those paths.",
  },
  // ---- S13: Teeter Dance; No move rules (C5).
  {
    id: "S13a", title: "Teeter Dance, then each confused Pokémon moves, one No move", game: "sv",
    slots: slots(act(mon("Lilligant", "Chlorophyll"), "Teeter Dance"), idle(lax()), act(toise(), "Water Pulse", OL), idle(mon("Indeedee-F", "Own Tempo"))),
    checks: "Teeter Dance confuses its ally and the foes (Own Tempo: Indeedee immune); Blastoise 33% self-hit; Snorlax's No move (Splash) self-hits 33% (DoublesHP.losses).",
  },
  {
    id: "S13b", title: "Teeter Dance, a No move under Gravity", game: "sv", field: { gravity: true },
    slots: slots(act(mon("Lilligant", "Chlorophyll"), "Teeter Dance"), idle(lax()), idle(toise()), idle(saur())),
    checks: "Gravity stops Splash at BeforeMove 6, before confusion (3): no No-move self-hit.",
  },
  {
    id: "S13c", title: "Teeter Dance, a Taunted No move", game: "sv",
    slots: slots(act(mon("Lilligant", "Chlorophyll"), "Teeter Dance"), idle(lax()), act(mon("Grimmsnarl", "Prankster", { evs: { spe: 4 } }), "Taunt", OR), idle(toise())),
    checks: "Prankster Taunt on Snorlax first; Taunt (5) stops its Splash before confusion (3): no self-hit.",
  },
  // ---- S14: Taunt.
  {
    id: "S14a", title: "Taunt, then the target's status move", game: "sv",
    slots: slots(act(mon("Grimmsnarl", "Prankster", { evs: { spe: 4 } }), "Taunt", PL), idle(lax()), act(clef(), "Thunder Wave", OR), idle(toise())),
    checks: "cant Taunt: Clefable's Thunder Wave does not come; Snorlax stays healthy.",
  },
  {
    id: "S14b", outcomes: true, title: "Taunt into Oblivious and into a plain target", game: "sv",
    slots: slots(act(mon("Grimmsnarl", "Prankster", { evs: { spe: 4 } }), "Taunt", PL), act(mon("Whimsicott", "Prankster"), "Taunt", PR), act(mon("Mamoswine", "Oblivious"), "Stealth Rock"), act(clef(), "Thunder Wave", OR)),
    checks: "Oblivious: Mamoswine is not taunted (its Stealth Rock lands); Clefable is taunted: cant Taunt.",
  },
  {
    id: "S14c", title: "Taunt with an Aroma Veil partner", game: "sv",
    slots: slots(act(mon("Grimmsnarl", "Prankster", { evs: { spe: 4 } }), "Taunt", PL), act(mon("Whimsicott", "Prankster"), "Taunt", PR), act(clef(), "Thunder Wave", OR), act(mon("Dachsbun", "Aroma Veil"), "Charm", OR)),
    checks: "Aroma Veil protects Clefable and Dachsbun: no Taunt; both status moves land.",
  },
  {
    id: "S14d", title: "Taunt cured by Mental Herb", game: "sv",
    slots: slots(act(mon("Grimmsnarl", "Prankster", { evs: { spe: 4 } }), "Taunt", PL), idle(lax()), act(clef({ item: "Mental Herb" }), "Thunder Wave", OR), idle(toise())),
    checks: "Mental Herb ends the Taunt at the Update: Thunder Wave lands.",
  },
  {
    id: "S14e", title: "Taunt on a target that already moved", game: "sv",
    slots: slots(act(mon("Kingambit", "Defiant"), "Taunt", PL), idle(lax()), act(jolt(), "Thunder Wave", OR), idle(toise())),
    checks: "Jolteon (150) moves first; Kingambit's Taunt then lands (taunt volatile) with no effect this turn.",
  },
  // ---- S15: applyBoosts.
  {
    id: "S15a", title: "Charm into Clear Body and Defiant", game: "sv",
    slots: slots(act(clef(), "Charm", PL), act(mon("Whimsicott", "Infiltrator"), "Charm", PR), idle(mon("Dragapult", "Clear Body")), idle(mon("Kingambit", "Defiant"))),
    checks: "Clear Body: no drop. Defiant: −2 then +2 Attack (net 0).",
  },
  {
    id: "S15b", title: "Charm into Mirror Armor; Fake Tears into Competitive", game: "sv",
    slots: slots(act(clef(), "Charm", PL), act(mon("Whimsicott", "Infiltrator"), "Fake Tears", PR), idle(mon("Corviknight", "Mirror Armor")), idle(mon("Milotic", "Competitive", { evs: { spe: 8 } }))),
    checks: "Mirror Armor sends −2 Attack back to Clefable; Competitive: −2 Sp. Def, +2 Sp. Atk.",
  },
  {
    id: "S15c", title: "Screech into Contrary and Simple", game: "sv",
    slots: slots(act(sm(), "Screech", PL), act(sm(4), "Screech", PR), idle(mon("Malamar", "Contrary")), idle(mon("Numel", "Simple"))),
    checks: "Contrary: Defense +2. Simple: Defense −4.",
  },
  {
    id: "S15d", title: "Charm into Hyper Cutter; Screech into Big Pecks", game: "sv",
    slots: slots(act(clef(), "Charm", PL), act(sm(), "Screech", PR), idle(mon("Crawdaunt", "Hyper Cutter")), idle(mon("Mandibuzz", "Big Pecks"))),
    checks: "Hyper Cutter: no Attack drop. Big Pecks: no Defense drop.",
  },
  {
    id: "S15e", title: "Charm into a Clear Amulet holder", game: "sv",
    slots: slots(act(clef(), "Charm", PL), idle(lax()), idle(chomp({ item: "Clear Amulet" })), idle(toise())),
    checks: "Clear Amulet: no Attack drop.",
  },
  {
    id: "S15f", title: "An ally's Spicy Extract into Defiant and Clear Body", game: "sv",
    slots: slots(act(mon("Scovillain", "Chlorophyll"), "Spicy Extract", OR), idle(mon("Kingambit", "Defiant")),
      act(mon("Scovillain", "Chlorophyll", { evs: { spe: 12 } }), "Spicy Extract", PR), idle(mon("Dragapult", "Clear Body"))),
    checks: "An ally's drop: Defiant does not act (Attack +2, Defense −2); Clear Body blocks the ally's Defense drop (Attack +2 only).",
  },
  {
    id: "S15g-champions", title: "Charm into Defiant and Clear Body (Champions)", game: "champions",
    slots: slots(act(clef(), "Charm", PL), act(jolt(), "Charm", PR), idle(mon("Kingambit", "Defiant")), idle(mon("Dragapult", "Clear Body"))),
    checks: "Champions applyBoosts: Defiant +2 after the drop; Clear Body blocks.",
  },
  // ---- S16: spread status moves.
  {
    id: "S16a", title: "Growl and Cotton Spore into Grass and Soundproof", game: "sv",
    slots: slots(act(sm(), "Growl"), act(mon("Whimsicott", "Infiltrator"), "Cotton Spore"), idle(saur()), idle(mon("Kommo-o", "Soundproof"))),
    checks: "Growl (sound): Kommo-o immune, Venusaur −1 Attack. Cotton Spore (powder): Venusaur immune, Kommo-o −2 Speed.",
  },
  {
    id: "S16b", title: "Leer and String Shot into Wide Guard", game: "sv",
    slots: slots(act(sm(), "Leer"), act(mon("Galvantula", "Compound Eyes"), "String Shot"), act(mon("Hitmontop", "Technician"), "Wide Guard"), idle(toise())),
    checks: "Wide Guard (+3) blocks both spread status moves on both foes.",
  },
  {
    id: "S16c-usum", title: "Venom Drench on one poisoned foe (USUM)", game: "usum",
    slots: slots(act(mon("Toxapex", "Regenerator"), "Venom Drench"), idle(lax()), idle(chomp({ status: "psn" })), idle(toise())),
    checks: "Venom Drench lowers Attack, Sp. Atk and Speed only on the poisoned Garchomp; poison 1/8 at the end of turn.",
  },
  // ---- S17: unstored stages still react.
  {
    id: "S17a", title: "Sweet Scent into Defiant and Competitive", game: "sv",
    slots: slots(act(mon("Amoonguss", "Regenerator"), "Sweet Scent"), idle(lax()), idle(mon("Kingambit", "Defiant")), idle(mon("Milotic", "Competitive", { evs: { spe: 8 } }))),
    checks: "Evasion −2 (not stored) still triggers Defiant (+2 Attack) and Competitive (+2 Sp. Atk).",
  },
  {
    id: "S17b", title: "Sweet Scent into Mirror Armor; Sand Attack into Clear Body", game: "sv",
    slots: slots(act(mon("Amoonguss", "Regenerator"), "Sweet Scent"), act(chomp(), "Sand Attack", PR), idle(mon("Corviknight", "Mirror Armor")), idle(mon("Tentacruel", "Clear Body"))),
    checks: "Mirror Armor reflects the evasion drop onto Amoonguss; Clear Body blocks the accuracy drop (and Sweet Scent's).",
  },
  {
    id: "S17c", title: "Sand Attack into Keen Eye", game: "sv",
    slots: slots(act(chomp(), "Sand Attack", PR), idle(lax()), idle(mon("Mandibuzz", "Big Pecks")), idle(mon("Bombirdier", "Keen Eye"))),
    checks: "Keen Eye: no accuracy drop on Bombirdier.",
  },
  // ---- S18: self boosts read by later steps.
  {
    id: "S18a", title: "Iron Defense and Calm Mind, then slower hits", game: "sv",
    slots: slots(act(clef(), "Calm Mind"), act(lax(), "Body Slam", PL), act(mon("Corviknight", "Pressure"), "Iron Defense"), act(mon("Amoonguss", "Regenerator"), "Sludge Bomb", OL)),
    checks: "Corviknight (87) +2 Defense before Snorlax's Body Slam (51); Clefable (80) +1 Sp. Def before Amoonguss's Sludge Bomb (50).",
  },
  {
    id: "S18b", outcomes: true, title: "Cotton Guard, Agility, Growth in sun", game: "sv", field: { weather: "Sun" },
    slots: slots(act(mon("Whimsicott", "Infiltrator"), "Cotton Guard"), act(saur(), "Growth"), act(mon("Dragonite", "Inner Focus"), "Agility"), act(lax(), "Body Slam", OL)),
    checks: "Cotton Guard +3 Defense before Body Slam; Growth +2/+2 in sun; Agility +2 Speed (E2 build).",
  },
  {
    id: "S18c", title: "Shell Smash with White Herb, then a hit", game: "sv",
    slots: slots(act(mon("Cloyster", "Skill Link", { item: "White Herb" }), "Shell Smash"), idle(saur()), act(lax(), "Body Slam", OL), idle(toise())),
    checks: "White Herb restores Defense and Sp. Def after Shell Smash; Body Slam into Defense 0.",
  },
  // ---- S19: ally boosts; Dragon Cheer.
  {
    id: "S19a", title: "Decorate, Coaching", game: "sv",
    slots: slots(act(mon("Alcremie", "Sweet Veil"), "Decorate", OR), act(lax(), "Body Slam", PL), act(mon("Hawlucha", "Limber"), "Coaching"), act(toise(), "Water Pulse", OL)),
    checks: "Decorate: Snorlax +2 Attack +2 Sp. Atk before its Body Slam; Coaching: Blastoise +1 Attack +1 Defense.",
  },
  {
    id: "S19b", title: "Howl with a Soundproof ally; Aromatic Mist", game: "sv",
    slots: slots(act(mon("Arcanine", "Flash Fire"), "Howl"), idle(mon("Kommo-o", "Soundproof")), act(mon("Hatterene", "Healer"), "Aromatic Mist", PR), idle(toise())),
    checks: "Howl: Arcanine +1, Soundproof Kommo-o immune. Aromatic Mist: Blastoise Sp. Def +1.",
  },
  {
    id: "S19c", title: "Dragon Cheer on a Dragon ally with Scope Lens, Night Slash", game: "sv",
    slots: slots(act(mon("Dragapult", "Clear Body"), "Dragon Cheer", OR), act(mon("Haxorus", "Unnerve", { item: "Scope Lens" }), "Night Slash", PL), idle(lax()), idle(toise())),
    checks: "Dragon ally: +2 crit stages; with Night Slash and Scope Lens a certain critical hit.",
  },
  {
    id: "S19d", title: "Dragon Cheer on a non-Dragon ally, Night Slash", game: "sv",
    slots: slots(act(mon("Dragapult", "Clear Body"), "Dragon Cheer", OR), act(mon("Kingambit", "Defiant"), "Night Slash", PL), idle(lax()), idle(toise())),
    checks: "Non-Dragon ally: +1; Night Slash +1: stage 2, not certain, so no critical hit.",
  },
  {
    id: "S19e-champions", title: "Dragon Cheer on a Dragon ally (Champions)", game: "champions",
    slots: slots(act(mon("Dragapult", "Clear Body"), "Dragon Cheer", OR), act(mon("Garchomp", "Rough Skin", { item: "Scope Lens" }), "Dragon Claw", PL), idle(lax()), idle(toise())),
    checks: "Champions Dragon Cheer (+2 for a Dragon): Scope Lens + 2 = 3, a certain critical Dragon Claw.",
  },
  // ---- S20: Haze.
  {
    id: "S20a", title: "Haze before a +2 attacker", game: "sv",
    slots: slots(act(fastSm(), "Haze"), idle(lax()), act(chomp({ boosts: { atk: 2 } }), "Dragon Claw", OR), idle(toise())),
    checks: "Haze (Smeargle 139) resets Garchomp's +2 before its Dragon Claw (122).",
  },
  {
    id: "S20b", title: "Haze after Opportunist copied a rise", game: "sv",
    slots: slots(act(chomp({ boosts: { atk: 2 } }), "Dragon Claw", PL), act(fastSm(), "Haze"), act(mon("Espathra", "Opportunist", { boosts: { spa: 1 } }), "Lumina Crash", OL), idle(toise())),
    checks: "Haze resets every stage before Garchomp's Dragon Claw and Espathra's Lumina Crash; no stage rises, so Opportunist copies nothing.",
  },
  // ---- S21: After You, Quash.
  ...games(["sv", "usum"], (game) => ({
    id: `S21a-${game}`, title: `After You on a slow ally (${game})`, game,
    slots: slots(act(clef(), "After You", OR), act(lax(), "Body Slam", PL), act(toise(), "Water Pulse", OL), act(saur(), "Giga Drain", OL)),
    checks: "Snorlax moves right after Clefable, before Venusaur and Blastoise.",
  })),
  {
    id: "S21b", title: "After You on a target that already moved", game: "sv",
    slots: slots(act(clef(), "After You", PL), idle(lax()), act(jolt(), "Thunderbolt", OR), idle(toise())),
    checks: "Jolteon has moved: After You fails.",
  },
  ...games(["sv", "usum"], (game) => ({
    id: `S21c-${game}`, title: `Quash on the fastest foe (${game})`, game,
    slots: slots(act(mon("Sableye", "Prankster"), "Quash", PL), act(lax(), "Body Slam", PL), act(jolt(), "Thunderbolt", OR), act(toise(), "Water Pulse", OL)),
    checks: "Prankster Quash first: Jolteon moves last, after Snorlax.",
  })),
  ...games(["sv", "usum"], (game) => ({
    id: `S21d-${game}`, title: `Two quashed actions (${game})`, game,
    slots: slots(act(mon("Sableye", "Prankster"), "Quash", PL), act(mon("Sableye", "Prankster", { evs: { spe: 12 } }), "Quash", PR), act(jolt(), "Thunderbolt", OR), act(saur(), "Giga Drain", OL)),
    checks: "Both foes quashed: they move after every other action, in their own Speed order (gen 7: in the order they were quashed).",
  })),
  // ---- S22: heal amounts.
  {
    id: "S22a", title: "Recover and Slack Off at low HP", game: "sv",
    slots: slots(act(mon("Slowbro", "Regenerator", { hp: 50 }), "Slack Off"), act(mon("Milotic", "Competitive", { hp: 40 }), "Recover"), idle(chomp()), idle(toise())),
    checks: "round(maxhp/2) each.",
  },
  {
    id: "S22b", title: "Triage Synthesis goes first", game: "sv",
    slots: slots(act(mon("Comfey", "Triage", { hp: 60 }), "Synthesis"), idle(lax()), act(mon("Dragapult", "Clear Body"), "Shadow Ball", OL), idle(toise())),
    checks: "Triage +3: Comfey heals before Dragapult (162) hits it.",
  },
  {
    id: "S22c", title: "Roost on a non-Flying user", game: "sv",
    slots: slots(act(sm(0, { hp: 60 }), "Roost"), idle(lax()), idle(toise()), idle(saur())),
    checks: "Roost heals round(maxhp/2); no Flying type to lose.",
  },
  {
    id: "S22d-champions", title: "Milk Drink on the ally (Champions)", game: "champions",
    slots: slots(act(mon("Gogoat", "Sap Sipper"), "Milk Drink", OR), idle(lax({ hp: 80 })), idle(toise()), idle(saur())),
    checks: "Champions Milk Drink targets an ally: Snorlax +round(maxhp/2).",
  },
  ...(["Sun", "Rain", "Sand"] as const).map((weather) => ({
    id: `S22e-${weather.toLowerCase()}`, title: `Moonlight in ${weather}, with and without Utility Umbrella`, game: "sv" as const, field: { weather },
    slots: slots(act(clef({ hp: 30 }), "Moonlight"), act(clef({ hp: 30, item: "Utility Umbrella", evs: { spe: 8 } }), "Moonlight"), idle(lax()), idle(toise())),
    checks: "Moonlight: 2/3 in sun, 1/4 in rain or sand; Utility Umbrella cancels sun and rain (1/2), not sand.",
  })),
  {
    id: "S22f", title: "Shore Up in sand", game: "sv", field: { weather: "Sand" },
    slots: slots(act(sm(0, { hp: 30 }), "Shore Up"), idle(mon("Garganacl", "Purifying Salt")), idle(mon("Tyranitar", "Unnerve")), idle(chomp())),
    checks: "Shore Up heals 2/3 in sand; sand damage to Smeargle at the end of turn.",
  },
  // ---- S23: ally heals.
  {
    id: "S23a", title: "Heal Pulse with Mega Launcher; Floral Healing in Grassy Terrain", game: "sv", field: { terrain: "Grassy" },
    slots: slots(act(mon("Clawitzer", "Mega Launcher", { hp: 40 }), "Heal Pulse", OR), act(sm(0, { hp: 30 }), "Floral Healing", OL), idle(toise()), idle(saur())),
    checks: "Heal Pulse ×0.75 with Mega Launcher on Smeargle (30); Floral Healing ×0.667 in Grassy Terrain on Clawitzer (40); Grassy Terrain heals at the end of turn.",
  },
  {
    id: "S23b", title: "Life Dew and Jungle Healing", game: "sv",
    slots: slots(act(mon("Hatterene", "Healer", { hp: 40 }), "Life Dew"), act(sm(0, { hp: 40, status: "par" }), "Jungle Healing"), idle(toise()), idle(saur())),
    checks: "Life Dew: a quarter to both; Jungle Healing: a quarter to both and cures the paralysis.",
  },
  {
    id: "S23c", title: "Pollen Puff on an ally", game: "sv",
    slots: slots(act(mon("Ribombee", "Shield Dust"), "Pollen Puff", OR), idle(lax({ hp: 60 })), idle(toise()), idle(saur())),
    checks: "Pollen Puff heals the ally floor(maxhp/2).",
  },
  // ---- S24: Strength Sap.
  {
    id: "S24a", title: "Strength Sap on a +2 Attack foe, Big Root", game: "sv",
    slots: slots(act(mon("Jumpluff", "Infiltrator", { hp: 40, item: "Big Root" }), "Strength Sap", PL), idle(lax()), idle(chomp({ boosts: { atk: 2 } })), idle(toise())),
    checks: "Heals Garchomp's +2 Attack ×5324/4096 (Big Root), then Attack −1.",
  },
  {
    id: "S24b", title: "Strength Sap into Liquid Ooze; at −6", game: "sv",
    slots: slots(act(mon("Jumpluff", "Infiltrator", { hp: 100 }), "Strength Sap", PL), act(sm(0, { hp: 100 }), "Strength Sap", PR), idle(mon("Tentacruel", "Liquid Ooze")), idle(chomp({ boosts: { atk: -6 } }))),
    checks: "Liquid Ooze: the sap damages Jumpluff instead. At −6 Attack Strength Sap fails.",
  },
  // ---- S25: Pain Split.
  {
    id: "S25a", title: "Pain Split with a Sitrus Berry on the higher one", game: "sv",
    slots: slots(act(gengar({ hp: 20 }), "Pain Split", PL), idle(lax()), idle(lax({ item: "Sitrus Berry", evs: { spe: 12 } })), idle(toise())),
    checks: "Both to floor((20 + 235)/2) = 127; Snorlax 127 is above half: no Sitrus. The joint HP map.",
  },
  {
    id: "S25b", title: "Pain Split takes the higher one under half", game: "sv",
    slots: slots(act(gengar({ hp: 20 }), "Pain Split", PL), idle(lax()), idle(lax({ item: "Sitrus Berry", hp: 200, evs: { spe: 12 } })), idle(toise())),
    checks: "floor((20 + 200)/2) = 110 ≤ 117: Snorlax eats its Sitrus Berry at the Update.",
  },
  // ---- S26: HP costs.
  {
    id: "S26a", title: "Belly Drum with a Sitrus Berry", game: "sv",
    slots: slots(act(lax({ item: "Sitrus Berry", hp: 230 }), "Belly Drum"), idle(toise()), act(chomp(), "Dragon Claw", OR), idle(saur())),
    checks: "Snorlax 230 − 117 = 113 ≤ half: Sitrus +58 at the Update after Belly Drum; Attack +6.",
  },
  {
    id: "S26b", title: "Belly Drum at exactly half fails", game: "sv",
    slots: slots(act(lax({ hp: 117 }), "Belly Drum"), idle(toise()), idle(chomp()), idle(saur())),
    checks: "hp ≤ maxhp/2: Belly Drum fails.",
  },
  {
    id: "S26c", title: "Fillet Away and Clangorous Soul", game: "sv",
    slots: slots(act(sm(), "Fillet Away"), act(mon("Kommo-o", "Bulletproof"), "Clangorous Soul"), idle(toise()), idle(saur())),
    checks: "Fillet Away: half, +2 Atk/Sp. Atk/Spe. Clangorous Soul: floor(maxhp × 33/100) (C1), +1 to five stats.",
  },
  {
    id: "S26d", title: "Ghost Curse that faints its user; non-Ghost Curse", game: "sv",
    slots: slots(act(gengar({ hp: 30 }), "Curse", PL), act(lax(), "Curse", PL), idle(chomp()), idle(toise())),
    checks: "Gengar pays floor(maxhp/2) ≥ 30: it faints; Garchomp cursed (1/4 at the end of turn). Snorlax's Curse: +1/+1, Speed −1.",
  },
  // ---- S27: status moves into a Substitute.
  {
    id: "S27a", outcomes: true, title: "Substitute, then Thunder Wave and an Infiltrator Taunt", game: "sv",
    slots: slots(act(mon("Whimsicott", "Infiltrator"), "Taunt", PL), act(jolt(), "Thunder Wave", PL), act(mon("Dragapult", "Clear Body"), "Substitute"), idle(toise())),
    checks: "Dragapult's Substitute first (162); Jolteon's Thunder Wave fails into it; Whimsicott's Infiltrator Taunt passes it.",
  },
  {
    id: "S27b", title: "Substitute, then Sing", game: "sv",
    slots: slots(act(sm(), "Sing", PL), idle(lax()), act(mon("Dragapult", "Clear Body"), "Substitute"), idle(toise())),
    checks: "Sing is a sound move: it passes the Substitute and puts Dragapult to sleep.",
  },
  // ---- S28: Memento.
  {
    id: "S28a", title: "Memento, then the target attacks", game: "sv",
    slots: slots(act(fastSm(), "Memento", PL), idle(lax()), act(chomp(), "Dragon Claw", OR), idle(toise())),
    checks: "Garchomp −2 Attack and Sp. Atk, Smeargle faints; Dragon Claw at −2 into Snorlax.",
  },
  {
    id: "S28b", title: "Memento into Protect", game: "sv",
    slots: slots(act(fastSm(), "Memento", PL), idle(lax()), act(chomp(), "Protect"), idle(toise())),
    checks: "Protect blocks Memento: the user does not faint.",
  },
  // ---- S29: Healing Wish, Lunar Dance.
  {
    id: "S29a", title: "Healing Wish and Lunar Dance", game: "sv",
    slots: slots(act(mon("Hatterene", "Healer"), "Healing Wish"), act(sm(), "Lunar Dance"), idle(chomp()), idle(toise())),
    checks: "Both users faint (a bench Pokémon is left to switch in).",
  },
  {
    id: "S29b", title: "Healing Wish with no Pokémon to switch in", game: "sv", canSwitch: { own: false },
    slots: slots(act(mon("Hatterene", "Healer"), "Healing Wish"), idle(lax()), idle(chomp()), idle(toise())),
    checks: "canSwitch false: Healing Wish fails, Hatterene stays.",
  },
  // ---- S30: Rest.
  {
    id: "S30a", title: "Rest at a third, poisoned, then a foe's hit", game: "sv",
    slots: slots(act(lax({ hp: 78, status: "psn" }), "Rest"), idle(toise()), act(mon("Amoonguss", "Regenerator"), "Sludge Bomb", OL), idle(saur())),
    checks: "Snorlax (51) rests to full first: poison cured, asleep (Rest: 3); Amoonguss's Sludge Bomb (50) then; no poison damage at the end of turn.",
  },
  {
    id: "S30b", title: "Rest at full HP fails", game: "sv",
    slots: slots(act(lax(), "Rest"), idle(toise()), idle(chomp()), idle(saur())),
    checks: "Rest fails at full HP.",
  },
  // ---- S31: Endure (C2).
  {
    id: "S31a", title: "Endure against a knocking-out hit", game: "sv",
    slots: slots(act(gengar(), "Endure"), idle(lax()), act(chomp({ nature: "Adamant", evs: { atk: 252 } }), "Earthquake"), idle(toise())),
    checks: "Endure (+4) leaves Gengar at 1 against Earthquake.",
  },
  {
    id: "S31b", title: "Endure against a multi-hit move, and with Focus Sash", game: "sv",
    slots: slots(act(zard({ hp: 60 }), "Endure"), act(saur({ item: "Focus Sash" }), "Endure"), act(mon("Cloyster", "Skill Link"), "Icicle Spear", OL), act(mon("Talonflame", "Gale Wings"), "Brave Bird", OR)),
    checks: "Endure takes every hit of Icicle Spear to 1; with Endure up the Focus Sash is not used (Endure acts before the Sash).",
  },
  {
    id: "S31c", title: "Endure as the last action fails", game: "sv",
    slots: slots(act(lax(), "Endure"), act(toise(), "Protect"), act(chomp(), "Protect"), act(saur(), "Protect")),
    checks: "Four +4 moves: Snorlax (51) is last, no action after it: Endure fails (onPrepareHit queue.willAct()).",
  },
  // ---- S32: Destiny Bond.
  {
    id: "S32a", title: "Destiny Bond, then a knockout; Soul-Heart", game: "sv",
    slots: slots(act(gengar({ hp: 40 }), "Destiny Bond"), idle(lax()), act(chomp(), "Dragon Claw", OL), idle(mon("Magearna", "Soul-Heart"))),
    checks: "Garchomp knocks out Gengar and faints too; Soul-Heart raises Magearna's Sp. Atk for each faint.",
  },
  {
    id: "S32b-swsh", title: "Destiny Bond against a Dynamaxed attacker (SwSh)", game: "swsh",
    slots: slots(act(gengar({ hp: 40 }), "Destiny Bond"), idle(lax()), act(chomp({ choice: "dynamax" }), "Dragon Claw", OL), idle(toise())),
    checks: "A Dynamaxed attacker is immune to Destiny Bond.",
  },
  {
    id: "S32c", title: "Destiny Bond and an ally's knockout", game: "sv",
    slots: slots(act(gengar({ hp: 40 }), "Destiny Bond"), act(lax(), "Crunch", OL), idle(chomp()), idle(toise())),
    checks: "Snorlax knocks out its own ally Gengar: Destiny Bond does not act on an ally (destinybond onFaint: target.isAlly(source)).",
  },
  // ---- S33: Magic Bounce.
  {
    id: "S33a", title: "Magic Bounce against Thunder Wave and String Shot", game: "sv",
    slots: slots(act(clef(), "Thunder Wave", PL), act(mon("Galvantula", "Compound Eyes"), "String Shot"), idle(mon("Hatterene", "Magic Bounce")), idle(toise())),
    checks: "Thunder Wave bounces back onto Clefable; String Shot bounces from Hatterene onto the user's side.",
  },
  {
    id: "S33b", title: "Magic Bounce against Taunt with Follow Me on the user's side", game: "sv",
    slots: slots(act(mon("Grimmsnarl", "Prankster", { evs: { spe: 4 } }), "Taunt", PL), act(clef(), "Follow Me"), idle(mon("Espeon", "Magic Bounce")), idle(toise())),
    checks: "Follow Me (+2) first; the Taunt bounced back at Grimmsnarl goes to Clefable (the bounced move is redirected).",
  },
  {
    id: "S33c", outcomes: true, title: "Mold Breaker passes Magic Bounce; Stealth Rock bounced", game: "sv",
    slots: slots(act(mon("Hawlucha", "Mold Breaker"), "Taunt", PL), act(mon("Mamoswine", "Oblivious"), "Stealth Rock"), idle(mon("Espeon", "Magic Bounce")), idle(toise())),
    checks: "Mold Breaker's Taunt passes Magic Bounce; Mamoswine's Stealth Rock goes back to the user's side (hazards on own).",
  },
  // ---- S34: Prankster, Psychic Terrain, Quick Guard, Armor Tail, Dazzling.
  {
    id: "S34a", title: "Prankster Thunder Wave into a Dark foe and a Dark ally", game: "sv",
    slots: slots(act(mon("Grimmsnarl", "Prankster", { evs: { spe: 4 } }), "Thunder Wave", PL), act(mon("Klefki", "Prankster"), "Thunder Wave", OL), idle(mon("Kingambit", "Defiant")), idle(toise())),
    checks: "Prankster-boosted status into a Dark foe fails; into a Dark ally it lands (paralysed Grimmsnarl).",
  },
  {
    id: "S34b", title: "Prankster Thunder Wave on Psychic Terrain", game: "sv", field: { terrain: "Psychic" },
    slots: slots(act(mon("Grimmsnarl", "Prankster", { evs: { spe: 4 } }), "Thunder Wave", PL), act(mon("Klefki", "Prankster"), "Thunder Wave", PR), idle(lax()), idle(mon("Charizard", "Blaze"))),
    checks: "Psychic Terrain blocks the priority move into grounded Snorlax; Flying Charizard is paralysed.",
  },
  {
    id: "S34c", title: "Prankster Thunder Wave into Quick Guard", game: "sv",
    slots: slots(act(mon("Grimmsnarl", "Prankster", { evs: { spe: 4 } }), "Thunder Wave", PL), idle(lax()), act(mon("Hitmontop", "Technician"), "Quick Guard"), idle(toise())),
    checks: "Quick Guard (+3) blocks the +1 Thunder Wave.",
  },
  {
    id: "S34d", title: "Prankster status moves into Armor Tail and Dazzling", game: "sv",
    slots: slots(act(mon("Grimmsnarl", "Prankster", { evs: { spe: 4 } }), "Thunder Wave", PL), act(mon("Murkrow", "Prankster"), "Perish Song"), idle(mon("Farigiraf", "Armor Tail")), idle(mon("Bruxish", "Dazzling"))),
    checks: "Dazzling stops priority moves from foes (TryMove; Bruxish's handler acts first): Thunder Wave fails; Perish Song is all-target and is stopped too (C6).",
  },
  {
    id: "S34e", title: "Prankster Thunder Wave into Armor Tail", game: "sv",
    slots: slots(act(mon("Grimmsnarl", "Prankster", { evs: { spe: 4 } }), "Thunder Wave", PR), idle(lax()), idle(mon("Farigiraf", "Armor Tail")), idle(toise())),
    checks: "Armor Tail stops the priority Thunder Wave aimed at its ally Blastoise.",
  },
  // ---- S35: Safeguard.
  {
    id: "S35a", outcomes: true, title: "Safeguard against Swagger and Yawn", game: "sv",
    slots: slots(act(sm(), "Swagger", PL), act(lax({ evs: { spe: 12 } }), "Yawn", PR), act(guard(), "Safeguard"), act(lax(), "Crunch", OL)),
    checks: "Milotic's Safeguard (146) first: Swagger's Attack +2 lands, its confusion does not; Snorlax's Yawn (52) then fails on the other Snorlax.",
  },
  {
    id: "S35b", title: "Safeguard against Thunder Wave and an Infiltrator foe", game: "sv",
    slots: slots(act(mon("Whimsicott", "Infiltrator"), "Stun Spore", PR), act(clef(), "Thunder Wave", PR), act(guard(), "Safeguard"), idle(toise())),
    checks: "Safeguard (Milotic 146) first; Whimsicott's Infiltrator Stun Spore passes it: Blastoise paralysed; Clefable's Thunder Wave then fails.",
  },
  {
    id: "S35c", title: "Safeguard against the ally's Teeter Dance", game: "sv",
    slots: slots(act(mon("Lilligant", "Chlorophyll"), "Teeter Dance"), act(guard(), "Safeguard"), idle(lax()), idle(toise())),
    checks: "Milotic's Safeguard (146) first; Teeter Dance cannot confuse Milotic (Safeguard blocks other Pokémon, allies included); the foes are confused.",
  },
  // ---- S36: Good as Gold, Soundproof.
  {
    id: "S36a", title: "Good as Gold against a foe's and an ally's status move", game: "sv",
    slots: slots(act(clef(), "Thunder Wave", PL), idle(lax()), idle(mon("Gholdengo", "Good as Gold")), act(mon("Hatterene", "Healer"), "Heal Pulse", PL)),
    checks: "Good as Gold blocks both (any other Pokémon's status move).",
  },
  {
    id: "S36b", title: "Soundproof against Sing and Perish Song", game: "sv",
    slots: slots(act(sm(), "Sing", PL), act(gengar(), "Perish Song"), idle(mon("Kommo-o", "Soundproof")), idle(toise())),
    checks: "Soundproof blocks Sing and Perish Song on Kommo-o; every other Pokémon gets a perish count (no Soundproof Perish Song user in the SV catalog).",
  },
  // ---- S37: redirection and absorption of status moves.
  {
    id: "S37a", title: "Follow Me against Thunder Wave and Spore", game: "sv",
    slots: slots(act(jolt(), "Thunder Wave", PR), act(mon("Breloom", "Technician"), "Spore", PR), act(clef(), "Follow Me"), idle(toise())),
    checks: "Both single-target status moves go to Clefable.",
  },
  {
    id: "S37b", title: "Rage Powder against a Grass user's Spore", game: "sv",
    slots: slots(act(mon("Breloom", "Technician"), "Spore", PR), idle(lax()), act(mon("Amoonguss", "Regenerator"), "Rage Powder"), idle(toise())),
    checks: "Rage Powder (powder) does not redirect a Grass user: Spore hits Blastoise.",
  },
  {
    id: "S37c", title: "A Lightning Rod partner against Eerie Impulse", game: "sv",
    slots: slots(act(jolt(), "Eerie Impulse", PL), act(mon("Breloom", "Technician"), "Spore", PR), idle(toise()), idle(mon("Raichu", "Lightning Rod"))),
    checks: "Raichu's Lightning Rod takes Eerie Impulse aimed at Blastoise (Sp. Atk +1); Breloom's Spore puts Raichu to sleep.",
  },
  {
    id: "S37d", title: "Sap Sipper against Spore", game: "sv",
    slots: slots(act(mon("Breloom", "Technician"), "Spore", PL), idle(lax()), idle(mon("Azumarill", "Sap Sipper")), idle(toise())),
    checks: "Sap Sipper absorbs Spore: Attack +1, no sleep.",
  },
  {
    id: "S37e", title: "A Stalwart user against Follow Me", game: "sv",
    slots: slots(act(mon("Archaludon", "Stalwart"), "Flash Cannon", PL), idle(lax()), idle(mon("Azumarill", "Sap Sipper")), act(clef(), "Follow Me")),
    checks: "Stalwart ignores Follow Me: Flash Cannon hits Azumarill.",
  },
  // ---- S38: Leech Seed this turn.
  {
    id: "S38a", outcomes: true, title: "Leech Seed this turn, Big Root", game: "sv",
    slots: slots(act(saur({ hp: 100, item: "Big Root" }), "Leech Seed", PL), idle(lax()), idle(chomp()), idle(toise())),
    checks: "Drain at the end of turn: Garchomp −floor(183/8) = 22, Venusaur +22 × Big Root.",
  },
  {
    id: "S38b", title: "Leech Seed into Grass and into Liquid Ooze", game: "sv",
    slots: slots(act(saur({ hp: 100 }), "Leech Seed", PL), act(sm(0, { hp: 100 }), "Leech Seed", PR), idle(saur({ evs: { spe: 12 } })), idle(mon("Tentacruel", "Liquid Ooze"))),
    checks: "Grass is immune to Leech Seed; Liquid Ooze: the seeder takes the drain.",
  },
  {
    id: "S38c", title: "Leech Seed into a Substitute", game: "sv",
    slots: slots(act(saur({ hp: 100 }), "Leech Seed", PL), idle(lax()), idle(chomp({ substitute: 45 })), idle(toise())),
    checks: "A Substitute blocks Leech Seed.",
  },
  // ---- S39: Aqua Ring, Ingrain, Magnet Rise.
  {
    id: "S39a", title: "Aqua Ring and Ingrain this turn", game: "sv",
    slots: slots(act(toise({ hp: 80 }), "Aqua Ring"), act(saur({ hp: 80, item: "Big Root" }), "Ingrain"), idle(chomp()), idle(lax())),
    checks: "End of turn: Aqua Ring +1/16, Ingrain +1/16 × Big Root.",
  },
  {
    id: "S39b", title: "Ingrain on an Air Balloon holder, then Earthquake", game: "sv", notEstimated: "Ingrain changes whether Venusaur is grounded: later moves are not modelled.",
    slots: slots(act(mon("Venusaur", "Overgrow", { item: "Air Balloon", evs: { spe: 252 }, nature: "Timid" }), "Ingrain"), idle(lax()), act(chomp(), "Earthquake"), idle(toise())),
    checks: "Ingrain grounds the Air Balloon holder before the Earthquake: groundingChange.",
  },
  {
    id: "S39c", title: "Magnet Rise in Grassy Terrain, no later hit", game: "sv", field: { terrain: "Grassy" },
    slots: slots(act(mon("Magnezone", "Sturdy", { hp: 80 }), "Magnet Rise"), idle(lax({ hp: 100 })), idle(chomp()), idle(toise())),
    checks: "Magnet Rise ungrounds Magnezone: no Grassy Terrain heal at the end of turn; Snorlax heals 1/16.",
  },
  {
    id: "S39d", title: "Magnet Rise, then Earthquake", game: "sv", notEstimated: "Magnet Rise changes whether Magnezone is grounded: later moves are not modelled.",
    slots: slots(act(mon("Magnezone", "Sturdy"), "Magnet Rise"), idle(lax()), act(mon("Donphan", "Sturdy"), "Earthquake"), idle(toise())),
    checks: "Magnet Rise (80) before Donphan's Earthquake (70): groundingChange.",
  },
  // ---- S40: Perish Song.
  ...games(["sv", "champions"], (game) => ({
    id: `S40-${game}`, title: `Perish Song (${game})`, game, outcomes: true,
    slots: slots(act(gengar(), "Perish Song"), idle(lax()), idle(chomp()), idle(toise())),
    checks: "Every Pokémon gets perish 4 → 3 at the end of turn (E2 perishCount 3).",
  })),
  // ---- S41: carried sleep vs the hidden-counter expansion.
  ...games(["sv", "champions", "usum"], (game) => [0, 1, 2, 3].filter((a) => !(game === "champions" && a > 2)).map((attempts) => ({
    id: `S41a${attempts}-${game}`, title: `Asleep, ${attempts} turns lost to sleep (${game})`, game, outcomes: true,
    slots: slots(act(lax({ status: "slp", carried: { sleep: { attempts, rest: false } } }), "Body Slam", PL), idle(toise()), idle(chomp()), idle(saur())),
    checks: `Wake hazard after ${attempts} attempts by the posterior (native {2,3,4}, Champions {2: 1/3, 3: 2/3}); the oracle mixes the sub-cases.`,
  }))).flat(),
  ...games(["sv", "usum"], (game) => ({
    id: `S41b-${game}`, title: `Early Bird asleep, 1 turn lost (${game})`, game,
    slots: slots(act(game === "sv" ? mon("Houndoom", "Early Bird", { status: "slp", carried: { sleep: { attempts: 1, rest: false } } }) : mon("Kangaskhan", "Early Bird", { status: "slp", carried: { sleep: { attempts: 1, rest: false } } }), game === "sv" ? "Dark Pulse" : "Body Slam", PL), idle(toise()), idle(chomp()), idle(saur())),
    checks: "Early Bird: elapsed 2 after one attempt; S ∈ {3, 4}: both wake at this BeforeMove (S − 4 ≤ 0).",
  })),
  ...games(["sv", "champions"], (game) => ({
    id: `S41c-${game}`, title: `Rest sleep, 1 turn lost (${game})`, game,
    slots: slots(act(lax({ status: "slp", carried: { sleep: { attempts: 1, rest: true } } }), "Body Slam", PL), idle(toise()), idle(chomp()), idle(saur())),
    checks: "Rest: S = 3; after one attempt it stays asleep this turn (3 − 2 = 1 > 0).",
  })),
  {
    id: "S41d", title: "Asleep, no carried count (the assumption)", game: "sv",
    slots: slots(act(lax({ status: "slp" }), "Body Slam", PL), idle(toise()), idle(chomp()), idle(saur())),
    checks: "No carried.sleep: 0 attempts assumed (turn fact); the same posterior as attempts 0.",
  },
  // ---- S42: freeze.
  {
    id: "S42a", title: "Frozen (SV): 1/5 thaw", game: "sv",
    slots: slots(act(lax({ status: "frz" }), "Body Slam", PL), idle(toise()), idle(chomp()), idle(saur())),
    checks: "SV freeze is memoryless: thaws with 1/5 at its BeforeMove.",
  },
  ...[0, 1, 2].map((attempts) => ({
    id: `S42b${attempts}-champions`, title: `Frozen, ${attempts} turns lost (Champions)`, game: "champions" as const,
    slots: slots(act(lax({ status: "frz", carried: { freeze: { attempts } } }), "Body Slam", PL), idle(toise()), idle(chomp()), idle(saur())),
    checks: "Champions: time = 3 − attempts, time-- then thaw at ≤ 0 or with 1/4.",
  })),
  {
    id: "S42c", title: "Flare Blitz thaws its user; a Fire hit thaws the target", game: "sv",
    slots: slots(act(mon("Arcanine", "Flash Fire", { status: "frz" }), "Flare Blitz", PL), act(zard({ evs: { spe: 252 } }), "Flamethrower", PR), idle(chomp()), act(lax({ status: "frz" }), "Body Slam", OL)),
    checks: "Charizard's Flamethrower thaws Snorlax before it moves; Arcanine's Flare Blitz (defrost) thaws its user.",
  },
  // ---- S43: carried confusion.
  ...[0, 1, 2, 3, 4].map((attempts) => ({
    id: `S43a${attempts}`, title: `Confused, ${attempts} BeforeMoves so far`, game: "sv" as const,
    slots: slots(act(chomp({ carried: { confusion: { attempts } } }), "Dragon Claw", PL), idle(lax()), idle(toise()), idle(saur())),
    checks: "Snap-out hazard P(T = a)/P(T ≥ a), T uniform on 2..5 (a = attempts + 1); 33% self-hit otherwise.",
  })),
  {
    id: "S43b", title: "Confused after Axe Kick, 2 BeforeMoves", game: "sv",
    slots: slots(act(chomp({ carried: { confusion: { attempts: 2, axeKick: true } } }), "Dragon Claw", PL), idle(lax()), idle(toise()), idle(saur())),
    checks: "Axe Kick: T on 3..5; after 2 attempts the third ends it with 1/3.",
  },
  {
    id: "S43c", title: "Confused with Persim and Lum Berries", game: "sv",
    slots: slots(act(chomp({ item: "Persim Berry", carried: { confusion: { attempts: 1 } } }), "Dragon Claw", PL), act(zard({ item: "Lum Berry", carried: { confusion: { attempts: 0 } } }), "Flamethrower", PL), idle(lax()), idle(toise())),
    checks: "A carried confusion: Persim and Lum cure it at the first Update, before either moves.",
  },
  // ---- S44: Disable, Encore with lastMove.
  ...games(["sv", "champions"], (game) => ({
    id: `S44a-${game}`, title: `Disable a queued move equal to the last one (${game})`, game,
    slots: slots(act(gengar(), "Disable", PL), idle(lax()), act(chomp({ lastMove: "Dragon Claw" }), "Dragon Claw", OR), idle(toise())),
    checks: "Garchomp still to act, lastMove = Dragon Claw = its queued move: cant Disable.",
  })),
  {
    id: "S44b", outcomes: true, title: "Encore a queued move equal to the last one", game: "sv",
    slots: slots(act(mon("Whimsicott", "Prankster"), "Encore", PL), idle(lax()), act(chomp({ lastMove: "Dragon Claw" }), "Dragon Claw", OR), idle(toise())),
    checks: "Encore on the same move changes nothing this turn; encore volatile for E2.",
  },
  {
    id: "S44c", title: "Encore on a target that already moved", game: "sv",
    slots: slots(act(clef(), "Encore", PL), idle(lax()), act(chomp({ lastMove: "Earthquake" }), "Dragon Claw", OR), idle(toise())),
    checks: "Garchomp (122) has moved: Encore on Dragon Claw (its move this turn), no effect this turn.",
  },
  {
    id: "S44d", title: "Disable and Encore with lastMove null", game: "sv",
    slots: slots(act(gengar(), "Disable", PL), act(mon("Whimsicott", "Prankster"), "Encore", PR), act(chomp({ lastMove: null }), "Dragon Claw", OL), act(toise({ lastMove: null }), "Water Pulse", OL)),
    checks: "No move since it came in: Disable and Encore fail.",
  },
  {
    id: "S44e", title: "Encore onto a different move", game: "sv", notEstimated: "Encore changes Garchomp's move: not modelled.",
    slots: slots(act(mon("Whimsicott", "Prankster"), "Encore", PL), idle(lax()), act(chomp({ lastMove: "Earthquake" }), "Dragon Claw", OR), idle(toise())),
    checks: "lastMove differs from the queued move: not estimated (encoreChange).",
  },
  // ---- S45: Imprison.
  ...games(["sv", "champions"], (game) => ({
    id: `S45-${game}`, title: `Imprison stops a foe's move (${game})`, game,
    slots: slots(act(gengar({ moves: ["Poison Jab", "Shadow Ball"] }), "Imprison"), idle(lax()), act(chomp(), "Poison Jab", OR), act(toise(), "Water Pulse", OR)),
    checks: "Gengar (130) imprisons first: Garchomp's Poison Jab is one of Gengar's moves, so cant Imprison; Blastoise's Water Pulse is not.",
  })),
  // ---- S46: Charge, Focus Energy.
  {
    id: "S46a", title: "Charge, then a special hit into it", game: "sv",
    slots: slots(act(jolt(), "Charge"), idle(lax()), act(gengar(), "Shadow Ball", OL), idle(toise())),
    checks: "Charge: Sp. Def +1 before Gengar's Shadow Ball; charged in E2.",
  },
  {
    id: "S46b", outcomes: true, title: "Focus Energy and Agility", game: "sv",
    slots: slots(act(mon("Dragonite", "Inner Focus"), "Agility"), act(sm(), "Focus Energy"), idle(toise()), idle(saur())),
    checks: "Focus Energy sets the volatile (E2 build: focusEnergy); Agility +2 Speed (E2). A second Focus Energy is a later turn's.",
  },
  // ---- S47: Uproar, Sleep Talk, Snore.
  {
    id: "S47a", title: "Snore asleep and after waking", game: "sv",
    slots: slots(act(lax({ status: "slp", carried: { sleep: { attempts: 1, rest: false } } }), "Snore", PL), idle(toise()), idle(chomp()), idle(saur())),
    checks: "Asleep: Snore works (sleep-usable); woken (1/2): Snore fails its own onTry.",
  },
  {
    id: "S47b", title: "Sleep Talk while asleep", game: "sv", notEstimated: "Sleep Talk is not modelled in 2v2.",
    slots: slots(act(lax({ status: "slp" }), "Sleep Talk"), idle(toise()), act(chomp(), "Dragon Claw", OL), idle(saur())),
    checks: "Sleep Talk calls a random move: guarded.",
  },
  {
    id: "S47c", title: "Uproar with a sleeper", game: "sv", notEstimated: "Uproar is not modelled in 2v2.",
    slots: slots(act(mon("Noivern", "Infiltrator"), "Uproar", PL), idle(toise()), idle(lax({ status: "slp" })), idle(saur())),
    checks: "Uproar with a sleeping Pokémon: guarded.",
  },
  // ---- S48: reason-only (ADDENDUM §8: Skill Swap, Soak, Attract, Transform, Bestow; Ally Switch and Trick are modelled).
  ...(["Skill Swap", "Soak", "Attract", "Transform"] as const).flatMap((move) => {
    const user = move === "Soak" ? mon("Araquanid", "Water Bubble") : move === "Attract" ? mon("Alcremie", "Sweet Veil", { gender: "F" }) : sm();
    return [
      {
        id: `S48-${move.replace(/ /g, "")}-before`, title: `${move} before another move`, game: "sv" as const, notEstimated: `${move} is not modelled and comes before another move.`,
        slots: slots(act(w(user, { evs: { spe: 252 } }), move, PL), idle(lax()), act(chomp({ gender: "M" }), "Dragon Claw", OR), idle(toise())),
        checks: `${move} (L) with a later action.`,
      },
      {
        id: `S48-${move.replace(/ /g, "")}-last`, title: `${move} as the last action`, game: "sv" as const, endNotEstimated: `${move} is not modelled.`,
        slots: slots(act(user, move, PL), idle(jolt()), act(chomp({ gender: "M" }), "Dragon Claw", OR), idle(toise())),
        checks: `${move} (L) after every other action (every other Pokémon is faster): the moves are estimated, the end of turn is not.`,
      },
    ];
  }),
  {
    id: "S48-Bestow-before-usum", title: "Bestow before another move (USUM)", game: "usum", notEstimated: "Bestow is not modelled and comes before another move.",
    slots: slots(act(mon("Smeargle", "Technician", { item: "Sitrus Berry", evs: { spe: 252 } }), "Bestow", PL), idle(lax()), act(chomp(), "Dragon Claw", OR), idle(toise())),
    checks: "Bestow stays L (ADDENDUM §11.8).",
  },
  {
    id: "S48-Bestow-last-usum", title: "Bestow as the last action (USUM)", game: "usum", endNotEstimated: "Bestow is not modelled.",
    slots: slots(act(mon("Smeargle", "Technician", { item: "Sitrus Berry" }), "Bestow", PL), idle(jolt()), act(chomp(), "Dragon Claw", OR), idle(toise())),
    checks: "Bestow as the last action: end of turn not estimated.",
  },
  {
    id: "S48-Encore-noLastMove", title: "Encore on a Pokémon still to act, last move unknown", game: "sv", notEstimated: "Encore needs Garchomp's move from the last turn.",
    slots: slots(act(mon("Whimsicott", "Prankster"), "Encore", PL), idle(lax()), act(chomp(), "Dragon Claw", OR), idle(toise())),
    checks: "needsLastMove.",
  },
  {
    id: "S48-Imprison-noMoves", title: "Imprison without the user's moves", game: "sv", notEstimated: "Imprison needs Gengar's moves.",
    slots: slots(act(gengar(), "Imprison"), idle(lax()), act(chomp(), "Poison Jab", OR), act(toise(), "Water Pulse", OR)),
    checks: "needsMoves.",
  },
  {
    id: "S48-PainSplit-dynamax-swsh", title: "Pain Split with a Dynamaxed Pokémon (SwSh)", game: "swsh", notEstimated: "Pain Split with a Dynamaxed Pokémon is not modelled in 2v2.",
    slots: slots(act(gengar({ hp: 40 }), "Pain Split", PL), idle(lax()), act(chomp({ choice: "dynamax" }), "Dragon Claw", OR), idle(toise())),
    checks: "withDynamax.",
  },
  {
    id: "S48-Disguise-selfhit", title: "Confusion self-hit with an intact Disguise", game: "sv", notEstimated: "Disguise against a confusion self-hit is not modelled in 2v2.",
    slots: slots(act(gengar(), "Confuse Ray", PL), idle(lax()), act(mon("Mimikyu", "Disguise"), "Play Rough", OR), idle(toise())),
    checks: "faceSelfHit.",
  },
  {
    id: "S48-Roost-flying", title: "Roost on a Flying user with a later hit into it", game: "sv", notEstimated: "Roost changes Dragonite's type: later moves are not modelled.",
    slots: slots(act(mon("Dragonite", "Multiscale", { hp: 100, nature: "Jolly", evs: { spe: 252 } }), "Roost"), idle(lax()), act(chomp(), "Earthquake"), idle(toise())),
    checks: "typeChange(Roost): Dragonite (145) loses Flying before Garchomp's Earthquake (122).",
  },
  {
    id: "S48-PartingShot-before", title: "Parting Shot with a later action", game: "sv", notEstimated: "Grimmsnarl switches out: the replacement is not known.",
    slots: slots(act(mon("Grimmsnarl", "Prankster", { evs: { spe: 4 } }), "Parting Shot", PL), idle(lax()), act(chomp(), "Dragon Claw", OR), idle(toise())),
    checks: "switchesOut with a later action.",
  },
  {
    id: "S48-PartingShot-clearbody", title: "Parting Shot into Clear Body (no switch)", game: "sv",
    slots: slots(act(mon("Grimmsnarl", "Prankster", { evs: { spe: 4 } }), "Parting Shot", PL), idle(lax()), act(mon("Dragapult", "Clear Body"), "Dragon Darts", OR), idle(toise())),
    checks: "Clear Body: nothing lowered, so Parting Shot's onHit deletes selfSwitch: Grimmsnarl stays (modelled).",
  },
  {
    id: "S48-Teleport-noSwitch", title: "Teleport with no Pokémon to switch in", game: "sv", canSwitch: { own: false },
    slots: slots(act(sm(), "Teleport"), idle(lax()), act(chomp(), "Dragon Claw", OR), idle(toise())),
    checks: "canSwitch false: Teleport fails, the turn is modelled.",
  },
  {
    id: "S48-UTurn-last", title: "U-turn as the last action", game: "sv", endNotEstimated: "Vespiquen switches out: the replacement is not known.",
    slots: slots(act(mon("Vespiquen", "Pressure"), "U-turn", PL), idle(toise()), act(chomp(), "Dragon Claw", OL), idle(saur())),
    checks: "The moves are estimated; the end of turn is not (switchesOut).",
  },
  // ---- S49: budget (Teeter Dance + Quick Claw + four movers + ties).
  {
    id: "S49", title: "Teeter Dance, Quick Claw, four movers, a tie", game: "sv", oracle: "modes",
    slots: slots(act(mon("Lilligant", "Chlorophyll"), "Teeter Dance"), act(lax({ item: "Quick Claw" }), "Body Slam", PL),
      act(toise(), "Water Pulse", OR), act(mon("Blastoise", "Torrent"), "Ice Beam", OL)),
    checks: "Budget case: every Pokémon confused, a Quick Claw and an equal-Speed pair (Blastoise 98 twice).",
  },
  // ---- S50: moves → end of turn.
  {
    id: "S50", title: "Toxic, Will-O-Wisp and Spore this turn, then the end of turn", game: "sv",
    slots: slots(act(mon("Darkrai", "Bad Dreams"), "Will-O-Wisp", PL), act(mon("Breloom", "Technician"), "Spore", PR), act(gengar(), "Toxic", OR), idle(lax())),
    checks: "Darkrai burns Gengar, Gengar badly poisons Breloom, Breloom puts Snorlax to sleep. End of turn: burn 1/16, bad poison stage 0 → 1/16, Bad Dreams 1/8 on the new sleeper.",
  },
];

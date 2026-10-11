// Track H (wave 1a): the hidden state's validation cases (ADDENDUM2 §7.2's T2M-SI, T2E-SI-01, CQ-SKD and IN-CHG-01 as
// scenarios, here under H- ids so they do not clash with Track V1's official files). Showdown names; level 50, 31 IVs,
// Serious nature, 0 EVs unless set. Run with w1a-h-run.ts.
import type { Case, Game } from "../../2v2/verify/case-types";
import { OL, OR, PL, PR, act, carried, idle, lax, mon, perGame, slots } from "../../2v2/verify/case-kit";

const k = (game: Game, n: number) => (game === "champions" ? n : n * 8);
const fastSpe = (game: Game) => (game === "champions" ? 32 : 252);
const slam = (game: Game) => (game === "champions" ? "Body Slam" : "Tackle");

export const H_CASES: Case[] = [
  // T2M-SI-01: Dig, the ally's Earthquake ×2 into it (T2-SI01).
  ...perGame("H-SI-01", ["sv", "champions"], (game) => ({
    title: "Garchomp Dig; its ally Excadrill's Earthquake hits it underground at 2x, the foes at 0.75",
    slots: slots(act(mon("Garchomp", "Rough Skin", { evs: { spe: fastSpe(game) }, nature: "Jolly" }), "Dig", PL),
      act(mon("Excadrill", "Mold Breaker", { evs: { atk: game === "champions" ? 32 : 252, spe: k(game, 12) } }), "Earthquake"), idle(lax(k(game, 4))), idle(lax(k(game, 8)))),
    checks: "dig onInvulnerability lets Earthquake through, onSourceModifyDamage 2x.",
    outcomes: true,
  })),
  // T2M-SI-02: Dig: a foe's Body Slam misses, the other foe's Earthquake ×2 and 0.75 (T2-SI02).
  ...perGame("H-SI-02", ["sv", "champions"], (game) => ({
    title: "Garchomp Dig; a foe's Body Slam at it misses; the other foe's Earthquake hits it at 2x",
    slots: slots(act(mon("Garchomp", "Rough Skin", { evs: { spe: fastSpe(game) } }), "Dig", PL), idle(lax(k(game, 1))),
      act(mon("Snorlax", "Thick Fat", { evs: { spe: k(game, 2) } }), "Body Slam", OL), act(mon("Hippowdon", "Sand Stream", { evs: { spe: 0 } }), "Earthquake")),
    checks: "Body Slam [miss]; Earthquake 2x into Dig.",
    field: { weather: "Sand" },
    weatherTurns: 3,
  })),
  // T2M-SI-03: Fly: Hurricane hits, Gust ×2 (T2-SI03).
  ...perGame("H-SI-03", ["sv"], (game) => ({
    title: "Dragonite Fly; a foe's Gust 2x and the other foe's Hurricane hit it",
    slots: slots(act(mon("Dragonite", "Inner Focus", { evs: { spe: fastSpe(game) } }), "Fly", PL), idle(lax(1)),
      act(mon("Pelipper", "Keen Eye"), "Hurricane", OL), act(mon("Drifblim", "Aftermath", { evs: { spe: 0 }, ivs: { spe: 0 }, nature: "Brave" }), "Gust", OL)),
    checks: "fly onInvulnerability passes Gust and Hurricane; Gust 2x (onSourceModifyDamage).",
    outcomes: true,
  })),
  ...perGame("H-SI-03b", ["champions"], () => ({
    title: "Dragonite Fly; a foe's Hurricane hits it, the other foe's Thunderbolt misses",
    slots: slots(act(mon("Dragonite", "Inner Focus", { evs: { spe: 32 } }), "Fly", PL), idle(lax(1)),
      act(mon("Pelipper", "Keen Eye"), "Hurricane", OL), act(mon("Raichu", "Static", { evs: { spe: 0 } }), "Thunderbolt", OL)),
    checks: "Thunderbolt is not in Fly's list.",
  })),
  // T2M-SI-04: Fly: Rock Slide misses it, 0.75 on the ally (T2-SI04).
  ...perGame("H-SI-04", ["champions", "sv"], (game) => ({
    title: "Dragonite Fly; a foe's Rock Slide misses it and hits its ally at 0.75",
    slots: slots(act(mon("Dragonite", "Inner Focus", { evs: { spe: fastSpe(game) } }), "Fly", PL), idle(lax(k(game, 1))),
      act(mon("Tyranitar", "Unnerve"), "Rock Slide"), idle(lax(k(game, 2)))),
    checks: "spreadHit set before the steps: the ally takes 0.75.",
  })),
  // T2M-SI-06: Bounce, Gust ×2 by power (T2-SI05).
  ...perGame("H-SI-06", ["swsh", "usum"], (game) => ({
    title: "Lopunny Bounce; a foe's Gust 2x power, the other's Twister",
    slots: slots(act(mon("Lopunny", "Limber", { evs: { spe: 252 } }), "Bounce", PL), idle(lax(8)),
      act(game === "usum" ? mon("Pidgeot", "Keen Eye") : mon("Butterfree", "Compound Eyes"), "Gust", OL), act(mon("Dragonite", "Inner Focus", { evs: { spe: 0 } }), "Twister")),
    checks: "bounce onSourceBasePower 2x for Gust and Twister.",
  })),
  // T2M-SI-07: Dive: Surf ×2 (T2-SI06).
  ...perGame("H-SI-07", ["usum", "sv"], (game) => ({
    title: "Dive; a foe's Surf hits it at 2x, its ally and the foe's ally at 0.75",
    slots: slots(act(game === "usum" ? mon("Kingdra", "Swift Swim", { evs: { spe: 252 } }) : mon("Dewgong", "Thick Fat", { evs: { spe: 252 } }), "Dive", PL), idle(lax(8)),
      act(game === "usum" ? mon("Starmie", "Illuminate") : mon("Azumarill", "Thick Fat"), "Surf"), idle(lax(16))),
    checks: "dive onInvulnerability passes Surf, 2x.",
    outcomes: true,
  })),
  // T2M-SI-08: Phantom Force: Earthquake misses; No Guard hits (T2-SI07).
  ...perGame("H-SI-08", ["sv"], () => ({
    title: "Dragapult Phantom Force; a foe's Earthquake misses it; a No Guard Machamp's Knock Off hits it",
    slots: slots(act(mon("Dragapult", "Clear Body", { evs: { spe: 252 } }), "Phantom Force", PL), idle(lax(8)),
      act(mon("Garchomp", "Rough Skin"), "Earthquake"), act(mon("Lycanroc-Midnight", "No Guard", { evs: { spe: 0 } }), "Crunch", OL)),
    checks: "phantomforce onInvulnerability false; No Guard (priority 1) passes it.",
  })),
  // T2M-SI-09: Toxic from a Poison type hits a Fly user, a Snorlax's misses (T2-SI08).
  ...perGame("H-SI-09", ["sv", "usum"], () => ({
    title: "Dragonite Fly; a Poison-type Toxapex's Toxic hits it; a Snorlax's Toxic misses",
    slots: slots(act(mon("Dragonite", "Inner Focus", { evs: { spe: 252 } }), "Fly", PL), idle(lax(8)),
      act(mon("Toxapex", "Regenerator", { evs: { spe: 24 } }), "Toxic", OL), act(mon("Breloom", "Effect Spore", { evs: { spe: 0 }, ivs: { spe: 0 }, nature: "Brave" }), "Toxic", OL)),
    checks: "gen 8+: hitStepInvulnerabilityEvent's Poison Toxic; gen 7: the toxic volatile.",
    outcomes: true,
  })),
  // T2M-SI-10: Gravity lands the Fly user; a later Thunderbolt hits (T2-SI09).
  ...perGame("H-SI-10", ["sv", "champions"], (game) => ({
    title: "Dragonite Fly; a foe's Gravity lands it; a slower foe's Thunderbolt then hits it",
    slots: slots(act(mon("Dragonite", "Inner Focus", { evs: { spe: fastSpe(game) } }), "Fly", PL), idle(lax(k(game, 1))),
      act(game === "champions" ? mon("Clefable", "Magic Guard", { evs: { spe: 0 } }) : mon("Bronzong", "Levitate", { evs: { spe: 0 } }), "Gravity"), act(mon("Raichu", "Static", { evs: { spe: 0 }, ivs: { spe: 0 }, nature: "Brave" }), "Thunderbolt", OL)),
    checks: "gravity onFieldStart removes fly; the later Thunderbolt hits.",
    outcomes: true,
  })),
  // T2M-SI-11: Lightning Rod redirects into its digging holder, which misses (T2-SI10).
  ...perGame("H-SI-11", ["usum", "swsh"], () => ({
    title: "Alolan Marowak (Lightning Rod) Dig; a foe's Thunderbolt at its ally is redirected to it and misses",
    slots: slots(act(mon("Marowak-Alola", "Lightning Rod", { evs: { spe: 252 }, nature: "Jolly" }), "Dig", PL), idle(lax(8)),
      act(mon("Raichu", "Static", { evs: { spe: 0 }, ivs: { spe: 0 }, nature: "Brave" }), "Thunderbolt", OR), idle(lax(16))),
    checks: "the redirection, then the invulnerability step: no Sp. Atk rise.",
  })),
  // T2M-SI-12: Thunder Wave and a spread Growl miss; Pollen Puff misses; Perish Song misses; Haze reaches (T2-SI11, 11b).
  ...perGame("H-SI-12", ["sv"], () => ({
    title: "Dragonite Fly; a foe's Thunder Wave misses it; the other's Growl misses it and lowers its ally",
    slots: slots(act(mon("Dragonite", "Inner Focus", { evs: { spe: 252 } }), "Fly", PL), idle(lax(8)),
      act(mon("Raichu", "Static", { evs: { spe: 16 } }), "Thunder Wave", OL), act(mon("Clefable", "Magic Guard", { evs: { spe: 0 } }), "Growl")),
    checks: "status moves miss a hidden Pokémon.",
  })),
  ...perGame("H-SI-12b", ["sv"], () => ({
    title: "Dragonite Fly; its ally's Pollen Puff misses it; a foe's Haze reaches it; a foe's Perish Song misses it",
    slots: slots(act(mon("Dragonite", "Inner Focus", { evs: { spe: 252 }, nature: "Jolly", boosts: { atk: 2 }, hp: 100 }), "Fly", PL), act(mon("Amoonguss", "Regenerator", { evs: { spe: 0 } }), "Pollen Puff", OL),
      act(mon("Clodsire", "Water Absorb", { evs: { spe: 64 } }), "Haze"), act(mon("Gengar", "Cursed Body"), "Perish Song")),
    checks: "Pollen Puff [miss]; Haze has no step; Perish Song's own check misses it.",
    outcomes: true,
  })),
  // T2M-SI-13: a carried Fly: hidden from the turn's start, released; a release stopped at BeforeMove ends it (H01).
  ...perGame("H-SI-13", ["champions", "sv"], (game) => ({
    title: "Dragonite's Fly charged last turn: a faster Thunderbolt misses; the release hits; a slower Body Slam then hits it",
    slots: slots(act(carried(mon("Dragonite", "Inner Focus", { evs: { spe: k(game, 10) } }), { charging: "fly" }), "Fly", PL), idle(lax(k(game, 1))),
      act(mon("Raichu", "Static", { evs: { spe: fastSpe(game) } }), "Thunderbolt", OL), act(lax(0), "Body Slam", OL)),
    checks: "hidden from the start; Fly's onTryMove removes it.",
  })),
  ...perGame("H-SI-13b", ["champions", "sv"], (game) => ({
    title: "The same Dragonite paralysed: a full paralysis (1/4) ends the hidden state at MoveAborted; a slower Body Slam hits",
    slots: slots(act(carried(mon("Dragonite", "Inner Focus", { status: "par", evs: { spe: fastSpe(game) }, nature: "Jolly" }), { charging: "fly" }), "Fly", PL), idle(lax(k(game, 1))),
      idle(lax(k(game, 2))), act(mon("Snorlax", "Thick Fat", { evs: { spe: 0 }, ivs: { spe: 0 }, nature: "Brave" }), "Body Slam", OL)),
    checks: "twoturnmove onMoveAborted (w1a-h-probes.ts H01).",
  })),
  // T2M-SI-14: Dragon Darts into a Fly target and its ally: both darts into the ally.
  ...perGame("H-SI-14", ["sv"], () => ({
    title: "Dragonite Fly; a foe's Dragon Darts at it: both darts into its ally",
    slots: slots(act(mon("Dragonite", "Inner Focus", { evs: { spe: 252 }, nature: "Jolly" }), "Fly", PL), idle(lax(8)),
      act(mon("Dragapult", "Clear Body", { ivs: { spe: 0 }, nature: "Brave" }), "Dragon Darts", OL), idle(lax(16))),
    checks: "smartTarget turned off at the invulnerability step.",
  })),
  // T2E-SI-01: E2 charging after a charge; none after Gravity's landing.
  ...perGame("H-SIE-01", ["champions", "sv"], (game) => ({
    title: "Dragonite Fly as the last action (E2: charging fly); Garchomp Dig, then Gravity (Dig is not landed)",
    slots: slots(act(mon("Dragonite", "Inner Focus", { evs: { spe: 0 } }), "Fly", PL), act(mon("Garchomp", "Rough Skin", { evs: { spe: fastSpe(game) } }), "Dig", PL),
      act(game === "champions" ? mon("Clefable", "Magic Guard", { evs: { spe: 4 } }) : mon("Bronzong", "Levitate", { evs: { spe: k(game, 4) } }), "Gravity"), idle(lax(k(game, 8)))),
    checks: "E2 charging: fly (the charge after Gravity), dig.",
    outcomes: true,
  })),
  // IN-CHG-01: a carried Dig; a faster Night Slash misses; Dig released; Earthquake.
  ...perGame("H-CHG-01", ["sv", "champions"], (game) => ({
    title: "Garchomp's Dig charged last turn: a faster Weavile's Night Slash misses; Dig released; Snorlax's Earthquake",
    slots: slots(act(mon("Weavile", "Pressure", { evs: { spe: fastSpe(game) } }), "Night Slash", PR), act(lax(k(game, 0)), "Earthquake"),
      idle(lax(k(game, 1))), act(carried(mon("Garchomp", "Rough Skin"), { charging: "dig" }), "Dig", OL)),
    checks: "out of reach from the turn's start.",
  })),
  // Crash into a hidden target (FX-CR-06's scenario).
  ...perGame("H-CR-01", ["sv"], () => ({
    title: "Dragonite Fly; a foe's High Jump Kick at it misses and crashes",
    slots: slots(act(mon("Dragonite", "Inner Focus", { evs: { spe: 252 } }), "Fly", PL), idle(lax(4)),
      act(mon("Hitmonlee", "Limber"), "High Jump Kick", OL), idle(lax(8))),
    checks: "a miss at the invulnerability step: MoveFail, the crash.",
  })),
  // Lock-On from last turn: the user's move at its locked target passes Dig.
  ...perGame("H-LCK-01", ["sv"], () => ({
    title: "Garchomp Dig; a foe locked on to it last turn hits it with Body Slam; the other foe's Body Slam misses",
    slots: slots(act(mon("Garchomp", "Rough Skin", { evs: { spe: 252 } }), "Dig", PL), idle(lax(8)),
      act(carried(lax(4), { lockOn: OL }), "Body Slam", OL), act(lax(0), "Body Slam", OL)),
    checks: "lockon onSourceInvulnerability.",
  })),
  // CQ-SKD-01 (CQ08): Sky Drop lifts Clefairy: its own Pound is lost; its partner's Tackle at the Sky Drop user misses.
  ...perGame("H-SKD-01", ["usum"], () => ({
    title: "Braviary Sky Drop lifts Clefairy: Clefairy's Pound never runs; its partner's Tackle at Braviary misses",
    slots: slots(act(mon("Braviary", "Keen Eye", { evs: { spe: 252 } }), "Sky Drop", PR), idle(lax(8)),
      act(lax(24), "Tackle", OL), act(mon("Clefairy", "Friend Guard", { evs: { spe: 4 } }), "Pound", OL)),
    checks: "skydrop onFoeBeforeMove null; onAnyInvulnerability for the pair.",
    outcomes: true,
  })),
  // CQ-SKD-02 (CQ08b): the same with the partner's Gust: it hits the Sky Drop user, unboosted.
  ...perGame("H-SKD-02", ["usum"], () => ({
    title: "Braviary Sky Drop lifts Clefairy; its partner's Gust at Braviary hits (no 2x)",
    slots: slots(act(mon("Braviary", "Keen Eye", { evs: { spe: 252 } }), "Sky Drop", PR), idle(lax(8)),
      act(mon("Pidgeot", "Keen Eye", { evs: { spe: 0 } }), "Gust", OL), act(mon("Clefairy", "Friend Guard", { evs: { spe: 4 } }), "Pound", OL)),
    checks: "Gust passes; onAnyBasePower reads the attacker (STEP0B).",
  })),
  // T2P-SKD-02: 200 kg or more fails; the target then acts.
  ...perGame("H-SKD-03", ["usum"], () => ({
    title: "Braviary Sky Drop into a 460 kg Snorlax fails; Snorlax's Body Slam then hits it",
    slots: slots(act(mon("Braviary", "Keen Eye", { evs: { spe: 252 } }), "Sky Drop", PR), idle(lax(8)),
      idle(lax(24)), act(lax(4), "Body Slam", OL)),
    checks: "skydrop onTryHit [heavy].",
  })),
  // Sky Drop into Spiky Shield: blocked with no contact damage (the charge turn has no contact flag).
  ...perGame("H-SKD-04", ["usum"], () => ({
    title: "Braviary Sky Drop into Chesnaught's Spiky Shield: blocked, Braviary takes no damage",
    slots: slots(act(mon("Braviary", "Keen Eye", { evs: { spe: 252 } }), "Sky Drop", PR), idle(lax(8)),
      idle(lax(24)), act(mon("Chesnaught", "Bulletproof"), "Spiky Shield")),
    checks: "skydrop onModifyMove deletes contact on the charge turn.",
  })),
  // Gravity frees the lifted Pokémon: its queued Body Slam then runs.
  ...perGame("H-SKD-05", ["usum"], () => ({
    title: "Braviary Sky Drop lifts Clefable; Bronzong's Gravity frees it; its slower Body Slam then hits Braviary",
    slots: slots(act(mon("Braviary", "Keen Eye", { evs: { spe: 252 } }), "Sky Drop", PR), idle(lax(8)),
      act(mon("Bronzong", "Levitate", { evs: { spe: 252 } }), "Gravity"), act(mon("Clefable", "Magic Guard", { evs: { spe: 0 }, ivs: { spe: 0 }, nature: "Brave" }), "Body Slam", OL)),
    checks: "gravity onFieldStart removes skydrop (cancelMove of the user: none queued); the lifted Pokémon acts.",
    outcomes: true,
  })),
  // Sky Drop on a Rage Powder user: a later foe move goes to its chosen target.
  ...perGame("H-SKD-06", ["usum"], () => ({
    title: "Amoonguss Rage Powder; Braviary Sky Drop lifts it; Braviary's ally's Tackle goes to its chosen target",
    slots: slots(act(mon("Braviary", "Keen Eye", { evs: { spe: 252 } }), "Sky Drop", PR), act(lax(0), "Tackle", PL),
      idle(lax(24)), act(mon("Amoonguss", "Regenerator"), "Rage Powder")),
    checks: "ragepowder onFoeRedirectTarget isSkyDropped.",
  })),
  // The Sky Drop user knocked out by Thunder frees the lifted Pokémon, whose slower Pound then runs.
  ...perGame("H-SKD-07", ["usum"], () => ({
    title: "Braviary (40 HP) Sky Drop lifts Clefable; a foe's Thunder knocks Braviary out; Clefable's slower Pound runs",
    slots: slots(act(mon("Braviary", "Keen Eye", { evs: { spe: 252 }, hp: 40 }), "Sky Drop", PR), idle(lax(8)),
      act(mon("Raichu", "Static", { evs: { spe: 0, spa: 252 } }), "Thunder", OL), act(mon("Clefable", "Magic Guard", { evs: { spe: 0 }, ivs: { spe: 0 }, nature: "Brave" }), "Pound", OR)),
    checks: "skydrop onFaint; isSkyDropped reads the volatile.",
  })),
  // A carried Fly cancelled by a faster Gravity (cancelMove): the slower Thunderbolt then hits it.
  ...perGame("H-SI-10b", ["sv"], () => ({
    title: "Dragonite's Fly charged last turn; a faster Bronzong's Gravity cancels it; a slower Thunderbolt hits Dragonite",
    slots: slots(act(carried(mon("Dragonite", "Inner Focus", { evs: { spe: 0 }, ivs: { spe: 0 }, nature: "Brave" }), { charging: "fly" }), "Fly", PL), idle(lax(8)),
      act(mon("Bronzong", "Levitate", { evs: { spe: 252 } }), "Gravity"), act(lax(0), "Thunderbolt", OL)),
    checks: "gravity onFieldStart: removeVolatile fly, cancelMove, twoturnmove removed.",
    outcomes: true,
  })),
  // A carried Dive stopped by a full paralysis: no longer under water at the end of turn (Sandstorm hits it).
  ...perGame("H-SI-13c", ["sv"], () => ({
    title: "Dewgong's Dive charged last turn, paralysed, in a Sandstorm: released or fully paralysed, the Sandstorm hits it",
    slots: slots(act(carried(mon("Dewgong", "Thick Fat", { status: "par", evs: { spe: 252 } }), { charging: "dive" }), "Dive", PL), idle(lax(8)),
      idle(lax(4)), idle(lax(0))),
    field: { weather: "Sand" },
    weatherTurns: 3,
    checks: "twoturnmove onMoveAborted ends the dive volatile (w1a-h-probes.ts H01).",
    outcomes: true,
  })),
  // Cramorant's Dive charge: Gulping above half its HP (E2 species), Gorging at half or less.
  ...perGame("H-CRM-01", ["sv"], () => ({
    title: "Cramorant (Gulp Missile) Dive at full HP: it becomes Gulping Cramorant",
    slots: slots(act(mon("Cramorant", "Gulp Missile", { evs: { spe: 252 } }), "Dive", PL), idle(lax(8)), idle(lax(4)), idle(lax(0))),
    checks: "dive onTryMove formeChange.",
    outcomes: true,
  })),
  ...perGame("H-CRM-02", ["sv"], () => ({
    title: "Cramorant (Gulp Missile) Dive at half its HP: it becomes Gorging Cramorant",
    slots: slots(act(mon("Cramorant", "Gulp Missile", { evs: { spe: 252 }, hp: 70 }), "Dive", PL), idle(lax(8)), idle(lax(4)), idle(lax(0))),
    checks: "dive onTryMove formeChange at hp <= maxhp / 2.",
    outcomes: true,
  })),
  // A sleeping Pokémon lifted by Sky Drop: its BeforeMove is null before sleep's (its counter does not move).
  ...perGame("H-SKD-08", ["usum"], () => ({
    title: "Braviary Sky Drop lifts an asleep Clefable (one turn slept): its sleep counter does not move",
    slots: slots(act(mon("Braviary", "Keen Eye", { evs: { spe: 252 } }), "Sky Drop", PR), idle(lax(8)),
      idle(lax(24)), act(carried(mon("Clefable", "Magic Guard", { status: "slp", evs: { spe: 0 } }), { sleep: { attempts: 1, rest: false } }), "Moonblast", OL)),
    checks: "skydrop onFoeBeforeMove (priority 12) before slp onBeforeMove (10).",
    outcomes: true,
  })),
  // Sky Drop keeps its chosen target past a Follow Me (tracksTarget: no RedirectTarget).
  ...perGame("H-SKD-09", ["usum"], () => ({
    title: "Clefable Follow Me; Braviary's Sky Drop at its partner still lifts the partner",
    slots: slots(act(mon("Braviary", "Keen Eye", { evs: { spe: 252 } }), "Sky Drop", PL), idle(lax(8)),
      act(mon("Clefairy", "Friend Guard", { evs: { spe: 4 } }), "Pound", OL), act(mon("Clefable", "Magic Guard"), "Follow Me")),
    checks: "skydrop tracksTarget: true.",
  })),
];

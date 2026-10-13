import type { ProtectKind } from "./doubles-world";
import { STATUS_MOVE_TABLE, type StatusKind } from "./status-table";
export { CONFUSING_BERRIES, RESIST_BERRIES } from "./hit-loop";

// The doubles turn's move and ability tables and its "not estimated" reasons (SPEC §2.2, §4.4). Data from pinned
// Showdown c23d2e94 (data/moves.ts, data/abilities.ts, data/items.ts, data/mods/champions); tests/source checks the
// tables against it.

/** The protecting moves (data/moves.ts stallingMove with a protect volatile): each blocks moves with the protect flag. */
export const PROTECT_MOVES: Readonly<Record<string, ProtectKind>> = {
  protect: "protect", detect: "protect", kingsshield: "kingsshield", spikyshield: "spikyshield", banefulbunker: "banefulbunker",
  obstruct: "obstruct", silktrap: "silktrap", burningbulwark: "burningbulwark",
};

/**
 * What a protecting move does to an attacker whose blocked move makes contact (its condition's onTryHit, and onHit for a
 * Z-Move or Max Move that breaks through): King's Shield Attack −1 (−2 in generation 7, data/mods/gen7/moves.ts),
 * Spiky Shield 1/8 of its base maximum HP, Baneful Bunker poison, Obstruct Defense −2, Silk Trap Speed −1, Burning
 * Bulwark burn.
 */
export const PROTECT_CONTACT: Readonly<Record<ProtectKind, { stages?: Partial<Record<"atk" | "def" | "spe", number>>; damage?: number; status?: "psn" | "brn" } | null>> = {
  protect: null, kingsshield: { stages: { atk: -1 } }, spikyshield: { damage: 8 }, banefulbunker: { status: "psn" },
  obstruct: { stages: { def: -2 } }, silktrap: { stages: { spe: -1 } }, burningbulwark: { status: "brn" },
};

/** The screens and Tailwind (data/moves.ts sideCondition on the user's side, target allySide), by the side flag each sets. */
export const SIDE_MOVES: Readonly<Record<string, "tailwind" | "reflect" | "lightScreen" | "auroraVeil">> = {
  tailwind: "tailwind", reflect: "reflect", lightscreen: "lightScreen", auroraveil: "auroraVeil",
};
/** The weather moves (data/moves.ts weather) and the weather each sets. */
export const WEATHER_MOVES: Readonly<Record<string, "Sun" | "Rain" | "Sand" | "Snow" | "Hail">> = {
  sunnyday: "Sun", raindance: "Rain", sandstorm: "Sand", snowscape: "Snow", hail: "Hail",
};
/** The terrain moves (data/moves.ts terrain) and the terrain each sets. */
export const TERRAIN_MOVES: Readonly<Record<string, "Electric" | "Grassy" | "Misty" | "Psychic">> = {
  electricterrain: "Electric", grassyterrain: "Grassy", mistyterrain: "Misty", psychicterrain: "Psychic",
};
/** The strong weathers and the ability that keeps each up (data/abilities.ts desolateland, primordialsea, deltastream onAnySetWeather). */
export const STRONG_WEATHERS: Readonly<Record<string, string>> = { "Harsh Sunshine": "desolateland", "Heavy Rain": "primordialsea", "Strong Winds": "deltastream" };

/** The status moves of one kind (status-table.ts: status-eot SPEC §2.2, ADDENDUM §2.2). */
const kindOf = (...kinds: StatusKind[]) => Object.entries(STATUS_MOVE_TABLE).filter(([, entry]) => kinds.includes(entry.kind)).map(([id]) => id);

/**
 * Status moves the turn models: the M and C moves of status-table.ts (doubles-status.ts statusMove's pipeline, a C move
 * under its condition), and today's X moves it follows: the protecting moves, Wide Guard and Quick Guard, Helping Hand,
 * Follow Me and Rage Powder, Tailwind, Trick Room and Gravity, the weather and terrain moves, Reflect, Light Screen and
 * Aurora Veil.
 */
export const MODELLED_STATUS_MOVES: ReadonlySet<string> = new Set([
  ...Object.keys(PROTECT_MOVES), "wideguard", "quickguard", "helpinghand", "followme", "ragepowder", "trickroom", "gravity",
  ...Object.keys(SIDE_MOVES), ...Object.keys(WEATHER_MOVES), ...Object.keys(TERRAIN_MOVES), ...kindOf("M", "C"),
]);

/** Status moves with no effect on this turn's HP or order (status-table.ts kind N): exact by doing nothing; the hazards land on a side (E2). */
export const NO_EFFECT_MOVES: ReadonlySet<string> = new Set(kindOf("N"));

/**
 * Status moves the turn never estimates, wherever they come (presence guards: `{Move} is not modelled.`): Revival Blessing
 * (kind P). status2: Purify, Stuff Cheeks, Swallow and Teatime left it with their kind (A1, A3; integration 1a).
 */
export const HP_STATUS_MOVES: ReadonlySet<string> = new Set(kindOf("P"));

/** Moves the 2v2 turn does not model at all (SPEC §2.2 presence rows): `{Move} is not modelled in 2v2.` Flame Burst's splash damage (status-eot C17). */
export const PRESENCE_MOVES: ReadonlySet<string> = new Set([
  "spotlight", "round", "beakblast", "shelltrap", "beatup", "fusionbolt", "fusionflare", "counter", "mirrorcoat", "metalburst", "comeuppance", "flameburst",
]);

/** Moves whose user faints as they start (data/moves.ts selfdestruct "always": sim/battle-actions.ts useMoveInner faints it after TryMove, before any hit). */
export const SELF_DESTRUCT_MOVES: ReadonlySet<string> = new Set(["explosion", "selfdestruct", "mistyexplosion"]);
/** Moves that cost their user half its maximum HP as they hit (data/moves.ts mindblown, steelbeam, chloroblast; status2: shared by doubles-turn.ts and doubles-reactions.ts). */
export const SELF_COST_MOVES: ReadonlySet<string> = new Set(["mindblown", "steelbeam", "chloroblast"]);
/** The moves Damp stops (data/abilities.ts damp onAnyTryMove). */
export const DAMP_MOVES: ReadonlySet<string> = new Set(["explosion", "mindblown", "mistyexplosion", "selfdestruct"]);
/**
 * Damaging moves with a 100% volatile secondary the pair's step does not carry to later moves (doubles-turn.ts
 * volatileGuard). Throat Chop's is followed (doubles-turn.ts afterHit, MonState.throatChopped).
 */
export const VOLATILE_SECONDARY_MOVES: ReadonlySet<string> = new Set(["psychicnoise", "coreenforcer", "burningjealousy", "alluringvoice", "spectralthief"]);
/** Damaging moves whose 100% secondary confuses (data/moves.ts dynamicpunch, chatter: chance 100, volatileStatus confusion). */
export const CONFUSING_MOVES: ReadonlySet<string> = new Set(["dynamicpunch", "chatter"]);
/** The moves with callsMove (data/moves.ts: they use a move picked from the battle or at random), and Instruct (its target uses its move again). */
export const CALLING_MOVES: ReadonlySet<string> = new Set(["assist", "copycat", "mefirst", "metronome", "mirrormove", "naturepower", "sleeptalk", "instruct"]);
/** The Pledge moves (data/moves.ts firepledge, grasspledge, waterpledge onPrepareHit: two different ones from partners combine). */
export const PLEDGE_MOVES: ReadonlySet<string> = new Set(["firepledge", "grasspledge", "waterpledge"]);
/** Moves that take a type from their user as they hit (data/moves.ts burnup, doubleshock self.onHit setType). */
export const TYPE_LOSS_MOVES: ReadonlySet<string> = new Set(["burnup", "doubleshock"]);
/** Moves that drag their target out (data/moves.ts dragontail, circlethrow forceSwitch). */
export const DRAG_MOVES: ReadonlySet<string> = new Set(["dragontail", "circlethrow"]);
/** Abilities that keep their holder in against a forced switch (data/abilities.ts suctioncups, guarddog onDragOut). */
export const ANCHORING_ABILITIES: ReadonlySet<string> = new Set(["suctioncups", "guarddog"]);
/** The busted form an intact Disguise or Ice Face takes on after the hit it takes (data/abilities.ts disguise, iceface onUpdate). */
export const BUSTED_FORMS: Readonly<Record<string, string>> = { mimikyu: "mimikyubusted", mimikyutotem: "mimikyubustedtotem", eiscue: "eiscuenoice" };
/**
 * G-Max moves' effects beyond MAX_MOVE_EFFECTS (data/moves.ts gmax* self.onHit) for doubles-turn.ts maxEffects:
 * `foeStages` and `foeStatus` on each foe, `side` a screen on the user's side, `gravity`, `curesAllies`; `guard`
 * "later" while a later action follows (confusion, infatuation, a critical-hit stage, a Berry restored at random),
 * "always" for HP it heals. G-Max Tartness's evasion drop on each foe (self.onHit boost) changes no calculation, but
 * meets the foes' TryBoost and sets off Defiant, Competitive, Mirror Armor and Eject Pack. The others change nothing this
 * turn's HP or order reads (residual damage, hazards, trapping, Torment, PP, Yawn).
 */
export const GMAX_EFFECTS: Readonly<Record<string, {
  foeStages?: Partial<Record<"atk" | "def" | "spa" | "spd" | "spe" | "accuracy" | "evasion", number>>; foeStatus?: "par" | "psn"; side?: "auroraVeil"; gravity?: true;
  curesAllies?: true; guard?: "later" | "always";
}>> = {
  "G-Max Foam Burst": { foeStages: { spe: -2 } }, "G-Max Tartness": { foeStages: { evasion: -1 } }, "G-Max Volt Crash": { foeStatus: "par" }, "G-Max Malodor": { foeStatus: "psn" },
  "G-Max Resonance": { side: "auroraVeil" }, "G-Max Gravitas": { gravity: true }, "G-Max Sweetness": { curesAllies: true },
  "G-Max Smite": { guard: "later" }, "G-Max Gold Rush": { guard: "later" }, "G-Max Cuddle": { guard: "later" }, "G-Max Chi Strike": { guard: "later" },
  "G-Max Replenish": { guard: "later" }, "G-Max Finale": { guard: "always" },
};
/** Moves Gravity stops in BeforeMove (data/moves.ts flags.gravity; data/moves.ts gravity condition onBeforeMove). */
export const GRAVITY_MOVES: ReadonlySet<string> = new Set(["bounce", "floatyfall", "fly", "flyingpress", "highjumpkick", "jumpkick", "magnetrise", "skydrop", "splash", "telekinesis"]);
/** Moves that land at the end of a later turn (data/moves.ts flags.futuremove): no damage this turn. */
export const FUTURE_MOVES: ReadonlySet<string> = new Set(["futuresight", "doomdesire"]);
/** Two-turn moves whose user is not semi-invulnerable while it charges (data/moves.ts flags.charge; Sky Drop aside). */
export const CHARGE_TURN_MOVES: ReadonlySet<string> = new Set(["solarbeam", "solarblade", "meteorbeam", "electroshot", "skyattack", "skullbash", "razorwind", "freezeshock", "iceburn"]);

/** Charge moves whose user is semi-invulnerable on its charge turn (data/moves.ts: the volatile's onInvulnerability), Sky Drop aside. */
export const SEMI_INVULNERABLE_MOVES: ReadonlySet<string> = new Set(["fly", "dig", "dive", "bounce", "phantomforce", "shadowforce"]);
/** Moves that switch their user out (data/moves.ts selfSwitch). */
export const SWITCH_MOVES: ReadonlySet<string> = new Set(["uturn", "voltswitch", "flipturn", "partingshot", "teleport", "batonpass", "chillyreception", "shedtail"]);
/**
 * Status moves that, with Neutralizing Gas on the field, can end it or change what it suppresses (doubles-turn.ts
 * statusMove): they change or suppress an ability (Gastro Acid, Worry Seed, Simple Beam, Entrainment, Skill Swap, Role
 * Play, Doodle, Transform), drag a Pokémon out (Roar, Whirlwind), or move an Ability Shield (Trick, Switcheroo). status2
 * (SPEC2 §8.4): Bestow, Corrosive Gas, Embargo and Magic Room left it; gasShieldGuard follows a Shield they change.
 */
export const GAS_CHANGING_MOVES: ReadonlySet<string> = new Set([
  "gastroacid", "worryseed", "simplebeam", "entrainment", "skillswap", "roleplay", "doodle", "transform", "roar", "whirlwind",
  "trick", "switcheroo",
]);
/** Abilities that replace an attacker's on contact (data/abilities.ts mummy, lingeringaroma, wanderingspirit onDamagingHit). */
export const ABILITY_REPLACERS: ReadonlySet<string> = new Set(["mummy", "lingeringaroma", "wanderingspirit"]);
/** Dance moves (data/moves.ts flags.dance), which a Dancer copies (sim/battle-actions.ts runMove). */
export const DANCE_MOVES: ReadonlySet<string> = new Set([
  "aquastep", "clangoroussoul", "dragondance", "featherdance", "fierydance", "lunardance", "petaldance", "quiverdance", "revelationdance", "swordsdance",
  "teeterdance", "victorydance",
]);
/** G-Max moves whose status is random (data/moves.ts gmaxbefuddle, gmaxstunshock). */
export const RANDOM_STATUS_MAX_MOVES: ReadonlySet<string> = new Set(["G-Max Befuddle", "G-Max Stun Shock"]);
/** Status moves that set the weather or a terrain (data/moves.ts weather, terrain). */
export const FIELD_MOVES: ReadonlySet<string> = new Set([
  "sunnyday", "raindance", "sandstorm", "snowscape", "hail", "electricterrain", "grassyterrain", "mistyterrain", "psychicterrain",
]);

/** Moves Stalwart and Propeller Tail need not ignore redirection for: their own tracksTarget (data/moves.ts). */
export const TRACKS_TARGET_MOVES: ReadonlySet<string> = new Set(["snipeshot", "skydrop"]);
/** Abilities that keep a move on its chosen target (sim/battle.ts getTarget; data/abilities.ts stalwart, propellertail onModifyMove tracksTarget). */
export const TRACKING_ABILITIES: ReadonlySet<string> = new Set(["stalwart", "propellertail"]);

/** The abilities that take a move of their type in TryHit (data/abilities.ts onTryHit), and what they do then. */
export const ABSORBING: Readonly<Record<string, { type?: string; wind?: true; heal?: true; stages?: Partial<Record<"atk" | "def" | "spa" | "spe", number>>; flashFire?: true }>> = {
  voltabsorb: { type: "Electric", heal: true }, waterabsorb: { type: "Water", heal: true }, dryskin: { type: "Water", heal: true },
  eartheater: { type: "Ground", heal: true }, lightningrod: { type: "Electric", stages: { spa: 1 } }, stormdrain: { type: "Water", stages: { spa: 1 } },
  motordrive: { type: "Electric", stages: { spe: 1 } }, sapsipper: { type: "Grass", stages: { atk: 1 } }, wellbakedbody: { type: "Fire", stages: { def: 2 } },
  windrider: { wind: true, stages: { atk: 1 } }, flashfire: { type: "Fire", flashFire: true },
};
/** onAnyRedirectTarget abilities and the type each takes (data/abilities.ts lightningrod, stormdrain). */
export const REDIRECT_ABILITIES: Readonly<Record<string, string>> = { lightningrod: "Electric", stormdrain: "Water" };

/** Abilities that bypass a target's breakable abilities (sim/pokemon.ts ignoringAbility via the source's moldbreaker flags). */
export const MOLD_BREAKERS: ReadonlySet<string> = new Set(["moldbreaker", "teravolt", "turboblaze"]);
/** Moves with ignoreAbility (data/moves.ts). */
export const IGNORE_ABILITY_MOVES: ReadonlySet<string> = new Set([
  "sunsteelstrike", "moongeistbeam", "photongeyser", "lightthatburnsthesky", "searingsunrazesmash", "menacingmoonrazemaelstrom", "gmaxdrumsolo", "gmaxfireball", "gmaxhydrosnipe",
]);

/**
 * The knocker-out's stat rise (data/abilities.ts onSourceAfterFaint, run once per faint batch with its length,
 * sim/battle.ts faintMessages): Moxie, Chilling Neigh and As One (Glastrier) Attack, Grim Neigh and As One (Spectrier)
 * Sp. Atk, Beast Boost and Eelevate the best raw stat (getBestStat(true, true)).
 */
export const KO_BOOSTS: Readonly<Record<string, "atk" | "spa" | "best">> = {
  moxie: "atk", chillingneigh: "atk", asoneglastrier: "atk", grimneigh: "spa", asonespectrier: "spa", beastboost: "best", eelevate: "best",
};
/**
 * Third-party handlers (SPEC §8.4, design/third-party.out; tests/source/doubles-third-party.test.ts) the engine follows,
 * or that change nothing it estimates: damage hooks the pairwise engine applies on the target, accuracy (every move
 * hits), trapping (no switch this turn), side status moves, redirection, absorbing, Friend Guard, the priority shields,
 * Telepathy, Plus and Minus, the auras and Ruins (mapped to the field), the strong weathers (no weather a modelled move
 * sets replaces them), Analytic's order, chances below 100% (Poison Touch, Toxic Chain), what acts on entry (an input:
 * Download and Trace settled as the turn starts, Intimidate applied before it, Anticipation, Forewarn, Frisk, Costar,
 * Curious Medicine, Hospitality, Supersweet Syrup), the end of the turn (doubles-eot.ts: Bad Dreams, Healer), White
 * Herb (the step's pair: each use's AfterMove), and Unnerve and As One (each step's from the four Pokémon,
 * doubles-turn.ts turnUnnerve; a resist Berry the calculation reads otherwise is guarded, unnerveGuard).
 */
export const MODELLED_THIRD_PARTY: ReadonlySet<string> = new Set([
  "armortail", "aromaveil", "arenatrap", "auraguard", "beadsofruin", "compoundeyes", "dazzling", "darkaura", "aurabreak", "dryskin", "fairyaura", "filter",
  "fluffy", "friendguard", "heatproof", "hustle", "icescales", "lightningrod", "liquidooze", "magicbounce", "magnetpull", "multiscale", "noguard",
  "parentalbond", "prismarmor", "punkrock", "purifyingsalt", "queenlymajesty", "ripen", "sapsipper", "shadowshield", "shadowtag", "solidrock",
  "soundproof", "stormdrain", "swordofruin", "tabletsofruin", "thickfat", "unaware", "unnerve", "vesselofruin", "victorystar", "waterbubble",
  "plus", "minus", "telepathy", "gulpmissile", "analytic", "anticipation", "forewarn", "frisk", "costar", "curiousmedicine", "hospitality",
  "supersweetsyrup", "download", "intimidate", "trace", "baddreams", "healer", "deltastream", "desolateland", "primordialsea",
  "poisontouch", "toxicchain",
  // The status-move pipeline and its statuses (doubles-status.ts: status-eot SPEC §9): Sweet Veil on its side, Good as Gold,
  // Oblivious, Own Tempo, Synchronize, Early Bird; the end of turn's (doubles-eot.ts): Hydration, Shed Skin, Big Root.
  "sweetveil", "goodasgold", "oblivious", "owntempo", "synchronize", "earlybird", "hydration", "shedskin", "bigroot",
  "babiriberry", "chartiberry", "chilanberry", "chopleberry", "cobaberry", "colburberry", "habanberry", "kasibberry", "kebiaberry", "occaberry",
  "passhoberry", "payapaberry", "rindoberry", "roseliberry", "shucaberry", "tangaberry", "wacanberry", "yacheberry", "widelens", "zoomlens", "normalgem",
  "micleberry", "whiteherb",
  // Faint reactions (doubles-turn.ts faint, koBoost): Soul-Heart on every faint, the knocker-out's rise.
  "soulheart", ...Object.keys(KO_BOOSTS),
  // Damp (doubles-turn.ts moveFailure): any holder stops the explosions in TryMove.
  "damp",
  // Flower Gift on a partner (doubles-turn.ts flowerGift: onAllyModifyAtk, onAllyModifySpD).
  "flowergift",
  // A partner's power boost (doubles-turn.ts conditionsFor, calculate.ts partnerPowerBoosts: onAllyBasePower).
  "battery", "powerspot", "steelyspirit",
  // Neutralizing Gas from the turn's start (calculate.ts settleDoublesStart's DoublesGas); its end is guarded (doubles-turn.ts gasEnds).
  "neutralizinggas",
]);

/** Third-party handlers guarded wherever the Pokémon is in the turn (presence): `{Ability or item} is not modelled in 2v2.` and the SPEC's own texts. */
export const PRESENCE_THIRD_PARTY: ReadonlySet<string> = new Set([
  "poisonpuppeteer", "imposter",
]);

/** Abilities a knockout reacts with that the turn does not follow (onSourceAfterFaint, onAllyFaint): guarded when one happens with a later action. */
export const FAINT_REACTIONS: ReadonlySet<string> = new Set(["receiver", "powerofalchemy"]);

/**
 * Third-party handlers guarded when they act (events): Flower Veil and Pastel Veil keeping a foe's drop or status of a
 * damaging move off their side (veilGuard; a status move's are modelled, doubles-status.ts canStatus and applyBoosts),
 * Aftermath and Innards Out as their holder is knocked out, Dancer on a dance move, Commander with Dondozo on its side,
 * Room Service as Trick Room starts, the faint reactions the turn does not follow, and Pickup at the end of the turn
 * (doubles-eot.ts).
 */
export const EVENT_THIRD_PARTY: ReadonlySet<string> = new Set([
  "flowerveil", "pastelveil", "aftermath", "innardsout", "dancer", "commander", "roomservice", ...FAINT_REACTIONS, "battlebond",
  "symbiosis", "mirrorherb", "opportunist", "cottondown", "ejectpack", "ejectbutton", "redcard", "emergencyexit", "wimpout", "pickup",
]);

/** Every third-party handler the engine does not follow: guarded, by presence or as an event. */
export const GUARDED_THIRD_PARTY: ReadonlySet<string> = new Set([...PRESENCE_THIRD_PARTY, ...EVENT_THIRD_PARTY]);

// "Not estimated" reasons (SPEC §2.2; status-eot SPEC §2.4, ADDENDUM §2.4), the parts in braces filled from the turn.
export const REASONS = {
  tooMany: "Too many cases to follow.",
  notModelled: (move: string) => `${move} is not modelled.`,
  notIn2v2: (name: string) => `${name} is not modelled in 2v2.`,
  // status-eot SPEC §2.4 (moves phase; the last three are end-of-turn reasons).
  /** Disable, Encore on a Pokémon still to act, lastMove undefined. */
  needsLastMove: (move: string, name: string) => `${move} needs ${name}'s move from the last turn.`,
  /** Encore: lastMove differs from its queued move. */
  encoreChange: (name: string) => `Encore changes ${name}'s move: not modelled.`,
  /** The user's moves undefined: Imprison (status2 C36: one key; Imprison passes "Imprison", so its text is unchanged), Sleep Talk. */
  needsMoves: (move: string, name: string) => `${move} needs ${name}'s moves.`,
  /** Pain Split. */
  withDynamax: (move: string) => `${move} with a Dynamaxed Pokémon is not modelled in 2v2.`,
  /** An intact Disguise or Ice Face against a confusion self-hit. */
  /** Berserk or Anger Shell after a confusion self-hit keeps its holder's healing Berry at or under its line: a later hit or the end of turn. */
  berryLocked: (ability: string, item: string) => `${item} after a confusion self-hit with ${ability} is not modelled in 2v2.`,
  /** status2 Step 1 #2: the same lock left by a Champions Sheer Force hit (a later hit or status move reaching the holder, its own status move). */
  berryLockedSheerForce: (ability: string, item: string) => `${item} held by ${ability} after a Sheer Force hit is not modelled in 2v2.`,
  /** A target's Starf, Ganlon or Apicot Berry (or Lansat with Cheek Pouch) eaten at the Update between two hits of one move. */
  berryBetweenHits: (item: string, move: string) => `${item} between the hits of ${move} is not modelled in 2v2.`,
  /** Sparkling Aria's burn cure when its user faints in the move with a Life Orb (the faint's timing decides it). */
  landing: (move: string) => `${move} landing is not modelled in 2v2.`,
  formChange: (ability: string, name: string) => `${ability} changing ${name}'s form is not modelled in 2v2.`,
  overTime: (move: string) => `${move}'s damage over time is not modelled in 2v2.`,
  // ADDENDUM §2.4.
  /** Dragon Darts after its ally's Ally Switch (A2, p1:149). */
  dartsAimSelf: "Dragon Darts aimed where its user now stands is not modelled in 2v2.",
  /** A Terrain Seed in its terrain, Room Service under Trick Room, Booster Energy for a Protosynthesis / Quark Drive holder (T10c). */
  received: (item: string, name: string) => `${item} received by ${name} is not modelled in 2v2.`,
  /** "Max Moves", "Parental Bond", "Magician", "Mind Blown", a signature Z-Move with an effect of its own (§4.13.2). */
  intoSubstitute: (what: string) => `${what} into a Substitute is not modelled in 2v2.`,
  /** A multi-hit move, and the Pokémon has an effect the engine's per-hit damages read (§4.13.6). */
  subPerHit: (move: string, name: string, what: string) => `${move} into ${name}'s Substitute with ${what} is not modelled in 2v2.`,
  maxGuard: "Max Guard is not modelled.",
  spreadEffect: (move: string, name: string) => `${move}'s effect on ${name} from more than one target is not modelled.`,
  switchesOut: (name: string) => `${name} switches out: the replacement is not known.`,
  copiesRise: (name: string) => `${name} copying a stat rise is not modelled in 2v2.`,
  fieldChange: (name: string) => `A weather or terrain change this turn would change ${name}.`,
  activates: (move: string, name: string) => `${move} would activate ${name}.`,
  randomStatus: (move: string) => `${move}'s random status is not modelled in 2v2.`,
  pledges: (move: string, other: string) => `${move} with ${other} is not modelled in 2v2.`,
  gasEnds: "Neutralizing Gas ending is not modelled in 2v2.",
  withGas: (name: string) => `${name} with Neutralizing Gas is not modelled in 2v2.`,
  gasShield: "An Ability Shield change under Neutralizing Gas is not modelled in 2v2.",
  // status2 SPEC2 §2.4 (Step 0a writes every key; a track starts calling it).
  /** A1: an ability Start the turn does not follow (Supreme Overlord; Forecast on Castform, Flower Gift on Cherrim). */
  abilityStart: (ability: string, name: string) => `${ability} starting on ${name} is not modelled in 2v2.`,
  /** A1: an ability End it does not follow (Zen Mode, Illusion: Gastro Acid where the game allows it). */
  abilityEnd: (ability: string, name: string) => `${ability} ending on ${name} is not modelled in 2v2.`,
  /** A1, SwSh: Transform into a Dynamaxed target. */
  transformMax: (name: string) => `Transform into a Dynamaxed ${name} is not modelled in 2v2.`,
  /** D (the settle, F1's rule): an Imposter holder whose slot across is empty. */
  imposterAcross: (name: string) => `${name}'s Imposter with no Pokémon across is not modelled in 2v2.`,
  /**
   * A2: Electrify or Ion Deluge on a move whose type is set as it is used, a Z-Move or a Max Move ("Electrify", "Ion
   * Deluge"); Synchronoise from a two-type user with an added type ("an added type"); Natural Gift with "Embargo" or
   * "Heal Block"; PR: "the rainbow", "the swamp", "a Pokémon that switched in this turn" (ADDENDUM2 §2.4).
   */
  combo: (move: string, what: string) => `${move} with ${what} is not modelled in 2v2.`,
  /** A2: Conversion with no move-slot order. */
  needsFirstMove: (name: string) => `Conversion needs ${name}'s first move.`,
  /** A2: Conversion 2 when the last move's type as used is not known (an own-type move, a Z-Move or Max Move last turn). */
  needsLastMoveType: (move: string, name: string) => `${move} needs the type of ${name}'s last move.`,
  /** A2: Attract or Captivate between species that can be either gender, with no gender set. */
  needsGender: (move: string, name: string) => `${move} needs ${name}'s gender.`,
  /** A3 Recycle (the moves), E Harvest (the end of turn): the item it used before this turn is not known. */
  needsLastItem: (move: string, name: string) => `${move} needs ${name}'s item from an earlier turn.`,
  /** A3, SV: a Protosynthesis or Quark Drive holder of Booster Energy whose field is down when Magic Room ends (FC takes it over in 1b). */
  boosterAfterRoom: "Booster Energy after Magic Room ends is not modelled in 2v2.",
  /** D: a flung Custap Berry with a later action of its target. */
  flungCustap: (name: string) => `Custap Berry flung at ${name} is not modelled in 2v2.`,
  // status2 ADDENDUM2 §2.4.
  /** N: a used Protean or Libero (abilityActive false) whose types the input does not give. */
  typeUnknown: (name: string, ability: string) => `${name}'s type after ${ability} is not known.`,
  /** N: a tie the entry order decides (a redirection at one Speed, Dancers at one stored Speed) with the order Unknown ("Follow Me", "Rage Powder", "Spotlight", "Lightning Rod", "Storm Drain", "Dancer"). */
  needsEntryOrder: (by: string, a: string, b: string) => `${by} needs whether ${a} or ${b} came in first.`,
  /** CL: Copycat before any action of the turn with battleLastMove absent. */
  needsLastMoveUsed: (move: string) => `${move} needs the last move used before this turn.`,
  /** CL: Instruct into a Pokémon whose last move is an earlier turn's single-target move with lastMoveTarget absent. */
  needsLastTarget: (move: string, name: string) => `${move} needs the target of ${name}'s last move.`,
  /** CL, wave 1 only: Assist (its party's moves come with R's bench). */
  needsParty: (move: string, name: string) => `${move} needs the moves of ${name}'s party.`,
  /** PR: a multi-hit contact move into a heating Beak Blast holder whose burn would land after the first hit. */
  intoBeakBlast: (move: string, name: string) => `${move} into ${name}'s Beak Blast is not modelled in 2v2.`,
  /** E2: a landing from a Pokémon not in battle with two holders of one partner boost on its side. */
  landingPartners: (move: string, ability: string) => `${move} landing with two ${ability} holders on its user's side is not modelled in 2v2.`,
  /** E2: a landing given as a bare move id (C33). */
  needsLandingUser: (move: string) => `${move} landing needs its user.`,
  /** E2: cudChew true (a Berry, not known which; C33). */
  needsCudChewBerry: (name: string) => `Cud Chew needs ${name}'s Berry from the last turn.`,
} as const;

// The status-move architect's classification of every status move in the four games' catalogs (status-census.out),
// printed as the design's markdown table. Fails when a catalog status move has no entry (so the table stays complete).
// Run from the repo root: npx --no-install tsx scripts/.cache/calc-audit/status-eot/design/status-classify.ts > .../status-classify.md
import fs from "node:fs";

/** M: modelled exactly. N: no effect on this turn (exact by doing nothing; what it leaves for later is listed). C: modelled
 * when its input or condition holds, otherwise guarded. G: guarded (the fact). X: unchanged existing handling. */
type Kind = "M" | "N" | "C" | "G" | "X";
type Row = [Kind, string];
const T: Record<string, Row> = {
  // ---- Sleep, paralysis, burn, poison (setStatus: runStatusImmunity, SetStatus event, curing Berry at the Update) ----
  darkvoid: ["M", "slp on both foes; only Darkrai (onTry), else fails"], grasswhistle: ["M", "slp (sound: Soundproof)"], hypnosis: ["M", "slp"],
  lovelykiss: ["M", "slp"], sing: ["M", "slp (sound)"], sleeppowder: ["M", "slp (powder)"], spore: ["M", "slp (powder)"],
  yawn: ["M", "yawn volatile: no sleep this turn (duration 2, order 23); fails on a statused or sleep-immune target (onTryHit); leaves `drowsy` for the next end of turn"],
  thunderwave: ["M", "par; ignoreImmunity false: Ground immune"], glare: ["M", "par (hits Ghost)"], stunspore: ["M", "par (powder)"],
  willowisp: ["M", "brn; Flash Fire / Well-Baked Body absorb it"],
  toxic: ["M", "tox (stage 0: 1/16 at this end of turn)"], poisonpowder: ["M", "psn (powder)"], poisongas: ["M", "psn on both foes"],
  toxicthread: ["M", "Spe -1 (-2 Champions) then psn"],
  // ---- Confusion and infatuation ----
  confuseray: ["M", "confusion (fresh: no snap-out this turn)"], supersonic: ["M", "confusion (sound)"], sweetkiss: ["M", "confusion"],
  teeterdance: ["M", "confusion on all adjacent, its ally too (Dancer stays guarded)"], swagger: ["M", "Atk +2 then confusion"], flatter: ["M", "Sp. Atk +1 then confusion"],
  attract: ["M", "infatuation (opposite genders; Oblivious, Aroma Veil; Destiny Knot back; Mental Herb)"],
  captivate: ["M", "Sp. Atk -2 on opposite-gender foes (Oblivious immune)"],
  // ---- Stat stages on targets (boost(): Clear Body family, Mirror Armor, Mist, Flower Veil, Contrary, Simple, Defiant, Competitive, White Herb) ----
  babydolleyes: ["M", "Atk -1 (priority +1)"], charm: ["M", "Atk -2"], eerieimpulse: ["M", "Sp. Atk -2"], faketears: ["M", "Sp. Def -2"],
  featherdance: ["M", "Atk -2 (dance: Dancer guarded)"], metalsound: ["M", "Sp. Def -2 (sound)"], scaryface: ["M", "Spe -2"], screech: ["M", "Def -2 (sound)"],
  cottonspore: ["M", "Spe -2 on both foes (powder)"], stringshot: ["M", "Spe -2 on both foes"], tickle: ["M", "Atk -1 Def -1"],
  growl: ["M", "Atk -1 on both foes (sound)"], leer: ["M", "Def -1 on both foes"], tailwhip: ["M", "Def -1 on both foes"],
  nobleroar: ["M", "Atk -1 Sp. Atk -1 (sound)"], playnice: ["M", "Atk -1 (no protect flag)"], tearfullook: ["M", "Atk -1 Sp. Atk -1 (no protect flag)"],
  confide: ["M", "Sp. Atk -1 (sound)"], venomdrench: ["M", "Atk/Sp. Atk/Spe -1 on poisoned foes only"], spicyextract: ["M", "target Atk +2 Def -2"],
  sweetscent: ["M", "evasion -2 (-1 gen 7) on both foes: no stage the calculation reads, but Defiant/Competitive, Lash Out, Clear Body, Mirror Armor, Eject Pack react"],
  sandattack: ["M", "accuracy -1 (no stage read; the reactions as Sweet Scent)"], smokescreen: ["M", "accuracy -1 (as Sand Attack)"],
  flash: ["M", "accuracy -1 (as Sand Attack)"], kinesis: ["M", "accuracy -1 (as Sand Attack)"],
  // ---- Stat stages on the user / allies ----
  acidarmor: ["M", "Def +2"], agility: ["M", "Spe +2 (re-sort from gen 8)"], amnesia: ["M", "Sp. Def +2"], barrier: ["M", "Def +2"],
  bulkup: ["M", "Atk +1 Def +1"], calmmind: ["M", "Sp. Atk +1 Sp. Def +1"], coil: ["M", "Atk +1 Def +1 (accuracy +1 not read)"],
  cosmicpower: ["M", "Def +1 Sp. Def +1"], cottonguard: ["M", "Def +3"], defendorder: ["M", "Def +1 Sp. Def +1"],
  doubleteam: ["M", "evasion +1: nothing read (every move hits)"], dragondance: ["M", "Atk +1 Spe +1 (dance)"],
  growth: ["M", "Atk +1 Sp. Atk +1, +2 each in sun (effectiveWeather, Utility Umbrella)"], harden: ["M", "Def +1"], honeclaws: ["M", "Atk +1"],
  howl: ["M", "Atk +1 to the user and its ally (gen 8+ target allies; Champions sound: a Soundproof ally is immune)"],
  irondefense: ["M", "Def +2"], meditate: ["M", "Atk +1"], nastyplot: ["M", "Sp. Atk +2"],
  noretreat: ["M", "+1 all five; fails while its volatile is up (pre-turn input)"], quiverdance: ["M", "Sp. Atk/Sp. Def/Spe +1 (dance)"],
  rockpolish: ["M", "Spe +2"], sharpen: ["M", "Atk +1"], shellsmash: ["M", "Def/Sp. Def -1, Atk/Sp. Atk/Spe +2 (White Herb)"], shelter: ["M", "Def +2"],
  shiftgear: ["M", "Spe +2 Atk +1"], swordsdance: ["M", "Atk +2 (dance)"], tailglow: ["M", "Sp. Atk +3"], victorydance: ["M", "Atk/Def/Spe +1 (dance)"],
  withdraw: ["M", "Def +1"], workup: ["M", "Atk +1 Sp. Atk +1"], takeheart: ["M", "Sp. Atk +1 Sp. Def +1 and cures its status"],
  tidyup: ["M", "Atk +1 Spe +1; removes every Substitute and the hazards"],
  autotomize: ["C", "Spe +2; its weight -100 kg changes Low Kick, Grass Knot, Heat Crash, Heavy Slam: guarded only when one of those later hits it or is its own (`Autotomize changes {Name}'s weight: later moves are not modelled.`)"],
  defensecurl: ["C", "Def +1; guarded only when its own later Rollout or Ice Ball follows (`Defense Curl is not modelled with Rollout.`)"],
  minimize: ["C", "evasion +2; guarded only when a later Stomp-family move hits it (minimize onSourceModifyDamage 2x: `Minimize doubles the damage {Name} takes: later moves are not modelled.`)"],
  stockpile: ["C", "Def +1 Sp. Def +1 and a layer; the layers before the turn are an input (default 0, a turn fact), fails at 3"],
  geomancy: ["M", "charge turn (no effect) unless Power Herb: Sp. Atk/Sp. Def/Spe +2"],
  charge: ["M", "Sp. Def +1 and charged (its next Electric move this turn doubles; MonState.charged)"],
  focusenergy: ["M", "crit stage +2 (build.settledFocusEnergy; same volatile as Lansat, no stack): only a certain crit (stage 4 from gen 7) changes damage"],
  dragoncheer: ["M", "ally crit stage +1 (+2 if Dragon): new build field `dragonCheer`; only a certain crit changes damage"],
  laserfocus: ["C", "next attack crits: guarded when its own later attack follows (`Laser Focus is not modelled.`), else no effect"],
  acupressure: ["M", "+2 to one random stat among the 7 below +6 (sample): one world per stat, 1/n each"],
  aromaticmist: ["M", "ally Sp. Def +1"], coaching: ["M", "ally Atk +1 Def +1"], decorate: ["M", "target Atk +2 Sp. Atk +2"],
  gearup: ["M", "Plus/Minus Pokémon on its side Atk +1 Sp. Atk +1"], magneticflux: ["M", "Plus/Minus Pokémon on its side Def +1 Sp. Def +1"],
  flowershield: ["M", "every Grass type Def +1"], rototiller: ["M", "every grounded Grass type Atk +1 Sp. Atk +1"],
  psychup: ["M", "copies the target's stages and Focus Energy / Dragon Cheer (Laser Focus copied: guarded as Laser Focus)"],
  haze: ["M", "every stage to 0"], topsyturvy: ["M", "target's stages inverted"], heartswap: ["M", "all stages swapped"],
  guardswap: ["M", "Def/Sp. Def stages swapped"], powerswap: ["M", "Atk/Sp. Atk stages swapped"],
  speedswap: ["G", "`Speed Swap is not modelled in 2v2.` (raw Speed, not a stage)"], powersplit: ["G", "`Power Split is not modelled in 2v2.` (raw stats)"],
  guardsplit: ["G", "`Guard Split is not modelled in 2v2.`"], powertrick: ["G", "`Power Trick is not modelled in 2v2.`"], powershift: ["G", "`Power Shift is not modelled in 2v2.`"],
  // ---- Order and positions ----
  afteryou: ["M", "target's action order 3 (next); fails if it has moved; gen 7: moved to the front of the frozen queue"],
  quash: ["M", "target's action order 201 (last); gen 7: priority -7.1 at the end (data/mods/gen7)"],
  allyswitch: ["M", "the two Pokémon swap positions (priority +2): chosen targets are positions; gen 9 fact `Assumes Ally Switch was not used last turn.`"],
  instruct: ["C", "target uses its last move again at once: modelled when it moved this turn (its action repeated, prioritizeAction); else needs `lastMove` (`Instruct needs {Name}'s move from the last turn.`)"],
  // ---- Protection-like and side ----
  endure: ["M", "survives every damaging hit this turn at 1 HP (turn-mode env in the hit loop); stall fact as Protect"],
  craftyshield: ["M", "side flag: blocks every status move into its side whose target type is not self or all, from any Pokémon (its ally's too, Q17); fails with no action after it (queue.willAct)"],
  matblock: ["M", "side flag: blocks damaging moves with the protect flag into its side (Z/Max at 1/4); first-turn fact"],
  magiccoat: ["M", "reflects reflectable status moves (single target: at the source; spread: the source's side)"],
  safeguard: ["M", "side flag: status and confusion from other Pokémon blocked (Infiltrator foes pass); Yawn blocked"],
  mist: ["M", "side flag: drops from other Pokémon blocked (Infiltrator foes pass)"],
  luckychant: ["M", "side flag: no crits into it (matters with the Critical hit toggle)"],
  spotlight: ["M", "centre of attention on its target (redirection exists); reflected by Magic Coat/Bounce"],
  // ---- Volatiles that block later actions ----
  taunt: ["M", "later status move (not a Z-Move) fails at BeforeMove (priority 5); Oblivious, Aroma Veil, Mental Herb"],
  torment: ["N", "no BeforeMove handler: changes only the next choice"],
  disable: ["C", "target moved this turn: no effect; else needs `lastMove` (`Disable needs {Name}'s move from the last turn.`); its queued move = lastMove fails"],
  encore: ["C", "target moved this turn: no effect; else needs `lastMove`; the action becomes lastMove at a random valid target (Champions recomputes priority, data/mods/champions/moves.ts)"],
  imprison: ["C", "a foe's later move the user knows fails (onFoeBeforeMove): needs the user's moves (`moves` input; complete); else `Imprison needs {Name}'s moves.`"],
  healblock: ["C", "heal moves fail at BeforeMove; heals blocked at the end of turn; guarded while a heal the pair engine reads can happen in a later step (`Heal Block on {Name} is not modelled with a later heal.`)"],
  embargo: ["C", "items off for its target: guarded when an item of the target acts later (incl. end of turn) (`Embargo is not modelled.`), else no effect"],
  powder: ["G", "`Powder is not modelled in 2v2.` (USUM)"], electrify: ["C", "guarded when the target still moves (`Electrify changes {Move}'s type: not modelled.`)"],
  iondeluge: ["C", "guarded when a later Normal move follows (`Ion Deluge is not modelled.`)"],
  nightmare: ["M", "volatile on a sleeping target: 1/4 at the end of turn (order 11)"],
  leechseed: ["M", "seeded (Grass immune, Substitute blocks): drains at THIS end of turn (order 8; Liquid Ooze, Big Root)"],
  aquaring: ["M", "1/16 heal at the end of turn (order 6, Big Root)"],
  ingrain: ["C", "1/16 heal at the end of turn (order 7); grounds its user: guarded when a later Ground move could hit an ungrounded user"],
  magnetrise: ["C", "guarded when a later Ground move could hit it (`Magnet Rise is not modelled.`), else no effect"],
  telekinesis: ["C", "as Magnet Rise (USUM)"],
  foresight: ["C", "guarded when a later Normal/Fighting move hits a Ghost target (USUM)"], odorsleuth: ["C", "as Foresight"],
  miracleeye: ["C", "guarded when a later Psychic move hits a Dark target (USUM)"],
  tarshot: ["C", "Spe -1; guarded when a later Fire move hits it (`Tar Shot doubles Fire damage on {Name}: later moves are not modelled.`)"],
  octolock: ["M", "trap (no switch this turn) and Def/Sp. Def -1 at the end of turn (order 14)"],
  meanlook: ["N", "trap only"], block: ["N", "trap only"], spiderweb: ["N", "trap only (USUM)"], fairylock: ["N", "trap only"],
  perishsong: ["M", "count 3 on every Pokémon hearing it (Soundproof immune) at this end of turn; no HP"],
  grudge: ["N", "PP only"], spite: ["N", "PP only"], lockon: ["N", "every move hits"], mindreader: ["N", "every move hits"],
  snatch: ["G", "`Snatch is not modelled in 2v2.` (presence, USUM)"], mimic: ["N", "moveset only"], sketch: ["N", "moveset only"],
  // ---- Items ----
  trick: ["M", "items swapped (Sticky Hold, unremovable items fail); Berries due at the Update; Unburden; guarded for items acting on receipt"],
  switcheroo: ["M", "as Trick"], bestow: ["M", "gives its item to an itemless target (USUM)"],
  recycle: ["C", "an item used earlier this turn comes back: modelled; one used before the turn: `Recycle needs the item {Name} used before.`"],
  stuffcheeks: ["M", "eats its Berry at any HP (HP, pinch, curing Berries) then Def +2; other Berries guarded"],
  teatime: ["M", "every Pokémon eats its Berry at any HP; other Berries guarded"],
  corrosivegas: ["G", "`Corrosive Gas is not modelled in 2v2.`"],
  // ---- Abilities ----
  skillswap: ["M", "abilities swapped; old End and new Start run (setAbility): guarded when an ability with an acting Start is involved"],
  roleplay: ["M", "copies the target's ability (Start runs)"], entrainment: ["M", "gives its ability to the target (Start runs)"],
  simplebeam: ["M", "target becomes Simple"], worryseed: ["M", "target becomes Insomnia, its sleep cured"], gastroacid: ["M", "target's ability suppressed (stand-in ability)"],
  doodle: ["M", "user and ally copy the target's ability (SV)"],
  // ---- Types ----
  soak: ["G", "`Soak changes {Name}'s type: not modelled.`"], magicpowder: ["G", "as Soak"], forestscurse: ["G", "as Soak"], trickortreat: ["G", "as Soak"],
  reflecttype: ["G", "as Soak"], conversion: ["G", "as Soak"], conversion2: ["G", "as Soak"], camouflage: ["G", "as Soak"],
  transform: ["G", "`Transform is not modelled in 2v2.`"],
  // ---- Field ----
  magicroom: ["M", "Magic Room toggles (a second use ends it)"], wonderroom: ["M", "Wonder Room toggles"],
  mudsport: ["C", "guarded when a later Electric move follows (USUM)"], watersport: ["C", "guarded when a later Fire move follows (USUM)"],
  courtchange: ["M", "swaps the two sides' screens, Tailwind, Safeguard, Mist, Lucky Chant (and hazards)"],
  defog: ["M", "target's side screens/Safeguard/Mist and both sides' hazards cleared, the terrain ended (gen 8+); evasion -1 on the target"],
  // ---- HP ----
  recover: ["M", "heal round(1/2)"], slackoff: ["M", "heal round(1/2)"], softboiled: ["M", "heal round(1/2)"], healorder: ["M", "heal round(1/2)"],
  milkdrink: ["M", "heal round(1/2) (Champions: itself or its ally)"],
  roost: ["C", "heal round(1/2); loses Flying for the turn: guarded when a later damaging move hits it (`Roost removes {Name}'s Flying type: later moves are not modelled.`)"],
  moonlight: ["M", "modify(maxhp, 0.5 / 0.667 sun / 0.25 rain-sand-hail-snow), effectiveWeather"], morningsun: ["M", "as Moonlight"], synthesis: ["M", "as Moonlight"],
  shoreup: ["M", "modify(maxhp, 0.5 / 0.667 sand)"], lifedew: ["M", "user and ally heal round(1/4)"],
  junglehealing: ["M", "user and ally heal modify(maxhp, 0.25) and cure"], lunarblessing: ["M", "user and ally heal modify(maxhp, 0.25) and cure"],
  healpulse: ["M", "target heal ceil(1/2) (Mega Launcher modify 0.75)"], floralhealing: ["M", "target heal ceil(1/2) (Grassy modify 0.667)"],
  purify: ["M", "cures the target's status, user heals round(1/2) (USUM/SwSh)"],
  strengthsap: ["M", "user heals the target's Attack (stages, no modifiers; Big Root, Liquid Ooze), target Atk -1"],
  painsplit: ["M", "both set to floor((a + b) / 2) (undynamaxed HP)"],
  rest: ["M", "full HP, sleep with counter 3 (cannot wake this turn), status cured; fails at full HP or sleep-immune"],
  bellydrum: ["M", "loses floor(maxhp/2), Atk to +6; fails at <= 1/2 HP or +6"],
  filletaway: ["M", "loses floor(maxhp/2), Atk/Sp. Atk/Spe +2 (SV)"], clangoroussoul: ["M", "loses floor(maxhp/3), +1 all five"],
  curse: ["M", "Ghost: loses floor(maxhp/2), target cursed (1/4 at the end of turn, order 12); other: Atk +1 Def +1 Spe -1"],
  substitute: ["M", "loses floor(maxhp/4), Substitute with floor(maxhp/4) HP; later status moves fail; later hits into it guarded (`Hits on {Name}'s Substitute are not modelled.`) unless sound/Infiltrator"],
  memento: ["M", "target Atk -2 Sp. Atk -2, the user faints at once (no replacement until the turn ends)"],
  healingwish: ["M", "user faints; heals its replacement (fact only)"], lunardance: ["M", "as Healing Wish"],
  wish: ["M", "no HP this turn; heals its slot at the next end of turn (E2 carries it)"],
  revivalblessing: ["G", "`Revival Blessing is not modelled in 2v2.`"],
  swallow: ["C", "needs the Stockpile layers (input): heal 1/4, 1/2, full; else `Swallow needs Stockpile from earlier turns.`"],
  shedtail: ["G", "switch: `{Name} switches out: the replacement is not known.` (the end of turn only when no action follows)"],
  aromatherapy: ["M", "cures the user's and its team's statuses except a Sap Sipper, Good as Gold or (without Infiltrator) Substitute Pokémon other than the user; the bench's in the E2 outcome"],
  healbell: ["M", "cures the user's and ally's statuses (Soundproof / Good as Gold ally excepted); the bench's in the E2 outcome"],
  refresh: ["M", "cures its own psn/par/brn (USUM)"], psychoshift: ["M", "moves its status to the target, then cured (USUM/SwSh)"],
  // ---- Switching (replacement unknown) ----
  batonpass: ["G", "switch (as Shed Tail)"], partingshot: ["M", "drops (Atk -1 Sp. Atk -1) modelled; then the switch as Shed Tail"],
  teleport: ["G", "switch (as Shed Tail)"], chillyreception: ["M", "snow modelled; then the switch as Shed Tail"],
  roar: ["G", "drags the target out (as Shed Tail): Suction Cups, Guard Dog, Ingrain, Dynamax stop it"], whirlwind: ["G", "as Roar (wind: Wind Rider absorbs)"],
  // ---- Calling moves ----
  assist: ["X", "`{Move} is not modelled in 2v2.`"], copycat: ["X", "as Assist"], mefirst: ["X", "as Assist"], metronome: ["X", "as Assist"],
  mirrormove: ["X", "as Assist"], naturepower: ["X", "as Assist"], sleeptalk: ["X", "as Assist (asleep or Comatose; fails otherwise)"],
  // ---- Already modelled / no effect ----
  auroraveil: ["X", "modelled"], banefulbunker: ["X", "modelled"], burningbulwark: ["X", "modelled"], detect: ["X", "modelled"], kingsshield: ["X", "modelled"],
  obstruct: ["X", "modelled"], protect: ["X", "modelled"], silktrap: ["X", "modelled"], spikyshield: ["X", "modelled"], quickguard: ["X", "modelled; now also stops priority status moves"],
  wideguard: ["X", "modelled; now also stops spread status moves"], helpinghand: ["X", "modelled"], followme: ["X", "modelled; now also redirects single-target status moves"],
  ragepowder: ["X", "modelled; as Follow Me (not on powder-immune users)"], electricterrain: ["X", "modelled; now also blocks sleep (grounded)"],
  grassyterrain: ["X", "modelled; end of turn heal"], mistyterrain: ["X", "modelled; now also blocks status and confusion (grounded)"],
  psychicterrain: ["X", "modelled; now also stops priority status moves into grounded foes"], gravity: ["X", "modelled"], trickroom: ["X", "modelled"],
  tailwind: ["X", "modelled"], reflect: ["X", "modelled"], lightscreen: ["X", "modelled"], sunnyday: ["X", "modelled"], raindance: ["X", "modelled"],
  sandstorm: ["X", "modelled"], snowscape: ["X", "modelled"], hail: ["X", "modelled"],
  destinybond: ["M", "the foe whose move knocks the user out faints too (onFaint; Dynamax immune): replaces today's guard"],
  celebrate: ["N", "nothing"], splash: ["N", "nothing"], holdhands: ["N", "nothing"], happyhour: ["N", "nothing"],
  spikes: ["N", "hazard (E2 reports where it lands: Magic Bounce reflects it)"], stealthrock: ["N", "as Spikes"], stickyweb: ["N", "as Spikes"], toxicspikes: ["N", "as Spikes"],
  maxguard: ["X", "`Max Guard is not modelled.`"], extremeevoboost: ["X", "Z-Move: no learner"],
};

const lines = fs.readFileSync("scripts/.cache/calc-audit/status-eot/design/status-census.out", "utf8").split(/\r?\n/).slice(1).filter(Boolean);
const missing: string[] = [];
const counts: Record<Kind, number> = { M: 0, N: 0, C: 0, G: 0, X: 0 };
const out: string[] = ["| Move | Games (learners) | Today | Design | Effect this turn / guard fact |", "|---|---|---|---|---|"];
for (const line of lines) {
  const [today, id, ...rest] = line.trim().split(/\s+/);
  const games = rest.filter((part) => /^(champions|sv|swsh|usum):\d+$/.test(part)).join(" ");
  const row = T[id];
  if (!row) { missing.push(id); continue; }
  counts[row[0]]++;
  out.push(`| ${id} | ${games} | ${today} | ${row[0]} | ${row[1].replace(/\|/g, "/")} |`);
}
const extra = Object.keys(T).filter((id) => !lines.some((line) => line.trim().split(/\s+/)[1] === id));
console.log(`Classified ${lines.length - missing.length}/${lines.length}: ${JSON.stringify(counts)}${missing.length ? `; MISSING ${missing.join(",")}` : ""}${extra.length ? `; not in any catalog: ${extra.join(",")}` : ""}\n`);
console.log(out.join("\n"));
if (missing.length) process.exitCode = 1;

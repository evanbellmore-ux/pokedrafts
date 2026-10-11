// The build spec's final classification of every Status move in the four games' catalogs (status-census.out), after the
// critic's scope cut (SPEC.md §2). Prints the SPEC appendix table and fails when a catalog status move has no entry.
// Run from the repo root:
//   npx --no-install tsx scripts/.cache/calc-audit/status-eot/design/spec-classify.ts > scripts/.cache/calc-audit/status-eot/design/spec-classify.md
import fs from "node:fs";

/**
 * M: modelled exactly. N: no effect on this turn's HP or order (exact by doing nothing; what it leaves is in the E2 outcome
 * or the end of turn). C: modelled when the stated condition holds, otherwise the stated guard. L: not modelled in this
 * build: with a later living action the turn is not estimated ("{Move} is not modelled and comes before another move."),
 * with none only the end of turn is not estimated ("{Move} is not modelled."). S: switches a Pokémon out: with a later living
 * action the turn is not estimated, with none only the end of turn ("{Name} switches out: the replacement is not known."); a
 * switch that fails is modelled. P: presence guard, the turn is never estimated (existing texts). X: unchanged handling.
 */
type Kind = "M" | "N" | "C" | "L" | "S" | "P" | "X";
type Row = [Kind, string];
const T: Record<string, Row> = {
  // ---- Major status (canStatus / setStatus; curing Berry at the action's Update; Synchronize) ----
  darkvoid: ["M", "slp on both foes; fails unless the user is Darkrai (onTry)"], grasswhistle: ["M", "slp (sound)"], hypnosis: ["M", "slp"],
  lovelykiss: ["M", "slp"], sing: ["M", "slp (sound)"], sleeppowder: ["M", "slp (powder)"], spore: ["M", "slp (powder)"],
  yawn: ["M", "drowsy (EotState.yawn = 2): no sleep at this end of turn; fails on a statused or sleep-immune target (onTryHit); E2 volatile `yawn`"],
  thunderwave: ["M", "par; ignoreImmunity false: Ground is immune"], glare: ["M", "par (hits Ghost)"], stunspore: ["M", "par (powder)"],
  willowisp: ["M", "brn; Flash Fire and Well-Baked Body absorb it in TryHit"],
  toxic: ["M", "tox, stage 0 (1/16 at this end of turn); a Poison-type user cannot miss (no effect: every move hits)"],
  poisonpowder: ["M", "psn (powder)"], poisongas: ["M", "psn on both foes"],
  toxicthread: ["M", "Spe -1 (Champions -2), then psn"],
  // ---- Confusion ----
  confuseray: ["M", "confusion (fresh: cannot end at its first BeforeMove)"], supersonic: ["M", "confusion (sound)"], sweetkiss: ["M", "confusion"],
  teeterdance: ["M", "confusion on every adjacent Pokémon, its ally included"], swagger: ["M", "Atk +2, then confusion"], flatter: ["M", "Sp. Atk +1, then confusion"],
  attract: ["L", "infatuation: not in this build"], captivate: ["L", "gender-dependent drop: not in this build"],
  // ---- Stages on foes or the target (applyBoosts) ----
  babydolleyes: ["M", "Atk -1"], charm: ["M", "Atk -2"], eerieimpulse: ["M", "Sp. Atk -2"], faketears: ["M", "Sp. Def -2"],
  featherdance: ["M", "Atk -2"], metalsound: ["M", "Sp. Def -2 (sound)"], scaryface: ["M", "Spe -2"], screech: ["M", "Def -2 (sound)"],
  cottonspore: ["M", "Spe -2 on both foes (powder)"], stringshot: ["M", "Spe -2 on both foes"], tickle: ["M", "Atk -1 Def -1"],
  growl: ["M", "Atk -1 on both foes (sound)"], leer: ["M", "Def -1 on both foes"], tailwhip: ["M", "Def -1 on both foes"],
  nobleroar: ["M", "Atk -1 Sp. Atk -1 (sound)"], playnice: ["M", "Atk -1 (no protect flag)"], tearfullook: ["M", "Atk -1 Sp. Atk -1 (no protect flag)"],
  confide: ["M", "Sp. Atk -1 (sound)"], venomdrench: ["M", "Atk/Sp. Atk/Spe -1, only on poisoned targets (onHit)"], spicyextract: ["M", "Atk +2 Def -2 on the target"],
  sweetscent: ["M", "evasion -2 (gen 7 -1) on both foes: not stored; Defiant, Competitive, Mirror Armor, Clear Body and Eject Pack react"],
  sandattack: ["M", "accuracy -1: not stored; the reactions as Sweet Scent"], smokescreen: ["M", "as Sand Attack"],
  flash: ["M", "as Sand Attack"], kinesis: ["M", "as Sand Attack"],
  // ---- Stages on the user or its ally ----
  acidarmor: ["M", "Def +2"], agility: ["M", "Spe +2 (re-sort from gen 8)"], amnesia: ["M", "Sp. Def +2"], barrier: ["M", "Def +2"],
  bulkup: ["M", "Atk +1 Def +1"], calmmind: ["M", "Sp. Atk +1 Sp. Def +1"], coil: ["M", "Atk +1 Def +1 (accuracy +1 not stored)"],
  cosmicpower: ["M", "Def +1 Sp. Def +1"], cottonguard: ["M", "Def +3"], defendorder: ["M", "Def +1 Sp. Def +1"],
  doubleteam: ["M", "evasion +1: not stored"], dragondance: ["M", "Atk +1 Spe +1"],
  growth: ["M", "Atk +1 Sp. Atk +1; +2 each in sun or Harsh Sunshine (effectiveWeather: Utility Umbrella, Cloud Nine)"], harden: ["M", "Def +1"], honeclaws: ["M", "Atk +1 (accuracy not stored)"],
  howl: ["M", "Atk +1 on the user and its ally (target allies from gen 8); sound: a Soundproof ally is immune"],
  irondefense: ["M", "Def +2"], meditate: ["M", "Atk +1"], nastyplot: ["M", "Sp. Atk +2"],
  noretreat: ["L", "fails while its volatile is up from an earlier turn: not in this build"], quiverdance: ["M", "Sp. Atk/Sp. Def/Spe +1"],
  rockpolish: ["M", "Spe +2"], sharpen: ["M", "Atk +1"], shellsmash: ["M", "Def/Sp. Def -1, Atk/Sp. Atk/Spe +2 (White Herb after the move)"], shelter: ["M", "Def +2"],
  shiftgear: ["M", "Spe +2 Atk +1"], swordsdance: ["M", "Atk +2"], tailglow: ["M", "Sp. Atk +3"], victorydance: ["M", "Atk/Def/Spe +1"],
  withdraw: ["M", "Def +1"], workup: ["M", "Atk +1 Sp. Atk +1"], takeheart: ["M", "Sp. Atk +1 Sp. Def +1, then cures the user's status"],
  defensecurl: ["M", "Def +1 (Rollout is its own later turn's)"],
  tidyup: ["L", "removes Substitutes and hazards: not in this build"], autotomize: ["L", "weight change: not in this build"],
  minimize: ["L", "Stomp-family double damage: not in this build"], stockpile: ["L", "layers from earlier turns: not in this build"],
  geomancy: ["L", "charge turn / Power Herb: not in this build"],
  charge: ["M", "Sp. Def +1 and charged (MonState.charged: its next Electric attack, a later turn's, doubles)"],
  focusenergy: ["M", "no effect on this turn's damage (its own action); build.settledFocusEnergy in the E2 outcome; fails if already up"],
  dragoncheer: ["M", "ally crit stage +1, +2 for a Dragon-type ally (new build.dragonCheer read by certainCrit); Champions: sound"],
  laserfocus: ["N", "its next attack is a later turn's (Instruct and Dancer stay guarded)"],
  acupressure: ["L", "random stat: not in this build"], aromaticmist: ["M", "ally Sp. Def +1"], coaching: ["M", "ally Atk +1 Def +1 (adjacentAlly)"], decorate: ["M", "target Atk +2 Sp. Atk +2"],
  gearup: ["L", "Plus/Minus side boost: not in this build"], magneticflux: ["L", "as Gear Up"],
  flowershield: ["L", "every Grass type: not in this build"], rototiller: ["L", "every grounded Grass type: not in this build"],
  psychup: ["L", "copies stages and crit volatiles: not in this build"], haze: ["M", "every Pokémon's stages to 0"], topsyturvy: ["L", "not in this build"], heartswap: ["L", "not in this build"],
  guardswap: ["L", "not in this build"], powerswap: ["L", "not in this build"],
  speedswap: ["L", "raw Speed swap"], powersplit: ["L", "raw stat average"], guardsplit: ["L", "raw stat average"], powertrick: ["L", "raw stat swap"], powershift: ["L", "raw stat swap"],
  // ---- Order and positions ----
  afteryou: ["M", "the target's queued action gets order 3 and moves next (gen 7: next in the frozen queue); fails if it has no action left"],
  quash: ["M", "the target's queued action gets order 201 and moves last; fails if it has no action left"],
  allyswitch: ["L", "positions: not in this build"],
  instruct: ["X", "`Instruct is not modelled in 2v2.` (presence, as today)"],
  // ---- Protection-like and side ----
  endure: ["M", "every damaging hit and the confusion self-hit that would knock it out leave 1 HP (onDamage -10, before Sturdy and Focus Sash); fails with no action after it; stall fact as Protect"],
  craftyshield: ["L", "not in this build (SwSh, USUM)"], matblock: ["L", "not in this build (SwSh, USUM)"], magiccoat: ["L", "not in this build (SwSh, USUM)"],
  safeguard: ["M", "side flag: status, confusion and Yawn from other Pokémon blocked (an Infiltrator foe passes); fails while up"],
  mist: ["L", "not in this build"], luckychant: ["L", "not in this build (USUM)"],
  spotlight: ["X", "`Spotlight is not modelled in 2v2.` (presence, as today)"],
  // ---- Volatiles that act in the moves ----
  taunt: ["M", "a later status move (not Z/Max, not Me First) fails at BeforeMove (priority 5); Oblivious, Aroma Veil, Mental Herb"],
  torment: ["N", "no BeforeMove handler: it changes only the next choice"],
  disable: ["C", "target already acted: no effect this turn. Target still to act: needs `lastMove` (`Disable needs {Name}'s move from the last turn.`); with it, a queued move equal to it fails at BeforeMove (priority 7; Champions: not a cantusetwice move); null lastMove: fails"],
  encore: ["C", "target already acted: no effect this turn. Target still to act: needs `lastMove`; with it, a queued move equal to it is unchanged (modelled), another one `Encore changes {Name}'s move: not modelled.`; null lastMove: fails"],
  imprison: ["C", "a foe's later move the user also has fails at BeforeMove (priority 4); needs the user's `moves` (`Imprison needs {Name}'s moves.`)"],
  healblock: ["L", "not in this build (USUM)"], embargo: ["L", "not in this build (USUM)"],
  powder: ["L", "not in this build (USUM)"], electrify: ["L", "not in this build"], iondeluge: ["L", "not in this build (USUM)"],
  nightmare: ["L", "not in this build (USUM)"],
  leechseed: ["M", "seeded (Grass immune; fails into a Substitute): drains at THIS end of turn (order 8; Liquid Ooze, Big Root)"],
  aquaring: ["M", "1/16 heal at this end of turn (order 6; Big Root)"],
  ingrain: ["C", "1/16 heal at this end of turn (order 7; Big Root); grounds the user: guarded (`Ingrain grounds {Name}: later moves are not modelled.`) when the user was ungrounded and a later Ground move could reach it"],
  magnetrise: ["C", "ungrounds the user: guarded (`Magnet Rise lifts {Name}: later moves are not modelled.`) when a later Ground move could reach it; the end of turn reads it (no Grassy heal)"],
  telekinesis: ["L", "not in this build (USUM)"],
  foresight: ["L", "not in this build (USUM)"], odorsleuth: ["L", "not in this build (USUM)"], miracleeye: ["L", "not in this build (USUM)"],
  tarshot: ["L", "Fire weakness: not in this build"], octolock: ["L", "not in this build"],
  meanlook: ["N", "trap only"], block: ["N", "trap only"], spiderweb: ["N", "trap only (USUM)"], fairylock: ["N", "trap only"],
  perishsong: ["M", "perish count on every Pokémon that hears it (Soundproof immune): 3 after this end of turn, no HP"],
  grudge: ["N", "PP only"], spite: ["N", "PP only"], lockon: ["N", "every move hits"], mindreader: ["N", "every move hits"],
  snatch: ["L", "not in this build (USUM)"], mimic: ["N", "moveset only"], sketch: ["N", "moveset only"],
  // ---- Items ----
  trick: ["L", "item swap: not in this build"], switcheroo: ["L", "as Trick"], bestow: ["L", "as Trick (USUM)"],
  recycle: ["L", "not in this build"], stuffcheeks: ["L", "not in this build"], teatime: ["L", "not in this build"], corrosivegas: ["L", "not in this build"],
  // ---- Abilities ----
  skillswap: ["L", "ability change: not in this build"], roleplay: ["L", "as Skill Swap"], entrainment: ["L", "as Skill Swap"],
  simplebeam: ["L", "as Skill Swap"], worryseed: ["L", "as Skill Swap"], gastroacid: ["L", "as Skill Swap"], doodle: ["L", "as Skill Swap"],
  // ---- Types ----
  soak: ["L", "type change"], magicpowder: ["L", "type change"], forestscurse: ["L", "type change"], trickortreat: ["L", "type change"],
  reflecttype: ["L", "type change"], conversion: ["L", "type change"], conversion2: ["L", "type change"], camouflage: ["L", "type change"],
  transform: ["L", "not in this build"],
  // ---- Field ----
  magicroom: ["L", "not in this build"], wonderroom: ["L", "not in this build"],
  mudsport: ["L", "not in this build (USUM)"], watersport: ["L", "not in this build (USUM)"],
  courtchange: ["L", "not in this build"], defog: ["L", "not in this build"],
  // ---- HP ----
  recover: ["M", "heals round(baseMaxhp/2)"], slackoff: ["M", "as Recover"], softboiled: ["M", "as Recover"], healorder: ["M", "as Recover"],
  milkdrink: ["M", "as Recover (Champions: target adjacentAllyOrSelf)"],
  roost: ["C", "heals round(baseMaxhp/2); loses Flying until the turn ends: guarded (`Roost removes {Name}'s Flying type: later moves are not modelled.`) when a later damaging move could reach a Flying user; the end of turn reads it (grounded)"],
  moonlight: ["M", "modify(maxhp, 0.5; 0.667 sun; 0.25 rain, sand, hail, snow) by effectiveWeather(Umbrella)"], morningsun: ["M", "as Moonlight"], synthesis: ["M", "as Moonlight"],
  shoreup: ["M", "modify(maxhp, 0.667 in sand, else 0.5)"], lifedew: ["M", "user and ally heal round(baseMaxhp/4)"],
  junglehealing: ["M", "user and ally heal modify(maxhp, 0.25), each cured of its status"], lunarblessing: ["M", "as Jungle Healing"],
  healpulse: ["M", "target heals ceil(baseMaxhp/2) (Mega Launcher modify(baseMaxhp, 0.75))"], floralhealing: ["M", "target heals ceil(baseMaxhp/2) (Grassy Terrain modify(baseMaxhp, 0.667))"],
  purify: ["L", "not in this build"],
  strengthsap: ["M", "target Atk -1 (fails at -6), user heals the target's Atk with stages, no modifiers (getStat atk, boosted, unmodified; Big Root; Liquid Ooze damages instead)"],
  painsplit: ["M", "both to floor((a + b) / 2), at least 1 (joint HP map); a Dynamaxed Pokémon: `Pain Split with a Dynamaxed Pokémon is not modelled in 2v2.`"],
  rest: ["M", "full HP and asleep with 3 turns (cannot wake this turn), status cured; fails at full HP, when asleep or sleep-immune"],
  bellydrum: ["M", "loses floor(maxhp/2), Atk to +6 (Contrary: -6); fails at <= half HP or at +6"],
  filletaway: ["M", "loses floor(maxhp/2), Atk/Sp. Atk/Spe +2 (SV)"], clangoroussoul: ["M", "loses floor(maxhp*33/100), +1 to all five; fails at hp <= maxhp*33/100"],
  curse: ["M", "Ghost user: loses floor(maxhp/2) (directDamage: it can faint), its chosen foe cursed (aimed at its ally: a random foe; 1/4 at this end of turn, order 12); other users: Atk +1 Def +1 Spe -1"],
  substitute: ["M", "loses floor(maxhp/4), Substitute up: later status moves without bypasssub fail into it; a later damaging hit into it: `Hits on {Name}'s Substitute are not modelled.`"],
  memento: ["M", "target Atk -2 Sp. Atk -2; the user faints when it hits (no replacement until the turn ends)"],
  healingwish: ["M", "the user faints (its replacement's heal is the next turn's); fails with no Pokémon to switch in"], lunardance: ["M", "as Healing Wish"],
  wish: ["M", "no HP this turn; E2 outcome `wish` on the slot (heals at the next end of turn)"],
  revivalblessing: ["P", "`Revival Blessing is not modelled.` (presence, as today)"],
  swallow: ["L", "needs Stockpile layers: not in this build"],
  aromatherapy: ["L", "party cure: not in this build"], healbell: ["L", "party cure: not in this build"],
  refresh: ["M", "cures the user's psn, tox, par or brn (USUM)"], psychoshift: ["L", "not in this build"],
  // ---- Switching ----
  batonpass: ["S", "switch"], partingshot: ["S", "Atk -1 Sp. Atk -1 first; no switch when no stage fell (onHit deletes selfSwitch; Mirror Armor keeps it)"],
  teleport: ["S", "switch (fails with no Pokémon to switch in)"], chillyreception: ["S", "snow (fieldMove), then the switch"],
  shedtail: ["S", "loses ceil(maxhp/2), then the switch; fails at <= ceil(maxhp/2) HP or with no Pokémon to switch in"],
  roar: ["S", "drags the target out: fails on Suction Cups, Guard Dog, Ingrain, Dynamax, or with no Pokémon to come in"], whirlwind: ["S", "as Roar (wind: Wind Rider absorbs it)"],
  // ---- Calling moves ----
  assist: ["X", "`{Move} is not modelled in 2v2.`"], copycat: ["X", "as Assist"], mefirst: ["X", "as Assist"], metronome: ["X", "as Assist"],
  mirrormove: ["X", "as Assist"], naturepower: ["X", "as Assist"], sleeptalk: ["X", "as Assist while asleep or Comatose (fails awake)"],
  // ---- Already modelled ----
  auroraveil: ["X", "modelled"], banefulbunker: ["X", "modelled"], burningbulwark: ["X", "modelled"], detect: ["X", "modelled"], kingsshield: ["X", "modelled"],
  obstruct: ["X", "modelled"], protect: ["X", "modelled"], silktrap: ["X", "modelled"], spikyshield: ["X", "modelled"],
  quickguard: ["X", "modelled; now also blocks priority status moves"], wideguard: ["X", "modelled; now also blocks spread status moves"],
  helpinghand: ["X", "modelled"], followme: ["X", "modelled; now also takes single-target status moves"],
  ragepowder: ["X", "modelled; as Follow Me (not from powder-immune users)"], electricterrain: ["X", "modelled; now also blocks sleep and Yawn on grounded Pokémon"],
  grassyterrain: ["X", "modelled; heals at the end of turn"], mistyterrain: ["X", "modelled; now also blocks status, confusion and Yawn on grounded Pokémon"],
  psychicterrain: ["X", "modelled; now also blocks priority status moves from foes into grounded Pokémon"], gravity: ["X", "modelled"], trickroom: ["X", "modelled"],
  tailwind: ["X", "modelled"], reflect: ["X", "modelled"], lightscreen: ["X", "modelled"], sunnyday: ["X", "modelled"], raindance: ["X", "modelled"],
  sandstorm: ["X", "modelled; damages at the end of turn"], snowscape: ["X", "modelled"], hail: ["X", "modelled; damages at the end of turn"],
  destinybond: ["M", "a foe whose move knocks the user out faints too (onFaint; not a Dynamaxed foe); replaces today's guard; fact `Assumes {Name} did not use Destiny Bond last turn.`"],
  celebrate: ["N", "nothing"], splash: ["N", "nothing"], holdhands: ["N", "nothing"], happyhour: ["N", "nothing"],
  spikes: ["N", "hazard; E2 `sides[side].hazards` where it lands (Magic Bounce sends it back)"], stealthrock: ["N", "as Spikes"], stickyweb: ["N", "as Spikes"], toxicspikes: ["N", "as Spikes"],
  maxguard: ["X", "`Max Guard is not modelled.`"], extremeevoboost: ["X", "Z-Move with no learner"],
};

const lines = fs.readFileSync("scripts/.cache/calc-audit/status-eot/design/status-census.out", "utf8").split(/\r?\n/).slice(1).filter(Boolean);
const missing: string[] = [];
const counts: Record<Kind, number> = { M: 0, N: 0, C: 0, L: 0, S: 0, P: 0, X: 0 };
const out: string[] = ["| Move | Games (learners) | Today | Build | This turn / guard |", "|---|---|---|---|---|"];
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

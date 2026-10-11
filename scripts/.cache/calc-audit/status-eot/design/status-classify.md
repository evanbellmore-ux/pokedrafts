Classified 271/271: {"M":167,"N":19,"C":25,"G":23,"X":37}

| Move | Games (learners) | Today | Design | Effect this turn / guard fact |
|---|---|---|---|---|
| acidarmor | champions:20 sv:43 swsh:38 usum:35 | before-guard | M | Def +2 |
| acupressure | champions:8 sv:20 swsh:19 usum:17 | before-guard | M | +2 to one random stat among the 7 below +6 (sample): one world per stat, 1/n each |
| afteryou | champions:18 sv:32 swsh:84 usum:121 | before-guard | M | target's action order 3 (next); fails if it has moved; gen 7: moved to the front of the frozen queue |
| agility | champions:105 sv:281 swsh:185 usum:182 | before-guard | M | Spe +2 (re-sort from gen 8) |
| allyswitch | champions:31 sv:32 swsh:164 usum:190 | before-guard | M | the two Pokémon swap positions (priority +2): chosen targets are positions; gen 9 fact `Assumes Ally Switch was not used last turn.` |
| amnesia | champions:46 sv:117 swsh:123 usum:127 | before-guard | M | Sp. Def +2 |
| aquaring | champions:13 sv:47 swsh:47 usum:63 | before-guard | M | 1/16 heal at the end of turn (order 6, Big Root) |
| aromatherapy | swsh:54 usum:86 | before-guard | M | cures the user's and its team's statuses except a Sap Sipper, Good as Gold or (without Infiltrator) Substitute Pokémon other than the user; the bench's in the E2 outcome |
| aromaticmist | champions:14 sv:25 swsh:29 usum:9 | before-guard | M | ally Sp. Def +1 |
| attract | champions:116 sv:24 swsh:623 usum:851 | before-guard | M | infatuation (opposite genders; Oblivious, Aroma Veil; Destiny Knot back; Mental Herb) |
| autotomize | swsh:27 usum:47 | before-guard | C | Spe +2; its weight -100 kg changes Low Kick, Grass Knot, Heat Crash, Heavy Slam: guarded only when one of those later hits it or is its own (`Autotomize changes {Name}'s weight: later moves are not modelled.`) |
| babydolleyes | champions:41 sv:51 swsh:46 usum:53 | before-guard | M | Atk -1 (priority +1) |
| barrier | usum:47 | before-guard | M | Def +2 |
| bestow | usum:43 | before-guard | M | gives its item to an itemless target (USUM) |
| block | champions:19 sv:43 swsh:110 usum:143 | before-guard | N | trap only |
| bulkup | champions:74 sv:137 swsh:90 usum:116 | before-guard | M | Atk +1 Def +1 |
| calmmind | champions:122 sv:253 swsh:177 usum:261 | before-guard | M | Sp. Atk +1 Sp. Def +1 |
| camouflage | usum:50 | before-guard | G | as Soak |
| captivate | usum:541 | before-guard | M | Sp. Atk -2 on opposite-gender foes (Oblivious immune) |
| charge | champions:30 sv:81 swsh:55 usum:51 | before-guard | M | Sp. Def +1 and charged (its next Electric move this turn doubles; MonState.charged) |
| charm | champions:111 sv:238 swsh:159 usum:168 | before-guard | M | Atk -2 |
| coaching | champions:38 sv:57 swsh:53 | before-guard | M | ally Atk +1 Def +1 |
| coil | champions:7 sv:17 swsh:9 usum:17 | before-guard | M | Atk +1 Def +1 (accuracy +1 not read) |
| confide | sv:4 swsh:640 usum:1013 | before-guard | M | Sp. Atk -1 (sound) |
| confuseray | champions:94 sv:200 swsh:97 usum:119 | before-guard | M | confusion (fresh: no snap-out this turn) |
| conversion | sv:4 swsh:3 usum:4 | before-guard | G | as Soak |
| conversion2 | sv:4 swsh:3 usum:4 | before-guard | G | as Soak |
| corrosivegas | champions:7 swsh:17 | before-guard | G | `Corrosive Gas is not modelled in 2v2.` |
| cosmicpower | champions:14 sv:42 swsh:28 usum:57 | before-guard | M | Def +1 Sp. Def +1 |
| cottonguard | champions:18 sv:11 swsh:11 usum:29 | before-guard | M | Def +3 |
| cottonspore | champions:5 sv:11 swsh:9 usum:18 | before-guard | M | Spe -2 on both foes (powder) |
| courtchange | champions:1 sv:2 swsh:1 | before-guard | M | swaps the two sides' screens, Tailwind, Safeguard, Mist, Lucky Chant (and hazards) |
| craftyshield | swsh:7 usum:6 | before-guard | M | side flag: blocks every status move into its side whose target type is not self or all, from any Pokémon (its ally's too, Q17); fails with no action after it (queue.willAct) |
| darkvoid | sv:1 usum:2 | before-guard | M | slp on both foes; only Darkrai (onTry), else fails |
| decorate | champions:9 sv:10 swsh:9 | before-guard | M | target Atk +2 Sp. Atk +2 |
| defendorder | sv:2 swsh:1 usum:2 | before-guard | M | Def +1 Sp. Def +1 |
| defensecurl | sv:80 swsh:142 usum:219 | before-guard | C | Def +1; guarded only when its own later Rollout or Ice Ball follows (`Defense Curl is not modelled with Rollout.`) |
| defog | champions:15 sv:50 swsh:134 usum:229 | before-guard | M | target's side screens/Safeguard/Mist and both sides' hazards cleared, the terrain ended (gen 8+); evasion -1 on the target |
| disable | champions:46 sv:79 swsh:79 usum:103 | before-guard | C | target moved this turn: no effect; else needs `lastMove` (`Disable needs {Name}'s move from the last turn.`); its queued move = lastMove fails |
| doodle | sv:2 | before-guard | M | user and ally copy the target's ability (SV) |
| doubleteam | champions:58 sv:74 swsh:643 usum:1012 | before-guard | M | evasion +1: nothing read (every move hits) |
| dragoncheer | champions:34 sv:63 | before-guard | M | ally crit stage +1 (+2 if Dragon): new build field `dragonCheer`; only a certain crit changes damage |
| dragondance | champions:35 sv:84 swsh:63 usum:52 | before-guard | M | Atk +1 Spe +1 (dance) |
| eerieimpulse | champions:29 sv:71 swsh:40 usum:20 | before-guard | M | Sp. Atk -2 |
| electrify | champions:1 swsh:3 usum:3 | before-guard | C | guarded when the target still moves (`Electrify changes {Move}'s type: not modelled.`) |
| embargo | usum:118 | before-guard | C | items off for its target: guarded when an item of the target acts later (incl. end of turn) (`Embargo is not modelled.`), else no effect |
| encore | champions:81 sv:182 swsh:132 usum:108 | before-guard | C | target moved this turn: no effect; else needs `lastMove`; the action becomes lastMove at a random valid target (Champions recomputes priority, data/mods/champions/moves.ts) |
| endure | champions:395 sv:914 swsh:769 usum:631 | before-guard | M | survives every damaging hit this turn at 1 HP (turn-mode env in the hit loop); stall fact as Protect |
| entrainment | champions:22 sv:35 swsh:26 usum:30 | before-guard | M | gives its ability to the target (Start runs) |
| extremeevoboost | usum:0 | before-guard | X | Z-Move: no learner |
| fairylock | champions:1 sv:2 swsh:1 usum:2 | before-guard | N | trap only |
| faketears | champions:80 sv:145 swsh:97 usum:83 | before-guard | M | Sp. Def -2 |
| featherdance | champions:25 sv:62 swsh:22 usum:47 | before-guard | M | Atk -2 (dance: Dancer guarded) |
| flash | usum:418 | before-guard | M | accuracy -1 (as Sand Attack) |
| flatter | champions:18 sv:46 swsh:29 usum:36 | before-guard | M | Sp. Atk +1 then confusion |
| flowershield | swsh:4 usum:11 | before-guard | M | every Grass type Def +1 |
| focusenergy | champions:67 sv:92 swsh:120 usum:122 | before-guard | M | crit stage +2 (build.settledFocusEnergy; same volatile as Lansat, no stack): only a certain crit (stage 4 from gen 7) changes damage |
| foresight | usum:88 | before-guard | C | guarded when a later Normal/Fighting move hits a Ghost target (USUM) |
| forestscurse | champions:1 sv:3 swsh:2 usum:3 | before-guard | G | as Soak |
| gastroacid | champions:8 sv:20 swsh:29 usum:49 | before-guard | M | target's ability suppressed (stand-in ability) |
| gearup | swsh:3 usum:3 | before-guard | M | Plus/Minus Pokémon on its side Atk +1 Sp. Atk +1 |
| geomancy | swsh:1 usum:2 | before-guard | M | charge turn (no effect) unless Power Herb: Sp. Atk/Sp. Def/Spe +2 |
| glare | champions:6 sv:12 swsh:10 usum:15 | before-guard | M | par (hits Ghost) |
| grasswhistle | usum:49 | before-guard | M | slp (sound: Soundproof) |
| growl | sv:174 swsh:138 usum:207 | before-guard | M | Atk -1 on both foes (sound) |
| growth | champions:24 sv:79 swsh:47 usum:67 | before-guard | M | Atk +1 Sp. Atk +1, +2 each in sun (effectiveWeather, Utility Umbrella) |
| grudge | swsh:30 usum:33 | before-guard | N | PP only |
| guardsplit | champions:7 sv:12 swsh:24 usum:28 | before-guard | G | `Guard Split is not modelled in 2v2.` |
| guardswap | champions:24 sv:12 swsh:64 usum:37 | before-guard | M | Def/Sp. Def stages swapped |
| happyhour | sv:2 swsh:15 usum:18 | before-guard | N | nothing |
| harden | sv:69 swsh:71 usum:112 | before-guard | M | Def +1 |
| haze | champions:39 sv:101 swsh:81 usum:90 | before-guard | M | every stage to 0 |
| healbell | champions:2 sv:5 swsh:58 usum:101 | before-guard | M | cures the user's and ally's statuses (Soundproof / Good as Gold ally excepted); the bench's in the E2 outcome |
| healblock | usum:47 | before-guard | C | heal moves fail at BeforeMove; heals blocked at the end of turn; guarded while a heal the pair engine reads can happen in a later step (`Heal Block on {Name} is not modelled with a later heal.`) |
| heartswap | sv:2 usum:3 | before-guard | M | all stages swapped |
| holdhands | swsh:4 usum:8 | before-guard | N | nothing |
| honeclaws | sv:49 swsh:141 usum:206 | before-guard | M | Atk +1 |
| howl | champions:23 sv:44 swsh:37 usum:44 | before-guard | M | Atk +1 to the user and its ally (gen 8+ target allies; Champions sound: a Soundproof ally is immune) |
| hypnosis | champions:30 sv:58 swsh:65 usum:74 | before-guard | M | slp |
| imprison | champions:73 sv:172 swsh:153 usum:85 | before-guard | C | a foe's later move the user knows fails (onFoeBeforeMove): needs the user's moves (`moves` input; complete); else `Imprison needs {Name}'s moves.` |
| ingrain | champions:13 sv:36 swsh:35 usum:50 | before-guard | C | 1/16 heal at the end of turn (order 7); grounds its user: guarded when a later Ground move could hit an ungrounded user |
| iondeluge | usum:11 | before-guard | C | guarded when a later Normal move follows (`Ion Deluge is not modelled.`) |
| irondefense | champions:113 sv:210 swsh:225 usum:267 | before-guard | M | Def +2 |
| kinesis | swsh:2 usum:4 | before-guard | M | accuracy -1 (as Sand Attack) |
| laserfocus | swsh:183 usum:283 | before-guard | C | next attack crits: guarded when its own later attack follows (`Laser Focus is not modelled.`), else no effect |
| leer | sv:189 swsh:179 usum:220 | before-guard | M | Def -1 on both foes |
| lockon | champions:1 sv:17 swsh:26 usum:26 | before-guard | N | every move hits |
| lovelykiss | swsh:1 usum:2 | before-guard | M | slp |
| luckychant | usum:74 | before-guard | M | side flag: no crits into it (matters with the Critical hit toggle) |
| magiccoat | swsh:155 usum:239 | before-guard | M | reflects reflectable status moves (single target: at the source; spread: the source's side) |
| magicpowder | champions:1 sv:2 swsh:1 | before-guard | G | as Soak |
| magicroom | champions:35 sv:11 swsh:66 usum:74 | before-guard | M | Magic Room toggles (a second use ends it) |
| magneticflux | champions:3 sv:10 swsh:4 usum:8 | before-guard | M | Plus/Minus Pokémon on its side Def +1 Sp. Def +1 |
| magnetrise | champions:8 sv:17 swsh:87 usum:128 | before-guard | C | guarded when a later Ground move could hit it (`Magnet Rise is not modelled.`), else no effect |
| matblock | swsh:1 usum:5 | before-guard | M | side flag: blocks damaging moves with the protect flag into its side (Z/Max at 1/4); first-turn fact |
| maxguard | swsh:0 | before-guard | X | `Max Guard is not modelled.` |
| meanlook | champions:22 sv:42 swsh:40 usum:57 | before-guard | N | trap only |
| meditate | usum:23 | before-guard | M | Atk +1 |
| metalsound | champions:29 sv:61 swsh:64 usum:62 | before-guard | M | Sp. Def -2 (sound) |
| mimic | sv:13 swsh:279 usum:466 | before-guard | N | moveset only |
| mindreader | swsh:22 usum:34 | before-guard | N | every move hits |
| minimize | champions:7 sv:15 swsh:16 usum:17 | before-guard | C | evasion +2; guarded only when a later Stomp-family move hits it (minimize onSourceModifyDamage 2x: `Minimize doubles the damage {Name} takes: later moves are not modelled.`) |
| miracleeye | usum:21 | before-guard | C | guarded when a later Psychic move hits a Dark target (USUM) |
| mist | sv:68 swsh:73 usum:74 | before-guard | M | side flag: drops from other Pokémon blocked (Infiltrator foes pass) |
| mudsport | usum:90 | before-guard | C | guarded when a later Electric move follows (USUM) |
| nastyplot | champions:85 sv:167 swsh:133 usum:99 | before-guard | M | Sp. Atk +2 |
| nightmare | usum:103 | before-guard | M | volatile on a sleeping target: 1/4 at the end of turn (order 11) |
| nobleroar | champions:6 sv:21 swsh:13 usum:14 | before-guard | M | Atk -1 Sp. Atk -1 (sound) |
| noretreat | champions:2 sv:2 swsh:1 | before-guard | M | +1 all five; fails while its volatile is up (pre-turn input) |
| octolock | champions:1 swsh:1 | before-guard | M | trap (no switch this turn) and Def/Sp. Def -1 at the end of turn (order 14) |
| odorsleuth | usum:72 | before-guard | C | as Foresight |
| playnice | sv:34 swsh:31 usum:38 | before-guard | M | Atk -1 (no protect flag) |
| poisongas | sv:20 swsh:12 usum:18 | before-guard | M | psn on both foes |
| poisonpowder | champions:28 sv:54 swsh:21 usum:60 | before-guard | M | psn (powder) |
| powder | usum:23 | before-guard | G | `Powder is not modelled in 2v2.` (USUM) |
| powershift | champions:0 | before-guard | G | `Power Shift is not modelled in 2v2.` |
| powersplit | champions:8 sv:14 swsh:23 usum:26 | before-guard | G | `Power Split is not modelled in 2v2.` (raw stats) |
| powerswap | champions:21 sv:8 swsh:69 usum:34 | before-guard | M | Atk/Sp. Atk stages swapped |
| powertrick | champions:5 sv:5 swsh:13 usum:22 | before-guard | G | `Power Trick is not modelled in 2v2.` |
| psychoshift | swsh:18 usum:27 | before-guard | M | moves its status to the target, then cured (USUM/SwSh) |
| psychup | champions:92 sv:241 swsh:216 usum:346 | before-guard | M | copies the target's stages and Focus Energy / Dragon Cheer (Laser Focus copied: guarded as Laser Focus) |
| quash | champions:9 sv:15 swsh:26 usum:59 | before-guard | M | target's action order 201 (last); gen 7: priority -7.1 at the end (data/mods/gen7) |
| quiverdance | champions:21 sv:33 swsh:8 usum:37 | before-guard | M | Sp. Atk/Sp. Def/Spe +1 (dance) |
| recycle | champions:13 sv:22 swsh:90 usum:140 | before-guard | C | an item used earlier this turn comes back: modelled; one used before the turn: `Recycle needs the item {Name} used before.` |
| reflecttype | champions:4 sv:8 swsh:12 usum:19 | before-guard | G | as Soak |
| refresh | usum:141 | before-guard | M | cures its own psn/par/brn (USUM) |
| roar | champions:105 sv:213 swsh:165 usum:266 | before-guard | G | drags the target out (as Shed Tail): Suction Cups, Guard Dog, Ingrain, Dynamax stop it |
| rockpolish | champions:9 sv:35 swsh:95 usum:130 | before-guard | M | Spe +2 |
| roleplay | champions:15 sv:14 swsh:97 usum:170 | before-guard | M | copies the target's ability (Start runs) |
| rototiller | usum:27 | before-guard | M | every grounded Grass type Atk +1 Sp. Atk +1 |
| safeguard | champions:109 sv:71 swsh:240 usum:360 | before-guard | M | side flag: status and confusion from other Pokémon blocked (Infiltrator foes pass); Yawn blocked |
| sandattack | sv:82 swsh:90 usum:122 | before-guard | M | accuracy -1 (no stage read; the reactions as Sweet Scent) |
| scaryface | champions:162 sv:382 swsh:193 usum:167 | before-guard | M | Spe -2 |
| screech | champions:72 sv:119 swsh:169 usum:169 | before-guard | M | Def -2 (sound) |
| sharpen | usum:10 | before-guard | M | Atk +1 |
| shellsmash | champions:8 sv:25 swsh:20 usum:26 | before-guard | M | Def/Sp. Def -1, Atk/Sp. Atk/Spe +2 (White Herb) |
| shelter | champions:1 sv:3 | before-guard | M | Def +2 |
| shiftgear | champions:1 sv:6 swsh:11 usum:10 | before-guard | M | Spe +2 Atk +1 |
| simplebeam | champions:4 sv:6 swsh:22 usum:23 | before-guard | M | target becomes Simple |
| sing | champions:9 sv:28 swsh:47 usum:67 | before-guard | M | slp (sound) |
| sketch | sv:1 usum:1 | before-guard | N | moveset only |
| skillswap | champions:71 sv:133 swsh:104 usum:131 | before-guard | M | abilities swapped; old End and new Start run (setAbility): guarded when an ability with an acting Start is involved |
| sleeppowder | champions:26 sv:42 swsh:22 usum:51 | before-guard | M | slp (powder) |
| smokescreen | sv:33 swsh:27 usum:33 | before-guard | M | accuracy -1 (as Sand Attack) |
| snatch | usum:180 | before-guard | G | `Snatch is not modelled in 2v2.` (presence, USUM) |
| soak | champions:10 sv:40 swsh:30 usum:30 | before-guard | G | `Soak changes {Name}'s type: not modelled.` |
| speedswap | champions:4 sv:2 swsh:28 usum:6 | before-guard | G | `Speed Swap is not modelled in 2v2.` (raw Speed, not a stage) |
| spicyextract | champions:2 sv:2 | before-guard | M | target Atk +2 Def -2 |
| spiderweb | usum:8 | before-guard | N | trap only (USUM) |
| spite | champions:74 sv:158 swsh:130 usum:168 | before-guard | N | PP only |
| spore | champions:0 sv:8 swsh:4 usum:9 | before-guard | M | slp (powder) |
| stockpile | champions:18 sv:61 swsh:41 usum:61 | before-guard | C | Def +1 Sp. Def +1 and a layer; the layers before the turn are an input (default 0, a turn fact), fails at 3 |
| stringshot | champions:25 sv:36 swsh:34 usum:93 | before-guard | M | Spe -2 on both foes |
| stunspore | champions:27 sv:62 swsh:26 usum:62 | before-guard | M | par (powder) |
| supersonic | sv:70 swsh:59 usum:97 | before-guard | M | confusion (sound) |
| swagger | champions:68 sv:80 swsh:652 usum:1009 | before-guard | M | Atk +2 then confusion |
| sweetkiss | champions:24 sv:47 swsh:49 usum:42 | before-guard | M | confusion |
| sweetscent | champions:29 sv:68 swsh:68 usum:94 | before-guard | M | evasion -2 (-1 gen 7) on both foes: no stage the calculation reads, but Defiant/Competitive, Lash Out, Clear Body, Mirror Armor, Eject Pack react |
| switcheroo | champions:26 sv:49 swsh:28 usum:42 | before-guard | M | as Trick |
| swordsdance | champions:116 sv:264 swsh:196 usum:288 | before-guard | M | Atk +2 (dance) |
| tailglow | sv:3 usum:4 | before-guard | M | Sp. Atk +3 |
| tailwhip | sv:99 swsh:84 usum:112 | before-guard | M | Def -1 on both foes |
| takeheart | sv:3 | before-guard | M | Sp. Atk +1 Sp. Def +1 and cures its status |
| tarshot | sv:2 swsh:1 | before-guard | C | Spe -1; guarded when a later Fire move hits it (`Tar Shot doubles Fire damage on {Name}: later moves are not modelled.`) |
| taunt | champions:135 sv:338 swsh:225 usum:294 | before-guard | M | later status move (not a Z-Move) fails at BeforeMove (priority 5); Oblivious, Aroma Veil, Mental Herb |
| tearfullook | champions:13 sv:27 swsh:12 usum:25 | before-guard | M | Atk -1 Sp. Atk -1 (no protect flag) |
| teeterdance | champions:6 sv:22 swsh:24 usum:37 | before-guard | M | confusion on all adjacent, its ally too (Dancer stays guarded) |
| telekinesis | usum:218 | before-guard | C | as Magnet Rise (USUM) |
| thunderwave | champions:121 sv:249 swsh:237 usum:319 | before-guard | M | par; ignoreImmunity false: Ground immune |
| tickle | champions:40 sv:77 swsh:90 usum:99 | before-guard | M | Atk -1 Def -1 |
| tidyup | champions:2 sv:7 | before-guard | M | Atk +1 Spe +1; removes every Substitute and the hazards |
| topsyturvy | champions:3 sv:3 swsh:3 usum:3 | before-guard | M | target's stages inverted |
| torment | champions:31 sv:44 swsh:137 usum:209 | before-guard | N | no BeforeMove handler: changes only the next choice |
| toxic | champions:39 sv:96 swsh:643 usum:1014 | before-guard | M | tox (stage 0: 1/16 at this end of turn) |
| toxicthread | champions:1 sv:3 usum:3 | before-guard | M | Spe -1 (-2 Champions) then psn |
| transform | champions:1 sv:3 swsh:2 usum:3 | before-guard | G | `Transform is not modelled in 2v2.` |
| trick | champions:86 sv:176 swsh:142 usum:177 | before-guard | M | items swapped (Sticky Hold, unremovable items fail); Berries due at the Update; Unburden; guarded for items acting on receipt |
| trickortreat | champions:4 swsh:8 usum:9 | before-guard | G | as Soak |
| venomdrench | swsh:48 usum:42 | before-guard | M | Atk/Sp. Atk/Spe -1 on poisoned foes only |
| victorydance | sv:2 | before-guard | M | Atk/Def/Spe +1 (dance) |
| watersport | usum:73 | before-guard | C | guarded when a later Fire move follows (USUM) |
| whirlwind | champions:37 sv:41 swsh:36 usum:64 | before-guard | G | as Roar (wind: Wind Rider absorbs) |
| willowisp | champions:75 sv:141 swsh:112 usum:154 | before-guard | M | brn; Flash Fire / Well-Baked Body absorb it |
| withdraw | sv:29 swsh:28 usum:26 | before-guard | M | Def +1 |
| wonderroom | champions:52 sv:13 swsh:108 usum:106 | before-guard | M | Wonder Room toggles |
| workup | sv:34 swsh:211 usum:342 | before-guard | M | Atk +1 Sp. Atk +1 |
| worryseed | champions:18 sv:61 swsh:73 usum:134 | before-guard | M | target becomes Insomnia, its sleep cured |
| yawn | champions:47 sv:89 swsh:74 usum:104 | before-guard | M | yawn volatile: no sleep this turn (duration 2, order 23); fails on a statused or sleep-immune target (onTryHit); leaves `drowsy` for the next end of turn |
| assist | usum:24 | calling | X | `{Move} is not modelled in 2v2.` |
| copycat | champions:41 sv:70 swsh:45 usum:60 | calling | X | as Assist |
| instruct | champions:1 sv:2 swsh:1 usum:2 | calling | C | target uses its last move again at once: modelled when it moved this turn (its action repeated, prioritizeAction); else needs `lastMove` (`Instruct needs {Name}'s move from the last turn.`) |
| mefirst | usum:57 | calling | X | as Assist |
| metronome | sv:146 swsh:69 usum:71 | calling | X | as Assist |
| mirrormove | usum:43 | calling | X | as Assist |
| naturepower | swsh:98 usum:171 | calling | X | as Assist |
| sleeptalk | champions:395 sv:917 swsh:767 usum:1014 | calling | X | as Assist (asleep or Comatose; fails otherwise) |
| bellydrum | champions:14 sv:40 swsh:47 usum:51 | hp-guard | M | loses floor(maxhp/2), Atk to +6; fails at <= 1/2 HP or +6 |
| clangoroussoul | champions:1 sv:2 swsh:1 | hp-guard | M | loses floor(maxhp/3), +1 all five |
| curse | champions:132 sv:283 swsh:296 usum:413 | hp-guard | M | Ghost: loses floor(maxhp/2), target cursed (1/4 at the end of turn, order 12); other: Atk +1 Def +1 Spe -1 |
| filletaway | sv:2 | hp-guard | M | loses floor(maxhp/2), Atk/Sp. Atk/Spe +2 (SV) |
| floralhealing | sv:2 swsh:1 usum:2 | hp-guard | M | target heal ceil(1/2) (Grassy modify 0.667) |
| healingwish | champions:15 sv:43 swsh:29 usum:30 | hp-guard | M | user faints; heals its replacement (fact only) |
| healorder | usum:2 | hp-guard | M | heal round(1/2) |
| healpulse | champions:25 sv:37 swsh:42 usum:46 | hp-guard | M | target heal ceil(1/2) (Mega Launcher modify 0.75) |
| junglehealing | sv:3 swsh:2 | hp-guard | M | user and ally heal modify(maxhp, 0.25) and cure |
| lifedew | champions:21 sv:39 swsh:41 | hp-guard | M | user and ally heal round(1/4) |
| lunarblessing | sv:2 | hp-guard | M | user and ally heal modify(maxhp, 0.25) and cure |
| lunardance | sv:2 swsh:1 usum:2 | hp-guard | M | as Healing Wish |
| memento | champions:23 sv:81 swsh:46 usum:49 | hp-guard | M | target Atk -2 Sp. Atk -2, the user faints at once (no replacement until the turn ends) |
| milkdrink | champions:1 sv:3 swsh:1 usum:4 | hp-guard | M | heal round(1/2) (Champions: itself or its ally) |
| moonlight | champions:6 sv:20 swsh:22 usum:28 | hp-guard | M | modify(maxhp, 0.5 / 0.667 sun / 0.25 rain-sand-hail-snow), effectiveWeather |
| morningsun | champions:5 sv:19 swsh:29 usum:37 | hp-guard | M | as Moonlight |
| painsplit | champions:72 sv:137 swsh:108 usum:139 | hp-guard | M | both set to floor((a + b) / 2) (undynamaxed HP) |
| purify | swsh:1 usum:2 | hp-guard | M | cures the target's status, user heals round(1/2) (USUM/SwSh) |
| recover | champions:29 sv:81 swsh:56 usum:76 | hp-guard | M | heal round(1/2) |
| rest | champions:395 sv:915 swsh:769 usum:1008 | hp-guard | M | full HP, sleep with counter 3 (cannot wake this turn), status cured; fails at full HP or sleep-immune |
| revivalblessing | champions:1 sv:2 | hp-guard | G | `Revival Blessing is not modelled in 2v2.` |
| roost | champions:39 sv:67 swsh:80 usum:146 | hp-guard | C | heal round(1/2); loses Flying for the turn: guarded when a later damaging move hits it (`Roost removes {Name}'s Flying type: later moves are not modelled.`) |
| shedtail | champions:4 sv:4 | hp-guard | G | switch: `{Name} switches out: the replacement is not known.` (the end of turn only when no action follows) |
| shoreup | sv:3 swsh:2 usum:3 | hp-guard | M | modify(maxhp, 0.5 / 0.667 sand) |
| slackoff | champions:10 sv:19 swsh:9 usum:13 | hp-guard | M | heal round(1/2) |
| softboiled | champions:0 sv:3 swsh:9 usum:10 | hp-guard | M | heal round(1/2) |
| strengthsap | champions:8 sv:21 swsh:13 usum:13 | hp-guard | M | user heals the target's Attack (stages, no modifiers; Big Root, Liquid Ooze), target Atk -1 |
| stuffcheeks | champions:4 sv:8 swsh:2 | hp-guard | M | eats its Berry at any HP (HP, pinch, curing Berries) then Def +2; other Berries guarded |
| substitute | champions:395 sv:916 swsh:769 usum:1015 | hp-guard | M | loses floor(maxhp/4), Substitute with floor(maxhp/4) HP; later status moves fail; later hits into it guarded (`Hits on {Name}'s Substitute are not modelled.`) unless sound/Infiltrator |
| swallow | champions:15 sv:54 swsh:38 usum:58 | hp-guard | C | needs the Stockpile layers (input): heal 1/4, 1/2, full; else `Swallow needs Stockpile from earlier turns.` |
| synthesis | champions:27 sv:102 swsh:66 usum:128 | hp-guard | M | as Moonlight |
| teatime | champions:2 sv:3 swsh:2 | hp-guard | M | every Pokémon eats its Berry at any HP; other Berries guarded |
| wish | champions:39 sv:66 swsh:62 usum:93 | hp-guard | M | no HP this turn; heals its slot at the next end of turn (E2 carries it) |
| auroraveil | champions:9 sv:14 swsh:25 usum:14 | modelled | X | modelled |
| banefulbunker | champions:1 sv:2 swsh:1 usum:2 | modelled | X | modelled |
| burningbulwark | sv:2 | modelled | X | modelled |
| destinybond | champions:35 sv:52 swsh:56 usum:66 | modelled | M | the foe whose move knocks the user out faints too (onFaint; Dynamax immune): replaces today's guard |
| detect | champions:41 sv:56 swsh:120 usum:171 | modelled | X | modelled |
| electricterrain | champions:29 sv:103 swsh:40 usum:21 | modelled | X | modelled; now also blocks sleep (grounded) |
| followme | champions:5 sv:23 swsh:21 usum:26 | modelled | X | modelled; now also redirects single-target status moves |
| grassyterrain | champions:37 sv:155 swsh:41 usum:64 | modelled | X | modelled; end of turn heal |
| gravity | champions:33 sv:128 swsh:95 usum:149 | modelled | X | modelled |
| hail | swsh:176 usum:223 | modelled | X | modelled |
| helpinghand | champions:259 sv:579 swsh:273 usum:296 | modelled | X | modelled |
| kingsshield | champions:2 swsh:2 usum:3 | modelled | X | modelled |
| lightscreen | champions:161 sv:337 swsh:260 usum:356 | modelled | X | modelled |
| mistyterrain | champions:44 sv:94 swsh:45 usum:44 | modelled | X | modelled; now also blocks status and confusion (grounded) |
| obstruct | swsh:1 | modelled | X | modelled |
| protect | champions:395 sv:917 swsh:769 usum:1018 | modelled | X | modelled |
| psychicterrain | champions:32 sv:83 swsh:40 usum:17 | modelled | X | modelled; now also stops priority status moves into grounded foes |
| quickguard | champions:33 sv:53 swsh:56 usum:63 | modelled | X | modelled; now also stops priority status moves |
| ragepowder | champions:26 sv:42 swsh:6 usum:37 | modelled | X | modelled; as Follow Me (not on powder-immune users) |
| raindance | champions:294 sv:653 swsh:478 usum:703 | modelled | X | modelled |
| reflect | champions:101 sv:247 swsh:257 usum:323 | modelled | X | modelled |
| sandstorm | champions:88 sv:243 swsh:190 usum:261 | modelled | X | modelled |
| silktrap | sv:2 | modelled | X | modelled |
| snowscape | champions:47 sv:109 | modelled | X | modelled |
| spikyshield | champions:4 sv:12 swsh:2 usum:8 | modelled | X | modelled |
| sunnyday | champions:294 sv:643 swsh:438 usum:702 | modelled | X | modelled |
| tailwind | champions:52 sv:147 swsh:102 usum:193 | modelled | X | modelled |
| trickroom | champions:64 sv:143 swsh:118 usum:157 | modelled | X | modelled |
| wideguard | champions:28 sv:50 swsh:51 usum:73 | modelled | X | modelled; now also stops spread status moves |
| celebrate | sv:32 swsh:46 usum:44 | no-effect | N | nothing |
| leechseed | champions:30 sv:96 swsh:63 usum:94 | no-effect | M | seeded (Grass immune, Substitute blocks): drains at THIS end of turn (order 8; Liquid Ooze, Big Root) |
| perishsong | champions:11 sv:46 swsh:24 usum:54 | no-effect | M | count 3 on every Pokémon hearing it (Soundproof immune) at this end of turn; no HP |
| spikes | champions:33 sv:75 swsh:38 usum:45 | no-effect | N | hazard (E2 reports where it lands: Magic Bounce reflects it) |
| splash | sv:39 swsh:37 usum:50 | no-effect | N | nothing |
| stealthrock | champions:68 sv:196 swsh:143 usum:211 | no-effect | N | as Spikes |
| stickyweb | champions:3 sv:19 swsh:14 usum:17 | no-effect | N | as Spikes |
| toxicspikes | champions:34 sv:63 swsh:41 usum:44 | no-effect | N | as Spikes |
| spotlight | usum:8 | presence | M | centre of attention on its target (redirection exists); reflected by Magic Coat/Bounce |
| batonpass | champions:79 sv:183 swsh:106 usum:111 | switch | G | switch (as Shed Tail) |
| chillyreception | champions:2 sv:3 | switch | M | snow modelled; then the switch as Shed Tail |
| partingshot | champions:11 sv:22 swsh:31 usum:23 | switch | M | drops (Atk -1 Sp. Atk -1) modelled; then the switch as Shed Tail |
| teleport | sv:13 swsh:49 usum:64 | switch | G | switch (as Shed Tail) |

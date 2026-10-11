Classified 271/271: {"M":122,"N":20,"C":6,"L":76,"S":7,"P":1,"X":39}

| Move | Games (learners) | Today | Build | This turn / guard |
|---|---|---|---|---|
| acidarmor | champions:20 sv:43 swsh:38 usum:35 | before-guard | M | Def +2 |
| acupressure | champions:8 sv:20 swsh:19 usum:17 | before-guard | L | random stat: not in this build |
| afteryou | champions:18 sv:32 swsh:84 usum:121 | before-guard | M | the target's queued action gets order 3 and moves next (gen 7: next in the frozen queue); fails if it has no action left |
| agility | champions:105 sv:281 swsh:185 usum:182 | before-guard | M | Spe +2 (re-sort from gen 8) |
| allyswitch | champions:31 sv:32 swsh:164 usum:190 | before-guard | L | positions: not in this build |
| amnesia | champions:46 sv:117 swsh:123 usum:127 | before-guard | M | Sp. Def +2 |
| aquaring | champions:13 sv:47 swsh:47 usum:63 | before-guard | M | 1/16 heal at this end of turn (order 6; Big Root) |
| aromatherapy | swsh:54 usum:86 | before-guard | L | party cure: not in this build |
| aromaticmist | champions:14 sv:25 swsh:29 usum:9 | before-guard | M | ally Sp. Def +1 |
| attract | champions:116 sv:24 swsh:623 usum:851 | before-guard | L | infatuation: not in this build |
| autotomize | swsh:27 usum:47 | before-guard | L | weight change: not in this build |
| babydolleyes | champions:41 sv:51 swsh:46 usum:53 | before-guard | M | Atk -1 |
| barrier | usum:47 | before-guard | M | Def +2 |
| bestow | usum:43 | before-guard | L | as Trick (USUM) |
| block | champions:19 sv:43 swsh:110 usum:143 | before-guard | N | trap only |
| bulkup | champions:74 sv:137 swsh:90 usum:116 | before-guard | M | Atk +1 Def +1 |
| calmmind | champions:122 sv:253 swsh:177 usum:261 | before-guard | M | Sp. Atk +1 Sp. Def +1 |
| camouflage | usum:50 | before-guard | L | type change |
| captivate | usum:541 | before-guard | L | gender-dependent drop: not in this build |
| charge | champions:30 sv:81 swsh:55 usum:51 | before-guard | M | Sp. Def +1 and charged (MonState.charged: its next Electric attack, a later turn's, doubles) |
| charm | champions:111 sv:238 swsh:159 usum:168 | before-guard | M | Atk -2 |
| coaching | champions:38 sv:57 swsh:53 | before-guard | M | ally Atk +1 Def +1 (adjacentAlly) |
| coil | champions:7 sv:17 swsh:9 usum:17 | before-guard | M | Atk +1 Def +1 (accuracy +1 not stored) |
| confide | sv:4 swsh:640 usum:1013 | before-guard | M | Sp. Atk -1 (sound) |
| confuseray | champions:94 sv:200 swsh:97 usum:119 | before-guard | M | confusion (fresh: cannot end at its first BeforeMove) |
| conversion | sv:4 swsh:3 usum:4 | before-guard | L | type change |
| conversion2 | sv:4 swsh:3 usum:4 | before-guard | L | type change |
| corrosivegas | champions:7 swsh:17 | before-guard | L | not in this build |
| cosmicpower | champions:14 sv:42 swsh:28 usum:57 | before-guard | M | Def +1 Sp. Def +1 |
| cottonguard | champions:18 sv:11 swsh:11 usum:29 | before-guard | M | Def +3 |
| cottonspore | champions:5 sv:11 swsh:9 usum:18 | before-guard | M | Spe -2 on both foes (powder) |
| courtchange | champions:1 sv:2 swsh:1 | before-guard | L | not in this build |
| craftyshield | swsh:7 usum:6 | before-guard | L | not in this build (SwSh, USUM) |
| darkvoid | sv:1 usum:2 | before-guard | M | slp on both foes; fails unless the user is Darkrai (onTry) |
| decorate | champions:9 sv:10 swsh:9 | before-guard | M | target Atk +2 Sp. Atk +2 |
| defendorder | sv:2 swsh:1 usum:2 | before-guard | M | Def +1 Sp. Def +1 |
| defensecurl | sv:80 swsh:142 usum:219 | before-guard | M | Def +1 (Rollout is its own later turn's) |
| defog | champions:15 sv:50 swsh:134 usum:229 | before-guard | L | not in this build |
| disable | champions:46 sv:79 swsh:79 usum:103 | before-guard | C | target already acted: no effect this turn. Target still to act: needs `lastMove` (`Disable needs {Name}'s move from the last turn.`); with it, a queued move equal to it fails at BeforeMove (priority 7; Champions: not a cantusetwice move); null lastMove: fails |
| doodle | sv:2 | before-guard | L | as Skill Swap |
| doubleteam | champions:58 sv:74 swsh:643 usum:1012 | before-guard | M | evasion +1: not stored |
| dragoncheer | champions:34 sv:63 | before-guard | M | ally crit stage +1, +2 for a Dragon-type ally (new build.dragonCheer read by certainCrit); Champions: sound |
| dragondance | champions:35 sv:84 swsh:63 usum:52 | before-guard | M | Atk +1 Spe +1 |
| eerieimpulse | champions:29 sv:71 swsh:40 usum:20 | before-guard | M | Sp. Atk -2 |
| electrify | champions:1 swsh:3 usum:3 | before-guard | L | not in this build |
| embargo | usum:118 | before-guard | L | not in this build (USUM) |
| encore | champions:81 sv:182 swsh:132 usum:108 | before-guard | C | target already acted: no effect this turn. Target still to act: needs `lastMove`; with it, a queued move equal to it is unchanged (modelled), another one `Encore changes {Name}'s move: not modelled.`; null lastMove: fails |
| endure | champions:395 sv:914 swsh:769 usum:631 | before-guard | M | every damaging hit and the confusion self-hit that would knock it out leave 1 HP (onDamage -10, before Sturdy and Focus Sash); fails with no action after it; stall fact as Protect |
| entrainment | champions:22 sv:35 swsh:26 usum:30 | before-guard | L | as Skill Swap |
| extremeevoboost | usum:0 | before-guard | X | Z-Move with no learner |
| fairylock | champions:1 sv:2 swsh:1 usum:2 | before-guard | N | trap only |
| faketears | champions:80 sv:145 swsh:97 usum:83 | before-guard | M | Sp. Def -2 |
| featherdance | champions:25 sv:62 swsh:22 usum:47 | before-guard | M | Atk -2 |
| flash | usum:418 | before-guard | M | as Sand Attack |
| flatter | champions:18 sv:46 swsh:29 usum:36 | before-guard | M | Sp. Atk +1, then confusion |
| flowershield | swsh:4 usum:11 | before-guard | L | every Grass type: not in this build |
| focusenergy | champions:67 sv:92 swsh:120 usum:122 | before-guard | M | no effect on this turn's damage (its own action); build.settledFocusEnergy in the E2 outcome; fails if already up |
| foresight | usum:88 | before-guard | L | not in this build (USUM) |
| forestscurse | champions:1 sv:3 swsh:2 usum:3 | before-guard | L | type change |
| gastroacid | champions:8 sv:20 swsh:29 usum:49 | before-guard | L | as Skill Swap |
| gearup | swsh:3 usum:3 | before-guard | L | Plus/Minus side boost: not in this build |
| geomancy | swsh:1 usum:2 | before-guard | L | charge turn / Power Herb: not in this build |
| glare | champions:6 sv:12 swsh:10 usum:15 | before-guard | M | par (hits Ghost) |
| grasswhistle | usum:49 | before-guard | M | slp (sound) |
| growl | sv:174 swsh:138 usum:207 | before-guard | M | Atk -1 on both foes (sound) |
| growth | champions:24 sv:79 swsh:47 usum:67 | before-guard | M | Atk +1 Sp. Atk +1; +2 each in sun or Harsh Sunshine (effectiveWeather: Utility Umbrella, Cloud Nine) |
| grudge | swsh:30 usum:33 | before-guard | N | PP only |
| guardsplit | champions:7 sv:12 swsh:24 usum:28 | before-guard | L | raw stat average |
| guardswap | champions:24 sv:12 swsh:64 usum:37 | before-guard | L | not in this build |
| happyhour | sv:2 swsh:15 usum:18 | before-guard | N | nothing |
| harden | sv:69 swsh:71 usum:112 | before-guard | M | Def +1 |
| haze | champions:39 sv:101 swsh:81 usum:90 | before-guard | M | every Pokémon's stages to 0 |
| healbell | champions:2 sv:5 swsh:58 usum:101 | before-guard | L | party cure: not in this build |
| healblock | usum:47 | before-guard | L | not in this build (USUM) |
| heartswap | sv:2 usum:3 | before-guard | L | not in this build |
| holdhands | swsh:4 usum:8 | before-guard | N | nothing |
| honeclaws | sv:49 swsh:141 usum:206 | before-guard | M | Atk +1 (accuracy not stored) |
| howl | champions:23 sv:44 swsh:37 usum:44 | before-guard | M | Atk +1 on the user and its ally (target allies from gen 8); sound: a Soundproof ally is immune |
| hypnosis | champions:30 sv:58 swsh:65 usum:74 | before-guard | M | slp |
| imprison | champions:73 sv:172 swsh:153 usum:85 | before-guard | C | a foe's later move the user also has fails at BeforeMove (priority 4); needs the user's `moves` (`Imprison needs {Name}'s moves.`) |
| ingrain | champions:13 sv:36 swsh:35 usum:50 | before-guard | C | 1/16 heal at this end of turn (order 7; Big Root); grounds the user: guarded (`Ingrain grounds {Name}: later moves are not modelled.`) when the user was ungrounded and a later Ground move could reach it |
| iondeluge | usum:11 | before-guard | L | not in this build (USUM) |
| irondefense | champions:113 sv:210 swsh:225 usum:267 | before-guard | M | Def +2 |
| kinesis | swsh:2 usum:4 | before-guard | M | as Sand Attack |
| laserfocus | swsh:183 usum:283 | before-guard | N | its next attack is a later turn's (Instruct and Dancer stay guarded) |
| leer | sv:189 swsh:179 usum:220 | before-guard | M | Def -1 on both foes |
| lockon | champions:1 sv:17 swsh:26 usum:26 | before-guard | N | every move hits |
| lovelykiss | swsh:1 usum:2 | before-guard | M | slp |
| luckychant | usum:74 | before-guard | L | not in this build (USUM) |
| magiccoat | swsh:155 usum:239 | before-guard | L | not in this build (SwSh, USUM) |
| magicpowder | champions:1 sv:2 swsh:1 | before-guard | L | type change |
| magicroom | champions:35 sv:11 swsh:66 usum:74 | before-guard | L | not in this build |
| magneticflux | champions:3 sv:10 swsh:4 usum:8 | before-guard | L | as Gear Up |
| magnetrise | champions:8 sv:17 swsh:87 usum:128 | before-guard | C | ungrounds the user: guarded (`Magnet Rise lifts {Name}: later moves are not modelled.`) when a later Ground move could reach it; the end of turn reads it (no Grassy heal) |
| matblock | swsh:1 usum:5 | before-guard | L | not in this build (SwSh, USUM) |
| maxguard | swsh:0 | before-guard | X | `Max Guard is not modelled.` |
| meanlook | champions:22 sv:42 swsh:40 usum:57 | before-guard | N | trap only |
| meditate | usum:23 | before-guard | M | Atk +1 |
| metalsound | champions:29 sv:61 swsh:64 usum:62 | before-guard | M | Sp. Def -2 (sound) |
| mimic | sv:13 swsh:279 usum:466 | before-guard | N | moveset only |
| mindreader | swsh:22 usum:34 | before-guard | N | every move hits |
| minimize | champions:7 sv:15 swsh:16 usum:17 | before-guard | L | Stomp-family double damage: not in this build |
| miracleeye | usum:21 | before-guard | L | not in this build (USUM) |
| mist | sv:68 swsh:73 usum:74 | before-guard | L | not in this build |
| mudsport | usum:90 | before-guard | L | not in this build (USUM) |
| nastyplot | champions:85 sv:167 swsh:133 usum:99 | before-guard | M | Sp. Atk +2 |
| nightmare | usum:103 | before-guard | L | not in this build (USUM) |
| nobleroar | champions:6 sv:21 swsh:13 usum:14 | before-guard | M | Atk -1 Sp. Atk -1 (sound) |
| noretreat | champions:2 sv:2 swsh:1 | before-guard | L | fails while its volatile is up from an earlier turn: not in this build |
| octolock | champions:1 swsh:1 | before-guard | L | not in this build |
| odorsleuth | usum:72 | before-guard | L | not in this build (USUM) |
| playnice | sv:34 swsh:31 usum:38 | before-guard | M | Atk -1 (no protect flag) |
| poisongas | sv:20 swsh:12 usum:18 | before-guard | M | psn on both foes |
| poisonpowder | champions:28 sv:54 swsh:21 usum:60 | before-guard | M | psn (powder) |
| powder | usum:23 | before-guard | L | not in this build (USUM) |
| powershift | champions:0 | before-guard | L | raw stat swap |
| powersplit | champions:8 sv:14 swsh:23 usum:26 | before-guard | L | raw stat average |
| powerswap | champions:21 sv:8 swsh:69 usum:34 | before-guard | L | not in this build |
| powertrick | champions:5 sv:5 swsh:13 usum:22 | before-guard | L | raw stat swap |
| psychoshift | swsh:18 usum:27 | before-guard | L | not in this build |
| psychup | champions:92 sv:241 swsh:216 usum:346 | before-guard | L | copies stages and crit volatiles: not in this build |
| quash | champions:9 sv:15 swsh:26 usum:59 | before-guard | M | the target's queued action gets order 201 and moves last; fails if it has no action left |
| quiverdance | champions:21 sv:33 swsh:8 usum:37 | before-guard | M | Sp. Atk/Sp. Def/Spe +1 |
| recycle | champions:13 sv:22 swsh:90 usum:140 | before-guard | L | not in this build |
| reflecttype | champions:4 sv:8 swsh:12 usum:19 | before-guard | L | type change |
| refresh | usum:141 | before-guard | M | cures the user's psn, tox, par or brn (USUM) |
| roar | champions:105 sv:213 swsh:165 usum:266 | before-guard | S | drags the target out: fails on Suction Cups, Guard Dog, Ingrain, Dynamax, or with no Pokémon to come in |
| rockpolish | champions:9 sv:35 swsh:95 usum:130 | before-guard | M | Spe +2 |
| roleplay | champions:15 sv:14 swsh:97 usum:170 | before-guard | L | as Skill Swap |
| rototiller | usum:27 | before-guard | L | every grounded Grass type: not in this build |
| safeguard | champions:109 sv:71 swsh:240 usum:360 | before-guard | M | side flag: status, confusion and Yawn from other Pokémon blocked (an Infiltrator foe passes); fails while up |
| sandattack | sv:82 swsh:90 usum:122 | before-guard | M | accuracy -1: not stored; the reactions as Sweet Scent |
| scaryface | champions:162 sv:382 swsh:193 usum:167 | before-guard | M | Spe -2 |
| screech | champions:72 sv:119 swsh:169 usum:169 | before-guard | M | Def -2 (sound) |
| sharpen | usum:10 | before-guard | M | Atk +1 |
| shellsmash | champions:8 sv:25 swsh:20 usum:26 | before-guard | M | Def/Sp. Def -1, Atk/Sp. Atk/Spe +2 (White Herb after the move) |
| shelter | champions:1 sv:3 | before-guard | M | Def +2 |
| shiftgear | champions:1 sv:6 swsh:11 usum:10 | before-guard | M | Spe +2 Atk +1 |
| simplebeam | champions:4 sv:6 swsh:22 usum:23 | before-guard | L | as Skill Swap |
| sing | champions:9 sv:28 swsh:47 usum:67 | before-guard | M | slp (sound) |
| sketch | sv:1 usum:1 | before-guard | N | moveset only |
| skillswap | champions:71 sv:133 swsh:104 usum:131 | before-guard | L | ability change: not in this build |
| sleeppowder | champions:26 sv:42 swsh:22 usum:51 | before-guard | M | slp (powder) |
| smokescreen | sv:33 swsh:27 usum:33 | before-guard | M | as Sand Attack |
| snatch | usum:180 | before-guard | L | not in this build (USUM) |
| soak | champions:10 sv:40 swsh:30 usum:30 | before-guard | L | type change |
| speedswap | champions:4 sv:2 swsh:28 usum:6 | before-guard | L | raw Speed swap |
| spicyextract | champions:2 sv:2 | before-guard | M | Atk +2 Def -2 on the target |
| spiderweb | usum:8 | before-guard | N | trap only (USUM) |
| spite | champions:74 sv:158 swsh:130 usum:168 | before-guard | N | PP only |
| spore | champions:0 sv:8 swsh:4 usum:9 | before-guard | M | slp (powder) |
| stockpile | champions:18 sv:61 swsh:41 usum:61 | before-guard | L | layers from earlier turns: not in this build |
| stringshot | champions:25 sv:36 swsh:34 usum:93 | before-guard | M | Spe -2 on both foes |
| stunspore | champions:27 sv:62 swsh:26 usum:62 | before-guard | M | par (powder) |
| supersonic | sv:70 swsh:59 usum:97 | before-guard | M | confusion (sound) |
| swagger | champions:68 sv:80 swsh:652 usum:1009 | before-guard | M | Atk +2, then confusion |
| sweetkiss | champions:24 sv:47 swsh:49 usum:42 | before-guard | M | confusion |
| sweetscent | champions:29 sv:68 swsh:68 usum:94 | before-guard | M | evasion -2 (gen 7 -1) on both foes: not stored; Defiant, Competitive, Mirror Armor, Clear Body and Eject Pack react |
| switcheroo | champions:26 sv:49 swsh:28 usum:42 | before-guard | L | as Trick |
| swordsdance | champions:116 sv:264 swsh:196 usum:288 | before-guard | M | Atk +2 |
| tailglow | sv:3 usum:4 | before-guard | M | Sp. Atk +3 |
| tailwhip | sv:99 swsh:84 usum:112 | before-guard | M | Def -1 on both foes |
| takeheart | sv:3 | before-guard | M | Sp. Atk +1 Sp. Def +1, then cures the user's status |
| tarshot | sv:2 swsh:1 | before-guard | L | Fire weakness: not in this build |
| taunt | champions:135 sv:338 swsh:225 usum:294 | before-guard | M | a later status move (not Z/Max, not Me First) fails at BeforeMove (priority 5); Oblivious, Aroma Veil, Mental Herb |
| tearfullook | champions:13 sv:27 swsh:12 usum:25 | before-guard | M | Atk -1 Sp. Atk -1 (no protect flag) |
| teeterdance | champions:6 sv:22 swsh:24 usum:37 | before-guard | M | confusion on every adjacent Pokémon, its ally included |
| telekinesis | usum:218 | before-guard | L | not in this build (USUM) |
| thunderwave | champions:121 sv:249 swsh:237 usum:319 | before-guard | M | par; ignoreImmunity false: Ground is immune |
| tickle | champions:40 sv:77 swsh:90 usum:99 | before-guard | M | Atk -1 Def -1 |
| tidyup | champions:2 sv:7 | before-guard | L | removes Substitutes and hazards: not in this build |
| topsyturvy | champions:3 sv:3 swsh:3 usum:3 | before-guard | L | not in this build |
| torment | champions:31 sv:44 swsh:137 usum:209 | before-guard | N | no BeforeMove handler: it changes only the next choice |
| toxic | champions:39 sv:96 swsh:643 usum:1014 | before-guard | M | tox, stage 0 (1/16 at this end of turn); a Poison-type user cannot miss (no effect: every move hits) |
| toxicthread | champions:1 sv:3 usum:3 | before-guard | M | Spe -1 (Champions -2), then psn |
| transform | champions:1 sv:3 swsh:2 usum:3 | before-guard | L | not in this build |
| trick | champions:86 sv:176 swsh:142 usum:177 | before-guard | L | item swap: not in this build |
| trickortreat | champions:4 swsh:8 usum:9 | before-guard | L | type change |
| venomdrench | swsh:48 usum:42 | before-guard | M | Atk/Sp. Atk/Spe -1, only on poisoned targets (onHit) |
| victorydance | sv:2 | before-guard | M | Atk/Def/Spe +1 |
| watersport | usum:73 | before-guard | L | not in this build (USUM) |
| whirlwind | champions:37 sv:41 swsh:36 usum:64 | before-guard | S | as Roar (wind: Wind Rider absorbs it) |
| willowisp | champions:75 sv:141 swsh:112 usum:154 | before-guard | M | brn; Flash Fire and Well-Baked Body absorb it in TryHit |
| withdraw | sv:29 swsh:28 usum:26 | before-guard | M | Def +1 |
| wonderroom | champions:52 sv:13 swsh:108 usum:106 | before-guard | L | not in this build |
| workup | sv:34 swsh:211 usum:342 | before-guard | M | Atk +1 Sp. Atk +1 |
| worryseed | champions:18 sv:61 swsh:73 usum:134 | before-guard | L | as Skill Swap |
| yawn | champions:47 sv:89 swsh:74 usum:104 | before-guard | M | drowsy (EotState.yawn = 2): no sleep at this end of turn; fails on a statused or sleep-immune target (onTryHit); E2 volatile `yawn` |
| assist | usum:24 | calling | X | `{Move} is not modelled in 2v2.` |
| copycat | champions:41 sv:70 swsh:45 usum:60 | calling | X | as Assist |
| instruct | champions:1 sv:2 swsh:1 usum:2 | calling | X | `Instruct is not modelled in 2v2.` (presence, as today) |
| mefirst | usum:57 | calling | X | as Assist |
| metronome | sv:146 swsh:69 usum:71 | calling | X | as Assist |
| mirrormove | usum:43 | calling | X | as Assist |
| naturepower | swsh:98 usum:171 | calling | X | as Assist |
| sleeptalk | champions:395 sv:917 swsh:767 usum:1014 | calling | X | as Assist while asleep or Comatose (fails awake) |
| bellydrum | champions:14 sv:40 swsh:47 usum:51 | hp-guard | M | loses floor(maxhp/2), Atk to +6 (Contrary: -6); fails at <= half HP or at +6 |
| clangoroussoul | champions:1 sv:2 swsh:1 | hp-guard | M | loses floor(maxhp*33/100), +1 to all five; fails at hp <= maxhp*33/100 |
| curse | champions:132 sv:283 swsh:296 usum:413 | hp-guard | M | Ghost user: loses floor(maxhp/2) (directDamage: it can faint), its chosen foe cursed (aimed at its ally: a random foe; 1/4 at this end of turn, order 12); other users: Atk +1 Def +1 Spe -1 |
| filletaway | sv:2 | hp-guard | M | loses floor(maxhp/2), Atk/Sp. Atk/Spe +2 (SV) |
| floralhealing | sv:2 swsh:1 usum:2 | hp-guard | M | target heals ceil(baseMaxhp/2) (Grassy Terrain modify(baseMaxhp, 0.667)) |
| healingwish | champions:15 sv:43 swsh:29 usum:30 | hp-guard | M | the user faints (its replacement's heal is the next turn's); fails with no Pokémon to switch in |
| healorder | usum:2 | hp-guard | M | as Recover |
| healpulse | champions:25 sv:37 swsh:42 usum:46 | hp-guard | M | target heals ceil(baseMaxhp/2) (Mega Launcher modify(baseMaxhp, 0.75)) |
| junglehealing | sv:3 swsh:2 | hp-guard | M | user and ally heal modify(maxhp, 0.25), each cured of its status |
| lifedew | champions:21 sv:39 swsh:41 | hp-guard | M | user and ally heal round(baseMaxhp/4) |
| lunarblessing | sv:2 | hp-guard | M | as Jungle Healing |
| lunardance | sv:2 swsh:1 usum:2 | hp-guard | M | as Healing Wish |
| memento | champions:23 sv:81 swsh:46 usum:49 | hp-guard | M | target Atk -2 Sp. Atk -2; the user faints when it hits (no replacement until the turn ends) |
| milkdrink | champions:1 sv:3 swsh:1 usum:4 | hp-guard | M | as Recover (Champions: target adjacentAllyOrSelf) |
| moonlight | champions:6 sv:20 swsh:22 usum:28 | hp-guard | M | modify(maxhp, 0.5; 0.667 sun; 0.25 rain, sand, hail, snow) by effectiveWeather(Umbrella) |
| morningsun | champions:5 sv:19 swsh:29 usum:37 | hp-guard | M | as Moonlight |
| painsplit | champions:72 sv:137 swsh:108 usum:139 | hp-guard | M | both to floor((a + b) / 2), at least 1 (joint HP map); a Dynamaxed Pokémon: `Pain Split with a Dynamaxed Pokémon is not modelled in 2v2.` |
| purify | swsh:1 usum:2 | hp-guard | L | not in this build |
| recover | champions:29 sv:81 swsh:56 usum:76 | hp-guard | M | heals round(baseMaxhp/2) |
| rest | champions:395 sv:915 swsh:769 usum:1008 | hp-guard | M | full HP and asleep with 3 turns (cannot wake this turn), status cured; fails at full HP, when asleep or sleep-immune |
| revivalblessing | champions:1 sv:2 | hp-guard | P | `Revival Blessing is not modelled.` (presence, as today) |
| roost | champions:39 sv:67 swsh:80 usum:146 | hp-guard | C | heals round(baseMaxhp/2); loses Flying until the turn ends: guarded (`Roost removes {Name}'s Flying type: later moves are not modelled.`) when a later damaging move could reach a Flying user; the end of turn reads it (grounded) |
| shedtail | champions:4 sv:4 | hp-guard | S | loses ceil(maxhp/2), then the switch; fails at <= ceil(maxhp/2) HP or with no Pokémon to switch in |
| shoreup | sv:3 swsh:2 usum:3 | hp-guard | M | modify(maxhp, 0.667 in sand, else 0.5) |
| slackoff | champions:10 sv:19 swsh:9 usum:13 | hp-guard | M | as Recover |
| softboiled | champions:0 sv:3 swsh:9 usum:10 | hp-guard | M | as Recover |
| strengthsap | champions:8 sv:21 swsh:13 usum:13 | hp-guard | M | target Atk -1 (fails at -6), user heals the target's Atk with stages, no modifiers (getStat atk, boosted, unmodified; Big Root; Liquid Ooze damages instead) |
| stuffcheeks | champions:4 sv:8 swsh:2 | hp-guard | L | not in this build |
| substitute | champions:395 sv:916 swsh:769 usum:1015 | hp-guard | M | loses floor(maxhp/4), Substitute up: later status moves without bypasssub fail into it; a later damaging hit into it: `Hits on {Name}'s Substitute are not modelled.` |
| swallow | champions:15 sv:54 swsh:38 usum:58 | hp-guard | L | needs Stockpile layers: not in this build |
| synthesis | champions:27 sv:102 swsh:66 usum:128 | hp-guard | M | as Moonlight |
| teatime | champions:2 sv:3 swsh:2 | hp-guard | L | not in this build |
| wish | champions:39 sv:66 swsh:62 usum:93 | hp-guard | M | no HP this turn; E2 outcome `wish` on the slot (heals at the next end of turn) |
| auroraveil | champions:9 sv:14 swsh:25 usum:14 | modelled | X | modelled |
| banefulbunker | champions:1 sv:2 swsh:1 usum:2 | modelled | X | modelled |
| burningbulwark | sv:2 | modelled | X | modelled |
| destinybond | champions:35 sv:52 swsh:56 usum:66 | modelled | M | a foe whose move knocks the user out faints too (onFaint; not a Dynamaxed foe); replaces today's guard; fact `Assumes {Name} did not use Destiny Bond last turn.` |
| detect | champions:41 sv:56 swsh:120 usum:171 | modelled | X | modelled |
| electricterrain | champions:29 sv:103 swsh:40 usum:21 | modelled | X | modelled; now also blocks sleep and Yawn on grounded Pokémon |
| followme | champions:5 sv:23 swsh:21 usum:26 | modelled | X | modelled; now also takes single-target status moves |
| grassyterrain | champions:37 sv:155 swsh:41 usum:64 | modelled | X | modelled; heals at the end of turn |
| gravity | champions:33 sv:128 swsh:95 usum:149 | modelled | X | modelled |
| hail | swsh:176 usum:223 | modelled | X | modelled; damages at the end of turn |
| helpinghand | champions:259 sv:579 swsh:273 usum:296 | modelled | X | modelled |
| kingsshield | champions:2 swsh:2 usum:3 | modelled | X | modelled |
| lightscreen | champions:161 sv:337 swsh:260 usum:356 | modelled | X | modelled |
| mistyterrain | champions:44 sv:94 swsh:45 usum:44 | modelled | X | modelled; now also blocks status, confusion and Yawn on grounded Pokémon |
| obstruct | swsh:1 | modelled | X | modelled |
| protect | champions:395 sv:917 swsh:769 usum:1018 | modelled | X | modelled |
| psychicterrain | champions:32 sv:83 swsh:40 usum:17 | modelled | X | modelled; now also blocks priority status moves from foes into grounded Pokémon |
| quickguard | champions:33 sv:53 swsh:56 usum:63 | modelled | X | modelled; now also blocks priority status moves |
| ragepowder | champions:26 sv:42 swsh:6 usum:37 | modelled | X | modelled; as Follow Me (not from powder-immune users) |
| raindance | champions:294 sv:653 swsh:478 usum:703 | modelled | X | modelled |
| reflect | champions:101 sv:247 swsh:257 usum:323 | modelled | X | modelled |
| sandstorm | champions:88 sv:243 swsh:190 usum:261 | modelled | X | modelled; damages at the end of turn |
| silktrap | sv:2 | modelled | X | modelled |
| snowscape | champions:47 sv:109 | modelled | X | modelled |
| spikyshield | champions:4 sv:12 swsh:2 usum:8 | modelled | X | modelled |
| sunnyday | champions:294 sv:643 swsh:438 usum:702 | modelled | X | modelled |
| tailwind | champions:52 sv:147 swsh:102 usum:193 | modelled | X | modelled |
| trickroom | champions:64 sv:143 swsh:118 usum:157 | modelled | X | modelled |
| wideguard | champions:28 sv:50 swsh:51 usum:73 | modelled | X | modelled; now also blocks spread status moves |
| celebrate | sv:32 swsh:46 usum:44 | no-effect | N | nothing |
| leechseed | champions:30 sv:96 swsh:63 usum:94 | no-effect | M | seeded (Grass immune; fails into a Substitute): drains at THIS end of turn (order 8; Liquid Ooze, Big Root) |
| perishsong | champions:11 sv:46 swsh:24 usum:54 | no-effect | M | perish count on every Pokémon that hears it (Soundproof immune): 3 after this end of turn, no HP |
| spikes | champions:33 sv:75 swsh:38 usum:45 | no-effect | N | hazard; E2 `sides[side].hazards` where it lands (Magic Bounce sends it back) |
| splash | sv:39 swsh:37 usum:50 | no-effect | N | nothing |
| stealthrock | champions:68 sv:196 swsh:143 usum:211 | no-effect | N | as Spikes |
| stickyweb | champions:3 sv:19 swsh:14 usum:17 | no-effect | N | as Spikes |
| toxicspikes | champions:34 sv:63 swsh:41 usum:44 | no-effect | N | as Spikes |
| spotlight | usum:8 | presence | X | `Spotlight is not modelled in 2v2.` (presence, as today) |
| batonpass | champions:79 sv:183 swsh:106 usum:111 | switch | S | switch |
| chillyreception | champions:2 sv:3 | switch | S | snow (fieldMove), then the switch |
| partingshot | champions:11 sv:22 swsh:31 usum:23 | switch | S | Atk -1 Sp. Atk -1 first; no switch when no stage fell (onHit deletes selfSwitch; Mirror Armor keeps it) |
| teleport | sv:13 swsh:49 usum:64 | switch | S | switch (fails with no Pokémon to switch in) |

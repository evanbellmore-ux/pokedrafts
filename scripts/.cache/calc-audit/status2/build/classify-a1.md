# status2 Track A1's classification fragment (SPEC2 §2.2's A1 rows; ADDENDUM2 §2.2)

Read by `gen-status-table.ts` (`| move | kind |` rows; a fragment row wins over status-eot's spec-classify.md). The handler
keys are the generator's own (HANDLERS, FAILS); `app/lib/battle/doubles-abilities.ts` HANDLERS implements each.
22 M and 8 C. A C move is exact under its condition and otherwise gives the narrow reason noted (SPEC2 §2.2, Q5): the eight
ability moves keep `{Move} with Neutralizing Gas is not modelled in 2v2.` with Neutralizing Gas from the turn's start
(doubles-status.ts statusMove); Transform also gives `Transform into a Dynamaxed {Name} is not modelled in 2v2.` (SwSh) and
`Transform with Illusion is not modelled in 2v2.`; an ability's Start or End the turn does not follow gives
`{Ability} starting on {Name} is not modelled in 2v2.` (Supreme Overlord; Forecast on Castform and Flower Gift on Cherrim
until FC lands) or `{Ability} ending on {Name} is not modelled in 2v2.`.

| move | kind |
|---|---|
| acupressure | M |
| psychup | M |
| powerswap | M |
| guardswap | M |
| heartswap | M |
| speedswap | M |
| powersplit | M |
| guardsplit | M |
| powertrick | M |
| powershift | M |
| topsyturvy | M |
| stockpile | M |
| swallow | M |
| tidyup | M |
| noretreat | M |
| autotomize | M |
| minimize | M |
| geomancy | M |
| gearup | M |
| magneticflux | M |
| flowershield | M |
| rototiller | M |
| skillswap | C |
| roleplay | C |
| entrainment | C |
| simplebeam | C |
| worryseed | C |
| gastroacid | C |
| doodle | C |
| transform | C |

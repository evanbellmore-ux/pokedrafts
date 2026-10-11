# status2 classification fragment: Track A2 (types, volatiles, grounding)

SPEC2 §2.2's A2 rows with ADDENDUM2 §2.2 (Electrify and Ion Deluge are M: Q13 modelled). Read by
`gen-status-table.ts` (`| move | kind |` rows; a fragment row wins over status-eot's spec-classify.md). 18 M + 4 C.
The handler and fails keys are the generator's HANDLERS / FAILS (F2 §3); the handlers live in
`app/lib/battle/doubles-typing.ts` HANDLERS.

| move | kind |
|---|---|
| soak | M |
| magicpowder | M |
| forestscurse | M |
| trickortreat | M |
| reflecttype | M |
| conversion | C |
| conversion2 | C |
| camouflage | M |
| electrify | M |
| iondeluge | M |
| tarshot | M |
| foresight | M |
| odorsleuth | M |
| miracleeye | M |
| telekinesis | M |
| embargo | M |
| healblock | M |
| nightmare | M |
| octolock | M |
| attract | C |
| captivate | C |
| powder | M |

Reasons each C move can still give (exact texts, REASONS):

- conversion: `Conversion needs {Name}'s first move.` (no `moves` in the input).
- conversion2: `Conversion 2 needs {Name}'s move from the last turn.` (its target has not moved this turn and `lastMove`
  is absent); `Conversion 2 needs the type of {Name}'s last move.` (that move was a Z-Move, a Max Move, or a move typed as
  it is used: Weather Ball, Terrain Pulse, Judgment, Multi-Attack, Techno Blast, Revelation Dance, Natural Gift, Hidden
  Power, Aura Wheel, Raging Bull, Ivy Cudgel, Tera Blast, Tera Starstorm).
- attract, captivate: `{Move} needs {Name}'s gender.` (a species of both genders with no gender set, and no genderless
  Pokémon in the pair).

# Training tab

`/training` (nav item **Training**, after Calculator): battle a practice opponent on the pinned Pokémon Showdown simulator
(c23d2e94, `[Gen 9 Champions] VGC 2026 Reg M-C`) in your browser. The build spec is
`scripts/.cache/training/design/SPEC.md` with `SPEC-ADDENDUM.md` (the addendum wins where they differ).

## Facts

| Topic | Fact |
|---|---|
| Format | `[Gen 9 Champions] VGC 2026 Reg M-C`: Doubles, level 50, bring 6, pick 4, Species Clause, Item Clause (1 each), no Mythical or Restricted Legendary, Mega Evolution once per battle, no Terastallization, no timer. |
| Rules | The battle, team validation, requests and choice errors are the pinned simulator's own, run in one module worker (`worker/training.worker.ts`). The page never imports the simulator, the turn engine or the AI. |
| Teams | Your league roster or a PokéPaste; the opponent from a drafted roster or a PokéPaste. Choose 6 per side. League members get Training's suggested sets from Smogon 2026-08 VGC Reg M-B usage (moves of every category, item, ability, spread), with Protect added when the species learns it and the item allows it. |
| Set editor | Each of your members (and the opponent's when every "You see" category is open) has an editor: four move pickers over every move the species can legally use (status moves included), item, ability, nature and Stat Points; Showdown's validator reports what is still illegal. `Edit as PokéPaste` exports the six. |
| Information | Two directions, `AI knows` (your team) and `You see` (its team): Stat Points, Natures, Items, Abilities and Moves each open or closed. Default both ways: Champions open team sheets (Stat Points closed). `Perfect information (test)` opens all five and turns on the two test extras: exact HP (of the members seen so far; of all four brought with the second extra) and the brought Pokémon before they enter. The five categories are remembered like any other choice; the two test extras never are. |
| AI | Runs in your browser in its own seat: it reads only its side's log, its own request and your team sheet as `AI knows` allows. It never sees your choice for the turn or the battle's random rolls. Two difficulties: Plays safe, Reads you. Its read for a turn is shown only after that turn resolves, without anything `You see` closes. |
| Trends | `Your trends` (setup, beside the habits count; collapsed by default) states the habits the AI recorded: each action class's share of your actions; Protect when threatened, not threatened and right after a Protect; switching under 33% HP; KO attempts among attacks; targets (the biggest threat, the lower-HP foe, other; left foe, right foe, your partner); the top 3 moves of each Pokémon (6 Pokémon shown, the rest behind a disclosure); the 6 most brought Pokémon and the 3 most common leads; Mega Evolution at the first chance and later. Counts are recency-weighted (×0.9 per battle): percentages from the weighted counts, counts rounded. A share needs 3 actions, turns or battles as the panel shows them (the weighted count rounded, so 2.5 or more; 3 battles weigh 2.71), else "Fewer than 3 …". `KO attempts when a KO is on` is not stated: the habits do not record whether a KO was available. |
| Turn playback | Each resolved turn plays on the board in turn order before your next choice: one step per move, switch (`U-turn: Staraptor switches for Venusaur`), Mega Evolution and, when a card or the field changed there (`Snow ended`), the end of turn. What a Pokémon shows as its own action begins (`Woke up`, `Confused`, `No longer confused`) is on its card in that action's step. A popup floats over the board for 0.9 s: the move's name in large letters in its type colour (a switch, a Mega Evolution or the end of turn as a sentence), its user underneath when the cards do not show it. Then for 2 s the targets are framed in that colour, their HP bars slide from the HP before to after (to the lowest first when a berry brings it back up), and their results float on the cards (`Burned`, `Attack −1`, `Protected`, `Missed`, `No effect`, `Fainted`, `Traced Rough Skin`, `Charging`). Your controls come back after the last step; Skip ends it at once. A turn that starts playing scrolls the board into view when its top is off screen. The steps come from the p1 channel the log reads (your HP exact, the AI's as the percentage it shows); a move's colour follows its user's ability (Pixilate's Hyper Voice is Fairy) only when you know that ability. The live region reads each step once, naming each Pokémon as its card does (with its position when two active ones share a name), then only the next request (the turn's recap too after Skip); prefers-reduced-motion drops the pop-in, fade and slide. Timings: `board/playback.ts`. |
| Battle end | `This battle compared with your usual`: Protect, Switch, Fake Out, KO attempts and Speed control (shares of your actions), the biggest threat targeted, and Mega Evolution at the first and a later chance. This battle's counts are exact: the habits after it minus the habits before it × 0.9 (the model decays at the battle start, then adds the battle's observations, all whole numbers); "Your usual" is the habits before it. Lines without data this battle are left out; no table when the record does not match (cleared meanwhile). |
| Stored | Per browser and account in `localStorage`: the information categories (`pokedrafts:training:info:v1:<user>`), the AI's habits (`pokedrafts:training:habits:v1:<user>`, cleared with `Clear habits`) and whether `Your trends` is open (`pokedrafts:training:trends:v1:<user>`). Battles are not saved; a reload ends the battle (the browser asks first). |

## Files

`app/(app)/training/`:

- `page.tsx` (server, metadata), `TrainingClient.tsx` (screen selection), `BattleScreen.tsx`, `training-session.ts` (module store: the
  worker transport, the setup draft, the battle, storage), `useTrainingSession.ts`, `training.module.css`.
- `setup/`: team sources, Choose 6 rows, the set editor, the information panel, format facts, team resolution (`team-draft.ts`),
  PokéPaste export (`team-export.ts`) and `Your trends` (`habit-trends.ts`, pure: the panel's facts and the battle-end comparison;
  `HabitTrends.tsx`).
- `preview/`: team preview in tap order and the opponent's sheet as `You see` allows.
- `board/`: the board as you can see it (the worker's `BoardView`) and the turn playback (`playback.ts` pure: the queue, the board
  at each beat, the popup, the cards' labels and the live region's sentence; `useTurnPlayback.ts`, `TurnPopup.tsx`, `PlaybackBar.tsx`).
- `actions/`: your turn's controls from the Showdown request, as `PlayerChoice`s (the worker writes choice strings).
- `log/`: the log formatter (`protocol-text.ts`) and the playback's steps (`protocol-steps.ts`), both worker-only; the log, the
  last turn, the AI's read and the live region. `worker/move-type.ts`: a step's move type with its user's ability where you know it.
- `end/`: the result, Rematch, Change teams, Copy log, this battle compared with your usual.
- `model/`: the page/worker contract, including `habits-data.ts` (the habits' data type and parser, shared by `ai/habits.ts` and
  the page). `sim/`, `worker/`, `ai/`, `usage/`: worker-side.

Data: `data/champions/training-usage.json` (Smogon 2026-08 VGC Reg M-B usage: moves of every category, items, spreads,
abilities), loaded only by the worker (`usage/training-usage.ts`). `npm run data:champions:move-usage` writes it beside
`move-usage.json` from the same hash-checked archive; `npm run data:champions:move-usage -- --check` verifies both.

Simulator package: `@pokedrafts/showdown-sim` from `vendor/` (`npm run prepare:showdown-sim` rebuilds it; provenance in
`vendor/showdown-sim.provenance.json`).

Tests: `tests/unit/training-*.test.ts`, `doubles-outcomes.test.ts` and `showdown-sim-package.test.ts` (`npm run test`; they run
as a second vitest group after the other unit tests), and `tests/source/training-format.test.ts`
(`npm run test:battle-data:source`).

Evaluation scripts (`scripts/training/`, Node, write under `scripts/.cache/training/`):

| Command | What it runs |
|---|---|
| `npm run eval:training -- --gates [--scale 1] [--shards 8]` | SPEC §14.2 and addendum gates: win rates against the baselines, self-play, closed and perfect information, status moves, Mega positions (a KO-race position counts the race's move, not only the Mega), legality, budgets, determinism. Battles 2k and 2k + 1 play one team pair with the sides swapped (`scripts/training/lib/teams.ts` `mirroredPair`). One pairing: `-- --pairing safe:maxdamage --battles 100 --pool S,V --info open --shards 1`. Measure decision times with `--shards 1` on an idle machine. |
| `npm run conformance:training -- [--battles 40] [--pools S,V,A]` | Tracker parity, belief-battle equivalence, bridge, splits, choice strings, effect census. |
| `npm run leak:training -- [--battles 40] [--l2 40]` | L1 (nothing hidden reaches the AI; 40 battles per field, 60 for the dice field, so each compares 50 or more decisions) and L2 (nothing "You see" closes reaches the page, checked per member and per read sentence; every fifth battle forfeits on a turn the AI has locked in, and that turn's read and actions must stay in the worker). |
| `npm run belief:training` | Belief calibration under open and closed sheets; also reports how often the truth is the most likely candidate. Spreads the belief cannot tell apart (same nature and Speed points, at most 2 Stat Points apart) count as one. |

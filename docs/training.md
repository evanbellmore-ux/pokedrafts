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
| Turn engine | The AI values each pairing of its candidate turn with yours on the calculator's 2v2 turn engine wherever the bridge (`sim/bridge.ts`) can describe the turn to it (an engine cell: `calculateDoublesOutcomes`, E2, on the first belief world's battle), and on simulator rollouts otherwise, a turn E2 does not estimate included. The status moves the 2v2 turn calculates (the calculator's [2v2](champions-calculator.md#2v2)) are engine cells, Trick, Switcheroo and Ally Switch included. E2's outcomes are after the whole turn when it applies the end of turn (the residuals in Showdown's order), otherwise after the moves with the residual pass (a simulator run of the end of turn) added, and carry each Pokémon's volatiles, sleep turns left and perish count, the hazards that landed and an Ally Switch swap. State from earlier turns comes from public counts only, never from Showdown's hidden counters: the turns lost to sleep (`cant` lines) and whether Rest put it to sleep, the turns lost to freeze, confusion's turns so far (`-activate` lines; Axe Kick's lasts at least 3), bad poison's ticks this stint, the Ally Switch streak (its next use works with 1/3^streak) and a Substitute's HP only while no hit has met it (its maker's quarter; after a hit Showdown shows no number, so the cell is a rollout: `{Name}: its Substitute's HP after a hit is not public.`); from that belief world's battle, Leech Seed's seeder position, a partial trap that still damages (its source, Binding Band, its move), Salt Cure, Aqua Ring, Ingrain, Curse, Syrup Bomb, a Yawn landing now, the perish count, a Wish or Future Sight landing at its position and Cud Chew's Berry; and the last moves, the move sets, whether each side has a Pokémon left to switch in and the weather's turns left. Sleep and freeze are the engine's own BeforeMove: `sim/splits.ts` no longer forks them (only a protect streak). Rollouts instead: Magic Room with one turn left while an active Pokémon holds a Berry, an Orb, Sticky Barb, White Herb, Mental Herb or Booster Energy, which act after its countdown (`Magic Room ending this turn is not modelled.`); any other volatile (Heal Block, Attract, Destiny Bond, Magnet Rise...); a Leech Seed, trap or Syrup Bomb from an ally; a G-Max trap; Ingrain on a Pokémon not grounded otherwise; recharging, or Fake Out after its first turn, while confused; a confused protect user under Gravity with a protect streak. |
| Trends | `Your trends` (setup, beside the habits count; collapsed by default) states the habits the AI recorded: each action class's share of your actions; Protect when threatened, not threatened and right after a Protect; switching under 33% HP; KO attempts among attacks; targets (the biggest threat, the lower-HP foe, other; left foe, right foe, your partner); the top 3 moves of each Pokémon (6 Pokémon shown, the rest behind a disclosure); the 6 most brought Pokémon and the 3 most common leads; Mega Evolution at the first chance and later. The panel shows no definitions: threatened means the AI's estimate of a foe's best attack into it is half its HP or more, and Most brought counts a Pokémon once it entered the battle. Counts are recency-weighted (×0.9 per battle): percentages from the weighted counts, counts rounded. A share needs 3 actions, turns or battles as the panel shows them (the weighted count rounded, so 2.5 or more; 3 battles weigh 2.71), else "Fewer than 3 …". `KO attempts when a KO is on` is not stated: the habits do not record whether a KO was available. |
| Turn playback | Each resolved turn plays on the board in turn order before your next choice: one step per move, switch (`U-turn: Staraptor switches for Venusaur`), Mega Evolution and, when a card or the field changed there (`Snow ended`), the end of turn. What a Pokémon shows as its own action begins (`Woke up`, `Confused`, `No longer confused`) is on its card in that action's step. A popup floats over the board for 0.9 s: the move's name in large letters in its type colour (a switch, a Mega Evolution or the end of turn as a sentence), its user underneath when the cards do not show it. Then for 2 s the targets are framed in that colour, their HP bars slide from the HP before to after (to the lowest first when a berry brings it back up), and their results float on the cards (`Burned`, `Attack −1`, `Protected`, `Missed`, `No effect`, `Fainted`, `Traced Rough Skin`, `Charging`). Your controls come back after the last step; Skip ends it at once. A turn that starts playing scrolls the board into view when its top is off screen. The steps come from the p1 channel the log reads (your HP exact, the AI's as the percentage it shows); a move's colour follows its user's ability (Pixilate's Hyper Voice is Fairy) only when you know that ability. The live region reads each step once, naming each Pokémon as its card does (with its position when two active ones share a name), then only the next request (the turn's recap too after Skip); prefers-reduced-motion drops the pop-in, fade and slide. Timings: `board/playback.ts`. |
| Battle end | `This battle compared with your usual`: Protect, Switch, Fake Out, KO attempts and Speed control (shares of your actions), the biggest threat targeted, and Mega Evolution at the first and a later chance. This battle's counts are exact: the habits after it minus the habits before it × 0.9 (the model decays at the battle start, then adds the battle's observations, all whole numbers); "Your usual" is the habits before it. Lines without data this battle are left out; no table when the record does not match (cleared meanwhile). |
| Stored | Per browser and account in `localStorage`: the information categories (`pokedrafts:training:info:v1:<user>`), the AI's habits (`pokedrafts:training:habits:v1:<user>`, cleared with `Clear habits`) and whether `Your trends` is open (`pokedrafts:training:trends:v1:<user>`). Battles: in IndexedDB, see [Saved battles and replays](#saved-battles-and-replays). A reload ends the battle; `Resume` rebuilds it from its last autosave (the browser asks before leaving only while the battle has none yet). |

## Saved battles and replays

In this browser for now: IndexedDB, one database per account (`pokedrafts:training:battles:v1:<user>`, `anon` signed out), behind
the `BattleStore` interface (`saved/battle-store.ts`: list, get, save, remove, removeAll, export, import). An account store on the
planned `training_battles` table (below) will implement the same interface.

| Topic | Fact |
|---|---|
| Saved | Each battle from its first turn: an autosave as each turn resolves (the unfinished record) and the finished record when it ends, under the same id. Imported files. Up to 100 per account; past that the oldest are removed first (finished ones before an unfinished one). |
| Saved battles list | Setup screen, below Battle, newest first: date, your team vs theirs, result (Won, Lost, Tie, Forfeited, Unfinished), turns; Replay, Export and Delete (Resume and Delete for an unfinished one); Import; Delete all. Deletes ask first; after one the keyboard focus moves to the `Saved battles` heading, and closing a replay gives it back to that battle's Replay button. Import stays focusable while a file is checked (`Checking…`). The newest unfinished battle also shows above the teams as `Unfinished battle` with Resume and Delete. |
| Resume | The worker opens the sealed checkpoint, starts a battle on its seed with the AI's seed base and the habits that battle started from, and replays every choice in order: yours, and each AI job's decides (up to the turn's question, `DecisionProvider.replayTurn`, so the AI's belief and its habits are the ones it had) and choices. The log must hash as the checkpoint's, else `The saved battle did not re-run the same way.` Then the board and your request come back and the battle goes on; earlier turns keep their reads as shown. A checkpoint from another browser or after the site data was cleared: `The saved battle cannot be opened in this browser.` When the stored habits changed after the autosave (another battle, `Clear habits`), the resumed battle does not write them. |
| Replay | Its own screen in `/training`. The worker validates both teams with Showdown's validator, re-runs the battle from the seed and the choice lines (drained after each choice, as the live battle was) and returns the board as each turn began and after the end, built from your channel per that battle's `You see`. When the re-run's log hash equals the saved log's, the board plays it with the battle's turn playback (popup, highlights, HP bars, results): Play and Pause, Previous turn (this turn's start, then the turn before), Next turn (both stay focusable at the ends, `aria-disabled`), the Turn slider (each turn, then End), 1× and 2× (2× halves every beat), the turn's lines and the AI's read (as the battle's `Last turn`: before a turn's steps, the turn that resolved before it; while they play, that turn), and the whole log. Otherwise the fact (`The re-run differs from the saved log from turn 4. The saved log is shown.`) and the saved log alone. |
| What a replay shows | What the battle showed you: your channel's log and steps, each board per `You see` (the AI's HP as the percentage it showed unless that battle used the exact HP test setting), both sides' actions and the AI's reads as they were redacted then. Each replay board equals the board the battle posted at that point (each turn's start, the end): conformance gate 9a and L2 check it, L2 also scans every replay board against the log up to its turn, the AI's HP on every board and step (a percentage unless `You see` had exact HP) and its bench (unrevealed members look alike; brought only under the brought test setting). |
| What a record holds | Both teams' sets as played, the information settings, the difficulty, the seed and both sides' choice lines (to re-run it), the result, the turns and the log as shown. The seed and the choices are stored in the clear only once the battle ended. Until then they are in the sealed checkpoint (AES-GCM 256 with a non-extractable key kept in the worker's own IndexedDB `pokedrafts:training:keys`): the page stores it and hands it back for Resume, never reads it. Checkpoints are sealed one after another, so an older one never replaces a newer one. |
| Export | A finished battle as `training-battle-<date>-<time>.json` (`{ kind: "pokedrafts-training-battle", version: 1, battle }`, without the habits), downloaded on your click. |
| Import | An export file, untrusted: one over 2 MB is refused before it is read; then JSON, nesting (deeper than 24 levels is refused before anything walks it), kind, version (exactly 1; a newer format is refused; older ones go through `migrateSavedBattle`), format, rules (`c23d2e94`) and every field's type (dates within what a Date holds); then the worker's validator checks both teams and the battle is re-run: its log must hash as the file's, and its result and turn count must be the file's. The errors are the facts (`The file is not JSON.`, `Your team: …`, `The file's log does not match a re-run of its battle from turn 3.`, `The file's result does not match a re-run of its battle.`). An accepted file is saved under a new id (`Imported`) and opens in the replay screen. An import's check and a replay can re-run at the same time. Names and labels are text (React escapes them). |
| Storage | Every read and write is guarded. No IndexedDB, or a refused one: `Saved battles are unavailable in this browser.` and the page works without them. A full one: `Storage is full. Turn 4 was not saved for Resume.` or `Storage is full. This battle was not saved.` |

### Record format v1 (`model/saved-battle.ts` `SavedBattleV1`)

| Field | Type | Finished | Unfinished |
|---|---|---|---|
| `version` | `1` | 1 | 1 |
| `id` | string (UUID) | the battle's id | the same id |
| `status` | `"finished"` \| `"unfinished"` | finished | unfinished |
| `source` | `"played"` \| `"imported"` | either | played |
| `format`, `rules` | string | `gen9championsvgc2026regmc`, `c23d2e94` | same |
| `createdAt`, `updatedAt` | ms since 1970 | battle start, last save | same |
| `setup` | `TrainingSetup` | both teams (6 each, sets as played), `info` (`aiKnows`, `youSee`), `difficulty`, `showRead` | same |
| `turn` | integer | the last turn | the turn it resumes at |
| `result` | `{ result: "win" \| "loss" \| "tie"; forfeited }` \| null | set | null |
| `seed` | `"sodium,<32 hex>"` \| null | set | null |
| `inputLog` | string[] \| null | the simulator's choice lines (`>p1 team 1, 2, 3, 4`, `>p2 move 1 2, switch 3`) | null |
| `log` | `LogTurn[]` | every turn: lines, steps, actions, the AI's read as shown | the turns before `turn` |
| `resume` | `{ sealed }` \| null | null | the worker's sealed checkpoint (base64) |
| `habitsBefore`, `habitsAfter` | `HabitsData`, `HabitsRecord` \| null | null | the habits before the battle (its end comparison) and the ones its last turn left (Resume checks them) |
| `order` | number[] \| null | your team order | your team order (Rematch after Resume) |

The list reads a summary per record (id, status, source, dates, both team labels, turn, result, difficulty), stored beside it.
A record of a 10–20 turn battle is 30–60 KB (conformance gate 9 reports the largest).

### Planned database table

```sql
create table public.training_battles (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  version smallint not null default 1,
  status text not null check (status in ('finished', 'unfinished')),
  source text not null check (source in ('played', 'imported')),
  format text not null,
  rules text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null default now(),
  own_label text not null,
  opponent_label text not null,
  difficulty text not null check (difficulty in ('safe', 'reads')),
  turn integer not null check (turn >= 0),
  result text check (result in ('win', 'loss', 'tie')),
  forfeited boolean not null default false,
  seed text,
  input_log text[],
  setup jsonb not null,
  log jsonb not null,
  resume jsonb,
  habits_before jsonb,
  habits_after jsonb,
  team_order smallint[],
  check ((status = 'finished') = (seed is not null and input_log is not null and result is not null)),
  check (octet_length(log::text) + octet_length(setup::text) <= 2097152)
);
create index training_battles_user_updated on public.training_battles (user_id, updated_at desc);
alter table public.training_battles enable row level security;
create policy training_battles_select on public.training_battles for select to authenticated using (auth.uid() = user_id);
create policy training_battles_insert on public.training_battles for insert to authenticated with check (auth.uid() = user_id);
create policy training_battles_update on public.training_battles for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy training_battles_delete on public.training_battles for delete to authenticated using (auth.uid() = user_id);
```

The list selects the summary columns (`id`, `status`, `source`, `created_at`, `updated_at`, `own_label`, `opponent_label`,
`difficulty`, `turn`, `result`, `forfeited`) as the IndexedDB `summaries` store does; `get` reads the row; the 100-row cap moves
to the store's save (or a trigger).

Left for the database version: the account `BattleStore` over this table; moving this browser's saved battles into the
account once; Resume on another device (the checkpoint is sealed with this browser's key, so an unfinished battle resumes only
here: the server would hold the key and unseal only for the worker); sharing a replay by link (the export file shares one now).

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
- `saved/`: the `BattleStore` (`battle-store.ts`: `browserBattleStore` on IndexedDB, `memoryBattleStore` for tests), the Saved battles
  list and the Resume prompt (`SavedBattles.tsx`), the export download (`download.ts`). `replay/`: the replay screen
  (`ReplayScreen.tsx`), its playback (`replay-playback.ts` pure: the turns, the board at each beat, Previous / Next / the slider;
  `useReplayPlayback.ts`). `model/saved-battle.ts`: the record format, the export file, the import checks, the log hash.
  `worker/sealer.ts`: the checkpoint's AES-GCM seal (worker-side).
- `model/`: the page/worker contract, including `habits-data.ts` (the habits' data type and parser, shared by `ai/habits.ts` and
  the page). `sim/`, `worker/`, `ai/`, `usage/`: worker-side.

Data: `data/champions/training-usage.json` (Smogon 2026-08 VGC Reg M-B usage: moves of every category, items, spreads,
abilities), loaded only by the worker (`usage/training-usage.ts`). `npm run data:champions:move-usage` writes it beside
`move-usage.json` from the same hash-checked archive; `npm run data:champions:move-usage -- --check` verifies both.

Simulator package: `@pokedrafts/showdown-sim` from `vendor/` (`npm run prepare:showdown-sim` rebuilds it; provenance in
`vendor/showdown-sim.provenance.json`).

Tests: `tests/unit/training-*.test.ts`, `doubles-outcomes.test.ts` and `showdown-sim-package.test.ts` (`npm run test`; they run
as a second vitest group after the other unit tests), and `tests/source/training-format.test.ts`
(`npm run test:battle-data:source`). Saved battles: `training-saved.test.ts` (record format, import checks, the store on the
in-memory adapter, the page store's autosave, Resume, replay and import flows), `training-saved-worker.test.ts` (re-run and
Resume determinism, sealed checkpoints, the validator before a re-run), `training-saved-ui.test.ts` and
`training-replay-screen.test.ts` (the list, the Resume prompt and the replay screen, server render and the fake DOM, keyboard
focus included), `training-saved-idb.test.ts` (the IndexedDB adapter on a scripted factory: blocked, refused, full, another
tab's upgrade) and `training-saved-flow.test.ts` (save, list, replay, export, import, Resume after a reload and delete on the
page store with the real worker loop).

Evaluation scripts (`scripts/training/`, Node, write under `scripts/.cache/training/`):

| Command | What it runs |
|---|---|
| `npm run eval:training -- --gates [--scale 1] [--shards 8]` | SPEC §14.2 and addendum gates: win rates against the baselines, self-play, closed and perfect information, status moves, Mega positions (a KO-race position counts the race's move, not only the Mega), legality, budgets, determinism. Battles 2k and 2k + 1 play one team pair with the sides swapped (`scripts/training/lib/teams.ts` `mirroredPair`). One pairing: `-- --pairing safe:maxdamage --battles 100 --pool S,V --info open --shards 1`. Measure decision times with `--shards 1` on an idle machine. |
| `npm run conformance:training -- [--battles 40] [--pools S,V,A] [--eot 10] [--saved 30]` | Tracker parity (Wish and Future Sight read from Showdown's slot conditions too), belief-battle equivalence, bridge, splits, choice strings, effect census. `--eot` more battles in each mode play pool E (`tests/fixtures/training-teams.ts` E01 against E02: Ally Switch, Wish, Trick, Switcheroo, Leech Seed, Ingrain, Big Root, Salt Cure, Syrup Bomb, Aqua Ring, Curse, Yawn, Substitute, Perish Song, Shed Tail, Baton Pass, Future Sight, a Binding Band Fire Spin), which every gate counts. Gate 4b reads Showdown's HP after the whole turn for an engine cell whose every world applied the end of turn (otherwise as the residual starts), following each Pokémon from the slot it started in, so an Ally Switch swap is read as E2 keys it; report rows 4c (the engine cells with the end of turn applied, and the decisions' cells by method) and 4d (the engine cells carrying each carried field, and the clean samples with an Ally Switch swap, a Trick or Switcheroo, a Substitute made or hit). 9. saved battles: `--saved` engine battles (Plays safe and Reads you alternate, information settings rotate, every fifth forfeits) re-run from seed and choices with a log hash, result and boards (each turn's start, the end) equal to the original's, and resumed from their middle autosave equal to uninterrupted play (log, reads, choices, seed, habits). |
| `npm run leak:training -- [--battles 40] [--l2 40]` | L1 (nothing hidden reaches the AI; 40 battles per field, 60 for the dice and dice-eot fields, so each compares 50 or more decisions; dice redraws the hidden sleep, confusion and Champions freeze turns, a partial trap's turns left and a Substitute's HP, and dice-eot does the same with pool E's E01 against E02, E02, V02, V04 and A08; each compared decision also compares a hash of the engine inputs the AI's services bridge for up to four cells that need no prelude: carried state, last moves, positions, Substitute HP) and L2 (nothing "You see" closes reaches the page, checked per member and per read sentence; every fifth battle forfeits on a turn the AI has locked in, and that turn's read and actions must stay in the worker). L2 also checks the AI's HP on every board and step (a percentage) and its bench (unrevealed members alike), re-runs every battle as its replay, scans each turn's board against the log up to it and requires each replay board to equal the board the battle posted then, resumes every fourth battle from its middle checkpoint and scans what the rebuilt battle posts, and checks every checkpoint leaves the worker sealed. |
| `npm run belief:training` | Belief calibration under open and closed sheets; also reports how often the truth is the most likely candidate. Spreads the belief cannot tell apart (same nature and Speed points, at most 2 Stat Points apart) count as one. |

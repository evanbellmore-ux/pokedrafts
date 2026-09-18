# Pokémon Champions calculator

The signed-in `/calculator` route compares one attacking build against one defending build. It ranks the attacker's resolved Champions learnset, not just four equipped moves. It is a damage calculator, not a battle simulator or a regulation/team-legality validator.

## Using the calculator

- Open **Calculator** in the app navigation. Default matchup: Charizard versus Blastoise, Doubles, no training investment, full HP. The active Pokémon, types and current/max HP appear first; no move is selected automatically.
- **Choose a move** using its labelled selection control, then choose **Low**, **Average** or **High** under **Damage roll**. Average is selected initially. When a safe preview is available, the defender's large HP number and health bar show HP after that chosen damage; actual current HP stays visible underneath. The summary retains the full damage range and the engine's all-roll one-use KO chance. Selecting a move or roll never applies damage to either build.
- **Low** uses minimum damage and leaves the most HP; **High** uses maximum damage and leaves the least. **Average** uses the mean of all 16 damage rolls (including repeated values), rounded once to whole HP. Fixed damage is the same for all choices. The roll choice survives move/build/roster changes and Swap; Reset or reloading returns it to Average.
- Use **Change Pokémon** at the top to focus the active (or first available) roster shortcut on desktop. If no shortcut is available, it opens the manual selector; on smaller screens it opens the existing roster/manual selector inside build settings. **Edit HP** always opens and focuses the build's HP input. Blank current HP means full HP; invalid input pauses results instead of retaining stale damage. The numerical health summary remains visible while browsing on viewports at least 800px tall; shorter screens use normal scrolling.
- Use **Teams** to open **League and opponent** and choose an opponent. At desktop widths of 1280px and above, vertical team lists flank the entire calculator, aligned with its heading: the attacker's team on the left and the defender's on the right. Each Pokémon is a full-width shortcut with a sprite and Active indicator. Below 1280px, shortcuts stay in **Pokémon and build settings**. Click a roster Pokémon to make it active. Loading a league or opponent never overwrites the current builds.
- Expand **Change attacker/defender Pokémon** for manual species/form selection. Selecting another Pokémon manually resets its build. Mega forms select and lock their required stone. Each panel's **Build settings** disclosure contains nature, available ability/item, status, Stat Points and stages.
- **Field settings** opens the initially collapsed **Field conditions**: choose Singles/Doubles, weather/terrain, shared effects, screens, Helping Hand and critical hits. A compact active-field summary stays above the move list. Weather/terrain are explicit state, not automatically set by entry abilities. Do not apply Intimidate manually and through its entry checkbox simultaneously.
- Moves are sorted by descending minimum damage, then maximum damage, then name. Search/filter/sort without changing the selected move or its current preview. **Details** holds base power, accuracy, reasons, assumptions and rolls. All learnset entries remain accounted for, including statuses and unsupported moves.
- Selecting a variable-hit move that needs a hit count opens its existing editor without changing your filters. **Set hits**, **Show move**, or **Show selected move** can explicitly reveal the selected row even when filtered out; no second hit-count editor is created.
- **Swap** exchanges builds, roster shortcuts and side conditions, preserves shared field conditions and clears move selection/hit counts. **Reset** restores the initial matchup and clears session prep, while retaining your league/opponent choices. Selection also clears on another roster activation, manual species change, account change, and league/opponent/provenance changes; normal build/field edits and unchanged refreshes retain it.

League, Pokémon/build, field and coverage sections start collapsed. Desktop team shortcuts remain visible outside those disclosures. The center and build editors stay mounted when the viewport changes; only the roster pickers relocate, preserving unfinished input, session edits and the selected damage roll. A focused roster shortcut keeps focus when it moves; other controls do not trigger autofocus. Collapsing a section never resets it. Errors remain visible by the move list with **Fix settings** or **Retry calculator**, and settings summaries flag errors even while closed. Team-loading failures have a separate retry path and do not disable manual calculations.

Champions uses level **50** and **Stat Points**, not conventional EV/IV inputs: 0–32 per stat, at most 66 total. Training stats are:

```text
HP = base + points + 75                 (base-HP-1 exception preserved)
Other = floor((base + points + 20) × nature)
Nature = 1.1, 0.9 or 1
```

The table displays training stats before in-battle stages, abilities and items. Only the adapter maps Stat Points into the engine parameter named `evs`; there is no EV conversion.

## League matchup preparation

The **League** selector reads only memberships belonging to the verified signed-in account, using the existing authenticated Supabase client and row-level security. The first accessible league is selected by name/ID order. The **Opponent** selector contains other members of that league, including those without a finalized roster; no opponent is automatically chosen.

Team lists use current `drafted_teams`, not historical draft picks. This includes free-agent changes after draft completion. Incomplete drafts, missing/empty rosters, no opponents, no memberships and read errors have separate explanations. **Refresh teams** rechecks membership and current rosters; this is not a live-draft or realtime subscription. Loading/errors do not disable manual calculations. Sign-out/account replacement clears the previous account's roster selections and prep.

- **Click-only activation:** Charizard/Blastoise and manually edited builds stay active until you click a roster Pokémon. Changing league/opponent detaches incompatible roster provenance and labels the retained build **Manual** rather than falsely assigning it to the new team.
- **Species-only defaults:** roster data has no saved nature, ability, item, training allocation, HP or status. A first click uses Serious nature, a default available ability, zero Stat Points/stages, full HP, healthy status and any required Mega Stone. These are editable assumptions, not a discovered opponent set. Roster pricing/tier never populates combat stats.
- **Session prep:** edits are remembered when you click away and return to an entry. Cache identity includes league, member, roster/acquisition identity and exact Champions species, so similarly named Pokémon do not share builds accidentally. The cache is memory-only and disappears on leaving/reloading the page, changing accounts or Reset. Invalid numeric values remain invalid; the exact spelling of invalid text is not saved when leaving an entry.
- **Direction and field effects:** Swap moves both roster shortcuts and ownership labels with the builds, so your team can be the defender on the right when checking incoming damage. Field/side conditions are not cached per roster Pokémon. A different roster selection clears move selection and hit counts but retains field settings and result filters; re-clicking the active entry is a no-op.
- **Refresh and Reset:** unchanged entries retain prep after Refresh; removed/replaced or ambiguously duplicated entries lose their cached association. Reset keeps dropdown choices, restores your shortcuts to the left, clears all cached builds/provenance, and restores Charizard versus Blastoise with the default field.

Roster names are league pool text, not guaranteed canonical Pokémon IDs. Resolution accepts only complete pinned-catalog identities or explicit equivalent aliases (for example, Mega Charizard X), preserving gender and form distinctions. It never fuzzy-matches, strips form qualifiers, substitutes a base species, or consults the general Pokédex/Pool Builder pipeline. Unknown or ambiguous entries remain visible with a manual-selection explanation. Exact catalog forms with known coverage gaps remain selectable for inspection, but existing validation pauses unsupported damage. Some leagues contain Pokémon outside this Champions snapshot; roster membership does not make them supported or establish team/regulation legality.

Desktop cards reuse the app's decorative sprites, including their loading/error fallback. Sprite lookup does not resolve Champions identities or change whether an entry is selectable or supported.

League navigation and Refresh perform authenticated reads. Selecting/editing builds and calculating damage remain local; no roster, team or battle build is written to the database or browser storage.

## Field effects

All controls describe **already-active effects**, not the moves that set them or their remaining turns. The five shared-effect toggles default off, survive **Swap**, and clear on **Reset**. Existing side conditions travel with their Pokémon.

- **Sun / Rain / Sand / Snow:** choose one weather at a time. Sun/Rain modify Fire and Water damage; Sand boosts Rock-type Special Defense and Snow boosts Ice-type Defense. Residual weather damage is not included.
- **Helping Hand:** enable on the attacker's side for its outgoing attack. Defender-side Helping Hand is retained for Swap but does not boost incoming damage.
- **Reflect / Light Screen / Aurora Veil:** enable on the defender's side to reduce incoming damage. Singles/Doubles scaling and critical-hit bypass are applied. Veil does not stack with the other screens; an already-active Veil can remain selected without Snow.
- **Gravity:** grounds airborne Pokémon for Ground attacks and terrain. Gravity-prohibited damaging moves, such as Fly and High Jump Kick, report an explained zero rather than the engine's otherwise positive range. Grav Apple receives its power increase. Displayed accuracy stays the catalog value; Gravity's accuracy changes and hit probabilities are not simulated.
- **Trick Room:** tracks the shared condition without changing actual Speed stats. Ordinary damage, Electro Ball and Gyro Ball continue using actual effective Speed. Full turn order, priority interactions and speed ties are not simulated. Payback still needs context. Analytic under Trick Room is withheld unless its explicit **target switches before this attack** condition is selected; that checkbox is not a blanket ability on/off switch.
- **Wonder Room:** swaps unboosted Defense and Special Defense; stages remain attached to their original stat. **Body Press under Wonder Room is unsupported** because the pinned engine applies the wrong attacking defensive stages. Other verified damage remains available.
- **Magic Room:** suppresses held-item effects without removing the item or changing the selected Mega form. Item-based Speed changes also disappear. Suppressed Focus Sash/Focus Band do not block the KO calculation, while effective Sturdy still applies unless bypassed. **Acrobatics while holding an item under Magic Room is unsupported** because the engine incorrectly treats a suppressed item as absent; itemless Acrobatics remains available.
- **Additional Fairy Aura on the field:** represents another active Pokémon's aura and boosts Fairy-type attacks on either side, including attacks converted to Fairy. It does not stack with Fairy Aura already supplied by the selected attacker or defender. Leaving the toggle off does not disable their own Fairy Aura ability.

Active shared effects are also explained in calculated move details. Engine/data pins and availability are unchanged; these controls do not add unverified aura variants or a full battle simulator.

## Result semantics and limitations

- Damage is uncapped potential HP damage, with percentages of the defender's **maximum HP**. A one-use KO chance uses **current HP**, conditional on the move connecting. It does not multiply by accuracy or include end-of-turn damage, healing, hazards or future turns.
- The top **Defender HP remaining** number and meter use `max(0, currentHP − selectedDamage)`, from the latest unfiltered result and only if the move connects. The meter's scale remains maximum HP, not current HP. Low/High select the minimum/maximum damage; Average selects `round(sum(rolls) / 16)` including duplicate rolls, not the midpoint of the two bounds. The chosen damage is rounded before subtraction and overkill clamping; this is HP after mean damage, not the mean of separately clamped HP outcomes, and need not be an attainable individual roll. Builds must be valid, bounds must be consistent nonnegative integers, and rolls must be a complete fixed/flat distribution. Explicit HP of zero is invalid input, not full HP; a projected zero is allowed but is not a simulated faint or a replacement KO probability.
- Nonzero HP previews are conservatively withheld for selected Focus Sash, Focus Band or Sturdy, multihit/unresolved hit counts, nested/incomplete rolls and unavailable KO semantics. This remains conservative even if an item/ability would be suppressed or bypassed; the UI does not duplicate the engine's effective survival rules. Valid raw damage and the engine's KO result are retained (for example, 138–164 damage versus 155 HP with Focus Sash still has a 0% one-use KO result and no HP preview). Proven calculated zero damage retains current HP, even with survival selections; unknown/status/unsupported damage never becomes zero.
- Selecting a move or roll does not alter input HP or build-cache entries, accumulate damage, or change the engine's all-roll KO probability. Attacker HP remains its baseline; recoil, drain, healing, retaliation, secondary effects and later turns are not simulated. Loading, calculator errors, invalid settings and missing/unsupported results immediately remove the numerical projection instead of showing a last-valid estimate. The defender meter falls back to actual current HP when that build is valid; invalid builds have no HP meter.
- Numeric results assume the attack is executed successfully except for explicitly checked failures/immunities. Per-move details state conditions such as Sucker Punch succeeding, pre-hit Special Attack increases, and first-turn-only attacks. Accuracy shown is the catalog value, not a calculated hit probability.
- Single-hit KO probabilities use the complete fixed or 16-roll distribution. Full-HP Focus Sash and effective Sturdy prevent a single-hit KO. Focus Band and multi-hit KO probabilities are not estimated.
- Variable multi-hit moves require an explicit hit count unless Skill Link fixes it. Damage assumes every selected hit completes. Mid-move healing, retaliation and attacker fainting are not simulated; nested engine roll groups are retained rather than flattened into a probability distribution.
- History-dependent moves such as Rage Fist, Beat Up and Last Respects get **Needs context**, not guessed damage. Rivalry needs genders; Supreme Overlord needs fainted-party history. Neither is silently assigned a convenient default.
- Protean/Libero require the visible **unused since switch-in, unchanged typing** assumption. Clearing that condition suspends calculations: previously changed typing is not modeled. Other arbitrary type changes, ability replacements, item consumption histories and unexposed ally effects are outside v1.
- Aegislash with Stance Change attacks using verified Blade Forme stats. Select Mimikyu-Busted for attacks after Disguise has broken; intact Disguise is not simulated. Select other battle states directly rather than assuming transformation timing.
- Unsupported special-damage mechanics and one-target Doubles Expanding Force on Psychic Terrain are explicitly withheld. Fling's item eligibility/consumption is not verified. Source or engine data gaps remain visible instead of being silently mapped to another Pokémon/move.
- The adapter compensates for verified pinned-engine gaps: Gale Wings priority is supplied before priority-immunity checks, effective Damp prevents explosive moves, and Gravity blocks prohibited attacks. The field-specific unsupported cases above are withheld rather than patched with guessed damage. The vendored engine's battle source is unchanged.

This is a pinned snapshot, not a claim that every current game mechanic or ranked ruleset is supported. Catalog coverage reports **data compatibility**, not exhaustive mechanics verification.

## Engine and data provenance

| Source | Pin |
| --- | --- |
| `smogon/damage-calc` | `e7fd7e59f3eef7ea42fba3c8b83261cb4a14109d` |
| `smogon/pokemon-showdown` | `c23d2e942c9c0daadb13a7162a385bf78e3c9353` |
| Local `@smogon/calc` package | `0.11.0-champions.e7fd7e59.1` |

Published `@smogon/calc@0.11.0` does **not** support Champions. The dependency is the checked-in `vendor/smogon-calc-0.11.0-champions.e7fd7e59.1.tgz`, built from upstream's `calc/` subpackage. Generation `0` dispatches to Champions mechanics, not generic Generation 9. The species' introduction generation in the Pool Builder dataset is unrelated.

`vendor/smogon-calc.provenance.json` records source/archive hashes, compiler version and the sole package compatibility change: disabling an unused legacy script-tag export capture that recurses with TypeScript 5 CommonJS export hoisting. No battle data or formulas are patched in the package. MIT licenses are retained in `vendor/` and `data/champions/`.

The generator resolves `Dex.mod('champions')` offline, including form/learnset inheritance and availability. Each contributing learnset must have explicit Champions provenance; a `9M` marker alone is not enough. It never substitutes unrestricted Gen 9 movepools. Showdown is a build-time source and is not shipped as a simulator in the browser.

The current catalog has **382 species/forms/states, 515 moves, 216 assigned abilities and 166 items**; its species contain **23,176 proven learnset entries**. Known data gaps include 24 exact cosmetic form names absent from the engine, Lucario-Mega-Z's contradictory Aura Guard availability, optional Battle Bond, Pound and Growth's type mismatch. Per-entry reasons and source metadata are in `data/champions/catalog.json` and `manifest.json`.

## Maintenance and checks

Ordinary install, unit tests and production builds use the checked-in tarball/catalog and need no upstream download. Calculations and build edits make no network/database calls; optional league shortcuts use the existing authenticated membership/current-roster reads. Existing app authentication still applies; no calculator migration or seed is required.

```sh
npm run check
npm run build

# Explicit maintenance only; source downloads are pinned and SHA-256 checked.
npm run prepare:champions-engine
npm run data:champions
npm run data:champions -- --check
```

Verified upstream extractions and temporary compiler output live under ignored `node_modules/.cache/champions/`. After intentionally changing an engine pin/package version, reinstall its local dependency, regenerate the catalog, and rerun all gates. Review newly exposed ability/move mechanics instead of treating engine name presence as proof of support. Update independent reference fixtures only after checking the new upstream Dex directly.

Unit suites cover engine arithmetic/dispatch, strict build validation, complete learnset classification, source provenance/coverage, conditional mechanics, KO semantics, repeatability and UI helpers/markup. Signed-in browser checks are still required for interactive behavior and responsive/theme/accessibility verification; these are not replaced by unit tests.

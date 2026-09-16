# Pokémon Champions calculator

The signed-in `/calculator` route compares one attacking build against one defending build. It ranks the attacker's resolved Champions learnset, not just four equipped moves. It is a damage calculator, not a battle simulator or a regulation/team-legality validator.

## Using the calculator

- Open **Calculator** in the app navigation. Default matchup: Charizard versus Blastoise, Doubles, no training investment, full HP.
- Expand **Change attacker/defender Pokémon** to search species and forms. Selecting another Pokémon resets its build. Mega forms select and lock their required stone.
- Set nature, available ability/item, status, Stat Points, stages and current HP. Blank current HP means full HP; invalid input pauses results instead of retaining stale damage.
- **Field conditions** starts expanded: choose Singles/Doubles, weather/terrain, shared effects, screens, Helping Hand and critical hits. Weather/terrain are explicit state, not automatically set by entry abilities. Do not apply Intimidate manually and through its entry checkbox simultaneously.
- Moves are sorted by descending minimum damage, then maximum damage, then name. Search, filter, inspect details or choose a hit count. All learnset entries remain accounted for, including statuses and unsupported moves.
- **Swap** exchanges builds and their side conditions, preserves shared field conditions and clears move hit counts. **Reset** restores the initial matchup.

Champions uses level **50** and **Stat Points**, not conventional EV/IV inputs: 0–32 per stat, at most 66 total. Training stats are:

```text
HP = base + points + 75                 (base-HP-1 exception preserved)
Other = floor((base + points + 20) × nature)
Nature = 1.1, 0.9 or 1
```

The table displays training stats before in-battle stages, abilities and items. Only the adapter maps Stat Points into the engine parameter named `evs`; there is no EV conversion.

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

Ordinary install, unit tests and production builds use the checked-in tarball/catalog and need no upstream download. Calculations and edits make no network/database calls. Existing app authentication still applies; no calculator migration or seed is required.

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

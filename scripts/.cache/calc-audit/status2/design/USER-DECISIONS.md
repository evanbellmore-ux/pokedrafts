# User decisions on SPEC2 §11 (2026-10-10)

Asked and answered by the user:

- **Q1 Switch-outs: model the replacement in the calculator AND Training** (SPEC2's recommended "R"): a bench per side in the
  2v2 calculator (from the team/roster the Pokémon came from), a replacement pick per Pokémon that can switch out (default:
  the first bench Pokémon, stated as a fact), hazard controls; Training uses its real bench. Wave 2 as SPEC2 §8.5.
- **Q2 Earlier-turn inputs: "those plus more"** — the three compact controls (Stockpile layers, Last move, Item used earlier)
  AND the alternative's extra controls: type controls (Type, Second type, Added type), Infatuated by, Heal Block turns left,
  accuracy and evasion stages, Berry locked (Berserk / Anger Shell), and Mist / Lucky Chant / Mud Sport / Water Sport toggles.
  Plus any further earlier-turn input that the Tier 2 guards below need to be exact (design it in the same compact style).
- **Q6 The other census guards (SPEC2 §2.3 "Kept … Tier 2, 56 entries"): include them in THIS build** — model each one
  exactly, or keep it only with a narrow, exact reason and a written justification (e.g. the budgets "Too many cases to
  follow." and engine errors stay). Exception: Q5 below.
- **Q5 Neutralizing Gas with the eight ability-changing moves, and Neutralizing Gas ending: LATER** (keep
  "{Move} with Neutralizing Gas is not modelled in 2v2." and "Neutralizing Gas ending is not modelled in 2v2." for a
  follow-up).

Taken by the orchestrator with SPEC2's recommended defaults (not asked; consistent with the house rules — never a guessed
number):

- **Q3 Last move default:** Unknown — Disable, Encore and Conversion 2 keep "{Move} needs {Name}'s move from the last turn."
  until a move is picked.
- **Q4 Item used earlier default:** Unknown — Recycle / Harvest keep their reasons until the control is set.
- **Q7 Training AI weights:** no new weights; the engine reads the new states next turn.
- **Q8 Imposter in the calculator:** transformed into the foe across from it as both entered (the 1v1's rules), stated as a fact.
- **Q9 Training's replacement pick for the player:** the rollouts' rule (the healthiest bench Pokémon), as today.
- **Q10 Attract / Captivate with no gender set on a two-gender species:** not estimated, "{Move} needs {Name}'s gender."
  (the gender control already exists in Build settings).
- **Q11 Conversion's first move slot:** the first quick move, with "Assumes {Move} is {Name}'s first move."
- **Q12 Once-a-battle abilities gained mid-turn:** modelled, with "Assumes {Name} has not had {Ability} before in this battle."
- **Q13 Electrify / Ion Deluge on a self-typing move (Weather Ball and kin), a Z-Move or a Max Move:** since the user chose to
  include the remaining guards (Q6), model these too where exact; otherwise the narrow reason "{Move} with Electrify is not
  modelled in 2v2." stays with a justification.

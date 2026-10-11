// status-eot review regression cases (build/FINAL.md): the four review lenses' oracle cases (review/status-move, review/
// eot-training, review/track-e) and the fixers' and verifiers' cases (fix-engine, verify-engine, build/fix-eot-cases.ts,
// build/verify-eot-probes), each as a permanent case of the oracle set once it agrees with pinned Showdown c23d2e94.
// The case definitions stay in their folders; this file renames them so every id is unique in the corpus (the status and
// end-of-turn lenses both used RV01...), states the reason of a guarded turn (the moves compared, then the reason) and
// leaves out the few that cannot agree, each with its fact reason.
//
// Ids: RS-<id> review/status-move, RT-<id> review/eot-training, RE<n> review/track-e (unchanged), FE-<id> fix-engine,
// VE-<id> verify-engine (unchanged), FT-<id> build/fix-eot-cases.ts, VT-<id> build/verify-eot-probes, FN<n> build/final-cases.ts
// (the final gate's own integration fixes).
import type { Case } from "./case-types";
import { REVIEW_CASES as STATUS_LENS } from "../../status-eot/review/status-move/cases";
import { REVIEW_CASES as EOT_LENS, TEXT_CASES as EOT_LENS_TEXTS } from "../../status-eot/review/eot-training/cases";
import { REVIEW_CASES as TRACK_E_LENS } from "../../status-eot/review/track-e/cases";
import { FIX_CASES as FIX_ENGINE } from "../../status-eot/fix-engine/cases";
import { VERIFY_CASES as VERIFY_ENGINE_1 } from "../../status-eot/verify-engine/cases";
import { VERIFY_CASES_2 as VERIFY_ENGINE_2 } from "../../status-eot/verify-engine/cases2";
import { VERIFY_CASES_3 as VERIFY_ENGINE_3 } from "../../status-eot/verify-engine/cases3";
import { VERIFY_CASES_4 as VERIFY_ENGINE_4 } from "../../status-eot/verify-engine/cases4";
import { FIX_CASES as FIX_EOT } from "../../status-eot/build/fix-eot-cases";
import { VERIFY_CASES as VERIFY_EOT, VERIFY_TEXTS as VERIFY_EOT_TEXTS } from "../../status-eot/build/verify-eot-probes/cases";
import { FINAL_CASES } from "../../status-eot/build/final-cases";

const tagged = (prefix: string, cases: Case[]) => cases.map((c) => ({ ...c, id: `${prefix}${c.id}` }));

/** Every candidate, renamed. */
const CANDIDATES: Case[] = [
  ...tagged("RS-", STATUS_LENS),
  ...tagged("RT-", [...EOT_LENS, ...EOT_LENS_TEXTS]),
  ...tagged("", TRACK_E_LENS),
  ...tagged("FE-", FIX_ENGINE),
  ...tagged("", [...VERIFY_ENGINE_1, ...VERIFY_ENGINE_2, ...VERIFY_ENGINE_3, ...VERIFY_ENGINE_4]),
  ...tagged("FT-", FIX_EOT),
  ...tagged("VT-", [...VERIFY_EOT, ...VERIFY_EOT_TEXTS]),
  ...tagged("", FINAL_CASES),
];

/**
 * A guarded turn: the app's exact reason. `notEstimated`: the whole turn (no oracle run; the reason and start rows are
 * checked). `endNotEstimated`: the moves are compared against the oracle, then the end-of-turn reason.
 */
export const REVIEW_REASONS: Record<string, Pick<Case, "notEstimated" | "endNotEstimated">> = {
  // status H1: the end of turn follows the Berserk / Anger Shell lock now (FINAL: doubles-eot.ts updateSlot, unlock), so the
  // verifier's end-of-turn guard is no longer expected; the oracle's after-turn values are compared.
  "VE-H1-6": { endNotEstimated: undefined },
  "VE-H1-C2": { endNotEstimated: undefined },
  // status H2: Eject Pack after an accuracy drop switches its holder out mid-turn (the oracle stops at the switch request).
  "RS-RV03": { notEstimated: "Snorlax switches out: the replacement is not known." },
  "RS-RV03b": { notEstimated: "Snorlax switches out: the replacement is not known." },
  "RS-RV17b": { notEstimated: "Snorlax switches out: the replacement is not known." },
  // status H3: Defiant's rise after Charm, copied by Opportunist.
  "RS-RV05": { notEstimated: "Opportunist copying a stat rise is not modelled in 2v2." },
  // eot-training: Psychic Noise before a Leech Seed seeder's drain; Harvest and Pickup after a Berry eaten in the residual (EOT-2).
  "RT-RV05": { notEstimated: "Psychic Noise is not modelled in 2v2." },
  "RT-RV21": { endNotEstimated: "Harvest is not modelled in 2v2." },
  "RT-RV22": { endNotEstimated: "Pickup is not modelled in 2v2." },
  "VT-VE07": { endNotEstimated: "Harvest is not modelled in 2v2." },
  "VT-VE18": { endNotEstimated: "Harvest is not modelled in 2v2." },
  "VT-VE10": { endNotEstimated: "Pickup is not modelled in 2v2." },
  "VT-VE11": { endNotEstimated: "Pickup is not modelled in 2v2." },
  // positions-items-sub: guards that predate the review.
  RE01b: { notEstimated: "One-hit KO move: no damage range." },
  RE04: { notEstimated: "Matcha Gotcha heals from more than one target: not modelled." },
  RE05: { notEstimated: "Rock Slide heals from more than one target: not modelled." },
  RE43: { notEstimated: "Fling is not verified for this game." },
  "VT-VT06": { notEstimated: "Magic Room is not modelled and comes before another move." },
};

/** Candidates that cannot agree, with the fact reason. */
export const REVIEW_LEFT_OUT: Record<string, string> = {
  RE01: "Garchomp does not learn Fissure in Scarlet/Violet (the app's input issue); RE01b has the one-hit KO move into a Substitute.",
  RE21: "Assault Vest stops status moves (the app's input issue; tests/unit/doubles-engine-fixes.test.ts), and the oracle aborts on its Struggle.",
  RE45: "The oracle's No-move stand-in is Splash, which Assault Vest stops, so its Snorlax uses Struggle (an oracle artifact); RE45b has the Trick.",
  "RT-RV24": "The oracle cannot set it up: Leaf Guard refuses the carried Yawn in sun as the case is prepared.",
  "RT-RT02": "The oracle cannot set it up: Leaf Guard refuses the carried Yawn in sun as the case is prepared (its fact: tests/unit/doubles-eot.test.ts).",
};

export const REVIEW_ALL: Case[] = CANDIDATES.map((c) => ({ ...c, ...(REVIEW_REASONS[c.id] ?? {}) }));
export const REVIEW_CASES_FINAL: Case[] = REVIEW_ALL.filter((c) => !(c.id in REVIEW_LEFT_OUT));

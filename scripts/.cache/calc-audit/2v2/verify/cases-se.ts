// status-eot validation cases (SPEC §7.1, ADDENDUM §7.1): S (status moves), ER (SPEC's R end-of-turn cases; R ids are
// taken by review-engine/cases.ts, so ER01 is SPEC R01), E (ADDENDUM: Ally Switch, Trick, hits into a Substitute), and the
// earlier cases whose app expectation changed by design; then the review regression cases (cases-review.ts).
import type { Case } from "./case-types";
import { S_CASES } from "./cases-s";
import { ER_CASES } from "./cases-er";
import { E_CASES } from "./cases-e";
import { INT_CASES } from "./cases-int";
import { REVIEW_CASES_FINAL } from "./cases-review";
import { STEP1_CASES } from "./cases-status2-step1";
import { WAVE1A_CASES } from "./cases-wave1a";
import { WAVE1B_CASES } from "./cases-wave1b";
import { WAVE2_CASES } from "./cases-wave2";

// REVIEW_CASES_FINAL: the status-eot review, fix and verify cases that agree with pinned Showdown (cases-review.ts, build/FINAL.md).
// status2 Step 1 (SPEC2 §8.2, ADDENDUM2 §8.2): the correctness fixes' cases (cases-status2-step1.ts).
// status2 wave 1a (ADDENDUM2 §7.2, Track V1): the 1a-gated cases (cases-wave1a.ts gathers the case files).
// status2 wave 1b (ADDENDUM2 §7.2, Track V2): the 1b-gated cases (cases-wave1b.ts).
// status2 wave 2 (ADDENDUM2 §7.2, §8.7, Track R-V): the switch-outs with a replacement (cases-wave2.ts).
export const STATUS_EOT_CASES: Case[] = [...S_CASES, ...ER_CASES, ...E_CASES, ...INT_CASES, ...REVIEW_CASES_FINAL, ...STEP1_CASES, ...WAVE1A_CASES, ...WAVE1B_CASES, ...WAVE2_CASES];

/**
 * SPEC §7 step 7's allowed differences among the earlier cases: id → the new not-estimated reason, or null when the turn is
 * now estimated (the oracle runs it and validates it).
 */
export const STATUS_EOT_REEXPECT: Record<string, string | null> = {
  // Taunt (M) before another move: modelled now.
  V36c: null,
  // Roost (C) as the last action, no later damaging move: modelled now (the heal).
  V36d: null,
  // A Figy Berry's nature confusion is a fresh confusion now (SPEC §4.6); Dynamic Punch's 100% confusion is modelled.
  R01: null,
  R15: null,
  // Snore while asleep: modelled (sleep-usable; woken, it fails its onTry). Sleep Talk while asleep stays guarded, now as a
  // presence guard (SPEC §2.4 notIn2v2("Sleep Talk")).
  F14b: null,
  F14a: "Sleep Talk is not modelled in 2v2.",
};

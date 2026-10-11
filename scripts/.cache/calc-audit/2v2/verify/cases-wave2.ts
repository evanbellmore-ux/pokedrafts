// status2 wave 2 (ADDENDUM2 §7.2, §8.7; Track R-V): every new case file of the wave, in one list for cases-se.ts, with the
// track each case needs (it gates at integration 2) for reports and changed-cases.ts.
import type { Case } from "./case-types";
import { R_CASES } from "./cases-r";

export const WAVE2_CASES: Case[] = [...R_CASES];

/** The owning track of a wave 2 case (ADDENDUM2 §8.7), by id prefix; the first match wins. */
export const OWNER_2: [RegExp, string][] = [
  [/^IN-HZD-|^IN-BNC-|^G4-SWX-|^IN-FSL-02|^T2E-BL-|^T2P-AST-|^T2P-BTR-|^CQ-PUR-R-/, "R-E"],
];
export const ownerOf2 = (id: string) => OWNER_2.find(([re]) => re.test(id))?.[1] ?? "?";

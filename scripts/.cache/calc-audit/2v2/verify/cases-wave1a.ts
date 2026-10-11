// status2 wave 1a (ADDENDUM2 §7.2, Track V1): every new case file of the wave, in one list for cases-se.ts, with the track
// each case needs (it gates at the first integration after all of them merged: §7.2) for reports and changed-cases.ts.
import type { Case } from "./case-types";
import { IN_CASES } from "./cases-in";
import { CQ_CASES } from "./cases-cq";
import { T2E_CASES } from "./cases-t2e";
import { T2M_CASES } from "./cases-t2m";
import { CR_CASES } from "./cases-cr";
import { SAT_CASES } from "./cases-sat";
import { F2_CASES } from "./cases-f2";
import { FS_CASES } from "./cases-fs";
import { G4_CASES } from "./cases-g4";
import { INT1A_CASES } from "./cases-int1a";

export const WAVE1A_CASES: Case[] = [...IN_CASES, ...CQ_CASES, ...T2E_CASES, ...T2M_CASES, ...CR_CASES, ...SAT_CASES, ...F2_CASES, ...FS_CASES, ...G4_CASES, ...INT1A_CASES];

/** The owning track of a wave 1a case (ADDENDUM2 §8.3's gate column), by id prefix; the first match wins. */
export const OWNER: [RegExp, string][] = [
  [/^IN-STL-|^IN-DBD-|^IN-ENT-|^IN-PRT-|^CQ-STL-|^CQ-DBD-|^CQ-ENT-|^IN-RC|^IN-FO/, "N"],
  [/^IN-CHG-01|^CQ-SKD-|^T2M-SI-|^T2E-SI-/, "H"],
  [/^T2M-RI-/, "A3"],
  [/^IN-CHG-|^IN-LSF-|^IN-SU/, "kernel (Step 0a/0b, integrator)"],
  [/^IN-STK-|^CQ-STK-|^SAT-|^IN-ACC-01/, "A1"],
  [/^IN-ATR-|^F2-|^CR-0[37]|^CR-11/, "A2"],
  [/^CR-0[468]/, "A1"],
  [/^CR-10/, "D"],
  [/^IN-MST-|^IN-SPT-|^FS|^T2M-RI-/, "A3"],
  [/^G4-(HRV|PKP|LOZ|WHR|PER|STF-04|HBK-06|OPP-09)/, "E1"],
  [/^IN-ACC-02|^G4-/, "D"],
  [/^CQ-ETT-03|^CQ-ALY-|^CR-0[1259]|^IN-SEC-/, "E1"],
  [/^IN-SFG-|^T2M-ALE-|^T2M-FB-|^T2M-BE-|^T2M-AR-|^T2M-GW-|^T2M-AS-|^T2M-SG-/, "W"],
  [/^T2M-FA-|^T2M-FS-|^T2M-SB-|^T2M-SP-/, "S"],
  [/^IN-NBL-/, "kernel (existing battleOver)"],
  [/^INT-/, "integrator"],
];
export const ownerOf = (id: string) => OWNER.find(([re]) => re.test(id))?.[1] ?? "?";

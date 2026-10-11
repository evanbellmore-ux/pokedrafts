// status2 wave 1b (ADDENDUM2 §7.2, Track V2): every new case file of the wave, in one list for cases-se.ts, with the track
// each case needs (it gates at integration 1b: §7.2, §8.5's gate column) for reports and changed-cases.ts.
import type { Case } from "./case-types";
import { T2M_1B_CASES } from "./cases-t2m-1b";
import { T2P_CASES } from "./cases-t2p";
import { T2E_1B_CASES } from "./cases-t2e-1b";
import { IN_1B_CASES } from "./cases-in-1b";
import { CQ_1B_CASES } from "./cases-cq-1b";
import { INT1B_CASES } from "./cases-int1b";

export const WAVE1B_CASES: Case[] = [...T2M_1B_CASES, ...T2P_CASES, ...T2E_1B_CASES, ...IN_1B_CASES, ...CQ_1B_CASES, ...INT1B_CASES];

/** The owning track of a wave 1b case (ADDENDUM2 §8.5's gate column), by id prefix; the first match wins. */
export const OWNER_1B: [RegExp, string][] = [
  [/^INT-/, "integrator (1b)"],
  [/^T2M-VS-05|^FX-CE-|^T2M-(SE|SCK|UN|UNR|CD|FV|BB|AF|IO|RC)-|^IN-BBD-/, "K"],
  [/^T2M-(GM|PS)-|^IN-STL-04/, "M"],
  [/^T2M-(ST|UP|HH)-|^T2E-UP-|^T2P-(NAT|CPY|MIR|MEF|INS)-|^IN-CPY-/, "CL"],
  [/^T2P-(TRC|TWO|DWN|CUS)-/, "ST"],
  [/^T2P-(FLD|ACT)-/, "FC"],
  [/^T2P-RDT-|^IN-STL-05/, "N (1a, frozen: integrator)"],
  [/^T2P-SKD-/, "H (1a, frozen: integrator)"],
  [/^IN-SFG-02/, "W (1a, frozen: integrator)"],
  [/^T2M-Q-/, "A2 / calculate.ts (frozen: integrator)"],
  [/^T2P-|^CQ-(BID|PUR|CMD|ECV)-|^IN-(RTL|ECV)-/, "PR"],
  [/^T2E-(FS|CC|MO|GX|FC)|^IN-(FLD|TNT|CUD|FSL|TLK|HBK)-/, "E2"],
];
export const ownerOf1b = (id: string) => OWNER_1B.find(([re]) => re.test(id))?.[1] ?? "?";

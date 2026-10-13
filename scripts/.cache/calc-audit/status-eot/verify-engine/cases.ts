// Independent verification of the engine fixes (status-eot review). Showdown names; level 50, 31 IVs, Serious nature and
// 0 EVs unless set (Speed at level 50 with 0 EVs is base + 20). Ids VE<finding>-<n>.
import type { Case, CaseAction, CaseMon, SlotId } from "../../2v2/verify/case-types";
import { chomp, jolt, lax, saur, toise } from "../../2v2/verify/cases-s";

type Slot = CaseMon & { action: CaseAction };
const mon = (species: string, ability: string, extra: Partial<CaseMon> = {}): CaseMon => ({ species, ability, ...extra });
const act = (m: CaseMon, move: string | null, target?: SlotId, context?: Record<string, unknown>): Slot =>
  ({ ...m, action: { move, ...(target ? { target } : {}), ...(context ? { context } : {}) } });
const idle = (m: CaseMon): Slot => act(m, null);
const empty = (m: CaseMon): Slot => ({ ...m, absent: true, action: { move: null } });
const slots = (ownLeft: Slot, ownRight: Slot, oppLeft: Slot, oppRight: Slot): Case["slots"] =>
  ({ "own-left": ownLeft, "own-right": ownRight, "opponent-left": oppLeft, "opponent-right": oppRight });
const OL: SlotId = "own-left", OR: SlotId = "own-right", PL: SlotId = "opponent-left", PR: SlotId = "opponent-right";
void OR; void PR; void empty; void jolt; void chomp;
const klawf = (extra: Partial<CaseMon> = {}) => mon("Klawf", "Anger Shell", { item: "Sitrus Berry", hp: 80, carried: { confusion: { attempts: 0 } }, ...extra });

export const VERIFY_CASES: Case[] = [
  // ---- H1 neighbourhood: the lock (checkedAngerShell false after the self-hit) ends at a later move's AfterMoveSecondary
  // on the holder (data/abilities.ts angershell onAfterMoveSecondary sets it true first), status moves included
  // (sim/battle-actions.ts hitStepMoveHitLoop: :1003 Update, :1005 afterMoveSecondaryEvent); the action's last Update eats it.
  {
    id: "VE-H1-1", notEstimated: "Sitrus Berry after a confusion self-hit with Anger Shell is not modelled in 2v2.", title: "Locked Anger Shell Klawf, then a foe's Spore into it", game: "sv", outcomes: true,
    slots: slots(idle(klawf()), idle(lax()), act(mon("Amoonguss", "Regenerator"), "Spore", OL), idle(toise())),
    checks: "Self-hit below half: Sitrus kept; Spore's AfterMoveSecondary unlocks it; eaten at Spore's last Update.",
  },
  {
    id: "VE-H1-2", notEstimated: "Sitrus Berry after a confusion self-hit with Anger Shell is not modelled in 2v2.", title: "Locked Anger Shell Klawf, then a foe's Pain Split into it", game: "sv", outcomes: true,
    slots: slots(idle(klawf()), idle(lax()), act(mon("Dusknoir", "Pressure", { hp: 40 }), "Pain Split", OL), idle(toise())),
    checks: "Pain Split sets both HP; its AfterMoveSecondary unlocks the Sitrus; the action's last Update eats it.",
  },
  {
    id: "VE-H1-3", notEstimated: "Sitrus Berry after a confusion self-hit with Anger Shell is not modelled in 2v2.", title: "Locked Anger Shell Klawf with no item, then a foe Tricks a Sitrus onto it", game: "sv", outcomes: true,
    slots: slots(idle(klawf({ item: undefined })), idle(lax()), act(mon("Hatterene", "Magic Bounce", { item: "Sitrus Berry" }), "Trick", OL), idle(toise())),
    checks: "The received Sitrus is kept at the hit's Update (locked) and eaten after AfterMoveSecondary.",
  },
  {
    id: "VE-H1-4", notEstimated: "Sitrus Berry after a confusion self-hit with Berserk is not modelled in 2v2.", title: "USUM: locked Berserk Drampa, then a foe's Thunder Wave into it", game: "usum", outcomes: true,
    slots: slots(idle(mon("Drampa", "Berserk", { item: "Sitrus Berry", hp: 85, carried: { confusion: { attempts: 0 } } })), idle(lax()), act(mon("Ferrothorn", "Iron Barbs"), "Thunder Wave", OL), idle(toise())),
    checks: "Thunder Wave's AfterMoveSecondary unlocks the Sitrus: eaten at its last Update.",
  },
  {
    id: "VE-H1-5", title: "Locked Anger Shell Klawf under a foe's Neutralizing Gas", game: "sv", outcomes: true,
    slots: slots(idle(klawf()), idle(lax()), idle(mon("Weezing-Galar", "Neutralizing Gas")), idle(toise())),
    checks: "Neutralizing Gas suppresses Anger Shell: its onDamage and onTryEatItem do not run, so the Sitrus is eaten after the self-hit.",
  },
  {
    id: "VE-H1-6", endNotEstimated: "Sitrus Berry after a confusion self-hit with Anger Shell is not modelled in 2v2.", title: "Locked Anger Shell Klawf, a foe's Spore into its ally", game: "sv", outcomes: true,
    slots: slots(idle(klawf()), idle(lax()), act(mon("Amoonguss", "Regenerator"), "Spore", OR), idle(toise())),
    checks: "Spore into the ally Snorlax: Klawf is not hit, the lock holds through the turn's moves.",
  },
  {
    id: "VE-H1-7", title: "Locked Anger Shell Klawf, an ally's Life Dew (allies) hits it", game: "sv", outcomes: true,
    slots: slots(idle(klawf({ hp: 76 })), act(mon("Primarina", "Torrent"), "Life Dew"), idle(lax()), idle(toise())),
    checks: "Life Dew heals 35 (to above half): no eat either way; the lock ends at its AfterMoveSecondary.",
  },
];

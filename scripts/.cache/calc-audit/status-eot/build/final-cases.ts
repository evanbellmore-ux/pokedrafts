// status-eot final gate (build/FINAL.md): oracle cases for the integration fixes the final gate made. Showdown names; level
// 50, 31 IVs, Serious nature and 0 EVs unless set (HP = base + 75, Speed = base + 20).
import type { Case, CaseAction, CaseMon, SlotId } from "../../2v2/verify/case-types";
import { lax, saur, toise } from "../../2v2/verify/cases-s";

type Slot = CaseMon & { action: CaseAction };
const mon = (species: string, ability: string, extra: Partial<CaseMon> = {}): CaseMon => ({ species, ability, ...extra });
const act = (m: CaseMon, move: string | null, target?: SlotId): Slot => ({ ...m, action: { move, ...(target ? { target } : {}) } });
const idle = (m: CaseMon): Slot => act(m, null);
const slots = (ownLeft: Slot, ownRight: Slot, oppLeft: Slot, oppRight: Slot): Case["slots"] =>
  ({ "own-left": ownLeft, "own-right": ownRight, "opponent-left": oppLeft, "opponent-right": oppRight });
const PL: SlotId = "opponent-left";
const drampa = (extra: Partial<CaseMon> = {}) => mon("Drampa", "Berserk", { item: "Sitrus Berry", hp: 85, carried: { confusion: { attempts: 0 } }, ...extra });
const klawf = (extra: Partial<CaseMon> = {}) => mon("Klawf", "Anger Shell", { item: "Sitrus Berry", hp: 80, carried: { confusion: { attempts: 0 } }, ...extra });

export const FINAL_CASES: Case[] = [
  // ---- H1 at the end of turn: the Berserk / Anger Shell lock a confusion self-hit leaves (doubles-eot.ts updateSlot, unlock).
  {
    id: "FN01", title: "A locked Berserk Drampa's Sitrus after the sand's damage (SwSh)", game: "swsh", field: { weather: "Sand" }, weatherTurns: 3,
    slots: slots(idle(drampa()), idle(lax()), idle(toise()), idle(saur())),
    checks: "Self-hit 12–15 from 85/153 locks the Sitrus; the sand's 9 resets the lock (onDamage, a weather), so the Update after it eats it (+38).",
  },
  {
    id: "FN02", title: "A locked Anger Shell Klawf's Sitrus after poison's damage", game: "sv", outcomes: true,
    slots: slots(act(klawf({ status: "psn" }), "Rock Slide"), idle(lax()), idle(toise()), idle(saur())),
    checks: "Self-hit from 80/140 locks the Sitrus; poison's 17 at order 9 resets the lock, and the Update after it eats the Sitrus.",
  },
  {
    id: "FN03", title: "A locked Anger Shell Klawf's Sitrus after Leech Seed's drain", game: "sv", outcomes: true,
    slots: slots(act(klawf({ carried: { confusion: { attempts: 0 }, leechSeed: PL } }), "Rock Slide"), idle(lax()), idle(saur()), idle(toise())),
    checks: "Leech Seed (order 8) takes 17 from the locked Klawf: the lock resets and the Update eats its Sitrus.",
  },
  {
    id: "FN04", title: "A locked Anger Shell Klawf healed by Grassy Terrain keeps its Sitrus", game: "sv", field: { terrain: "Grassy" }, outcomes: true,
    slots: slots(act(klawf({ hp: 75 }), "Rock Slide"), idle(lax()), idle(toise()), idle(saur())),
    checks: "Self-hit from 75/140 to 59–62; Grassy Terrain heals 8 (67–70, at or under half) but is no damage: the lock stays and the Sitrus is not eaten.",
  },
  // ---- EOT-1 exact (World.weatherSet): a weather the moves set again goes on.
  {
    id: "FN05", title: "Sand from before with one turn left, Rain Dance, then Sandstorm sets a new sand", game: "sv", field: { weather: "Sand" }, weatherTurns: 1, outcomes: true,
    slots: slots(act(mon("Pelipper", "Keen Eye", { evs: { spe: 252 } }), "Rain Dance"), act(mon("Tyranitar", "Unnerve"), "Sandstorm"), idle(lax({ hp: 150 })), idle(saur({ hp: 150 }))),
    checks: "Sandstorm's sand has duration 5: the residual counts it to 4 and deals 1/16 to Snorlax (14) and Venusaur (9).",
  },
  {
    id: "FN06", title: "Sand from before with no turn count, Rain Dance, then Sandstorm: no assumption fact", game: "sv", field: { weather: "Sand" }, outcomes: true,
    slots: slots(act(mon("Pelipper", "Keen Eye", { evs: { spe: 252 } }), "Rain Dance"), act(mon("Tyranitar", "Unnerve"), "Sandstorm"), idle(lax({ hp: 150 })), idle(saur({ hp: 150 }))),
    checks: "The sand up at the end of turn was set this turn, so its damage needs no assumption about the old sand's turns.",
  },
];

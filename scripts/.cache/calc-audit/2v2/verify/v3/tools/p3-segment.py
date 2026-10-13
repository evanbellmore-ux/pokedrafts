import sys; sys.path.insert(0, 'v3/tools')
from patchlib import patch
P = 'sim-dfs.ts'
patch(P, [
("""const STOP = { stop: true };
type SegmentEnd = {
  kind: "end"; hp: Record<SlotId, number>; max: Record<SlotId, number>; state: Record<SlotId, MonState>; sides: Record<SideKey, string[]>;
  /** After the whole turn; null: a switch request came after the last action, so there was no residual. */
  after: { state: Record<SlotId, MonState>; residuals: ResidualEntry[]; field: string[]; extra: AfterExtra } | null;
};""",
"""const STOP = { stop: true };
/** status2 wave 2: thrown by the battle's endTurn while the switches after the residual are answered (the turn ends there). */
const ENDTURN = { endTurn: true };
/** status2 wave 2 (a case with a bench): each slot's switch-outs so far, and each newcomer's state by its key. */
type BenchRecord = { replaced: Partial<Record<SlotId, SwitchEvent[]>>; entered: Record<string, MonState & { start: number }> };
function benchRecord(b: any): BenchRecord {
  const replaced: BenchRecord["replaced"] = {};
  for (const slot of SLOTS) {
    const events = anchorOf(b, slot)?.m?.swEvents as SwitchEvent[] | undefined;
    if (events?.length) replaced[slot] = events.map((e) => ({ ...e }));
  }
  const entered: BenchRecord["entered"] = {};
  for (const p of newcomers(b)) entered[keyOf(p)!] = { ...monState(p, p.m.enteredFor), start: p.m.startHP ?? p.maxhp };
  return { replaced, entered };
}
/**
 * status2 wave 2: the choices answering the switch request now, from the case's bench: each flagged Pokémon of a side gets
 * Case.replacement[its starting slot] when it is that slot's starting Pokémon, else the first member (case order) neither
 * in play nor fainted nor already picked; null when a side asked has no bench in the case (as before: not answered), or
 * after the residual when only fainted Pokémon are flagged (their replacements are the next turn's). A switch-out after the
 * residual beside a fainted Pokémon's replacement is not followed (the app's end of turn has no faint replacements).
 */
function switchAnswers(b: any, ctx: Ctx, afterResidual: boolean): [string, string] | null {
  const flagged = b.sides.flatMap((side: any) => (side.activeRequest?.forceSwitch ?? []).map((on: boolean, k: number) => (on ? side.active[k] : null)).filter(Boolean));
  if (!flagged.length) return null;
  const fainted = flagged.filter((p: any) => p.fainted || !p.hp);
  if (afterResidual && fainted.length === flagged.length) return null;
  if (fainted.length) throw new Error(`${ctx.c.id}: a switch-out beside a fainted Pokémon's replacement (${fainted.map((p: any) => p.name).join(", ")}) is not followed by the oracle`);
  const out: [string, string] = ["", ""];
  for (const [i, side] of b.sides.entries()) {
    const req = side.activeRequest;
    if (!req?.forceSwitch) continue;
    const members = ctx.c.bench?.[i === 0 ? "own" : "opponent"]?.members;
    if (!members) return null;
    const picked = new Set<number>();
    out[i] = side.active.map((p: any, k: number) => {
      if (!req.forceSwitch[k]) return "pass";
      const chosen = p.m?.caseSlot ? ctx.c.replacement?.[p.m.caseSlot as SlotId] : undefined;
      const index = (id: string) => side.pokemon.findIndex((x: any) => x.m?.benchId === id);
      const free = (at: number) => at >= side.active.length && !side.pokemon[at].fainted && !picked.has(at);
      let at = -1;
      if (chosen) {
        at = index(chosen);
        if (!free(at)) throw new Error(`${ctx.c.id}: ${p.m.caseSlot}'s replacement ${chosen} is not on the bench now`);
      } else {
        at = members.map((m) => index(m.id)).find((x) => x >= 0 && free(x)) ?? -1;
        if (at < 0) throw new Error(`${ctx.c.id}: no bench member left to come in for ${p.name}`);
      }
      picked.add(at);
      return `switch ${at + 1}`;
    }).join(", ");
  }
  return out;
}
/** status2 wave 2: makes the choices of a switch request and goes on (the turn loop runs: a boundary or the end may throw). */
function answerSwitch(b: any, answers: [string, string]) {
  for (const [i, text] of answers.entries()) {
    if (!text) continue;
    if (!b.sides[i].choose(text)) throw new Error(`switch answer "${text}" for p${i + 1}: ${b.sides[i].choice.error}`);
  }
  b.commitChoices();
}
type SegmentEnd = {
  kind: "end"; hp: Record<SlotId, number>; max: Record<SlotId, number>; state: Record<SlotId, MonState>; sides: Record<SideKey, string[]>;
  /** After the whole turn; null: a switch request came after the last action, so there was no residual. */
  after: { state: Record<SlotId, MonState>; residuals: ResidualEntry[]; field: string[]; extra: AfterExtra; r?: BenchRecord } | null;
  /** status2 wave 2 (a case with a bench): the switch-outs and newcomers after the moves. */
  r?: BenchRecord;
};"""),
("""function runSegment(json: string, first: boolean, choices: [string, string], ch: Chooser, ctx: Ctx, whole = false): SegmentOut {
  const b = State.deserializeBattle(json);
  install(b, ch, ctx.critical);
  const rec = new Recorder(b, ctx);
  let calls = 0;
  let out: SegmentOut | null = null;
  const ra = b.runAction;
  b.runAction = function (action: any) {
    calls++;
    const boundary = !whole && (first || calls === 2);
    if (action.choice === "residual" || boundary) {
      rec.finish();
      if (action.choice === "residual") {
        const end: SegmentEnd = { kind: "end", hp: hpNow(this), max: maxNow(this), state: statesOf(this), sides: sideConditionsOf(this), after: null };
        // status-eot: run the residual action (fieldEvent('Residual'), faints, the final Update, Emergency Exit) and read
        // the turn's end; its random events are decisions after the mark.
        ch.startResidual();
        const tags = tagResidualLines(this);
        const logStart = this.log.length;
        const pos = posMapOf(this);
        ra.call(this, action);
        const lines = this.log.slice(logStart) as string[];
        const hpEnd = hpNow(this);
        end.after = {
          state: statesOf(this), residuals: residualEntries(lines, tags, logStart, pos, end.hp, hpEnd),
          field: [`weather:${this.field.weather || ""}`, `terrain:${this.field.terrain || ""}`], extra: afterExtra(this),
        };
        out = { ...end, recs: rec.recs, weightPath: ch.weight, firstMoveHP: rec.firstMoveHP };""",
"""function runSegment(json: string, first: boolean, choices: [string, string], ch: Chooser, ctx: Ctx, whole = false): SegmentOut {
  const b = State.deserializeBattle(json);
  install(b, ch, ctx.critical, ctx.bench);
  const rec = new Recorder(b, ctx);
  let calls = 0;
  let out: SegmentOut | null = null;
  // status2 wave 2: the actions the switches after the residual set off run as they come (no boundary).
  let afterResidual = false;
  const ra = b.runAction;
  b.runAction = function (action: any) {
    calls++;
    if (afterResidual) {
      rec.begin(action);
      return ra.call(this, action);
    }
    const boundary = !whole && (first || calls === 2);
    if (action.choice === "residual" || boundary) {
      rec.finish();
      if (action.choice === "residual") {
        const end: SegmentEnd = { kind: "end", hp: hpNow(this), max: maxNow(this), state: statesOf(this), sides: sideConditionsOf(this), after: null, ...(ctx.bench ? { r: benchRecord(this) } : {}) };
        // status-eot: run the residual action (fieldEvent('Residual'), faints, the final Update, Emergency Exit) and read
        // the turn's end; its random events are decisions after the mark.
        ch.startResidual();
        const tags = tagResidualLines(this);
        const logStart = this.log.length;
        const pos = posMapOf(this);
        const hpStart = hpAll(this);
        ra.call(this, action);
        const lines = this.log.slice(logStart) as string[];
        const hpEnd = hpAll(this);
        const residuals = residualEntries(lines, tags, logStart, pos, hpStart, hpEnd);
        // status2 wave 2 (a case with a bench): the switch-outs after the residual (Emergency Exit, Wimp Out, Eject Pack at 29)
        // are answered and their newcomers come in (hazards, entry abilities); the turn ends there, before the next one starts.
        if (ctx.bench) {
          for (let guard = 0; this.requestState === "switch" && !this.ended; guard++) {
            if (guard > 6) throw new Error(`${ctx.c.id}: switch requests after the residual do not end`);
            const answers = switchAnswers(this, ctx, true);
            if (!answers) break;
            const endTurn = this.endTurn;
            this.endTurn = () => { throw ENDTURN; };
            afterResidual = true;
            try {
              answerSwitch(this, answers);
            } catch (e) {
              if (e !== ENDTURN) throw e;
            } finally {
              this.endTurn = endTurn;
              afterResidual = false;
            }
            rec.finish();
          }
        }
        end.after = {
          state: statesOf(this), residuals,
          field: [`weather:${this.field.weather || ""}`, `terrain:${this.field.terrain || ""}`], extra: afterExtra(this),
          ...(ctx.bench ? { r: benchRecord(this) } : {}),
        };
        out = { ...end, recs: rec.recs, weightPath: ch.weight, firstMoveHP: rec.firstMoveHP };"""),
("""  try {
    if (first) {
      for (const [i, text] of choices.entries()) {
        if (!b.sides[i].choose(text)) throw new Error(`choice "${text}" for p${i + 1}: ${b.sides[i].choice.error}`);
      }
      b.commitChoices();
    } else {
      b.turnLoop();
    }
  } catch (e) {
    if (e !== STOP) throw e;
  }
  if (!out && b.requestState === "switch" && !b.queue.list.some((a: any) => a.choice === "move")) {""",
"""  try {
    if (first) {
      for (const [i, text] of choices.entries()) {
        if (!b.sides[i].choose(text)) throw new Error(`choice "${text}" for p${i + 1}: ${b.sides[i].choice.error}`);
      }
      b.commitChoices();
    } else {
      b.turnLoop();
    }
    // status2 wave 2 (a case with a bench): a switch request during the moves (U-turn, Eject Button, Eject Pack, Emergency
    // Exit; after the last move too) is answered from the bench and the turn goes on (sim/battle.ts:2876-2914, 2998-3020):
    // the replacements' instaswitch actions are the next boundary.
    for (let guard = 0; ctx.bench && !out && b.requestState === "switch" && !b.ended; guard++) {
      if (guard > 8) throw new Error(`${ctx.c.id}: switch requests do not end`);
      const answers = switchAnswers(b, ctx, false);
      if (!answers) break;
      answerSwitch(b, answers);
    }
  } catch (e) {
    if (e !== STOP) throw e;
  }
  if (!out && b.requestState === "switch" && !b.queue.list.some((a: any) => a.choice === "move")) {"""),
("""    rec.finish();
    out = {
      kind: "end", hp: hpNow(b), max: maxNow(b), state: statesOf(b), sides: sideConditionsOf(b),
      after: { state: statesOf(b), residuals: [], field: [`weather:${b.field.weather || ""}`, `terrain:${b.field.terrain || ""}`], extra: afterExtra(b) },
      recs: rec.recs, weightPath: ch.weight, firstMoveHP: rec.firstMoveHP,
    };""",
"""    rec.finish();
    out = {
      kind: "end", hp: hpNow(b), max: maxNow(b), state: statesOf(b), sides: sideConditionsOf(b),
      after: { state: statesOf(b), residuals: [], field: [`weather:${b.field.weather || ""}`, `terrain:${b.field.terrain || ""}`], extra: afterExtra(b), ...(ctx.bench ? { r: benchRecord(b) } : {}) },
      recs: rec.recs, weightPath: ch.weight, firstMoveHP: rec.firstMoveHP, ...(ctx.bench ? { r: benchRecord(b) } : {}),
    };"""),
("""function stateOf(b: any, slot: SlotId): MonState {
  const p = monOf(b, slot);
  const st = p?.statusState ?? {};""",
"""function stateOf(b: any, slot: SlotId): MonState {
  return monState(monOf(b, slot), slot);
}
/** What Pokémon `p`, standing for `slot`, is now (stateOf; status2 wave 2: a newcomer, or a leaver on the bench, too). */
function monState(p: any, slot: SlotId): MonState {
  const st = p?.statusState ?? {};
  // status2 wave 2: a starting Pokémon on the bench (it switched out) stands at no position and has no switch pending.
  const benched = !!p?.m?.keep && !p.isActive;"""),
("""    swapped: !!p && p.position !== SD[slot].position, switchFlag: !!p?.switchFlag,""",
"""    swapped: !!p && !benched && p.position !== SD[slot].position, switchFlag: !benched && !!p?.switchFlag,"""),
])

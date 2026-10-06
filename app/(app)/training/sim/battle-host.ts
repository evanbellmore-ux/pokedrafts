// The authoritative Training battle (SPEC §7.1): p1 = you, p2 = the AI. Readers of `battle` are worker-handler,
// sim/board.ts (your side) and sim/inputs.ts's test-reveal oracle only (boundary test). Showdown's own Battle is used
// directly and synchronously (choose returns false and reports on sideupdate, pinned sim/battle.ts:2964-2979).
import type { ShowdownRequest, ShowdownSet, SideID } from "../model/showdown-types";
import { isMidTurn } from "./requests";
import { Battle, State, extractChannelMessages, type ChoiceRequest, type PRNGSeed } from "./sim";

export type HostOptions = {
  formatid: string; seed: PRNGSeed | readonly number[] | null;
  p1: { name: "You"; team: ShowdownSet[] }; p2: { name: "Training"; team: ShowdownSet[] };
};
export type HostDrain = {
  channel: { p1: string[]; p2: string[] }; turn: number; requestId: number;
  requests: { p1: ShowdownRequest | null; p2: ShowdownRequest | null }; midTurn: boolean;
  ended: { winner: SideID | null } | null;
};
export type ChooseResult = { ok: true; committed: boolean } | { ok: false; error: string; requestChanged: boolean };
export type CheckResult = { ok: true } | { ok: false; error: string; requestChanged: boolean; request: ShowdownRequest | null };

/** "[Invalid choice] Can't move: …" → "Can't move: …" (pinned sim/side.ts:527-536). */
export function choiceErrorText(line: string): string {
  return line.replace(/^\|error\|/, "").replace(/^\[(?:Invalid|Unavailable) choice\] /, "");
}

type SideUpdates = { errors: string[]; requests: number };
function sideUpdateCollector(): { send(type: string, data: string | string[]): void; take(side: SideID): SideUpdates } {
  let pending: Record<SideID, SideUpdates> = { p1: { errors: [], requests: 0 }, p2: { errors: [], requests: 0 } };
  return {
    send(type, data) {
      if (type !== "sideupdate") return;
      const text = Array.isArray(data) ? data.join("\n") : data;
      const [sideLine, ...lines] = text.split("\n");
      const side = sideLine === "p1" || sideLine === "p2" ? sideLine : null;
      if (!side) return;
      for (const line of lines) {
        if (line.startsWith("|error|")) pending[side].errors.push(choiceErrorText(line));
        else if (line.startsWith("|request|")) pending[side].requests++;
      }
    },
    take(side) {
      const taken = pending[side];
      pending = { ...pending, [side]: { errors: [], requests: 0 } };
      return taken;
    },
  };
}

export class BattleHost {
  /** Readers: worker-handler, sim/board.ts (your side), sim/inputs.ts test-reveal oracle. Nothing else (boundary test). */
  readonly battle: Battle;
  private id = 0;
  private known: Record<SideID, ChoiceRequest | null> = { p1: null, p2: null };
  private updates: string[] = [];
  private readonly sideUpdates = sideUpdateCollector();

  constructor(options: HostOptions) {
    this.battle = new Battle({
      formatid: options.formatid,
      seed: options.seed ?? undefined,
      send: (type, data) => {
        if (type === "update") this.updates.push(Array.isArray(data) ? data.join("\n") : data);
        else this.sideUpdates.send(type, data);
      },
    });
    this.battle.setPlayer("p1", { name: options.p1.name, team: structuredClone(options.p1.team) });
    this.battle.setPlayer("p2", { name: options.p2.name, team: structuredClone(options.p2.team) });
    this.track();
  }

  get requestId(): number { return this.id; }

  /** side.activeRequest (the live object: read it, never change it). */
  request(side: SideID): ShowdownRequest | null {
    return this.battle.ended ? null : (this.battle[side].activeRequest as ShowdownRequest | null);
  }

  /** A request that is not { wait: true } and no complete choice from that side yet. */
  needsChoice(side: SideID): boolean {
    const request = this.request(side);
    return !!request && !("wait" in request) && !this.battle[side].isChoiceDone();
  }

  /** Validates `choice` for `side` on a clone of `snapshotJson`; the live battle is untouched. */
  checkChoice(side: SideID, choice: string, snapshotJson: string): CheckResult {
    const collector = sideUpdateCollector();
    const clone = State.deserializeBattle(snapshotJson);
    clone.restart((type, data) => collector.send(type, data));
    if (clone.choose(side, choice)) return { ok: true };
    const { errors, requests } = collector.take(side);
    return {
      ok: false, error: errors[errors.length - 1] ?? (requests > 0 ? "" : "Invalid choice."), requestChanged: requests > 0,
      request: requests > 0 ? structuredClone(clone[side].activeRequest as ShowdownRequest | null) : null,
    };
  }

  choose(side: SideID, choice: string): ChooseResult {
    this.sideUpdates.take(side);
    const before = this.id;
    const ok = this.battle.choose(side, choice);
    const { errors, requests } = this.sideUpdates.take(side);
    if (!ok) return { ok: false, error: errors[errors.length - 1] ?? (requests > 0 ? "" : "Invalid choice."), requestChanged: requests > 0 };
    this.track();
    return { ok: true, committed: this.id !== before || this.battle.ended };
  }

  /** Everything the battle wrote since the last drain, split per channel (pinned sim/battle.ts:33-56, 3267). */
  drain(): HostDrain {
    this.battle.sendUpdates();
    const data = this.updates.splice(0).join("\n");
    const channels = extractChannelMessages(data, [1, 2]);
    this.track();
    const winner = this.battle.winner;
    return {
      channel: { p1: channels[1], p2: channels[2] },
      turn: this.battle.turn, requestId: this.id,
      requests: { p1: this.request("p1"), p2: this.request("p2") },
      midTurn: isMidTurn(this.battle),
      ended: this.battle.ended ? { winner: winner === this.battle.p1.name ? "p1" : winner === this.battle.p2.name ? "p2" : null } : null,
    };
  }

  /** JSON.stringify(State.serializeBattle(battle)): for checkChoice only. */
  snapshot(): string {
    return JSON.stringify(State.serializeBattle(this.battle));
  }

  forfeit(side: SideID): void {
    if (!this.battle.ended) this.battle.lose(side);
    this.track();
  }

  inputLog(): readonly string[] {
    return this.battle.inputLog;
  }

  /** requestId + 1 when a side's activeRequest became a new object (a rejected choice mutates the same one, side.ts:906-915). */
  private track(): void {
    const next = { p1: this.battle.p1.activeRequest, p2: this.battle.p2.activeRequest };
    if (next.p1 !== this.known.p1 || next.p2 !== this.known.p2) {
      if (next.p1 || next.p2) this.id++;
      this.known = next;
    }
  }
}

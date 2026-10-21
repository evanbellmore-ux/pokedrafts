import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import MobilePanelBar from "@/app/(app)/leagues/[leagueId]/draft/MobilePanelBar";
import {
  CHAT_LIMIT,
  countUnreadChat,
  mergeChat,
} from "@/app/(app)/leagues/[leagueId]/draft/draft-room";
import type { DraftChatMessage } from "@/app/types/league";

/**
 * The phone layout's Chat button counts the messages that arrived while the
 * chat panel was hidden. The room keeps only the newest CHAT_LIMIT (100)
 * messages (`mergeChat`), so a count taken as "messages now minus messages
 * then" stopped at 100: once the room held 100 messages every new one pushed
 * an old one out, the length stayed 100 and the badge stayed at 0 (or froze
 * at the count it had reached). The room now remembers which messages were
 * seen and counts the others, and the button shows 99+ once the count fills
 * the room's window, where the exact number is no longer known.
 */

const root = resolve(__dirname, "../..");

function message(n: number): DraftChatMessage {
  return {
    id: `message-${String(n).padStart(4, "0")}`,
    league_id: "league-1",
    member_id: "member-1",
    user_id: "user-1",
    message: `Message ${n}`,
    created_at: new Date(Date.UTC(2026, 9, 20, 18, 0, n)).toISOString(),
  };
}

function messages(from: number, to: number): DraftChatMessage[] {
  return Array.from({ length: to - from + 1 }, (_, index) => message(from + index));
}

describe("unread chat count", () => {
  it("keeps counting once the room holds its newest 100 messages", () => {
    const loaded = mergeChat([], messages(1, CHAT_LIMIT));
    const seen = new Set(loaded.map((item) => item.id));
    expect(countUnreadChat(loaded, seen)).toBe(0);

    const fiveMore = mergeChat(loaded, messages(CHAT_LIMIT + 1, CHAT_LIMIT + 5));
    expect(fiveMore).toHaveLength(CHAT_LIMIT);
    expect(countUnreadChat(fiveMore, seen)).toBe(5);

    // More new messages than the room keeps: every message it holds is new.
    const flood = mergeChat(fiveMore, messages(CHAT_LIMIT + 6, CHAT_LIMIT + 250));
    expect(countUnreadChat(flood, seen)).toBe(CHAT_LIMIT);
  });

  it("counts a message the room learns about late, even when it is older than ones already seen", () => {
    const seen = new Set(mergeChat([], [message(1), message(3)]).map((item) => item.id));
    const later = mergeChat(mergeChat([], [message(1), message(3)]), [message(2), message(4)]);
    expect(countUnreadChat(later, seen)).toBe(2);
  });

  it("shows 99+ on the Chat button once the count reaches 100", () => {
    const render = (unreadChat: number) =>
      renderToStaticMarkup(createElement(MobilePanelBar, { active: "pool", onChange: () => undefined, unreadChat }));
    expect(render(1)).toContain(", 1 new message<");
    expect(render(99)).toContain("(99)");
    expect(render(99)).toContain(", 99 new messages");
    for (const count of [CHAT_LIMIT, 250]) {
      expect(render(count)).toContain("(99+)");
      expect(render(count)).toContain(", 99+ new messages");
      expect(render(count)).not.toContain(String(count));
    }
  });

  it("is how the draft room counts, not by the number of messages it holds", () => {
    const source = readFileSync(resolve(root, "app/(app)/leagues/[leagueId]/draft/DraftClient.tsx"), "utf8");
    expect(source).not.toMatch(/chat\.length - chatSeen/);
    expect(source).toMatch(/countUnreadChat\(room\.chat, chatSeen\)/);
  });
});

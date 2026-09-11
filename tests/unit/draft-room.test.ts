import { describe, expect, it } from "vitest";
import {
  CHAT_MAX_LENGTH,
  chatLength,
  clampChatMessage,
} from "@/app/(app)/leagues/[leagueId]/draft/draft-room";

/**
 * `draft_chat_messages.message` is checked with `char_length(message)
 * between 1 and 500`, which counts characters (code points). The room must
 * apply the same count: `String#slice(0, 500)` counts UTF-16 code units and
 * can cut an emoji in half, leaving a lone surrogate the database rejects.
 */

const PARTY = "\u{1F389}";

/** True when `text` holds a high or low surrogate without its partner. */
function hasLoneSurrogate(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

describe("chat message limit", () => {
  it("counts characters the way char_length does, not UTF-16 code units", () => {
    expect(PARTY.length).toBe(2);
    expect(chatLength(PARTY)).toBe(1);
    expect(chatLength("abc")).toBe(3);
    expect(chatLength("")).toBe(0);
  });

  it("leaves a message within the limit untouched", () => {
    const full = "a".repeat(CHAT_MAX_LENGTH);
    expect(clampChatMessage(full)).toBe(full);
    expect(clampChatMessage("hello")).toBe("hello");
    expect(clampChatMessage("")).toBe("");
  });

  it("keeps an emoji at the limit whole where a code-unit slice would split it", () => {
    const boundary = "a".repeat(CHAT_MAX_LENGTH - 1) + PARTY;
    expect(chatLength(boundary)).toBe(CHAT_MAX_LENGTH);
    expect(clampChatMessage(boundary)).toBe(boundary);
    // The bug this guards against: the old slice ended in a lone high surrogate.
    expect(hasLoneSurrogate(boundary.slice(0, CHAT_MAX_LENGTH))).toBe(true);
  });

  it("cuts an over-long message to 500 characters with every pair intact", () => {
    const clamped = clampChatMessage(PARTY.repeat(CHAT_MAX_LENGTH + 5));
    expect(chatLength(clamped)).toBe(CHAT_MAX_LENGTH);
    expect(clamped.length).toBe(CHAT_MAX_LENGTH * 2);
    expect(hasLoneSurrogate(clamped)).toBe(false);

    const mixed = clampChatMessage(`${"b".repeat(CHAT_MAX_LENGTH - 1)}${PARTY}${PARTY}tail`);
    expect(chatLength(mixed)).toBe(CHAT_MAX_LENGTH);
    expect(mixed.endsWith(PARTY)).toBe(true);
  });
});

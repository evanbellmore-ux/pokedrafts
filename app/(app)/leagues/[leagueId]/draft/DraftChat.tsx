"use client";

import {
  memo,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type UIEvent,
} from "react";
import { Alert, Button, Field, Input } from "@/app/components/ui";
import { teamNameLabel } from "@/app/lib/league/labels";
import type { DraftChatMessage, LeagueMember } from "@/app/types/league";
import {
  CHAT_MAX_LENGTH,
  chatDayKey,
  chatLength,
  clampChatMessage,
  formatChatDay,
  formatChatTime,
} from "./draft-room";

/** Distance from the bottom (px) within which new messages auto-scroll. */
const NEAR_BOTTOM_PX = 80;
/** The character counter appears once this many characters are left. */
const COUNTER_FROM_LEFT = 100;

export type DraftChatProps = {
  messages: DraftChatMessage[];
  membersById: Map<string, LeagueMember>;
  myMemberId: string;
  loading: boolean;
  /** Resolves to an error message, or null once the message is stored. */
  onSend: (text: string) => Promise<string | null>;
  className?: string;
};

type SendError = {
  message: string;
  /** The text that failed, when it could not be put back in the box. */
  lostText: string | null;
};

/**
 * Scrolls the list so the bottom sentinel is in view. The list is
 * `relative`, so the sentinel's offsetTop is measured from the list itself
 * and this never moves the page, only the list.
 */
function scrollToNewest(list: HTMLDivElement, sentinel: HTMLDivElement) {
  list.scrollTo({ top: sentinel.offsetTop });
}

/**
 * League chat for everyone in the room, spectators included. The list keeps
 * itself scrolled to the newest message while the reader is near the bottom
 * (a bottom sentinel marks the target) and leaves them alone when they have
 * scrolled up to read history. Days are separated when the date changes.
 *
 * The 500-character limit is applied as a character count (`clampChatMessage`,
 * the same count as the database's `char_length`) rather than `maxLength`,
 * which counts UTF-16 code units and would stop an emoji-heavy message at
 * half the real limit; a counter appears as the limit gets close.
 */
const DraftChat = memo(function DraftChat({
  messages,
  membersById,
  myMemberId,
  loading,
  onSend,
  className = "",
}: DraftChatProps) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<SendError | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const nearBottomRef = useRef(true);
  const [todayKey, setTodayKey] = useState("");
  const counterId = useId();
  const charactersLeft = CHAT_MAX_LENGTH - chatLength(draft);
  const showCounter = charactersLeft <= COUNTER_FROM_LEFT;

  // The calendar day is client-only (it depends on the reader's time zone),
  // so it is read after mount rather than during render.
  useEffect(() => {
    const update = () => setTodayKey(new Date().toDateString());
    update();
    const id = setInterval(update, 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!nearBottomRef.current) return;
    const list = listRef.current;
    const sentinel = sentinelRef.current;
    if (!list || !sentinel) return;
    scrollToNewest(list, sentinel);
  }, [messages]);

  // Below `lg` the panel is `display: none` while another panel is showing,
  // so the scroll above is a no-op for every message that arrives then. The
  // list gets a size again the moment it is shown (a tap on the Chat tab, or
  // the viewport crossing `lg`), and that is when it snaps to the newest
  // message; nothing scrolls while the list is hidden, so the reader is
  // still counted as near the bottom.
  useEffect(() => {
    const list = listRef.current;
    if (!list || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (!nearBottomRef.current || list.clientHeight === 0) return;
      const sentinel = sentinelRef.current;
      if (sentinel) scrollToNewest(list, sentinel);
    });
    observer.observe(list);
    return () => observer.disconnect();
  }, []);

  function handleScroll(event: UIEvent<HTMLDivElement>) {
    const list = event.currentTarget;
    nearBottomRef.current =
      list.scrollHeight - list.scrollTop - list.clientHeight < NEAR_BOTTOM_PX;
  }

  /**
   * Puts the caret back in the box after a send. Clicking Send moves focus
   * to the button, which is disabled while pending, so focus falls to the
   * body; a reader who has meanwhile moved somewhere else on the page is
   * left alone.
   */
  function refocusInput() {
    const input = inputRef.current;
    if (!input) return;
    const active = document.activeElement;
    if (active && active !== document.body && !formRef.current?.contains(active)) {
      return;
    }
    input.focus();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;

    setSending(true);
    setError(null);
    // The box clears at once so the next message can be typed while this one
    // is on its way; the input stays enabled so focus (and typing) continue.
    setDraft("");
    // The sender always wants to see their own message, even after scrolling
    // up to read history; the local append lands before `onSend` resolves.
    nearBottomRef.current = true;
    const result = await onSend(text);
    setSending(false);
    refocusInput();

    if (result) {
      // Put the failed text back unless the coach has started the next
      // message; then keep it in the alert so it is not lost. The input is
      // controlled, so its value is the committed draft (state itself cannot
      // be read synchronously here).
      const typedSince = (inputRef.current?.value ?? "") !== "";
      if (!typedSince) setDraft(text);
      setError({ message: result, lostText: typedSince ? text : null });
    }
  }

  const items: ReactNode[] = [];
  let previousDay = "";
  for (const message of messages) {
    const day = chatDayKey(message.created_at);
    if (day !== previousDay) {
      previousDay = day;
      items.push(
        <li
          key={`day-${day}-${message.id}`}
          className="my-1 flex items-center gap-3 text-xs font-semibold uppercase tracking-wide text-faint"
        >
          <span aria-hidden="true" className="h-px flex-1 bg-line" />
          {formatChatDay(message.created_at, todayKey)}
          <span aria-hidden="true" className="h-px flex-1 bg-line" />
        </li>
      );
    }

    const sender = membersById.get(message.member_id);
    const mine = message.member_id === myMemberId;
    items.push(
      <li key={message.id} className="flex flex-col gap-0.5">
        <div className="flex items-baseline justify-between gap-3">
          <p
            className={`truncate text-xs font-semibold ${
              mine ? "text-accent-text" : "text-text"
            }`}
          >
            {sender ? teamNameLabel(sender.team_name) : "Former coach"}
            {mine && <span className="font-normal text-muted"> (you)</span>}
          </p>
          <time
            dateTime={message.created_at}
            className="shrink-0 text-xs tabular-nums text-faint"
          >
            {formatChatTime(message.created_at)}
          </time>
        </div>
        <p className="break-words text-sm text-text">{message.message}</p>
      </li>
    );
  }

  return (
    <section
      aria-labelledby="draft-chat-heading"
      className={`flex flex-col rounded-xl border border-line bg-panel p-4 ${className}`.trim()}
    >
      <h2 id="draft-chat-heading" className="text-lg font-bold text-text">
        Chat
      </h2>

      <div
        ref={listRef}
        onScroll={handleScroll}
        className="relative mt-3 h-80 overflow-y-auto rounded-lg border border-line bg-bg p-3 [scrollbar-width:thin]"
      >
        {messages.length === 0 ? (
          !loading && (
            <p className="text-sm text-muted">
              No messages yet. Say hello to the other coaches.
            </p>
          )
        ) : (
          <ul aria-label="Chat messages" className="flex flex-col gap-3">
            {items}
          </ul>
        )}
        <div ref={sentinelRef} aria-hidden="true" />
      </div>

      {error && (
        <Alert variant="error" className="mt-3" onDismiss={() => setError(null)}>
          <p>{error.message}</p>
          {error.lostText !== null && (
            <p className="mt-1 break-words text-muted">
              Your message was: &ldquo;{error.lostText}&rdquo;
            </p>
          )}
        </Alert>
      )}

      <form
        ref={formRef}
        onSubmit={handleSubmit}
        noValidate
        className="mt-3 flex items-end gap-2"
      >
        <Field label="Message" hideLabel className="min-w-0 flex-1">
          <Input
            ref={inputRef}
            name="message"
            autoComplete="off"
            placeholder="Message the draft room..."
            value={draft}
            onChange={(event) => setDraft(clampChatMessage(event.target.value))}
            aria-describedby={showCounter ? counterId : undefined}
          />
        </Field>
        <Button
          type="submit"
          pending={sending}
          pendingText="Sending..."
          disabled={!draft.trim()}
        >
          Send
        </Button>
      </form>
      {showCounter && (
        <p id={counterId} className="mt-1.5 text-xs text-muted">
          {charactersLeft} of {CHAT_MAX_LENGTH} characters left
        </p>
      )}
    </section>
  );
});

export default DraftChat;

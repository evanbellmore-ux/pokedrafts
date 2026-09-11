"use client";

import { useState } from "react";
import { Alert, Button, ButtonLink, PageHeader, Skeleton } from "@/app/components/ui";
import { teamNameLabel } from "@/app/lib/league/labels";
import CommissionerControls from "./CommissionerControls";
import DraftBoard from "./DraftBoard";
import DraftChat from "./DraftChat";
import {
  DraftHeader,
  DraftStatusBanner,
  LivePill,
  ReconnectNotice,
  SpectatorPill,
} from "./DraftHeader";
import DraftOrderStrip from "./DraftOrderStrip";
import DraftPool from "./DraftPool";
import MobilePanelBar from "./MobilePanelBar";
import RosterPanel from "./RosterPanel";
import type { MobilePanel } from "./draft-room";
import { useDraftRoom } from "./useDraftRoom";

/**
 * Which panel is visible below `lg`; `lg` and up show all four. Applied to a
 * plain wrapper so the panels' own `flex` layout never competes with
 * `hidden` for the display property.
 */
function panelClass(active: MobilePanel, panel: MobilePanel) {
  return active === panel ? "min-w-0" : "hidden min-w-0 lg:block";
}

export default function DraftClient() {
  const room = useDraftRoom();
  const [panel, setPanel] = useState<MobilePanel>("pool");
  const [rosterChoice, setRosterChoice] = useState<string | null>(null);
  /**
   * Messages counted as read: everything present at the first load, then
   * everything on screen whenever the chat panel is showing. Adjusted during
   * render (React's "adjusting state on prop change" pattern), not in an
   * effect.
   */
  const [chatSeen, setChatSeen] = useState<number | null>(null);
  if (room.loaded && (chatSeen === null || (panel === "chat" && chatSeen !== room.chat.length))) {
    setChatSeen(room.chat.length);
  }
  const unreadChat = chatSeen === null ? 0 : Math.max(0, room.chat.length - chatSeen);

  const leagueHref = `/leagues/${room.league.id}`;
  const onClockName = room.onClock ? teamNameLabel(room.onClock.team_name) : null;
  const nextUpName = room.nextUp ? teamNameLabel(room.nextUp.team_name) : null;

  const rosterId =
    rosterChoice !== null && room.coaches.some((coach) => coach.id === rosterChoice)
      ? rosterChoice
      : room.isDrafting
        ? room.me.id
        : (room.coaches[0]?.id ?? "");

  const description =
    room.phase === "setup"
      ? "Coaches pick in snake order once the commissioner starts the draft."
      : room.phase === "completed"
        ? "Every roster is locked in and the match schedule is ready."
        : `Round ${room.round} · Pick ${Math.min(room.currentPick, room.totalPicks)} of ${room.totalPicks}`;

  const header = (
    <PageHeader
      eyebrow="Draft"
      title="Draft room"
      description={description}
      actions={
        <>
          <LivePill status={room.live} />
          {room.loaded && !room.isDrafting && <SpectatorPill />}
        </>
      }
    />
  );

  if (room.loading && !room.loaded) {
    return (
      <>
        {header}
        <div aria-busy="true" className="mt-6 flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </div>
          <Skeleton className="h-11" />
          <Skeleton className="h-16" />
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <div className="flex flex-col gap-4">
              <Skeleton className="h-48" />
              <Skeleton className="h-96" />
            </div>
            <div className="flex flex-col gap-4">
              <Skeleton className="h-64" />
              <Skeleton className="h-96" />
            </div>
          </div>
        </div>
      </>
    );
  }

  const retryAction = (
    <Button size="sm" variant="secondary" onClick={room.retry}>
      Retry
    </Button>
  );

  if (room.loadError && !room.loaded) {
    return (
      <>
        {header}
        <Alert variant="error" className="mt-6" action={retryAction}>
          {room.loadError}
        </Alert>
      </>
    );
  }

  return (
    <>
      {header}

      <div className="mt-6 flex flex-col gap-4">
        {room.loadError && (
          <Alert variant="error" action={retryAction}>
            {room.loadError}
          </Alert>
        )}

        {room.live === "reconnecting" && <ReconnectNotice />}

        {room.dexError && (
          <Alert
            variant="error"
            action={
              <Button size="sm" variant="secondary" onClick={room.retryDex}>
                Retry
              </Button>
            }
          >
            Pokémon sprites and types could not be loaded ({room.dexError}).
            You can still draft by name and points.
          </Alert>
        )}

        <DraftHeader
          phase={room.phase}
          round={room.round}
          currentPick={room.currentPick}
          totalPicks={room.totalPicks}
          picksMade={room.picks.length}
          onClockName={onClockName}
          myBudget={room.myBudget}
          timer={{
            phase: room.phase,
            secondsLeft: room.secondsLeft,
            pickTimerSeconds: room.league.pick_timer_seconds,
            clockSynced: room.clockSynced,
            autoPickInProgress: room.league.auto_pick_in_progress,
            autoPickError: room.autoPickError,
            isMyTurn: room.isMyTurn,
          }}
        />

        <DraftStatusBanner
          live={room.live}
          phase={room.phase}
          isMyTurn={room.isMyTurn}
          onClockName={onClockName}
        />

        {room.notice && (
          <Alert variant={room.notice.variant} onDismiss={room.dismissNotice}>
            {room.notice.text}
          </Alert>
        )}

        {room.completed && (
          <Alert variant="success" title="Draft complete">
            <p>Teams are saved and the schedule has been generated.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <ButtonLink href={`${leagueHref}/team`} size="sm">
                My Team
              </ButtonLink>
              <ButtonLink href={`${leagueHref}/matches`} size="sm" variant="secondary">
                Matches
              </ButtonLink>
            </div>
          </Alert>
        )}

        {room.isCommissioner && (
          <CommissionerControls
            phase={room.phase}
            leagueName={room.league.name}
            currentPick={room.currentPick}
            startBlock={room.startBlock}
            canFinalize={room.canFinalize}
            finalizeNote={room.finalizeNote}
            lastPick={room.lastPick}
            onClock={room.onClock}
            membersById={room.membersById}
            legalForOnClock={room.legalForOnClock}
            pendingAction={room.pendingAction}
            onStart={room.startDraft}
            onPause={room.pauseDraft}
            onResume={room.resumeDraft}
            onUndo={room.undoLastPick}
            onForce={room.forcePick}
            onFinalize={room.finalizeDraft}
            onReset={room.resetDraft}
          />
        )}

        {room.coaches.length === 0 && !room.isCommissioner && !room.started && (
          <Alert variant="info">
            The commissioner has not set a draft order yet. You can chat while
            you wait.
          </Alert>
        )}

        <DraftOrderStrip
          coaches={room.coaches}
          round={room.round}
          onClockId={room.onClock?.id ?? null}
          nextUpId={room.nextUp?.id ?? null}
          nextUpName={nextUpName}
          myId={room.me.id}
          budgets={room.budgets}
          draftLive={room.draftLive}
        />

        <MobilePanelBar active={panel} onChange={setPanel} unreadChat={unreadChat} />

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="flex min-w-0 flex-col gap-6">
            <div className={panelClass(panel, "roster")}>
              <RosterPanel
                coaches={room.coaches}
                picks={room.picks}
                picksPerTeam={room.picksPerTeam}
                budgets={room.budgets}
                selectedId={rosterId}
                onSelect={setRosterChoice}
                myId={room.me.id}
              />
            </div>
            <div className={panelClass(panel, "pool")}>
              <DraftPool
                undrafted={room.undrafted}
                poolSize={room.pool.length}
                blocks={room.myBlocks}
                legalCount={room.legalForMe.length}
                isDrafting={room.isDrafting}
                isMyTurn={room.isMyTurn}
                canPick={room.isMyTurn && room.phase === "live"}
                pendingAction={room.pendingAction}
                onPick={room.makePick}
                loading={room.loading}
              />
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-6">
            <div className={panelClass(panel, "board")}>
              <DraftBoard board={room.board} loading={room.loading} />
            </div>
            <div className={panelClass(panel, "chat")}>
              <DraftChat
                messages={room.chat}
                membersById={room.membersById}
                myMemberId={room.me.id}
                loading={room.loading}
                onSend={room.sendChat}
              />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

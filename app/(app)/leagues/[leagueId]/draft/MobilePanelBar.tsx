"use client";

import { MOBILE_PANELS, type MobilePanel } from "./draft-room";

export type MobilePanelBarProps = {
  active: MobilePanel;
  onChange: (panel: MobilePanel) => void;
  /** Messages that arrived while the chat panel was not showing. */
  unreadChat?: number;
};

/**
 * Roster / Pool / Board / Chat switcher for small screens. Sticky under the
 * app header (docs section 8.5; AppNav publishes its measured height) and
 * hidden from `lg` up, where every panel is visible at once. The buttons are
 * toggles, so they expose `aria-pressed`.
 */
export default function MobilePanelBar({
  active,
  onChange,
  unreadChat = 0,
}: MobilePanelBarProps) {
  return (
    <nav
      aria-label="Draft room panels"
      className="sticky top-[var(--app-nav-height,4rem)] z-30 bg-bg py-2 lg:hidden"
    >
      <div className="grid grid-cols-4 gap-1 rounded-xl border border-line bg-panel p-1">
        {MOBILE_PANELS.map((panel) => {
          const pressed = active === panel.id;
          return (
            <button
              key={panel.id}
              type="button"
              aria-pressed={pressed}
              onClick={() => onChange(panel.id)}
              className={`rounded-lg px-2 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
                pressed
                  ? "bg-accent text-on-accent"
                  : "text-muted hover:bg-panel-hover hover:text-text"
              }`}
            >
              {panel.label}
              {panel.id === "chat" && unreadChat > 0 && (
                <span className="ml-1 text-xs font-normal">
                  <span aria-hidden="true">({unreadChat})</span>
                  <span className="sr-only">
                    , {unreadChat} new {unreadChat === 1 ? "message" : "messages"}
                  </span>
                </span>
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

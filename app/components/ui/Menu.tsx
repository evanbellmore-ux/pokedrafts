"use client";

import Link from "next/link";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ComponentProps,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";

type MenuContextValue = {
  /** Closes the panel; `focusTrigger` hands focus back to the trigger. */
  close: (focusTrigger?: boolean) => void;
};

const MenuContext = createContext<MenuContextValue>({ close: () => undefined });

const FOCUSABLE = "a[href], button:not([disabled]), select:not([disabled]), input:not([disabled])";

export type MenuProps = {
  /** Accessible name of the trigger, e.g. "Options for <league>". */
  label: string;
  /** What the trigger shows: an icon or an avatar. */
  trigger: ReactNode;
  triggerClassName?: string;
  /** Which edge of the trigger the panel lines up with. */
  align?: "start" | "end";
  panelClassName?: string;
  className?: string;
  children: ReactNode;
};

/**
 * A disclosure menu: a button (`aria-expanded`, `aria-controls`) that shows
 * a small panel of ordinary buttons and links, reached with Tab. It is not
 * an ARIA `menu`, so no arrow-key contract is implied. Escape closes it and
 * returns focus to the trigger; a click outside or focus moving out closes
 * it. A keyboard press on the trigger moves focus to the first item.
 */
export default function Menu({
  label,
  trigger,
  triggerClassName = "",
  align = "end",
  panelClassName = "",
  className = "",
  children,
}: MenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const focusFirstRef = useRef(false);
  const panelId = useId();

  const close = useCallback((focusTrigger = false) => {
    setOpen(false);
    if (focusTrigger) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    if (focusFirstRef.current) {
      focusFirstRef.current = false;
      rootRef.current?.querySelector<HTMLElement>(`[data-menu-panel] :is(${FOCUSABLE})`)?.focus();
    }
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function onTriggerClick(event: MouseEvent<HTMLButtonElement>) {
    // `detail` is 0 when Enter or Space pressed the button.
    focusFirstRef.current = !open && event.detail === 0;
    setOpen(!open);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Escape" || !open) return;
    event.stopPropagation();
    close(true);
  }

  function onBlur(event: FocusEvent<HTMLDivElement>) {
    const next = event.relatedTarget;
    if (open && next instanceof Node && !rootRef.current?.contains(next)) {
      setOpen(false);
    }
  }

  return (
    <MenuContext.Provider value={{ close }}>
      <div
        ref={rootRef}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
        className={`relative ${open ? "z-30" : "z-10"} ${className}`.trim()}
      >
        <button
          ref={triggerRef}
          type="button"
          aria-label={label}
          title={label}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={onTriggerClick}
          className={`${triggerClassName} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus`.trim()}
        >
          {trigger}
        </button>
        <div
          id={panelId}
          data-menu-panel=""
          hidden={!open}
          className={`absolute top-full mt-2 ${
            align === "end" ? "right-0 origin-top-right" : "left-0 origin-top-left"
          } rounded-xl border border-hairline-strong bg-panel p-1.5 shadow-2xl shadow-black/50 transition duration-150 ease-out starting:scale-95 starting:opacity-0 motion-reduce:transition-none ${panelClassName}`.trim()}
        >
          {children}
        </div>
      </div>
    </MenuContext.Provider>
  );
}

const itemBase =
  "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-60";

const itemTones = {
  default: "text-text hover:bg-panel-hover",
  danger: "text-danger hover:bg-danger-soft",
};

export type MenuItemProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: keyof typeof itemTones;
  /** Leave the panel open after the click (e.g. a pending action). */
  keepOpen?: boolean;
};

/**
 * A button inside a Menu. It closes the panel and hands focus back to the
 * trigger before running `onClick`, so a Dialog opened from it records the
 * trigger as its opener and returns focus there.
 */
export function MenuItem({
  tone = "default",
  keepOpen = false,
  className = "",
  onClick,
  type = "button",
  ...rest
}: MenuItemProps) {
  const { close } = useContext(MenuContext);
  return (
    <button
      type={type}
      onClick={(event) => {
        if (!keepOpen) close(true);
        onClick?.(event);
      }}
      className={`${itemBase} ${itemTones[tone]} ${className}`.trim()}
      {...rest}
    />
  );
}

/** A link inside a Menu; it closes the panel when followed. */
export function MenuLink({ className = "", onClick, ...rest }: ComponentProps<typeof Link>) {
  const { close } = useContext(MenuContext);
  return (
    <Link
      onClick={(event) => {
        close();
        onClick?.(event);
      }}
      className={`${itemBase} ${itemTones.default} ${className}`.trim()}
      {...rest}
    />
  );
}

/** A hairline between groups of items. */
export function MenuSeparator() {
  return <div role="separator" className="-mx-1.5 my-1.5 h-px bg-hairline" />;
}

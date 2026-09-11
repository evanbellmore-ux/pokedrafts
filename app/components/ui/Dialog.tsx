"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import Button from "@/app/components/ui/Button";
import Field from "@/app/components/ui/Field";
import Input from "@/app/components/ui/Input";

export type DialogProps = {
  open: boolean;
  /** Called when the user cancels (Escape, backdrop, Cancel button). */
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** Confirm button; omit for an informational dialog. */
  onConfirm?: () => void | Promise<void>;
  confirmLabel?: ReactNode;
  cancelLabel?: ReactNode;
  /** Styles the confirm button as destructive. */
  danger?: boolean;
  /** When set, the user must type this exact text to enable Confirm. */
  confirmText?: string;
  /** Label for the typed-confirmation field. */
  confirmFieldLabel?: ReactNode;
  pending?: boolean;
  /** Error rendered inside the dialog (e.g. from the confirm action). */
  error?: ReactNode;
};

/**
 * Native <dialog> modal: focus is trapped by the platform, Escape closes,
 * backdrop click closes, and focus returns to the opener on close.
 */
export default function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  onConfirm,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
  confirmText,
  confirmFieldLabel,
  pending = false,
  error,
}: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const [typed, setTyped] = useState("");
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      openerRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      setTyped("");
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    function handleCancel(event: Event) {
      event.preventDefault();
      if (!pending) onClose();
    }

    function handleClose() {
      const opener = openerRef.current;
      openerRef.current = null;
      if (opener && document.contains(opener)) opener.focus();
    }

    dialog.addEventListener("cancel", handleCancel);
    dialog.addEventListener("close", handleClose);
    return () => {
      dialog.removeEventListener("cancel", handleCancel);
      dialog.removeEventListener("close", handleClose);
    };
  }, [onClose, pending]);

  const confirmEnabled =
    !pending && (confirmText === undefined || typed.trim() === confirmText);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!confirmEnabled || !onConfirm) return;
    void onConfirm();
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onClick={(event) => {
        if (event.target === event.currentTarget && !pending) onClose();
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-xl border border-line bg-panel p-0 text-text shadow-2xl backdrop:bg-black/70"
    >
      <form method="dialog" onSubmit={handleSubmit} className="p-6">
        {/* Titles and descriptions carry user-entered names (league, team,
            Pokémon); `wrap-anywhere` keeps them inside a 375px dialog. */}
        <h2 id={titleId} className="wrap-anywhere text-lg font-bold">
          {title}
        </h2>
        {description && (
          <p id={descriptionId} className="mt-2 wrap-anywhere text-sm text-muted">
            {description}
          </p>
        )}

        {children && <div className="mt-4">{children}</div>}

        {confirmText !== undefined && (
          <div className="mt-4">
            <Field
              label={
                confirmFieldLabel ?? (
                  <>
                    Type <span className="font-mono">{confirmText}</span> to
                    confirm
                  </>
                )
              }
            >
              <Input
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                autoComplete="off"
                autoFocus
                disabled={pending}
              />
            </Field>
          </div>
        )}

        {error && (
          <p role="alert" className="mt-4 wrap-anywhere text-sm font-medium text-danger">
            {error}
          </p>
        )}

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={pending}
          >
            {cancelLabel}
          </Button>
          {onConfirm && (
            <Button
              type="submit"
              variant={danger ? "danger" : "primary"}
              disabled={!confirmEnabled}
              pending={pending}
            >
              {confirmLabel}
            </Button>
          )}
        </div>
      </form>
    </dialog>
  );
}

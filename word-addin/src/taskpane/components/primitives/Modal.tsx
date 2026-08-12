import React, { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "../../../shared/lib/utils";
import { PillButton } from "./PillButton";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  parentLabel?: string;
  children: ReactNode;
  primaryAction?: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
    icon?: ReactNode;
  };
  secondaryAction?: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
    icon?: ReactNode;
  };
  className?: string;
}

/**
 * Word-pane modal primitive adapted from frontend/components/modals/Modal.
 * It preserves the frontend's translucent surface, rounded shell, overlay,
 * close control, and pill-button footer while fitting a narrow task pane.
 */
export function Modal({
  open,
  onClose,
  title,
  parentLabel = "Assistant",
  children,
  primaryAction,
  secondaryAction,
  className,
}: ModalProps): React.ReactElement | null {
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    const focusable = (): HTMLElement[] =>
      dialog
        ? Array.from(
            dialog.querySelectorAll<HTMLElement>(
              'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
            ),
          ).filter((element) => !element.hasAttribute("hidden"))
        : [];
    window.requestAnimationFrame(() => {
      const target =
        focusable().find((element) => element.hasAttribute("autofocus")) ??
        focusable()[0] ??
        dialog;
      target?.focus();
    });
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) {
        event.preventDefault();
        dialog?.focus();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus();
    };
  }, [onClose, open]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-white/10 px-3 py-4 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn(
          "flex h-[min(560px,calc(100vh-2rem))] w-full max-w-xl flex-col rounded-3xl border border-white/70 bg-gray-50/95 shadow-[0_14px_40px_rgba(15,23,42,0.101),0_5px_14px_rgba(15,23,42,0.067)] backdrop-blur-3xl",
          className,
        )}
      >
        <header className="flex items-center justify-between gap-3 p-4 pl-5">
          <div className="flex min-w-0 items-center gap-1.5 text-xs leading-none text-gray-400">
            <span>{parentLabel}</span>
            <span>›</span>
            <span className="truncate text-gray-700">{title}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/70 bg-white/55 text-gray-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.75),inset_0_-1px_0_rgba(255,255,255,0.55),0_6px_18px_rgba(15,23,42,0.08)] backdrop-blur-xl transition-colors hover:bg-white/75 hover:text-gray-700"
            aria-label="Close"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </header>
        <div className="flex min-h-0 flex-1 flex-col px-5">{children}</div>
        {(primaryAction || secondaryAction) && (
          <footer
            className={`flex items-center gap-3 border-t border-white/60 p-3 ${
              secondaryAction ? "justify-between" : "justify-end"
            }`}
          >
            {secondaryAction && (
              <PillButton
                tone="blue"
                size="normal"
                onClick={secondaryAction.onClick}
                disabled={secondaryAction.disabled}
              >
                {secondaryAction.icon}
                {secondaryAction.label}
              </PillButton>
            )}
            {primaryAction && (
              <PillButton
                tone="black"
                size="normal"
                onClick={primaryAction.onClick}
                disabled={primaryAction.disabled}
              >
                {primaryAction.icon}
                {primaryAction.label}
              </PillButton>
            )}
          </footer>
        )}
      </section>
    </div>,
    document.body,
  );
}

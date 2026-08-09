import React, { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { EDIT_SECTION_SURFACE } from "./messageStyles";

interface EditCardsSectionProps {
  summary: string;
  /**
   * Caller-owned grouped actions, typically Accept all and Reject all
   * PillButtons. The section deliberately owns no mutation behavior.
   */
  actions?: ReactNode;
  /** Accessible name for the grouped action row. */
  actionsLabel?: string;
  children: ReactNode;
}

/**
 * Duplicated from the web app's EditCardsSection: a white glass container
 * with a tracked-change summary, a caller-supplied grouped actions row, and a
 * chevron-collapsible list of EditCards.
 */
export function EditCardsSection({
  summary,
  actions,
  actionsLabel = "Tracked change actions",
  children,
}: EditCardsSectionProps): React.ReactElement {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <div className={`${EDIT_SECTION_SURFACE} overflow-hidden`}>
      <div className="flex items-center gap-2 px-3 pt-3">
        <p className="flex-1 min-w-0 text-sm font-serif text-gray-700 truncate">
          {summary}
        </p>
        <button
          type="button"
          onClick={() => setIsOpen((v) => !v)}
          aria-label={isOpen ? "Collapse edits" : "Expand edits"}
          className="shrink-0 rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-800 transition-colors"
        >
          <ChevronDown
            className={`h-4 w-4 transition-transform duration-200 ${isOpen ? "" : "-rotate-90"}`}
          />
        </button>
      </div>
      {actions && (
        <div
          className="flex flex-wrap items-center gap-2 px-3 pt-3"
          role="group"
          aria-label={actionsLabel}
        >
          {actions}
        </div>
      )}
      {isOpen && (
        <div className="flex flex-col gap-2 px-3 pb-3 pt-3">{children}</div>
      )}
      {!isOpen && <div className="pb-3" />}
    </div>
  );
}

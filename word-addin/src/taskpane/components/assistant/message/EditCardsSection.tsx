import React, { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { EDIT_SECTION_SURFACE } from "./messageStyles";

interface EditCardsSectionProps {
  summary: string;
  actions?: ReactNode;
  actionsLabel?: string;
  children: ReactNode;
}

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
        <p className="min-w-0 flex-1 truncate font-serif text-sm text-gray-700">
          {summary}
        </p>
        <button
          type="button"
          onClick={() => setIsOpen((value) => !value)}
          aria-label={isOpen ? "Collapse edits" : "Expand edits"}
          className="shrink-0 rounded p-1 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800"
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
      {isOpen ? (
        <div className="flex flex-col gap-2 px-3 pb-3 pt-3">{children}</div>
      ) : (
        <div className="pb-3" />
      )}
    </div>
  );
}

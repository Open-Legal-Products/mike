import React, { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { RESPONSE_GLASS_SURFACE } from "./message/messageStyles";

/**
 * Duplicated from the web app's assistant PreResponseWrapper so the pane's
 * pre-answer activity (reading the document, working indicator) collapses
 * into the same "Completed in N steps" glass strip users know from the web.
 * `compact` typography is the default here — the task pane is a narrow
 * side panel, same as the web's TR chat.
 */
export function PreResponseWrapper({
  children,
  stepCount,
  shouldMinimize,
  isStreaming,
}: {
  children: React.ReactNode;
  stepCount: number;
  shouldMinimize: boolean;
  isStreaming: boolean;
}): React.ReactElement {
  const [userToggled, setUserToggled] = useState(false);
  const [isOpen, setIsOpen] = useState(!shouldMinimize);
  // Once content has streamed in (shouldMinimize=true even once), stay
  // minimized even if a later render briefly evaluates shouldMinimize=false.
  const hasMinimizedRef = useRef(shouldMinimize);

  useEffect(() => {
    if (shouldMinimize) hasMinimizedRef.current = true;
    if (userToggled) return;
    setIsOpen(!shouldMinimize && !hasMinimizedRef.current);
  }, [shouldMinimize, userToggled]);

  const stepWord = `step${stepCount === 1 ? "" : "s"}`;
  const label = isStreaming
    ? "Working"
    : `Completed in ${stepCount} ${stepWord}`;

  return (
    <div className={`${RESPONSE_GLASS_SURFACE} px-3 py-2`}>
      <button
        type="button"
        onClick={() => {
          setUserToggled(true);
          setIsOpen((v) => !v);
        }}
        className="w-full flex items-center justify-between font-serif text-gray-500 hover:text-gray-700 transition-colors text-xs"
      >
        <span className="flex items-baseline min-w-0">
          <span className="truncate">{label}</span>
          {isStreaming && (
            <span className="inline-flex ml-1 shrink-0 items-baseline">
              <span className="w-0.5 h-0.5 rounded-full bg-gray-400 mr-0.5 animate-[bounce_1.4s_infinite_0s]" />
              <span className="w-0.5 h-0.5 rounded-full bg-gray-400 mr-0.5 animate-[bounce_1.4s_infinite_0.2s]" />
              <span className="w-0.5 h-0.5 rounded-full bg-gray-400 animate-[bounce_1.4s_infinite_0.4s]" />
            </span>
          )}
        </span>
        <ChevronDown
          size={12}
          className={`relative top-px shrink-0 ml-2 transition-transform duration-200 ${isOpen ? "" : "-rotate-90"}`}
        />
      </button>
      {isOpen && <div className="mt-3 flex flex-col gap-2.5">{children}</div>}
    </div>
  );
}

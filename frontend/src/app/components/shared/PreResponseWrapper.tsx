"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";

export function PreResponseWrapper({
  children,
  stepCount,
  shouldMinimize,
  isStreaming,
  compact = false,
}: {
  children: React.ReactNode;
  stepCount: number;
  shouldMinimize: boolean;
  isStreaming: boolean;
  /** Tighter typography + child gap for narrow side panels (e.g. TR chat). */
  compact?: boolean;
}) {
  // Once content has streamed in (shouldMinimize=true even once), stay
  // minimized even if a later render briefly evaluates shouldMinimize=false.
  // Without this latch, the wrapper visibly pops open when isStreaming
  // flips off at the end of the response. Latch via state (not a ref) so
  // it's compatible with react-hooks render-purity rules.
  const [hasEverMinimized, setHasEverMinimized] = useState(shouldMinimize);
  const [prevShouldMinimize, setPrevShouldMinimize] = useState(shouldMinimize);
  if (shouldMinimize !== prevShouldMinimize) {
    setPrevShouldMinimize(shouldMinimize);
    if (shouldMinimize) setHasEverMinimized(true);
  }

  // Null = follow the latched signal; boolean = the user explicitly opened
  // or closed it.
  const [userOpenOverride, setUserOpenOverride] = useState<boolean | null>(null);
  const isOpen =
    userOpenOverride !== null ? userOpenOverride : !shouldMinimize && !hasEverMinimized;

  const stepWord = `step${stepCount === 1 ? "" : "s"}`;
  const label = isStreaming ? "Working" : `Completed in ${stepCount} ${stepWord}`;

  const buttonTextClass = compact ? "text-xs" : "text-sm";
  const childrenGapClass = compact ? "gap-2.5" : "gap-4";

  return (
    <div className="border border-gray-200 rounded-lg px-3 py-2">
      <button
        type="button"
        onClick={() => setUserOpenOverride(!isOpen)}
        className={`w-full flex items-center justify-between font-serif text-gray-500 hover:text-gray-700 transition-colors ${buttonTextClass}`}
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
          className={`shrink-0 ml-2 transition-transform duration-200 ${isOpen ? "" : "-rotate-90"}`}
        />
      </button>
      {isOpen && <div className={`mt-3 flex flex-col ${childrenGapClass}`}>{children}</div>}
    </div>
  );
}

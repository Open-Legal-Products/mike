import { useEffect, useRef, useState } from "react";
import { MikeIcon } from "../../../../shared/chat/mike-icon";

export type StatusState = "active" | "error" | null;

/**
 * Mirrors the web assistant's response marker: Mike spins while the response
 * is active, flashes green when it finishes, and turns red on an error.
 */
export function ResponseStatus({
  status,
}: {
  status: StatusState;
}): React.ReactElement {
  const [showDone, setShowDone] = useState(false);
  const [doneVisible, setDoneVisible] = useState(false);
  const wasActiveRef = useRef(false);

  const isActive = status === "active";
  const isError = status === "error";

  useEffect(() => {
    const wasActive = wasActiveRef.current;
    wasActiveRef.current = isActive;

    let frame = 0;
    let doneTimeout = 0;
    if (wasActive && !isActive) {
      frame = window.requestAnimationFrame(() => {
        setShowDone(true);
        setDoneVisible(true);
        doneTimeout = window.setTimeout(() => setDoneVisible(false), 1500);
      });
    } else if (!wasActive && isActive) {
      frame = window.requestAnimationFrame(() => {
        setShowDone(false);
        setDoneVisible(false);
      });
    }

    return () => {
      window.cancelAnimationFrame(frame);
      if (doneTimeout) window.clearTimeout(doneTimeout);
    };
  }, [isActive]);

  return (
    <div
      data-testid="assistant-response-status"
      className="mb-2 flex h-9 w-full items-center"
    >
      <MikeIcon
        spin={isActive}
        done={showDone && doneVisible}
        error={isError}
        mike={!isError && !(showDone && doneVisible)}
        size={22}
      />
    </div>
  );
}

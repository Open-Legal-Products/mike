import React from "react";
import { MikeIcon } from "@mike/shared/chat/mike-icon";

/** Preserved word-add-in logo lockup for surfaces that still need branding. */
export function WordAddinLogo(): React.ReactElement {
  return (
    <div className="flex items-center gap-1.5">
      <MikeIcon size={22} />
      <span className="font-serif text-2xl font-light text-foreground">
        Mike
      </span>
    </div>
  );
}

import * as React from "react";

import { cn } from "../lib/utils";

function Button({
  className,
  ...props
}: React.ComponentProps<"button">): React.ReactElement {
  return (
    <button
      data-slot="button"
      className={cn(
        "inline-flex h-9 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-all hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50 outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
        className
      )}
      {...props}
    />
  );
}

export { Button };

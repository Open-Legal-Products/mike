import React from "react";
import { cn } from "../../../shared/lib/utils";

export function PageTitle({
  className,
  ...props
}: React.ComponentProps<"h1">): React.ReactElement {
  return (
    <h1
      className={cn(
        "font-serif text-2xl font-medium text-gray-900",
        className
      )}
      {...props}
    />
  );
}

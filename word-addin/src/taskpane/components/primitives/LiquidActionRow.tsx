import React from "react";
import { cn } from "@mike/shared/lib/utils";

export function LiquidActionRow({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}): React.ReactElement {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-2 rounded-full border border-white/70 bg-app-surface px-1 py-1 shadow-[0_8px_24px_rgba(15,23,42,0.06)] backdrop-blur-2xl",
        className
      )}
    >
      {children}
    </div>
  );
}

export function LiquidIconButton({
  className,
  type = "button",
  ...props
}: React.ComponentProps<"button">): React.ReactElement {
  return (
    <button
      type={type}
      className={cn(
        "flex h-7 w-7 cursor-pointer items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-app-surface-hover hover:text-gray-900 active:bg-app-surface-active disabled:cursor-default disabled:text-gray-300",
        className
      )}
      {...props}
    />
  );
}

import React from "react";
import {
  History,
  LogOut,
  Menu,
  Plus,
} from "lucide-react";
import {
  LiquidActionRow,
  LiquidIconButton,
} from "./primitives/LiquidActionRow";
import chatIcon from "../../../../frontend/public/icons/app-sidebar/chat.svg";
import quickActionsIcon from "../../../../frontend/public/icons/app-sidebar/quick-actions.svg";
import workflowIcon from "../../../../frontend/public/icons/app-sidebar/workflow.svg";
import {
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownTrigger,
} from "./primitives/Dropdown";

export type AddinSection = "chat" | "actions" | "workflows";

interface FloatingHeaderProps {
  section: AddinSection;
  onSectionChange: (section: AddinSection) => void;
  onNewChat: () => void;
  onOpenHistory: () => void;
  onSignOut: () => void;
}

const SECTIONS = [
  { value: "chat" as const, label: "Assistant", icon: chatIcon },
  {
    value: "actions" as const,
    label: "Quick Actions",
    icon: quickActionsIcon,
  },
  { value: "workflows" as const, label: "Workflows", icon: workflowIcon },
];

export function FloatingHeader({
  section,
  onSectionChange,
  onNewChat,
  onOpenHistory,
  onSignOut,
}: FloatingHeaderProps): React.ReactElement {
  return (
    <header
      data-testid="floating-header"
      className="pointer-events-none absolute inset-x-0 top-0 z-40 flex items-center justify-between gap-3 p-3"
    >
      <Dropdown>
        <LiquidActionRow className="pointer-events-auto">
          <DropdownTrigger asChild>
            <LiquidIconButton aria-label="Open menu" title="Menu">
              <Menu className="h-4 w-4" />
            </LiquidIconButton>
          </DropdownTrigger>
        </LiquidActionRow>
        <DropdownContent align="start" sideOffset={8} className="min-w-44">
          {SECTIONS.map((item) => {
            return (
              <DropdownItem
                key={item.value}
                onSelect={() => onSectionChange(item.value)}
                selected={section === item.value}
              >
                <img
                  src={item.icon}
                  alt=""
                  aria-hidden="true"
                  draggable={false}
                  className="h-4 w-4 shrink-0 object-contain"
                />
                <span className="min-w-0 flex-1">{item.label}</span>
              </DropdownItem>
            );
          })}
          <DropdownItem
            onSelect={onSignOut}
            className="text-gray-500 hover:text-gray-800"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign out
          </DropdownItem>
        </DropdownContent>
      </Dropdown>

      {section === "chat" && (
        <LiquidActionRow className="pointer-events-auto">
          <LiquidIconButton
            onClick={onNewChat}
            aria-label="New chat"
            title="New chat"
          >
            <Plus className="h-4 w-4" />
          </LiquidIconButton>
          <LiquidIconButton
            onClick={onOpenHistory}
            aria-label="Chat history"
            title="Chat history"
          >
            <History className="h-4 w-4" />
          </LiquidIconButton>
        </LiquidActionRow>
      )}
    </header>
  );
}

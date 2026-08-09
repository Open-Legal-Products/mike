import React, { useState } from "react";
import type { Message } from "../../types";
import { Check, ChevronLeft, Ellipsis, Menu, Plus, X } from "lucide-react";
import {
  LiquidActionRow,
  LiquidIconButton,
  LiquidTextButton,
} from "../primitives/LiquidActionRow";
import chatIcon from "../../../../../frontend/public/icons/app-sidebar/chat.svg";
import quickActionsIcon from "../../../../../frontend/public/icons/app-sidebar/quick-actions.svg";
import workflowIcon from "../../../../../frontend/public/icons/app-sidebar/workflow.svg";
import chatHistoryIcon from "../../../../../frontend/public/icons/app-sidebar/chat-history.svg";
import settingsIcon from "../../../../../frontend/public/icons/app-sidebar/settings.svg";
import { ChatHistoryDropdown } from "../history/ChatHistoryDropdown";
import {
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownTrigger,
} from "../primitives/Dropdown";
import type { WordChatStorageMode } from "../../lib/wordChatSettings";

export type AddinSection =
  | "chat"
  | "actions"
  | "workflows"
  | "history"
  | "settings";

interface FloatingHeaderProps {
  section: AddinSection;
  onSectionChange: (section: AddinSection) => void;
  onNewChat: () => void;
  onSelectHistoryChat: (chatId: string, messages: Message[]) => void;
  workflowDetailOpen?: boolean;
  onWorkflowBack?: () => void;
  onOpenWorkflowDetails?: () => void;
  onUseWorkflow?: () => void;
  onNewWorkflow?: () => void;
  wordDocumentId: string;
  wordChatStorage: WordChatStorageMode;
  wordChatOwnerId: string;
}

const SECTIONS = [
  { value: "chat" as const, label: "Assistant", icon: chatIcon },
  {
    value: "history" as const,
    label: "Chat History",
    icon: chatHistoryIcon,
  },
  {
    value: "actions" as const,
    label: "Quick Actions",
    icon: quickActionsIcon,
  },
  { value: "workflows" as const, label: "Workflows", icon: workflowIcon },
  { value: "settings" as const, label: "Settings", icon: settingsIcon },
];

export function FloatingHeader({
  section,
  onSectionChange,
  onNewChat,
  onSelectHistoryChat,
  workflowDetailOpen = false,
  onWorkflowBack,
  onOpenWorkflowDetails,
  onUseWorkflow,
  onNewWorkflow,
  wordDocumentId,
  wordChatStorage,
  wordChatOwnerId,
}: FloatingHeaderProps): React.ReactElement {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header
      data-testid="floating-header"
      className="pointer-events-none absolute inset-x-0 top-0 z-40 isolate flex items-center justify-between gap-3 p-3"
    >
      {/* Content fades out under the header. A single blurred pane ends on a
          visible seam however softly it is masked, so the blur is ramped down
          in stages: each layer blurs what the layer above already blurred and
          is masked out higher up, leaving no edge to catch the eye. */}
      <div
        aria-hidden="true"
        data-testid="header-scrim"
        className="pointer-events-none absolute inset-x-0 -bottom-2 top-0 z-0"
      >
        <div className="absolute inset-0 backdrop-blur-[1px] [mask-image:linear-gradient(to_bottom,black_0%,black_55%,transparent_100%)]" />
        <div className="absolute inset-0 backdrop-blur-[2px] [mask-image:linear-gradient(to_bottom,black_0%,black_35%,transparent_78%)]" />
        <div className="absolute inset-0 backdrop-blur-[4px] [mask-image:linear-gradient(to_bottom,black_0%,black_20%,transparent_56%)]" />
        <div className="absolute inset-0 backdrop-blur-[8px] [mask-image:linear-gradient(to_bottom,black_0%,black_8%,transparent_34%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(255,255,255,0.85)_0%,rgba(255,255,255,0.62)_48%,rgba(255,255,255,0.22)_76%,rgba(255,255,255,0)_100%)]" />
      </div>

      <div className="relative z-10 flex items-center gap-2">
        <Dropdown open={menuOpen} onOpenChange={setMenuOpen}>
          <LiquidActionRow className="pointer-events-auto">
            <DropdownTrigger asChild>
              <LiquidIconButton
                aria-label={menuOpen ? "Close menu" : "Open menu"}
                title={menuOpen ? "Close menu" : "Menu"}
              >
                {menuOpen ? (
                  <X className="h-4 w-4" />
                ) : (
                  <Menu className="h-4 w-4" />
                )}
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
          </DropdownContent>
        </Dropdown>
        {workflowDetailOpen && (
          <LiquidActionRow
            data-testid="workflow-back-bubble"
            className="pointer-events-auto"
          >
            <LiquidTextButton
              onClick={onWorkflowBack}
              aria-label="Back to workflows"
              title="Back to workflows"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Workflows
            </LiquidTextButton>
          </LiquidActionRow>
        )}
      </div>

      {section === "chat" ? (
        <LiquidActionRow className="pointer-events-auto relative z-10">
          <LiquidIconButton
            onClick={onNewChat}
            aria-label="New chat"
            title="New chat"
          >
            <Plus className="h-4 w-4" />
          </LiquidIconButton>
          <ChatHistoryDropdown
            onSelect={onSelectHistoryChat}
            documentId={wordDocumentId}
            ownerId={wordChatOwnerId}
            storageMode={wordChatStorage}
          />
        </LiquidActionRow>
      ) : workflowDetailOpen ? (
        <LiquidActionRow className="pointer-events-auto relative z-10">
          <LiquidIconButton
            onClick={onOpenWorkflowDetails}
            aria-label="Workflow details"
            title="Workflow details"
          >
            <Ellipsis className="h-4 w-4" />
          </LiquidIconButton>
          <LiquidTextButton onClick={onUseWorkflow}>
            <Check className="h-3.5 w-3.5" />
            Use
          </LiquidTextButton>
        </LiquidActionRow>
      ) : section === "workflows" ? (
        <LiquidActionRow className="pointer-events-auto relative z-10">
          <LiquidIconButton
            onClick={onNewWorkflow}
            aria-label="New workflow"
            title="New workflow"
          >
            <Plus className="h-4 w-4" />
          </LiquidIconButton>
        </LiquidActionRow>
      ) : null}
    </header>
  );
}

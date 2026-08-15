import React, { useState } from "react";
import type { Message } from "../../types";
import { Check, ChevronLeft, Ellipsis, Menu, Plus, X } from "lucide-react";
import {
  LiquidActionRow,
  LiquidIconButton,
  LiquidTextButton,
} from "../primitives/LiquidActionRow";
import chatIcon from "../../../assets/icons/app-sidebar/chat.svg";
import quickActionsIcon from "../../../assets/icons/app-sidebar/quick-actions.svg";
import workflowIcon from "../../../assets/icons/app-sidebar/workflow.svg";
import chatHistoryIcon from "../../../assets/icons/app-sidebar/chat-history.svg";
import settingsIcon from "../../../assets/icons/app-sidebar/settings.svg";
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
      {/* Content fades out under the header. This used to ramp the blur down
          in four stacked backdrop-blur layers (1/2/4/8px), but every
          backdrop-filter re-samples whatever is moving behind it on each
          frame — in WKWebView that made the streaming transcript pay for four
          full-width re-samples per scrolled frame. One blurred layer whose
          mask alpha ramps down through several stops is the standard
          single-layer approximation of a progressive blur: the cross-fade
          from blurred to sharp reads as the blur easing off, and the mask
          reaches zero well before the pane's bottom edge so no seam is left
          to catch the eye. -webkit-mask-image is spelled out because
          WKWebView still wants the prefixed form. */}
      <div
        aria-hidden="true"
        data-testid="header-scrim"
        className="pointer-events-none absolute -bottom-2 left-0 right-2 top-0 z-0"
      >
        <div className="absolute inset-0 backdrop-blur-[8px] [-webkit-mask-image:linear-gradient(to_bottom,black_0%,black_16%,rgba(0,0,0,0.55)_46%,rgba(0,0,0,0.2)_72%,transparent_100%)] [mask-image:linear-gradient(to_bottom,black_0%,black_16%,rgba(0,0,0,0.55)_46%,rgba(0,0,0,0.2)_72%,transparent_100%)]" />
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

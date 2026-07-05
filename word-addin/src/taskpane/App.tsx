import React, { useState } from "react";
import { useAuth } from "./auth/useAuth";
import { LoginPage } from "./auth/LoginPage";
import { ApiKeyBanner } from "./components/ApiKeyBanner";
import { ChatPanel } from "./components/ChatPanel";
import { DocumentActions } from "./components/DocumentActions";
import { WorkflowPicker } from "./components/WorkflowPicker";
import { ProjectPicker } from "./components/ProjectPicker";
import { Button } from "@mike/shared/ui/button";
import { Spinner } from "@mike/shared/ui/spinner";
import { MikeIcon } from "@mike/shared/chat/mike-icon";
import { cn } from "@mike/shared/lib/utils";

type TabValue = "chat" | "actions" | "workflows" | "projects";

const TABS: { value: TabValue; label: string }[] = [
  { value: "chat", label: "Chat" },
  { value: "actions", label: "Actions" },
  { value: "workflows", label: "Workflows" },
  { value: "projects", label: "Projects" },
];

export default function App(): React.ReactElement {
  const { token, loading, logout } = useAuth();
  const [selectedTab, setSelectedTab] = useState<TabValue>("chat");

  // Show a minimal spinner while the token is being read from storage
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner label="Loading…" />
      </div>
    );
  }

  if (!token) {
    return <LoginPage />;
  }

  const renderTab = (): React.ReactElement => {
    switch (selectedTab) {
      case "chat":
        return <ChatPanel />;
      case "actions":
        return <DocumentActions />;
      case "workflows":
        return <WorkflowPicker />;
      case "projects":
        return <ProjectPicker />;
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {/* Header */}
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border/70 px-3 py-3 @sm:px-4">
        <div className="flex items-center gap-2">
          <MikeIcon size={22} />
          <span className="text-[15px] font-semibold tracking-tight text-foreground">
            Mike
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-foreground"
          onClick={() => void logout()}
        >
          Sign out
        </Button>
      </header>

      {/* Setup nudge when no AI provider key is configured */}
      <ApiKeyBanner />

      {/* Tab bar */}
      <nav
        role="tablist"
        aria-label="Mike sections"
        className="flex shrink-0 items-stretch gap-0.5 border-b border-border/70 px-1.5"
      >
        {TABS.map((tab) => {
          const active = selectedTab === tab.value;
          return (
            <button
              key={tab.value}
              role="tab"
              type="button"
              aria-selected={active}
              onClick={() => setSelectedTab(tab.value)}
              className={cn(
                "relative flex-1 rounded-t-md px-1.5 py-2.5 text-center text-xs font-medium transition-colors @sm:text-sm",
                active
                  ? "text-foreground"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              )}
            >
              {tab.label}
              <span
                className={cn(
                  "absolute inset-x-1.5 -bottom-px h-0.5 rounded-full bg-foreground transition-opacity",
                  active ? "opacity-100" : "opacity-0"
                )}
              />
            </button>
          );
        })}
      </nav>

      {/* Active tab content */}
      <div className="flex flex-1 flex-col overflow-hidden">{renderTab()}</div>
    </div>
  );
}

import React, { useState } from "react";
import { useAuth } from "./auth/useAuth";
import { LoginPage } from "./auth/LoginPage";
import { ApiKeyBanner } from "./components/ApiKeyBanner";
import { ChatPanel } from "./components/ChatPanel";
import { DocumentActions } from "./components/DocumentActions";
import { WorkflowPicker } from "./components/WorkflowPicker";
import { Spinner } from "@mike/shared/ui/spinner";
import type { Message } from "@mike/core";
import {
  FloatingHeader,
  type AddinSection,
} from "./components/FloatingHeader";
import { ChatHistoryModal } from "./components/ChatHistoryModal";

export default function App(): React.ReactElement {
  const { token, loading, logout } = useAuth();
  const [selectedSection, setSelectedSection] = useState<AddinSection>("chat");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [chatSessionKey, setChatSessionKey] = useState(0);
  const [chatId, setChatId] = useState<string | null>(null);
  const [initialMessages, setInitialMessages] = useState<Message[]>([]);

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

  const renderSection = (): React.ReactElement => {
    switch (selectedSection) {
      case "chat":
        return (
          <ChatPanel
            sessionKey={chatSessionKey}
            chatId={chatId}
            initialMessages={initialMessages}
          />
        );
      case "actions":
        return <DocumentActions />;
      case "workflows":
        return <WorkflowPicker />;
    }
  };

  const startNewChat = (): void => {
    setSelectedSection("chat");
    setChatId(null);
    setInitialMessages([]);
    setChatSessionKey((current) => current + 1);
  };

  return (
    <div className="relative h-full overflow-hidden bg-background">
      <FloatingHeader
        section={selectedSection}
        onSectionChange={setSelectedSection}
        onNewChat={startNewChat}
        onOpenHistory={() => setHistoryOpen(true)}
        onSignOut={() => void logout()}
      />

      <div className="absolute inset-x-3 top-14 z-30">
        <ApiKeyBanner />
      </div>

      <div
        className={`flex h-full flex-col overflow-hidden ${
          selectedSection === "chat" ? "" : "pt-14"
        }`}
      >
        {renderSection()}
      </div>

      <ChatHistoryModal
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        onSelect={(selectedChatId, messages) => {
          setSelectedSection("chat");
          setChatId(selectedChatId);
          setInitialMessages(messages);
          setChatSessionKey((current) => current + 1);
        }}
      />
    </div>
  );
}

import React, { useState } from "react";
import { useAuth } from "./auth/useAuth";
import { LoginPage } from "./auth/LoginPage";
import { ApiKeyBanner } from "./components/shell/ApiKeyBanner";
import { ChatPanel } from "./components/assistant/ChatPanel";
import { DocumentActions } from "./components/quick-actions/DocumentActions";
import { ChatHistoryPage } from "./components/history/ChatHistoryPage";
import { WorkflowPicker } from "./components/workflows/WorkflowPicker";
import { Spinner } from "../shared/ui/spinner";
import type { Message, Workflow } from "./types";
import {
  FloatingHeader,
  type AddinSection,
} from "./components/shell/FloatingHeader";
import { WorkflowDetailsModal } from "./components/workflows/WorkflowDetailsModal";
import { NewWorkflowModal } from "./components/workflows/NewWorkflowModal";
import { SettingsPage } from "./components/settings/SettingsPage";
import { useWordChatStoragePreference } from "./lib/wordChatSettings";
import { useWordDocumentIdentity } from "./lib/wordDocumentIdentity";

function getWordChatOwnerId(token: string): string {
  try {
    const encoded = token.split(".")[1];
    if (encoded) {
      const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
      const payload = JSON.parse(atob(normalized)) as { sub?: unknown };
      if (typeof payload.sub === "string" && payload.sub) return payload.sub;
    }
  } catch {
    // Tests and non-Supabase development auth can use opaque tokens. Hash the
    // value so the token itself is never written to IndexedDB.
  }
  let hash = 2166136261;
  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `opaque-${(hash >>> 0).toString(16)}`;
}

export default function App(): React.ReactElement {
  const { token, loading, logout } = useAuth();
  const wordChatStorage = useWordChatStoragePreference();
  const wordDocument = useWordDocumentIdentity();
  const [selectedSection, setSelectedSection] = useState<AddinSection>("chat");
  const [chatSessionKey, setChatSessionKey] = useState(0);
  const [chatId, setChatId] = useState<string | null>(null);
  const [initialMessages, setInitialMessages] = useState<Message[]>([]);
  const [workflowPageSelection, setWorkflowPageSelection] =
    useState<Workflow | null>(null);
  const [workflowDetailsOpen, setWorkflowDetailsOpen] = useState(false);
  const [newWorkflowOpen, setNewWorkflowOpen] = useState(false);
  const [chatWorkflow, setChatWorkflow] = useState<{
    id: string;
    title: string;
  } | null>(null);

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

  if (wordChatStorage.loading || wordDocument.loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner label="Opening document chats…" />
      </div>
    );
  }

  if (!wordDocument.documentId) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-red-600">
        {wordDocument.error ?? "Could not identify this Word document."}
      </div>
    );
  }

  const wordDocumentId = wordDocument.documentId;
  const wordChatOwnerId = getWordChatOwnerId(token);

  const renderSection = (): React.ReactElement => {
    switch (selectedSection) {
      case "chat":
        return (
          <ChatPanel
            sessionKey={chatSessionKey}
            chatId={chatId}
            initialMessages={initialMessages}
            selectedWorkflow={chatWorkflow}
            onSelectedWorkflowChange={setChatWorkflow}
            onChatIdChange={setChatId}
            wordDocumentId={wordDocumentId}
            wordChatStorage={wordChatStorage.mode}
            wordChatOwnerId={wordChatOwnerId}
          />
        );
      case "actions":
        return <DocumentActions />;
      case "workflows":
        return (
          <WorkflowPicker
            selectedWorkflow={workflowPageSelection}
            onSelectedWorkflowChange={setWorkflowPageSelection}
          />
        );
      case "history":
        return (
          <ChatHistoryPage
            onSelect={openSelectedChat}
            documentId={wordDocumentId}
            storageMode={wordChatStorage.mode}
            ownerId={wordChatOwnerId}
          />
        );
      case "settings":
        return (
          <SettingsPage
            storageMode={wordChatStorage.mode}
            onStorageModeChange={async (mode) => {
              await wordChatStorage.setMode(mode);
              setChatId(null);
              setInitialMessages([]);
              setChatSessionKey((current) => current + 1);
            }}
            onSignOut={() => void logout()}
          />
        );
    }
  };

  function openSelectedChat(
    selectedChatId: string,
    messages: Message[]
  ): void {
    setSelectedSection("chat");
    setWorkflowPageSelection(null);
    setWorkflowDetailsOpen(false);
    setChatWorkflow(null);
    setChatId(selectedChatId);
    setInitialMessages(messages);
    setChatSessionKey((current) => current + 1);
  }

  const changeSection = (section: AddinSection): void => {
    setSelectedSection(section);
    if (section !== "workflows") {
      setWorkflowPageSelection(null);
      setWorkflowDetailsOpen(false);
    }
  };

  const startNewChat = (): void => {
    setSelectedSection("chat");
    setWorkflowPageSelection(null);
    setWorkflowDetailsOpen(false);
    setChatWorkflow(null);
    setChatId(null);
    setInitialMessages([]);
    setChatSessionKey((current) => current + 1);
  };

  const useSelectedWorkflow = (): void => {
    if (!workflowPageSelection) return;
    setChatWorkflow({
      id: workflowPageSelection.id,
      title: workflowPageSelection.metadata.title,
    });
    setWorkflowDetailsOpen(false);
    setWorkflowPageSelection(null);
    setSelectedSection("chat");
  };

  return (
    <div className="relative h-full overflow-hidden bg-background">
      <FloatingHeader
        section={selectedSection}
        onSectionChange={changeSection}
        onNewChat={startNewChat}
        onSelectHistoryChat={openSelectedChat}
        workflowDetailOpen={
          selectedSection === "workflows" && !!workflowPageSelection
        }
        onWorkflowBack={() => {
          setWorkflowDetailsOpen(false);
          setWorkflowPageSelection(null);
        }}
        onOpenWorkflowDetails={() => setWorkflowDetailsOpen(true)}
        onUseWorkflow={useSelectedWorkflow}
        onNewWorkflow={() => setNewWorkflowOpen(true)}
        wordDocumentId={wordDocumentId}
        wordChatStorage={wordChatStorage.mode}
        wordChatOwnerId={wordChatOwnerId}
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

      <WorkflowDetailsModal
        open={workflowDetailsOpen && !!workflowPageSelection}
        workflow={workflowPageSelection}
        onClose={() => setWorkflowDetailsOpen(false)}
        onUpdated={setWorkflowPageSelection}
      />
      <NewWorkflowModal
        open={newWorkflowOpen}
        onClose={() => setNewWorkflowOpen(false)}
        onCreated={(workflow) => {
          setWorkflowDetailsOpen(false);
          setWorkflowPageSelection(workflow);
        }}
      />
    </div>
  );
}

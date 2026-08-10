import React from "react";
import { useWordAssistantChat } from "../../hooks/useWordAssistantChat";
import { useWordTrackedEdits } from "../../hooks/useWordTrackedEdits";
import type { Message as SavedMessage } from "../../types";
import type { WordChatStorageMode } from "../../lib/wordChatSettings";
import { ChatView } from "./ChatView";
import type { WorkflowAttachment } from "../../lib/wordChatTypes";

interface ChatPanelProps {
  sessionKey: number;
  chatId: string | null;
  initialMessages: SavedMessage[];
  selectedWorkflow: WorkflowAttachment | null;
  onSelectedWorkflowChange: (workflow: WorkflowAttachment | null) => void;
  onChatIdChange: (chatId: string) => void;
  wordDocumentId: string;
  wordChatStorage: WordChatStorageMode;
  wordChatOwnerId: string;
}

/**
 * Word's equivalent of the frontend assistant page: compose the stateful chat
 * and tracked-edit controllers, then hand both to the view. Office handles,
 * transport code, message rendering, and composer state live below this seam.
 */
export function ChatPanel({
  sessionKey,
  chatId,
  initialMessages,
  selectedWorkflow,
  onSelectedWorkflowChange,
  onChatIdChange,
  wordDocumentId,
  wordChatStorage,
  wordChatOwnerId,
}: ChatPanelProps): React.ReactElement {
  const trackedEdits = useWordTrackedEdits({
    sessionKey,
    initialMessages,
  });
  const chat = useWordAssistantChat({
    sessionKey,
    chatId,
    initialMessages,
    onChatIdChange,
    wordDocumentId,
    wordChatStorage,
    wordChatOwnerId,
    editController: trackedEdits,
  });

  return (
    <ChatView
      {...chat}
      {...trackedEdits}
      sessionKey={sessionKey}
      selectedWorkflow={selectedWorkflow}
      onSelectedWorkflowChange={onSelectedWorkflowChange}
    />
  );
}

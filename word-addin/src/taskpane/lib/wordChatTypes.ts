import type { Message as SavedMessage, WordAssistantEvent } from "../types";

export type WorkflowAttachment = { id: string; title: string };
export type EditDecision = "accept" | "reject";

export type EditCardStatus =
  | "receiving"
  | "applying"
  | "restoring"
  | "pending"
  | "view-only"
  | "accepted"
  | "rejected"
  | "skipped"
  | "ambiguous"
  | "incomplete"
  | "unmanaged"
  | "error"
  | "historical";

export type DocEditStatus =
  | "applying"
  | "pending"
  | "accepted"
  | "rejected"
  | "skipped"
  | "unmanaged"
  | "error";

export interface EditRuntimeState {
  status: EditCardStatus;
  matches?: number;
  error?: string;
  /** Navigation failures do not change the tracked edit's lifecycle. */
  viewError?: string;
  busy?: boolean;
}

interface RuntimeMessageBase {
  id: string;
  files?: SavedMessage["files"];
  workflow?: SavedMessage["workflow"];
  /** Only the current streamed turn may mutate the live Word document. */
  live?: boolean;
}

export interface WordUserMessage extends RuntimeMessageBase {
  role: "user";
  content: string;
}

export interface WordAssistantMessage extends RuntimeMessageBase {
  role: "assistant";
  /** Canonical assistant content and activity, in arrival order. */
  events: WordAssistantEvent[];
}

export type WordChatMessage = WordUserMessage | WordAssistantMessage;

export interface WordChatSubmission {
  content: string;
  files?: { filename: string; document_id?: string }[];
  workflow?: WorkflowAttachment;
  model: string;
}

export interface WordChatSubmitOptions {
  /** Called only after the document snapshot succeeds and the turn exists. */
  onAccepted?: () => void;
  /** Places the new turn after React has rendered its empty assistant slot. */
  onTurnReady?: () => void;
}

export interface WordEditStreamController {
  processLiveRedlines: (
    messageId: string,
    content: string,
    streamComplete: boolean,
    persistent: boolean,
  ) => void;
  markIncompleteRedlines: (messageId: string, content: string) => void;
  waitForMessageEdits: (messageId: string) => Promise<void>;
}

export interface WordTrackedEditsController {
  editStateByKey: Readonly<Record<string, EditRuntimeState>>;
  /**
   * Streaming-facing behavior with a render-stable identity. It is memoized
   * apart from `editStateByKey` so that hooks depending on it (handleChat)
   * are not recreated by every edit-state transition during a stream.
   */
  streamController: WordEditStreamController;
  viewEdit: (key: string) => Promise<void>;
  resolveOneEdit: (key: string, decision: EditDecision) => Promise<void>;
  resolveMessageEdits: (
    editKeys: string[],
    decision: EditDecision,
  ) => Promise<void>;
}

export interface WordAssistantChatController {
  messages: WordChatMessage[];
  isResponseLoading: boolean;
  requestError: string | null;
  handleChat: (
    submission: WordChatSubmission,
    options?: WordChatSubmitOptions,
  ) => Promise<void>;
  cancel: () => void;
  dismissRequestError: () => void;
}

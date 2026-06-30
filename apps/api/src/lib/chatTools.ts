// ---------------------------------------------------------------------------
// Barrel module. The chat-tools implementation has been split into focused
// modules under ./tools/*; this file re-exports their public surface so that
// every existing `import { X } from "../../lib/chatTools"` continues to
// resolve unchanged. Nothing moves at the call site.
// ---------------------------------------------------------------------------

// Tool-schema constants + shared chat types (already lived in chatToolDefs).
export {
    // Types
    type DocStore,
    type WorkflowStore,
    type DocIndex,
    type TabularCellStore,
    type ToolCall,
    type ChatMessage,
    // Tool-schema constants
    SYSTEM_PROMPT,
    PROJECT_EXTRA_TOOLS,
    TABULAR_TOOLS,
    WORKFLOW_TOOLS,
    TOOLS,
} from "./chatToolDefs";

// Context/message-building helpers (already lived in chatContext).
export {
    generateSpotlightNonce,
    spotlight,
    buildMessages,
    enrichWithPriorEvents,
    buildDocContext,
    buildProjectDocContext,
    buildWorkflowStore,
} from "./chatContext";

// Doc-id resolution helpers.
export { resolveDoc, resolveDocLabel } from "./tools/docResolve";

// PDF text extraction.
export { extractPdfText } from "./tools/pdfText";

// DOCX generation.
export { generateDocx } from "./tools/docxGenerate";

// Document editing / tracked-change orchestration.
export { loadCurrentVersionBytes, runEditDocument } from "./tools/editDocument";

// Shared result/annotation types.
export type {
    EditAnnotation,
    DocEditedResult,
    TurnEditState,
    DocCreatedResult,
    DocReplicatedResult,
} from "./tools/types";

// Tool dispatch.
export { runToolCalls } from "./tools/runToolCalls";

// LLM streaming loop + assistant-event helpers.
export {
    AssistantStreamError,
    AssistantStreamAbortError,
    isAbortError,
    runLLMStream,
    extractAnnotations,
    stripTransientAssistantEvents,
    appendCancelledAssistantEvent,
    buildCancelledAssistantMessage,
} from "./tools/stream";

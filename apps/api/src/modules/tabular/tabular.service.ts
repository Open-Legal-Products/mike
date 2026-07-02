// Business logic + data-access for the tabular-review module.
//
// These functions are the service layer behind tabular.routes.ts. They take an
// explicit Supabase client (`db`) plus request-derived primitives, perform the
// review / cell / document orchestration, and RETURN values or typed error
// results. They never touch req/res — the thin route handlers map the results
// onto HTTP status codes, headers, and response bodies.
//
// STREAMING: the SSE endpoints (POST /:reviewId/chat and /:reviewId/generate)
// keep their streaming loop, abort handling, and per-token persistence in the
// route. Only the NON-streaming work is extracted here — including the pre-stream
// "prepare" guards (access checks, document loading, missing-API-key checks, and
// chat-record setup) that return the data the route then streams over.
//
// This file is the stable facade over the tabular service implementation,
// which is split by concern:
//   - tabular.shared.ts   shared types + model/cell-content helpers
//   - tabular.prompt.ts   prompt suffixes + tabular chat message building
//   - tabular.extract.ts  citation parsing, LLM extraction, PDF/DOCX text
//   - tabular.reviews.ts  review CRUD + overview + cell regeneration
//   - tabular.generate.ts pre-stream "prepare" guards for the SSE routes
//   - tabular.chats.ts    chat metadata (list / delete / messages)
// Importers keep using this module; the re-exports below are the public
// surface (named intentionally — module-internal helpers stay internal).

export { missingModelApiKey, parseCellContent, type MissingApiKey } from "./tabular.shared";
export { formatPromptSuffix } from "./tabular.prompt";
export {
    extractDocxMarkdown,
    extractPdfMarkdown,
    extractTabularAnnotations,
    generateChatTitle,
    queryTabularAllColumns,
} from "./tabular.extract";
export {
    clearTabularCells,
    createTabularReview,
    deleteTabularReview,
    generateColumnPrompt,
    getTabularReviewDetail,
    getTabularReviewPeople,
    getTabularReviewsOverview,
    regenerateTabularCell,
    updateTabularReview,
} from "./tabular.reviews";
export {
    prepareTabularChat,
    prepareTabularGenerate,
    type PreparedChat,
    type PreparedGenerate,
} from "./tabular.generate";
export {
    deleteTabularChat,
    getTabularChatMessages,
    listTabularChats,
} from "./tabular.chats";

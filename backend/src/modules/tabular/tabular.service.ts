// Service facade for the tabular-review module. Named re-exports only — the
// module's public service surface in one place, without leaking intra-module
// helpers. Routes (and the extraction worker) import from the topic files
// directly; this facade exists so cross-module consumers and tests have one
// stable import path.

export {
    createRowsForReview,
    normalizeGrouping,
    rebuildRowsForReview,
    syncCellsForReviewRows,
    type DocumentGrouping,
} from "./tabular.reviews";
export {
    fetchSourceDocuments,
    loadReviewRow,
    loadReviewRows,
    loadRowDocumentText,
    type ReviewRow,
    type SourceDocument,
} from "./tabular.rows";
export {
    extractDocumentMarkdown,
    extractDocxMarkdown,
    extractPdfMarkdown,
    generateChatTitle,
    queryTabularAllColumns,
    queryTabularCell,
} from "./tabular.extract";
export { extractRowColumns, type CellSink } from "./tabular.extractRow";
export { prepareTabularGenerate, type PreparedGenerate } from "./tabular.generate";
export {
    streamTabularGenerateAsync,
    streamTabularRunView,
    targetPendingCells,
} from "./tabular.generateStream";
export {
    buildTabularMessages,
    extractTabularAnnotations,
    parseTabularCitations,
    type TabularParsedCitation,
} from "./tabular.chats";
export {
    missingModelApiKey,
    parseCellContent,
    type CellResult,
    type Column,
    type MissingApiKey,
} from "./tabular.shared";
export { formatPromptSuffix } from "./tabular.prompt";

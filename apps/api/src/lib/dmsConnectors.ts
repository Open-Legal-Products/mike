/**
 * Barrel re-export for the DMS connector feature, mirroring lib/mcpConnectors.ts
 * so callers import from one stable path.
 */
export type {
    DmsAuthType,
    DmsConnectorSummary,
} from "./dms/types";
export type {
    DmsConnector,
    DmsAdapterConfig,
    DmsKind,
    DmsFolder,
    DmsSearchResult,
    DmsSearchOptions,
    DmsDocument,
    DmsExportResult,
} from "./dms/adapter";
export {
    FakeDMSAdapter,
    IManageAdapter,
    NetDocumentsAdapter,
    getDmsAdapter,
    registerDmsAdapter,
    listDmsAdapters,
    isCloudDmsKind,
    sharedFakeDms,
} from "./dms";
export { DmsOAuthRequiredError } from "./dms/oauth";
export {
    startDmsConnectorOAuth,
    completeDmsConnectorOAuth,
} from "./dms/oauth";
export {
    listDmsConnectors,
    getDmsConnector,
    createDmsConnector,
    updateDmsConnector,
    deleteDmsConnector,
    syncDmsConnector,
    listDmsFolders,
    searchDms,
    importDmsDocument,
    exportDocumentToDms,
} from "./dms/servers";

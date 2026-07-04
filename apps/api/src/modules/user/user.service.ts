// Business logic + data-access for the user module.
//
// These functions are the service layer behind user.routes.ts. They take an
// explicit Supabase client (`db`) plus request-derived primitives, perform the
// profile / MFA / API-key / MCP / DMS / export / deletion orchestration, and
// RETURN values or typed error results. They never touch req/res — the thin
// route handlers map the results onto HTTP status codes, headers, and response
// bodies.
//
// The implementation is split by concern across sibling files; this module is
// the aggregate surface the routes (and tests) import from:
//
//   user.shared.ts   — shared types + helpers (Db/Log, errorMessage)
//   user.profile.ts  — load/serialize/validate + bootstrap/read/update profile
//   user.mfa.ts      — the MFA-on-login toggle (+ verified-TOTP factor lookup)
//   user.apiKeys.ts  — BYO API-key status + save (crypto stays in the lib)
//   user.mcp.ts      — MCP connector wrappers over lib/mcpConnectors
//   user.dms.ts      — DMS connector wrappers over lib/dmsConnectors
//   user.account.ts  — destructive account/data deletion (args + ordering kept)
//   user.export.ts   — data-export payload builders
//
// Security boundaries preserved across the split verbatim:
//   - API-key crypto: writes funnel through saveUserApiKey (never reimplemented).
//   - MFA: the requireMfaIfEnrolled guard stays in the route (HTTP layer); only
//     the verified-TOTP factor lookup lives here.
//   - Data deletion: the userDataCleanup helpers + auth-admin deleteUser call are
//     invoked with identical args and ordering (destructive — exact preservation).
//   - Exports: the payload builders are called here; the route owns the
//     Content-Type / Content-Disposition headers and filenames.
//
// The re-exports below are NAMED so intra-module helpers (e.g. the profile-row
// loaders reused by user.mfa.ts) stay off this public surface — the routes and
// tests import exactly the same names they always did.

export { errorMessage } from "./user.shared";

export {
    validateProfilePayload,
    readBooleanBodyField,
    bootstrapUserProfile,
    getUserProfile,
    updateUserProfile,
} from "./user.profile";

export { setMfaOnLogin, type SetMfaOnLoginResult } from "./user.mfa";

export {
    getApiKeyStatus,
    saveApiKey,
    type SaveApiKeyResult,
} from "./user.apiKeys";

export {
    listMcpConnectors,
    getMcpConnector,
    createMcpConnector,
    updateMcpConnector,
    deleteMcpConnector,
    startMcpConnectorOAuth,
    refreshMcpConnectorTools,
    setMcpToolEnabled,
    type RefreshMcpToolsResult,
} from "./user.mcp";

export {
    listDmsConnectors,
    getDmsConnector,
    createDmsConnector,
    updateDmsConnector,
    deleteDmsConnector,
    syncDmsConnector,
    searchDmsConnector,
    importDmsDocument,
} from "./user.dms";

export {
    deleteUserAccount,
    deleteUserChats,
    deleteUserProjectsData,
    deleteUserTabularReviews,
} from "./user.account";

export {
    exportUserAccount,
    exportUserChats,
    exportUserTabularReviews,
} from "./user.export";

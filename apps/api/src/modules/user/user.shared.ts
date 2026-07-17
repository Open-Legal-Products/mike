// Shared types + helpers for the user module service layer.
//
// The user service is split by concern across sibling files
// (user.profile.ts, user.mfa.ts, user.apiKeys.ts, user.mcp.ts, user.dms.ts,
// user.account.ts, user.export.ts). Anything used by more than one of them
// lives here, and user.service.ts re-exports the whole public surface so
// route/test importers see a single module.

import { createServerSupabase } from "../../lib/supabase";
import { logger } from "../../lib/logger";

export type Db = ReturnType<typeof createServerSupabase>;

// Structural slice of pino's Logger — service functions only ever .error().
export type Log = Pick<typeof logger, "error">;

export function errorMessage(error: unknown): string {
    if (error instanceof Error && error.message) return error.message;
    if (error && typeof error === "object") {
        const record = error as {
            message?: unknown;
            details?: unknown;
            hint?: unknown;
            code?: unknown;
        };
        return (
            [record.message, record.details, record.hint, record.code]
                .filter(
                    (value): value is string =>
                        typeof value === "string" && !!value,
                )
                .join(" ") || JSON.stringify(error)
        );
    }
    return String(error);
}

// Data export (the route owns the Content-Type / Content-Disposition headers
// and filenames; these functions just build the payloads).
//
// Service layer behind user.routes.ts — see user.shared.ts for the module's
// contract.

import {
    buildUserAccountExport,
    buildUserChatsExport,
    buildUserTabularReviewsExport,
} from "../../lib/userDataExport";
import { type Db, errorMessage } from "./user.shared";

export async function exportUserAccount(
    db: Db,
    userId: string,
    userEmail: string | undefined,
): Promise<{ ok: true; data: unknown } | { ok: false; detail: string }> {
    try {
        const data = await buildUserAccountExport(db, userId, userEmail);
        return { ok: true, data };
    } catch (err) {
        const detail = errorMessage(err);
        console.error("[user/export] failed", { userId, error: detail });
        return { ok: false, detail };
    }
}

export async function exportUserChats(
    db: Db,
    userId: string,
    userEmail: string | undefined,
): Promise<{ ok: true; data: unknown } | { ok: false; detail: string }> {
    try {
        const data = await buildUserChatsExport(db, userId, userEmail);
        return { ok: true, data };
    } catch (err) {
        const detail = errorMessage(err);
        console.error("[user/chats/export] failed", {
            userId,
            error: detail,
        });
        return { ok: false, detail };
    }
}

export async function exportUserTabularReviews(
    db: Db,
    userId: string,
    userEmail: string | undefined,
): Promise<{ ok: true; data: unknown } | { ok: false; detail: string }> {
    try {
        const data = await buildUserTabularReviewsExport(db, userId, userEmail);
        return { ok: true, data };
    } catch (err) {
        const detail = errorMessage(err);
        console.error("[user/tabular-reviews/export] failed", {
            userId,
            error: detail,
        });
        return { ok: false, detail };
    }
}

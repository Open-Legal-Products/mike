// Account / data deletion (destructive — exact call args + ordering preserved).
//
// Service layer behind user.routes.ts — see user.shared.ts for the module's
// contract. The userDataCleanup helpers + auth-admin deleteUser call are
// invoked with identical args and ordering.

import { logger } from "../../lib/logger";
import {
    deleteAllUserChats,
    deleteAllUserTabularReviews,
    deleteUserAccountData,
    deleteUserProjects,
} from "../../lib/userDataCleanup";
import { type Db, errorMessage } from "./user.shared";

export async function deleteUserAccount(
    db: Db,
    userId: string,
    userEmail: string | undefined,
): Promise<{ ok: true } | { ok: false; detail: string }> {
    try {
        await deleteUserAccountData(db, userId, userEmail);
        const { error } = await db.auth.admin.deleteUser(userId);
        if (error) return { ok: false, detail: error.message };
        return { ok: true };
    } catch (err) {
        const detail = errorMessage(err);
        logger.error(
            {
                userId,
                error: detail,
            },
            "[user/account] delete failed",
        );
        return { ok: false, detail };
    }
}

export async function deleteUserChats(
    db: Db,
    userId: string,
): Promise<{ ok: true } | { ok: false; detail: string }> {
    try {
        await deleteAllUserChats(db, userId);
        return { ok: true };
    } catch (err) {
        const detail = errorMessage(err);
        logger.error(
            {
                userId,
                error: detail,
            },
            "[user/chats] delete failed",
        );
        return { ok: false, detail };
    }
}

export async function deleteUserProjectsData(
    db: Db,
    userId: string,
): Promise<{ ok: true } | { ok: false; detail: string }> {
    try {
        await deleteUserProjects(db, userId);
        return { ok: true };
    } catch (err) {
        const detail = errorMessage(err);
        logger.error(
            {
                userId,
                error: detail,
            },
            "[user/projects] delete failed",
        );
        return { ok: false, detail };
    }
}

export async function deleteUserTabularReviews(
    db: Db,
    userId: string,
): Promise<{ ok: true } | { ok: false; detail: string }> {
    try {
        await deleteAllUserTabularReviews(db, userId);
        return { ok: true };
    } catch (err) {
        const detail = errorMessage(err);
        logger.error(
            {
                userId,
                error: detail,
            },
            "[user/tabular-reviews] delete failed",
        );
        return { ok: false, detail };
    }
}

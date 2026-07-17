import { createServerSupabase } from "./supabase";
import { logger } from "./logger";

type Db = ReturnType<typeof createServerSupabase>;

// Default monthly limit for the free tier.
// Platform-hosted deployments may override this via the MONTHLY_CREDIT_LIMIT
// env var; self-hosters who are not running a metered platform can set it to
// a very high value (the default for self-hosted instances).
export const MONTHLY_CREDIT_LIMIT = process.env.MONTHLY_CREDIT_LIMIT
    ? Number(process.env.MONTHLY_CREDIT_LIMIT)
    : 999_999;

// Quota-accounting failure policy (see env.ts CREDITS_FAIL_CLOSED). When a
// credit read fails, do we fail OPEN (allow, historical self-host default) or
// fail CLOSED (deny)? Read lazily from process.env so it's evaluated per call
// and the schema-validated default flows through — hosted billing sets this
// truthy so an unreadable quota can't leak unmetered usage. Kept off the env
// module import on purpose: this file already reads config via process.env
// (MONTHLY_CREDIT_LIMIT) and stays free of the full env-validation graph.
function creditsFailClosed(): boolean {
    return process.env.CREDITS_FAIL_CLOSED === "true";
}

export type CreditCheckResult =
    | { allowed: true }
    | { allowed: false; used: number; limit: number; resetDate: string };

/**
 * Check whether a user has remaining message credits for the current month.
 * Returns `{ allowed: true }` if they do, or a structured rejection if not.
 *
 * Credits reset on `credits_reset_date`.  If the reset date has passed, the
 * used count is zeroed and the date is advanced by one month before checking.
 */
export async function checkMessageCredits(
    userId: string,
    db: Db = createServerSupabase(),
): Promise<CreditCheckResult> {
    const { data, error } = await db
        .from("user_profiles")
        .select("message_credits_used, credits_reset_date, tier")
        .eq("user_id", userId)
        .single();

    if (error || !data) {
        // If we can't read the profile, allow the request — don't block
        // users because of a DB hiccup on this non-critical check.
        return { allowed: true };
    }

    const now = new Date();
    const resetDate = new Date(data.credits_reset_date ?? now);

    // If the reset date is in the past, reset the counter in DB and allow.
    if (resetDate <= now) {
        const nextReset = new Date(resetDate);
        nextReset.setMonth(nextReset.getMonth() + 1);
        await db
            .from("user_profiles")
            .update({
                message_credits_used: 0,
                credits_reset_date: nextReset.toISOString(),
            })
            .eq("user_id", userId);
        return { allowed: true };
    }

    const used = data.message_credits_used ?? 0;
    if (used >= MONTHLY_CREDIT_LIMIT) {
        return {
            allowed: false,
            used,
            limit: MONTHLY_CREDIT_LIMIT,
            resetDate: data.credits_reset_date,
        };
    }

    return { allowed: true };
}

/**
 * Increment the message_credits_used counter by 1 after a successful LLM call.
 * Failures are silently ignored — we never want credit accounting to break chat.
 */
export async function incrementMessageCredits(
    userId: string,
    db: Db = createServerSupabase(),
): Promise<void> {
    // See refundMessageCredit: the builder is a thenable with no .catch —
    // await inside try/catch, or a refactor-era TypeError crashes the process.
    try {
        await db.rpc("increment_message_credits", { uid: userId });
    } catch {
        // increment_message_credits is a Postgres function (see migration).
        // If it doesn't exist yet, degrade gracefully.
    }
}

/**
 * Atomically reserve one message credit BEFORE streaming. The consume_message_credit
 * RPC takes a row lock, applies the monthly reset if due, and increments only if
 * the user is under the limit — eliminating the check-then-increment race where
 * concurrent requests could all pass a read-only check and overspend.
 *
 * Returns `{ allowed: true }` when a credit was consumed, or a structured
 * rejection when over the limit. On a DB error the behavior is policy-controlled
 * by CREDITS_FAIL_CLOSED: unset/false fails OPEN (allow — matches the historical
 * self-host behavior), true fails CLOSED (deny) so hosted billing never gives
 * away unmetered usage when the quota store is unreadable. Refund with
 * refundMessageCredit if the stream then fails.
 */
export async function consumeMessageCredit(
    userId: string,
    db: Db = createServerSupabase(),
): Promise<CreditCheckResult> {
    const { data, error } = await db.rpc("consume_message_credit", {
        p_user_id: userId,
        p_limit: MONTHLY_CREDIT_LIMIT,
    });
    if (error) {
        // Fail-open (default) preserves self-host UX; fail-closed protects
        // hosted metering when the DB/RPC is unreadable.
        if (!creditsFailClosed()) return { allowed: true };
        return {
            allowed: false,
            used: MONTHLY_CREDIT_LIMIT,
            limit: MONTHLY_CREDIT_LIMIT,
            resetDate: new Date().toISOString(),
        };
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || row.allowed) return { allowed: true };
    return {
        allowed: false,
        used: row.used ?? MONTHLY_CREDIT_LIMIT,
        limit: MONTHLY_CREDIT_LIMIT,
        resetDate: row.reset_date,
    };
}

/**
 * Return a previously-consumed credit (floored at 0) when the stream it was
 * reserved for fails or is aborted before delivering a response. Best-effort.
 */
export async function refundMessageCredit(
    userId: string,
    db: Db = createServerSupabase(),
): Promise<void> {
    // The Supabase query builder is a thenable, not a Promise — it has no
    // .catch() method, and calling one throws a TypeError that (since this
    // runs inside stream-failure cleanup) escapes the route's error handling
    // entirely and crashes the process as an unhandled rejection. Await it
    // in a try/catch instead; RPC-level failures come back as `error`.
    try {
        const { error } = await db.rpc("refund_message_credit", {
            p_user_id: userId,
        });
        if (error) {
            logger.warn({ err: error, userId }, "[credits] refund failed");
        }
    } catch (err) {
        // best-effort: never let a refund failure surface to the user
        logger.warn({ err, userId }, "[credits] refund threw");
    }
}

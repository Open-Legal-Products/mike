import { createServerSupabase } from "./supabase";

type Db = ReturnType<typeof createServerSupabase>;

// Default monthly limit for the free tier.
// Platform-hosted deployments may override this via the MONTHLY_CREDIT_LIMIT
// env var; self-hosters who are not running a metered platform can set it to
// a very high value (the default for self-hosted instances).
export const MONTHLY_CREDIT_LIMIT = process.env.MONTHLY_CREDIT_LIMIT
    ? Number(process.env.MONTHLY_CREDIT_LIMIT)
    : 999_999;

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
    await db.rpc("increment_message_credits", { uid: userId }).catch(() => {
        // increment_message_credits is a Postgres function (see migration).
        // If it doesn't exist yet, degrade gracefully.
    });
}

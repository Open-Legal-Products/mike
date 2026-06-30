import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    checkMessageCredits,
    consumeMessageCredit,
    refundMessageCredit,
    MONTHLY_CREDIT_LIMIT,
} from "../credits";

function makeRpcDb(rpcResult: { data?: unknown; error?: unknown }) {
    const rpc = vi.fn().mockResolvedValue({
        data: rpcResult.data ?? null,
        error: rpcResult.error ?? null,
    });
    return {
        db: { rpc } as unknown as Parameters<typeof consumeMessageCredit>[1],
        rpc,
    };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockDb(profileData: object | null, profileError: object | null = null) {
    return {
        from: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                    single: vi.fn().mockResolvedValue({
                        data: profileData,
                        error: profileError,
                    }),
                }),
            }),
            update: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ error: null }),
            }),
        }),
        rpc: vi.fn().mockResolvedValue({ error: null }),
    } as unknown as Parameters<typeof checkMessageCredits>[1];
}

const FUTURE_RESET = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
const PAST_RESET = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MONTHLY_CREDIT_LIMIT", () => {
    it("is a positive integer", () => {
        expect(MONTHLY_CREDIT_LIMIT).toBeGreaterThan(0);
        expect(Number.isInteger(MONTHLY_CREDIT_LIMIT)).toBe(true);
    });
});

describe("checkMessageCredits", () => {
    describe("database error handling", () => {
        it("allows the request when user profile cannot be read (fail open)", async () => {
            const db = makeMockDb(null, { message: "relation does not exist" });
            const result = await checkMessageCredits("user-1", db);
            expect(result).toEqual({ allowed: true });
        });

        it("allows the request when profile row is null", async () => {
            const db = makeMockDb(null, null);
            const result = await checkMessageCredits("user-1", db);
            expect(result).toEqual({ allowed: true });
        });
    });

    describe("credit reset logic", () => {
        it("allows the request and resets counter when reset date is in the past", async () => {
            const db = makeMockDb({
                message_credits_used: 10,
                credits_reset_date: PAST_RESET,
                tier: "free",
            });
            const result = await checkMessageCredits("user-1", db);
            expect(result).toEqual({ allowed: true });
        });

        it("calls db.update to zero out the counter when resetting", async () => {
            const updateEq = vi.fn().mockResolvedValue({ error: null });
            const update = vi.fn().mockReturnValue({ eq: updateEq });
            const db = {
                from: vi.fn().mockReturnValue({
                    select: vi.fn().mockReturnValue({
                        eq: vi.fn().mockReturnValue({
                            single: vi.fn().mockResolvedValue({
                                data: {
                                    message_credits_used: 5,
                                    credits_reset_date: PAST_RESET,
                                    tier: "free",
                                },
                                error: null,
                            }),
                        }),
                    }),
                    update,
                }),
            } as unknown as Parameters<typeof checkMessageCredits>[1];

            await checkMessageCredits("user-1", db);

            expect(update).toHaveBeenCalledWith(
                expect.objectContaining({ message_credits_used: 0 }),
            );
        });
    });

    describe("under the limit", () => {
        it("allows when credits used is 0", async () => {
            const db = makeMockDb({
                message_credits_used: 0,
                credits_reset_date: FUTURE_RESET,
                tier: "free",
            });
            const result = await checkMessageCredits("user-1", db);
            expect(result).toEqual({ allowed: true });
        });

        it("allows when credits used is one below the limit", async () => {
            const db = makeMockDb({
                message_credits_used: MONTHLY_CREDIT_LIMIT - 1,
                credits_reset_date: FUTURE_RESET,
                tier: "free",
            });
            const result = await checkMessageCredits("user-1", db);
            expect(result).toEqual({ allowed: true });
        });
    });

    describe("at or over the limit", () => {
        it("denies when credits used equals the limit", async () => {
            const db = makeMockDb({
                message_credits_used: MONTHLY_CREDIT_LIMIT,
                credits_reset_date: FUTURE_RESET,
                tier: "free",
            });
            const result = await checkMessageCredits("user-1", db);
            expect(result).toMatchObject({
                allowed: false,
                used: MONTHLY_CREDIT_LIMIT,
                limit: MONTHLY_CREDIT_LIMIT,
            });
        });

        it("denies when credits used exceeds the limit", async () => {
            const db = makeMockDb({
                message_credits_used: MONTHLY_CREDIT_LIMIT + 50,
                credits_reset_date: FUTURE_RESET,
                tier: "free",
            });
            const result = await checkMessageCredits("user-1", db);
            expect(result).toMatchObject({ allowed: false });
        });

        it("includes the resetDate in the denial response", async () => {
            const db = makeMockDb({
                message_credits_used: MONTHLY_CREDIT_LIMIT,
                credits_reset_date: FUTURE_RESET,
                tier: "free",
            });
            const result = (await checkMessageCredits("user-1", db)) as {
                allowed: false;
                resetDate: string;
            };
            expect(result.resetDate).toBe(FUTURE_RESET);
        });

        it("treats null credits_used as 0 (allows the request)", async () => {
            const db = makeMockDb({
                message_credits_used: null,
                credits_reset_date: FUTURE_RESET,
                tier: "free",
            });
            const result = await checkMessageCredits("user-1", db);
            expect(result).toEqual({ allowed: true });
        });
    });
});

describe("consumeMessageCredit (atomic reserve)", () => {
    it("calls the consume_message_credit RPC with the user id and limit", async () => {
        const { db, rpc } = makeRpcDb({ data: [{ allowed: true, used: 1 }] });
        await consumeMessageCredit("user-1", db);
        expect(rpc).toHaveBeenCalledWith("consume_message_credit", {
            p_user_id: "user-1",
            p_limit: MONTHLY_CREDIT_LIMIT,
        });
    });

    it("allows when the RPC reports allowed", async () => {
        const { db } = makeRpcDb({ data: [{ allowed: true, used: 2 }] });
        expect(await consumeMessageCredit("user-1", db)).toEqual({ allowed: true });
    });

    it("denies with used/limit/resetDate when the RPC reports over-limit", async () => {
        const { db } = makeRpcDb({
            data: [{ allowed: false, used: 999_999, reset_date: FUTURE_RESET }],
        });
        const result = await consumeMessageCredit("user-1", db);
        expect(result).toMatchObject({
            allowed: false,
            used: 999_999,
            limit: MONTHLY_CREDIT_LIMIT,
            resetDate: FUTURE_RESET,
        });
    });

    it("fails OPEN on an RPC error (never blocks chat on accounting)", async () => {
        const { db } = makeRpcDb({ error: { message: "function missing" } });
        expect(await consumeMessageCredit("user-1", db)).toEqual({ allowed: true });
    });
});

describe("refundMessageCredit", () => {
    it("calls the refund_message_credit RPC and swallows failures", async () => {
        const rpc = vi.fn().mockRejectedValue(new Error("boom"));
        const db = { rpc } as unknown as Parameters<typeof refundMessageCredit>[1];
        await expect(refundMessageCredit("user-1", db)).resolves.toBeUndefined();
        expect(rpc).toHaveBeenCalledWith("refund_message_credit", {
            p_user_id: "user-1",
        });
    });
});

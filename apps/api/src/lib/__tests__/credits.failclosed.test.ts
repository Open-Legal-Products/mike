import { afterEach, describe, expect, it, vi } from "vitest";
import { consumeMessageCredit, MONTHLY_CREDIT_LIMIT } from "../credits";

// The CREDITS_FAIL_CLOSED flag is read lazily (per call) from process.env, so
// toggling it between tests is enough — no module re-import required.
function makeErrorRpcDb() {
    const rpc = vi.fn().mockResolvedValue({
        data: null,
        error: { message: "consume_message_credit does not exist" },
    });
    return {
        db: { rpc } as unknown as Parameters<typeof consumeMessageCredit>[1],
        rpc,
    };
}

afterEach(() => {
    delete process.env.CREDITS_FAIL_CLOSED;
});

describe("consumeMessageCredit DB-error failure policy", () => {
    it("flag unset → DB error fails OPEN (allowed, unchanged self-host behavior)", async () => {
        delete process.env.CREDITS_FAIL_CLOSED;
        const { db } = makeErrorRpcDb();
        expect(await consumeMessageCredit("user-1", db)).toEqual({
            allowed: true,
        });
    });

    it('flag "false" → DB error fails OPEN (allowed)', async () => {
        process.env.CREDITS_FAIL_CLOSED = "false";
        const { db } = makeErrorRpcDb();
        expect(await consumeMessageCredit("user-1", db)).toEqual({
            allowed: true,
        });
    });

    it('flag "true" → DB error fails CLOSED (denied)', async () => {
        process.env.CREDITS_FAIL_CLOSED = "true";
        const { db } = makeErrorRpcDb();
        const result = await consumeMessageCredit("user-1", db);
        expect(result).toMatchObject({
            allowed: false,
            limit: MONTHLY_CREDIT_LIMIT,
        });
    });
});

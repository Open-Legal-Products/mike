import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Gated integration test: proves the consume_message_credit row-lock holds under
// concurrency (the fix for the credits TOCTOU race). Needs a real Postgres/
// Supabase; skipped when the test env isn't provided (as in the default CI unit
// run). Locally: point SUPABASE_TEST_URL / SUPABASE_TEST_SERVICE_ROLE_KEY at a
// local `supabase start` stack.
const url = process.env.SUPABASE_TEST_URL;
const serviceKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;
const maybeDescribe = url && serviceKey ? describe : describe.skip;

maybeDescribe("consume_message_credit — concurrency (row-lock)", () => {
    // Constructed lazily in beforeAll (not at describe-body scope): Vitest still
    // executes a `describe.skip` factory to collect its tests, so building the
    // client here would call createClient(undefined) and throw in the default,
    // env-less run — failing the suite it's meant to skip. beforeAll doesn't run
    // for a skipped describe, so this only constructs when the env is present.
    let admin: ReturnType<typeof createClient>;
    const email = `credit-race-${Date.now()}@test.local`;
    let userId = "";

    beforeAll(async () => {
        admin = createClient(url!, serviceKey!, {
            auth: { autoRefreshToken: false, persistSession: false },
        });
        const { data, error } = await admin.auth.admin.createUser({
            email,
            password: "CreditRaceTest1!",
            email_confirm: true,
        });
        if (error || !data.user) throw error ?? new Error("no user created");
        userId = data.user.id;
        // Ensure a profile row at used=0 with the reset window in the future
        // (so the reset branch doesn't fire), regardless of trigger presence.
        await admin.from("user_profiles").upsert(
            {
                user_id: userId,
                message_credits_used: 0,
                credits_reset_date: new Date(
                    Date.now() + 30 * 24 * 60 * 60 * 1000,
                ).toISOString(),
            },
            { onConflict: "user_id" },
        );
    });

    afterAll(async () => {
        if (userId) await admin.auth.admin.deleteUser(userId);
    });

    it("admits exactly `limit` of N concurrent consumers and never overspends", async () => {
        const LIMIT = 5;
        const CONCURRENCY = 25;

        // Fire all consumes at once — this is the race the row-lock must survive.
        const results = await Promise.all(
            Array.from({ length: CONCURRENCY }, () =>
                admin.rpc("consume_message_credit", {
                    p_user_id: userId,
                    p_limit: LIMIT,
                }),
            ),
        );

        const rows = results.map((r) => {
            if (r.error) throw r.error;
            return (Array.isArray(r.data) ? r.data[0] : r.data) as {
                allowed: boolean;
                used: number;
            };
        });
        const allowed = rows.filter((row) => row.allowed).length;
        const denied = rows.filter((row) => !row.allowed).length;

        // Exactly LIMIT succeed; the rest are denied — no overspend under load.
        expect(allowed).toBe(LIMIT);
        expect(denied).toBe(CONCURRENCY - LIMIT);

        // And the persisted counter equals LIMIT exactly (not LIMIT+races).
        const { data } = await admin
            .from("user_profiles")
            .select("message_credits_used")
            .eq("user_id", userId)
            .single();
        expect(data?.message_credits_used).toBe(LIMIT);
    });
});

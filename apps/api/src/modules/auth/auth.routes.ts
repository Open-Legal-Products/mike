import { Router } from "express";
import { createClient } from "@supabase/supabase-js";
import { env } from "../../lib/env";
import { getAdminClient } from "../../lib/supabase";
import { logger } from "../../lib/logger";

export const guestRouter = Router();

// Fixed local-only guest identity. Only ever created where this endpoint runs,
// which is never production (guarded below).
const GUEST_EMAIL = "guest@local.mike";
const GUEST_PASSWORD = "guest-local-development-only";

/**
 * POST /auth/guest — dev-only "continue as guest".
 *
 * Provisions (idempotently) a fixed guest user and returns a real Supabase
 * session so the browser can sign in without the signup form. HARD-GATED to
 * non-production: a well-known guest credential must never exist on a hosted
 * deployment (it would be an auth bypass). The web button is also hidden in
 * production builds — this is the server-side half of that gate.
 */
guestRouter.post("/guest", async (_req, res) => {
    if (env.NODE_ENV === "production") {
        return void res
            .status(403)
            .json({ detail: "Guest login is disabled in production." });
    }

    try {
        const admin = getAdminClient();
        // Idempotent: ignore "already registered" on repeat calls.
        const { error: createErr } = await admin.auth.admin.createUser({
            email: GUEST_EMAIL,
            password: GUEST_PASSWORD,
            email_confirm: true,
        });
        if (createErr && !/already|exists|registered/i.test(createErr.message)) {
            throw createErr;
        }

        // Password-grant sign-in to mint a session (separate client so the
        // shared admin client's state isn't touched).
        const authClient = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
            auth: { persistSession: false, autoRefreshToken: false },
        });
        const { data, error } = await authClient.auth.signInWithPassword({
            email: GUEST_EMAIL,
            password: GUEST_PASSWORD,
        });
        if (error || !data.session) {
            throw error ?? new Error("guest sign-in returned no session");
        }

        return void res.json({
            access_token: data.session.access_token,
            refresh_token: data.session.refresh_token,
        });
    } catch (err) {
        logger.error({ err }, "[auth/guest] failed to create guest session");
        return void res
            .status(500)
            .json({ detail: "Failed to start a guest session." });
    }
});

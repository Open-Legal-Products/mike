import { Request, Response, NextFunction } from "express";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL ?? "";
const serviceKey = process.env.SUPABASE_SECRET_KEY ?? "";

if (!supabaseUrl || !serviceKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY must be set");
}

const adminClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
});

export async function requireAuth(
    req: Request,
    res: Response,
    next: NextFunction,
): Promise<void> {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (!token) {
        res.status(401).json({ detail: "Not authenticated" });
        return;
    }

    const { data: { user }, error } = await adminClient.auth.getUser(token);

    if (error || !user) {
        res.status(401).json({ detail: "Invalid or expired session" });
        return;
    }

    res.locals.userId = user.id;
    res.locals.userEmail = user.email ?? "";
    res.locals.token = token;
    next();
}

import { Request, Response, NextFunction } from "express";
import { createClient } from "@supabase/supabase-js";
import jwt from "jsonwebtoken";

export async function requireAuth(
    req: Request,
    res: Response,
    next: NextFunction,
): Promise<void> {
    const auth = req.headers.authorization ?? "";
    if (!auth.startsWith("Bearer ")) {
        res.status(401).json({ detail: "Missing or invalid Authorization header" });
        return;
    }
    const token = auth.slice(7).trim();

    if (process.env.AUTH_MODE === "local") {
        const secret = process.env.JWT_SECRET;
        if (!secret) {
            res.status(500).json({ detail: "JWT_SECRET is not configured" });
            return;
        }
        try {
            const payload = jwt.verify(token, secret) as { sub: string; email: string };
            res.locals.userId = payload.sub;
            res.locals.userEmail = (payload.email ?? "").toLowerCase();
            res.locals.token = token;
            next();
        } catch {
            res.status(401).json({ detail: "Invalid or expired token" });
        }
        return;
    }

    // Supabase mode (default)
    const supabaseUrl = process.env.SUPABASE_URL ?? "";
    const serviceKey = process.env.SUPABASE_SECRET_KEY ?? "";
    if (!supabaseUrl || !serviceKey) {
        res.status(500).json({ detail: "Server auth is not configured" });
        return;
    }
    const admin = createClient(supabaseUrl, serviceKey, {
        auth: { persistSession: false },
    });
    const { data } = await admin.auth.getUser(token);
    if (!data.user) {
        res.status(401).json({ detail: "Invalid or expired token" });
        return;
    }
    res.locals.userId = data.user.id;
    res.locals.userEmail = (data.user.email ?? "").toLowerCase();
    res.locals.token = token;
    next();
}

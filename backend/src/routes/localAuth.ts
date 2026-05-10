/**
 * Local authentication endpoints — only active when AUTH_MODE=local.
 *
 * POST /auth/register  { email, password } → { access_token, user }
 * POST /auth/login     { email, password } → { access_token, user }
 *
 * JWTs are signed with JWT_SECRET and expire in JWT_EXPIRY_DAYS (default 30).
 */

import { Router } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { Pool } from "pg";

export const localAuthRouter = Router();

function getPool(): Pool {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL must be set when AUTH_MODE=local");
    // Re-use the pool from db.ts indirectly — we import here to avoid circular deps.
    // A lightweight pool created once per process.
    return new Pool({ connectionString: url, max: 5 });
}

let _pool: Pool | null = null;
function pool(): Pool {
    if (!_pool) _pool = getPool();
    return _pool;
}

function jwtSecret(): string {
    const s = process.env.JWT_SECRET;
    if (!s) throw new Error("JWT_SECRET must be set when AUTH_MODE=local");
    return s;
}

function jwtExpirySeconds(): number {
    const days = parseInt(process.env.JWT_EXPIRY_DAYS ?? "30", 10);
    return (isFinite(days) && days > 0 ? days : 30) * 86400;
}

function makeToken(userId: string, email: string): string {
    return jwt.sign(
        { sub: userId, email },
        jwtSecret(),
        { expiresIn: jwtExpirySeconds() },
    );
}

localAuthRouter.post("/register", async (req, res) => {
    const { email, password } = req.body ?? {};
    if (typeof email !== "string" || typeof password !== "string") {
        return void res.status(400).json({ detail: "email and password are required" });
    }
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail || !password) {
        return void res.status(400).json({ detail: "email and password are required" });
    }
    if (password.length < 6) {
        return void res.status(400).json({ detail: "Password must be at least 6 characters" });
    }

    try {
        const existing = await pool().query(
            "SELECT id FROM users WHERE email = $1",
            [trimmedEmail],
        );
        if ((existing.rowCount ?? 0) > 0) {
            return void res.status(409).json({ detail: "Email already registered" });
        }

        const hash = await bcrypt.hash(password, 12);
        const result = await pool().query(
            "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email",
            [trimmedEmail, hash],
        );
        const user = result.rows[0] as { id: string; email: string };
        // Create user_profiles row
        await pool().query(
            "INSERT INTO user_profiles (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING",
            [user.id],
        );
        const access_token = makeToken(user.id, user.email);
        res.status(201).json({ access_token, user: { id: user.id, email: user.email } });
    } catch (err) {
        console.error("[local-auth] register error", err);
        res.status(500).json({ detail: "Registration failed" });
    }
});

localAuthRouter.post("/login", async (req, res) => {
    const { email, password } = req.body ?? {};
    if (typeof email !== "string" || typeof password !== "string") {
        return void res.status(400).json({ detail: "email and password are required" });
    }
    const trimmedEmail = email.trim().toLowerCase();

    try {
        const result = await pool().query(
            "SELECT id, email, password_hash FROM users WHERE email = $1",
            [trimmedEmail],
        );
        const user = result.rows[0] as { id: string; email: string; password_hash: string } | undefined;
        if (!user) {
            return void res.status(401).json({ detail: "Invalid credentials" });
        }
        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) {
            return void res.status(401).json({ detail: "Invalid credentials" });
        }
        const access_token = makeToken(user.id, user.email);
        res.json({ access_token, user: { id: user.id, email: user.email } });
    } catch (err) {
        console.error("[local-auth] login error", err);
        res.status(500).json({ detail: "Login failed" });
    }
});

import { Request, Response, NextFunction } from "express";
import { createClient } from "@supabase/supabase-js";
import {
  installAccessDeniedMessage,
  isEmailAllowedForInstall,
} from "../lib/accessPolicy";

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

  const userEmail = data.user.email?.toLowerCase() ?? "";
  if (!isEmailAllowedForInstall(userEmail)) {
    res.status(403).json({ detail: installAccessDeniedMessage() });
    return;
  }

  res.locals.userId = data.user.id;
  res.locals.userEmail = userEmail;
  res.locals.token = token;
  next();
}

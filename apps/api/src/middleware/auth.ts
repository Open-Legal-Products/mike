import { Request, Response, NextFunction } from "express";
import { getAdminClient } from "../lib/supabase";
import { sendError } from "../lib/http";

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const auth = req.headers.authorization ?? "";
  if (!auth.startsWith("Bearer ")) {
    sendError(res, 401, "UNAUTHORIZED", "Missing or invalid Authorization header");
    return;
  }
  const token = auth.slice(7).trim();

  const { data } = await getAdminClient().auth.getUser(token);
  if (!data.user) {
    sendError(res, 401, "UNAUTHORIZED", "Invalid or expired token");
    return;
  }

  res.locals.userId = data.user.id;
  res.locals.userEmail = data.user.email?.toLowerCase() ?? "";
  res.locals.token = token;
  next();
}

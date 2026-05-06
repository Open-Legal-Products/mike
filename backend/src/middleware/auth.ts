import { Request, Response, NextFunction } from "express";

export async function requireAuth(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  res.locals.userId    = 'internal';
  res.locals.userEmail = 'internal@carbonleo.com';
  res.locals.token     = '';
  next();
}

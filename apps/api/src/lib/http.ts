import type { Request, Response } from "express";
import type { ZodSchema } from "zod";

export type ApiErrorCode =
    | "BAD_REQUEST"
    | "VALIDATION_ERROR"
    | "NOT_FOUND"
    | "UNAUTHORIZED"
    | "FORBIDDEN"
    | "RATE_LIMITED"
    | "CREDIT_LIMIT_EXCEEDED"
    | "STORAGE_UNAVAILABLE"
    | "INTERNAL_ERROR";

export function sendError(
    res: Response,
    status: number,
    code: ApiErrorCode | string,
    message: string,
): void {
    res.status(status).json({
        detail: message,
        error: { code, message },
    });
}

export function sendValidationError(res: Response, message: string): void {
    sendError(res, 400, "VALIDATION_ERROR", message);
}

export function parseBody<T>(
    schema: ZodSchema<T>,
    req: Request,
    res: Response,
): T | null {
    const result = schema.safeParse(req.body);
    if (result.success) return result.data;

    const message = result.error.issues
        .map((issue) => {
            const path = issue.path.length ? `${issue.path.join(".")}: ` : "";
            return `${path}${issue.message}`;
        })
        .join("; ");
    sendValidationError(res, message);
    return null;
}

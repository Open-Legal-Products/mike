import type { NextFunction, Request, Response } from "express";
import { runWithRequestContext } from "../lib/observability/requestContext";

/**
 * Bind the current request's id into AsyncLocalStorage for the lifetime of the
 * request, so the logger's mixin can stamp `request_id` onto every log line the
 * handlers emit — not just pino-http's one auto-summary line.
 *
 * MUST be registered AFTER `httpLogger` (pino-http): pino-http's genReqId is what
 * mints the id and echoes it on the `x-request-id` response header, and it sets
 * `req.id`. We reuse that exact value here rather than minting a second id, so the
 * header a client sees and the `request_id` in the logs are always identical.
 */
export function requestContext(
    req: Request,
    _res: Response,
    next: NextFunction,
): void {
    runWithRequestContext({ requestId: String(req.id) }, () => next());
}

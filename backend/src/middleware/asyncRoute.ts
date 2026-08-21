// Shared plumbing for async Express handlers.
//
// Express 4 does not understand promises: an `async` handler that rejects is
// invisible to the router, so the request hangs until the client or the proxy
// times out and nothing is logged. `asyncRoute` forwards the rejection to
// `next(err)`, and an error middleware turns it into a 500.

import type { NextFunction, Request, Response } from "express";
import { safeErrorLog, safeErrorMessage } from "../lib/safeError";

export type AsyncRoute = (req: Request, res: Response) => Promise<unknown>;

export function asyncRoute(handler: AsyncRoute) {
  return (req: Request, res: Response, next: NextFunction) => {
    void handler(req, res).catch(next);
  };
}

// Builds a router-scoped error middleware. Express 4 identifies error
// middleware purely by arity, so all four parameters must stay declared even
// when `_req` is unused. A response that already started streaming (SSE, a
// file download) is handed to the next error handler instead — its status
// line is long gone, so the only honest thing left is to let Express destroy
// the connection.
export function routerErrorHandler(tag: string, detail: string) {
  return (err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(err);
    // body-parser and multer tag their errors with a client-error status
    // (malformed JSON is 400, an oversized payload 413). Express's default
    // handler honours that status, so this one has to as well — answering 500
    // would blame the server for the caller's request.
    const status = clientErrorStatus(err);
    if (status) {
      console.warn(`${tag} rejected request`, safeErrorLog(err));
      return void res
        .status(status)
        .json({ detail: safeErrorMessage(err, detail) });
    }
    console.error(`${tag} unhandled route error`, safeErrorLog(err));
    res.status(500).json({ detail });
  };
}

function clientErrorStatus(err: unknown): number | null {
  const candidate = err as { status?: unknown; statusCode?: unknown } | null;
  const status = candidate?.status ?? candidate?.statusCode;
  return typeof status === "number" && status >= 400 && status < 500
    ? status
    : null;
}

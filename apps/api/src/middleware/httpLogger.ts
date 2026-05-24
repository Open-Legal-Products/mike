import pinoHttp from "pino-http";
import { randomUUID } from "crypto";
import { logger } from "../lib/logger";

export const httpLogger = pinoHttp({
    logger,
    genReqId: (req, res) => {
        const existing = req.headers["x-request-id"] as string | undefined;
        const id = existing ?? randomUUID();
        res.setHeader("x-request-id", id);
        return id;
    },
    autoLogging: {
        ignore: (req) => ["/health", "/ready"].includes(req.url ?? ""),
    },
    customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return "error";
        if (res.statusCode >= 400) return "warn";
        return "info";
    },
});

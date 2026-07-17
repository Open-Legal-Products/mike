import type { NextFunction, Request, Response } from "express";
import type { RuntimeConfig } from "../config/runtime";

export const ROSS_DATA_BOUNDARY_HEADER = "x-ross-data-boundary";
export const ROSS_DATA_BOUNDARY_VALUE = "synthetic-or-non-confidential";

const CONTENT_PATHS = [
    /^\/chat(?:\/|$)/,
    /^\/projects(?:\/|$)/,
    /^\/single-documents(?:\/|$)/,
    /^\/tabular-review(?:\/|$)/,
    /^\/workflows(?:\/|$)/,
    /^\/support(?:\/|$)/,
];

export function isContentBearingRequest(method: string, path: string): boolean {
    if (!["POST", "PUT", "PATCH"].includes(method.toUpperCase())) return false;
    return CONTENT_PATHS.some((pattern) => pattern.test(path.split("?")[0]));
}

export function enforceHostedDataBoundary(config: RuntimeConfig) {
    return (req: Request, res: Response, next: NextFunction) => {
        if (
            config.hostedMode !== "controlled-beta" ||
            !isContentBearingRequest(req.method, req.originalUrl || req.path)
        ) {
            next();
            return;
        }
        if (
            req.header(ROSS_DATA_BOUNDARY_HEADER) !== ROSS_DATA_BOUNDARY_VALUE
        ) {
            res.status(428).json({
                code: "ross_data_boundary_acknowledgement_required",
                detail: "The controlled beta accepts only synthetic or affirmatively non-confidential material. Acknowledge the current data boundary before submitting content.",
                boundaryVersion: config.dataBoundaryVersion,
            });
            return;
        }
        res.setHeader(
            "X-ROSS-Data-Boundary-Version",
            config.dataBoundaryVersion,
        );
        next();
    };
}

import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { parseBody, sendError } from "../http";

function makeRes() {
    return {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
    } as any;
}

describe("http helpers", () => {
    it("sends both legacy detail and standard error envelope", () => {
        const res = makeRes();
        sendError(res, 404, "NOT_FOUND", "Missing");
        expect(res.status).toHaveBeenCalledWith(404);
        expect(res.json).toHaveBeenCalledWith({
            detail: "Missing",
            error: { code: "NOT_FOUND", message: "Missing" },
        });
    });

    it("returns parsed body when validation succeeds", () => {
        const res = makeRes();
        const body = parseBody(
            z.object({ title: z.string().min(1) }),
            { body: { title: "NDA review" } } as any,
            res,
        );
        expect(body).toEqual({ title: "NDA review" });
        expect(res.status).not.toHaveBeenCalled();
    });

    it("sends validation envelope when parsing fails", () => {
        const res = makeRes();
        const body = parseBody(
            z.object({ title: z.string().min(1) }),
            { body: { title: "" } } as any,
            res,
        );
        expect(body).toBeNull();
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json.mock.calls[0][0]).toMatchObject({
            error: { code: "VALIDATION_ERROR" },
        });
        expect(res.json.mock.calls[0][0].detail).toContain("title");
    });
});

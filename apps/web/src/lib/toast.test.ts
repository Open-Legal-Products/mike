import { afterEach, describe, expect, it, vi } from "vitest";

const error = vi.fn();
const success = vi.fn();

vi.mock("sonner", () => ({
    toast: {
        error: (msg: string) => error(msg),
        success: (msg: string) => success(msg),
    },
}));

import { errorMessage, toastError, toastSuccess } from "./toast";

afterEach(() => {
    error.mockClear();
    success.mockClear();
});

describe("errorMessage", () => {
    it("uses an Error's message", () => {
        expect(errorMessage(new Error("boom"))).toBe("boom");
    });

    it("uses a non-empty string directly", () => {
        expect(errorMessage("nope")).toBe("nope");
    });

    it("reads a message field off a plain object", () => {
        expect(errorMessage({ message: "object msg" })).toBe("object msg");
    });

    it("falls back when nothing useful is present", () => {
        expect(errorMessage(null, "fallback")).toBe("fallback");
        expect(errorMessage({}, "fallback")).toBe("fallback");
        expect(errorMessage(new Error(""), "fallback")).toBe("fallback");
    });

    it("uses the default fallback when none is given", () => {
        expect(errorMessage(undefined)).toBe("Something went wrong");
    });
});

describe("toastError / toastSuccess", () => {
    it("forwards the derived message to toast.error", () => {
        toastError(new Error("kaboom"));
        expect(error).toHaveBeenCalledWith("kaboom");
    });

    it("forwards the fallback when the error is opaque", () => {
        toastError(null, "Failed to delete");
        expect(error).toHaveBeenCalledWith("Failed to delete");
    });

    it("forwards success messages to toast.success", () => {
        toastSuccess("Saved");
        expect(success).toHaveBeenCalledWith("Saved");
    });
});

import { describe, it, expect } from "vitest";
import {
    redactSensitiveText,
    safeErrorMessage,
    safeErrorLog,
} from "../safeError";

// ---------------------------------------------------------------------------
// redactSensitiveText
// ---------------------------------------------------------------------------

describe("redactSensitiveText", () => {
    it('redacts the OpenAI "Incorrect API key provided" message', () => {
        expect(
            redactSensitiveText(
                "Incorrect API key provided: sk-proj-abc123def456ghi789.",
            ),
        ).toBe("Incorrect API key provided: [redacted].");
    });

    it("keeps the trailing period optional in the incorrect-key message", () => {
        expect(
            redactSensitiveText("Incorrect API key provided: badkey123"),
        ).toBe("Incorrect API key provided: [redacted]");
    });

    it("redacts secrets after api_key labels", () => {
        expect(redactSensitiveText("api_key: mysecret123")).toBe(
            "api_key: [redacted]",
        );
        expect(redactSensitiveText("api key = mysecret123")).toBe(
            "api key = [redacted]",
        );
    });

    it("redacts secrets after token/secret/authorization labels", () => {
        expect(redactSensitiveText("token: abcdef123456")).toBe(
            "token: [redacted]",
        );
        expect(redactSensitiveText("secret is abcdef123456")).toBe(
            "secret is [redacted]",
        );
        expect(redactSensitiveText("authorization: abcdef123456")).toBe(
            "authorization: [redacted]",
        );
    });

    it("leaves short values after labels alone (below 6 chars)", () => {
        expect(redactSensitiveText("token: abc")).toBe("token: abc");
    });

    it("redacts bare OpenAI-style sk- keys anywhere in the text", () => {
        expect(
            redactSensitiveText("request failed for sk-abc123def456ghi789 today"),
        ).toBe("request failed for [redacted] today");
    });

    it("redacts bare Anthropic-style sk-ant- keys", () => {
        expect(
            redactSensitiveText("used sk-ant-api03-abc123def456"),
        ).toBe("used [redacted]");
    });

    it("redacts bare Google AIza keys", () => {
        expect(
            redactSensitiveText("key AIzaSyA1234567890abcdefghij failed"),
        ).toBe("key [redacted] failed");
    });

    it("redacts multiple secrets in one string", () => {
        const result = redactSensitiveText(
            "first sk-abc123def456ghi789 then AIzaSyA1234567890abcdefghij",
        );
        expect(result).toBe("first [redacted] then [redacted]");
    });

    it("leaves ordinary text unchanged", () => {
        expect(redactSensitiveText("Document not found")).toBe(
            "Document not found",
        );
    });
});

// ---------------------------------------------------------------------------
// safeErrorMessage
// ---------------------------------------------------------------------------

describe("safeErrorMessage", () => {
    it("uses the message of an Error instance", () => {
        expect(safeErrorMessage(new Error("boom"))).toBe("boom");
    });

    it("redacts secrets inside an Error message", () => {
        expect(
            safeErrorMessage(new Error("bad key sk-abc123def456ghi789")),
        ).toBe("bad key [redacted]");
    });

    it("passes plain strings through (redacted)", () => {
        expect(safeErrorMessage("token: abcdef123456")).toBe(
            "token: [redacted]",
        );
    });

    it("falls back for non-Error, non-string values", () => {
        expect(safeErrorMessage(42)).toBe("Unexpected error");
        expect(safeErrorMessage(null)).toBe("Unexpected error");
        expect(safeErrorMessage({ message: "obj" })).toBe("Unexpected error");
    });

    it("falls back for an Error with an empty message", () => {
        expect(safeErrorMessage(new Error(""))).toBe("Unexpected error");
    });

    it("honors a custom fallback", () => {
        expect(safeErrorMessage(undefined, "Chat failed")).toBe("Chat failed");
    });
});

// ---------------------------------------------------------------------------
// safeErrorLog
// ---------------------------------------------------------------------------

describe("safeErrorLog", () => {
    it("captures name, message, and stack for an Error", () => {
        const error = new Error("boom");
        const log = safeErrorLog(error);
        expect(log.name).toBe("Error");
        expect(log.message).toBe("boom");
        expect(log.stack).toContain("boom");
    });

    it("redacts secrets in the message and stack", () => {
        const error = new Error("bad key sk-abc123def456ghi789");
        const log = safeErrorLog(error);
        expect(log.message).toBe("bad key [redacted]");
        expect(log.stack).not.toContain("sk-abc123def456ghi789");
    });

    it("falls back to 'Unexpected error' for an empty Error message", () => {
        expect(safeErrorLog(new Error("")).message).toBe("Unexpected error");
    });

    it("omits the stack when the Error has none", () => {
        const error = new Error("boom");
        error.stack = undefined;
        expect(safeErrorLog(error).stack).toBeUndefined();
    });

    it("handles non-Error values with a null name and no stack", () => {
        const log = safeErrorLog("plain failure");
        expect(log).toEqual({ name: null, message: "plain failure" });
    });
});

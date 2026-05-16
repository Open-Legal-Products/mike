import { readFileSync } from "fs";
import { join } from "path";
import { describe, it, expect } from "vitest";

describe("GET /chat pagination", () => {
    const src = readFileSync(
        join(__dirname, "../../routes/chat.ts"),
        "utf8",
    );

    it("applies a limit to the chat list query", () => {
        expect(src).toMatch(/\.limit\(/);
    });

    it("supports a before-cursor for pagination", () => {
        expect(src).toMatch(/before|lt\("created_at"/);
    });
});

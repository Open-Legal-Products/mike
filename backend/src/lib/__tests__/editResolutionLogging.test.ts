import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { describe, it, expect } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Static analysis: the edit-resolution handler must not emit PII at INFO level.
// Extract only the handler section (between the shared handler fn start and the
// two route registrations at the bottom).
describe("edit-resolution handler logging", () => {
    const src = readFileSync(
        join(__dirname, "../../routes/documents.ts"),
        "utf8",
    );

    // Isolate the resolveEditHandler function body
    const handlerStart = src.indexOf("async function resolveEditHandler");
    const handlerEnd = src.indexOf('"/:documentId/edits/:editId/accept"');
    const handlerSrc =
        handlerStart !== -1 && handlerEnd !== -1
            ? src.slice(handlerStart, handlerEnd)
            : src;

    it("contains no console.log with userId in edit-resolution handler", () => {
        const matches = handlerSrc.match(/console\.log\([^)]*userId[^)]*\)/g);
        expect(matches).toBeNull();
    });

    it("contains no console.log with editId in edit-resolution handler", () => {
        const matches = handlerSrc.match(/console\.log\([^)]*editId[^)]*\)/g);
        expect(matches).toBeNull();
    });

    it("contains no console.log with documentId in edit-resolution handler", () => {
        const matches = handlerSrc.match(/console\.log\([^)]*documentId[^)]*\)/g);
        expect(matches).toBeNull();
    });
});

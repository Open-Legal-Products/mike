import { Router } from "express";
import path from "path";
import { verifyLocalFile } from "../lib/localSignedTokens";
import { downloadFile } from "../lib/storage";
import { buildContentDisposition } from "../lib/storage";

export const localFilesRouter = Router();

function contentTypeFor(filename: string): string {
    const lower = filename.toLowerCase();
    if (lower.endsWith(".pdf")) return "application/pdf";
    if (lower.endsWith(".docx"))
        return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    if (lower.endsWith(".doc")) return "application/msword";
    if (lower.endsWith(".xlsx"))
        return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    return "application/octet-stream";
}

// GET /local-files/:token
// No authentication required — the HMAC-signed, time-limited token is the credential.
localFilesRouter.get("/:token", async (req, res) => {
    const info = verifyLocalFile(req.params.token);
    if (!info) return void res.status(404).json({ detail: "Invalid or expired link" });

    // Prevent path traversal: storage keys must not escape LOCAL_STORAGE_PATH.
    const normalized = path.normalize(info.key);
    if (normalized.startsWith("..") || path.isAbsolute(normalized)) {
        return void res.status(400).json({ detail: "Invalid key" });
    }

    const raw = await downloadFile(info.key);
    if (!raw) return void res.status(404).json({ detail: "File not found" });

    res.setHeader("Content-Type", contentTypeFor(info.filename));
    res.setHeader(
        "Content-Disposition",
        buildContentDisposition("attachment", info.filename),
    );
    res.send(Buffer.from(raw));
});

import { Router } from "express";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";
import { db } from "../db";
import { documents, document_versions } from "../db/schema";
import { buildContentDisposition, downloadFile } from "../lib/storage";
import { verifyDownload } from "../lib/downloadTokens";
import { ensureDocAccess } from "../lib/access";

export const downloadsRouter = Router();

function contentTypeFor(filename: string): string {
    const lower = filename.toLowerCase();
    if (lower.endsWith(".docx"))
        return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    if (lower.endsWith(".pdf")) return "application/pdf";
    if (lower.endsWith(".xlsx"))
        return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    return "application/octet-stream";
}

// GET /download/:token
downloadsRouter.get("/:token", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const info = verifyDownload(req.params.token);
    if (!info) return void res.status(404).json({ detail: "Invalid link" });

    const version = await db.query.document_versions.findFirst({
        where: eq(document_versions.storage_path, info.path),
        columns: { id: true, document_id: true },
    });
    if (!version) return void res.status(404).json({ detail: "File not found" });

    const doc = await db.query.documents.findFirst({
        where: eq(documents.id, version.document_id),
        columns: { id: true, user_id: true, project_id: true },
    });
    if (!doc) return void res.status(404).json({ detail: "File not found" });

    const access = await ensureDocAccess(doc, userId, userEmail, db);
    if (!access.ok)
        return void res.status(404).json({ detail: "File not found" });

    const raw = await downloadFile(info.path);
    if (!raw) return void res.status(404).json({ detail: "File not found" });

    res.setHeader("Content-Type", contentTypeFor(info.filename));
    res.setHeader(
        "Content-Disposition",
        buildContentDisposition("attachment", info.filename),
    );
    res.send(Buffer.from(raw));
});

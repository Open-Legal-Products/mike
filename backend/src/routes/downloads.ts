import { Router } from "express";
import { eq } from "drizzle-orm";

import { requireAuth } from "../middleware/auth";
import { db } from "../lib/db";
import { documents, documentVersions } from "../db/schema";
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
    if (!info)
        return void res.status(404).json({ detail: "Invalid link" });

    const [version] = await db
        .select({
            id: documentVersions.id,
            document_id: documentVersions.documentId,
        })
        .from(documentVersions)
        .where(eq(documentVersions.storagePath, info.path))
        .limit(1);
    if (!version)
        return void res.status(404).json({ detail: "File not found" });

    const [doc] = await db
        .select({
            id: documents.id,
            user_id: documents.userId,
            project_id: documents.projectId,
        })
        .from(documents)
        .where(eq(documents.id, version.document_id))
        .limit(1);
    if (!doc)
        return void res.status(404).json({ detail: "File not found" });

    const access = await ensureDocAccess(doc, userId, userEmail);
    if (!access.ok)
        return void res.status(404).json({ detail: "File not found" });

    const raw = await downloadFile(info.path);
    if (!raw)
        return void res.status(404).json({ detail: "File not found" });

    res.setHeader("Content-Type", contentTypeFor(info.filename));
    res.setHeader(
        "Content-Disposition",
        buildContentDisposition("attachment", info.filename),
    );
    res.send(Buffer.from(raw));
});

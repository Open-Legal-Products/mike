import { Router } from "express";
import { readFile } from "fs/promises";
import { requireAuth } from "../middleware/auth";
import {
  buildContentDisposition,
  normalizeDownloadFilename,
} from "../lib/storage";
import { resolveAgentRunLogFilePath } from "../lib/logger";

export const agentRunLogsRouter = Router();

// GET /agent-run-logs/:runId/:filename
agentRunLogsRouter.get("/:runId/:filename", requireAuth, async (req, res) => {
  const { runId, filename } = req.params;
  const filePath = resolveAgentRunLogFilePath(runId, filename);
  if (!filePath) {
    return void res.status(400).json({ detail: "Invalid log path" });
  }

  try {
    const content = await readFile(filePath, "utf8");
    const safeName = normalizeDownloadFilename(filename);
    res.setHeader("Content-Type", "application/x-ndjson");
    res.setHeader(
      "Content-Disposition",
      buildContentDisposition("attachment", safeName),
    );
    res.send(content);
  } catch {
    return void res.status(404).json({ detail: "Log file not found" });
  }
});

// Client half of the durable export flow: schedule the build, poll it, then
// fetch the finished artifact. Used by every caller whose payload is too big
// to build inside a request — the History CSV and bulk document zips — so the
// export survives a slow build and a closed tab alike.

import {
    downloadUserExport,
    getUserExportStatus,
    startUserExport,
    type UserExportType,
} from "@/app/lib/mikeApi";

// Tests drive the loop with fake-fast polling; 2s is the interactive rate.
const POLL_MS = process.env.NODE_ENV === "test" ? 10 : 2000;
const POLL_LIMIT = 150; // ~5 minutes

export async function runUserExport(
    type: UserExportType,
    params?: Record<string, unknown>,
): Promise<{ blob: Blob; filename: string | null }> {
    const { export_id } = await startUserExport(type, params);
    for (let i = 0; i < POLL_LIMIT; i++) {
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        const status = await getUserExportStatus(export_id);
        if (status.status === "failed") throw new Error("Export build failed");
        if (status.status === "done") {
            const { blob, filename } = await downloadUserExport(export_id);
            return { blob, filename: filename ?? status.filename };
        }
    }
    throw new Error("Export timed out");
}

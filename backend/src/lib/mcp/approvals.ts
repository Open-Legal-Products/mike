import { createServerSupabase } from "../supabase";
import type { ConnectorRow, Db, PendingToolCallRow, ToolCacheRow } from "./types";

// How long an approval request stays actionable. Short-lived by design: an
// approval is only meaningful while the chat turn that proposed the call is
// still waiting on it, and a stale "Approve" click hours later must not fire
// a tool call nobody is watching.
export const MCP_APPROVAL_TTL_MS = 2 * 60 * 1000;
// How long the streaming chat turn waits for the user's decision before
// giving up and telling the model the call was not approved. Kept under the
// TTL and under the global stream watchdog.
export const MCP_APPROVAL_WAIT_MS = 90 * 1000;
const POLL_INTERVAL_MS = 1_500;

// Terminal ledger rows keep the full tool-argument payload — which in a
// legal product can contain sensitive matter data — so they must not
// accumulate forever. They stay long enough to debug a session and to
// answer "what ran today?", then get swept.
export const MCP_PENDING_CALL_RETENTION_MS = 24 * 60 * 60 * 1000;
const TERMINAL_STATUSES = ["executed", "failed", "denied", "expired"];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Opportunistic retention sweep, piggybacked on every new pending-call
 * insert (the same insert-time cleanup pattern the OAuth state store uses):
 * no cron/job infrastructure, and the table only sees traffic when the
 * approval flow is in use anyway. Only TERMINAL rows past the retention
 * window are deleted — live pending/approved/executing rows are the
 * approval flow's working state and are never touched. Best-effort by
 * design: a failed sweep must not block the approval the user is waiting
 * on; the next insert retries it.
 */
async function sweepExpiredTerminalMcpToolCalls(db: Db): Promise<void> {
    const cutoff = new Date(
        Date.now() - MCP_PENDING_CALL_RETENTION_MS,
    ).toISOString();
    const { error } = await db
        .from("user_mcp_pending_tool_calls")
        .delete()
        .in("status", TERMINAL_STATUSES)
        .lt("created_at", cutoff);
    if (error) {
        console.error("[mcp-approvals] retention sweep failed", {
            error: error.message,
        });
    }
}

/**
 * Record the EXACT call the model proposed. What the user later approves is
 * this row — execution reads the stored arguments back from it, never the
 * model's (or the client's) live values.
 */
export async function createPendingMcpToolCall(
    userId: string,
    connector: ConnectorRow,
    tool: ToolCacheRow,
    args: Record<string, unknown>,
    db: Db = createServerSupabase(),
): Promise<PendingToolCallRow> {
    await sweepExpiredTerminalMcpToolCalls(db);
    const { data, error } = await db
        .from("user_mcp_pending_tool_calls")
        .insert({
            user_id: userId,
            connector_id: connector.id,
            tool_id: tool.id,
            tool_name: tool.tool_name,
            openai_tool_name: tool.openai_tool_name,
            arguments: args,
            status: "pending",
            expires_at: new Date(Date.now() + MCP_APPROVAL_TTL_MS).toISOString(),
        })
        .select("*")
        .single();
    if (error) throw error;
    return data as PendingToolCallRow;
}

export type McpApprovalDecision = "approve" | "deny";
export type McpDecisionOutcome = "approved" | "denied" | "not_found" | "expired";

/**
 * Apply the user's decision. Single-use and bound to the caller: the UPDATE
 * only matches a row that belongs to this user, is still `pending`, and has
 * not expired — so a second click, another user's id, or a late decision all
 * fall through to a harmless non-match.
 */
export async function decideMcpPendingToolCall(
    userId: string,
    pendingId: string,
    decision: McpApprovalDecision,
    db: Db = createServerSupabase(),
): Promise<McpDecisionOutcome> {
    const nowIso = new Date().toISOString();
    const { data, error } = await db
        .from("user_mcp_pending_tool_calls")
        .update({
            status: decision === "approve" ? "approved" : "denied",
            decided_at: nowIso,
        })
        .eq("id", pendingId)
        .eq("user_id", userId)
        .eq("status", "pending")
        .gt("expires_at", nowIso)
        .select("id");
    if (error) throw error;
    if (data && data.length > 0) {
        return decision === "approve" ? "approved" : "denied";
    }

    // Distinguish "no such call" from "too late" for an honest client error.
    const { data: existing } = await db
        .from("user_mcp_pending_tool_calls")
        .select("id, status, expires_at")
        .eq("id", pendingId)
        .eq("user_id", userId)
        .single();
    if (!existing) return "not_found";
    const row = existing as { status: string; expires_at: string };
    if (row.status === "pending" && row.expires_at <= nowIso) return "expired";
    if (row.status === "expired") return "expired";
    return "not_found";
}

/**
 * Block the chat turn until the user decides (or time runs out). On timeout
 * the row is retired pending -> expired so a later "Approve" click cannot
 * revive a call whose chat turn has already moved on.
 */
export async function waitForMcpApprovalDecision(
    pendingId: string,
    db: Db = createServerSupabase(),
    waitMs: number = MCP_APPROVAL_WAIT_MS,
): Promise<"approved" | "denied" | "expired"> {
    const deadline = Date.now() + waitMs;
    for (;;) {
        const { data, error } = await db
            .from("user_mcp_pending_tool_calls")
            .select("status")
            .eq("id", pendingId)
            .single();
        if (error) throw error;
        const status = (data as { status: string }).status;
        if (status === "approved" || status === "denied") return status;
        if (status === "expired") return "expired";
        if (Date.now() >= deadline) break;
        await sleep(Math.min(POLL_INTERVAL_MS, deadline - Date.now()));
    }
    // Retire the still-undecided row (pending -> expired). The conditional
    // UPDATE doubles as a race detector: its affected-row count tells us
    // whether the row was still pending when we expired it.
    const { data: expired, error: expireError } = await db
        .from("user_mcp_pending_tool_calls")
        .update({ status: "expired" })
        .eq("id", pendingId)
        .eq("status", "pending")
        .select("id");
    if (expireError) throw expireError;
    if (((expired ?? []) as unknown[]).length > 0) return "expired";
    // Zero rows matched: the user's decision landed in the gap between our
    // last poll and the expiry UPDATE. The row is now permanently
    // approved/denied, so returning "expired" here would desynchronize the
    // ledger from what we tell the model (and, for an approval, strand a row
    // that decideMcpPendingToolCall will never touch again). Re-read once
    // and honor the decision that actually won.
    const { data: after, error: afterError } = await db
        .from("user_mcp_pending_tool_calls")
        .select("status")
        .eq("id", pendingId)
        .single();
    if (afterError) throw afterError;
    const finalStatus = (after as { status: string }).status;
    if (finalStatus === "approved" || finalStatus === "denied") {
        return finalStatus;
    }
    return "expired";
}

/**
 * Claim an approved call for execution (approved -> executing). The
 * conditional UPDATE makes execution single-use: only one caller can win the
 * transition, and the stored arguments it returns are the ONLY payload that
 * gets executed.
 */
export async function claimApprovedMcpToolCall(
    pendingId: string,
    db: Db = createServerSupabase(),
): Promise<PendingToolCallRow | null> {
    const { data, error } = await db
        .from("user_mcp_pending_tool_calls")
        .update({ status: "executing" })
        .eq("id", pendingId)
        .eq("status", "approved")
        .select("*");
    if (error) throw error;
    const rows = (data ?? []) as PendingToolCallRow[];
    return rows[0] ?? null;
}

/**
 * Record that the claimed call actually completed (executing -> executed).
 * Called AFTER the MCP call returns: the `executing` claim is what provides
 * single-use safety, so the terminal status can wait for the truth.
 */
export async function markMcpToolCallExecuted(
    pendingId: string,
    db: Db = createServerSupabase(),
): Promise<void> {
    await db
        .from("user_mcp_pending_tool_calls")
        .update({ status: "executed", executed_at: new Date().toISOString() })
        .eq("id", pendingId)
        .eq("status", "executing");
}

/**
 * Record that the claimed call was attempted but errored
 * (executing -> failed). Keeps the ledger honest: an approval whose
 * execution failed must not read as "executed". The approval is still spent
 * — `failed` is terminal, so the claim can never be retried or replayed.
 * executed_at records when the attempt finished.
 */
export async function markMcpToolCallFailed(
    pendingId: string,
    db: Db = createServerSupabase(),
): Promise<void> {
    await db
        .from("user_mcp_pending_tool_calls")
        .update({ status: "failed", executed_at: new Date().toISOString() })
        .eq("id", pendingId)
        .eq("status", "executing");
}

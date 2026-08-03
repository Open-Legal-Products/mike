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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
    await db
        .from("user_mcp_pending_tool_calls")
        .update({ status: "expired" })
        .eq("id", pendingId)
        .eq("status", "pending");
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

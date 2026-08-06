-- Pending-approval ledger for MCP tool calls.
--
-- When the model proposes calling an MCP tool that is not positively trusted,
-- the EXACT proposed call (tool + arguments) is stored here and shown to the
-- user; the tool executes only after the user approves THAT row. Approval is
-- bound to (user, pending call id, stored payload), short-lived (expires_at)
-- and single-use: the status column is a one-way state machine
--   pending -> approved -> executing -> executed  (MCP call completed)
--   pending -> approved -> executing -> failed    (MCP call errored)
--   pending -> denied
--   pending -> expired
-- enforced by conditional UPDATEs in the backend (status must match the
-- expected prior state), so a decision or execution can never happen twice.
-- `executing` is the single-use claim; the terminal `executed` / `failed`
-- states are written only after the MCP call actually finishes, so the
-- ledger records what happened, not what was about to happen.
--
-- Retention: terminal rows (executed / failed / denied / expired) keep the
-- full tool-argument payload, which can contain sensitive matter data, so
-- they are not kept forever. The backend opportunistically deletes terminal
-- rows older than a retention window whenever a new pending call is
-- inserted (see sweepExpiredTerminalMcpToolCalls in lib/mcp/approvals.ts).
--
-- RLS is enabled with no browser policies, matching the other MCP tables:
-- only the service-role backend reads or writes rows, and it always scopes
-- queries by user_id.

CREATE TABLE IF NOT EXISTS public.user_mcp_pending_tool_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  connector_id uuid NOT NULL REFERENCES public.user_mcp_connectors(id) ON DELETE CASCADE,
  tool_id uuid REFERENCES public.user_mcp_connector_tools(id) ON DELETE SET NULL,
  tool_name text NOT NULL,
  openai_tool_name text NOT NULL,
  arguments jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'denied', 'executing', 'executed', 'failed', 'expired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  decided_at timestamptz,
  executed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_user_mcp_pending_tool_calls_user
  ON public.user_mcp_pending_tool_calls(user_id);

CREATE INDEX IF NOT EXISTS idx_user_mcp_pending_tool_calls_status
  ON public.user_mcp_pending_tool_calls(status, expires_at);

ALTER TABLE public.user_mcp_pending_tool_calls ENABLE ROW LEVEL SECURITY;

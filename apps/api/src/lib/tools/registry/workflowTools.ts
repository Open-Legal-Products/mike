import { type ToolHandler, pushToolResult, spotlight } from "./context";

const listWorkflows: ToolHandler = async (_args, ctx) => {
  const list = ctx.workflowStore
    ? Array.from(ctx.workflowStore.entries()).map(([id, w]) => ({
        id,
        title: w.title,
      }))
    : [];
  pushToolResult(ctx, JSON.stringify(list));
};

const readWorkflow: ToolHandler = async (args, ctx) => {
  const { workflowStore, write, nonce } = ctx;
  const wfId = args.workflow_id as string;
  const wf = workflowStore?.get(wfId);
  if (wf) {
    write(
      `data: ${JSON.stringify({ type: "workflow_applied", workflow_id: wfId, title: wf.title })}\n\n`,
    );
    ctx.results.workflowsApplied.push({ workflow_id: wfId, title: wf.title });
  }
  // Workflow content is user-authored; spotlight it so an adversarial
  // workflow title or prompt body cannot inject instructions.
  const wfContent = wf ? wf.prompt_md : `Workflow '${wfId}' not found.`;
  pushToolResult(ctx, nonce && wf ? spotlight(wfContent, nonce) : wfContent);
};

export const workflowToolHandlers: Record<string, ToolHandler> = {
  list_workflows: listWorkflows,
  read_workflow: readWorkflow,
};

import type { Workflow } from "../shared/types";

export function workflowDetailPath(workflow: Pick<Workflow, "id" | "type">) {
    return workflow.type === "assistant"
        ? `/workflows/assistant/${workflow.id}`
        : `/workflows/tabular-review/${workflow.id}`;
}

import type { Workflow } from "../shared/types";

export function workflowDetailPath(
    workflow: Pick<Workflow, "id" | "metadata">,
) {
    return workflow.metadata.type === "assistant"
        ? `/workflows/assistant/${workflow.id}`
        : `/workflows/tabular-review/${workflow.id}`;
}

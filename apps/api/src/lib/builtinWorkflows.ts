import { BUILTIN_WORKFLOWS as CORE_BUILTIN_WORKFLOWS } from "@mike/core";

/**
 * The chat workflow store only cares about "assistant" workflows and only
 * needs their {id, title, prompt_md}. Rather than maintain a second hand-written
 * copy of that data (which had drifted from the web catalog), derive it from the
 * single source of truth in @mike/core.
 *
 * This yields the same three assistant workflows the API served before
 * (builtin-cp-checklist, builtin-credit-summary, builtin-sha-summary), so
 * chatContext.buildWorkflowStore behaves identically.
 */
export const BUILTIN_WORKFLOWS: {
    id: string;
    title: string;
    prompt_md: string;
}[] = CORE_BUILTIN_WORKFLOWS.filter((w) => w.type === "assistant").map((w) => ({
    id: w.id,
    title: w.title,
    prompt_md: w.prompt_md ?? "",
}));

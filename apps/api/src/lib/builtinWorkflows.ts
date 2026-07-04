import { SYSTEM_ASSISTANT_WORKFLOWS } from "./systemWorkflows";

/**
 * The chat workflow store only cares about "assistant" workflows and only
 * needs their {id, title, prompt_md}. Built-in workflows are single-sourced in
 * lib/systemWorkflows.ts (generated from the open-source workflow repository
 * metadata), so derive the legacy BUILTIN_WORKFLOWS surface from it rather
 * than maintaining a second hand-written copy.
 *
 * Kept for the legacy chatContext.buildWorkflowStore path; the new lib/chat
 * context builders import SYSTEM_ASSISTANT_WORKFLOWS directly.
 */
export const BUILTIN_WORKFLOWS: {
    id: string;
    title: string;
    prompt_md: string;
}[] = SYSTEM_ASSISTANT_WORKFLOWS;

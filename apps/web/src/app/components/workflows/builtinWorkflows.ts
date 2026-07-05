// Built-in / system workflows now live in @mike/core as the single source of
// truth (shared with the API). This module re-exports them under the names the
// web components already import, so no call sites need to change.
export {
    BUILTIN_WORKFLOWS as BUILT_IN_WORKFLOWS,
    BUILTIN_WORKFLOW_IDS as BUILT_IN_IDS,
} from "@mike/core";

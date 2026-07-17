import type { ToolHandler } from "./context";
import { documentToolHandlers } from "./documentTools";
import { workflowToolHandlers } from "./workflowTools";
import { tabularToolHandlers } from "./tabularTools";
import { caseLawToolHandlers } from "./caseLawTools";

export {
  type ToolHandler,
  type ToolExecutionContext,
  type ToolRunResults,
  type FindInCaseGroupState,
  pushToolResult,
  spotlight,
  citationReminder,
} from "./context";

const builtinHandlers = new Map<string, ToolHandler>([
  ...Object.entries(documentToolHandlers),
  ...Object.entries(workflowToolHandlers),
  ...Object.entries(tabularToolHandlers),
  ...Object.entries(caseLawToolHandlers),
]);

// Extension point for plugins (e.g. law library plugins that contribute tool
// schemas via registerLawLibrary): register the matching executor here so the
// tool call is handled without editing runToolCalls. Built-in handlers always
// win a name collision — a plugin must not be able to shadow the built-in
// tools and bypass their spotlighting/nonce fencing of untrusted output.
const pluginHandlers = new Map<string, ToolHandler>();

export function registerToolHandler(name: string, handler: ToolHandler): void {
  pluginHandlers.set(name, handler);
}

export function getToolHandler(name: string): ToolHandler | undefined {
  return builtinHandlers.get(name) ?? pluginHandlers.get(name);
}

/** Exposed for test isolation only — do not call in production code. */
export function _resetPluginToolHandlersForTesting(): void {
  pluginHandlers.clear();
}

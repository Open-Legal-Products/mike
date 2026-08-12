import type { ApiKeyStatus } from "../api/mikeApi";

/**
 * Keep this catalog, its labels, and DEFAULT_MODEL_ID in sync with
 * frontend/src/app/components/assistant/ModelToggle.tsx until both clients use
 * a single shared package.
 */
export type ModelGroup = "Anthropic" | "Google" | "OpenAI" | "Local";

export interface ModelOption {
  id: string;
  label: string;
  group: ModelGroup;
}

export const STATIC_MODELS: readonly ModelOption[] = [
  { id: "claude-fable-5", label: "Claude Fable 5", group: "Anthropic" },
  { id: "claude-opus-4-8", label: "Claude Opus 4.8", group: "Anthropic" },
  { id: "claude-opus-4-7", label: "Claude Opus 4.7", group: "Anthropic" },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", group: "Anthropic" },
  { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash", group: "Google" },
  { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro", group: "Google" },
  { id: "gemini-3-flash-preview", label: "Gemini 3 Flash", group: "Google" },
  { id: "gpt-5.5", label: "GPT-5.5", group: "OpenAI" },
  { id: "gpt-5.4", label: "GPT-5.4", group: "OpenAI" },
];

export const DEFAULT_MODEL_ID = "gemini-3-flash-preview";
export const ALLOWED_MODEL_IDS = new Set(
  STATIC_MODELS.map((model) => model.id),
);

export function isAllowedModelId(id: string): boolean {
  return ALLOWED_MODEL_IDS.has(id) || id.startsWith("ollama/");
}

export function isModelAvailable(
  modelId: string,
  status: ApiKeyStatus | null,
): boolean {
  if (!status || modelId.startsWith("ollama/")) return true;
  const model = STATIC_MODELS.find((item) => item.id === modelId);
  if (!model || model.group === "Local") return true;
  if (model.group === "Anthropic") return !!status.claude;
  if (model.group === "Google") return !!status.gemini;
  return !!status.openai;
}

export function missingModelProvider(modelId: string): string {
  const group = STATIC_MODELS.find((item) => item.id === modelId)?.group;
  return group === "Anthropic"
    ? "Anthropic"
    : group === "Google"
      ? "Google"
      : group === "OpenAI"
        ? "OpenAI"
        : "model provider";
}

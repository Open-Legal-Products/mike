// Imported from the base client (not the ../api/mikeApi barrel) so this
// module's compile graph stays free of Office globals: the drift-guard test in
// frontend/src/wordAddin imports this file across packages.
import type { ApiKeyStatus } from "../api/client";

/**
 * Keep this catalog, its labels, and DEFAULT_MODEL_ID in sync with
 * frontend/src/app/components/assistant/ModelToggle.tsx until both clients use
 * a single shared package.
 */
export type ModelGroup =
  | "Anthropic"
  | "Google"
  | "OpenAI"
  | "OpenRouter"
  | "Vercel AI Gateway"
  | "OpenCode Go"
  | "Synthetic"
  | "Local";

/** Kept in sync with frontend ModelToggle.tsx ROUTER_SLUGS. */
export const ROUTER_SLUGS = [
  "openrouter",
  "vercel",
  "opencode-go",
  "synthetic",
] as const;

export interface ModelOption {
  id: string;
  label: string;
  group: ModelGroup;
}

export const STATIC_MODELS: readonly ModelOption[] = [
  { id: "claude-fable-5", label: "Claude Fable 5", group: "Anthropic" },
  { id: "claude-opus-5", label: "Claude Opus 5", group: "Anthropic" },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5", group: "Anthropic" },
  { id: "claude-opus-4-8", label: "Claude Opus 4.8", group: "Anthropic" },
  { id: "claude-opus-4-7", label: "Claude Opus 4.7", group: "Anthropic" },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", group: "Anthropic" },
  { id: "gemini-3.7-flash", label: "Gemini 3.7 Flash", group: "Google" },
  { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash", group: "Google" },
  { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash", group: "Google" },
  { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro", group: "Google" },
  { id: "gemini-3-flash-preview", label: "Gemini 3 Flash", group: "Google" },
  { id: "gpt-5.6-sol", label: "GPT-5.6 Sol", group: "OpenAI" },
  { id: "gpt-5.6-terra", label: "GPT-5.6 Terra", group: "OpenAI" },
  { id: "gpt-5.6-luna", label: "GPT-5.6 Luna", group: "OpenAI" },
  { id: "gpt-5.5", label: "GPT-5.5", group: "OpenAI" },
  { id: "gpt-5.4", label: "GPT-5.4", group: "OpenAI" },
];

export const DEFAULT_MODEL_ID = "gemini-3-flash-preview";
export const ALLOWED_MODEL_IDS = new Set(
  STATIC_MODELS.map((model) => model.id),
);

/**
 * Renamed/retired static ids → their current equivalents. The pane stores its
 * selection under the same "mike.selectedModel" key the web app uses, so a
 * value written before a catalog rename must resolve the same way in both
 * clients. Kept in sync with backend/src/lib/llm/models.ts LEGACY_MODEL_IDS
 * and frontend ModelToggle.tsx — the drift guard in
 * frontend/src/wordAddin/catalogParity.test.ts pins it.
 */
export const LEGACY_MODEL_IDS: Record<string, string> = {
  "gemini-3.1-flash-lite-preview": "gemini-3.5-flash-lite",
  "gpt-5.4-lite": "gpt-5.4-mini",
};

export function canonicalModelId(id: string): string {
  return LEGACY_MODEL_IDS[id] ?? id;
}

const MODEL_NAME_ACRONYMS: Record<string, string> = {
  ai: "AI",
  gpt: "GPT",
  oss: "OSS",
  r1: "R1",
};

export function modelDisplayName(modelId: string): string {
  const normalized = modelId
    .replace(/^(?:openrouter|vercel|opencode-go|ollama)\//, "")
    .split("/")
    .at(-1)!
    .replace(/(\d)-(\d)/g, "$1.$2");
  const [rawName, variant] = normalized.split(":", 2);
  const name = rawName ?? normalized;
  const label = name
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((token) => {
      const lower = token.toLowerCase();
      if (MODEL_NAME_ACRONYMS[lower]) return MODEL_NAME_ACRONYMS[lower];
      if (/^\d+[bk]$/i.test(token)) return token.toUpperCase();
      return token.charAt(0).toUpperCase() + token.slice(1);
    })
    .join(" ");
  if (!variant) return label;
  const variantLabel = variant
    .split(/[-_]+/)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
  return `${label} (${variantLabel})`;
}

/**
 * The stored selection is the router's raw catalog id (e.g.
 * "anthropic/claude-sonnet-4.5" or "openrouter/auto"); the app-level model id
 * always prefixes the router slug verbatim, with no inner stripping, so both
 * this client and the web app send the identical string for the same stored
 * selection ("openrouter/openrouter/auto" for OpenRouter's "openrouter/auto").
 */
export function openRouterModelOptions(models: string[]): ModelOption[] {
  return models.map((model) => ({
    id: `openrouter/${model}`,
    label: modelDisplayName(model),
    group: "OpenRouter",
  }));
}

export function vercelModelOptions(models: string[]): ModelOption[] {
  return models.map((model) => ({
    id: `vercel/${model}`,
    label: modelDisplayName(model),
    group: "Vercel AI Gateway",
  }));
}

export function openCodeGoModelOptions(models: string[]): ModelOption[] {
  return models.map((model) => ({
    id: `opencode-go/${model}`,
    label: modelDisplayName(model),
    group: "OpenCode Go",
  }));
}

/** Mirrors the web app's syntheticModelDisplayName — see the drift guard. */
export function syntheticModelDisplayName(model: string): string {
  if (model.startsWith("syn:")) {
    const [size, ...rest] = model.slice("syn:".length).split(":");
    if (!size) return model;
    const name = modelDisplayName(size);
    return rest.length ? `${name} (${rest.join(", ")})` : name;
  }
  return modelDisplayName(model.replace(/^hf:/, ""));
}

export function syntheticModelOptions(models: string[]): ModelOption[] {
  return models.map((model) => ({
    id: `synthetic/${model}`,
    label: syntheticModelDisplayName(model),
    group: "Synthetic",
  }));
}

export function isAllowedModelId(id: string): boolean {
  return (
    ALLOWED_MODEL_IDS.has(id) ||
    id.startsWith("ollama/") ||
    ROUTER_SLUGS.some((slug) => id.startsWith(`${slug}/`))
  );
}

export function isModelAvailable(
  modelId: string,
  status: ApiKeyStatus | null,
): boolean {
  if (modelId.startsWith("ollama/")) return true;
  // Unknown status (the key-status preflight failed even after a retry) fails
  // OPEN: the backend authoritatively rejects a model it cannot serve, so
  // blocking sends here on a flaky WKWebView request would brick the composer
  // for requests the backend would happily accept.
  if (!status) return true;
  if (modelId.startsWith("openrouter/")) return !!status.openrouter;
  if (modelId.startsWith("vercel/")) return !!status.vercel;
  if (modelId.startsWith("opencode-go/")) return !!status["opencode-go"];
  if (modelId.startsWith("synthetic/")) return !!status.synthetic;
  const model = STATIC_MODELS.find((item) => item.id === modelId);
  if (!model || model.group === "Local") return false;
  if (model.group === "Anthropic") return !!status.claude;
  if (model.group === "Google") return !!status.gemini;
  return !!status.openai;
}

export function missingModelProvider(modelId: string): string {
  const group = STATIC_MODELS.find((item) => item.id === modelId)?.group;
  if (modelId.startsWith("openrouter/") || group === "OpenRouter") {
    return "OpenRouter";
  }
  if (modelId.startsWith("vercel/") || group === "Vercel AI Gateway") {
    return "Vercel AI Gateway";
  }
  if (modelId.startsWith("opencode-go/") || group === "OpenCode Go") {
    return "OpenCode Go";
  }
  if (modelId.startsWith("synthetic/") || group === "Synthetic") {
    return "Synthetic";
  }
  return group === "Anthropic"
    ? "Anthropic"
    : group === "Google"
      ? "Google"
      : group === "OpenAI"
        ? "OpenAI"
        : "model provider";
}

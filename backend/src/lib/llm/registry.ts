import type { CommitteeModel, ConfiguredModel, Provider } from "./types";
import {
  isOpenRouterModelId,
  OPENROUTER_API_BASE_URL,
  openRouterApiModel,
} from "./openrouterCatalog";

type ModelRegistryConfig = {
  models?: ConfiguredModel[];
  committees?: CommitteeModel[];
};

const DEFAULT_CONFIG: ModelRegistryConfig = {
  models: [],
  committees: [],
};

let cached: ModelRegistryConfig | undefined;

export function loadModelRegistry(): ModelRegistryConfig {
  if (cached) return cached;
  const defaultModels = defaultConfiguredModels();
  const raw = process.env.MIKE_MODEL_CONFIG_JSON?.trim();
  if (!raw) {
    cached = { ...DEFAULT_CONFIG, models: defaultModels };
    return cached;
  }

  try {
    const parsed = JSON.parse(raw) as ModelRegistryConfig;
    cached = {
      models: mergeConfiguredModels(
        defaultModels,
        Array.isArray(parsed.models)
          ? parsed.models.filter(isConfiguredModel)
          : [],
      ),
      committees: Array.isArray(parsed.committees)
        ? parsed.committees.filter(isCommitteeModel)
        : [],
    };
  } catch (error) {
    throw new Error(
      `MIKE_MODEL_CONFIG_JSON is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  return cached;
}

function defaultConfiguredModels(): ConfiguredModel[] {
  return [];
}

function mergeConfiguredModels(
  defaults: ConfiguredModel[],
  configured: ConfiguredModel[],
): ConfiguredModel[] {
  const byId = new Map<string, ConfiguredModel>();
  for (const model of defaults) byId.set(model.id, model);
  for (const model of configured) byId.set(model.id, model);
  return [...byId.values()];
}

export function getConfiguredModel(id: string): ConfiguredModel | null {
  const configured =
    loadModelRegistry().models?.find((model) => model.id === id) ?? null;
  if (configured) return configured;
  if (isOpenRouterModelId(id)) {
    return {
      id,
      label: openRouterApiModel(id) ?? id,
      provider: "openai-compatible",
      location: "cloud",
      apiModel: openRouterApiModel(id) ?? id,
      baseUrl: OPENROUTER_API_BASE_URL,
      apiKeyProvider: "openrouter",
    };
  }
  return null;
}

export function getCommitteeModel(
  id: string,
  additionalCommittees: CommitteeModel[] = [],
): CommitteeModel | null {
  return (
    additionalCommittees.find((committee) => committee.id === id) ??
    loadModelRegistry().committees?.find((committee) => committee.id === id) ??
    null
  );
}

export function configuredModelIds(
  additionalCommittees: CommitteeModel[] = [],
): string[] {
  const registry = loadModelRegistry();
  return [
    ...(registry.models ?? []).map((model) => model.id),
    ...(registry.committees ?? []).map((committee) => committee.id),
    ...additionalCommittees.map((committee) => committee.id),
  ];
}

export function configuredModelSummaries(
  additionalCommittees: CommitteeModel[] = [],
): {
  id: string;
  label: string;
  provider: Provider | "committee";
  location: "cloud" | "local" | "committee";
}[] {
  const registry = loadModelRegistry();
  return [
    ...(registry.models ?? []).map((model) => ({
      id: model.id,
      label: model.label || model.id,
      provider: model.provider,
      location: model.location,
    })),
    ...(registry.committees ?? []).map((committee) => ({
      id: committee.id,
      label: committee.label || committee.id,
      provider: "committee" as const,
      location: "committee" as const,
    })),
    ...additionalCommittees.map((committee) => ({
      id: committee.id,
      label: committee.label || committee.id,
      provider: "committee" as const,
      location: "committee" as const,
    })),
  ];
}

export function configuredProviderForModel(
  id: string,
  additionalCommittees: CommitteeModel[] = [],
): Provider | null {
  const model = getConfiguredModel(id);
  if (model) return model.provider;
  if (getCommitteeModel(id, additionalCommittees)) return "openai-compatible";
  return null;
}

export function apiKeyForConfiguredModel(model: ConfiguredModel): string | null {
  if (model.apiKey?.trim()) return model.apiKey.trim();
  if (model.apiKeyEnv?.trim()) {
    return process.env[model.apiKeyEnv.trim()]?.trim() || null;
  }
  return null;
}

function isConfiguredModel(value: unknown): value is ConfiguredModel {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    isProvider(record.provider) &&
    (record.location === "cloud" || record.location === "local")
  );
}

function isProvider(value: unknown): value is Provider {
  return (
    value === "claude" ||
    value === "gemini" ||
    value === "openai" ||
    value === "openai-compatible"
  );
}

function isCommitteeModel(value: unknown): value is CommitteeModel {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    Array.isArray(record.members) &&
    record.members.every(
      (member) =>
        typeof member === "string" ||
        (!!member &&
          typeof member === "object" &&
          typeof (member as Record<string, unknown>).model === "string"),
    ) &&
    typeof record.chair === "string"
  );
}

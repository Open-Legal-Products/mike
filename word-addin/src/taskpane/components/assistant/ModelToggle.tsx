import React, { useEffect, useMemo, useState } from "react";
import { ModelToggleUI } from "@mike/model-toggle-ui";
import { getOllamaModels, type ApiKeyStatus } from "../../api/mikeApi";
import {
  isModelAvailable,
  modelDisplayName,
  openCodeGoModelOptions,
  openRouterModelOptions,
  syntheticModelOptions,
  vercelModelOptions,
  STATIC_MODELS,
  type ModelOption,
} from "../../lib/modelCatalog";

export function ModelToggle({
  value,
  onChange,
  keyStatus,
  keyStatusLoading = false,
  openRouterModels,
  vercelModels,
  openCodeGoModels,
  syntheticModels,
  compact = false,
}: {
  value: string;
  onChange: (model: string) => void;
  keyStatus: ApiKeyStatus | null;
  /** True while the key-status preflight is in flight: render a neutral
   *  disabled trigger instead of flashing "No API Key". */
  keyStatusLoading?: boolean;
  openRouterModels: string[];
  vercelModels: string[];
  openCodeGoModels: string[];
  syntheticModels: string[];
  compact?: boolean;
}): React.ReactElement {
  const [ollamaModels, setOllamaModels] = useState<ModelOption[]>([]);

  useEffect(() => {
    let cancelled = false;
    void getOllamaModels()
      .then((models) => {
        if (!cancelled) setOllamaModels(models);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const models = useMemo(() => {
    const openRouterOptions = openRouterModelOptions(openRouterModels);
    const vercelOptions = vercelModelOptions(vercelModels);
    const openCodeGoOptions = openCodeGoModelOptions(openCodeGoModels);
    const syntheticOptions = syntheticModelOptions(syntheticModels);
    const localOptions = ollamaModels.map((model) => ({
      ...model,
      label: modelDisplayName(model.id),
    }));
    return [
      ...STATIC_MODELS,
      ...openRouterOptions,
      ...vercelOptions,
      ...openCodeGoOptions,
      ...syntheticOptions,
      ...localOptions,
    ].filter(
      (model) =>
        model.group === "Local" || isModelAvailable(model.id, keyStatus),
    );
  }, [
    keyStatus,
    ollamaModels,
    openRouterModels,
    vercelModels,
    openCodeGoModels,
    syntheticModels,
  ]);
  const selected = models.find((model) => model.id === value);

  return (
    <ModelToggleUI
      value={value}
      onChange={onChange}
      models={models}
      selectedLabel={
        keyStatusLoading
          ? (selected?.label ?? "Select model")
          : (selected?.label ??
            (models.length > 0 ? "Select model" : "No API Key"))
      }
      selectedAvailable={selected !== undefined}
      loading={keyStatusLoading}
      compact={compact}
    />
  );
}

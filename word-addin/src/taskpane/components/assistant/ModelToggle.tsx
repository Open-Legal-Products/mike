import React, { useEffect, useMemo, useState } from "react";
import { AlertCircle, Check, ChevronDown } from "lucide-react";
import { getOllamaModels, type ApiKeyStatus } from "../../api/mikeApi";
import {
  isModelAvailable,
  STATIC_MODELS,
  type ModelGroup,
  type ModelOption,
} from "../../lib/modelCatalog";
import {
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownLabel,
  DropdownSeparator,
  DropdownTrigger,
} from "../primitives/Dropdown";

const GROUPS: ModelGroup[] = ["Anthropic", "Google", "OpenAI", "Local"];

export function ModelToggle({
  value,
  onChange,
  keyStatus,
}: {
  value: string;
  onChange: (model: string) => void;
  keyStatus: ApiKeyStatus | null;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
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

  const models = useMemo(
    () => [...STATIC_MODELS, ...ollamaModels],
    [ollamaModels],
  );
  const selected = models.find((model) => model.id === value);
  const selectedAvailable = isModelAvailable(value, keyStatus);

  return (
    <Dropdown open={open} onOpenChange={setOpen}>
      <DropdownTrigger asChild>
        <button
          type="button"
          aria-label="Choose model"
          title={
            selectedAvailable
              ? "Choose model"
              : "API key missing for selected model"
          }
          className={`flex h-8 items-center gap-1.5 rounded-full px-2 text-sm text-gray-400 transition-colors hover:text-gray-700 ${
            open ? "text-gray-700" : ""
          }`}
        >
          {!selectedAvailable && (
            <AlertCircle className="h-3 w-3 shrink-0 text-red-500" />
          )}
          <span className="max-w-[140px] truncate">
            {selected?.label ?? "Model"}
          </span>
          <ChevronDown
            className={`h-3 w-3 shrink-0 transition-transform duration-200 ${
              open ? "rotate-180" : ""
            }`}
          />
        </button>
      </DropdownTrigger>
      <DropdownContent
        side="top"
        align="end"
        sideOffset={8}
        className="max-h-[min(420px,70vh)] w-56 overflow-y-auto"
      >
        {GROUPS.map((group, groupIndex) => {
          const items = models.filter((model) => model.group === group);
          if (items.length === 0) return null;
          return (
            <React.Fragment key={group}>
              {groupIndex > 0 && <DropdownSeparator />}
              <DropdownLabel>{group}</DropdownLabel>
              {items.map((model) => {
                const available = isModelAvailable(model.id, keyStatus);
                return (
                  <DropdownItem
                    key={model.id}
                    onSelect={() => onChange(model.id)}
                    selected={model.id === value}
                    className="py-1.5 text-sm text-gray-700 data-[highlighted]:text-gray-900"
                  >
                    <span
                      className={`flex-1 ${available ? "" : "text-gray-400"}`}
                    >
                      {model.label}
                    </span>
                    {!available ? (
                      <AlertCircle className="ml-1 h-3.5 w-3.5 text-red-500" />
                    ) : model.id === value ? (
                      <Check className="ml-1 h-3.5 w-3.5 text-gray-600" />
                    ) : null}
                  </DropdownItem>
                );
              })}
            </React.Fragment>
          );
        })}
      </DropdownContent>
    </Dropdown>
  );
}

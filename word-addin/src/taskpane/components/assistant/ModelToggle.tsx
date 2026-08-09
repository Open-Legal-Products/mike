import React, { useEffect, useMemo, useState } from "react";
import { AlertCircle, ChevronDown } from "lucide-react";
import {
  getApiKeyStatus,
  getOllamaModels,
  type ApiKeyStatus,
} from "../../api/mikeApi";
import {
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownLabel,
  DropdownSeparator,
  DropdownTrigger,
} from "../primitives/Dropdown";

type ModelGroup = "Anthropic" | "Google" | "OpenAI" | "Local";

interface ModelOption {
  id: string;
  label: string;
  group: ModelGroup;
}

const STATIC_MODELS: ModelOption[] = [
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

const GROUPS: ModelGroup[] = ["Anthropic", "Google", "OpenAI", "Local"];

function isAvailable(model: ModelOption, status: ApiKeyStatus | null): boolean {
  if (!status || model.group === "Local") return true;
  if (model.group === "Anthropic") return !!status.claude;
  if (model.group === "Google") return !!status.gemini;
  return !!status.openai;
}

export function ModelToggle({
  value,
  onChange,
}: {
  value: string;
  onChange: (model: string) => void;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [ollamaModels, setOllamaModels] = useState<ModelOption[]>([]);
  const [keyStatus, setKeyStatus] = useState<ApiKeyStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getOllamaModels()
      .then((models) => {
        if (!cancelled) setOllamaModels(models);
      })
      .catch(() => {});
    void getApiKeyStatus()
      .then((status) => {
        if (!cancelled) setKeyStatus(status);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const models = useMemo(
    () => [...STATIC_MODELS, ...ollamaModels],
    [ollamaModels]
  );
  const selected = models.find((model) => model.id === value);
  const selectedAvailable = selected ? isAvailable(selected, keyStatus) : true;

  return (
    <Dropdown open={open} onOpenChange={setOpen}>
      <DropdownTrigger asChild>
        <button
          type="button"
          aria-label="Choose model"
          title={selectedAvailable ? "Choose model" : "API key missing for selected model"}
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
                const available = isAvailable(model, keyStatus);
                return (
                  <DropdownItem
                    key={model.id}
                    onSelect={() => onChange(model.id)}
                    selected={model.id === value}
                    className="py-1.5 text-sm text-gray-700 data-[highlighted]:text-gray-900"
                  >
                    <span
                      className={`flex-1 ${
                        available ? "" : "text-gray-400"
                      }`}
                    >
                      {model.label}
                    </span>
                    {!available ? (
                      <AlertCircle className="ml-1 h-3.5 w-3.5 text-red-500" />
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

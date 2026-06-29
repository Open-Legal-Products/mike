import React, { useState, useEffect } from "react";
import { Workflow as WorkflowIcon, AlertCircle } from "lucide-react";
import { apiClient } from "../api/client";
import { useWordDoc } from "../hooks/useWordDoc";
import { Button } from "@mike/shared/ui/button";
import { Label } from "@mike/shared/ui/label";
import { Spinner } from "@mike/shared/ui/spinner";
import { Select } from "@mike/shared/ui/select";
import { Markdown } from "@mike/shared/chat/Markdown";

// Shape returned by GET /workflows (see apps/api .../workflows.routes.ts):
// the runnable instruction lives in `prompt_md`, the label in `title`, and
// workflows are either "assistant" (chat-style) or "tabular" (column extract).
// Only "assistant" workflows can be run as a document chat here.
interface Workflow {
  id: string;
  title: string;
  prompt_md: string | null;
  type: "assistant" | "tabular";
  practice?: string | null;
}

export function WorkflowPicker(): React.ReactElement {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [fetchLoading, setFetchLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string>("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState("");
  const [runError, setRunError] = useState<string | null>(null);
  const { readDocumentText, insertAtCursor } = useWordDoc();

  useEffect(() => {
    apiClient
      .get<Workflow[]>("/workflows")
      .then((all) => {
        // Only assistant-type workflows have a runnable prompt; tabular
        // workflows need column config and a different endpoint.
        const data = (all ?? []).filter(
          (w) => w.type === "assistant" && (w.prompt_md ?? "").trim()
        );
        setWorkflows(data);
        if (data.length > 0) setSelectedId(data[0].id);
      })
      .catch((e: unknown) => {
        setFetchError(
          e instanceof Error ? e.message : "Failed to load workflows"
        );
      })
      .finally(() => setFetchLoading(false));
  }, []);

  const selectedWorkflow = workflows.find((w) => w.id === selectedId);

  const handleRun = async (): Promise<void> => {
    if (!selectedWorkflow) return;
    setRunning(true);
    setResult("");
    setRunError(null);
    try {
      const docText = await readDocumentText();
      let accumulated = "";
      // POST /chat does not read a `systemPrompt` field. The workflow
      // instruction is sent as the user message and the document body is
      // passed via `documentContext` (which the API folds into the system
      // prompt as a spotlighted block). The model is injected by apiClient.
      await apiClient.stream(
        "/chat",
        {
          messages: [
            { role: "user", content: selectedWorkflow.prompt_md ?? "" },
          ],
          documentContext: docText,
        },
        (chunk) => {
          accumulated += chunk;
          setResult(accumulated);
        }
      );
    } catch (e) {
      setRunError(e instanceof Error ? e.message : "Workflow run failed.");
    } finally {
      setRunning(false);
    }
  };

  if (fetchLoading) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <Spinner label="Loading workflows…" />
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center">
        <AlertCircle className="size-7 text-destructive" />
        <p className="text-sm text-destructive">{fetchError}</p>
      </div>
    );
  }

  if (workflows.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <WorkflowIcon className="size-6" />
        </div>
        <p className="text-sm font-medium text-foreground">No workflows found.</p>
        <p className="text-xs text-muted-foreground">
          Create an assistant workflow in the Mike web app and it will appear
          here.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-3 @sm:gap-4 @sm:p-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="workflow-select">Select workflow</Label>
        <Select
          id="workflow-select"
          value={selectedId}
          onChange={(e) => {
            setSelectedId(e.target.value);
            setResult("");
            setRunError(null);
          }}
          disabled={running}
        >
          {workflows.map((w) => (
            <option key={w.id} value={w.id}>
              {w.title}
            </option>
          ))}
        </Select>
        {selectedWorkflow?.practice && (
          <p className="text-xs text-muted-foreground">
            {selectedWorkflow.practice}
          </p>
        )}
      </div>

      <Button
        className="w-full"
        onClick={() => void handleRun()}
        disabled={running || !selectedId}
      >
        {running ? "Running…" : "Run workflow on document"}
      </Button>

      {running && <Spinner label="Running…" />}

      {runError && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {runError}
        </p>
      )}

      {result && (
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border/70 bg-muted/40 p-3">
            <Markdown>{result}</Markdown>
          </div>
          {!running && (
            <Button
              size="sm"
              variant="outline"
              className="self-start"
              onClick={() => void insertAtCursor(result)}
            >
              Insert at cursor
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

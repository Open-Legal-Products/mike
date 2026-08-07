import React, { useState, useRef, useEffect } from "react";
import { Workflow as WorkflowIcon, AlertCircle } from "lucide-react";
import { listWorkflows } from "../api/mikeApi";
import { streamAssistant } from "../api/stream";
import type { Workflow } from "@mike/core";
import { useWordDoc } from "../hooks/useWordDoc";
import { Label } from "@mike/shared/ui/label";
import { Spinner } from "@mike/shared/ui/spinner";
import { Select } from "@mike/shared/ui/select";
import { Markdown } from "@mike/shared/chat/Markdown";
import { PillButton } from "./assistant/PillButton";
import { EventBlock } from "./assistant/EventBlocks";
import { RESPONSE_GLASS_SURFACE } from "./assistant/messageStyles";

export function WorkflowPicker(): React.ReactElement {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [fetchLoading, setFetchLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string>("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState("");
  const [runError, setRunError] = useState<string | null>(null);
  const { readDocumentText } = useWordDoc();

  // Track mount + the in-flight run so switching tabs mid-run aborts the SSE
  // stream (the backend stops the LLM call instead of billing tokens for a
  // result nobody will see) and no setState fires on an unmounted component.
  // Same discipline as ChatPanel/DocumentActions.
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    listWorkflows("assistant")
      .then((all) => {
        // Server already scopes to type==="assistant"; keep the guard as a
        // belt-and-braces filter and drop tabular/empty-prompt rows that aren't
        // runnable as a document chat (they need column config + a different
        // endpoint).
        const data = (all ?? []).filter(
          (w) => w.metadata.type === "assistant" && (w.skill_md ?? "").trim()
        );
        if (!mountedRef.current) return;
        setWorkflows(data);
        if (data.length > 0) setSelectedId(data[0].id);
      })
      .catch((e: unknown) => {
        if (!mountedRef.current) return;
        setFetchError(
          e instanceof Error ? e.message : "Failed to load workflows"
        );
      })
      .finally(() => {
        if (mountedRef.current) setFetchLoading(false);
      });
  }, []);

  const selectedWorkflow = workflows.find((w) => w.id === selectedId);

  const handleCancel = (): void => abortRef.current?.abort();

  const handleRun = async (): Promise<void> => {
    if (!selectedWorkflow) return;
    setRunning(true);
    setResult("");
    setRunError(null);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const docText = await readDocumentText();
      let accumulated = "";
      // The workflow travels as a reference, exactly like the web app: the
      // backend resolves skill_md server-side (read_workflow tool) and fences
      // it as <workflow-instructions>, so the body is never pasted into the
      // user turn. The document goes via `document_context`, which the API
      // folds into the system prompt as a spotlighted block.
      await streamAssistant(
        {
          messages: [
            {
              role: "user",
              content: `Run the "${selectedWorkflow.metadata.title}" workflow on my document.`,
              workflow: {
                id: selectedWorkflow.id,
                title: selectedWorkflow.metadata.title,
              },
            },
          ],
          documentContext: docText,
          signal: controller.signal,
        },
        (chunk) => {
          accumulated += chunk;
          if (mountedRef.current) setResult(accumulated);
        }
      );
    } catch (e) {
      // A user-initiated stop or an unmount aborts the request — keep whatever
      // partial answer streamed in, don't render it as an error.
      if (controller.signal.aborted || !mountedRef.current) return;
      setRunError(e instanceof Error ? e.message : "Workflow run failed.");
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      if (mountedRef.current) setRunning(false);
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
              {w.metadata.title}
            </option>
          ))}
        </Select>
        {selectedWorkflow?.metadata.practice && (
          <p className="text-xs text-muted-foreground">
            {selectedWorkflow.metadata.practice}
          </p>
        )}
      </div>

      {running ? (
        // Swap the run button for a stop button while streaming, so a run
        // started by mistake can be cancelled instead of burning tokens.
        <PillButton
          tone="white"
          size="normal"
          className="w-full"
          onClick={handleCancel}
        >
          Stop
        </PillButton>
      ) : (
        <PillButton
          tone="black"
          size="normal"
          className="w-full"
          onClick={() => void handleRun()}
          disabled={!selectedId}
        >
          Run workflow on document
        </PillButton>
      )}

      {running && (
        <EventBlock isStreaming dotColor="gray">
          Running…
        </EventBlock>
      )}

      {runError && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {runError}
        </p>
      )}

      {result && (
        <div className="flex min-h-0 flex-1 flex-col">
          <div
            className={`min-h-0 flex-1 overflow-y-auto p-3 font-serif text-[15px] leading-relaxed text-gray-900 ${RESPONSE_GLASS_SURFACE}`}
          >
            <Markdown>{result}</Markdown>
          </div>
        </div>
      )}
    </div>
  );
}

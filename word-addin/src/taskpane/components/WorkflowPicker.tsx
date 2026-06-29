import React, { useState, useEffect } from "react";
import {
  Button,
  Text,
  Spinner,
  Select,
  Label,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { apiClient } from "../api/client";
import { useWordDoc } from "../hooks/useWordDoc";

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

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalM,
    padding: tokens.spacingVerticalM,
    height: "100%",
    overflowY: "auto",
  },
  label: {
    fontWeight: tokens.fontWeightSemibold,
    fontSize: tokens.fontSizeBase300,
    display: "block",
    marginBottom: tokens.spacingVerticalXS,
  },
  select: {
    width: "100%",
  },
  description: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
  },
  runButton: {
    width: "100%",
  },
  spinnerRow: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalXS,
    color: tokens.colorNeutralForeground3,
  },
  resultBox: {
    padding: tokens.spacingVerticalS,
    backgroundColor: tokens.colorNeutralBackground3,
    borderRadius: tokens.borderRadiusMedium,
    maxHeight: "300px",
    overflowY: "auto",
    whiteSpace: "pre-wrap",
    fontSize: tokens.fontSizeBase200,
    wordBreak: "break-word",
    flex: "1 1 0",
  },
  emptyState: {
    color: tokens.colorNeutralForeground3,
    textAlign: "center",
    marginTop: tokens.spacingVerticalXL,
  },
  errorText: {
    color: tokens.colorStatusDangerForeground1,
    fontSize: tokens.fontSizeBase200,
  },
  insertRow: {
    marginTop: tokens.spacingVerticalXS,
  },
});

export function WorkflowPicker(): React.ReactElement {
  const styles = useStyles();
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
      <div className={styles.root}>
        <Spinner label="Loading workflows…" />
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className={styles.root}>
        <Text className={styles.errorText}>{fetchError}</Text>
      </div>
    );
  }

  if (workflows.length === 0) {
    return (
      <div className={styles.root}>
        <Text className={styles.emptyState}>No workflows found.</Text>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <Label className={styles.label} htmlFor="workflow-select">
        Select workflow
      </Label>
      <Select
        id="workflow-select"
        className={styles.select}
        value={selectedId}
        onChange={(_, d) => {
          setSelectedId(d.value);
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
        <Text className={styles.description}>
          {selectedWorkflow.practice}
        </Text>
      )}

      <Button
        appearance="primary"
        className={styles.runButton}
        onClick={() => void handleRun()}
        disabled={running || !selectedId}
      >
        {running ? "Running…" : "Run workflow on document"}
      </Button>

      {running && (
        <div className={styles.spinnerRow}>
          <Spinner size="tiny" />
          <Text size={200}>Running…</Text>
        </div>
      )}

      {runError && (
        <Text className={styles.errorText}>{runError}</Text>
      )}

      {result && (
        <>
          <div className={styles.resultBox}>{result}</div>
          {!running && (
            <div className={styles.insertRow}>
              <Button
                size="small"
                onClick={() => void insertAtCursor(result)}
              >
                Insert at cursor
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

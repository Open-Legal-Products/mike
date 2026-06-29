import React, { useState } from "react";
import {
  Button,
  Field,
  Input,
  Spinner,
  Text,
  Divider,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { apiClient } from "../api/client";
import { useWordDoc } from "../hooks/useWordDoc";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
    padding: tokens.spacingVerticalM,
    overflowY: "auto",
    height: "100%",
  },
  sectionTitle: {
    fontWeight: tokens.fontWeightSemibold,
    fontSize: tokens.fontSizeBase300,
    marginBottom: tokens.spacingVerticalXS,
    display: "block",
  },
  actionButton: {
    width: "100%",
  },
  resultBox: {
    marginTop: tokens.spacingVerticalS,
    padding: tokens.spacingVerticalS,
    backgroundColor: tokens.colorNeutralBackground3,
    borderRadius: tokens.borderRadiusMedium,
    maxHeight: "180px",
    overflowY: "auto",
    whiteSpace: "pre-wrap",
    fontSize: tokens.fontSizeBase200,
    wordBreak: "break-word",
  },
  spinnerRow: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalXS,
    marginTop: tokens.spacingVerticalXS,
    color: tokens.colorNeutralForeground3,
  },
  applyRow: {
    display: "flex",
    gap: tokens.spacingHorizontalXS,
    marginTop: tokens.spacingVerticalXS,
  },
  draftInput: {
    marginBottom: tokens.spacingVerticalXS,
  },
});

interface ActionSectionState {
  loading: boolean;
  result: string;
  originalText?: string;
}

const emptySection = (): ActionSectionState => ({
  loading: false,
  result: "",
  originalText: undefined,
});

export function DocumentActions(): React.ReactElement {
  const styles = useStyles();
  const {
    readDocumentText,
    getSelectedText,
    insertAtCursor,
    insertTrackedChange,
    insertWithTrackChanges,
  } = useWordDoc();

  const [improve, setImprove] = useState<ActionSectionState>(emptySection());
  const [proof, setProof] = useState<ActionSectionState>(emptySection());
  const [anon, setAnon] = useState<ActionSectionState>(emptySection());
  const [draft, setDraft] = useState<ActionSectionState>(emptySection());
  const [draftPrompt, setDraftPrompt] = useState("");

  // ------------------------------------------------------------------
  // 1. Improve Writing
  // ------------------------------------------------------------------
  const handleImproveWriting = async (): Promise<void> => {
    setImprove({ loading: true, result: "" });
    try {
      const selected = await getSelectedText();
      if (!selected.trim()) {
        setImprove({ loading: false, result: "Please select some text first." });
        return;
      }
      const originalText = selected;
      const prompt = `Rewrite the following to improve clarity and professionalism while preserving meaning:\n\n${selected}`;
      let accumulated = "";
      await apiClient.stream(
        "/chat",
        { messages: [{ role: "user", content: prompt }] },
        (chunk) => {
          accumulated += chunk;
          setImprove({ loading: true, result: accumulated, originalText });
        }
      );
      setImprove({ loading: false, result: accumulated, originalText });
    } catch (e) {
      setImprove({
        loading: false,
        result: e instanceof Error ? e.message : "Error occurred.",
      });
    }
  };

  // ------------------------------------------------------------------
  // 2. Proofread
  // ------------------------------------------------------------------
  const handleProofread = async (): Promise<void> => {
    setProof({ loading: true, result: "" });
    try {
      const docText = await readDocumentText();
      const prompt = `Proofread the following legal document. List every grammatical error, typo, punctuation issue, and stylistic inconsistency. For each issue, state the original text and your suggested correction:\n\n${docText}`;
      let accumulated = "";
      await apiClient.stream(
        "/chat",
        { messages: [{ role: "user", content: prompt }] },
        (chunk) => {
          accumulated += chunk;
          setProof({ loading: true, result: accumulated });
        }
      );
      setProof({ loading: false, result: accumulated });
    } catch (e) {
      setProof({
        loading: false,
        result: e instanceof Error ? e.message : "Error occurred.",
      });
    }
  };

  // ------------------------------------------------------------------
  // 3. Anonymise
  // ------------------------------------------------------------------
  const handleAnonymise = async (): Promise<void> => {
    setAnon({ loading: true, result: "" });
    try {
      const docText = await readDocumentText();
      const prompt = `Identify all personally identifiable information (PII) in the following document — names, addresses, phone numbers, email addresses, dates of birth, identification numbers, and any other identifying information. For each occurrence, list: (1) the original text, and (2) an anonymised replacement. Present as a numbered list:\n\n${docText}`;
      let accumulated = "";
      await apiClient.stream(
        "/chat",
        { messages: [{ role: "user", content: prompt }] },
        (chunk) => {
          accumulated += chunk;
          setAnon({ loading: true, result: accumulated });
        }
      );
      setAnon({ loading: false, result: accumulated });
    } catch (e) {
      setAnon({
        loading: false,
        result: e instanceof Error ? e.message : "Error occurred.",
      });
    }
  };

  // ------------------------------------------------------------------
  // 4. Draft Clause
  // ------------------------------------------------------------------
  const handleDraftClause = async (): Promise<void> => {
    if (!draftPrompt.trim()) return;
    setDraft({ loading: true, result: "" });
    try {
      const prompt = `Draft a professional legal clause for the following purpose. Output only the clause text, ready to be inserted into a contract:\n\n${draftPrompt}`;
      let accumulated = "";
      await apiClient.stream(
        "/chat",
        { messages: [{ role: "user", content: prompt }] },
        (chunk) => {
          accumulated += chunk;
          setDraft({ loading: true, result: accumulated });
        }
      );
      setDraft({ loading: false, result: accumulated });
    } catch (e) {
      setDraft({
        loading: false,
        result: e instanceof Error ? e.message : "Error occurred.",
      });
    }
  };

  return (
    <div className={styles.root}>
      {/* --- Improve Writing --- */}
      <Text className={styles.sectionTitle}>Improve Writing</Text>
      <Button
        appearance="secondary"
        className={styles.actionButton}
        onClick={() => void handleImproveWriting()}
        disabled={improve.loading}
      >
        {improve.loading ? "Improving…" : "Improve selected text"}
      </Button>
      {improve.loading && (
        <div className={styles.spinnerRow}>
          <Spinner size="tiny" />
          <Text size={200}>Working…</Text>
        </div>
      )}
      {improve.result && (
        <>
          <div className={styles.resultBox}>{improve.result}</div>
          {!improve.loading && improve.originalText && (
            <div className={styles.applyRow}>
              <Button
                size="small"
                appearance="primary"
                onClick={() =>
                  void insertTrackedChange(
                    improve.originalText!,
                    improve.result
                  )
                }
              >
                Apply as tracked change
              </Button>
              <Button
                size="small"
                onClick={() => void insertAtCursor(improve.result)}
              >
                Insert at cursor
              </Button>
            </div>
          )}
        </>
      )}

      <Divider />

      {/* --- Proofread --- */}
      <Text className={styles.sectionTitle}>Proofread</Text>
      <Button
        appearance="secondary"
        className={styles.actionButton}
        onClick={() => void handleProofread()}
        disabled={proof.loading}
      >
        {proof.loading ? "Proofreading…" : "Proofread entire document"}
      </Button>
      {proof.loading && (
        <div className={styles.spinnerRow}>
          <Spinner size="tiny" />
          <Text size={200}>Analysing…</Text>
        </div>
      )}
      {proof.result && (
        <div className={styles.resultBox}>{proof.result}</div>
      )}

      <Divider />

      {/* --- Anonymise --- */}
      <Text className={styles.sectionTitle}>Anonymise</Text>
      <Button
        appearance="secondary"
        className={styles.actionButton}
        onClick={() => void handleAnonymise()}
        disabled={anon.loading}
      >
        {anon.loading ? "Identifying PII…" : "Find & list PII"}
      </Button>
      {anon.loading && (
        <div className={styles.spinnerRow}>
          <Spinner size="tiny" />
          <Text size={200}>Scanning…</Text>
        </div>
      )}
      {anon.result && (
        <div className={styles.resultBox}>{anon.result}</div>
      )}

      <Divider />

      {/* --- Draft Clause --- */}
      <Text className={styles.sectionTitle}>Draft Clause</Text>
      <Field label="Describe the clause you need" className={styles.draftInput}>
        <Input
          value={draftPrompt}
          onChange={(_, d) => setDraftPrompt(d.value)}
          placeholder="e.g. limitation of liability for SaaS product"
          disabled={draft.loading}
        />
      </Field>
      <Button
        appearance="secondary"
        className={styles.actionButton}
        onClick={() => void handleDraftClause()}
        disabled={draft.loading || !draftPrompt.trim()}
      >
        {draft.loading ? "Drafting…" : "Draft clause"}
      </Button>
      {draft.loading && (
        <div className={styles.spinnerRow}>
          <Spinner size="tiny" />
          <Text size={200}>Drafting…</Text>
        </div>
      )}
      {draft.result && (
        <>
          <div className={styles.resultBox}>{draft.result}</div>
          {!draft.loading && (
            <div className={styles.applyRow}>
              <Button
                size="small"
                appearance="primary"
                onClick={() => void insertAtCursor(draft.result)}
              >
                Insert at cursor
              </Button>
              <Button
                size="small"
                onClick={() => void insertWithTrackChanges(draft.result)}
              >
                Apply as tracked change
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

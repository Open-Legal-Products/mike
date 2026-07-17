import React, { useState, useRef, useEffect } from "react";
import {
  Wand2,
  SpellCheck,
  EyeOff,
  PenLine,
  type LucideIcon,
} from "lucide-react";
import { streamAssistant } from "../api/stream";
import { useWordDoc } from "../hooks/useWordDoc";
import type { WordSelectionAnchor } from "../hooks/useWordDoc";
import { Button } from "@mike/shared/ui/button";
import { Input } from "@mike/shared/ui/input";
import { Label } from "@mike/shared/ui/label";
import { Spinner } from "@mike/shared/ui/spinner";

interface ActionSectionState {
  loading: boolean;
  result: string;
  originalText?: string;
  // True when `result` holds an error message rather than usable output, so the
  // Insert / Apply buttons must not be offered over it.
  error?: boolean;
}

const emptySection = (): ActionSectionState => ({
  loading: false,
  result: "",
  originalText: undefined,
  error: false,
});

// Cap document text folded into a prompt so a large file can't blow past the
// model context / token budget (the backend also caps this defensively).
const MAX_DOC_CHARS = 200_000;

function ResultBox({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <div className="max-h-48 overflow-y-auto rounded-lg border border-border/70 bg-muted/40 p-3 text-xs leading-relaxed whitespace-pre-wrap break-words text-foreground">
      {children}
    </div>
  );
}

function Section({
  title,
  description,
  icon: Icon,
  children,
}: {
  title: string;
  description: string;
  icon: LucideIcon;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border/70 bg-card p-3 shadow-sm @sm:p-4">
      <div className="flex items-start gap-2.5">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Icon className="size-4" />
        </div>
        <div className="min-w-0 space-y-0.5">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <p className="text-xs leading-snug text-muted-foreground">
            {description}
          </p>
        </div>
      </div>
      {children}
    </section>
  );
}

export function DocumentActions(): React.ReactElement {
  const {
    readDocumentText,
    captureSelection,
    releaseSelection,
    replaceSelection,
    insertBelowSelection,
  } = useWordDoc();

  const [improve, setImprove] = useState<ActionSectionState>(emptySection());
  const [proof, setProof] = useState<ActionSectionState>(emptySection());
  const [anon, setAnon] = useState<ActionSectionState>(emptySection());
  const [draft, setDraft] = useState<ActionSectionState>(emptySection());
  const [draftPrompt, setDraftPrompt] = useState("");
  const [applyError, setApplyError] = useState<string | null>(null);
  const improveAnchorRef = useRef<WordSelectionAnchor | null>(null);

  // Track mount + in-flight streams so switching tabs mid-action aborts the
  // request and never calls setState on an unmounted component.
  const mountedRef = useRef(true);
  const controllersRef = useRef<Set<AbortController>>(new Set());
  useEffect(() => {
    mountedRef.current = true;
    const controllers = controllersRef.current;
    return () => {
      mountedRef.current = false;
      controllers.forEach((c) => c.abort());
      controllers.clear();
      const anchor = improveAnchorRef.current;
      improveAnchorRef.current = null;
      if (anchor) void releaseSelection(anchor);
    };
  }, []);

  // ------------------------------------------------------------------
  // 1. Improve Writing
  // ------------------------------------------------------------------
  const handleImproveWriting = async (): Promise<void> => {
    setApplyError(null);
    setImprove({ loading: true, result: "" });
    const controller = new AbortController();
    controllersRef.current.add(controller);
    try {
      const previousAnchor = improveAnchorRef.current;
      improveAnchorRef.current = null;
      if (previousAnchor) await releaseSelection(previousAnchor);

      const anchor = await captureSelection();
      const selected = anchor.originalText;
      if (!selected.trim()) {
        await releaseSelection(anchor);
        setImprove({ loading: false, result: "Please select some text first." });
        return;
      }
      improveAnchorRef.current = anchor;
      const originalText = selected;
      const prompt = `Rewrite the following selected legal text to improve clarity and professionalism while preserving its meaning. Preserve the number and order of paragraphs. Return only replacement text: no introduction, quotation marks, Markdown, or code fences.\n\n${selected}`;
      let accumulated = "";
      await streamAssistant(
        {
          messages: [{ role: "user", content: prompt }],
          signal: controller.signal,
        },
        (chunk) => {
          accumulated += chunk;
          if (mountedRef.current)
            setImprove({ loading: true, result: accumulated, originalText });
        }
      );
      if (mountedRef.current)
        setImprove({ loading: false, result: accumulated, originalText });
    } catch (e) {
      if (controller.signal.aborted || !mountedRef.current) return;
      const anchor = improveAnchorRef.current;
      improveAnchorRef.current = null;
      if (anchor) await releaseSelection(anchor);
      setImprove({
        loading: false,
        result: e instanceof Error ? e.message : "Error occurred.",
        error: true,
      });
    } finally {
      controllersRef.current.delete(controller);
    }
  };

  // ------------------------------------------------------------------
  // 2. Proofread
  // ------------------------------------------------------------------
  const handleProofread = async (): Promise<void> => {
    setProof({ loading: true, result: "" });
    const controller = new AbortController();
    controllersRef.current.add(controller);
    try {
      const docText = (await readDocumentText()).slice(0, MAX_DOC_CHARS);
      const prompt = `Proofread the following legal document. List every grammatical error, typo, punctuation issue, and stylistic inconsistency. For each issue, state the original text and your suggested correction:\n\n${docText}`;
      let accumulated = "";
      await streamAssistant(
        {
          messages: [{ role: "user", content: prompt }],
          signal: controller.signal,
        },
        (chunk) => {
          accumulated += chunk;
          if (mountedRef.current) setProof({ loading: true, result: accumulated });
        }
      );
      if (mountedRef.current) setProof({ loading: false, result: accumulated });
    } catch (e) {
      if (controller.signal.aborted || !mountedRef.current) return;
      setProof({
        loading: false,
        result: e instanceof Error ? e.message : "Error occurred.",
        error: true,
      });
    } finally {
      controllersRef.current.delete(controller);
    }
  };

  // ------------------------------------------------------------------
  // 3. Anonymise
  // ------------------------------------------------------------------
  const handleAnonymise = async (): Promise<void> => {
    setAnon({ loading: true, result: "" });
    const controller = new AbortController();
    controllersRef.current.add(controller);
    try {
      const docText = (await readDocumentText()).slice(0, MAX_DOC_CHARS);
      const prompt = `Identify all personally identifiable information (PII) in the following document — names, addresses, phone numbers, email addresses, dates of birth, identification numbers, and any other identifying information. For each occurrence, list: (1) the original text, and (2) an anonymised replacement. Present as a numbered list:\n\n${docText}`;
      let accumulated = "";
      await streamAssistant(
        {
          messages: [{ role: "user", content: prompt }],
          signal: controller.signal,
        },
        (chunk) => {
          accumulated += chunk;
          if (mountedRef.current) setAnon({ loading: true, result: accumulated });
        }
      );
      if (mountedRef.current) setAnon({ loading: false, result: accumulated });
    } catch (e) {
      if (controller.signal.aborted || !mountedRef.current) return;
      setAnon({
        loading: false,
        result: e instanceof Error ? e.message : "Error occurred.",
        error: true,
      });
    } finally {
      controllersRef.current.delete(controller);
    }
  };

  // ------------------------------------------------------------------
  // 4. Draft Clause
  // ------------------------------------------------------------------
  const handleDraftClause = async (): Promise<void> => {
    if (!draftPrompt.trim()) return;
    setDraft({ loading: true, result: "" });
    const controller = new AbortController();
    controllersRef.current.add(controller);
    try {
      const prompt = `Draft a professional legal clause for the following purpose. Output only the clause text, ready to be inserted into a contract:\n\n${draftPrompt}`;
      let accumulated = "";
      await streamAssistant(
        {
          messages: [{ role: "user", content: prompt }],
          signal: controller.signal,
        },
        (chunk) => {
          accumulated += chunk;
          if (mountedRef.current) setDraft({ loading: true, result: accumulated });
        }
      );
      if (mountedRef.current) setDraft({ loading: false, result: accumulated });
    } catch (e) {
      if (controller.signal.aborted || !mountedRef.current) return;
      setDraft({
        loading: false,
        result: e instanceof Error ? e.message : "Error occurred.",
        error: true,
      });
    } finally {
      controllersRef.current.delete(controller);
    }
  };

  const applyRewrite = async (tracked: boolean): Promise<void> => {
    setApplyError(null);
    const anchor = improveAnchorRef.current;
    if (!anchor) return;

    try {
      const result = await replaceSelection(anchor, improve.result, tracked);
      improveAnchorRef.current = null;
      await releaseSelection(anchor);
      setImprove((current) => ({
        ...current,
        originalText: undefined,
      }));

      if (result === "stale") {
        setApplyError(
          "The selected text changed while Mike was responding. Select it again and rerun the rewrite."
        );
      }
    } catch (error) {
      setApplyError(
        error instanceof Error ? error.message : "Word couldn't apply the rewrite."
      );
    }
  };

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-3 @sm:gap-4 @sm:p-4">
      {/* --- Improve Writing --- */}
      <Section
        title="Improve Writing"
        description="Rewrite the selected text for clarity and professionalism."
        icon={Wand2}
      >
        <Button
          variant="secondary"
          className="w-full"
          onClick={() => void handleImproveWriting()}
          disabled={improve.loading}
        >
          {improve.loading ? "Improving…" : "Improve selected text"}
        </Button>
        {improve.loading && <Spinner label="Working…" />}
        {improve.result && (
          <>
            <ResultBox>{improve.result}</ResultBox>
            {!improve.loading && improve.originalText && !improve.error && (
              <>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    onClick={() => void applyRewrite(true)}
                  >
                    Replace selection (tracked)
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void applyRewrite(false)}
                  >
                    Replace selection
                  </Button>
                </div>
              </>
            )}
            {applyError && (
              <p role="alert" className="text-xs text-destructive">
                {applyError}
              </p>
            )}
          </>
        )}
      </Section>

      {/* --- Proofread --- */}
      <Section
        title="Proofread"
        description="Scan the whole document for errors and inconsistencies."
        icon={SpellCheck}
      >
        <Button
          variant="secondary"
          className="w-full"
          onClick={() => void handleProofread()}
          disabled={proof.loading}
        >
          {proof.loading ? "Proofreading…" : "Proofread entire document"}
        </Button>
        {proof.loading && <Spinner label="Analysing…" />}
        {proof.result && <ResultBox>{proof.result}</ResultBox>}
      </Section>

      {/* --- Anonymise --- */}
      <Section
        title="Anonymise"
        description="Find personally identifiable information and suggest redactions."
        icon={EyeOff}
      >
        <Button
          variant="secondary"
          className="w-full"
          onClick={() => void handleAnonymise()}
          disabled={anon.loading}
        >
          {anon.loading ? "Identifying PII…" : "Find & list PII"}
        </Button>
        {anon.loading && <Spinner label="Scanning…" />}
        {anon.result && <ResultBox>{anon.result}</ResultBox>}
      </Section>

      {/* --- Draft Clause --- */}
      <Section
        title="Draft Clause"
        description="Generate a ready-to-insert clause from a short description."
        icon={PenLine}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="draft-prompt">Describe the clause you need</Label>
          <Input
            id="draft-prompt"
            value={draftPrompt}
            onChange={(e) => setDraftPrompt(e.target.value)}
            placeholder="e.g. limitation of liability for SaaS product"
            disabled={draft.loading}
          />
        </div>
        <Button
          variant="secondary"
          className="w-full"
          onClick={() => void handleDraftClause()}
          disabled={draft.loading || !draftPrompt.trim()}
        >
          {draft.loading ? "Drafting…" : "Draft clause"}
        </Button>
        {draft.loading && <Spinner label="Drafting…" />}
        {draft.result && (
          <>
            <ResultBox>{draft.result}</ResultBox>
            {!draft.loading && !draft.error && (
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={() => void insertBelowSelection(draft.result)}
                >
                  Insert below cursor
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void insertBelowSelection(draft.result, true)}
                >
                  Insert below (tracked)
                </Button>
              </div>
            )}
          </>
        )}
      </Section>
    </div>
  );
}

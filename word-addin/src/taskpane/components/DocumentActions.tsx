import React, { useState, useRef, useEffect, useMemo } from "react";
import {
  Wand2,
  SpellCheck,
  EyeOff,
  PenLine,
  type LucideIcon,
} from "lucide-react";
import { streamAssistant } from "../api/stream";
import { useWordDoc } from "../hooks/useWordDoc";
import type { WordSelectionAnchor, RedlineApplyReport } from "../hooks/useWordDoc";
import { parseRedlineEdits, REDLINE_FORMAT } from "../lib/redline";
import type { RedlineEdit } from "../lib/redline";
import { Input } from "@mike/shared/ui/input";
import { Label } from "@mike/shared/ui/label";
import { PillButton } from "./assistant/PillButton";
import { EventBlock, DocFindBlock } from "./assistant/EventBlocks";
import { EditCard } from "./assistant/EditCard";
import { EditCardsSection } from "./assistant/EditCardsSection";
import { RESPONSE_GLASS_SURFACE } from "./assistant/messageStyles";

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

interface RedlineApplyState {
  busy: boolean;
  summary: string | null;
  /** Per-edit Word search results from the last apply (drives "Found" rows). */
  found: RedlineApplyReport["found"] | null;
}

const idleApply = (): RedlineApplyState => ({
  busy: false,
  summary: null,
  found: null,
});

function ResultBox({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <div className="max-h-48 overflow-y-auto rounded-lg bg-gray-100/70 p-3 text-sm leading-relaxed whitespace-pre-wrap break-words font-serif text-gray-900">
      {children}
    </div>
  );
}

/** Streaming/working indicator styled like the web's event rows. */
function WorkingRow({ label }: { label: string }): React.ReactElement {
  return (
    <EventBlock isStreaming dotColor="gray">
      {label}
    </EventBlock>
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
    <section className={`flex flex-col gap-3 p-3 @sm:p-4 ${RESPONSE_GLASS_SURFACE}`}>
      <div className="flex items-start gap-2.5">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-gray-100/80 text-gray-500">
          <Icon className="size-4" />
        </div>
        <div className="min-w-0 space-y-0.5">
          <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
          <p className="text-xs leading-snug text-gray-500">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

/**
 * Shared result rendering for the Proofread / Anonymise flows: raw text
 * while streaming (or when the answer carries no parseable edits), and the
 * web-style EditCardsSection with per-edit cards + "Found" rows once the
 * completed answer parses into edits.
 */
function RedlineResult({
  loading,
  result,
  edits,
  noun,
  apply,
  applyLabel,
  onApply,
}: {
  loading: boolean;
  result: string;
  edits: RedlineEdit[];
  noun: string;
  apply: RedlineApplyState;
  applyLabel: string;
  onApply: () => void;
}): React.ReactElement | null {
  if (edits.length === 0) {
    return result ? <ResultBox>{result}</ResultBox> : null;
  }
  return (
    <EditCardsSection
      summary={`${edits.length} proposed ${noun}`}
      actions={
        <PillButton tone="black" onClick={onApply} disabled={apply.busy || loading}>
          {apply.busy ? "Applying…" : applyLabel}
        </PillButton>
      }
      status={
        (apply.summary || apply.found) && (
          <div className="flex flex-col gap-2">
            {apply.found?.map((f, j) => (
              <DocFindBlock
                key={j}
                query={f.original}
                totalMatches={f.matches}
                filename="the document"
                showConnector={j < apply.found!.length - 1}
              />
            ))}
            {apply.summary && (
              <p role="status" className="text-xs font-serif text-gray-500">
                {apply.summary}
              </p>
            )}
          </div>
        )
      }
    >
      {edits.map((edit, j) => (
        <EditCard key={j} edit={edit} changeNumber={j + 1} />
      ))}
    </EditCardsSection>
  );
}

export function DocumentActions(): React.ReactElement {
  const {
    readDocumentText,
    captureSelection,
    releaseSelection,
    replaceSelection,
    applyTrackedEdits,
  } = useWordDoc();

  const [improve, setImprove] = useState<ActionSectionState>(emptySection());
  const [proof, setProof] = useState<ActionSectionState>(emptySection());
  const [anon, setAnon] = useState<ActionSectionState>(emptySection());
  const [proofApply, setProofApply] = useState<RedlineApplyState>(idleApply());
  const [anonApply, setAnonApply] = useState<RedlineApplyState>(idleApply());
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
    setProofApply(idleApply());
    const controller = new AbortController();
    controllersRef.current.add(controller);
    try {
      const docText = (await readDocumentText()).slice(0, MAX_DOC_CHARS);
      // The document travels as `document_context` — the backend fences it as
      // untrusted reference data (same spotlighting the web app's document
      // flows get) — never pasted into the user turn.
      const prompt = `Proofread the legal document provided as document context. Identify every grammatical error, typo, punctuation issue, and stylistic inconsistency.\n\n${REDLINE_FORMAT} Do not add any other commentary.\n\nIf there are no issues, reply exactly: No issues found.`;
      let accumulated = "";
      await streamAssistant(
        {
          messages: [{ role: "user", content: prompt }],
          documentContext: docText,
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
    setAnonApply(idleApply());
    const controller = new AbortController();
    controllersRef.current.add(controller);
    try {
      const docText = (await readDocumentText()).slice(0, MAX_DOC_CHARS);
      // Document via `document_context` (fenced server-side), not the prompt.
      const prompt = `Identify all personally identifiable information (PII) in the document provided as document context — names, addresses, phone numbers, email addresses, dates of birth, identification numbers, and any other identifying information.\n\n${REDLINE_FORMAT} Do not add any other commentary.\n\nUse anonymised placeholders such as [PARTY A] or [ADDRESS 1] as the REPLACEMENT, and reuse the same placeholder for repeated references to the same person or detail. If there is no PII, reply exactly: No personally identifiable information found.`;
      let accumulated = "";
      await streamAssistant(
        {
          messages: [{ role: "user", content: prompt }],
          documentContext: docText,
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

  // Model output only becomes applyable once the stream has finished cleanly;
  // a mid-stream parse could apply a half-received edit.
  const proofEdits = useMemo<RedlineEdit[]>(
    () =>
      !proof.loading && !proof.error && proof.result
        ? parseRedlineEdits(proof.result)
        : [],
    [proof]
  );
  const anonEdits = useMemo<RedlineEdit[]>(
    () =>
      !anon.loading && !anon.error && anon.result
        ? parseRedlineEdits(anon.result)
        : [],
    [anon]
  );

  const applyRedlines = async (
    edits: RedlineEdit[],
    noun: string,
    setApply: React.Dispatch<React.SetStateAction<RedlineApplyState>>
  ): Promise<void> => {
    setApply({ busy: true, summary: null, found: null });
    try {
      const report = await applyTrackedEdits(edits);
      const parts = [
        `Applied ${report.applied} of ${edits.length} ${noun} as tracked changes.`,
      ];
      if (report.skipped.length > 0) {
        parts.push(
          `${report.skipped.length} skipped — the quoted text was not found in the document (it may have changed since the scan).`
        );
      }
      setApply({ busy: false, summary: parts.join(" "), found: report.found });
    } catch (error) {
      setApply({
        busy: false,
        summary:
          error instanceof Error
            ? error.message
            : "Word couldn't apply the changes.",
        found: null,
      });
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
        <PillButton
          tone="white"
          size="normal"
          className="w-full"
          onClick={() => void handleImproveWriting()}
          disabled={improve.loading}
        >
          {improve.loading ? "Improving…" : "Improve selected text"}
        </PillButton>
        {improve.loading && <WorkingRow label="Working…" />}
        {improve.result && (
          <>
            <ResultBox>{improve.result}</ResultBox>
            {!improve.loading && improve.originalText && !improve.error && (
              <div className="flex flex-wrap gap-2">
                <PillButton tone="black" onClick={() => void applyRewrite(true)}>
                  Replace selection (tracked)
                </PillButton>
                <PillButton tone="white" onClick={() => void applyRewrite(false)}>
                  Replace selection
                </PillButton>
              </div>
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
        description="Scan the whole document and apply corrections as tracked changes."
        icon={SpellCheck}
      >
        <PillButton
          tone="white"
          size="normal"
          className="w-full"
          onClick={() => void handleProofread()}
          disabled={proof.loading}
        >
          {proof.loading ? "Proofreading…" : "Proofread entire document"}
        </PillButton>
        {proof.loading && <WorkingRow label="Analysing…" />}
        <RedlineResult
          loading={proof.loading}
          result={proof.result}
          edits={proofEdits}
          noun={proofEdits.length === 1 ? "correction" : "corrections"}
          apply={proofApply}
          applyLabel={`Apply ${proofEdits.length} correction${proofEdits.length === 1 ? "" : "s"} (tracked)`}
          onApply={() =>
            void applyRedlines(proofEdits, "corrections", setProofApply)
          }
        />
      </Section>

      {/* --- Anonymise --- */}
      <Section
        title="Anonymise"
        description="Find personally identifiable information and redact it as tracked changes."
        icon={EyeOff}
      >
        <PillButton
          tone="white"
          size="normal"
          className="w-full"
          onClick={() => void handleAnonymise()}
          disabled={anon.loading}
        >
          {anon.loading ? "Identifying PII…" : "Find & list PII"}
        </PillButton>
        {anon.loading && <WorkingRow label="Scanning…" />}
        <RedlineResult
          loading={anon.loading}
          result={anon.result}
          edits={anonEdits}
          noun={anonEdits.length === 1 ? "redaction" : "redactions"}
          apply={anonApply}
          applyLabel={`Apply ${anonEdits.length} redaction${anonEdits.length === 1 ? "" : "s"} (tracked)`}
          onApply={() =>
            void applyRedlines(anonEdits, "redactions", setAnonApply)
          }
        />
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
        <PillButton
          tone="white"
          size="normal"
          className="w-full"
          onClick={() => void handleDraftClause()}
          disabled={draft.loading || !draftPrompt.trim()}
        >
          {draft.loading ? "Drafting…" : "Draft clause"}
        </PillButton>
        {draft.loading && <WorkingRow label="Drafting…" />}
        {draft.result && (
          <ResultBox>{draft.result}</ResultBox>
        )}
      </Section>
    </div>
  );
}

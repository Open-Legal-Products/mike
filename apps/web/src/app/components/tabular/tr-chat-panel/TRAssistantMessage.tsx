"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AssistantEvent } from "../../shared/types";
import type { TRCitationAnnotation } from "@/app/lib/mikeApi";
import { PreResponseWrapper } from "../../shared/PreResponseWrapper";
import type { TRMessage } from "./types";
import { preprocessTRCitations } from "./helpers";
import { ReasoningBlock } from "./ReasoningBlock";
import { DocReadBlock } from "./DocReadBlock";
import { TRResponseStatus } from "./TRResponseStatus";

type TREventGroup =
    | { kind: "pre"; events: AssistantEvent[]; indices: number[] }
    | {
          kind: "content";
          event: Extract<AssistantEvent, { type: "content" }>;
          index: number;
      };

export function TRAssistantMessage({
    msg,
    onCitationClick,
}: {
    msg: TRMessage;
    onCitationClick: (colIdx: number, rowIdx: number) => void;
}) {
    const annotations = msg.annotations ?? [];
    const citationsList: TRCitationAnnotation[] = [];

    // Pre-process all content events
    const processedTexts: string[] = (msg.events ?? []).map((e) =>
        e.type === "content"
            ? preprocessTRCitations(e.text, annotations, citationsList)
            : "",
    );

    const events = msg.events ?? [];

    // Group consecutive non-content events together so they share a single
    // PreResponseWrapper. Content events render between wrappers.
    const groups: TREventGroup[] = [];
    {
        let current: Extract<TREventGroup, { kind: "pre" }> | null = null;
        events.forEach((e, i) => {
            if (e.type === "content") {
                if (current) {
                    groups.push(current);
                    current = null;
                }
                groups.push({ kind: "content", event: e, index: i });
            } else {
                if (!current)
                    current = { kind: "pre", events: [], indices: [] };
                current.events.push(e);
                current.indices.push(i);
            }
        });
        if (current) groups.push(current);
    }

    const hasContentAfter = (groupIdx: number): boolean => {
        for (let i = groupIdx + 1; i < groups.length; i++) {
            const g = groups[i];
            if (g.kind === "content") return true;
        }
        return false;
    };

    const renderPreEvent = (event: AssistantEvent, key: number) => {
        if (event.type === "reasoning") {
            return (
                <ReasoningBlock
                    key={key}
                    text={event.text}
                    isStreaming={!!event.isStreaming && !!msg.isStreaming}
                />
            );
        }
        if (event.type === "doc_read") {
            return (
                <DocReadBlock
                    key={key}
                    label={event.filename}
                    isStreaming={event.isStreaming}
                />
            );
        }
        if (event.type === "thinking") {
            return (
                <div
                    key={key}
                    className="flex items-center text-sm text-gray-400 ml-1"
                >
                    <div className="w-1.5 h-1.5 rounded-full border border-gray-400 border-t-transparent animate-spin shrink-0" />
                    <span className="ml-2">Thinking...</span>
                </div>
            );
        }
        return null;
    };

    const renderContent = (text: string, key: number) => (
        <div
            key={key}
            className="prose prose-sm max-w-none text-sm leading-relaxed"
        >
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                    p: ({ node, ...props }) => (
                        <p className="mb-2 leading-6" {...props} />
                    ),
                    ul: ({ node, ...props }) => (
                        <ul
                            className="list-disc list-outside mb-2 pl-4"
                            {...props}
                        />
                    ),
                    ol: ({ node, ...props }) => (
                        <ol
                            className="list-decimal list-outside mb-2 pl-4"
                            {...props}
                        />
                    ),
                    li: ({ node, ...props }) => (
                        <li className="mb-0.5 leading-6" {...props} />
                    ),
                    strong: ({ node, ...props }) => (
                        <strong className="font-semibold" {...props} />
                    ),
                    code: ({ children }) => {
                        const codeText = String(children);
                        const citMatch = codeText.match(/^§(\d+)§$/);
                        if (citMatch) {
                            const idx = parseInt(citMatch[1]);
                            const cit = citationsList[idx];
                            if (cit) {
                                return (
                                    <button
                                        onClick={() =>
                                            onCitationClick(
                                                cit.col_index,
                                                cit.row_index,
                                            )
                                        }
                                        title={`${cit.col_name} · ${cit.doc_name.replace(/\.[^.]+$/, "")}`}
                                        className="mx-0.5 inline-flex items-center justify-center rounded-full w-4 h-4 text-[10px] font-medium bg-gray-100 text-gray-900 hover:bg-gray-200 transition-colors align-super font-serif"
                                    >
                                        {cit.ref}
                                    </button>
                                );
                            }
                        }
                        return (
                            <code className="bg-gray-100 px-1 py-0.5 rounded text-xs font-mono">
                                {children}
                            </code>
                        );
                    },
                }}
            >
                {text}
            </ReactMarkdown>
        </div>
    );

    return (
        <div className="text-gray-900 font-serif">
            <TRResponseStatus isActive={!!msg.isStreaming} />
            {groups.length > 0 && (
                <div className="flex flex-col gap-2.5">
                    {groups.map((g, gIdx) => {
                        if (g.kind === "content") {
                            return renderContent(
                                processedTexts[g.index],
                                g.index,
                            );
                        }
                        const subsequentContent = hasContentAfter(gIdx);
                        // "Working" while at least one event in *this*
                        // wrapper is actively streaming. Gaps between real
                        // events are bridged by `pushThinkingPlaceholder`
                        // so this check stays continuously true through
                        // the whole pre-content phase.
                        const wrapperIsStreaming = g.events.some(
                            (event) =>
                                "isStreaming" in event && !!event.isStreaming,
                        );
                        return (
                            <PreResponseWrapper
                                key={`p-${g.indices[0]}`}
                                stepCount={g.events.length}
                                shouldMinimize={subsequentContent}
                                isStreaming={wrapperIsStreaming}
                                compact
                            >
                                {g.events.map((event, i) =>
                                    renderPreEvent(event, g.indices[i]),
                                )}
                            </PreResponseWrapper>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

export function MessageBubble({
    msg,
    onCitationClick,
}: {
    msg: TRMessage;
    onCitationClick: (colIdx: number, rowIdx: number) => void;
}) {
    if (msg.role === "user") {
        return (
            <div className="flex justify-end">
                <div className="max-w-[90%] rounded-md bg-gray-100 px-3 py-2 text-xs text-gray-800 whitespace-pre-wrap">
                    {msg.content}
                </div>
            </div>
        );
    }
    return <TRAssistantMessage msg={msg} onCitationClick={onCitationClick} />;
}

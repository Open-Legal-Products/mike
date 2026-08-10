import React from "react";
import { Markdown } from "../../../shared/chat/Markdown";
import { projectRedlineStream } from "../../lib/redline";
import type { StreamingRedlineEdit } from "../../lib/redline";
import type {
  WordAssistantEvent,
  WordContentEvent,
  WordDocumentReadEvent,
  WordReasoningEvent,
  WordThinkingEvent,
} from "../../types";
import { PillButton } from "../primitives/PillButton";
import { EditCard } from "./EditCard";
import { PreResponseWrapper } from "./PreResponseWrapper";
import { EditCardsSection } from "./message/EditCardsSection";
import {
  DocEditBlock,
  DocReadBlock,
  EventBlock,
  ReasoningBlock,
} from "./message/EventBlocks";
import { ResponseStatus, type StatusState } from "./message/ResponseStatus";
import {
  assistantContent,
  assistantError,
  isWordContentEvent,
  isWordDocumentReadEvent,
  isWordReasoningEvent,
  isWordThinkingEvent,
} from "../../lib/wordChatEvents";
import { getEditKey } from "../../lib/wordTrackedEditKeys";
import type {
  DocEditStatus,
  EditCardStatus,
  EditDecision,
  EditRuntimeState,
  WordAssistantMessage as WordAssistantTurn,
} from "../../lib/wordChatTypes";

interface AssistantMessageProps {
  message: WordAssistantTurn;
  isStreaming: boolean;
  minHeight?: React.CSSProperties["minHeight"];
  editStateByKey: Readonly<Record<string, EditRuntimeState>>;
  onViewEdit: (key: string) => void;
  onResolveEdit: (key: string, decision: EditDecision) => void;
  onResolveAll: (keys: string[], decision: EditDecision) => void;
}

type EventGroup =
  | {
      kind: "pre";
      events: (
        | WordThinkingEvent
        | WordReasoningEvent
        | WordDocumentReadEvent
      )[];
      indices: number[];
    }
  | {
      kind: "content";
      event: WordContentEvent;
      index: number;
    };

function groupAssistantEvents(events: WordAssistantEvent[]): EventGroup[] {
  const groups: EventGroup[] = [];
  let current: Extract<EventGroup, { kind: "pre" }> | null = null;
  events.forEach((event, index) => {
    if (isWordContentEvent(event)) {
      if (current) {
        groups.push(current);
        current = null;
      }
      groups.push({ kind: "content", event, index });
      return;
    }
    if (
      !isWordThinkingEvent(event) &&
      !isWordReasoningEvent(event) &&
      !isWordDocumentReadEvent(event)
    ) {
      return;
    }
    if (!current) current = { kind: "pre", events: [], indices: [] };
    current.events.push(event);
    current.indices.push(index);
  });
  if (current) groups.push(current);
  return groups;
}

export function AssistantMessage({
  message,
  isStreaming,
  minHeight,
  editStateByKey,
  onViewEdit,
  onResolveEdit,
  onResolveAll,
}: AssistantMessageProps): React.ReactElement {
  const content = assistantContent(message);
  const error = assistantError(message);
  const responseStatus: StatusState = error
    ? "error"
    : isStreaming
      ? "active"
      : null;
  const projection = projectRedlineStream(content, !isStreaming);
  const edits: StreamingRedlineEdit[] = projection.edits;
  const editRows = edits.map((edit, editIndex) => {
    const key = getEditKey(message.id, edit.blockIndex);
    const runtime = editStateByKey[key];
    const status: EditCardStatus =
      runtime?.status ??
      (message.live ? (edit.sealed ? "applying" : "receiving") : "historical");
    return { edit, editIndex, key, runtime, status };
  });
  const hasUnfinishedEdit = editRows.some(
    ({ status }) =>
      status === "receiving" || status === "applying" || status === "restoring",
  );
  const pendingEditCount = editRows.filter(
    ({ status }) => status === "pending",
  ).length;
  const anyEditBusy = editRows.some(({ runtime }) => runtime?.busy);
  const editEventStatus: DocEditStatus | null =
    editRows.length === 0
      ? null
      : hasUnfinishedEdit
        ? "applying"
        : editRows.some(({ status }) => status === "error")
          ? "error"
          : pendingEditCount > 0
            ? "pending"
            : editRows.some(({ status }) => status === "accepted")
              ? "accepted"
              : editRows.some(({ status }) => status === "rejected")
                ? "rejected"
                : editRows.some(({ status }) => status === "unmanaged")
                  ? "unmanaged"
                  : "skipped";
  const firstEditError = editRows.find(({ runtime }) => runtime?.error)?.runtime
    ?.error;
  const editEvent =
    message.live && editEventStatus
      ? {
          status: editEventStatus,
          detail:
            editEventStatus === "applying"
              ? "in the document"
              : editEventStatus === "pending"
                ? (firstEditError ?? `${pendingEditCount} ready for review`)
                : firstEditError,
        }
      : null;
  const summaryReady =
    edits.length === 0 || (!isStreaming && !hasUnfinishedEdit);

  const groups = groupAssistantEvents(message.events);
  const lastContentEventIndex = message.events.reduce(
    (last, event, index) => (isWordContentEvent(event) ? index : last),
    -1,
  );
  const contentProjectionByIndex = new Map(
    message.events.flatMap((event, index) =>
      isWordContentEvent(event)
        ? [
            [
              index,
              projectRedlineStream(
                event.text,
                !isStreaming || index !== lastContentEventIndex,
              ),
            ] as const,
          ]
        : [],
    ),
  );
  const editSourceEventIndex = message.events.findIndex(
    (event, index) =>
      isWordContentEvent(event) &&
      (contentProjectionByIndex.get(index)?.edits.length ?? 0) > 0,
  );
  const fallbackEditContentIndex =
    editSourceEventIndex >= 0 ? editSourceEventIndex : lastContentEventIndex;
  const editInsertionGroupIndex =
    editEvent === null
      ? -1
      : (() => {
          const contentGroupIndex = groups.findIndex(
            (group) =>
              group.kind === "content" &&
              group.index === fallbackEditContentIndex,
          );
          return contentGroupIndex >= 0 ? contentGroupIndex : groups.length;
        })();
  const attachedEditGroupIndex =
    editInsertionGroupIndex > 0 &&
    groups[editInsertionGroupIndex - 1]?.kind === "pre"
      ? editInsertionGroupIndex - 1
      : -1;

  const hasContentAfter = (groupIndex: number): boolean =>
    groups
      .slice(groupIndex + 1)
      .some((group) => group.kind === "content" && group.event.text.length > 0);

  const standaloneEditActivity =
    editEvent && attachedEditGroupIndex < 0 ? (
      <PreResponseWrapper
        stepCount={1}
        shouldMinimize={!!content || !!error}
        isStreaming={hasUnfinishedEdit}
      >
        <DocEditBlock status={editEvent.status} detail={editEvent.detail} />
      </PreResponseWrapper>
    ) : null;

  return (
    <div
      className="w-full shrink-0"
      style={minHeight === undefined ? undefined : { minHeight }}
      data-assistant-message-id={message.id}
    >
      <ResponseStatus status={responseStatus} />
      <div className="mt-2 flex flex-col gap-3">
        {groups.map((group, groupIndex) => {
          const insertStandaloneEdit =
            groupIndex === editInsertionGroupIndex && standaloneEditActivity;
          if (group.kind === "content") {
            const prose =
              contentProjectionByIndex.get(group.index)?.visibleProse ?? "";
            const holdForEdit =
              edits.length > 0 &&
              editInsertionGroupIndex >= 0 &&
              groupIndex >= editInsertionGroupIndex &&
              !summaryReady;
            return (
              <React.Fragment key={`content-${group.index}`}>
                {insertStandaloneEdit}
                {prose && !holdForEdit && (
                  <div className="font-serif text-base leading-7 text-gray-900">
                    <Markdown className="text-base leading-7">{prose}</Markdown>
                  </div>
                )}
              </React.Fragment>
            );
          }

          const includesEdit =
            groupIndex === attachedEditGroupIndex && !!editEvent;
          const groupIsStreaming =
            group.events.some(
              (event) =>
                isWordThinkingEvent(event) ||
                (isWordReasoningEvent(event) && !!event.isStreaming) ||
                (isWordDocumentReadEvent(event) && event.status === "reading"),
            ) ||
            (includesEdit && hasUnfinishedEdit);
          return (
            <React.Fragment key={`pre-${group.indices[0] ?? groupIndex}`}>
              {insertStandaloneEdit}
              <PreResponseWrapper
                stepCount={group.events.length + (includesEdit ? 1 : 0)}
                shouldMinimize={hasContentAfter(groupIndex) || !!error}
                isStreaming={groupIsStreaming}
              >
                {group.events.map((event, eventIndex) => {
                  const showConnector =
                    eventIndex < group.events.length - 1 || includesEdit;
                  if (isWordReasoningEvent(event)) {
                    return (
                      <ReasoningBlock
                        key={group.indices[eventIndex]}
                        text={event.text}
                        isStreaming={!!event.isStreaming}
                        showConnector={showConnector}
                      />
                    );
                  }
                  if (isWordThinkingEvent(event)) {
                    return (
                      <EventBlock
                        key={group.indices[eventIndex]}
                        showConnector={showConnector}
                        isStreaming
                        dotColor="gray"
                      >
                        Thinking...
                      </EventBlock>
                    );
                  }
                  if (isWordDocumentReadEvent(event)) {
                    return (
                      <DocReadBlock
                        key={group.indices[eventIndex]}
                        filename={event.filename}
                        isStreaming={event.status === "reading"}
                        showConnector={showConnector}
                      />
                    );
                  }
                  return null;
                })}
                {includesEdit && editEvent && (
                  <DocEditBlock
                    status={editEvent.status}
                    detail={editEvent.detail}
                  />
                )}
              </PreResponseWrapper>
            </React.Fragment>
          );
        })}
        {editInsertionGroupIndex === groups.length && standaloneEditActivity}
        {error && (
          <p
            role="alert"
            className="font-serif text-base leading-7 text-red-600"
          >
            {error}
          </p>
        )}
        {edits.length > 0 && (
          <EditCardsSection
            summary={`${edits.length} tracked ${edits.length === 1 ? "change" : "changes"}`}
            actions={
              pendingEditCount > 0 ? (
                <>
                  <PillButton
                    tone="blue"
                    onClick={() =>
                      onResolveAll(
                        editRows.map(({ key }) => key),
                        "accept",
                      )
                    }
                    disabled={hasUnfinishedEdit || anyEditBusy}
                  >
                    Accept all
                  </PillButton>
                  <PillButton
                    tone="white"
                    onClick={() =>
                      onResolveAll(
                        editRows.map(({ key }) => key),
                        "reject",
                      )
                    }
                    disabled={hasUnfinishedEdit || anyEditBusy}
                  >
                    Reject all
                  </PillButton>
                </>
              ) : undefined
            }
          >
            {editRows.map(({ edit, editIndex, key, runtime, status }) => (
              <EditCard
                key={key}
                edit={edit}
                changeNumber={editIndex + 1}
                status={status}
                error={runtime?.viewError ?? runtime?.error}
                disabled={anyEditBusy}
                onView={
                  status === "pending" || status === "view-only"
                    ? () => onViewEdit(key)
                    : undefined
                }
                onAccept={
                  status === "pending"
                    ? () => onResolveEdit(key, "accept")
                    : undefined
                }
                onReject={
                  status === "pending"
                    ? () => onResolveEdit(key, "reject")
                    : undefined
                }
              />
            ))}
          </EditCardsSection>
        )}
      </div>
    </div>
  );
}

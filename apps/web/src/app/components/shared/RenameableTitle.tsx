"use client";

import { useRef, useState } from "react";

interface Props {
    value: string;
    onCommit: (newValue: string) => void;
    suffix?: React.ReactNode;
}

type CaretDocument = Document & {
    caretPositionFromPoint?: (
        x: number,
        y: number,
    ) => { offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
};

export function RenameableTitle({ value, onCommit, suffix }: Props) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState("");
    const caretPos = useRef<number | null>(null);
    const escaped = useRef(false);
    const committed = useRef(false);

    function startEditing(e: React.MouseEvent) {
        const doc = document as CaretDocument;
        const caret = doc.caretPositionFromPoint?.(e.clientX, e.clientY);
        const range = !caret && doc.caretRangeFromPoint?.(e.clientX, e.clientY);
        caretPos.current = caret
            ? caret.offset
            : range
              ? range.startOffset
              : null;
        escaped.current = false;
        committed.current = false;
        setDraft(value);
        setEditing(true);
    }

    function commit() {
        if (committed.current) return;
        if (escaped.current) {
            escaped.current = false;
            return;
        }
        committed.current = true;
        setEditing(false);
        onCommit(draft.trim());
    }

    if (editing) {
        return (
            <input
                ref={(el) => {
                    if (!el) return;
                    el.focus();
                    if (caretPos.current !== null) {
                        el.setSelectionRange(caretPos.current, caretPos.current);
                    }
                }}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === "Enter") {
                        e.preventDefault();
                        commit();
                    }
                    if (e.key === "Escape") {
                        escaped.current = true;
                        committed.current = true;
                        setEditing(false);
                    }
                }}
                onBlur={commit}
                className="text-gray-900 bg-transparent outline-none min-w-0"
                style={{ width: `${draft.length + 1}ch` }}
            />
        );
    }

    return (
        <span
            className="inline-block cursor-text text-gray-900 transition-colors hover:text-gray-600"
            onClick={startEditing}
        >
            {value}
            {suffix}
        </span>
    );
}

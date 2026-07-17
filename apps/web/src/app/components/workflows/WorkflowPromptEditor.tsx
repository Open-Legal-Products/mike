"use client";

import { useEditor, EditorContent, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";
import { Markdown } from "tiptap-markdown";
import { useEffect, useRef, useState } from "react";
import {
    Bold,
    Code2,
    Heading1,
    Heading2,
    Heading3,
    Italic,
    List,
    ListOrdered,
    Table2,
} from "lucide-react";
import { Button } from "@/app/components/ui/button";

interface Props {
    value: string;
    onChange?: (markdown: string) => void;
    readOnly?: boolean;
}

const TABLE_PICKER_MAX_ROWS = 8;
const TABLE_PICKER_MAX_COLS = 8;
const INACTIVE_FORMATTING = {
    heading1: false,
    heading2: false,
    heading3: false,
    bold: false,
    italic: false,
    bulletList: false,
    orderedList: false,
};

function AppToolbarButton({
    onClick,
    active,
    title,
    children,
}: {
    onClick: () => void;
    active?: boolean;
    title: string;
    children: React.ReactNode;
}) {
    return (
        <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            title={title}
            aria-label={title}
            aria-pressed={active}
            className={`h-7 w-7 text-gray-600 hover:bg-white hover:text-gray-900 ${
                active ? "bg-gray-300 text-gray-950 hover:bg-gray-300" : ""
            }`}
            onMouseDown={(e) => {
                e.preventDefault(); // keep editor focus
                onClick();
            }}
        >
            {children}
        </Button>
    );
}

function getEditorMarkdown(editor: NonNullable<ReturnType<typeof useEditor>>) {
    // tiptap-markdown adds .markdown to storage but isn't typed on Editor.storage
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (editor.storage as any).markdown.getMarkdown() as string;
}

export function WorkflowPromptEditor({
    value,
    onChange,
    readOnly = false,
}: Props) {
    const lastEmittedRef = useRef(value);
    const rawTextareaRef = useRef<HTMLTextAreaElement>(null);
    const tablePickerRef = useRef<HTMLDivElement>(null);
    const [rawMode, setRawMode] = useState(false);
    const [rawMarkdown, setRawMarkdown] = useState(value);
    const [tablePickerOpen, setTablePickerOpen] = useState(false);
    const [tablePickerSize, setTablePickerSize] = useState<{
        rows: number;
        cols: number;
    } | null>(null);

    const editor = useEditor({
        extensions: [
            StarterKit.configure({
                heading: { levels: [1, 2, 3] },
                codeBlock: false,
                code: false,
                blockquote: false,
                horizontalRule: false,
            }),
            TableKit.configure({
                table: {
                    renderWrapper: true,
                },
            }),
            Markdown.configure({
                html: false,
                transformPastedText: true,
                transformCopiedText: true,
            }),
        ],
        content: value,
        editable: !readOnly,
        immediatelyRender: false,
        onUpdate: ({ editor }) => {
            const md = getEditorMarkdown(editor);
            lastEmittedRef.current = md;
            setRawMarkdown(md);
            onChange?.(md);
        },
        editorProps: {
            attributes: {
                class: "tiptap workflow-editor-content",
            },
        },
    });

    const activeFormatting = useEditorState({
        editor,
        selector: ({ editor }) => ({
            heading1: editor?.isActive("heading", { level: 1 }) ?? false,
            heading2: editor?.isActive("heading", { level: 2 }) ?? false,
            heading3: editor?.isActive("heading", { level: 3 }) ?? false,
            bold: editor?.isActive("bold") ?? false,
            italic: editor?.isActive("italic") ?? false,
            bulletList: editor?.isActive("bulletList") ?? false,
            orderedList: editor?.isActive("orderedList") ?? false,
        }),
    }) ?? INACTIVE_FORMATTING;

    // Sync external value (e.g. on load from API)
    useEffect(() => {
        if (!editor || editor.isDestroyed) return;
        if (value !== lastEmittedRef.current) {
            lastEmittedRef.current = value;
            editor.commands.setContent(value);
        }
    }, [value, editor]);

    useEffect(() => {
        if (!tablePickerOpen) return;

        function handlePointerDown(event: MouseEvent) {
            if (
                tablePickerRef.current &&
                !tablePickerRef.current.contains(event.target as Node)
            ) {
                setTablePickerOpen(false);
                setTablePickerSize(null);
            }
        }

        function handleKeyDown(event: KeyboardEvent) {
            if (event.key === "Escape") {
                setTablePickerOpen(false);
                setTablePickerSize(null);
            }
        }

        document.addEventListener("mousedown", handlePointerDown);
        document.addEventListener("keydown", handleKeyDown);

        return () => {
            document.removeEventListener("mousedown", handlePointerDown);
            document.removeEventListener("keydown", handleKeyDown);
        };
    }, [tablePickerOpen]);

    function handleRawToggle() {
        if (!editor || editor.isDestroyed) return;
        if (rawMode) {
            lastEmittedRef.current = rawMarkdown;
            editor.commands.setContent(rawMarkdown);
            onChange?.(rawMarkdown);
            setRawMode(false);
            return;
        }
        setRawMarkdown(getEditorMarkdown(editor));
        setRawMode(true);
    }

    function handleRawChange(next: string) {
        setRawMarkdown(next);
        lastEmittedRef.current = next;
        onChange?.(next);
    }

    function updateRawMarkdown(
        next: string,
        selectionStart: number,
        selectionEnd: number,
    ) {
        setRawMarkdown(next);
        lastEmittedRef.current = next;
        onChange?.(next);
        window.requestAnimationFrame(() => {
            rawTextareaRef.current?.focus();
            rawTextareaRef.current?.setSelectionRange(
                selectionStart,
                selectionEnd,
            );
        });
    }

    function transformRawSelection(
        transform: (
            selected: string,
            start: number,
            end: number,
        ) => {
            replacement: string;
            selectionStart: number;
            selectionEnd: number;
        },
    ) {
        const textarea = rawTextareaRef.current;
        if (!textarea) return;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const selected = rawMarkdown.slice(start, end);
        const result = transform(selected, start, end);
        const next =
            rawMarkdown.slice(0, start) +
            result.replacement +
            rawMarkdown.slice(end);
        updateRawMarkdown(next, result.selectionStart, result.selectionEnd);
    }

    function applyRawInline(marker: "*" | "**") {
        transformRawSelection((selected, start) => {
            const replacement = `${marker}${selected}${marker}`;
            const innerStart = start + marker.length;
            const innerEnd = innerStart + selected.length;
            return {
                replacement,
                selectionStart: selected ? innerStart : innerStart,
                selectionEnd: selected ? innerEnd : innerStart,
            };
        });
    }

    function transformRawLines(
        transformLine: (line: string, index: number) => string,
    ) {
        const textarea = rawTextareaRef.current;
        if (!textarea) return;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const lineStart = rawMarkdown.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
        const lineEnd =
            end > start && rawMarkdown[end - 1] === "\n"
                ? end - 1
                : rawMarkdown.indexOf("\n", end);
        const resolvedLineEnd =
            lineEnd === -1 ? rawMarkdown.length : lineEnd;
        const block = rawMarkdown.slice(lineStart, resolvedLineEnd);
        let lineIndex = 0;
        const replacement = block
            .split("\n")
            .map((line) => {
                if (!line.trim()) return line;
                const next = transformLine(line, lineIndex);
                lineIndex += 1;
                return next;
            })
            .join("\n");
        const next =
            rawMarkdown.slice(0, lineStart) +
            replacement +
            rawMarkdown.slice(resolvedLineEnd);
        updateRawMarkdown(
            next,
            lineStart,
            lineStart + replacement.length,
        );
    }

    function applyRawHeading(level: 1 | 2 | 3) {
        const prefix = `${"#".repeat(level)} `;
        transformRawLines((line) => prefix + line.replace(/^#{1,6}\s+/, ""));
    }

    function applyRawBulletList() {
        transformRawLines((line) => line.replace(/^(\s*)(?:[-*+]|\d+\.)\s+/, "$1").replace(/^(\s*)/, "$1- "));
    }

    function applyRawOrderedList() {
        transformRawLines((line, index) =>
            line
                .replace(/^(\s*)(?:[-*+]|\d+\.)\s+/, "$1")
                .replace(/^(\s*)/, `$1${index + 1}. `),
        );
    }

    function insertRawTable(rows: number, cols: number) {
        const textarea = rawTextareaRef.current;
        if (!textarea) return;
        const start = textarea.selectionStart;
        const before = rawMarkdown.slice(0, start);
        const after = rawMarkdown.slice(textarea.selectionEnd);
        // Keep the table on its own line(s), whatever the caret sits on.
        const lead = before.length === 0 || before.endsWith("\n") ? "" : "\n";
        const trail = after.length === 0 || after.startsWith("\n") ? "" : "\n";
        const header =
            "| " +
            Array.from({ length: cols }, (_, index) => `Column ${index + 1}`).join(
                " | ",
            ) +
            " |";
        const separator =
            "| " + Array.from({ length: cols }, () => "---").join(" | ") + " |";
        const body = Array.from(
            { length: Math.max(0, rows - 1) },
            () => "| " + Array.from({ length: cols }, () => " ").join(" | ") + " |",
        );
        const table = [header, separator, ...body].join("\n") + "\n";
        const replacement = `${lead}${table}${trail}`;
        const caret = before.length + replacement.length;
        updateRawMarkdown(before + replacement + after, caret, caret);
    }

    function insertTable(rows: number, cols: number) {
        setTablePickerOpen(false);
        setTablePickerSize(null);

        if (rawMode) {
            insertRawTable(rows, cols);
            return;
        }

        editor
            ?.chain()
            .focus()
            .insertTable({
                rows,
                cols,
                withHeaderRow: true,
            })
            .run();
    }

    return (
        <div
            className={`flex h-full flex-col overflow-hidden bg-white ${
                readOnly
                    ? "rounded-md border border-gray-200"
                    : "rounded-md border border-gray-200"
            }`}
        >
            {!readOnly && editor && (
                <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-gray-100 bg-gray-50 shrink-0">
                    <AppToolbarButton
                        onClick={() =>
                            rawMode
                                ? applyRawHeading(1)
                                : editor
                                      .chain()
                                      .focus()
                                      .toggleHeading({ level: 1 })
                                      .run()
                        }
                        active={!rawMode && activeFormatting.heading1}
                        title="Heading 1"
                    >
                        <Heading1 className="h-4 w-4" />
                    </AppToolbarButton>
                    <AppToolbarButton
                        onClick={() =>
                            rawMode
                                ? applyRawHeading(2)
                                : editor
                                      .chain()
                                      .focus()
                                      .toggleHeading({ level: 2 })
                                      .run()
                        }
                        active={!rawMode && activeFormatting.heading2}
                        title="Heading 2"
                    >
                        <Heading2 className="h-4 w-4" />
                    </AppToolbarButton>
                    <AppToolbarButton
                        onClick={() =>
                            rawMode
                                ? applyRawHeading(3)
                                : editor
                                      .chain()
                                      .focus()
                                      .toggleHeading({ level: 3 })
                                      .run()
                        }
                        active={!rawMode && activeFormatting.heading3}
                        title="Heading 3"
                    >
                        <Heading3 className="h-4 w-4" />
                    </AppToolbarButton>
                    <div className="w-px h-4 bg-gray-200 mx-1 shrink-0" />
                    <AppToolbarButton
                        onClick={() =>
                            rawMode
                                ? applyRawInline("**")
                                : editor.chain().focus().toggleBold().run()
                        }
                        active={!rawMode && activeFormatting.bold}
                        title="Bold"
                    >
                        <Bold className="h-4 w-4" />
                    </AppToolbarButton>
                    <AppToolbarButton
                        onClick={() =>
                            rawMode
                                ? applyRawInline("*")
                                : editor.chain().focus().toggleItalic().run()
                        }
                        active={!rawMode && activeFormatting.italic}
                        title="Italic"
                    >
                        <Italic className="h-4 w-4" />
                    </AppToolbarButton>
                    <div className="w-px h-4 bg-gray-200 mx-1 shrink-0" />
                    <AppToolbarButton
                        onClick={() =>
                            rawMode
                                ? applyRawBulletList()
                                : editor.chain().focus().toggleBulletList().run()
                        }
                        active={!rawMode && activeFormatting.bulletList}
                        title="Bullet list"
                    >
                        <List className="h-4 w-4" />
                    </AppToolbarButton>
                    <AppToolbarButton
                        onClick={() =>
                            rawMode
                                ? applyRawOrderedList()
                                : editor
                                      .chain()
                                      .focus()
                                      .toggleOrderedList()
                                      .run()
                        }
                        active={!rawMode && activeFormatting.orderedList}
                        title="Numbered list"
                    >
                        <ListOrdered className="h-4 w-4" />
                    </AppToolbarButton>
                    <div className="w-px h-4 bg-gray-200 mx-1 shrink-0" />
                    <div ref={tablePickerRef} className="relative">
                        <AppToolbarButton
                            onClick={() =>
                                setTablePickerOpen((open) => {
                                    const nextOpen = !open;
                                    if (!nextOpen) {
                                        setTablePickerSize(null);
                                    }
                                    return nextOpen;
                                })
                            }
                            active={tablePickerOpen}
                            title="Insert table"
                        >
                            <Table2 className="h-4 w-4" />
                        </AppToolbarButton>
                        {tablePickerOpen && (
                            <div
                                role="dialog"
                                aria-label="Insert table"
                                className="absolute left-0 top-full z-[250] mt-1 w-max rounded-md border border-gray-200 bg-white p-2 shadow-lg"
                            >
                                <div
                                    className="grid gap-1"
                                    style={{
                                        gridTemplateColumns: `repeat(${TABLE_PICKER_MAX_COLS}, 1rem)`,
                                    }}
                                >
                                    {Array.from(
                                        { length: TABLE_PICKER_MAX_ROWS },
                                        (_, rowIndex) =>
                                            Array.from(
                                                {
                                                    length: TABLE_PICKER_MAX_COLS,
                                                },
                                                (_, colIndex) => {
                                                    const rows = rowIndex + 1;
                                                    const cols = colIndex + 1;
                                                    const selected =
                                                        tablePickerSize !==
                                                            null &&
                                                        rows <=
                                                            tablePickerSize.rows &&
                                                        cols <=
                                                            tablePickerSize.cols;

                                                    return (
                                                        <button
                                                            key={`${rows}-${cols}`}
                                                            type="button"
                                                            aria-label={`Insert ${rows} by ${cols} table`}
                                                            onMouseEnter={() =>
                                                                setTablePickerSize({
                                                                    rows,
                                                                    cols,
                                                                })
                                                            }
                                                            onFocus={() =>
                                                                setTablePickerSize({
                                                                    rows,
                                                                    cols,
                                                                })
                                                            }
                                                            onMouseDown={(
                                                                event,
                                                            ) => {
                                                                event.preventDefault();
                                                                insertTable(
                                                                    rows,
                                                                    cols,
                                                                );
                                                            }}
                                                            className={`h-4 w-4 rounded-[3px] border transition-colors ${
                                                                selected
                                                                    ? "border-gray-700 bg-gray-800"
                                                                    : "border-gray-200 bg-white hover:border-gray-400"
                                                            }`}
                                                        />
                                                    );
                                                },
                                            ),
                                    )}
                                </div>
                                <div className="mt-2 text-center text-[11px] font-medium text-gray-500">
                                    {tablePickerSize
                                        ? `${tablePickerSize.rows} x ${tablePickerSize.cols}`
                                        : "Select table size"}
                                </div>
                            </div>
                        )}
                    </div>
                    <div className="ml-auto" />
                    <AppToolbarButton
                        onClick={handleRawToggle}
                        active={rawMode}
                        title={rawMode ? "Show rich editor" : "Show raw Markdown"}
                    >
                        <Code2 className="h-4 w-4" />
                    </AppToolbarButton>
                </div>
            )}
            {readOnly && (
                <div className="flex h-9 shrink-0 items-center justify-between bg-gray-50 px-5">
                    <span className="text-xs font-medium text-gray-500">
                        Read-only
                    </span>
                    {editor && (
                        <AppToolbarButton
                            onClick={handleRawToggle}
                            active={rawMode}
                            title={
                                rawMode
                                    ? "Show rich editor"
                                    : "Show raw Markdown"
                            }
                        >
                            <Code2 className="h-4 w-4" />
                        </AppToolbarButton>
                    )}
                </div>
            )}
            <div
                className={`flex-1 overflow-y-auto ${
                    readOnly ? "border-t border-gray-100" : ""
                }`}
            >
                {rawMode ? (
                    <textarea
                        ref={rawTextareaRef}
                        value={rawMarkdown}
                        onChange={(event) =>
                            handleRawChange(event.target.value)
                        }
                        readOnly={readOnly}
                        spellCheck={false}
                        className="h-full min-h-full w-full resize-none bg-white px-5 py-4 font-mono text-xs leading-6 text-gray-800 outline-none placeholder:text-gray-400 read-only:cursor-default"
                        aria-label="Raw Markdown"
                    />
                ) : (
                    <EditorContent editor={editor} />
                )}
            </div>
        </div>
    );
}

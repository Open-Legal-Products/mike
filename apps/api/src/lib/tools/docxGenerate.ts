import { generatedDocKey, uploadFile } from "../storage";
import { createServerSupabase } from "../supabase";
import { buildDownloadUrl } from "../downloadTokens";

export async function generateDocx(
    title: string,
    sections: unknown[],
    userId: string,
    db: ReturnType<typeof createServerSupabase>,
    options?: { landscape?: boolean; projectId?: string | null },
) {
    try {
        const {
            Document,
            Paragraph,
            HeadingLevel,
            Packer,
            Table,
            TableRow,
            TableCell,
            WidthType,
            BorderStyle,
            TextRun,
            AlignmentType,
            LevelFormat,
            LevelSuffix,
            PageOrientation,
            PageBreak,
        } = await import("docx");

        const FONT = "Times New Roman";
        const SIZE = 22; // 11pt in half-points

        type DocChild =
            | InstanceType<typeof Paragraph>
            | InstanceType<typeof Table>;
        const children: DocChild[] = [];
        children.push(
            new Paragraph({
                heading: HeadingLevel.TITLE,
                spacing: { after: 200 },
                alignment: AlignmentType.CENTER,
                children: [
                    new TextRun({
                        text: title.toUpperCase(),
                        color: "000000",
                        font: FONT,
                        size: SIZE,
                        bold: true,
                    }),
                ],
            }),
        );

        const cellBorder = {
            top: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
            bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
            left: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
            right: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
        };

        const headingLevels = [
            HeadingLevel.HEADING_1,
            HeadingLevel.HEADING_2,
            HeadingLevel.HEADING_3,
            HeadingLevel.HEADING_4,
        ];
        const LEGAL_NUMBERING_REF = "legal-clause-numbering";
        const legalNumbering = (level: number) => ({
            reference: LEGAL_NUMBERING_REF,
            level: Math.max(0, Math.min(level, 4)),
        });
        const legalNumberingLevels = [
            {
                level: 0,
                format: LevelFormat.DECIMAL,
                text: "%1.",
                alignment: AlignmentType.START,
                suffix: LevelSuffix.TAB,
                isLegalNumberingStyle: true,
                style: {
                    paragraph: { indent: { left: 720, hanging: 720 } },
                    run: {
                        bold: true,
                        color: "000000",
                        font: FONT,
                        size: SIZE,
                    },
                },
            },
            {
                level: 1,
                format: LevelFormat.DECIMAL,
                text: "%1.%2",
                alignment: AlignmentType.START,
                suffix: LevelSuffix.TAB,
                isLegalNumberingStyle: true,
                style: {
                    paragraph: { indent: { left: 720, hanging: 720 } },
                    run: { color: "000000", font: FONT, size: SIZE },
                },
            },
            {
                level: 2,
                format: LevelFormat.LOWER_LETTER,
                text: "(%3)",
                alignment: AlignmentType.START,
                suffix: LevelSuffix.TAB,
                style: {
                    paragraph: { indent: { left: 1440, hanging: 720 } },
                    run: { color: "000000", font: FONT, size: SIZE },
                },
            },
            {
                level: 3,
                format: LevelFormat.LOWER_ROMAN,
                text: "(%4)",
                alignment: AlignmentType.START,
                suffix: LevelSuffix.TAB,
                style: {
                    paragraph: { indent: { left: 1440, hanging: 720 } },
                    run: { color: "000000", font: FONT, size: SIZE },
                },
            },
            {
                level: 4,
                format: LevelFormat.UPPER_LETTER,
                text: "(%5)",
                alignment: AlignmentType.START,
                suffix: LevelSuffix.TAB,
                style: {
                    paragraph: { indent: { left: 2520, hanging: 720 } },
                    run: { color: "000000", font: FONT, size: SIZE },
                },
            },
        ];
        const normalizeTable = (
            table: unknown,
        ): { headers: string[]; rows: string[][] } | null => {
            if (!table || typeof table !== "object") return null;
            const raw = table as { headers?: unknown; rows?: unknown };
            const headers = Array.isArray(raw.headers)
                ? raw.headers
                      .map((header) =>
                          typeof header === "string" ? header.trim() : "",
                      )
                      .filter(Boolean)
                : [];
            if (headers.length === 0) return null;

            const rawRows = Array.isArray(raw.rows) ? raw.rows : [];
            const rows = rawRows
                .filter((row): row is unknown[] => Array.isArray(row))
                .map((row) =>
                    headers.map((_, i) =>
                        typeof row[i] === "string" ? row[i] : "",
                    ),
                );

            return { headers, rows };
        };
        const stripManualNumbering = (
            value: string,
        ): { text: string; levelFromPrefix: number | null } => {
            const match = value
                .trim()
                .match(/^(\d+(?:\.\d+)*)(?:[.)])?\s+(.+)$/);
            if (!match) return { text: value.trim(), levelFromPrefix: null };
            return {
                text: match[2].trim(),
                levelFromPrefix: match[1].split(".").length - 1,
            };
        };
        const parseManualListMarker = (
            value: string,
        ): { text: string; levelOffset: number | null } => {
            const trimmed = value.trim();
            const match = trimmed.match(
                /^(\(([a-z]+)\)|([a-z]+)[.)])\s+(.+)$/i,
            );
            if (!match) return { text: trimmed, levelOffset: null };
            const marker = (match[2] ?? match[3] ?? "").toLowerCase();
            const isRoman =
                marker === "i" ||
                (marker.length > 1 &&
                    /^(?:m{0,4}(?:cm|cd|d?c{0,3})(?:xc|xl|l?x{0,3})(?:ix|iv|v?i{0,3}))$/i.test(
                        marker,
                    ));
            return { text: match[4].trim(), levelOffset: isRoman ? 3 : 2 };
        };
        const normalizeHeadingText = (value: string) =>
            value
                .trim()
                .replace(/[^a-zA-Z0-9]+/g, " ")
                .trim()
                .toLowerCase();

        const isTitleLikeFirstHeading = (
            heading: string,
            sectionIndex: number,
        ) => {
            if (sectionIndex !== 0) return false;
            const normalized = normalizeHeadingText(heading);
            const titleNormalized = normalizeHeadingText(title);
            if (!normalized || !titleNormalized) return false;
            if (normalized === titleNormalized) return true;
            return (
                titleNormalized.includes(normalized) &&
                /\b(agreement|contract|deed|terms|policy|notice|nda|disclosure)\b/.test(
                    normalized,
                )
            );
        };

        const isUnnumberedHeading = (heading: string, sectionIndex: number) => {
            const normalized = normalizeHeadingText(heading);
            if (!normalized) return true;
            if (normalized === "signatures" || normalized === "signature") {
                return true;
            }
            if (isTitleLikeFirstHeading(heading, sectionIndex)) {
                return true;
            }
            if (
                sectionIndex === 0 &&
                /^(agreement|contract|mutual non disclosure agreement|non disclosure agreement|employment agreement|service level agreement)$/.test(
                    normalized,
                )
            ) {
                return true;
            }
            return false;
        };
        const isSignatureLine = (value: string) =>
            /^(?:by|name|title|date):\s*/i.test(value.trim());
        const looksLikeSignatureBlock = (value: string) => {
            const lines = value
                .split("\n")
                .map((line) => line.trim())
                .filter(Boolean);
            if (lines.length === 0) return false;
            const signatureLineCount = lines.filter(isSignatureLine).length;
            return signatureLineCount >= 2;
        };
        let currentClauseLevel: number | null = null;

        for (const [sectionIndex, section] of (
            sections as {
                heading?: string;
                content?: string;
                level?: number;
                pageBreak?: boolean;
                table?: { headers: string[]; rows: string[][] };
            }[]
        ).entries()) {
            if (section.pageBreak) {
                children.push(new Paragraph({ children: [new PageBreak()] }));
            }
            if (section.heading) {
                const stripped = stripManualNumbering(section.heading);
                const isUnnumbered = isUnnumberedHeading(
                    stripped.text,
                    sectionIndex,
                );
                const skipHeading = isTitleLikeFirstHeading(
                    stripped.text,
                    sectionIndex,
                );
                const idx = Math.min(
                    stripped.levelFromPrefix ?? (section.level ?? 1) - 1,
                    3,
                );
                currentClauseLevel = isUnnumbered || skipHeading ? null : idx;
                const headingText =
                    idx === 0 && !isUnnumbered
                        ? stripped.text.toUpperCase()
                        : stripped.text;
                if (!skipHeading) {
                    children.push(
                        new Paragraph({
                            heading: headingLevels[idx],
                            numbering: isUnnumbered
                                ? undefined
                                : legalNumbering(idx),
                            spacing: { after: 160 },
                            children: [
                                new TextRun({
                                    text: headingText,
                                    color: "000000",
                                    font: FONT,
                                    size: SIZE,
                                    bold: true,
                                }),
                            ],
                        }),
                    );
                }
            }
            const normalizedTable = normalizeTable(section.table);
            if (normalizedTable) {
                const { headers, rows } = normalizedTable;
                const colCount = headers.length;
                const tableRows: InstanceType<typeof TableRow>[] = [];
                // Header row
                tableRows.push(
                    new TableRow({
                        tableHeader: true,
                        children: headers.map(
                            (h) =>
                                new TableCell({
                                    borders: cellBorder,
                                    shading: { fill: "F2F2F2" },
                                    children: [
                                        new Paragraph({
                                            children: [
                                                new TextRun({
                                                    text: h,
                                                    bold: true,
                                                    font: FONT,
                                                    size: SIZE,
                                                }),
                                            ],
                                            alignment: AlignmentType.LEFT,
                                        }),
                                    ],
                                }),
                        ),
                    }),
                );
                // Data rows — normalize each row to exactly colCount cells.
                // LLMs occasionally emit malformed rows (extra fragments from
                // stray delimiters, or short rows); padding/truncating here
                // keeps the rendered table aligned to the headers.
                for (const normalized of rows) {
                    tableRows.push(
                        new TableRow({
                            children: normalized.map(
                                (cell) =>
                                    new TableCell({
                                        borders: cellBorder,
                                        children: [
                                            new Paragraph({
                                                children: [
                                                    new TextRun({
                                                        text: cell,
                                                        font: FONT,
                                                        size: SIZE,
                                                    }),
                                                ],
                                            }),
                                        ],
                                    }),
                            ),
                        }),
                    );
                }
                children.push(
                    new Table({
                        width: { size: 100, type: WidthType.PERCENTAGE },
                        rows: tableRows,
                    }),
                );
                children.push(new Paragraph({ text: "" }));
            }
            if (section.content) {
                let numberedBodyParagraphs = 0;
                const contentIsSignatureBlock =
                    section.heading &&
                    normalizeHeadingText(section.heading).includes("signature")
                        ? true
                        : looksLikeSignatureBlock(section.content);
                for (const line of section.content.split("\n")) {
                    const trimmed = line.trim();
                    if (!trimmed) continue;
                    const bulletMatch = trimmed.match(/^[-•*]\s+(.+)/);
                    const rawText = bulletMatch
                        ? bulletMatch[1].trim()
                        : trimmed;
                    const manualList = parseManualListMarker(rawText);
                    const numeric = stripManualNumbering(rawText);
                    const text = bulletMatch
                        ? rawText
                        : manualList.levelOffset !== null
                          ? manualList.text
                          : numeric.text;
                    const inferredLevel =
                        currentClauseLevel === null || contentIsSignatureBlock
                            ? undefined
                            : bulletMatch
                              ? currentClauseLevel + 2
                              : manualList.levelOffset !== null
                                ? currentClauseLevel + manualList.levelOffset
                                : numeric.levelFromPrefix !== null
                                  ? numeric.levelFromPrefix
                                  : numberedBodyParagraphs === 0
                                    ? currentClauseLevel + 1
                                    : currentClauseLevel + 2;
                    if (currentClauseLevel !== null) numberedBodyParagraphs++;
                    children.push(
                        new Paragraph({
                            numbering:
                                inferredLevel === undefined
                                    ? undefined
                                    : legalNumbering(inferredLevel),
                            spacing: { after: 120 },
                            children: [
                                new TextRun({
                                    text,
                                    font: FONT,
                                    size: SIZE,
                                }),
                            ],
                        }),
                    );
                }
            }
        }

        const pageSetup = options?.landscape
            ? { page: { size: { orientation: PageOrientation.LANDSCAPE } } }
            : {};

        const doc = new Document({
            numbering: {
                config: [
                    {
                        reference: LEGAL_NUMBERING_REF,
                        levels: legalNumberingLevels,
                    },
                ],
            },
            sections: [{ properties: pageSetup, children }],
        });
        const buf = await Packer.toBuffer(doc);
        const zip = await import("jszip");
        const packageZip = await zip.default.loadAsync(buf);
        for (const requiredPath of [
            "[Content_Types].xml",
            "word/document.xml",
            "word/_rels/document.xml.rels",
        ]) {
            if (!packageZip.file(requiredPath)) {
                return {
                    error: `Generated DOCX is missing required package part: ${requiredPath}`,
                };
            }
        }
        const docId = crypto.randomUUID().replace(/-/g, "");
        const safeTitle =
            title
                .replace(/[^a-zA-Z0-9 -]/g, "")
                .trim()
                .slice(0, 64) || "document";
        const filename = `${safeTitle}.docx`;
        const key = generatedDocKey(userId, docId, filename);

        await uploadFile(
            key,
            buf.buffer as ArrayBuffer,
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        );
        const downloadUrl = buildDownloadUrl(key, filename);

        // Persist to DB so generated docs are first-class documents:
        // openable in the DocPanel and editable via edit_document. In
        // project chats we attach to the project so it appears in the
        // sidebar; in the general chat we leave project_id null and it
        // stays a standalone document.
        const { data: docRow, error: docErr } = await db
            .from("documents")
            .insert({
                project_id: options?.projectId ?? null,
                user_id: userId,
                filename,
                file_type: "docx",
                size_bytes: buf.byteLength,
                status: "ready",
            })
            .select("id")
            .single();
        if (docErr || !docRow) {
            return {
                error: `Failed to record generated document: ${docErr?.message ?? "unknown"}`,
            };
        }
        const documentId = docRow.id as string;

        const { data: versionRow, error: verErr } = await db
            .from("document_versions")
            .insert({
                document_id: documentId,
                storage_path: key,
                source: "generated",
                version_number: 1,
                display_name: filename,
            })
            .select("id")
            .single();
        if (verErr || !versionRow) {
            return {
                error: `Failed to record generated document version: ${verErr?.message ?? "unknown"}`,
            };
        }
        const versionId = versionRow.id as string;

        await db
            .from("documents")
            .update({ current_version_id: versionId })
            .eq("id", documentId);

        return {
            filename,
            download_url: downloadUrl,
            document_id: documentId,
            version_id: versionId,
            version_number: 1,
            storage_path: key,
            message: `Document '${filename}' has been generated successfully.`,
        };
    } catch (e) {
        return { error: String(e) };
    }
}

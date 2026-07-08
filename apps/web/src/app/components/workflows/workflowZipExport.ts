import type { ColumnConfig, Workflow } from "@/app/components/shared/types";

type ZipFile = {
    path: string;
    content: string;
};

const textEncoder = new TextEncoder();

const TABLE_CONFIG_SCHEMA = "../schema/table-config.schema.yaml";

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) {
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        table[i] = c >>> 0;
    }
    return table;
})();

function crc32(bytes: Uint8Array): number {
    let crc = 0xffffffff;
    for (const byte of bytes) {
        crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function uint16(value: number): Uint8Array {
    const bytes = new Uint8Array(2);
    new DataView(bytes.buffer).setUint16(0, value, true);
    return bytes;
}

function uint32(value: number): Uint8Array {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, value, true);
    return bytes;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
        out.set(part, offset);
        offset += part.length;
    }
    return out;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    return buffer;
}

function dosDateTime(date = new Date()): { date: number; time: number } {
    const year = Math.max(1980, date.getFullYear());
    return {
        time:
            (date.getHours() << 11) |
            (date.getMinutes() << 5) |
            Math.floor(date.getSeconds() / 2),
        date:
            ((year - 1980) << 9) |
            ((date.getMonth() + 1) << 5) |
            date.getDate(),
    };
}

function createZip(files: ZipFile[]): Blob {
    const localParts: Uint8Array[] = [];
    const centralParts: Uint8Array[] = [];
    const { date, time } = dosDateTime();
    let offset = 0;

    for (const file of files) {
        const name = textEncoder.encode(file.path);
        const content = textEncoder.encode(file.content);
        const crc = crc32(content);
        const localHeader = concatBytes([
            uint32(0x04034b50),
            uint16(20),
            uint16(0x0800),
            uint16(0),
            uint16(time),
            uint16(date),
            uint32(crc),
            uint32(content.length),
            uint32(content.length),
            uint16(name.length),
            uint16(0),
            name,
        ]);
        const centralHeader = concatBytes([
            uint32(0x02014b50),
            uint16(20),
            uint16(20),
            uint16(0x0800),
            uint16(0),
            uint16(time),
            uint16(date),
            uint32(crc),
            uint32(content.length),
            uint32(content.length),
            uint16(name.length),
            uint16(0),
            uint16(0),
            uint16(0),
            uint16(0),
            uint32(0),
            uint32(offset),
            name,
        ]);

        localParts.push(localHeader, content);
        centralParts.push(centralHeader);
        offset += localHeader.length + content.length;
    }

    const centralDirectory = concatBytes(centralParts);
    const endOfCentralDirectory = concatBytes([
        uint32(0x06054b50),
        uint16(0),
        uint16(0),
        uint16(files.length),
        uint16(files.length),
        uint32(centralDirectory.length),
        uint32(offset),
        uint16(0),
    ]);

    const zipBytes = concatBytes([
        ...localParts,
        centralDirectory,
        endOfCentralDirectory,
    ]);
    return new Blob([toArrayBuffer(zipBytes)], {
        type: "application/zip",
    });
}

function slugify(input: string, fallback: string): string {
    const slug = input
        .trim()
        .toLowerCase()
        .replace(/['"]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    return slug || fallback;
}

function yamlScalar(value: string | null): string {
    if (value === null) return "null";
    return JSON.stringify(value);
}

function yamlBlock(value: string): string {
    return value
        .replace(/\r\n/g, "\n")
        .trim()
        .split("\n")
        .map((line) => `      ${line}`)
        .join("\n");
}

function tableConfigYaml(columns: ColumnConfig[]): string {
    const lines = [`$schema: ${yamlScalar(TABLE_CONFIG_SCHEMA)}`, "columns_config:"];
    columns
        .slice()
        .sort((a, b) => a.index - b.index)
        .forEach((column) => {
            lines.push(`  - index: ${column.index}`);
            lines.push(`    name: ${yamlScalar(column.name)}`);
            if (column.format) {
                lines.push(`    format: ${yamlScalar(column.format)}`);
            }
            if (column.tags?.length) {
                lines.push("    tags:");
                column.tags.forEach((tag) =>
                    lines.push(`      - ${yamlScalar(tag)}`),
                );
            }
            lines.push("    prompt: >-");
            lines.push(yamlBlock(column.prompt));
        });
    return `${lines.join("\n")}\n`;
}

function skillFrontmatter(workflow: Workflow, slug: string): string {
    const contributors =
        workflow.metadata.contributors.length > 0
            ? workflow.metadata.contributors
            : [
                  {
                      name: "User",
                      organisation: null,
                      role: null,
                      linkedin: null,
                  },
              ];
    const lines = [
        "---",
        `name: ${yamlScalar(slug)}`,
        `display_name: ${yamlScalar(workflow.metadata.title)}`,
        `description: ${yamlScalar(
            workflow.metadata.description ??
                `Run the ${workflow.metadata.title} workflow.`,
        )}`,
        `type: ${yamlScalar(workflow.metadata.type)}`,
        `language: ${yamlScalar(workflow.metadata.language || "English")}`,
        `version: ${yamlScalar(workflow.metadata.version || "1.0.0")}`,
        `practice: ${yamlScalar(workflow.metadata.practice)}`,
        "jurisdictions:",
        ...(workflow.metadata.jurisdictions?.length
            ? workflow.metadata.jurisdictions.map(
                  (jurisdiction) => `  - ${yamlScalar(jurisdiction)}`,
              )
            : ["  - \"General\""]),
        "contributors:",
        ...contributors.flatMap((contributor) => [
            `  - name: ${yamlScalar(contributor.name)}`,
            `    organisation: ${yamlScalar(contributor.organisation)}`,
            `    role: ${yamlScalar(contributor.role)}`,
            `    linkedin: ${yamlScalar(contributor.linkedin)}`,
        ]),
        "---",
        "",
    ];
    return lines.join("\n");
}

function workflowFiles(
    workflow: Workflow,
    skillMd: string,
    columns: ColumnConfig[],
): { files: ZipFile[]; slug: string } {
    const type = workflow.metadata.type;
    const slug = slugify(workflow.metadata.title, workflow.id || "workflow");
    const basePath = slug;
    const files: ZipFile[] = [
        {
            path: `${basePath}/SKILL.md`,
            content: `${skillFrontmatter(workflow, slug)}${skillMd.trimEnd()}\n`,
        },
    ];

    if (type === "tabular") {
        files.push({
            path: `${basePath}/table-config.yaml`,
            content: tableConfigYaml(columns),
        });
    }

    return { files, slug };
}

export function downloadWorkflowZip(
    workflow: Workflow,
    skillMd: string,
    columns: ColumnConfig[],
) {
    const { files, slug } = workflowFiles(workflow, skillMd, columns);
    const blob = createZip(files);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${slug}.zip`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "..");
const WORKSPACE_DIR = path.resolve(ROOT_DIR, "..");
const WORKFLOWS_DIR = path.join(WORKSPACE_DIR, "mike-workflows");
const WORKFLOW_COLLECTIONS = [
  { directory: "assistant-workflows", type: "assistant" },
  { directory: "tabular-review-workflows", type: "tabular" },
];
const BACKEND_OUT = path.join(ROOT_DIR, "backend/src/lib/systemWorkflows.ts");
const LANDING_OUT = path.join(ROOT_DIR, "landing/app/generated-workflows.ts");

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function readJson(filePath) {
  try {
    return JSON.parse(readText(filePath));
  } catch (error) {
    throw new Error(`${relative(filePath)} is not valid JSON: ${error.message}`);
  }
}

function relative(filePath) {
  return path.relative(WORKSPACE_DIR, filePath);
}

function fail(message) {
  throw new Error(message);
}

function parseScalar(value, label) {
  const trimmed = value.trim();
  if (trimmed === "null") return null;
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+$/.test(trimmed)) return Number.parseInt(trimmed, 10);
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      return JSON.parse(trimmed);
    } catch (error) {
      fail(`${label} is not valid inline JSON: ${error.message}`);
    }
  }
  return trimmed;
}

function parseSimpleYaml(source, label) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const result = {};

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith("#")) continue;
    if (line.startsWith(" ")) {
      fail(`${label}:${i + 1} has unsupported indentation`);
    }

    const match = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):(.*)$/);
    if (!match) fail(`${label}:${i + 1} is not valid frontmatter`);
    const key = match[1];
    const rawValue = match[2].trim();

    if (rawValue) {
      result[key] = parseScalar(rawValue, `${label}.${key}`);
      continue;
    }

    const scalarItems = [];
    const objectItems = [];
    const properties = {};
    let mode = null;
    i++;
    for (; i < lines.length; i++) {
      const child = lines[i];
      if (!child.trim()) continue;
      if (!child.startsWith("  ")) {
        i--;
        break;
      }

      const listMatch = child.match(/^  -(?:\s+(.*))?$/);
      if (listMatch) {
        const itemText = listMatch[1]?.trim() ?? "";
        if (itemText.includes(":")) {
          mode ??= "objects";
          if (mode !== "objects") {
            fail(`${label}.${key} mixes scalar and object list items`);
          }
          const object = {};
          if (itemText) {
            const itemMatch = itemText.match(/^([A-Za-z_][A-Za-z0-9_-]*):(.*)$/);
            if (!itemMatch) {
              fail(`${label}:${i + 1} is not a valid object list item`);
            }
            object[itemMatch[1]] = parseScalar(
              itemMatch[2],
              `${label}.${key}.${itemMatch[1]}`,
            );
          }
          objectItems.push(object);
          continue;
        }

        mode ??= "scalars";
        if (mode !== "scalars") {
          fail(`${label}.${key} mixes object and scalar list items`);
        }
        scalarItems.push(parseScalar(itemText, `${label}.${key}`));
        continue;
      }

      const childPropMatch = child.match(/^  ([A-Za-z_][A-Za-z0-9_-]*):(.*)$/);
      if (childPropMatch) {
        mode ??= "properties";
        if (mode !== "properties") {
          fail(`${label}.${key} mixes mapping and list values`);
        }
        properties[childPropMatch[1]] = parseScalar(
          childPropMatch[2],
          `${label}.${key}.${childPropMatch[1]}`,
        );
        continue;
      }

      const propMatch = child.match(/^    ([A-Za-z_][A-Za-z0-9_-]*):(.*)$/);
      if (!propMatch || mode !== "objects" || objectItems.length === 0) {
        fail(`${label}:${i + 1} has unsupported frontmatter structure`);
      }
      objectItems[objectItems.length - 1][propMatch[1]] = parseScalar(
        propMatch[2],
        `${label}.${key}.${propMatch[1]}`,
      );
    }

    result[key] =
      mode === "objects"
        ? objectItems
        : mode === "properties"
          ? properties
          : scalarItems;
  }

  return result;
}

function readSkillFile(filePath) {
  const text = readText(filePath).replace(/\r\n/g, "\n");
  if (!text.startsWith("---\n")) {
    fail(`${relative(filePath)} must start with YAML frontmatter`);
  }
  const close = text.indexOf("\n---", 4);
  if (close === -1) {
    fail(`${relative(filePath)} is missing closing YAML frontmatter marker`);
  }
  const afterClose = text.slice(close + 4);
  if (afterClose && !afterClose.startsWith("\n")) {
    fail(`${relative(filePath)} has invalid frontmatter closing marker`);
  }
  return {
    metadata: parseSimpleYaml(text.slice(4, close), relative(filePath)),
    body: afterClose.replace(/^\n/, "").trimEnd(),
    fullText: text.trimEnd(),
  };
}

function parseTableColumnsYaml(filePath) {
  const lines = readText(filePath).replace(/\r\n/g, "\n").split("\n");
  const result = { columns_config: [] };
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith("#")) {
      i++;
      continue;
    }

    const schemaMatch = line.match(/^\$schema:\s*(.+)$/);
    if (schemaMatch) {
      result.$schema = parseScalar(schemaMatch[1], `${relative(filePath)}.$schema`);
      i++;
      continue;
    }

    if (line !== "columns:") {
      fail(`${relative(filePath)}:${i + 1} is not valid table columns YAML`);
    }
    i++;
    break;
  }

  let current = null;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    const itemMatch = line.match(/^  - index:\s*(.+)$/);
    if (itemMatch) {
      current = {
        index: parseScalar(itemMatch[1], `${relative(filePath)}.columns_config.index`),
      };
      result.columns_config.push(current);
      continue;
    }

    if (!current) {
      fail(`${relative(filePath)}:${i + 1} column entry must start with index`);
    }

    const propMatch = line.match(/^    ([A-Za-z_][A-Za-z0-9_-]*):(.*)$/);
    if (!propMatch) {
      fail(`${relative(filePath)}:${i + 1} is not a valid column property`);
    }
    const key = propMatch[1];
    const rawValue = propMatch[2].trim();

    if (key === "tags" && rawValue === "") {
      const tags = [];
      i++;
      for (; i < lines.length; i++) {
        const tagMatch = lines[i].match(/^      -\s*(.+)$/);
        if (!tagMatch) {
          i--;
          break;
        }
        tags.push(parseScalar(tagMatch[1], `${relative(filePath)}.${key}`));
      }
      current.tags = tags;
      continue;
    }

    if (rawValue === ">-" || rawValue === ">" || rawValue === "|-" || rawValue === "|") {
      const parts = [];
      i++;
      for (; i < lines.length; i++) {
        if (!lines[i].startsWith("      ")) {
          i--;
          break;
        }
        parts.push(lines[i].slice(6));
      }
      current[key] = rawValue.startsWith("|")
        ? parts.join("\n")
        : parts.join(" ").replace(/\s+/g, " ").trim();
      continue;
    }

    current[key] = parseScalar(rawValue, `${relative(filePath)}.${key}`);
  }

  return result;
}

function assertString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    fail(`${label} must be a non-empty string`);
  }
}

function assertOptionalString(value, label) {
  if (value === undefined || value === null) return;
  if (typeof value !== "string") fail(`${label} must be a string`);
}

function assertOptionalStringArray(value, label) {
  if (value === undefined || value === null) return;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    fail(`${label} must be an array of strings`);
  }
}

function normalizeContributors(value, label) {
  if (!Array.isArray(value) || value.length === 0) {
    fail(`${label} must be a non-empty array`);
  }
  return value.map((contributor, index) => {
    const contributorLabel = `${label}[${index}]`;
    if (!contributor || typeof contributor !== "object" || Array.isArray(contributor)) {
      fail(`${contributorLabel} must be an object`);
    }
    assertString(contributor.name, `${contributorLabel}.name`);
    assertOptionalString(contributor.organisation, `${contributorLabel}.organisation`);
    assertOptionalString(contributor.role, `${contributorLabel}.role`);
    assertOptionalString(contributor.linkedin, `${contributorLabel}.linkedin`);
    return {
      name: contributor.name.trim(),
      organisation: contributor.organisation?.trim() || null,
      role: contributor.role?.trim() || null,
      linkedin: contributor.linkedin?.trim() || null,
    };
  });
}

function assertColumnConfig(columns, label) {
  if (!Array.isArray(columns) || columns.length === 0) {
    fail(`${label}.columns_config must be a non-empty array`);
  }

  columns.forEach((column, index) => {
    const columnLabel = `${label}.columns_config[${index}]`;
    if (!column || typeof column !== "object" || Array.isArray(column)) {
      fail(`${columnLabel} must be an object`);
    }
    if (!Number.isInteger(column.index)) {
      fail(`${columnLabel}.index must be an integer`);
    }
    assertString(column.name, `${columnLabel}.name`);
    assertString(column.prompt, `${columnLabel}.prompt`);
    assertOptionalString(column.format, `${columnLabel}.format`);
    assertOptionalStringArray(column.tags, `${columnLabel}.tags`);
  });
}

function readWorkflow(category, workflowDir) {
  const slug = path.basename(workflowDir);
  const metadataPath = path.join(workflowDir, "metadata.json");
  if (fs.existsSync(metadataPath)) {
    fail(`${relative(metadataPath)} is no longer supported; use SKILL.md frontmatter`);
  }
  const skillPath = path.join(workflowDir, "SKILL.md");
  if (!fs.existsSync(skillPath)) {
    fail(`${relative(skillPath)} is required`);
  }
  const { metadata: frontmatter, body: skillMd, fullText: sourceSkillMd } =
    readSkillFile(skillPath);
  const label = `${relative(skillPath)} frontmatter`;
  const metadata = frontmatter.metadata;
  const id = `builtin-${slug}`;

  assertString(frontmatter.name, `${label}.name`);
  if (frontmatter.name !== slug) {
    fail(`${label}.name must match the folder name "${slug}"`);
  }
  assertString(frontmatter.description, `${label}.description`);
  assertString(frontmatter.license, `${label}.license`);
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    fail(`${label}.metadata must be a mapping`);
  }
  assertString(metadata.author, `${label}.metadata.author`);
  assertString(metadata.language, `${label}.language`);
  assertString(metadata.version, `${label}.version`);
  assertString(metadata["mike-display-name"], `${label}.metadata.mike-display-name`);
  if (metadata["mike-type"] !== category) {
    fail(`${label}.metadata.mike-type must be "${category}"`);
  }
  if (!["system", "add-on"].includes(metadata["mike-availability"])) {
    fail(`${label}.metadata.mike-availability must be "system" or "add-on"`);
  }
  assertString(metadata.practice, `${label}.metadata.practice`);
  assertString(metadata.jurisdictions, `${label}.metadata.jurisdictions`);

  const normalizedMetadata = {
    title: metadata["mike-display-name"],
    description: frontmatter.description,
    type: metadata["mike-type"],
    contributors: [
      {
        name: metadata.author.trim(),
        organisation: null,
        role: null,
        linkedin: null,
      },
    ],
    language: metadata.language,
    version: metadata.version,
    practice: metadata.practice,
    jurisdictions: metadata.jurisdictions
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  };

  if (category === "assistant") {
    if (!skillMd.trim()) {
      fail(`${relative(skillPath)} must include instructions after frontmatter`);
    }
    const tableColumnsPath = path.join(workflowDir, "table-columns.yaml");
    if (fs.existsSync(tableColumnsPath)) {
      fail(`${relative(tableColumnsPath)} is only supported for tabular workflows`);
    }
    return {
      id,
      availability: metadata["mike-availability"],
      metadata: normalizedMetadata,
      skill_md: skillMd,
      source_skill_md: sourceSkillMd,
      columns_config: null,
    };
  }

  const tableColumnsPath = path.join(workflowDir, "table-columns.yaml");
  if (!fs.existsSync(tableColumnsPath)) {
    fail(`${relative(tableColumnsPath)} is required for tabular workflows`);
  }
  const tableConfig = parseTableColumnsYaml(tableColumnsPath);
  const tableConfigLabel = relative(tableColumnsPath);
  const expectedSchemaPath = path.join(
    WORKFLOWS_DIR,
    "workflow-schema/table-columns.schema.yaml",
  );
  const actualSchemaPath = path.resolve(workflowDir, tableConfig.$schema ?? "");
  if (actualSchemaPath !== expectedSchemaPath) {
    fail(`${tableConfigLabel}.$schema must point to workflow-schema/table-columns.schema.yaml`);
  }
  assertColumnConfig(tableConfig.columns_config, tableConfigLabel);

  return {
    id,
    availability: metadata["mike-availability"],
    metadata: normalizedMetadata,
    skill_md: skillMd || null,
    source_skill_md: sourceSkillMd,
    columns_config: tableConfig.columns_config,
  };
}

function loadWorkflows() {
  const workflows = [];
  const seenIds = new Set();

  for (const collection of WORKFLOW_COLLECTIONS) {
    const collectionDir = path.join(WORKFLOWS_DIR, collection.directory);
    if (!fs.existsSync(collectionDir)) continue;
    const workflowDirs = fs
      .readdirSync(collectionDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .flatMap((entry) => {
        const entryDir = path.join(collectionDir, entry.name);
        if (fs.existsSync(path.join(entryDir, "SKILL.md"))) return [entryDir];
        if (!fs.existsSync(path.join(entryDir, "pack.json"))) return [];
        return fs
          .readdirSync(entryDir, { withFileTypes: true })
          .filter(
            (child) =>
              child.isDirectory() &&
              fs.existsSync(path.join(entryDir, child.name, "SKILL.md")),
          )
          .map((child) => path.join(entryDir, child.name));
      })
      .sort((a, b) => a.localeCompare(b));

    for (const workflowDir of workflowDirs) {
      const workflow = readWorkflow(collection.type, workflowDir);
      if (workflow.availability !== "system") continue;
      if (seenIds.has(workflow.id)) {
        fail(`Duplicate workflow id: ${workflow.id}`);
      }
      seenIds.add(workflow.id);
      workflows.push(workflow);
    }
  }

  return workflows.sort((a, b) => a.id.localeCompare(b.id));
}

function formatTs(value) {
  return JSON.stringify(value, null, 4);
}

function writeGeneratedFiles(workflows) {
  const systemWorkflows = workflows.map((workflow) => ({
    user_id: null,
    is_system: true,
    created_at: "",
    id: workflow.id,
    metadata: workflow.metadata,
    skill_md: workflow.skill_md,
    columns_config: workflow.columns_config,
  }));
  const systemAssistantWorkflows = workflows
    .filter((workflow) => workflow.metadata.type === "assistant")
    .map((workflow) => ({
      id: workflow.id,
      title: workflow.metadata.title,
      skill_md: workflow.skill_md,
    }));
  const landingWorkflows = workflows.map((workflow) => ({
    id: workflow.id,
    metadata: workflow.metadata,
    skill_md: workflow.source_skill_md,
    columnCount: workflow.columns_config?.length ?? 0,
    columns: workflow.columns_config ?? [],
  }));

  const backendText = `// This file is generated by scripts/build-workflows.js. Do not edit it directly.\n\nexport type SystemWorkflowContributor = {\n    name: string;\n    organisation: string | null;\n    role: string | null;\n    linkedin: string | null;\n};\n\nexport type SystemWorkflowMetadata = {\n    title: string;\n    description: string;\n    type: "assistant" | "tabular";\n    contributors: SystemWorkflowContributor[];\n    language: string;\n    version: string;\n    practice: string | null;\n    jurisdictions: string[] | null;\n};\n\nexport type SystemWorkflow = {\n    id: string;\n    user_id: null;\n    is_system: true;\n    created_at: string;\n    metadata: SystemWorkflowMetadata;\n    skill_md: string | null;\n    columns_config: { index: number; name: string; format?: string; prompt: string; tags?: string[] }[] | null;\n};\n\nexport const SYSTEM_WORKFLOWS: SystemWorkflow[] = ${formatTs(systemWorkflows)};\n\nexport const SYSTEM_WORKFLOW_IDS = new Set(SYSTEM_WORKFLOWS.map((wf) => wf.id));\n\nexport const SYSTEM_ASSISTANT_WORKFLOWS: { id: string; title: string; skill_md: string }[] = ${formatTs(systemAssistantWorkflows)};\n`;

  const landingText = `// This file is generated by scripts/build-workflows.js. Do not edit it directly.\nimport type { LandingWorkflow } from "./workflow-browser";\n\nexport const LANDING_WORKFLOWS: LandingWorkflow[] = ${formatTs(landingWorkflows)};\n`;

  fs.writeFileSync(BACKEND_OUT, backendText);
  if (fs.existsSync(path.dirname(LANDING_OUT))) {
    fs.writeFileSync(LANDING_OUT, landingText);
  }
}

function main() {
  if (!fs.existsSync(WORKFLOWS_DIR)) {
    fail(`Workflow source directory not found: ${relative(WORKFLOWS_DIR)}`);
  }
  for (const collection of WORKFLOW_COLLECTIONS) {
    const collectionDir = path.join(WORKFLOWS_DIR, collection.directory);
    if (!fs.existsSync(collectionDir)) {
      fail(`Workflow collection not found: ${relative(collectionDir)}`);
    }
  }

  const workflows = loadWorkflows();
  if (workflows.length === 0) {
    fail("No workflows found");
  }

  writeGeneratedFiles(workflows);
  console.log(`Generated ${workflows.length} system workflows.`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

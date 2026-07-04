#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "..");
const WORKSPACE_DIR = path.resolve(ROOT_DIR, "..");
const WORKFLOWS_DIR = path.join(WORKSPACE_DIR, "mike-workflows");
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
  });
}

function readWorkflow(category, dirent) {
  const slug = dirent.name;
  const workflowDir = path.join(WORKFLOWS_DIR, category, slug);
  const metadataPath = path.join(workflowDir, "metadata.json");
  if (!fs.existsSync(metadataPath)) {
    fail(`${relative(metadataPath)} is required`);
  }
  const metadata = readJson(metadataPath);
  const label = relative(metadataPath);
  const id = `builtin-${slug}`;

  if (metadata.id !== undefined) {
    fail(`${label}.id is not supported; the ID is generated from the directory name`);
  }
  const expectedSchema = "../../schema/workflow-metadata.schema.json";
  if (metadata.$schema !== expectedSchema) {
    fail(`${label}.$schema must be "${expectedSchema}"`);
  }
  assertString(metadata.title, `${label}.title`);
  const contributors = normalizeContributors(
    metadata.contributors,
    `${label}.contributors`,
  );
  assertString(metadata.language, `${label}.language`);
  assertString(metadata.version, `${label}.version`);
  if (metadata.type !== category) {
    fail(`${label}.type must be "${category}"`);
  }
  if (metadata.category !== undefined) {
    fail(`${label}.category is not supported`);
  }
  if (metadata.action !== undefined) {
    fail(`${label}.action is not supported`);
  }
  assertOptionalString(metadata.practice, `${label}.practice`);
  assertOptionalStringArray(metadata.jurisdictions, `${label}.jurisdictions`);
  if (metadata.order !== undefined && !Number.isInteger(metadata.order)) {
    fail(`${label}.order must be an integer`);
  }

  if (category === "assistant") {
    if (metadata.prompt !== undefined) {
      fail(`${label}.prompt is not supported; use SKILL.md`);
    }
    const promptPath = path.join(workflowDir, "SKILL.md");
    if (!fs.existsSync(promptPath)) {
      fail(`${relative(promptPath)} is required for assistant workflows`);
    }

    if (metadata.execution_prompt !== undefined) {
      fail(`${label}.execution_prompt is not supported; use SKILL.md`);
    }
    const tableConfigPath = path.join(workflowDir, "table-config.json");
    if (fs.existsSync(tableConfigPath)) {
      fail(`${relative(tableConfigPath)} is only supported for tabular workflows`);
    }
    const promptMd = readText(promptPath).trimEnd();
    return {
      id,
      title: metadata.title,
      type: metadata.type,
      contributors,
      language: metadata.language,
      version: metadata.version,
      practice: metadata.practice ?? null,
      jurisdictions: metadata.jurisdictions ?? null,
      order: metadata.order ?? 0,
      prompt_md: promptMd,
      columns_config: null,
    };
  }

  let promptMd = null;
  if (metadata.prompt !== undefined) {
    fail(`${label}.prompt is not supported; use SKILL.md`);
  }
  const promptPath = path.join(workflowDir, "SKILL.md");
  if (fs.existsSync(promptPath)) {
    promptMd = readText(promptPath).trimEnd();
  }
  if (metadata.execution_prompt !== undefined) {
    fail(`${label}.execution_prompt is not supported; use SKILL.md`);
  }
  if (metadata.columns_config !== undefined) {
    fail(`${label}.columns_config is not supported; use table-config.json`);
  }
  const tableConfigPath = path.join(workflowDir, "table-config.json");
  if (!fs.existsSync(tableConfigPath)) {
    fail(`${relative(tableConfigPath)} is required for tabular workflows`);
  }
  const tableConfig = readJson(tableConfigPath);
  const tableConfigLabel = relative(tableConfigPath);
  const expectedTableConfigSchema = "../../schema/table-config.schema.json";
  if (tableConfig.$schema !== expectedTableConfigSchema) {
    fail(`${tableConfigLabel}.$schema must be "${expectedTableConfigSchema}"`);
  }
  assertColumnConfig(tableConfig.columns_config, tableConfigLabel);

  return {
    id,
    title: metadata.title,
    type: metadata.type,
    contributors,
    language: metadata.language,
    version: metadata.version,
    practice: metadata.practice ?? null,
    jurisdictions: metadata.jurisdictions ?? null,
    order: metadata.order ?? 0,
    prompt_md: promptMd,
    columns_config: tableConfig.columns_config,
  };
}

function loadWorkflows() {
  const workflows = [];
  const seenIds = new Set();

  for (const category of ["assistant", "tabular"]) {
    const categoryDir = path.join(WORKFLOWS_DIR, category);
    if (!fs.existsSync(categoryDir)) continue;

    const entries = fs
      .readdirSync(categoryDir, { withFileTypes: true })
      .filter((dirent) => dirent.isDirectory() && !dirent.name.startsWith("."))
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const workflow = readWorkflow(category, entry);
      if (seenIds.has(workflow.id)) {
        fail(`Duplicate workflow id: ${workflow.id}`);
      }
      seenIds.add(workflow.id);
      workflows.push(workflow);
    }
  }

  return workflows.sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    return a.id.localeCompare(b.id);
  });
}

function stripGeneratorFields(workflow) {
  const { order, ...publicWorkflow } = workflow;
  return {
    user_id: null,
    is_system: true,
    created_at: "",
    ...publicWorkflow,
  };
}

function formatTs(value) {
  return JSON.stringify(value, null, 4);
}

function writeGeneratedFiles(workflows) {
  const systemWorkflows = workflows.map(stripGeneratorFields);
  const systemAssistantWorkflows = workflows
    .filter((workflow) => workflow.type === "assistant")
    .map((workflow) => ({
      id: workflow.id,
      title: workflow.title,
      prompt_md: workflow.prompt_md,
    }));
  const landingWorkflows = workflows.map((workflow) => ({
    id: workflow.id,
    title: workflow.title,
    type: workflow.type,
    contributors: workflow.contributors,
    language: workflow.language,
    version: workflow.version,
    practice: workflow.practice,
    jurisdictions: workflow.jurisdictions,
    order: workflow.order,
    skill: workflow.prompt_md,
    columnCount: workflow.columns_config?.length ?? 0,
    columns: workflow.columns_config ?? [],
  }));

  const backendText = `// This file is generated by scripts/build-workflows.js. Do not edit it directly.\n\nexport type SystemWorkflowContributor = {\n    name: string;\n    organisation: string | null;\n    role: string | null;\n    linkedin: string | null;\n};\n\nexport type SystemWorkflow = {\n    id: string;\n    user_id: null;\n    is_system: true;\n    created_at: string;\n    title: string;\n    type: "assistant" | "tabular";\n    contributors: SystemWorkflowContributor[];\n    language: string;\n    version: string;\n    practice: string | null;\n    jurisdictions: string[] | null;\n    prompt_md: string | null;\n    columns_config: { index: number; name: string; format?: string; prompt: string; tags?: string[] }[] | null;\n};\n\nexport const SYSTEM_WORKFLOWS: SystemWorkflow[] = ${formatTs(systemWorkflows)};\n\nexport const SYSTEM_WORKFLOW_IDS = new Set(SYSTEM_WORKFLOWS.map((wf) => wf.id));\n\nexport const SYSTEM_ASSISTANT_WORKFLOWS: { id: string; title: string; prompt_md: string }[] = ${formatTs(systemAssistantWorkflows)};\n`;

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

/**
 * Import claude-for-legal skills into Mike as built-in "assistant" workflows.
 *
 * The upstream repo (https://github.com/anthropics/claude-for-legal, Apache-2.0)
 * ships practice-area plugins whose skills are markdown SKILL.md files: YAML
 * frontmatter + a prompt body. A Mike "assistant" workflow is essentially the
 * same thing — a markdown prompt the model loads via the read_workflow tool —
 * so each document-task skill maps onto one workflow.
 *
 * This script:
 *   1. reads a local checkout of claude-for-legal,
 *   2. selects the user-invocable document-task skills (dropping plugin-runtime
 *      / config-management skills and non-invocable sub-skills that have no Mike
 *      equivalent),
 *   3. adapts each body for Mike — the upstream skills read a per-team CLAUDE.md
 *      practice profile and reference external CLM/e-sign connectors; Mike has a
 *      per-user Practice Profile (injected into the system prompt) and its own
 *      document tools, so those references are rewritten,
 *   4. emits generated workflow catalogues for the backend and the frontend.
 *
 * Usage:
 *   git clone --depth 1 https://github.com/anthropics/claude-for-legal /tmp/cfl
 *   npx tsx scripts/import-skills.ts /tmp/cfl
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const SOURCE = process.argv[2] || process.env.SKILL_SRC || "/tmp/cfl";

// Plugin folders to import, with the Mike "practice" label each maps onto.
// The skill-marketplace meta plugin (legal-builder-hub) is intentionally
// excluded — it manages community skill discovery/trust, not legal tasks.
const AREAS: { folder: string; practice: string; slug: string }[] = [
    { folder: "ai-governance-legal", practice: "AI Governance", slug: "aigov" },
    { folder: "commercial-legal", practice: "Commercial Contracts", slug: "commercial" },
    { folder: "corporate-legal", practice: "Corporate / M&A", slug: "corporate" },
    { folder: "employment-legal", practice: "Employment", slug: "employment" },
    { folder: "ip-legal", practice: "Intellectual Property", slug: "ip" },
    { folder: "law-student", practice: "Law Student", slug: "lawstudent" },
    { folder: "legal-clinic", practice: "Legal Clinic", slug: "clinic" },
    { folder: "litigation-legal", practice: "Litigation", slug: "litigation" },
    { folder: "privacy-legal", practice: "Privacy & Data Protection", slug: "privacy" },
    { folder: "product-legal", practice: "Product", slug: "product" },
    { folder: "regulatory-legal", practice: "Regulatory", slug: "regulatory" },
];

// Skills whose job is plugin/profile/workspace/scheduling management rather than
// a document task — they have no Mike equivalent (the Practice Profile is edited
// in Account settings; there are no scheduled agents, matter workspaces, study
// sessions, deadline trackers, or supervisor queues).
const RUNTIME_DENYLIST = new Set([
    "cold-start-interview",
    "customize",
    "matter-workspace",
    "review-proposals",
    // law-student / legal-clinic session & workspace-state skills:
    "session",
    "study-plan",
    "ramp",
    "semester-handoff",
    "build-guide",
    "client-comms-log",
    "deadlines",
    "supervisor-review-queue",
]);

// Scheduled watchers and register-trackers (every area ships its own) — these
// rely on persistent state / background runs that Mike doesn't have.
const DENY_PATTERNS = [/-(monitor|watcher)$/, /^(renewal|leave)-tracker$/, /^log-/];

const PRACTICE_PROFILE_REF =
    "your USER PRACTICE PROFILE (provided in the system prompt; the user maintains it in Account → Practice Profile)";

type Skill = { name: string; title: string; id: string; practice: string; prompt_md: string };

function parseFrontmatter(raw: string): {
    fields: Record<string, string>;
    body: string;
} {
    if (!raw.startsWith("---")) return { fields: {}, body: raw };
    const end = raw.indexOf("\n---", 3);
    if (end === -1) return { fields: {}, body: raw };
    const fmBlock = raw.slice(3, end);
    const body = raw.slice(raw.indexOf("\n", end + 1) + 1);
    const fields: Record<string, string> = {};
    for (const line of fmBlock.split("\n")) {
        const m = /^([a-zA-Z-]+):\s*(.*)$/.exec(line);
        if (m) fields[m[1]] = m[2].trim();
    }
    return { fields, body };
}

const ACRONYMS: Record<string, string> = {
    nda: "NDA",
    saas: "SaaS",
    msa: "MSA",
    cp: "CP",
    sha: "SHA",
    ip: "IP",
    irac: "IRAC",
    dpa: "DPA",
    dsar: "DSAR",
    pia: "PIA",
    fto: "FTO",
    oss: "OSS",
    aia: "AIA",
    qa: "Q&A",
};

function titleCase(name: string): string {
    return name
        .split("-")
        .map(
            (w) =>
                ACRONYMS[w.toLowerCase()] ??
                w.charAt(0).toUpperCase() + w.slice(1),
        )
        .join(" ");
}

function adaptBody(name: string, body: string): string {
    let out = body.trim();
    // The per-team CLAUDE.md practice profile -> Mike's per-user Practice Profile.
    // (Match this before the generic path rule below.) Swallow any surrounding
    // backticks so we don't leave `<long sentence>`.
    out = out.replace(
        /`?~\/\.claude\/plugins\/config\/claude-for-legal\/[^\s`)]*\/CLAUDE\.md`?/g,
        PRACTICE_PROFILE_REF,
    );
    // Every other ~/.claude/plugins/... path is a local working-file the upstream
    // skill reads/writes (deal-context, trackers, output dirs). Mike has no such
    // filesystem — work from the project's documents instead.
    out = out.replace(
        /`?~\/\.claude\/plugins\/config\/claude-for-legal\/[^\s`)]*`?/g,
        "the current project's documents",
    );
    out = out.replace(/`?\bCLAUDE\.md\b`?/g, PRACTICE_PROFILE_REF);

    // Upstream slash-commands have no meaning in Mike. The cold-start/customize
    // skills are replaced by the Account → Practice Profile UI; the rest were
    // promoted to workflows, so point at the workflow by name.
    out = out.replace(
        /\/[a-z][a-z-]*-legal:([a-z][a-z-]*)/g,
        (_m, skill: string) =>
            skill === "cold-start-interview" || skill === "customize"
                ? "configure your Practice Profile (Account → Practice Profile)"
                : `the “${titleCase(skill)}” workflow`,
    );

    const preamble =
        `> Adapted for Mike from the Anthropic “claude-for-legal” skill “${name}” (Apache-2.0).\n` +
        `> Work from the current project's documents — call list_documents, read_document, and fetch_documents to load them; do not assume external CLM, e-signature, or document-storage connectors exist. Produce any downloadable file with the generate_docx tool. Use ${PRACTICE_PROFILE_REF} for the firm's playbook positions, escalation matrix, and house style; if a position you need is not there, ask the user rather than assuming a default. Every output is a draft for attorney review — not legal advice.\n\n`;
    return preamble + out;
}

const skills: Skill[] = [];
const skipped: { name: string; reason: string }[] = [];

for (const area of AREAS) {
    const skillsDir = join(SOURCE, area.folder, "skills");
    if (!existsSync(skillsDir)) {
        console.error(`! skills dir not found: ${skillsDir}`);
        continue;
    }
    for (const name of readdirSync(skillsDir).sort()) {
        const file = join(skillsDir, name, "SKILL.md");
        if (!existsSync(file)) continue;
        const { fields, body } = parseFrontmatter(readFileSync(file, "utf8"));
        // We deliberately keep upstream `user-invocable: false` skills: that flag
        // controls slash-command exposure in the Claude Code plugin runtime, but
        // in Mike every workflow is explicitly user-selected, and those are the
        // substantive review playbooks (vendor / NDA / SaaS) that the `review`
        // router delegates to. They're useful standalone, so we promote them.
        if (RUNTIME_DENYLIST.has(name)) {
            skipped.push({ name, reason: "plugin/profile-management skill" });
            continue;
        }
        if (DENY_PATTERNS.some((re) => re.test(name))) {
            skipped.push({ name, reason: "scheduled watcher / register-tracker" });
            continue;
        }
        // Upstream marks superseded skills "DEPRECATED — use /other" near the top.
        if (/\bDEPRECATED\b/.test(body.slice(0, 300))) {
            skipped.push({ name, reason: "deprecated upstream" });
            continue;
        }
        skills.push({
            name,
            title: titleCase(name),
            id: `builtin-cfl-${area.slug}-${name}`,
            practice: area.practice,
            prompt_md: adaptBody(name, body),
        });
    }
}

const HEADER =
    "// @generated by backend/scripts/import-skills.ts — do not edit by hand.\n" +
    "// Ported from Anthropic's claude-for-legal (https://github.com/anthropics/claude-for-legal),\n" +
    "// licensed under Apache-2.0. Bodies are adapted for Mike's tools and Practice Profile.\n" +
    "// Re-generate with: npx tsx scripts/import-skills.ts <path-to-claude-for-legal>\n\n";

// Backend catalogue: shape buildWorkflowStore injects, plus `practice` so the
// active-workflow → practice-area lookup can pick the right per-area profile.
const backendOut =
    HEADER +
    "export const PORTED_LEGAL_WORKFLOWS: { id: string; title: string; practice: string; prompt_md: string }[] = [\n" +
    skills
        .map(
            (s) =>
                `    {\n        id: ${JSON.stringify(s.id)},\n        title: ${JSON.stringify(s.title)},\n        practice: ${JSON.stringify(s.practice)},\n        prompt_md: ${JSON.stringify(s.prompt_md)},\n    },`,
        )
        .join("\n") +
    "\n];\n";
writeFileSync(join(__dirname, "..", "src", "lib", "portedLegalWorkflows.ts"), backendOut);

// Frontend catalogue: the richer MikeWorkflow shape used by the workflow picker.
const frontendOut =
    HEADER +
    'import type { MikeWorkflow } from "../shared/types";\n\n' +
    "export const PORTED_LEGAL_WORKFLOWS: MikeWorkflow[] = [\n" +
    skills
        .map(
            (s) =>
                `    {\n        id: ${JSON.stringify(s.id)},\n        user_id: null,\n        is_system: true,\n        created_at: "",\n        title: ${JSON.stringify(s.title)},\n        type: "assistant",\n        practice: ${JSON.stringify(s.practice)},\n        prompt_md: ${JSON.stringify(s.prompt_md)},\n        columns_config: null,\n    },`,
        )
        .join("\n") +
    "\n];\n";
writeFileSync(
    join(__dirname, "..", "..", "frontend", "src", "app", "components", "workflows", "portedLegalWorkflows.ts"),
    frontendOut,
);

console.log(`Imported ${skills.length} workflows:`);
for (const s of skills) console.log(`  + ${s.id}  (${s.title})`);
console.log(`\nSkipped ${skipped.length}:`);
for (const s of skipped) console.log(`  - ${s.name}: ${s.reason}`);

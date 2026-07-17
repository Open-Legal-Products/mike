# Workflows

Workflows are reusable AI instructions that appear in Mike's UI as one-click options.  They let you codify repeatable legal review tasks — an NDA checklist, a contract risk matrix, a due-diligence template — and share them across your team or with the broader community.

## Types

| Type | Where it appears | What it does |
|------|-----------------|--------------|
| `assistant` | Chat sidebar → Workflows | Injects a custom prompt into the system context when the user activates it. The LLM follows the workflow's instructions for the current turn. |
| `tabular` | Tabular review → Add column | Defines one or more columns in a tabular review. Each cell in the column is filled by sending the column's prompt to the LLM for a given document. |

## Creating a Workflow

### Via the UI
Settings → Workflows → New Workflow.  Fill in the title, type, and prompt.

### Via the API
```http
POST /workflows
Authorization: Bearer <token>
Content-Type: application/json

{
  "title": "NDA Quick Review",
  "type": "assistant",
  "prompt_md": "Review the NDA and identify...",
  "practice": "corporate"
}
```

## Exporting a Workflow

Workflows can be exported as `.mikeworkflow.json` files for backup or sharing.

```http
GET /workflows/:id/export
Authorization: Bearer <token>
```

The response downloads a file like `NDA-Quick-Review.mikeworkflow.json`.

## Importing a Workflow

Share a `.mikeworkflow.json` file with a colleague.  They import it via the API or UI:

```http
POST /workflows/import
Authorization: Bearer <token>
Content-Type: application/json

{
  "formatVersion": 1,
  "workflow": {
    "title": "NDA Quick Review",
    "type": "assistant",
    "prompt_md": "Review the NDA and identify...",
    "practice": "corporate"
  }
}
```

The import always creates a **new** workflow with a fresh ID owned by the importing user.  It never overwrites an existing workflow.

## File Format Reference

The `.mikeworkflow.json` format is validated by [`schemas/workflow.schema.json`](../schemas/workflow.schema.json).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `formatVersion` | integer | ✓ | Always `1`. Future breaking changes increment this. |
| `exportedAt` | ISO string | — | Export timestamp (informational). |
| `workflow.title` | string | ✓ | Display name in the workflow picker. |
| `workflow.type` | `"assistant"` or `"tabular"` | ✓ | Where the workflow appears. |
| `workflow.prompt_md` | string or null | — | The workflow prompt text (Markdown). |
| `workflow.columns_config` | array or null | — | Column definitions for `tabular` workflows. |
| `workflow.practice` | string or null | — | Legal practice area tag for filtering. |

### columns_config (tabular workflows)

Each entry in `columns_config` defines one column:

```json
{
  "name": "Governing Law",
  "prompt": "What jurisdiction governs this agreement? Return only the name.",
  "type": "text"
}
```

| Field | Values | Description |
|-------|--------|-------------|
| `name` | string | Column heading |
| `prompt` | string | Prompt sent to the LLM per cell |
| `type` | `"text"` / `"flag"` / `"yesno"` | Cell rendering hint |

`"flag"` renders a coloured RED / AMBER / GREEN badge.  `"yesno"` renders a Yes/No pill.  `"text"` (default) renders plain text.

## Example: Assistant Workflow

```json
{
  "formatVersion": 1,
  "exportedAt": "2026-05-24T12:00:00.000Z",
  "workflow": {
    "title": "NDA Quick Review",
    "type": "assistant",
    "prompt_md": "Review the provided NDA and identify:\n1. Key definitions\n2. Exclusions\n3. Duration\n4. Unusual clauses\n\nProvide a risk rating: Low / Medium / High.",
    "columns_config": null,
    "practice": "corporate"
  }
}
```

## Example: Tabular Workflow

```json
{
  "formatVersion": 1,
  "workflow": {
    "title": "Contract Risk Matrix",
    "type": "tabular",
    "columns_config": [
      { "name": "Governing Law", "prompt": "What jurisdiction governs this agreement?", "type": "text" },
      { "name": "Liability Cap", "prompt": "Is there a liability cap? State the amount or 'None'.", "type": "text" },
      { "name": "Auto-Renewal", "prompt": "Does this contract auto-renew? Answer Yes or No.", "type": "yesno" },
      { "name": "Red Flag", "prompt": "Any unusual or unenforceable clauses? Flag RED if yes, GREEN if no.", "type": "flag" }
    ],
    "practice": "corporate"
  }
}
```

## Sharing with the Community

Contributions of high-quality workflows are welcome.  Submit a PR adding your `.mikeworkflow.json` file to `examples/workflows/`.  Include a brief description of what the workflow does and which practice area it targets.

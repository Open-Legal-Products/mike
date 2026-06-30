/**
 * E2E coverage for the Projects flow — apps/word-addin/src/taskpane/components/ProjectPicker.tsx.
 *
 * The ProjectPicker (rendered under the "Projects" tab) is responsible for:
 *   - loading the project list      GET    /projects
 *   - selecting a project           (native <select>, defaults to the first)
 *   - loading that project's docs   GET    /projects/:id/documents
 *   - uploading the open document   POST   /projects/:id/documents  (multipart)
 *
 * NOTE: this component has NO "create project" / "delete project" UI — those
 * scenarios from the brief do not exist in the implementation, so they are not
 * authored here. See the returned `scenarios` summary for the derivation.
 *
 * Every test starts signed-in (token seeded) and mocks only the exact paths the
 * component calls. Selectors are role/label/text based and deterministic.
 */
import { test, expect } from "./support/fixtures";

const TOKEN = "seeded-jwt";

/** Reveal the ProjectPicker by switching to the Projects tab. */
async function openProjectsTab(page: import("@playwright/test").Page): Promise<void> {
  await page.getByRole("tab", { name: "Projects" }).click();
}

test("renders the project list after loading and selects the first project", async ({
  addin,
  page,
}) => {
  addin.seedToken(TOKEN);
  await addin.mockApiJson("GET", "**/projects", [
    { id: "p1", name: "Alpha Matter" },
    { id: "p2", name: "Beta Matter" },
  ]);
  // First project's documents are fetched immediately on mount.
  await addin.mockApiJson("GET", "**/projects/p1/documents", [
    { id: "d1", filename: "alpha-brief.docx" },
  ]);

  await addin.gotoTaskpane();
  await addin.expectAuthedShell();
  await openProjectsTab(page);

  // The project selector exposes both projects and defaults to the first.
  const select = page.getByRole("combobox", { name: "Project" });
  await expect(select).toHaveValue("p1");
  await expect(page.getByRole("option", { name: "Alpha Matter" })).toBeAttached();
  await expect(page.getByRole("option", { name: "Beta Matter" })).toBeAttached();

  // The first project's documents render.
  await expect(page.getByText("alpha-brief.docx")).toBeVisible();
});

test("shows the empty state when there are no projects", async ({ addin, page }) => {
  addin.seedToken(TOKEN);
  await addin.mockApiJson("GET", "**/projects", []);

  await addin.gotoTaskpane();
  await openProjectsTab(page);

  await expect(page.getByText("No projects found.")).toBeVisible();
  // No selector or upload affordance is rendered in the empty state.
  await expect(page.getByRole("combobox", { name: "Project" })).toHaveCount(0);
});

test("surfaces an error when the project list fails to load", async ({ addin, page }) => {
  addin.seedToken(TOKEN);
  await addin.mockApiError("GET", "**/projects", 500, "boom");

  await addin.gotoTaskpane();
  await openProjectsTab(page);

  // ProjectPicker shows the thrown apiClient message: "GET /projects failed (500): ...".
  await expect(page.getByText(/GET \/projects failed \(500\)/)).toBeVisible();
});

test("loads the selected project's documents when the selection changes", async ({
  addin,
  page,
}) => {
  addin.seedToken(TOKEN);
  await addin.mockApiJson("GET", "**/projects", [
    { id: "p1", name: "Alpha Matter" },
    { id: "p2", name: "Beta Matter" },
  ]);
  // Per-project document lists keyed by id so we can prove the reload.
  await addin.mockApiJson("GET", "**/projects/p1/documents", [
    { id: "d1", filename: "alpha-brief.docx" },
  ]);
  await addin.mockApiJson("GET", "**/projects/p2/documents", [
    { id: "d2", filename: "beta-contract.docx" },
  ]);

  await addin.gotoTaskpane();
  await openProjectsTab(page);

  await expect(page.getByText("alpha-brief.docx")).toBeVisible();

  await page.getByRole("combobox", { name: "Project" }).selectOption("p2");

  await expect(page.getByText("beta-contract.docx")).toBeVisible();
  await expect(page.getByText("alpha-brief.docx")).toHaveCount(0);
});

test("shows the empty document state for a project with no documents", async ({
  addin,
  page,
}) => {
  addin.seedToken(TOKEN);
  await addin.mockApiJson("GET", "**/projects", [{ id: "p1", name: "Alpha Matter" }]);
  await addin.mockApiJson("GET", "**/projects/p1/documents", []);

  await addin.gotoTaskpane();
  await openProjectsTab(page);

  await expect(page.getByText("No documents yet.")).toBeVisible();
});

test("uploads the current document and refreshes the document list", async ({
  addin,
  page,
}) => {
  addin.seedToken(TOKEN);
  await addin.mockApiJson("GET", "**/projects", [{ id: "p1", name: "Alpha Matter" }]);
  // Start with no documents, then have the refresh GET return the uploaded one.
  await addin.mockApiJson("GET", "**/projects/p1/documents", []);
  await addin.mockApiJson("POST", "**/projects/p1/documents", {
    id: "d9",
    filename: "uploaded.docx",
  });

  await addin.gotoTaskpane({ documentText: "Some clause text." });
  await openProjectsTab(page);

  await expect(page.getByText("No documents yet.")).toBeVisible();

  // The post-upload refresh GET must now return the new document; this route is
  // registered last so it takes precedence for the refresh call.
  await addin.mockApiJson("GET", "**/projects/p1/documents", [
    { id: "d9", filename: "uploaded.docx" },
  ]);

  await page
    .getByRole("button", { name: "Upload current document to project" })
    .click();

  await expect(page.getByText("Document uploaded successfully.")).toBeVisible();
  await expect(page.getByText("uploaded.docx")).toBeVisible();
});

test("shows an error when the upload fails", async ({ addin, page }) => {
  addin.seedToken(TOKEN);
  await addin.mockApiJson("GET", "**/projects", [{ id: "p1", name: "Alpha Matter" }]);
  await addin.mockApiJson("GET", "**/projects/p1/documents", []);
  await addin.mockApiError("POST", "**/projects/p1/documents", 422, "bad file");

  await addin.gotoTaskpane({ documentText: "Some clause text." });
  await openProjectsTab(page);

  await page
    .getByRole("button", { name: "Upload current document to project" })
    .click();

  // ProjectPicker throws `Upload failed (422): ...` and renders it as error text.
  await expect(page.getByText(/Upload failed \(422\)/)).toBeVisible();
  await expect(page.getByText("Document uploaded successfully.")).toHaveCount(0);
});

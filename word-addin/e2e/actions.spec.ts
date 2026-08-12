import { test, expect } from "./support/fixtures";
import type { Addin } from "./support/fixtures";

const TOKEN = "test-jwt";

async function gotoActions(addin: Addin): Promise<void> {
  await addin.gotoTaskpane({ token: TOKEN });
  await addin.expectAuthedShell();
  await addin.page.getByRole("button", { name: "Open menu" }).click();
  await addin.page.getByRole("menuitem", { name: "Quick Actions" }).click();
  await expect(
    addin.page.getByTestId("quick-actions-full-screen"),
  ).toBeVisible();
}

test("matches the workflows page layout and lists the initial-view actions", async ({
  addin,
  page,
}) => {
  await gotoActions(addin);

  await expect(page.getByTestId("quick-actions-page-title")).toHaveText(
    "Quick Actions",
  );
  await expect(page.getByTestId("quick-actions-page-title")).toHaveClass(
    /font-serif/,
  );
  await expect(page.getByTestId("quick-actions-page-title")).toHaveClass(
    /text-2xl/,
  );
  await expect(page.getByTestId("quick-actions-page-title")).toHaveClass(
    /font-medium/,
  );
  await expect(page.getByPlaceholder("Search quick actions...")).toBeVisible();
  await expect(page.getByRole("button", { name: "Proofread" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Compare documents" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Extract key terms" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Draft from template" }),
  ).toBeVisible();
});

test("filters quick actions", async ({ addin, page }) => {
  await gotoActions(addin);

  await page.getByPlaceholder("Search quick actions...").fill("extract");
  await expect(
    page.getByRole("button", { name: "Extract key terms" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Proofread" })).toHaveCount(0);

  await page.getByPlaceholder("Search quick actions...").fill("missing");
  await expect(page.getByText("No matches found")).toBeVisible();
});

test("opens action details without leaving the Quick Actions page", async ({
  addin,
  page,
}) => {
  await gotoActions(addin);

  await page.getByRole("button", { name: /Proofread.*Active/ }).click();

  const modal = page.getByRole("dialog", { name: "Proofread" });
  await expect(modal).toBeVisible();
  await expect(modal.getByLabel("Workflow used")).toHaveValue("Proofread");
  await expect(modal.getByLabel("Prompt")).toHaveValue(
    "Review the current document for drafting quality, internal consistency, grammar, punctuation, formatting, numbering, defined terms, and cross-reference errors. List each issue with its location, severity, and a specific recommended fix.",
  );
  await expect(modal.getByLabel("Prompt")).toHaveClass(/min-h-40/);
  await expect(modal.getByText("Quick Actions", { exact: true })).toBeVisible();
  await expect(modal.getByRole("switch", { name: "Active" })).toBeChecked();
  await expect(page.getByText("Active", { exact: true }).first()).toHaveClass(
    /text-green-500/,
  );
  await expect(page.getByTestId("quick-actions-full-screen")).toBeVisible();
  // The Assistant stays mounted so its draft and conversation survive
  // navigation, but it must not be visible behind the Quick Actions page.
  await expect(page.getByPlaceholder("How can I help?")).toBeHidden();
});

test("inactive actions disappear from the Assistant initial view", async ({
  addin,
  page,
}) => {
  await gotoActions(addin);

  await page.getByRole("button", { name: /Proofread.*Active/ }).click();
  const modal = page.getByRole("dialog", { name: "Proofread" });
  await modal.getByRole("switch", { name: "Active" }).click();
  await expect(modal.getByRole("switch", { name: "Active" })).not.toBeChecked();
  await modal.getByRole("button", { name: "Done" }).click();
  await expect(
    page.getByRole("button", { name: /Proofread.*Inactive/ }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("menuitem", { name: "Assistant" }).click();
  await expect(page.getByRole("button", { name: "Proofread" })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Compare documents" }),
  ).toBeVisible();
});

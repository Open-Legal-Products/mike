import { expect, test } from "./support/fixtures";

const TOKEN = "user-message-layout-token";

test.beforeEach(async ({ addin }) => {
  addin.seedToken(TOKEN);
});

test("collapses long user messages and expands them from the bottom chevron", async ({
  addin,
  page,
}) => {
  await addin.mockChatStream(["Understood."]);
  await addin.gotoTaskpane({ documentText: "A document." });
  await addin.expectAuthedShell();

  const prompt = Array.from(
    { length: 18 },
    (_, index) =>
      `Paragraph ${index + 1} asks Mike to review a different part of the agreement.`,
  ).join("\n");
  await page.getByPlaceholder("How can I help?").fill(prompt);
  await page.getByRole("button", { name: "Send" }).click();

  const content = page.getByTestId("user-message-content");
  const expand = page.getByRole("button", { name: "Expand user message" });
  await expect(expand).toBeVisible();
  await expect(expand).toHaveAttribute("aria-expanded", "false");
  expect(await content.evaluate((element) => element.clientHeight)).toBe(144);

  await expand.click();
  const collapse = page.getByRole("button", { name: "Collapse user message" });
  await expect(collapse).toHaveAttribute("aria-expanded", "true");
  expect(
    await content.evaluate((element) => element.clientHeight),
  ).toBeGreaterThan(144);

  await collapse.click();
  await expect(expand).toHaveAttribute("aria-expanded", "false");
  expect(await content.evaluate((element) => element.clientHeight)).toBe(144);
});

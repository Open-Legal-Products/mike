/**
 * Manual-testing launcher: opens REAL Word on the web in the persistent
 * profile (Microsoft session captured via word-web-session.mjs --login),
 * creates a new document, sideloads the Mike manifest, opens the task
 * pane — then HANDS THE BROWSER TO YOU. Nothing else is automated; close
 * the window to end the session.
 *
 * The browser runs with Chrome's Local Network Access checks disabled,
 * which a dev sideload needs (Word's public editor frame iframes
 * https://localhost:3000). Prerequisites: the add-in dev server on :3000 and
 * the Mike backend on :3001 (the same services used by scripts/dev.sh).
 */
import { chromium } from "@playwright/test";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROFILE = path.join(os.homedir(), ".cache", "mike-word-web-profile");
const MANIFEST = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "manifest.xml",
);

const context = await chromium.launchPersistentContext(PROFILE, {
  headless: false,
  viewport: { width: 1600, height: 950 },
  ignoreHTTPSErrors: true,
  args: [
    "--ignore-certificate-errors",
    "--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessRespectPreflightResults,PrivateNetworkAccessForIframes",
  ],
});
const page = context.pages()[0] ?? (await context.newPage());

async function waitForFrame(match, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const frame = page.frames().find(match);
    if (frame) return frame;
    await page.waitForTimeout(1000);
  }
  throw new Error("frame not found in time");
}

console.log("Opening a new Word document…");
await page.goto("https://word.cloud.microsoft/new", {
  waitUntil: "domcontentloaded",
});
const wac = page.frameLocator('iframe[name^="WacFrame"]');
await wac
  .locator("#WACViewPanel_EditingElement")
  .waitFor({ timeout: 180_000 });
await page.waitForTimeout(8000);

console.log("Sideloading the Mike manifest…");
const more = wac.getByText(/^more add-ins$/i).first();
for (let attempt = 0; attempt < 4; attempt++) {
  await wac.locator("#InsertAddInFlyout").click();
  try {
    await more.waitFor({ timeout: 8000 });
    break;
  } catch {
    if (attempt === 3) throw new Error("Add-ins flyout never opened");
    await page.waitForTimeout(2000);
  }
}
await more.click();
const dialogFrame = await waitForFrame((f) => f.name().startsWith("_xdm_"), 60_000);
await dialogFrame.getByRole("tab", { name: /my add-ins/i }).click({ timeout: 60_000 });
await dialogFrame.locator("#ManageInner").click();
const uploadCandidates = dialogFrame.getByText(/upload my add-in/i);
let upload = null;
const deadline = Date.now() + 30_000;
while (Date.now() < deadline && !upload) {
  for (const candidate of await uploadCandidates.all()) {
    if (await candidate.isVisible().catch(() => false)) {
      upload = candidate;
      break;
    }
  }
  if (!upload) await page.waitForTimeout(1000);
}
if (!upload) throw new Error("no visible 'Upload My Add-in' menu item");
const chooserPromise = page
  .waitForEvent("filechooser", { timeout: 8_000 })
  .catch(() => null);
await upload.click();
const chooser = await chooserPromise;
if (chooser) {
  await chooser.setFiles(MANIFEST);
} else {
  const input = dialogFrame.locator('input[type="file"]').first();
  await input.waitFor({ state: "attached", timeout: 15_000 });
  await input.setInputFiles(MANIFEST);
}
await dialogFrame
  .getByRole("button", { name: /^upload$/i })
  .click({ timeout: 15_000 })
  .catch(() => {});

console.log("Waiting for the Mike pane…");
try {
  await waitForFrame((f) => f.url().includes("localhost:3000"), 30_000);
} catch {
  await wac.getByRole("button", { name: /mike/i }).first().click();
  await waitForFrame((f) => f.url().includes("localhost:3000"), 60_000);
}

console.log(
  "READY — Word + Mike pane are yours. Test manually; close the browser window to end.",
);
// Keep the process (and therefore the browser) alive until the user closes it.
await new Promise((resolve) => context.on("close", resolve));
console.log("Browser closed — manual session over.");

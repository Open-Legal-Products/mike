/**
 * Capture a Microsoft session for manual Word-on-the-web testing.
 *
 * Run once with `--login`, complete sign-in in the opened window, then use
 * `manual-session.mjs` to sideload the current add-in into a fresh document.
 * The persistent profile keeps Microsoft cookies between those launches.
 */
import { chromium } from "@playwright/test";
import os from "node:os";
import path from "node:path";

if (!process.argv.includes("--login")) {
  console.error("Usage: node e2e-live/word-web-session.mjs --login");
  process.exit(2);
}

const PROFILE = path.join(os.homedir(), ".cache", "mike-word-web-profile");
const context = await chromium.launchPersistentContext(PROFILE, {
  headless: false,
  viewport: { width: 1600, height: 950 },
});
const page = context.pages()[0] ?? (await context.newPage());

function isLoginUrl(url) {
  try {
    const { hostname } = new URL(url);
    return ["login.microsoftonline.com", "login.live.com"].some(
      (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
    );
  } catch {
    return false;
  }
}

async function signedIn() {
  await page.goto("https://www.office.com/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);
  if (isLoginUrl(page.url())) return false;
  const signInButton = page
    .getByRole("button", { name: /^sign in$/i })
    .or(page.getByRole("link", { name: /^sign in$/i }));
  return !(await signInButton.first().isVisible().catch(() => false));
}

if (await signedIn()) {
  console.log(
    "Already signed in. Run node e2e-live/manual-session.mjs to open Word.",
  );
  await context.close();
  process.exit(0);
}

console.log("Sign in to your Microsoft account in the opened window…");
console.log("This window remains open for up to 10 minutes.");
await page.goto(
  "https://www.office.com/login?ru=%2F&es=Click&cs=ShellSignedOut",
  { waitUntil: "domcontentloaded" },
);

const deadline = Date.now() + 10 * 60 * 1000;
let captured = false;
while (Date.now() < deadline) {
  await page.waitForTimeout(5000).catch(() => {});
  if (page.isClosed()) break;
  const url = page.url();
  if (isLoginUrl(url) || /signup/i.test(url)) continue;
  if (await signedIn()) {
    captured = true;
    break;
  }
}

if (captured) {
  console.log(
    "Session captured. Run node e2e-live/manual-session.mjs to open Word.",
  );
} else {
  console.log(
    "No signed-in session detected. Re-run with --login to try again.",
  );
}
await context.close().catch(() => {});
process.exit(captured ? 0 : 1);

import assert from "node:assert/strict";
import test from "node:test";

const apiUrl = process.env.ROSS_E2E_API_URL;
const appUrl = process.env.ROSS_E2E_APP_URL;

test("deployed API health endpoint responds", { skip: !apiUrl }, async () => {
  const response = await fetch(new URL("/health", apiUrl));
  assert.equal(response.ok, true);
  assert.deepEqual(await response.json(), { ok: true });
});

test("deployed web application responds", { skip: !appUrl }, async () => {
  const response = await fetch(appUrl, { redirect: "manual" });
  assert.ok(response.status >= 200 && response.status < 400);
});

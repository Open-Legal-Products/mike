/**
 * Shared Playwright fixture for the Mike Word add-in E2E suite.
 *
 * Spec authors import `{ test, expect }` from this module and drive the task
 * pane through the typed `addin` fixture — they should NEVER need to touch the
 * Office.js shim, page.route globs, or the static server. Everything is
 * hermetic: no live backend is ever contacted.
 *
 *   import { test, expect } from "./support/fixtures";
 *
 *   test("...", async ({ addin, page }) => {
 *     addin.seedToken("jwt");                 // (optional) start logged in
 *     await addin.mockApiJson("GET", "**\/projects", [{ id: "1", name: "X" }]);
 *     await addin.gotoTaskpane({ documentText: "Hello" });
 *     ...
 *   });
 *
 * Network mocks may be registered before OR after gotoTaskpane(); they apply to
 * any matching request that fires afterwards (logins/sends happen on click).
 * Seed-* setters affecting the initial mount (token) must be called BEFORE
 * gotoTaskpane(); live setters (setDocumentText/setSelection) work any time.
 */
import { test as base, expect, Page } from "@playwright/test";
import { installOfficeMock, OfficeSeed, WordCalls } from "./office-mock";

/** Static path the production bundle is served at (see playwright.config.ts). */
const TASKPANE_PATH = "/taskpane.html";

/** Block the real Office.js CDN so the shim stays authoritative. */
const OFFICE_JS_GLOB = "https://appsforoffice.microsoft.com/**";

// Route globs for every endpoint the add-in calls. Host-agnostic on purpose so
// they match regardless of REACT_APP_* build values.
const AUTH_GLOB = "**/auth/v1/token**";
const CHAT_GLOB = "**/chat";

export type HttpMethod = "GET" | "POST" | "DELETE" | "PUT" | "PATCH";

export interface MockLoginOk {
  ok: true;
  /** access_token returned to the client; defaults to "test-access-token". */
  accessToken?: string;
}
export interface MockLoginError {
  /** Surfaced by LoginPage as the error message. */
  error: string;
  /** HTTP status for the failed grant (default 400). */
  status?: number;
}
export type MockLoginArg = MockLoginOk | MockLoginError;

export interface ChatStreamOpts {
  /** Emit a `{"type":"error","message"}` event BEFORE `[DONE]` (surfaces as a throw). */
  errorBefore?: string;
  /** Return a non-2xx HTTP response instead of a stream (>=400 triggers the failure path). */
  status?: number;
  /**
   * Hold the `/chat` response pending for this many milliseconds before
   * fulfilling. Lets a test deterministically observe the in-flight streaming
   * state (e.g. input/Send disabled) before the stream completes.
   */
  holdMs?: number;
}

export interface MockJsonOpts {
  /** HTTP status for the response (default 200). */
  status?: number;
}

export interface Addin {
  /** The underlying Playwright page (escape hatch for custom assertions). */
  page: Page;

  // ----- seeding (call BEFORE gotoTaskpane) -----
  /** Start the session logged in by pre-seeding the `mike_token` storage key. */
  seedToken(token: string): void;
  /** Pre-seed the `mike_refresh_token` so an expired access token can refresh. */
  seedRefreshToken(token: string): void;
  /** Pre-seed the document body text returned by readDocumentText(). */
  seedDocumentText(text: string): void;
  /** Pre-seed the user's selected text returned by getSelectedText(). */
  seedSelection(text: string): void;

  // ----- navigation -----
  /**
   * Install the Office.js shim with the accumulated seed (merged with `opts`),
   * navigate to the task pane, and wait for React to mount (login OR app shell).
   */
  gotoTaskpane(opts?: OfficeSeed): Promise<void>;
  /** Assert the authenticated 4-tab shell is showing (Chat/Actions/Workflows/Projects). */
  expectAuthedShell(): Promise<void>;

  // ----- live document state (call any time) -----
  /** Update the document body text after mount. */
  setDocumentText(text: string): Promise<void>;
  /** Update the user's selection after mount. */
  setSelection(text: string): Promise<void>;

  // ----- reads -----
  /** Read the current `mike_token` from Office storage (null if logged out). */
  getToken(): Promise<string | null>;
  /** Read the current `mike_refresh_token` from Office storage (null if absent). */
  getRefreshToken(): Promise<string | null>;
  /** Read the recorded write-side Word calls for assertions. */
  wordCalls(): Promise<WordCalls>;

  // ----- network mocks -----
  /** Mock the Supabase password grant: success ({ ok }) or failure ({ error }). */
  mockLogin(arg: MockLoginArg): Promise<void>;
  /**
   * Mock the `/chat` SSE stream. Emits one `content_delta` per chunk, then
   * `[DONE]`. `opts.errorBefore` injects a pre-`[DONE]` error event;
   * `opts.status` (>=400) returns an HTTP failure instead.
   */
  mockChatStream(chunks: string[], opts?: ChatStreamOpts): Promise<void>;
  /** Mock any Mike API endpoint returning JSON for the given METHOD + URL glob. */
  mockApiJson(
    method: HttpMethod,
    urlGlob: string,
    json: unknown,
    opts?: MockJsonOpts
  ): Promise<void>;
  /** Mock any Mike API endpoint returning an error status for METHOD + URL glob. */
  mockApiError(
    method: HttpMethod,
    urlGlob: string,
    status: number,
    message?: string
  ): Promise<void>;
}

export const test = base.extend<{ addin: Addin }>({
  addin: async ({ page }, use) => {
    // Neutralise the CDN Office.js so only the shim defines the globals.
    await page.route(OFFICE_JS_GLOB, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/javascript",
        body: "/* office.js stubbed for E2E */",
      })
    );

    // Default the API-key status probe (fired on every authed mount by
    // ApiKeyBanner) to "claude configured" so the banner stays out of
    // unrelated specs — and so the request never escapes to a real backend,
    // where a 401 would clear the seeded session mid-test. Playwright matches
    // routes newest-first, so a spec's own mockApiJson/mockApiError for this
    // URL overrides it.
    await page.route("**/user/api-keys", (route, request) => {
      if (request.method() !== "GET") return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          claude: true,
          gemini: false,
          openai: false,
          openrouter: false,
          courtlistener: false,
          sources: {
            claude: "env",
            gemini: null,
            openai: null,
            openrouter: null,
            courtlistener: null,
          },
        }),
      });
    });

    let seed: OfficeSeed = {};

    /** Add a method-scoped JSON route; falls through to other routes on mismatch. */
    const routeJson = async (
      method: HttpMethod,
      glob: string,
      status: number,
      body: unknown
    ) => {
      await page.route(glob, (route, request) => {
        if (request.method().toUpperCase() !== method) return route.fallback();
        return route.fulfill({
          status,
          contentType: "application/json",
          body: JSON.stringify(body),
        });
      });
    };

    const addin: Addin = {
      page,

      seedToken(token) {
        seed.token = token;
      },
      seedRefreshToken(token) {
        seed.refreshToken = token;
      },
      seedDocumentText(text) {
        seed.documentText = text;
      },
      seedSelection(text) {
        seed.selectionText = text;
      },

      async gotoTaskpane(opts) {
        seed = { ...seed, ...(opts ?? {}) };
        await page.addInitScript(installOfficeMock, seed);
        await page.goto(TASKPANE_PATH);
        // "Mike" appears in both the login title and the app header, so this
        // resolves once React has mounted past the loading spinner either way.
        await expect(page.getByText("Mike").first()).toBeVisible({
          timeout: 15_000,
        });
      },

      async expectAuthedShell() {
        await expect(page.getByRole("tab", { name: "Chat" })).toBeVisible();
        await expect(page.getByRole("tab", { name: "Actions" })).toBeVisible();
        await expect(page.getByRole("tab", { name: "Workflows" })).toBeVisible();
        await expect(page.getByRole("tab", { name: "Projects" })).toBeVisible();
      },

      async setDocumentText(text) {
        await page.evaluate((t) => {
          (window as unknown as { __OFFICE_SEED__: { documentText: string } }).__OFFICE_SEED__.documentText =
            t;
        }, text);
      },
      async setSelection(text) {
        await page.evaluate((t) => {
          (window as unknown as { __OFFICE_SEED__: { selectionText: string } }).__OFFICE_SEED__.selectionText =
            t;
        }, text);
      },

      async getToken() {
        return page.evaluate(() =>
          (
            window as unknown as {
              OfficeRuntime: { storage: { getItem(k: string): Promise<string | null> } };
            }
          ).OfficeRuntime.storage.getItem("mike_token")
        );
      },

      async getRefreshToken() {
        return page.evaluate(() =>
          (
            window as unknown as {
              OfficeRuntime: { storage: { getItem(k: string): Promise<string | null> } };
            }
          ).OfficeRuntime.storage.getItem("mike_refresh_token")
        );
      },

      async wordCalls() {
        return page.evaluate(
          () => (window as unknown as { __WORD_CALLS__: WordCalls }).__WORD_CALLS__
        );
      },

      async mockLogin(arg) {
        await page.route(AUTH_GLOB, (route) => {
          if ("ok" in arg && arg.ok) {
            return route.fulfill({
              status: 200,
              contentType: "application/json",
              body: JSON.stringify({
                access_token: arg.accessToken ?? "test-access-token",
                token_type: "bearer",
                expires_in: 3600,
                refresh_token: "test-refresh-token",
                user: { id: "test-user-id", email: "e2e@mike.local" },
              }),
            });
          }
          const err = arg as MockLoginError;
          return route.fulfill({
            status: err.status ?? 400,
            contentType: "application/json",
            body: JSON.stringify({
              error: "invalid_grant",
              error_description: err.error,
            }),
          });
        });
      },

      async mockChatStream(chunks, opts) {
        await page.route(CHAT_GLOB, async (route) => {
          if (opts?.status && opts.status >= 400) {
            return route.fulfill({
              status: opts.status,
              contentType: "text/plain",
              body: "chat request failed",
            });
          }
          // Optionally hold the response pending so the streaming/in-flight UI
          // state is observable before the stream resolves.
          if (opts?.holdMs && opts.holdMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, opts.holdMs));
          }
          let body = "";
          for (const chunk of chunks) {
            body += `data: ${JSON.stringify({
              type: "content_delta",
              text: chunk,
            })}\n\n`;
          }
          if (opts?.errorBefore) {
            body += `data: ${JSON.stringify({
              type: "error",
              message: opts.errorBefore,
            })}\n\n`;
          }
          body += "data: [DONE]\n\n";
          return route.fulfill({
            status: 200,
            headers: {
              "content-type": "text/event-stream",
              "cache-control": "no-cache",
            },
            body,
          });
        });
      },

      async mockApiJson(method, urlGlob, json, opts) {
        await routeJson(method, urlGlob, opts?.status ?? 200, json);
      },

      async mockApiError(method, urlGlob, status, message) {
        await routeJson(method, urlGlob, status, {
          error: message ?? `${status} error`,
        });
      },
    };

    await use(addin);
  },
});

export { expect };
export type { OfficeSeed, WordCalls, WordCall } from "./office-mock";

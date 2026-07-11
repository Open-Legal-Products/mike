import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock createServerSupabase so no real Supabase client is created.
vi.mock("../src/lib/supabase", () => ({
  createServerSupabase: vi.fn(),
}));

import { createServerSupabase } from "../src/lib/supabase";
import {
  checkProjectAccess,
  ensureDocAccess,
  ensureReviewAccess,
  filterAccessibleDocumentIds,
  listAccessibleProjectIds,
} from "../src/lib/access";

// ---------------------------------------------------------------------------
// Helpers — build chainable mock query builders that match the Supabase API.
// ---------------------------------------------------------------------------

/**
 * Create a chainable query builder mock.  Supports:
 *   .select().eq().neq().in().filter()   → all return `this`
 *   .single() / .maybeSingle()           → Promise.resolve(result)
 *   await builder                         → Promise.resolve(result)  (thenable)
 */
function createChainable(result: { data: unknown }) {
  const chain: Record<string, unknown> = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    filter: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result),
    maybeSingle: vi.fn().mockResolvedValue(result),
  };
  // Make the chain itself awaitable (for queries without .single()).
  chain.then = (resolve: unknown, reject: unknown) =>
    Promise.resolve(result).then(resolve as never, reject as never);
  return chain as any;
}

/** Mock DB whose `from(table)` returns a chainable resolving with `{ data: project }`. */
function mockProjectDb(project: unknown) {
  return {
    from: vi.fn(() => createChainable({ data: project })),
  };
}

/** Mock DB for listAccessibleProjectIds — two sequential `from("projects")` calls. */
function mockListProjectsDb(
  own: { id: string }[],
  shared: { id: string }[],
) {
  let callCount = 0;
  return {
    from: vi.fn(() => {
      callCount++;
      const data = callCount === 1 ? own : shared;
      return createChainable({ data });
    }),
  };
}

/** Mock DB for filterAccessibleDocumentIds — `from("documents")` then two `from("projects")`. */
function mockFilterDocsDb(
  documents: { id: string; user_id: string; project_id: string | null }[],
  own: { id: string }[],
  shared: { id: string }[],
) {
  let projectsCallCount = 0;
  return {
    from: vi.fn((table: string) => {
      if (table === "documents") return createChainable({ data: documents });
      if (table === "projects") {
        projectsCallCount++;
        const data = projectsCallCount === 1 ? own : shared;
        return createChainable({ data });
      }
      return createChainable({ data: null });
    }),
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const USER_ID = "user-aaa-111";
const USER_EMAIL = "alice@test.com";
const OTHER_USER_ID = "user-bbb-222";
const PROJECT_ID = "proj-ccc-333";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

describe("checkProjectAccess", () => {
  it("returns { ok: false } when project is not found", async () => {
    const db = mockProjectDb(null);
    vi.mocked(createServerSupabase).mockReturnValue(db as any);

    const result = await checkProjectAccess(
      "nonexistent",
      USER_ID,
      USER_EMAIL,
      createServerSupabase() as any,
    );

    expect(result.ok).toBe(false);
  });

  it("returns { ok: false } when user is not owner and not in shared_with", async () => {
    const project = {
      id: PROJECT_ID,
      user_id: OTHER_USER_ID,
      shared_with: ["someone-else@test.com"],
    };
    const db = mockProjectDb(project);
    vi.mocked(createServerSupabase).mockReturnValue(db as any);

    const result = await checkProjectAccess(
      PROJECT_ID,
      USER_ID,
      USER_EMAIL,
      createServerSupabase() as any,
    );

    expect(result.ok).toBe(false);
  });

  it("returns { ok: true, isOwner: true } when user is the owner", async () => {
    const project = {
      id: PROJECT_ID,
      user_id: USER_ID,
      shared_with: null,
    };
    const db = mockProjectDb(project);
    vi.mocked(createServerSupabase).mockReturnValue(db as any);

    const result = await checkProjectAccess(
      PROJECT_ID,
      USER_ID,
      USER_EMAIL,
      createServerSupabase() as any,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.isOwner).toBe(true);
      expect(result.project.id).toBe(PROJECT_ID);
    }
  });

  it("returns { ok: true, isOwner: false } when user email is in shared_with", async () => {
    const project = {
      id: PROJECT_ID,
      user_id: OTHER_USER_ID,
      shared_with: [USER_EMAIL],
    };
    const db = mockProjectDb(project);
    vi.mocked(createServerSupabase).mockReturnValue(db as any);

    const result = await checkProjectAccess(
      PROJECT_ID,
      USER_ID,
      USER_EMAIL,
      createServerSupabase() as any,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.isOwner).toBe(false);
    }
  });

  it("matches shared_with case-insensitively", async () => {
    const project = {
      id: PROJECT_ID,
      user_id: OTHER_USER_ID,
      shared_with: ["ALICE@TEST.COM"],
    };
    const db = mockProjectDb(project);
    vi.mocked(createServerSupabase).mockReturnValue(db as any);

    const result = await checkProjectAccess(
      PROJECT_ID,
      USER_ID,
      USER_EMAIL,
      createServerSupabase() as any,
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.isOwner).toBe(false);
  });

  it("returns { ok: false } when shared_with is null and user is not owner", async () => {
    const project = {
      id: PROJECT_ID,
      user_id: OTHER_USER_ID,
      shared_with: null,
    };
    const db = mockProjectDb(project);
    vi.mocked(createServerSupabase).mockReturnValue(db as any);

    const result = await checkProjectAccess(
      PROJECT_ID,
      USER_ID,
      USER_EMAIL,
      createServerSupabase() as any,
    );

    expect(result.ok).toBe(false);
  });
});

describe("ensureDocAccess", () => {
  it("returns { ok: true, isOwner: true } when doc belongs to the user", async () => {
    const doc = { user_id: USER_ID, project_id: null };
    const db = mockProjectDb(null);
    vi.mocked(createServerSupabase).mockReturnValue(db as any);

    const result = await ensureDocAccess(
      doc,
      USER_ID,
      USER_EMAIL,
      createServerSupabase() as any,
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.isOwner).toBe(true);
  });

  it("returns { ok: false } when doc belongs to another user and project is not shared", async () => {
    const doc = { user_id: OTHER_USER_ID, project_id: PROJECT_ID };
    const project = {
      id: PROJECT_ID,
      user_id: OTHER_USER_ID,
      shared_with: [],
    };
    const db = mockProjectDb(project);
    vi.mocked(createServerSupabase).mockReturnValue(db as any);

    const result = await ensureDocAccess(
      doc,
      USER_ID,
      USER_EMAIL,
      createServerSupabase() as any,
    );

    expect(result.ok).toBe(false);
  });

  it("returns { ok: false } when doc has no project_id and user is not owner", async () => {
    const doc = { user_id: OTHER_USER_ID, project_id: null };
    const db = mockProjectDb(null);
    vi.mocked(createServerSupabase).mockReturnValue(db as any);

    const result = await ensureDocAccess(
      doc,
      USER_ID,
      USER_EMAIL,
      createServerSupabase() as any,
    );

    expect(result.ok).toBe(false);
  });

  it("returns { ok: true, isOwner: false } when doc is in a shared project", async () => {
    const doc = { user_id: OTHER_USER_ID, project_id: PROJECT_ID };
    const project = {
      id: PROJECT_ID,
      user_id: OTHER_USER_ID,
      shared_with: [USER_EMAIL],
    };
    const db = mockProjectDb(project);
    vi.mocked(createServerSupabase).mockReturnValue(db as any);

    const result = await ensureDocAccess(
      doc,
      USER_ID,
      USER_EMAIL,
      createServerSupabase() as any,
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.isOwner).toBe(false);
  });
});

describe("filterAccessibleDocumentIds", () => {
  it("only returns IDs the user can access (own + shared project docs)", async () => {
    const documents = [
      { id: "doc-1", user_id: USER_ID, project_id: null },
      { id: "doc-2", user_id: OTHER_USER_ID, project_id: "proj-shared" },
      { id: "doc-3", user_id: OTHER_USER_ID, project_id: "proj-not-shared" },
    ];
    const ownProjects = [{ id: "proj-shared" }];
    const sharedProjects: { id: string }[] = [];

    const db = mockFilterDocsDb(documents, ownProjects, sharedProjects);
    vi.mocked(createServerSupabase).mockReturnValue(db as any);

    const result = await filterAccessibleDocumentIds(
      ["doc-1", "doc-2", "doc-3"],
      USER_ID,
      USER_EMAIL,
      createServerSupabase() as any,
    );

    expect(result).toHaveLength(2);
    expect(result).toContain("doc-1");
    expect(result).toContain("doc-2");
    expect(result).not.toContain("doc-3");
  });

  it("returns accessible docs via shared project membership", async () => {
    const documents = [
      { id: "doc-a", user_id: OTHER_USER_ID, project_id: "proj-x" },
    ];
    const ownProjects: { id: string }[] = [];
    const sharedProjects = [{ id: "proj-x" }];

    const db = mockFilterDocsDb(documents, ownProjects, sharedProjects);
    vi.mocked(createServerSupabase).mockReturnValue(db as any);

    const result = await filterAccessibleDocumentIds(
      ["doc-a"],
      USER_ID,
      USER_EMAIL,
      createServerSupabase() as any,
    );

    expect(result).toEqual(["doc-a"]);
  });

  it("returns empty array when no documents are accessible", async () => {
    const documents = [
      { id: "doc-no", user_id: OTHER_USER_ID, project_id: "proj-private" },
    ];
    const ownProjects: { id: string }[] = [];
    const sharedProjects: { id: string }[] = [];

    const db = mockFilterDocsDb(documents, ownProjects, sharedProjects);
    vi.mocked(createServerSupabase).mockReturnValue(db as any);

    const result = await filterAccessibleDocumentIds(
      ["doc-no"],
      USER_ID,
      USER_EMAIL,
      createServerSupabase() as any,
    );

    expect(result).toEqual([]);
  });

  it("returns empty array for empty input", async () => {
    const db = mockFilterDocsDb([], [], []);
    vi.mocked(createServerSupabase).mockReturnValue(db as any);

    const result = await filterAccessibleDocumentIds(
      [],
      USER_ID,
      USER_EMAIL,
      createServerSupabase() as any,
    );

    expect(result).toEqual([]);
  });
});

describe("listAccessibleProjectIds", () => {
  it("returns own + shared projects", async () => {
    const ownProjects = [{ id: "proj-own-1" }, { id: "proj-own-2" }];
    const sharedProjects = [{ id: "proj-shared-1" }];

    const db = mockListProjectsDb(ownProjects, sharedProjects);
    vi.mocked(createServerSupabase).mockReturnValue(db as any);

    const result = await listAccessibleProjectIds(
      USER_ID,
      USER_EMAIL,
      createServerSupabase() as any,
    );

    expect(result).toHaveLength(3);
    expect(result).toContain("proj-own-1");
    expect(result).toContain("proj-own-2");
    expect(result).toContain("proj-shared-1");
  });

  it("returns only own projects when user has no email", async () => {
    const ownProjects = [{ id: "proj-own-1" }];
    // When userEmail is null/empty, the shared query is skipped
    // and Promise.resolve({ data: [] }) is used instead.
    const db = mockListProjectsDb(ownProjects, []);
    vi.mocked(createServerSupabase).mockReturnValue(db as any);

    const result = await listAccessibleProjectIds(
      USER_ID,
      null,
      createServerSupabase() as any,
    );

    expect(result).toEqual(["proj-own-1"]);
  });

  it("returns empty array when user has no projects", async () => {
    const db = mockListProjectsDb([], []);
    vi.mocked(createServerSupabase).mockReturnValue(db as any);

    const result = await listAccessibleProjectIds(
      USER_ID,
      USER_EMAIL,
      createServerSupabase() as any,
    );

    expect(result).toEqual([]);
  });
});

describe("ensureReviewAccess", () => {
  it("returns { ok: true, isOwner: true } when user is the review owner", async () => {
    const review = {
      user_id: USER_ID,
      project_id: null,
      shared_with: null,
    };
    const db = mockProjectDb(null);
    vi.mocked(createServerSupabase).mockReturnValue(db as any);

    const result = await ensureReviewAccess(
      review,
      USER_ID,
      USER_EMAIL,
      createServerSupabase() as any,
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.isOwner).toBe(true);
  });

  it("returns { ok: true, isOwner: false } when user email is in review shared_with", async () => {
    const review = {
      user_id: OTHER_USER_ID,
      project_id: null,
      shared_with: [USER_EMAIL],
    };
    const db = mockProjectDb(null);
    vi.mocked(createServerSupabase).mockReturnValue(db as any);

    const result = await ensureReviewAccess(
      review,
      USER_ID,
      USER_EMAIL,
      createServerSupabase() as any,
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.isOwner).toBe(false);
  });

  it("returns { ok: false } when user is not owner, not in shared_with, and no project_id", async () => {
    const review = {
      user_id: OTHER_USER_ID,
      project_id: null,
      shared_with: ["someone-else@test.com"],
    };
    const db = mockProjectDb(null);
    vi.mocked(createServerSupabase).mockReturnValue(db as any);

    const result = await ensureReviewAccess(
      review,
      USER_ID,
      USER_EMAIL,
      createServerSupabase() as any,
    );

    expect(result.ok).toBe(false);
  });

  it("returns { ok: true, isOwner: false } when review is in a shared project", async () => {
    const review = {
      user_id: OTHER_USER_ID,
      project_id: PROJECT_ID,
      shared_with: null,
    };
    const project = {
      id: PROJECT_ID,
      user_id: OTHER_USER_ID,
      shared_with: [USER_EMAIL],
    };
    const db = mockProjectDb(project);
    vi.mocked(createServerSupabase).mockReturnValue(db as any);

    const result = await ensureReviewAccess(
      review,
      USER_ID,
      USER_EMAIL,
      createServerSupabase() as any,
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.isOwner).toBe(false);
  });

  it("returns { ok: false } when project is not shared with the user", async () => {
    const review = {
      user_id: OTHER_USER_ID,
      project_id: PROJECT_ID,
      shared_with: null,
    };
    const project = {
      id: PROJECT_ID,
      user_id: OTHER_USER_ID,
      shared_with: ["someone-else@test.com"],
    };
    const db = mockProjectDb(project);
    vi.mocked(createServerSupabase).mockReturnValue(db as any);

    const result = await ensureReviewAccess(
      review,
      USER_ID,
      USER_EMAIL,
      createServerSupabase() as any,
    );

    expect(result.ok).toBe(false);
  });

  it("checks shared_with case-insensitively", async () => {
    const review = {
      user_id: OTHER_USER_ID,
      project_id: null,
      shared_with: ["ALICE@TEST.COM"],
    };
    const db = mockProjectDb(null);
    vi.mocked(createServerSupabase).mockReturnValue(db as any);

    const result = await ensureReviewAccess(
      review,
      USER_ID,
      USER_EMAIL,
      createServerSupabase() as any,
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.isOwner).toBe(false);
  });
});

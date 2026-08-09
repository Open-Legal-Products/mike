import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

type QueryError = { message: string } | null;
type QueryResult = { data: unknown; error: QueryError };
type RecordedQuery = {
  table: string;
  filters: { column: string; value: unknown }[];
};

const { dbState, recordedQueries } = vi.hoisted(() => ({
  dbState: {
    document: { data: { id: "word-document-row-1" }, error: null },
    chatList: { data: [], error: null },
    chatDetail: { data: null, error: null },
    messages: { data: [], error: null },
  } as {
    document: QueryResult;
    chatList: QueryResult;
    chatDetail: QueryResult;
    messages: QueryResult;
  },
  recordedQueries: [] as RecordedQuery[],
}));

function resultForAwaitedQuery(table: string): QueryResult {
  if (table === "word_chats") return dbState.chatList;
  if (table === "word_chat_messages") return dbState.messages;
  return { data: null, error: null };
}

function resultForSingleQuery(table: string): QueryResult {
  if (table === "word_documents") return dbState.document;
  if (table === "word_chats") return dbState.chatDetail;
  return { data: null, error: null };
}

function makeQuery(table: string) {
  const recorded: RecordedQuery = { table, filters: [] };
  recordedQueries.push(recorded);

  const query: Record<string, unknown> = {};
  const chain = [
    "select",
    "insert",
    "update",
    "delete",
    "upsert",
    "neq",
    "in",
    "is",
    "or",
    "not",
    "lt",
    "gt",
    "gte",
    "lte",
    "filter",
    "order",
    "limit",
    "range",
    "contains",
  ];
  for (const method of chain) query[method] = vi.fn(() => query);
  query.eq = vi.fn((column: string, value: unknown) => {
    recorded.filters.push({ column, value });
    return query;
  });
  query.single = vi.fn(() => Promise.resolve(resultForSingleQuery(table)));
  query.maybeSingle = vi.fn(() => Promise.resolve(resultForSingleQuery(table)));
  query.then = (
    resolve: (value: unknown) => unknown,
    reject?: (reason: unknown) => unknown,
  ) => Promise.resolve(resultForAwaitedQuery(table)).then(resolve, reject);
  return query;
}

function mockSupabase() {
  return {
    from: vi.fn((table: string) => makeQuery(table)),
    rpc: vi.fn(() => Promise.resolve({ data: null, error: null })),
    auth: {
      getUser: () =>
        Promise.resolve({ data: { user: { id: "u1" } }, error: null }),
    },
  };
}

vi.mock("../../lib/supabase", () => ({
  createServerSupabase: vi.fn(() => mockSupabase()),
}));

vi.mock("../../middleware/auth", () => ({
  requireAuth: (
    _req: unknown,
    res: { locals: Record<string, unknown> },
    next: () => void,
  ) => {
    res.locals.userId = "u1";
    res.locals.userEmail = "u1@test.local";
    next();
  },
  requireMfaIfEnrolled: (_req: unknown, _res: unknown, next: () => void) =>
    next(),
}));

import { app } from "../../app";

const DOCUMENT_ID = "123e4567-e89b-42d3-a456-426614174000";
const AUTH = ["Authorization", "Bearer test"] as const;

function resetDbState() {
  dbState.document = {
    data: { id: "word-document-row-1" },
    error: null,
  };
  dbState.chatList = { data: [], error: null };
  dbState.chatDetail = { data: null, error: null };
  dbState.messages = { data: [], error: null };
}

describe("Word chat history routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    recordedQueries.length = 0;
    resetDbState();
  });

  it("returns an empty list when the document row genuinely does not exist", async () => {
    dbState.document = { data: null, error: null };

    const res = await request(app)
      .get(`/word-chat?document_id=${DOCUMENT_ID}`)
      .set(...AUTH);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    expect(recordedQueries.map(({ table }) => table)).toEqual([
      "word_documents",
    ]);
  });

  it("returns 500 when the document lookup query fails", async () => {
    dbState.document = {
      data: null,
      error: { message: "word_documents is unavailable" },
    };

    const res = await request(app)
      .get(`/word-chat?document_id=${DOCUMENT_ID}`)
      .set(...AUTH);

    expect(res.status).toBe(500);
    expect(res.body.detail).toBe("word_documents is unavailable");
    expect(recordedQueries.map(({ table }) => table)).toEqual([
      "word_documents",
    ]);
  });

  it("returns 500 when the document-scoped chat list query fails", async () => {
    dbState.chatList = {
      data: null,
      error: { message: "word_chats is unavailable" },
    };

    const res = await request(app)
      .get(`/word-chat?document_id=${DOCUMENT_ID}`)
      .set(...AUTH);

    expect(res.status).toBe(500);
    expect(res.body.detail).toBe("word_chats is unavailable");
  });

  it("returns 500 rather than 404 when a detail document lookup fails", async () => {
    dbState.document = {
      data: null,
      error: { message: "document lookup failed" },
    };

    const res = await request(app)
      .get(`/word-chat/chat-1?document_id=${DOCUMENT_ID}`)
      .set(...AUTH);

    expect(res.status).toBe(500);
    expect(res.body.detail).toBe("document lookup failed");
  });

  it("returns 500 rather than 404 when the scoped chat lookup fails", async () => {
    dbState.chatDetail = {
      data: null,
      error: { message: "chat lookup failed" },
    };

    const res = await request(app)
      .get(`/word-chat/chat-1?document_id=${DOCUMENT_ID}`)
      .set(...AUTH);

    expect(res.status).toBe(500);
    expect(res.body.detail).toBe("chat lookup failed");
    expect(
      recordedQueries.find(({ table }) => table === "word_chats")?.filters,
    ).toEqual([
      { column: "id", value: "chat-1" },
      { column: "word_document_id", value: "word-document-row-1" },
      { column: "user_id", value: "u1" },
    ]);
    expect(
      recordedQueries.some(({ table }) => table === "word_chat_messages"),
    ).toBe(false);
  });

  it("keeps a genuinely missing scoped chat as 404", async () => {
    const res = await request(app)
      .get(`/word-chat/chat-1?document_id=${DOCUMENT_ID}`)
      .set(...AUTH);

    expect(res.status).toBe(404);
    expect(res.body.detail).toBe("Chat not found");
  });
});

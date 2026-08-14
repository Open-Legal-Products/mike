import { describe, expect, it, vi } from "vitest";
import {
  getUserCommittees,
  normalizeUserCommittees,
  validateUserCommittees,
} from "../userCommittees";

describe("user committee configuration", () => {
  const committee = {
    id: "user-committee/123",
    label: "Contract Review Committee",
    members: ["claude-sonnet-4-6", "gpt-5.4"],
    chair: "gemini-3-flash-preview",
    strategy: "synthesize" as const,
  };

  it("accepts a committee made from selectable models", () => {
    expect(validateUserCommittees([committee])).toEqual([committee]);
  });

  it("normalizes JSON persisted by SQLite", () => {
    expect(normalizeUserCommittees(JSON.stringify([committee]))).toEqual([
      committee,
    ]);
  });

  it("rejects duplicate members", () => {
    expect(() =>
      validateUserCommittees([
        { ...committee, members: ["gpt-5.4", "gpt-5.4"] },
      ]),
    ).toThrow(/same member more than once/i);
  });

  it("rejects nested GUI committees", () => {
    expect(() =>
      validateUserCommittees([
        {
          ...committee,
          members: ["gpt-5.4", "user-committee/other"],
        },
      ]),
    ).toThrow(/cannot contain another committee/i);
  });

  it("rejects model ids that merely resemble a supported provider", () => {
    expect(() =>
      validateUserCommittees([
        {
          ...committee,
          members: ["gpt-5.4", "gpt-model-that-does-not-exist"],
        },
      ]),
    ).toThrow(/unknown committee model/i);
  });

  it("surfaces database failures instead of treating them as no committees", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "database unavailable" },
    });
    const db = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ maybeSingle })),
        })),
      })),
    };

    await expect(
      getUserCommittees("user-1", db as never),
    ).rejects.toThrow(/unable to load model committees: database unavailable/i);
  });
});

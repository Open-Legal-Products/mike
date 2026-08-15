import { createServerSupabase } from "./supabase";
import { resolveModel } from "./llm/models";
import { getCommitteeModel } from "./llm/registry";
import type { CommitteeModel } from "./llm/types";

export const USER_COMMITTEE_PREFIX = "user-committee/";
export const MAX_USER_COMMITTEES = 8;
export const MAX_COMMITTEE_MEMBERS = 8;

export function isUserCommitteeId(value: string | null | undefined): boolean {
  return !!value?.startsWith(USER_COMMITTEE_PREFIX);
}

export function normalizeUserCommittees(value: unknown): CommitteeModel[] {
  let candidate = value;
  if (typeof candidate === "string") {
    try {
      candidate = JSON.parse(candidate);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(candidate)) return [];

  return candidate
    .slice(0, MAX_USER_COMMITTEES)
    .map((entry): CommitteeModel | null => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
      const record = entry as Record<string, unknown>;
      const id = typeof record.id === "string" ? record.id.trim() : "";
      const label = typeof record.label === "string" ? record.label.trim() : "";
      const chair = typeof record.chair === "string" ? record.chair.trim() : "";
      if (!isUserCommitteeId(id) || !label || !chair || !Array.isArray(record.members)) {
        return null;
      }
      const members = record.members
        .map((member) => {
          if (typeof member === "string") return member.trim();
          if (!member || typeof member !== "object" || Array.isArray(member)) return "";
          const model = (member as Record<string, unknown>).model;
          return typeof model === "string" ? model.trim() : "";
        })
        .filter(Boolean)
        .slice(0, MAX_COMMITTEE_MEMBERS);
      if (members.length < 2) return null;
      return { id, label, members, chair, strategy: "synthesize" };
    })
    .filter((committee): committee is CommitteeModel => committee !== null);
}

export function validateUserCommittees(value: unknown): CommitteeModel[] {
  if (!Array.isArray(value)) throw new Error("modelCommittees must be an array");
  if (value.length > MAX_USER_COMMITTEES) {
    throw new Error(`You can configure up to ${MAX_USER_COMMITTEES} committees.`);
  }

  const normalized = normalizeUserCommittees(value);
  if (normalized.length !== value.length) {
    throw new Error(
      `Each committee needs a name, a chair, and between 2 and ${MAX_COMMITTEE_MEMBERS} members.`,
    );
  }

  const ids = new Set<string>();
  for (const committee of normalized) {
    if (committee.label!.length > 80) {
      throw new Error("Committee names must be 80 characters or fewer.");
    }
    if (ids.has(committee.id) || getCommitteeModel(committee.id)) {
      throw new Error(`Committee id ${committee.id} is already in use.`);
    }
    ids.add(committee.id);

    const memberIds = committee.members.map((member) =>
      typeof member === "string" ? member : member.model,
    );
    if (new Set(memberIds).size !== memberIds.length) {
      throw new Error(`${committee.label} contains the same member more than once.`);
    }
    for (const model of [...memberIds, committee.chair]) {
      if (isUserCommitteeId(model) || getCommitteeModel(model)) {
        throw new Error("A GUI committee cannot contain another committee.");
      }
      if (resolveModel(model, "") !== model) {
        throw new Error(`Unknown committee model: ${model}`);
      }
    }
  }
  return normalized;
}

export async function getUserCommittees(
  userId: string,
  db: ReturnType<typeof createServerSupabase> = createServerSupabase(),
): Promise<CommitteeModel[]> {
  const { data, error } = await db
    .from("user_profiles")
    .select("model_committees")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    const detail =
      typeof error === "object" && error && "message" in error
        ? String(error.message)
        : String(error);
    throw new Error(`Unable to load model committees: ${detail}`);
  }
  if (!data) return [];
  return normalizeUserCommittees(
    (data as { model_committees?: unknown }).model_committees,
  );
}

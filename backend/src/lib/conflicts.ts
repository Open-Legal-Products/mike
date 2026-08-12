import { z } from "zod";

const name = z.string().trim().min(1).max(200);
const optionalName = z
  .string()
  .trim()
  .max(200)
  .optional()
  .transform((value) => value || undefined);
const names = z.array(name).max(25).default([]);

export const conflictRecordInput = z.object({
  clientName: name,
  matterName: optionalName,
  parties: names,
  affiliates: names,
});

export const conflictSearchInput = z
  .object({
    prospectiveClient: optionalName,
    matterName: optionalName,
    parties: names,
    affiliates: names,
  })
  .refine(
    (value) =>
      Boolean(value.prospectiveClient) ||
      value.parties.length > 0 ||
      value.affiliates.length > 0,
    { message: "Enter a prospective client, party, or affiliate" },
  );

export const conflictReviewInput = z.object({
  status: z.enum(["cleared", "conflict_found"]),
  notes: z.string().trim().min(1).max(2000),
});

export type ConflictRecordInput = z.infer<typeof conflictRecordInput>;
export type ConflictSearchInput = z.infer<typeof conflictSearchInput>;

export function normalizedSearchText(input: ConflictRecordInput): string {
  return [
    input.clientName,
    input.matterName,
    ...input.parties,
    ...input.affiliates,
  ]
    .filter(Boolean)
    .join("\n")
    .toLocaleLowerCase();
}

export function searchTerms(input: ConflictSearchInput): string[] {
  return [
    input.prospectiveClient,
    input.matterName,
    ...input.parties,
    ...input.affiliates,
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.toLocaleLowerCase());
}

export function escapeLike(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

type StoredRecord = {
  client_name: string;
  matter_name: string | null;
  parties: unknown;
  affiliates: unknown;
};

export function matchedFields(
  record: StoredRecord,
  input: ConflictSearchInput,
): string[] {
  const candidateSets = {
    client: [record.client_name],
    matter: record.matter_name ? [record.matter_name] : [],
    party: Array.isArray(record.parties) ? record.parties : [],
    affiliate: Array.isArray(record.affiliates) ? record.affiliates : [],
  } as const;
  const terms = searchTerms(input);
  return Object.entries(candidateSets)
    .filter(([, values]) =>
      values.some(
        (value) =>
          typeof value === "string" &&
          terms.some((term) => value.toLocaleLowerCase().includes(term)),
      ),
    )
    .map(([field]) => field);
}

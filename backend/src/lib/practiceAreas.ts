/**
 * The fixed set of practice areas a user can keep a per-area practice profile
 * for. These match the `practice` labels carried by the built-in / ported
 * workflows, so the active workflow's area maps onto exactly one profile.
 */
export const PRACTICE_AREAS = [
    "AI Governance",
    "Commercial Contracts",
    "Corporate / M&A",
    "Employment",
    "General Transactions",
    "Intellectual Property",
    "Law Student",
    "Legal Clinic",
    "Litigation",
    "Privacy & Data Protection",
    "Product",
    "Regulatory",
] as const;

export type PracticeArea = (typeof PRACTICE_AREAS)[number];

export const PRACTICE_AREA_SET: ReadonlySet<string> = new Set(PRACTICE_AREAS);

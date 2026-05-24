/**
 * Compute a display label from node components.
 * This mirrors the backend format_lineage_label function.
 */

const STRUCTURE_NODE_TYPES = [
  "subtitle",
  "division",
  "chapter",
  "subchapter",
  "part",
  "subpart",
  "article",
  "subarticle",
  "appendix",
] as const;

type StructureNodeType = (typeof STRUCTURE_NODE_TYPES)[number];
type CodeType = "title" | "section" | StructureNodeType | string;

export interface NodeComponents {
  code_type: CodeType;
  identifier: string;
}

export function computeLabel({ code_type, identifier }: NodeComponents): string {
  return `${code_type} ${identifier}`;
}

/**
 * Compute a display label from node components.
 * This mirrors the backend format_lineage_label function.
 */

type StructureNodeType =
  | "subtitle"
  | "division"
  | "chapter"
  | "subchapter"
  | "part"
  | "subpart"
  | "article"
  | "subarticle"
  | "appendix";
type CodeType = "title" | "section" | StructureNodeType | string;

export interface NodeComponents {
  code_type: CodeType;
  identifier: string;
}

export function computeLabel({ code_type, identifier }: NodeComponents): string {
  return `${code_type} ${identifier}`;
}

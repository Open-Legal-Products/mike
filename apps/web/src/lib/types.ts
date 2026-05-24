export interface TitleSummary {
  title_number: number;
  heading: string;
  citation: string;
  slug: string;
}

export interface SectionNeighbor {
  slug: string;
  citation?: string | null;
  heading?: string | null;
  title_number: number;
  section_number?: string | null;
}

export interface ChapterNavigation {
  label: string;
  slug: string;
  sections: SectionNeighbor[];
}

export interface CrossReference {
  to_citation: string;
  resolved: boolean;
  to_slug?: string | null;
  context_snippet?: string | null;
}

export interface SectionNote {
  title: string;
  html: string;
}

export interface BreadcrumbNode {
  id: string;
  slug: string;
  code_type: string;
  identifier?: string | null;
  heading?: string | null;
}

export interface SectionDetail {
  id: string;
  slug: string;
  citation: string;
  heading?: string | null;
  title_number: number;
  section_number: string;
  path: BreadcrumbNode[];
  text_html: string;
  text_plain?: string | null;
  text_markdown?: string | null;
  effective_start: string;
  effective_end?: string | null;
  source_document?: string | null;
  source_note?: string | null;
  neighbors: {
    previous?: SectionNeighbor | null;
    next?: SectionNeighbor | null;
  };
  chapter_navigation?: ChapterNavigation | null;
  cross_references: CrossReference[];
  notes: SectionNote[];
  chapter_number?: string | null;
}

export interface SearchResultItem {
  slug: string;
  citation: string;
  heading?: string | null;
  title_number: number;
  section_number: string;
  snippet?: string | null;
}

export interface SearchResponse {
  total: number;
  limit: number;
  offset: number;
  results: SearchResultItem[];
}

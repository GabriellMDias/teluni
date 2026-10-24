export type Kind = "api" | "database" | "component" | "repository";
export type Heading = { id: string; text: string; level: number };
export type Entry = {
  id: string;
  kind: Kind;
  title: string;
  group: string;
  source: string;
  summary: string;
  file: string;
  headings: Heading[];
  method?: string;
  path?: string;
  tags?: string[];
  category?: string;
  scope?: "shared" | "composed" | "feature-specific";
  owner?: string;
  metadataSource?: string;
};
export type SearchRecord = {
  id: string;
  title: string;
  group: string;
  kind: Kind;
  text: string;
  heading?: string;
  anchor?: string;
};
export type SearchHit = Omit<SearchRecord, "text"> & {
  snippet: string;
  score: number;
};
export type SearchResponse = {
  requestId: number;
  hits: SearchHit[];
  total: number;
  error?: string;
};
export type Manifest = {
  version: number;
  title: string;
  entries: Entry[];
  componentCategories?: string[];
  search: {
    shards: { file: string; count: number; kinds?: string[] }[];
    count: number;
  };
};

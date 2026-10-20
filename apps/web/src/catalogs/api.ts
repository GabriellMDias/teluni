import type { paths } from "@teluni/sdk";
import { unwrap } from "../api-client.js";
import { sessionApiClient } from "../identity/api.js";
import { mediaErrorCodes } from "../media/api.js";

export const catalogErrorCodes: ReadonlySet<string> = new Set([
  ...mediaErrorCodes,
  "CATALOG_SCHEMA_INVALID",
  "CATALOG_RECORD_INVALID",
  "CATALOG_RECORD_REFERENCED",
  "CATALOG_PROMOTION_CONFLICT",
  "CATALOG_LIMIT_REACHED",
  "CATALOG_ARCHIVED",
  "CATALOG_NOT_EMPTY",
  "CATALOG_IN_USE",
]);

type Json<T> = T extends {
  responses: { 200: { content: { "application/json": infer Body } } };
}
  ? Body
  : never;

export type Catalog = Json<
  paths["/companies/{companyId}/catalogs/{catalogId}"]["get"]
>;
export type Field = Catalog["fields"][number];
export type FieldType = Field["type"];
export type FieldInput = NonNullable<
  paths["/companies/{companyId}/catalogs/{catalogId}/schema"]["put"]["requestBody"]
>["content"]["application/json"]["fields"][number];
export type CatalogRecord = Json<
  paths["/companies/{companyId}/catalogs/{catalogId}/records/{recordId}"]["get"]
>;
export type Value = CatalogRecord["values"][string];
export type Promotion = Json<
  paths["/companies/{companyId}/catalogs/{catalogId}/records/{recordId}/prices/{fieldId}/promotions"]["get"]
>["items"][number];
export type EffectivePrices = Json<
  paths["/companies/{companyId}/catalogs/{catalogId}/records/{recordId}/effective-prices"]["get"]
>;

export const catalogsKey = (companyId: string) =>
  ["catalogs", "list", companyId] as const;
export const catalogKey = (companyId: string, catalogId: string) =>
  ["catalogs", "catalog", companyId, catalogId] as const;
export const recordsKey = (companyId: string, catalogId: string) =>
  ["catalogs", "records", companyId, catalogId] as const;
export const recordKey = (
  companyId: string,
  catalogId: string,
  recordId: string,
) => ["catalogs", "record", companyId, catalogId, recordId] as const;
export const promotionsKey = (
  companyId: string,
  catalogId: string,
  recordId: string,
  fieldId: string,
) =>
  ["catalogs", "promotions", companyId, catalogId, recordId, fieldId] as const;
export const effectiveKey = (
  companyId: string,
  catalogId: string,
  recordId: string,
  at: string,
) => ["catalogs", "effective", companyId, catalogId, recordId, at] as const;

const client = sessionApiClient;

export async function listCatalogs(
  companyId: string,
  filter: { cursor?: string; text?: string; status?: "ACTIVE" | "ARCHIVED" },
) {
  return unwrap(
    await client().GET("/companies/{companyId}/catalogs", {
      params: { path: { companyId }, query: { limit: 50, ...filter } },
    }),
    catalogErrorCodes,
  );
}

/**
 * Active catalogs a reference field may target, page by page. A company
 * holds at most 200 catalogs, so this stays bounded.
 */
export async function listCatalogChoices(companyId: string) {
  type Page = Awaited<ReturnType<typeof listCatalogs>>;
  const items: Page["items"] = [];
  let cursor: string | null = null;
  do {
    const page: Page = unwrap(
      await client().GET("/companies/{companyId}/catalogs", {
        params: {
          path: { companyId },
          query: {
            limit: 100,
            status: "ACTIVE",
            ...(cursor ? { cursor } : {}),
          },
        },
      }),
      catalogErrorCodes,
    );
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return items;
}

export async function getCatalog(companyId: string, catalogId: string) {
  return unwrap(
    await client().GET("/companies/{companyId}/catalogs/{catalogId}", {
      params: { path: { companyId, catalogId } },
    }),
    catalogErrorCodes,
  );
}

export async function createCatalog(
  companyId: string,
  input: { name: string; branchId: string | null; fields: FieldInput[] },
) {
  return unwrap(
    await client().POST("/companies/{companyId}/catalogs", {
      params: { path: { companyId } },
      body: input,
    }),
    catalogErrorCodes,
  );
}

export async function updateCatalog(
  companyId: string,
  catalog: Catalog,
  changes: { name?: string; archived?: boolean },
) {
  return unwrap(
    await client().PATCH("/companies/{companyId}/catalogs/{catalogId}", {
      params: { path: { companyId, catalogId: catalog.id } },
      body: { expectedVersion: catalog.version, ...changes },
    }),
    catalogErrorCodes,
  );
}

export async function deleteCatalog(companyId: string, catalog: Catalog) {
  const { error, response } = await client().DELETE(
    "/companies/{companyId}/catalogs/{catalogId}",
    {
      params: { path: { companyId, catalogId: catalog.id } },
      body: { expectedVersion: catalog.version },
    },
  );
  if (response.status === 204) return;
  unwrap({ error, response }, catalogErrorCodes);
}

export async function replaceSchema(
  companyId: string,
  catalog: Catalog,
  fields: FieldInput[],
) {
  return unwrap(
    await client().PUT("/companies/{companyId}/catalogs/{catalogId}/schema", {
      params: { path: { companyId, catalogId: catalog.id } },
      body: { expectedVersion: catalog.version, fields },
    }),
    catalogErrorCodes,
  );
}

export async function listRecords(
  companyId: string,
  catalogId: string,
  filter: { cursor?: string; text?: string; limit?: number },
) {
  return unwrap(
    await client().GET("/companies/{companyId}/catalogs/{catalogId}/records", {
      params: {
        path: { companyId, catalogId },
        query: { limit: 50, ...filter },
      },
    }),
    catalogErrorCodes,
  );
}

export async function getRecord(
  companyId: string,
  catalogId: string,
  recordId: string,
) {
  return unwrap(
    await client().GET(
      "/companies/{companyId}/catalogs/{catalogId}/records/{recordId}",
      { params: { path: { companyId, catalogId, recordId } } },
    ),
    catalogErrorCodes,
  );
}

export async function createRecord(
  companyId: string,
  catalogId: string,
  values: Record<string, Value>,
  available = true,
) {
  return unwrap(
    await client().POST("/companies/{companyId}/catalogs/{catalogId}/records", {
      params: { path: { companyId, catalogId } },
      body: { values, available },
    }),
    catalogErrorCodes,
  );
}

export async function updateRecord(
  companyId: string,
  record: CatalogRecord,
  changes: { values?: Record<string, Value>; available?: boolean },
) {
  return unwrap(
    await client().PATCH(
      "/companies/{companyId}/catalogs/{catalogId}/records/{recordId}",
      {
        params: {
          path: { companyId, catalogId: record.catalogId, recordId: record.id },
        },
        body: { expectedVersion: record.version, ...changes },
      },
    ),
    catalogErrorCodes,
  );
}

export async function moveRecord(
  companyId: string,
  record: CatalogRecord,
  afterRecordId: string | null,
) {
  return unwrap(
    await client().POST(
      "/companies/{companyId}/catalogs/{catalogId}/records/{recordId}/move",
      {
        params: {
          path: { companyId, catalogId: record.catalogId, recordId: record.id },
        },
        body: { expectedVersion: record.version, afterRecordId },
      },
    ),
    catalogErrorCodes,
  );
}

export async function deleteRecord(companyId: string, record: CatalogRecord) {
  const { error, response } = await client().DELETE(
    "/companies/{companyId}/catalogs/{catalogId}/records/{recordId}",
    {
      params: {
        path: { companyId, catalogId: record.catalogId, recordId: record.id },
      },
      body: { expectedVersion: record.version },
    },
  );
  if (response.status === 204) return;
  unwrap({ error, response }, catalogErrorCodes);
}

export async function setBasePrice(
  companyId: string,
  record: CatalogRecord,
  fieldId: string,
  amount: number | null,
) {
  return unwrap(
    await client().PUT(
      "/companies/{companyId}/catalogs/{catalogId}/records/{recordId}/prices/{fieldId}",
      {
        params: {
          path: {
            companyId,
            catalogId: record.catalogId,
            recordId: record.id,
            fieldId,
          },
        },
        body: { expectedVersion: record.version, amount },
      },
    ),
    catalogErrorCodes,
  );
}

export async function setBranchPrice(
  companyId: string,
  record: CatalogRecord,
  fieldId: string,
  branchId: string,
  amount: number | null,
) {
  return unwrap(
    await client().PUT(
      "/companies/{companyId}/catalogs/{catalogId}/records/{recordId}/prices/{fieldId}/branches/{branchId}",
      {
        params: {
          path: {
            companyId,
            catalogId: record.catalogId,
            recordId: record.id,
            fieldId,
            branchId,
          },
        },
        body: { expectedVersion: record.version, amount },
      },
    ),
    catalogErrorCodes,
  );
}

export async function listPromotions(
  companyId: string,
  record: CatalogRecord,
  fieldId: string,
) {
  return unwrap(
    await client().GET(
      "/companies/{companyId}/catalogs/{catalogId}/records/{recordId}/prices/{fieldId}/promotions",
      {
        params: {
          path: {
            companyId,
            catalogId: record.catalogId,
            recordId: record.id,
            fieldId,
          },
        },
      },
    ),
    catalogErrorCodes,
  ).items;
}

export async function createPromotion(
  companyId: string,
  record: CatalogRecord,
  fieldId: string,
  input: {
    branchId: string | null;
    amount: number;
    startsAt: string;
    endsAt: string;
  },
) {
  const result = await client().POST(
    "/companies/{companyId}/catalogs/{catalogId}/records/{recordId}/prices/{fieldId}/promotions",
    {
      params: {
        path: {
          companyId,
          catalogId: record.catalogId,
          recordId: record.id,
          fieldId,
        },
      },
      body: input,
    },
  );
  return unwrap(result, catalogErrorCodes);
}

export async function deletePromotion(
  companyId: string,
  record: CatalogRecord,
  fieldId: string,
  promotionId: string,
) {
  const { error, response } = await client().DELETE(
    "/companies/{companyId}/catalogs/{catalogId}/records/{recordId}/prices/{fieldId}/promotions/{promotionId}",
    {
      params: {
        path: {
          companyId,
          catalogId: record.catalogId,
          recordId: record.id,
          fieldId,
          promotionId,
        },
      },
    },
  );
  if (response.status === 204) return;
  unwrap({ error, response }, catalogErrorCodes);
}

export async function getEffectivePrices(
  companyId: string,
  record: CatalogRecord,
  at: string,
) {
  return unwrap(
    await client().GET(
      "/companies/{companyId}/catalogs/{catalogId}/records/{recordId}/effective-prices",
      {
        params: {
          path: {
            companyId,
            catalogId: record.catalogId,
            recordId: record.id,
          },
          query: { at },
        },
      },
    ),
    catalogErrorCodes,
  );
}

/**
 * Ready images for media fields, optionally only the company's (`scope`
 * "company"), as a company catalog may name no branch image.
 */
export async function listSelectableImages(
  companyId: string,
  text: string | undefined,
  scope?: "company",
) {
  return unwrap(
    await client().GET("/companies/{companyId}/media", {
      params: {
        path: { companyId },
        query: {
          limit: 48,
          view: "selectable",
          kind: "IMAGE",
          ...(text ? { text } : {}),
          ...(scope ? { scope } : {}),
        },
      },
    }),
    catalogErrorCodes,
  );
}
